# -*- coding: utf-8 -*-
"""轻量、可审计的本地 GraphRAG 索引与查询服务（仅标准库）。"""
import argparse, hashlib, json, math, os, re, sys
import threading
from pathlib import Path
from retrieval_backends import DenseVectorRetriever, HybridRetrievalPipeline, JsonGraphStore, capabilities

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent
INPUT = ROOT / 'input' / 'guidelines'
OUTPUT = ROOT / 'output'
RELATIONS_FILE = ROOT / 'input' / 'relations.json'
EVIDENCE_REGISTRY_FILE = ROOT / 'input' / 'evidence_registry.json'
INDEX_VERSION = '2026-08-26.v9'
_RUNTIME_INDEX_CACHE = {}
_RUNTIME_INDEX_LOCK = threading.Lock()


def _index_json(path, default=None):
    """Return an immutable index component from the resident process cache."""
    path = Path(path)
    if not path.exists(): return default
    key = str(path.resolve())
    modified = path.stat().st_mtime_ns
    with _RUNTIME_INDEX_LOCK:
        cached = _RUNTIME_INDEX_CACHE.get(key)
        if cached and cached[0] == modified: return cached[1]
        value = json.loads(path.read_text(encoding='utf-8'))
        _RUNTIME_INDEX_CACHE[key] = (modified, value)
        return value


def preload_runtime_index(output_path=None):
    output_dir = Path(output_path or os.environ.get('GRAPHRAG_OUTPUT_PATH') or OUTPUT)
    if not (output_dir / 'chunks.json').exists(): build(output_dir)
    names = ('chunks.json', 'entities.json', 'relationships.json', 'source_manifest.json',
             'evidence_conflicts.json', 'medical_pre_review.json', 'hidden_relationship_candidates.json')
    loaded = {name: _index_json(output_dir / name) for name in names if (output_dir / name).exists()}
    return {'output_path': str(output_dir), 'components': sorted(loaded),
            'chunks': len(loaded.get('chunks.json') or []), 'loaded_once': True}

CHINESE_DISPLAY_NAMES = {
    'activity_pattern':'活动模式','age_over_65':'65岁以上','alcohol':'饮酒','annual_complication_screening':'年度并发症筛查',
    'bp':'血压','caregiver_involvement':'照护者参与','caregiver_support':'照护支持','cholesterol':'胆固醇',
    'chronic_kidney_disease':'慢性肾脏病','clinician_review':'专业人员复核','cognitive_decline':'认知下降',
    'cognitive_impairment':'认知功能受损','comprehensive_geriatric_assessment':'老年综合评估','creatinine':'肌酐',
    'dehydration':'脱水','depressive_symptoms':'抑郁症状','diabetes':'糖尿病','disturbed_sleep':'睡眠紊乱',
    'do_not_self_adjust_medication':'不要自行调整药物','drowsiness_or_slow_reaction':'困倦或反应变慢','egfr':'估算肾小球滤过率',
    'face_arm_speech_emergency':'面口歪斜、手臂无力或言语不清','fall_risk':'跌倒风险','fall_risk_review':'跌倒风险复核',
    'family_history':'家族史','frail_older_adults':'虚弱老年人','frailty':'虚弱','glucose':'血糖','grip':'握力',
    'hba1c':'糖化血红蛋白','healthy_diet':'健康饮食','heart_disease':'心脏病','high_bp':'血压偏高',
    'high_glucose':'血糖偏高','high_lipids':'血脂偏高','high_salt_diet':'高盐饮食','home_bp_remeasurement':'家庭血压复测',
    'home_safety_improvement':'改善居家安全','hypertension':'高血压','hypoglycemia':'低血糖','kidney_function_recheck':'肾功能复查',
    'lifestyle_program':'生活方式管理','low_to_moderate_activity':'低至中等强度活动','medication_review':'药物复核',
    'mediterranean_diet':'地中海式饮食','mobility_limitation':'活动能力受限','obesity':'肥胖','older_adults':'老年人',
    'orthostatic_hypotension':'体位性低血压','physical_inactivity':'身体活动不足','polypharmacy':'多重用药',
    'regular_activity':'规律活动','salt_reduction':'减少盐摄入','sedentary_behavior':'久坐行为','sedentary_pattern':'久坐模式',
    'simplify_care_plan':'简化照护方案','sleep':'睡眠','smoking':'吸烟','social_determinants':'社会因素',
    'social_isolation':'社会隔离','standing_bp':'站立血压','steps':'步数','strength_balance_activity':'力量和平衡活动',
    'stroke':'脑卒中','systolic_bp':'收缩压','tobacco':'烟草使用','unhealthy_diet':'不健康饮食','urine_albumin':'尿白蛋白',
    'vision_impairment':'视力受损','weight':'体重',
}

def display_name(node, entities):
    raw = entities.get(node, {}).get('name', node.split(':')[-1])
    return CHINESE_DISPLAY_NAMES.get(raw, raw)
EVIDENCE_LEVELS = {
    'authoritative_guidance': 4,
    'professional_guideline': 4,
    'professional_statement': 4,
    'clinical_standard': 4,
    'systematic_review': 3,
    'randomized_trial': 2,
    'observational_study': 1,
    'public_guidance': 1,
}
# 这些来源可以进入医生/审计视图，但在老人端不能被当作已经完成医学审核的证据。
# 不把普通 pending_medical_review 一律删除：多数来源仍可用于健康教育，真正的硬门槛由关系级医学门控负责。
LEGACY_PENDING_MARKERS = ('legacy', '复核前仅用于演示', '需专业人员复核', '演示条目')
PRIVILEGED_AUDIENCES = {'doctor', 'clinician', 'audit'}
HIGH_RISK_RELATION_TYPES = {
    'urgent_signal', 'emergency_action', 'requires_medical_review',
    'requires_clinician_review', 'do_not_self_adjust_medication',
    'contraindicated_or_caution', 'increases_risk_of',
    'major_preventable_driver', 'managed_by', 'prevention_evidence',
}
URGENT_SAFETY_TYPES = {'urgent_signal', 'emergency_action'}
INVALID_SOURCE_MARKERS = ('rejected', 'revoked', 'expired', 'invalid', 'unavailable', '失效', '撤回', '过期', '不可用')

def is_legacy_pending_status(status):
    value = str(status or '').strip().lower()
    return any(marker.lower() in value for marker in LEGACY_PENDING_MARKERS)

def source_review_state(status):
    """Normalize source governance without treating missing or AI review as approval."""
    value = str(status or '').strip().lower()
    if any(marker in value for marker in INVALID_SOURCE_MARKERS): return 'invalid'
    if is_legacy_pending_status(value): return 'legacy_pending'
    if value == 'approved': return 'approved'
    if value in {'pending', 'pending_medical_review', 'needs_clinician_confirmation'} or '待' in value or '复核' in value:
        return 'pending'
    return 'unknown'

def is_clinician_approved(edge):
    """Approval requires clinical identity and timestamp; a status string alone is insufficient."""
    reviewer = edge.get('reviewer_name_or_id') or edge.get('reviewed_by') or edge.get('reviewer_id')
    reviewer_role = str(edge.get('reviewer_role') or '').lower()
    clinical_role = any(term in reviewer_role for term in ('doctor', 'clinician', 'geriatric', 'primary_care', 'medical'))
    return edge.get('review_status') == 'approved' and bool(reviewer and edge.get('reviewed_at') and clinical_role)

def relationship_gate(edge, audience='elderly', *, conflict=False, source_state='approved', ai_pre_review_status=None):
    """Return display/action capabilities for one relationship.

    AI pre-review can only add a pending reason. It never satisfies clinician approval.
    """
    privileged = str(audience or 'elderly').lower() in PRIVILEGED_AUDIENCES
    relation_type = edge.get('type')
    high_risk = edge.get('strength') == 'high' or relation_type in HIGH_RISK_RELATION_TYPES
    approved = is_clinician_approved(edge)
    reasons = []
    if source_state == 'invalid': reasons.append('source_invalid')
    if conflict: reasons.append('evidence_conflict')
    if high_risk and not approved: reasons.append('clinician_approval_required')
    if edge.get('review_status') in {'pending_medical_review', 'needs_clinician_confirmation'}: reasons.append('pending_medical_review')
    if ai_pre_review_status == 'needs_clinician_confirmation': reasons.append('ai_pre_review_requires_clinician_confirmation')
    reasons = list(dict.fromkeys(reasons))
    safety_only = relation_type in URGENT_SAFETY_TYPES and bool(reasons)
    hard_block = source_state == 'invalid' or conflict or (high_risk and not approved) or ai_pre_review_status == 'needs_clinician_confirmation'
    return {
        'visible': privileged or not hard_block or safety_only,
        'ordinary_action_allowed': not hard_block,
        'diagnostic_or_medication_allowed': not hard_block,
        'safety_only': safety_only,
        'clinician_approved': approved,
        'review_status': 'approved' if approved else 'blocked' if hard_block else 'education_only',
        'reasons': reasons,
    }
DISEASE_ALIASES = {
    'hypertension': ['高血压', '血压'], 'diabetes': ['糖尿病', '血糖'],
    'heart_disease': ['心脏病', '心血管', '胸痛'], 'stroke': ['脑卒中', '中风', '单侧无力'],
    'chronic_kidney_disease': ['慢性肾脏病', '慢性肾病', '肾功能', '肾脏'],
    'frailty': ['老年衰弱', '衰弱', '跌倒风险', '功能下降', '体位性低血压', '营养不良'],
}
ENTITY_TERMS = {
    'measurement': ['血压', '血糖', '血脂', '体重', '活动', '睡眠', '肌酐', 'eGFR', '尿白蛋白'],
    'risk_factor': ['吸烟', '盐', '体重', '血压', '血糖', '血脂', '蛋白尿', '肾功能', '跌倒', '虚弱', '营养不良', '多重用药', '体位性低血压', '社会孤立'],
    'intervention': ['复测', '记录', '减少盐', '活动', '睡眠', '联系家属', '就医', '肾功能检查', '药物复核', '力量和平衡训练', '居家安全'],
    # 同时覆盖指南术语和老人常用口语，避免“叫不醒/胸闷/突然没力气”等急症表达漏检。
    'danger_sign': ['胸痛', '胸闷', '呼吸困难', '气短', '意识改变', '意识模糊', '叫不醒', '昏迷', '昏沉', '单侧无力', '突然没力气', '面歪', '言语不清', '说话含糊', '失语', '晕厥', '严重低血糖'],
    'older_adult_context': ['老年', '虚弱', '跌倒', '认知', '低血糖', '功能状态', '视力', '听力', '抑郁', '照护支持'],
}

ENTITY_LABELS = {
    'disease': '疾病', 'risk_factor': '风险因素', 'metric': '指标',
    'intervention': '干预', 'symptom': '症状', 'complication': '并发症',
    'behavior': '行为', 'population': '人群', 'device': '设备',
    'social_factor': '社会因素', 'care_action': '照护行动', 'evidence_source': '证据来源',
}

# 可审计来源注册表：不复制论文全文，只保存来源定位、证据层级、适用人群和限制。
# 这些条目与 Markdown 知识源一起进入本地索引，后续可由医学审核人员逐条替换为机构 PDF/DOI。
CURATED_SOURCE_FAMILIES = {
    'hypertension': ('高血压', 'WHO/AHA/ESC', 'https://www.who.int/news-room/fact-sheets/detail/hypertension', ['定义与老年特点', '家庭测量与复测', '饮食与盐摄入', '运动与体重', '心脑肾共病', '系统综述与预测因素', '关键随机试验']),
    'diabetes': ('2型糖尿病', 'WHO/ADA', 'https://www.who.int/news-room/fact-sheets/detail/diabetes', ['定义与老年特点', '空腹与餐后血糖', 'HbA1c适用边界', '低血糖与虚弱', '饮食与活动', '系统综述与预测因素', '关键随机试验']),
    'cardiovascular': ('心血管疾病', 'WHO/AHA/ESC', 'https://www.who.int/en/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)', ['共同危险因素', '血脂与血压', '吸烟与饮酒', '运动与饮食模式', '老年共病', '系统综述与预测因素', '关键随机试验']),
    'stroke': ('脑卒中', 'AHA/ASA/WHO', 'https://professional.heart.org/en/science-news/2024-guideline-for-the-primary-prevention-of-stroke/top-things-to-know', ['一级预防', '血压与卒中', '房颤与危险信号', '吸烟与久坐', 'FAST急症识别', '系统综述与预测因素', '关键随机试验']),
    'chronic_kidney_disease': ('慢性肾脏病', 'KDIGO/WHO', 'https://kdigo.org/guidelines/ckd-evaluation-and-management/', ['定义与持续时间', 'eGFR与肌酐', '尿白蛋白', '血压与糖尿病共病', '老年复测边界', '系统综述与预测因素', '关键随机试验']),
    'frailty': ('老年衰弱与跌倒风险', 'WHO/AGS', 'https://www.who.int/news-room/fact-sheets/detail/ageing-and-health', ['衰弱识别', '握力与功能', '跌倒风险', '安全活动与陪同', '营养与蛋白质', '系统综述与预测因素', '关键随机试验']),
}

def curated_source_registry():
    """生成第一批 42 条分层来源摘要；每条均保留公开机构入口，避免伪造论文全文。"""
    records = []
    levels = ['authoritative_guidance', 'professional_guideline', 'systematic_review', 'randomized_trial', 'observational_study', 'professional_statement', 'authoritative_guidance']
    for disease, (name, publisher, url, topics) in CURATED_SOURCE_FAMILIES.items():
        for idx, topic in enumerate(topics):
            source_id = f'{disease}_curated_{idx + 1:02d}'
            records.append({
                'source_id': source_id,
                'title': f'{name}老年人证据摘要：{topic}',
                'publisher': publisher,
                'publication_year': 2025 if idx == 0 else 2024,
                'document_type': 'guideline' if levels[idx] in ('authoritative_guidance', 'professional_guideline', 'professional_statement') else ('systematic_review' if levels[idx] == 'systematic_review' else 'research_summary'),
                'evidence_level': levels[idx],
                'source_url': url,
                'population': 'older_adults',
                'summary': f'围绕{name}的“{topic}”整理可审计的老年人健康管理证据，建议结合个体测量条件、功能状态和医生评估解释。',
                'limitations': '本条为来源摘要，不替代原文；观察性证据仅表示相关或预测因素，不自动推断因果。',
                'review_status': 'pending_medical_review',
            })
    if EVIDENCE_REGISTRY_FILE.exists():
        try:
            explicit = json.loads(EVIDENCE_REGISTRY_FILE.read_text(encoding='utf-8'))
            records.extend(explicit if isinstance(explicit, list) else [])
        except (OSError, json.JSONDecodeError):
            pass
    return records

def parse_metadata(text):
    """读取 Markdown 头部的可审计元数据，不把元数据当作知识正文。"""
    metadata = {}
    header = text.split('\n## ', 1)[0]
    for line in header.splitlines():
        line = line.strip().lstrip('#').strip()
        if ':' not in line: continue
        key, value = line.split(':', 1)
        key, value = key.strip(), value.strip()
        # 兼容旧条目的 source: ...；evidence_level: ... 写法
        parts = re.split(r'[;；]\s*', value)
        metadata[key] = parts[0].strip()
        for part in parts[1:]:
            if ':' in part:
                k, v = part.split(':', 1); metadata[k.strip()] = v.strip()
    return metadata

def entity_from_id(entity_id):
    kind, _, name = entity_id.partition(':')
    return {'id': entity_id, 'type': kind or 'concept', 'name': name, 'label': ENTITY_LABELS.get(kind, kind or '概念')}

def load_relations():
    if not RELATIONS_FILE.exists(): return []
    try: return json.loads(RELATIONS_FILE.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError): return []

def validate_relation(row):
    """关系进入索引前的最小 schema 校验，阻止无出处或未知类型污染图谱。"""
    required = ('source', 'target', 'type', 'evidence', 'strength')
    if any(not row.get(k) for k in required): return False, 'missing_required'
    if row.get('strength') not in ('high', 'moderate', 'low'): return False, 'invalid_strength'
    allowed = {
        'has_risk_factor', 'has_nonmodifiable_factor', 'measured_by', 'monitoring_signal',
        'coexists_with', 'increases_risk_of', 'major_preventable_driver', 'managed_by',
        'prevention_evidence', 'supportive_evidence', 'urgent_signal', 'contextual_factor',
        'predictive_factor_in_older_adults', 'may_improve', 'complicates', 'shares_risk_factor_with',
        'may_lead_to', 'differential_from', 'associated_with', 'threshold_contextualized_by',
        'trend_signal_for', 'modifiable_by', 'amplifies_risk_with', 'protective_against',
        'recommended_for', 'not_sufficient_alone_for', 'requires_clinician_review',
        'contraindicated_or_caution', 'emergency_action', 'requires_remeasurement',
        'requires_medical_review', 'do_not_self_adjust_medication', 'reduces_risk_or_supports_control',
        'cardiovascular_context_factor',
    }
    if row.get('type') not in allowed: return False, 'unknown_relation_type'
    if row.get('evidence_level') and row['evidence_level'] not in EVIDENCE_LEVELS: return False, 'invalid_evidence_level'
    return True, ''

def detect_evidence_conflicts(relationships):
    """发现同一实体对上的互斥语义或因果口径冲突，宁可降权也不静默合并。"""
    contradiction_pairs = {
        frozenset({'increases_risk_of', 'protective_against'}),
        frozenset({'managed_by', 'contraindicated_or_caution'}),
        frozenset({'recommended_for', 'not_sufficient_alone_for'}),
    }
    by_pair = {}
    for index, edge in enumerate(relationships):
        by_pair.setdefault((edge.get('source'), edge.get('target')), []).append((index, edge))
    conflicts = []
    for pair, rows in by_pair.items():
        types = {edge.get('type') for _, edge in rows}
        for combo in contradiction_pairs:
            if combo.issubset(types):
                conflicts.append({'source': pair[0], 'target': pair[1], 'kind': 'contradictory_relation_types',
                                  'types': sorted(combo), 'relation_indices': [i for i, e in rows if e.get('type') in combo],
                                  'resolution': 'medical_review_required_and_exclude_from_elderly_answer'})
        causal_statuses = {edge.get('causal_status') for _, edge in rows if edge.get('causal_status')}
        if len(causal_statuses) > 1 and 'causal' in causal_statuses and ('association' in causal_statuses or 'unknown' in causal_statuses):
            conflicts.append({'source': pair[0], 'target': pair[1], 'kind': 'causal_status_conflict',
                              'statuses': sorted(causal_statuses), 'relation_indices': [i for i, e in rows],
                              'resolution': 'retain_association_wording_until_medical_review'})
    return conflicts

def relation_chunk_id(evidence, chunks):
    if not evidence: return None
    source, _, section = str(evidence).partition('#')
    for chunk in chunks:
        if chunk['source'] == source and (not section or chunk['section'] == section): return chunk['id']
    return None

def canonical_disease(stem):
    """把不同来源文件映射到统一疾病节点，保留 source 文件名用于审计。"""
    name = stem.lower()
    if 'hypertension' in name or 'sprint' in name: return 'hypertension'
    if 'diabetes' in name or 'ada_' in name or 'dpp' in name: return 'diabetes'
    if 'stroke' in name: return 'stroke'
    if 'kidney' in name or 'ckd' in name or 'kdigo' in name: return 'chronic_kidney_disease'
    if 'frailty' in name or 'elderly_frailty' in name or 'icope' in name or 'steadi' in name or 'vision_falls' in name: return 'frailty'
    if 'sleep_brain' in name or 'stroke' in name: return 'stroke'
    if 'cvd' in name or 'cardiovascular' in name or 'lifes_essential' in name: return 'cardiovascular'
    return stem

def discover_hidden_relationships(relationships):
    """发现缺少直接边的两跳桥接路径；输出审核候选，绝不自动生成新的医学事实。"""
    excluded = {'mentions', 'supportive_evidence'}
    edges = [r for r in relationships if r.get('type') not in excluded and r.get('source') and r.get('target') and r.get('evidence')]
    direct = {(r['source'], r['target']) for r in edges}
    by_source = {}
    for edge in edges: by_source.setdefault(edge['source'], []).append(edge)
    strength_score = {'high': 3, 'moderate': 2, 'low': 1, None: 0}
    candidates, seen = [], set()
    for first in edges:
        bridge = first['target']
        for second in by_source.get(bridge, []):
            source, target = first['source'], second['target']
            if source == target or (source, target) in direct: continue
            if source.startswith('evidence_source:') or target.startswith('evidence_source:'): continue
            key = (source, bridge, target, first['type'], second['type'])
            if key in seen: continue
            seen.add(key)
            evidence = [first.get('evidence'), second.get('evidence')]
            distinct_sources = len({str(item).split('#', 1)[0] for item in evidence})
            score = strength_score.get(first.get('strength'), 0) + strength_score.get(second.get('strength'), 0) + (1 if distinct_sources > 1 else 0)
            candidates.append({
                'source': source, 'bridge': bridge, 'target': target,
                'path': [
                    {'source': source, 'type': first['type'], 'target': bridge, 'strength': first.get('strength'), 'evidence': first.get('evidence'), 'causal_status': first.get('causal_status')},
                    {'source': bridge, 'type': second['type'], 'target': target, 'strength': second.get('strength'), 'evidence': second.get('evidence'), 'causal_status': second.get('causal_status')},
                ],
                'score': score, 'evidence_source_count': distinct_sources,
                'inference_status': 'candidate_for_clinician_review',
                'allowed_expression': f'{source} 可通过 {bridge} 与 {target} 形成一条两跳证据链；这只是待审核的关联线索，不是新因果结论。',
                'review_status': 'pending_medical_review',
            })
    candidates.sort(key=lambda row: (-row['score'], -row['evidence_source_count'], row['source'], row['bridge'], row['target']))
    return candidates[:250]

def tokenize(text):
    """中文按知识词表+二字片段切分，避免整句中文被当成一个 token。"""
    text = (text or '').lower()
    terms = set(re.findall(r'[a-zA-Z]{3,}', text))
    for term in sorted({x for xs in DISEASE_ALIASES.values() for x in xs} | {x for xs in ENTITY_TERMS.values() for x in xs}, key=len, reverse=True):
        if term in text: terms.add(term)
    han = ''.join(re.findall(r'[\u4e00-\u9fff]', text))
    terms.update(han[i:i+2] for i in range(max(0, len(han)-1)))
    return terms

def write_generated_index_stats(stats, output_path=None, report_path=None, update_docs=False):
    """Write stats to an explicit target; documentation updates are opt-in."""
    output_dir = Path(output_path) if output_path else OUTPUT
    payload = {'schema_version': 'graphrag-index-stats.v1', 'generated_at': '2026-08-26', **stats}
    target = Path(report_path) if report_path else output_dir / 'index_stats.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    if not update_docs:
        return
    summary = (f"索引 `{stats['index_version']}`：{stats['sources']} 个可审计来源、"
               f"{stats['chunks']} 个分块、{stats['entities']} 个实体、"
               f"{stats['relationships']} 条关系、{stats['communities']} 个疾病社区、"
               f"{stats['hidden_relationship_candidates']} 条待审核关系候选。")
    block = f"<!-- GRAPHRAG_STATS:START -->\n{summary}\n\n> 此段由 `output/index_stats.json` 在 `python graphrag_index.py build` 时自动生成，请勿手写统计。\n<!-- GRAPHRAG_STATS:END -->"
    for document in (ROOT / 'README.md', ROOT / 'PRODUCTION_ARCHITECTURE.md'):
        if not document.exists(): continue
        text = document.read_text(encoding='utf-8')
        pattern = r'<!-- GRAPHRAG_STATS:START -->.*?<!-- GRAPHRAG_STATS:END -->'
        if re.search(pattern, text, flags=re.S):
            text = re.sub(pattern, block, text, flags=re.S)
        else:
            text = text.rstrip() + '\n\n' + block + '\n'
        document.write_text(text, encoding='utf-8')

def assess_uncertainty(results, context, relevant_conflicts=None, blocked_edge_count=0):
    """`uncertainty.level` is directional: more uncertainty means a higher level."""
    relevant_conflicts = relevant_conflicts or []
    reasons = []
    quality = (context or {}).get('data_completeness') or {}
    evidence_scores = [EVIDENCE_LEVELS.get(x.get('evidence_level'), 0) for x in results]
    if not results: reasons.append('未召回足够证据')
    if not (context or {}).get('latest'): reasons.append('缺少用户近期指标')
    if relevant_conflicts: reasons.append('相关证据存在冲突')
    if blocked_edge_count: reasons.append('部分关系因医学门控未进入普通回答')
    if quality.get('quality_flags'): reasons.append('存在测量质量标记')
    if quality.get('measurement_condition_missing'): reasons.append('部分记录缺少测量条件')
    if not results or relevant_conflicts:
        level = 'high'
    elif not (context or {}).get('latest') or quality.get('quality_flags') or quality.get('measurement_condition_missing') or blocked_edge_count:
        level = 'medium'
    elif evidence_scores and max(evidence_scores) >= 3:
        level = 'low'
    else:
        level = 'medium'
    confidence_score = {'low': 0.84, 'medium': 0.58, 'high': 0.25}[level]
    return {'level': level, 'reasons': reasons}, {
        'level': {'low': 'high', 'medium': 'medium', 'high': 'low'}[level],
        'score': confidence_score,
        'basis': 'inverse_of_uncertainty',
    }

def apply_action_gates(items, gates_by_evidence):
    """Downgrade relationship-derived actions when their evidence is not clinically admitted."""
    gated, seen_confirmation = [], False
    for item in items:
        gate = gates_by_evidence.get(item.get('evidence'))
        if not gate or item.get('priority') == 'urgent':
            gated.append(dict(item, gate_status='safety_only' if gate else 'allowed'))
            continue
        if seen_confirmation: continue
        seen_confirmation = True
        gated.append({
            **item,
            'action': '请把相关记录和证据交给医生确认；确认前不要据此自行改变治疗或用药。',
            'reason': '该行动所依据的高风险关系尚未完成医生审核，不能作为普通行动输出。',
            'requires_confirmation': True,
            'action_type': 'contact_doctor',
            'gate_status': 'blocked_pending_clinician_review',
            'gate_reasons': gate['reasons'],
        })
    return gated

def build(output_path=None, report_path=None, update_docs=False):
    output_dir = Path(output_path) if output_path else OUTPUT
    chunks, entities, relationships = [], {}, []
    source_manifest = []
    invalid_relations = []
    for path in sorted(INPUT.glob('*.md')):
        text = path.read_text(encoding='utf-8')
        metadata = parse_metadata(text)
        source_manifest.append({'file': path.name, 'source_id': path.stem, 'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
                                'source_url': metadata.get('source_url', ''), 'publisher': metadata.get('publisher', metadata.get('source', '')),
                                'publication_year': metadata.get('publication_year', ''), 'document_type': metadata.get('document_type', 'guideline_note'),
                                'evidence_level': metadata.get('evidence_level', 'public_guidance'),
                                'review_status': metadata.get('review_status', '演示知识，需医学审核后生产使用'),
                                'version': metadata.get('version', f"{metadata.get('publication_year', 'undated')}.source"),
                                'population': metadata.get('population', 'older_adults_contextualized'),
                                'limitations': metadata.get('limitations', '来源摘要，不能替代原文或个体医学判断。'),
                                'retrieved_at': metadata.get('retrieved_at', '2026-08-21'),
                                'index_version': INDEX_VERSION})
        sections = re.split(r'\n(?=## )', text.split('\n## ', 1)[-1] if '\n## ' in text else text)
        disease = canonical_disease(path.stem)
        for idx, section in enumerate(sections):
            lines = section.strip().splitlines()
            if not lines: continue
            title = lines[0].lstrip('# ').strip()
            body = '\n'.join(lines[1:]).strip()
            if not body or title.startswith('source:'): continue
            cid = f'{path.stem}:{idx}'
            chunk = {'id': cid, 'disease': disease, 'section': title, 'text': body,
                     'source': path.name, 'citation': f'{path.name}#{title}',
                     'source_id': path.stem,
                     'source_version': metadata.get('version', f"{metadata.get('publication_year', 'undated')}.source"),
                     'retrieved_at': metadata.get('retrieved_at', '2026-08-21'),
                     'evidence_level': metadata.get('evidence_level', 'public_guidance'),
                     'publisher': metadata.get('publisher', metadata.get('source', '')),
                     'publication_year': metadata.get('publication_year', ''), 'source_url': metadata.get('source_url', ''),
                     'review_status': metadata.get('review_status', 'pending_medical_review'),
                     'tokens': sorted(tokenize(body))}
            chunks.append(chunk)
            dkey = f'disease:{disease}'
            entities[dkey] = {'id': dkey, 'type': 'disease', 'name': disease}
            for etype, terms in ENTITY_TERMS.items():
                for term in terms:
                    if term in body:
                        key = f'{etype}:{term}'
                        entities[key] = {'id': key, 'type': etype, 'name': term}
                        relationships.append({'source': dkey, 'target': key, 'type': 'mentions', 'chunk_id': cid, 'evidence': f'{path.name}#{title}'})
    # 注册表条目作为“来源摘要块”参与召回，保留原文 URL、证据等级和限制条件。
    for record in curated_source_registry():
        disease = record.get('disease') or next((d for d, (name, *_rest) in CURATED_SOURCE_FAMILIES.items() if record['title'].startswith(name)), 'hypertension')
        source_name = f"registry:{record['source_id']}"
        source_text = f"{record['summary']}\n适用人群：{record['population']}。\n限制条件：{record['limitations']}"
        cid = f"{source_name}:0"
        chunks.append({'id': cid, 'disease': disease, 'section': record['title'], 'text': source_text,
                       'source': source_name, 'citation': f"{source_name}#{record['title']}",
                       'source_id': record['source_id'],
                       'source_version': record.get('version', f"{record['publication_year']}.registry"),
                       'retrieved_at': record.get('retrieved_at', '2026-08-23'),
                       'evidence_level': record['evidence_level'], 'publisher': record['publisher'],
                       'publication_year': record['publication_year'], 'source_url': record['source_url'],
                       'review_status': record.get('review_status', 'pending_medical_review'),
                       'tokens': sorted(tokenize(source_text))})
        dkey = f'disease:{disease}'
        entities[dkey] = {'id': dkey, 'type': 'disease', 'name': disease}
        skey = f"evidence_source:{record['source_id']}"
        entities[skey] = {'id': skey, 'type': 'evidence_source', 'name': record['title'], 'source_url': record['source_url'], 'publisher': record['publisher']}
        relationships.append({'source': dkey, 'target': skey, 'type': 'supportive_evidence', 'strength': 'high' if record['evidence_level'] in ('authoritative_guidance', 'professional_guideline', 'professional_statement') else 'moderate',
                              'evidence_level': record['evidence_level'], 'causal_status': 'guidance', 'population': record['population'],
                              'condition': 'must_read_source_summary_with_limitations', 'chunk_id': cid,
                              'evidence': f"{source_name}#{record['title']}", 'source_url': record['source_url'],
                              'review_status': record['review_status'], 'last_verified': '2026-08-20'})
    # 显式关系是图谱的主干：疾病、风险因素、指标、并发症和干预之间的边必须带出处和强度。
    for row in load_relations():
        valid, reason = validate_relation(row)
        if not valid:
            invalid_relations.append({'row': row, 'reason': reason})
            continue
        for entity_id in (row['source'], row['target']):
            if entity_id not in entities: entities[entity_id] = entity_from_id(entity_id)
        rel = dict(row)
        rel['chunk_id'] = relation_chunk_id(row.get('evidence'), chunks)
        rel.setdefault('evidence_level', next((c['evidence_level'] for c in chunks if c['id'] == rel['chunk_id']), 'public_guidance'))
        rel.setdefault('causal_status', 'association' if rel['type'] in ('associated_with', 'predictive_factor_in_older_adults') else 'guidance')
        rel.setdefault('population', 'older_adults')
        rel.setdefault('age_scope', '65+')
        rel.setdefault('time_horizon', 'current_monitoring')
        rel.setdefault('source_url', next((c.get('source_url') for c in chunks if c['id'] == rel['chunk_id']), ''))
        rel.setdefault('evidence_ids', [rel.get('evidence')])
        rel.setdefault('review_status', 'pending_medical_review')
        rel.setdefault('last_verified', '2026-08-20')
        relationships.append(rel)
    for ent in entities.values():
        ent['chunk_ids'] = sorted({r['chunk_id'] for r in relationships if r.get('chunk_id') and (r.get('target') == ent['id'] or r.get('source') == ent['id'])})
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir/'chunks.json').write_text(json.dumps(chunks, ensure_ascii=False, indent=2), encoding='utf-8')
    (output_dir/'entities.json').write_text(json.dumps(list(entities.values()), ensure_ascii=False, indent=2), encoding='utf-8')
    (output_dir/'relationships.json').write_text(json.dumps(relationships, ensure_ascii=False, indent=2), encoding='utf-8')
    hidden_relationships = discover_hidden_relationships(relationships)
    (output_dir/'hidden_relationship_candidates.json').write_text(json.dumps({
        'schema_version': 'hidden-relationship-candidate.v1', 'index_version': INDEX_VERSION,
        'generated_at': '2026-08-26', 'candidate_count': len(hidden_relationships),
        'policy': '仅供医生或审计人员复核；两跳路径不得自动改写为因果或进入老人行动建议。',
        'candidates': hidden_relationships,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    evidence_conflicts = detect_evidence_conflicts(relationships)
    (output_dir/'evidence_conflicts.json').write_text(json.dumps({
        'schema_version': 'evidence-conflict.v1', 'index_version': INDEX_VERSION,
        'checked_relationships': len(relationships), 'conflict_count': len(evidence_conflicts),
        'conflicts': evidence_conflicts,
        'policy': '冲突关系进入医生审核，老人端不直接使用冲突结论。'
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    # 高风险关系必须显式进入医学审核队列，不能只依赖关系对象的默认字段。
    review_rows = []
    for relation_index, rel in enumerate(relationships):
        if rel.get('strength') == 'high' or rel.get('type') in HIGH_RISK_RELATION_TYPES:
            review_rows.append({
                'relation_index': relation_index,
                'source': rel.get('source'), 'target': rel.get('target'),
                'type': rel.get('type'), 'strength': rel.get('strength'),
                'evidence': rel.get('evidence'),
                'evidence_level': rel.get('evidence_level'),
                'review_status': rel.get('review_status') or 'pending_medical_review',
                'required_reviewer_role': 'geriatric_or_primary_care_clinician',
                'reviewer_role': rel.get('reviewer_role'),
                'review_reason': '高风险关系进入老人端建议或安全过滤前必须完成医学审核',
                'last_verified': rel.get('last_verified'),
                'reviewer_name_or_id': rel.get('reviewer_name_or_id') or rel.get('reviewed_by') or rel.get('reviewer_id'),
                'reviewed_at': rel.get('reviewed_at'),
                'decision_rationale': rel.get('decision_rationale'),
                'population_scope': rel.get('population_scope'),
                'allowed_audience': rel.get('allowed_audience'),
                'conditions_or_exceptions': rel.get('conditions_or_exceptions'),
                'source_version_checked': rel.get('source_version_checked'),
            })
    (output_dir/'relation_review_manifest.json').write_text(json.dumps({
        'schema_version': 'relation-review.v1', 'index_version': INDEX_VERSION,
        'generated_at': '2026-08-26', 'policy': 'high_strength_or_safety_relation',
        'statuses': {'pending_medical_review': sum(r['review_status'] == 'pending_medical_review' for r in review_rows),
                     'approved': sum(r['review_status'] == 'approved' for r in review_rows),
                     'rejected': sum(r['review_status'] == 'rejected' for r in review_rows)},
        'relations': review_rows
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    communities = []
    for disease in DISEASE_ALIASES:
        ids = [e['id'] for e in entities.values() if e['id'] == f'disease:{disease}' or e['id'] in {r['target'] for r in relationships if r['source'] == f'disease:{disease}'}]
        communities.append({'id': f'community:{disease}', 'disease': disease, 'entity_ids': sorted(ids), 'entity_count': len(ids), 'chunk_count': len([c for c in chunks if c['disease'] == disease])})
    (output_dir/'communities.json').write_text(json.dumps(communities, ensure_ascii=False, indent=2), encoding='utf-8')
    for record in curated_source_registry():
        source_manifest.append({'file': f"registry:{record['source_id']}", 'source_id': record['source_id'],
                                'sha256': hashlib.sha256(json.dumps(record, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest(),
                                'source_url': record['source_url'], 'publisher': record['publisher'],
                                'publication_year': record['publication_year'], 'document_type': record['document_type'],
                                'evidence_level': record['evidence_level'], 'review_status': record['review_status'],
                                'version': record.get('version', f"{record['publication_year']}.registry"),
                                'population': record.get('population', 'older_adults'),
                                'limitations': record.get('limitations', '来源摘要，不能替代原文或个体医学判断。'),
                                'retrieved_at': record.get('retrieved_at', '2026-08-23'),
                                'index_version': INDEX_VERSION})
    (output_dir/'source_manifest.json').write_text(json.dumps({'index_version': INDEX_VERSION, 'generated_at': '2026-08-26', 'sources': source_manifest, 'invalid_relations': invalid_relations}, ensure_ascii=False, indent=2), encoding='utf-8')
    stats = {'index_version': INDEX_VERSION, 'chunks': len(chunks), 'entities': len(entities), 'relationships': len(relationships), 'hidden_relationship_candidates': len(hidden_relationships), 'communities': len(communities), 'sources': len(source_manifest), 'invalid_relations': len(invalid_relations)}
    write_generated_index_stats(stats, output_dir, report_path, update_docs)
    return stats

def build_retrieval_index(vector_model='hashing_char_ngram_v1', output_path=None):
    if not (OUTPUT / 'chunks.json').exists(): build()
    chunks = _index_json(OUTPUT / 'chunks.json', [])
    target = Path(output_path) if output_path else OUTPUT / 'dense_index.json'
    result = DenseVectorRetriever.build_index(chunks, target, vector_model)
    return {'index_version': INDEX_VERSION, 'stage': 'dense_vector', **result}

def query(question, disease=None, top_k=4, options=None):
    options = options or {}
    output_dir = Path(options.get('output_path') or os.environ.get('GRAPHRAG_OUTPUT_PATH') or OUTPUT)
    if not (output_dir/'chunks.json').exists(): build(output_dir)
    chunks = _index_json(output_dir/'chunks.json', [])
    source_manifest = _index_json(output_dir/'source_manifest.json', {'sources': []})
    source_status_by_key = {}
    source_metadata_by_key = {}
    for source in source_manifest.get('sources', []):
        status = source.get('review_status', '')
        for key in (source.get('file'), source.get('source_id'), f"registry:{source.get('source_id')}"):
            if key:
                source_status_by_key[str(key)] = status
                source_metadata_by_key[str(key)] = source
    enriched_chunks = []
    for chunk in chunks:
        metadata = source_metadata_by_key.get(str(chunk.get('source')), {})
        enriched_chunks.append(dict(chunk,
            source_id=chunk.get('source_id') or metadata.get('source_id') or str(chunk.get('source', '')).replace('.md', ''),
            source_version=chunk.get('source_version') or metadata.get('version'),
            retrieved_at=chunk.get('retrieved_at') or metadata.get('retrieved_at')))
    chunks = enriched_chunks
    relationships = _index_json(output_dir/'relationships.json', [])
    relationships = [dict(row, _relation_index=index) for index, row in enumerate(relationships)]
    evidence_conflicts = _index_json(output_dir/'evidence_conflicts.json', {'conflicts': []})
    medical_pre_review = _index_json(output_dir/'medical_pre_review.json', {'relations': [], 'counts': {}})
    hidden_manifest = _index_json(output_dir/'hidden_relationship_candidates.json', {'candidates': []})
    pre_review_by_index = {row.get('relation_index'): row for row in medical_pre_review.get('relations', [])}
    entities = {e['id']: e for e in _index_json(output_dir/'entities.json', [])}
    qtokens = tokenize(question)
    aliases = set(DISEASE_ALIASES.get(disease or '', []))
    graph_seeds = {f'disease:{disease}'} if disease else set()
    # 中文问题使用别名时也要落到英文规范疾病节点，才能跨疾病检索关系边。
    for disease_id, aliases_for_disease in DISEASE_ALIASES.items():
        if any(alias in question for alias in aliases_for_disease): graph_seeds.add(f'disease:{disease_id}')
    relation_query = bool(re.search(r'关系|相关|影响|共同|并发|导致|关联|之间', question))
    related_diseases = {x.split(':', 1)[1] for x in graph_seeds if x.startswith('disease:')}
    # 图扩展种子只允许来自明确疾病实体，或后续检索命中的 chunk 实体。
    options = options or {}
    audience = str(options.get('audience', 'elderly') or 'elderly').lower()
    source_gate = str(options.get('source_gate', 'flag_legacy_pending') or 'flag_legacy_pending')
    max_hops = max(1, min(2, int(options.get('max_hops', 2) or 2)))
    try:
        source_review_penalty_value = float(options.get('source_review_penalty', os.environ.get('GRAPHRAG_SOURCE_REVIEW_PENALTY', 2.0)))
    except (TypeError, ValueError):
        source_review_penalty_value = 2.0
    source_review_penalty_value = max(0.0, min(20.0, source_review_penalty_value))
    def chunk_review_status(chunk):
        return chunk.get('review_status') or source_status_by_key.get(chunk.get('source'), '')
    def chunk_is_legacy_pending(chunk):
        return is_legacy_pending_status(chunk_review_status(chunk))
    chunk_by_id = {c.get('id'): c for c in chunks}
    def edge_is_legacy_pending(edge):
        chunk = chunk_by_id.get(edge.get('chunk_id'))
        return bool(chunk and chunk_is_legacy_pending(chunk))
    def edge_source_state(edge):
        chunk = chunk_by_id.get(edge.get('chunk_id'))
        return source_review_state(chunk_review_status(chunk)) if chunk else source_review_state(edge.get('source_review_status'))
    contradiction_pairs = {frozenset({'increases_risk_of', 'protective_against'}), frozenset({'managed_by', 'contraindicated_or_caution'}), frozenset({'recommended_for', 'not_sufficient_alone_for'})}
    pair_types = {}
    for edge in relationships:
        pair_types.setdefault((edge.get('source'), edge.get('target')), set()).add(edge.get('type'))
    conflict_pairs = {pair for pair, types in pair_types.items() if any(combo.issubset(types) for combo in contradiction_pairs)}
    source_gate_enabled = source_gate == 'exclude_legacy_pending' and audience not in {'doctor', 'clinician', 'audit'}
    source_flag_enabled = source_gate in {'flag_legacy_pending', 'exclude_legacy_pending'} and audience not in {'doctor', 'clinician', 'audit'}
    # 有界 BFS 图扩展：默认一到两跳，避免把远距离的关系链直接变成老人建议。
    expanded_nodes = set(graph_seeds)
    frontier = set(graph_seeds)
    node_hops = {node: 0 for node in graph_seeds}
    for _ in range(max_hops):
        adjacent = {r.get('source') for r in relationships if r.get('target') in frontier} | {r.get('target') for r in relationships if r.get('source') in frontier}
        adjacent.discard(None)
        adjacent -= expanded_nodes
        expanded_nodes |= adjacent
        for node in adjacent: node_hops[node] = node_hops.get(node, _ + 1)
        frontier = adjacent
        if not frontier: break
    def edge_allowed_for_audience(edge):
        # 医生/审计可见不等于可自动生成行动；统一矩阵在 relationship_gate 中判定。
        if audience in PRIVILEGED_AUDIENCES: return True
        if source_gate_enabled and edge_is_legacy_pending(edge):
            return False
        pre_status = pre_review_by_index.get(edge.get('_relation_index'), {}).get('ai_pre_review_status')
        gate = relationship_gate(edge, audience, conflict=(edge.get('source'), edge.get('target')) in conflict_pairs,
                                 source_state=edge_source_state(edge), ai_pre_review_status=pre_status)
        return gate['visible']
    direct_edges = [r for r in relationships if (r.get('source') in graph_seeds or r.get('target') in graph_seeds) and edge_allowed_for_audience(r)]
    graph_edges = [r for r in relationships if (r.get('source') in expanded_nodes or r.get('target') in expanded_nodes) and edge_allowed_for_audience(r)]
    blocked_edge_count = sum(1 for r in relationships if (r.get('source') in expanded_nodes or r.get('target') in expanded_nodes) and not edge_allowed_for_audience(r))
    # 从用户上下文生成第二组种子：只要指标/行为确实出现在账户里，相关边在证据排序中优先，
    # 避免“高血压”问题被整张共病网络淹没。
    contextual_nodes = set()
    for metric_type in (context := globals().get('_QUERY_CONTEXT', {}) or {}).get('latest', {}) or {}:
        contextual_nodes.add(f'metric:{metric_type}')
    profile = context.get('profile') or {}
    if profile.get('smoking_status') not in (None, '', 0, '0', False): contextual_nodes.add('risk_factor:tobacco')
    if isinstance(profile.get('exercise_level'), (int, float)) and profile.get('exercise_level') < 60: contextual_nodes.add('risk_factor:physical_inactivity')
    if profile.get('fall_risk') in (1, '1', True): contextual_nodes.add('population:frail_older_adults')
    graph_chunk_ids = {r.get('chunk_id') for r in graph_edges if r.get('chunk_id')}
    excluded_legacy_chunks = 0
    excluded_invalid_chunks = 0
    retrieval_chunks = []
    for c in chunks:
        if source_review_state(chunk_review_status(c)) == 'invalid' and audience not in PRIVILEGED_AUDIENCES:
            excluded_invalid_chunks += 1
            continue
        if source_gate_enabled and chunk_is_legacy_pending(c):
            excluded_legacy_chunks += 1
            continue
        if disease and c['disease'] != disease and not (disease in ('heart_disease', 'stroke') and c['disease'] == 'cardiovascular'):
            # 关系型问题允许把图中相邻疾病的权威证据带入结果，避免只回答单病种模板。
            if not relation_query or c['disease'] not in related_diseases: continue
        retrieval_chunks.append(c)
    requested_backend = str(options.get('backend', 'local_hybrid') or 'local_hybrid')
    vector_model = str(options.get('vector_model') or os.environ.get('GRAPHRAG_VECTOR_MODEL') or 'disabled')
    vector_index = options.get('vector_index') or os.environ.get('GRAPHRAG_VECTOR_INDEX') or str(output_dir / 'dense_index.json')
    reranker_model = str(options.get('reranker_model') or os.environ.get('GRAPHRAG_RERANKER_MODEL') or 'disabled')
    backend_stages = {
        'bm25': (True, False, False, False),
        'dense': (False, True, False, False),
        'dense_rag': (False, True, False, False),
        'bm25_dense': (True, True, False, False),
        'bm25_dense_reranker': (True, True, False, True),
        'graph_ablation': (True, True, False, True),
        'full_hybrid': (True, True, True, True),
        'full_graphrag': (True, True, True, True),
        'graphrag': (True, True, True, True),
        'local_hybrid': (True, False, True, False),
    }
    use_lexical, use_vector, use_graph, use_reranker = backend_stages.get(requested_backend, backend_stages['local_hybrid'])
    safe_graph_relationships = [edge for edge in relationships if edge_allowed_for_audience(edge)]
    graph_store = JsonGraphStore(list(entities.values()), safe_graph_relationships)
    pipeline = HybridRetrievalPipeline(retrieval_chunks, graph_store, vector_model, vector_index, reranker_model,
                                       int(options.get('rrf_k', 60) or 60))
    pipeline_result = pipeline.search(question, top_k=max(top_k, 10), candidate_k=max(top_k * 6, 30),
        filters={'audience': audience, 'review_status': options.get('review_status'),
                 'published_after': options.get('published_after'), 'published_before': options.get('published_before')},
        use_lexical=use_lexical, use_vector=use_vector, use_graph=use_graph, use_reranker=use_reranker,
        disease=disease, max_hops=max_hops, max_graph_nodes=min(100, int(options.get('max_graph_nodes', 40) or 40)),
        max_graph_edges=min(160, int(options.get('max_graph_edges', 60) or 60)),
        allowed_node_types=options.get('allowed_node_types'), allowed_relation_types=options.get('allowed_relation_types'))
    if pipeline_result['graph'].get('seed_entities'):
        graph_seeds = set(pipeline_result['graph']['seed_entities'])
        expanded_nodes = graph_seeds | set(pipeline_result['graph'].get('expanded_nodes', []))
        node_hops = {node: 0 for node in graph_seeds}
        graph_edges = []
        for expanded_edge in pipeline_result['graph'].get('edges', []):
            edge = {key: value for key, value in expanded_edge.items() if key not in {'relation_index', 'hop'}}
            graph_edges.append(edge)
            hop = int(expanded_edge.get('hop', max_hops))
            for node in (edge.get('source'), edge.get('target')):
                if node not in graph_seeds: node_hops[node] = min(node_hops.get(node, hop), hop)
        direct_edges = [edge for edge in graph_edges if edge.get('source') in graph_seeds or edge.get('target') in graph_seeds]
        blocked_edge_count = sum(1 for edge in relationships if (edge.get('source') in expanded_nodes or edge.get('target') in expanded_nodes) and not edge_allowed_for_audience(edge))
    ranked_chunks = pipeline_result['results']
    ranked_chunks.sort(key=lambda c: (c['stage_scores']['final_rank']
        + (source_review_penalty_value if source_review_state(chunk_review_status(c)) in {'legacy_pending', 'pending', 'unknown'} else 0)
        + (2 if str(c.get('source', '')).startswith('registry:') else 0), c['id']))
    results = []
    for final_rank, c in enumerate(ranked_chunks[:top_k], 1):
        c['stage_scores']['final_rank'] = final_rank
        support = [r for r in graph_edges if r.get('chunk_id') == c['id']]
        results.append({'source_id': c.get('source_id'), 'chunk_id': c['id'], 'source_version': c.get('source_version'), 'retrieved_at': c.get('retrieved_at'), 'disease': c['disease'], 'section': c['section'], 'text': c['text'], 'source': c['source'], 'citation': c['citation'], 'evidence_level': c['evidence_level'], 'publisher': c.get('publisher', ''), 'publication_year': c.get('publication_year', ''), 'source_url': c.get('source_url', ''), 'review_status': chunk_review_status(c), 'source_review_state': source_review_state(chunk_review_status(c)), 'source_review_required': bool(source_flag_enabled and chunk_is_legacy_pending(c)), 'source_review_penalty': source_review_penalty_value if source_review_state(chunk_review_status(c)) in {'legacy_pending', 'pending', 'unknown'} else 0, 'score': round(1 / final_rank, 6), 'stage_scores': c['stage_scores'], 'graph_support': [{'type': r.get('type'), 'target': r.get('target'), 'strength': r.get('strength'), 'evidence': r.get('evidence'), 'evidence_ids': r.get('evidence_ids') or [r.get('evidence')], 'conflict': (r.get('source'), r.get('target')) in conflict_pairs, 'ai_pre_review_status': pre_review_by_index.get(r.get('_relation_index'), {}).get('ai_pre_review_status'), 'gate': relationship_gate(r, audience, conflict=(r.get('source'), r.get('target')) in conflict_pairs, source_state=edge_source_state(r), ai_pre_review_status=pre_review_by_index.get(r.get('_relation_index'), {}).get('ai_pre_review_status'))} for r in support]})
    context = globals().get('_QUERY_CONTEXT', {}) or {}
    recommendations = derive_recommendations(disease, context, question)
    action_gates = {}
    for edge in relationships:
        gate = relationship_gate(edge, audience,
            conflict=(edge.get('source'), edge.get('target')) in conflict_pairs,
            source_state=edge_source_state(edge),
            ai_pre_review_status=pre_review_by_index.get(edge.get('_relation_index'), {}).get('ai_pre_review_status'))
        if not gate['ordinary_action_allowed'] and edge.get('evidence'):
            action_gates.setdefault(edge.get('evidence'), gate)
    recommendations = apply_action_gates(recommendations, action_gates)
    weekly_plan = apply_action_gates(derive_weekly_plan(disease, context, recommendations), action_gates)
    relation_priority = {'urgent_signal': 6, 'emergency_action': 6, 'requires_medical_review': 6, 'requires_remeasurement': 5, 'measured_by': 5, 'monitoring_signal': 5, 'increases_risk_of': 4, 'coexists_with': 4, 'has_risk_factor': 4, 'managed_by': 4, 'prevention_evidence': 3, 'supportive_evidence': 3, 'mentions': 0}
    def edge_score(edge):
        direct = 2 if edge in direct_edges else 0
        lexical = len(tokenize(f"{edge.get('source','')} {edge.get('target','')} {edge.get('evidence','')}") & qtokens)
        contextual = 3 if edge.get('source') in contextual_nodes or edge.get('target') in contextual_nodes else 0
        conflict = -5 if (edge.get('source'), edge.get('target')) in conflict_pairs else 0
        return (contextual + direct + relation_priority.get(edge.get('type'), 1) + lexical * 0.2 + conflict,
                edge.get('strength') == 'high', edge.get('type') != 'mentions')
    graph_edges = sorted(graph_edges, key=edge_score, reverse=True)
    explicit_edges = [r for r in graph_edges if r.get('type') != 'mentions']
    visible_edges = explicit_edges if explicit_edges else graph_edges
    def edge_hop(edge):
        # 边两端到查询种子的最小距离；这样二跳关系不会被误标成一跳。
        distances = [node_hops.get(edge.get('source')), node_hops.get(edge.get('target'))]
        known = [x for x in distances if x is not None]
        return min(known) if known else max_hops
    def edge_gate(edge):
        return relationship_gate(edge, audience,
            conflict=(edge.get('source'), edge.get('target')) in conflict_pairs,
            source_state=edge_source_state(edge),
            ai_pre_review_status=pre_review_by_index.get(edge.get('_relation_index'), {}).get('ai_pre_review_status'))
    graph_context = [{'source': r.get('source'), 'target': r.get('target'), 'type': r.get('type'), 'strength': r.get('strength'), 'evidence': r.get('evidence'), 'evidence_ids': r.get('evidence_ids') or [r.get('evidence')], 'review_status': r.get('review_status'), 'source_review_required': bool(source_flag_enabled and edge_is_legacy_pending(r)), 'ai_pre_review_status': pre_review_by_index.get(r.get('_relation_index'), {}).get('ai_pre_review_status'), 'ai_pre_review_reasons': pre_review_by_index.get(r.get('_relation_index'), {}).get('ai_pre_review_reasons', []), 'conflict': (r.get('source'), r.get('target')) in conflict_pairs, 'hop': edge_hop(r), 'context_match': bool(r.get('source') in contextual_nodes or r.get('target') in contextual_nodes), 'gate': edge_gate(r)} for r in visible_edges[:12]]
    # Ordered path search. Every path has N edges and N+1 nodes; one edge is never labelled as two hops.
    adjacency = {}
    for edge in visible_edges:
        if not edge.get('source') or not edge.get('target'): continue
        adjacency.setdefault(edge['source'], []).append((edge['target'], edge, 'forward'))
        adjacency.setdefault(edge['target'], []).append((edge['source'], edge, 'reverse'))
    path_rows = []
    queue = [([seed], []) for seed in sorted(graph_seeds) if seed in adjacency]
    while queue and len(path_rows) < 80:
        nodes, path_edges = queue.pop(0)
        if path_edges:
            gates = [edge_gate(item['edge']) for item in path_edges]
            evidence_ids = []
            for item in path_edges:
                evidence_ids.extend(item['edge'].get('evidence_ids') or [item['edge'].get('evidence')])
            evidence_ids = list(dict.fromkeys(x for x in evidence_ids if x))
            edge_payloads = []
            for item in path_edges:
                edge = item['edge']; pre = pre_review_by_index.get(edge.get('_relation_index'), {})
                edge_payloads.append({'source': edge.get('source'), 'target': edge.get('target'), 'type': edge.get('type'),
                    'strength': edge.get('strength'), 'evidence_ids': edge.get('evidence_ids') or [edge.get('evidence')],
                    'review_status': edge.get('review_status'), 'ai_pre_review_status': pre.get('ai_pre_review_status'),
                    'conflict': (edge.get('source'), edge.get('target')) in conflict_pairs,
                    'traversal': item['direction'], 'traversal_from': item['from'], 'traversal_to': item['to'], 'gate': edge_gate(edge)})
            score = round(sum(float(edge_score(item['edge'])[0]) for item in path_edges) / len(path_edges), 3)
            statuses = [gate['review_status'] for gate in gates]
            aggregate_status = 'blocked' if 'blocked' in statuses else 'education_only' if 'education_only' in statuses else 'approved'
            legacy_edge = path_edges[0]['edge']
            labels = [display_name(node, entities) for node in nodes]
            explanation = '；'.join(
                f"{labels[i]} —[{edge_payloads[i]['type']}]→ {labels[i + 1]}" if edge_payloads[i]['traversal'] == 'forward'
                else f"{labels[i]} ←[{edge_payloads[i]['type']}]— {labels[i + 1]}"
                for i in range(len(edge_payloads)))
            path_rows.append({'nodes': nodes, 'node_labels': [display_name(node, entities) for node in nodes],
                'edges': edge_payloads, 'hop_count': len(edge_payloads), 'path_score': score,
                'evidence_ids': evidence_ids, 'review_status': aggregate_status,
                'explanation': explanation + '。',
                # Backward-compatible single-edge descriptors.
                'relation': legacy_edge.get('type') if len(edge_payloads) == 1 else None,
                'strength': legacy_edge.get('strength') if len(edge_payloads) == 1 else None,
                'evidence': legacy_edge.get('evidence') if len(edge_payloads) == 1 else None,
                'evidence_level': legacy_edge.get('evidence_level') if len(edge_payloads) == 1 else None,
                'population': legacy_edge.get('population') if len(edge_payloads) == 1 else None,
                'condition': legacy_edge.get('condition') if len(edge_payloads) == 1 else None,
                'causal_status': legacy_edge.get('causal_status') if len(edge_payloads) == 1 else None,
                'source_review_required': any(bool(source_flag_enabled and edge_is_legacy_pending(item['edge'])) for item in path_edges),
                'ai_pre_review_reasons': list(dict.fromkeys(reason for item in path_edges for reason in pre_review_by_index.get(item['edge'].get('_relation_index'), {}).get('ai_pre_review_reasons', []))),
                'ai_pre_review_status': edge_payloads[0].get('ai_pre_review_status') if len(edge_payloads) == 1 else ('needs_clinician_confirmation' if any(x.get('ai_pre_review_status') == 'needs_clinician_confirmation' for x in edge_payloads) else None),
                'hop': len(edge_payloads)})
        if len(path_edges) >= max_hops: continue
        if path_edges and any(edge_gate(item['edge'])['safety_only'] for item in path_edges): continue
        current = nodes[-1]
        for next_node, edge, direction in adjacency.get(current, []):
            if next_node in nodes: continue
            if path_edges and edge_gate(edge)['safety_only']: continue
            queue.append((nodes + [next_node], path_edges + [{'edge': edge, 'direction': direction, 'from': current, 'to': next_node}]))
    graph_paths = sorted(path_rows, key=lambda row: (-row['path_score'], row['hop_count'], row['nodes']))[:12]
    matched_hidden = [row for row in hidden_manifest.get('candidates', []) if {row.get('source'), row.get('bridge'), row.get('target')} & expanded_nodes]
    def hidden_relevance(row):
        nodes = (row.get('source'), row.get('bridge'), row.get('target'))
        labels = [display_name(node, entities) for node in nodes]
        direct_question_hits = sum(1 for label in labels if label and (label in question or label.replace('受损', '') in question))
        seed_hits = sum(1 for node in nodes if node in graph_seeds)
        return direct_question_hits * 20 + seed_hits * 5 + int(row.get('score', 0))
    matched_hidden.sort(key=hidden_relevance, reverse=True)
    privileged_audience = audience in PRIVILEGED_AUDIENCES
    research_preview_requested = bool(options.get('research_preview', options.get('enable_hidden_relationships', False)))
    research_preview_authorized = bool(options.get('research_preview_authorized', False))
    research_preview_enabled = privileged_audience or (research_preview_requested and research_preview_authorized)
    hidden_limit = 8 if privileged_audience else 3
    visible_hidden = matched_hidden[:hidden_limit] if research_preview_enabled else []
    visible_hidden = [dict(row,
        node_labels=[display_name(node, entities) for node in (row.get('source'), row.get('bridge'), row.get('target'))],
        allowed_expression=' → '.join(display_name(node, entities) for node in (row.get('source'), row.get('bridge'), row.get('target'))) + '（测试版间接关联，尚未证明直接因果）',
        usage_status='research_preview_active', not_for_actions=True)
        for row in visible_hidden]
    personalization = build_personalization(context, disease, recommendations)
    safety_flags = build_safety_flags(context, question, recommendations)
    relevant_conflicts = [row for row in evidence_conflicts.get('conflicts', []) if (row.get('source'), row.get('target')) in {(edge.get('source'), edge.get('target')) for edge in graph_edges}]
    uncertainty, confidence = assess_uncertainty(results, context, relevant_conflicts, blocked_edge_count)
    citations = [{'source_id': x.get('source_id'), 'chunk_id': x.get('chunk_id'), 'source_version': x.get('source_version'), 'retrieved_at': x.get('retrieved_at'), 'citation': x['citation'], 'source_url': x.get('source_url', ''), 'publisher': x.get('publisher', ''), 'publication_year': x.get('publication_year', ''), 'evidence_level': x.get('evidence_level', ''), 'review_status': x.get('review_status', ''), 'source_review_required': x.get('source_review_required', False)} for x in results]
    return {'query': question, 'disease': disease, 'results': results, 'recommendations': recommendations, 'weekly_plan': weekly_plan, 'graph_context': graph_context,
            'graph_paths': graph_paths[:12], 'relationship_candidates': visible_hidden,
            'relationship_candidate_summary': {'matched': len(matched_hidden), 'visible': len(visible_hidden), 'research_preview_requested': research_preview_requested, 'research_preview_authorized': research_preview_authorized or privileged_audience, 'research_preview_enabled': research_preview_enabled, 'policy': '仅医生/临床/审计，或显式 research_preview=true 且授权通过时可见；候选不得生成诊断、用药或自动行动。'},
            'personalization': personalization, 'safety_flags': safety_flags,
            'uncertainty': uncertainty, 'confidence': confidence, 'citations': citations,
            'evidence_conflicts': evidence_conflicts.get('conflicts', []),
            'medical_gate': {'audience': audience, 'blocked_edge_count': blocked_edge_count, 'policy': '未获临床批准的高风险/冲突/失效来源关系不可生成普通行动、诊断暗示或用药建议；急症边仅作安全提示；医生/审计可见不等于批准'},
            'retrieval_trace': {'lexical_terms': sorted(qtokens)[:20], 'graph_seeds': pipeline_result['graph'].get('seed_entities', []), 'graph_seed_policy': 'retrieved_chunk_entities_or_explicit_disease_only', 'graph_limits': pipeline_result['graph'].get('limits', {}), 'contextual_nodes': sorted(contextual_nodes), 'graph_edges': len(pipeline_result['graph'].get('edges', [])), 'blocked_edge_count': blocked_edge_count, 'direct_edges': len(direct_edges), 'expanded_nodes': pipeline_result['graph'].get('expanded_nodes', []), 'chunks_considered': len(chunks), 'chunks_after_filters': pipeline_result.get('filtered_documents'), 'excluded_legacy_pending_chunks': excluded_legacy_chunks, 'excluded_invalid_chunks': excluded_invalid_chunks, 'flagged_legacy_pending_results': sum(1 for x in results if x.get('source_review_required')), 'source_gate': source_gate, 'source_gate_enabled': source_gate_enabled, 'source_flag_enabled': source_flag_enabled, 'source_review_penalty': source_review_penalty_value, 'top_k': top_k, 'max_hops': max_hops, 'audience': audience, 'evidence_levels': sorted({x.get('evidence_level') for x in results}), 'conflict_pairs': [list(x) for x in sorted(conflict_pairs)], 'conflict_count': len(evidence_conflicts.get('conflicts', [])), 'relevant_conflict_count': len(relevant_conflicts), 'pre_review_count': len(medical_pre_review.get('relations', [])), 'pre_review_statuses': medical_pre_review.get('counts', {}), 'stages': pipeline_result['capabilities'].get('stages', {}), 'degradations': pipeline_result['capabilities'].get('degradations', []), 'latency_ms': pipeline_result.get('latency_ms'), 'ranking': 'BM25+dense(RRF)+bounded-graph(RRF)+reranker+rank-normalized-source-review-penalty+medical-gate'},
            'index_version': INDEX_VERSION, 'graph_mode': pipeline_result['capabilities']['backend'], 'retrieval_capabilities': pipeline_result['capabilities'], 'disclaimer': '知识检索用于解释和健康教育，不替代医生诊断。'}

def build_personalization(context, disease, recommendations):
    latest = context.get('latest') or {}
    profile = context.get('profile') or {}
    matched, missing = [], []
    if latest.get('bp'): matched.append('recent_bp')
    else: missing.append('bp')
    if latest.get('glucose'): matched.append('recent_glucose')
    else: missing.append('glucose')
    for key, label in [('bp', 'bp_trend'), ('glucose', 'glucose_trend'), ('sleep', 'sleep_pattern'), ('egfr', 'renal_function'), ('steps', 'activity_pattern')]:
        if (context.get('trend_by_type') or {}).get(key) or (context.get('behavior') or {}).get(key): matched.append(label)
    for key, label in [('smoking_status', 'tobacco_exposure'), ('exercise_level', 'activity_level'), ('bmi', 'body_weight')]:
        if profile.get(key) not in (None, '', False): matched.append(label)
        else: missing.append(label)
    profile = context.get('profile') or {}
    if profile.get('fall_risk') in (1, '1', True): matched.append('fall_risk')
    elif profile.get('fall_risk') in (0, '0', False): matched.append('fall_risk_low')
    else: missing.append('fall_risk')
    quality = context.get('data_completeness') or {}
    if quality.get('measurement_condition_missing'): matched.append('missing_measurement_condition')
    reasons = [r.get('reason') for r in recommendations if r.get('reason')]
    return {'matched_factors': list(dict.fromkeys(matched)), 'missing_factors': list(dict.fromkeys(missing)), 'why_this_user': reasons[:6], 'disease_scope': disease}

def build_safety_flags(context, question, recommendations):
    text = str(question or '')
    flags = []
    if any(x in text for x in ENTITY_TERMS['danger_sign']): flags.append({'type': 'urgent_symptom', 'level': 'urgent', 'action': '立即联系急救并通知家属'})
    bp = (context.get('latest') or {}).get('bp') or {}
    if isinstance(bp.get('value'), (int, float)) and (bp['value'] >= 180 or (isinstance(bp.get('value2'), (int, float)) and bp['value2'] >= 120)):
        flags.append({'type': 'severe_bp', 'level': 'urgent', 'action': '安静休息后复测，伴危险症状立即急救'})
    if any(r.get('priority') == 'urgent' for r in recommendations): flags.append({'type': 'recommendation_urgent', 'level': 'urgent'})
    if not (context.get('latest') or {}): flags.append({'type': 'insufficient_context', 'level': 'low', 'action': '先补充近期测量'})
    return flags

def _metric_date(row):
    return (row or {}).get('recorded_at') or (row or {}).get('measured_at') or '最近记录'

def _personal_action(priority, action, reason, evidence, personalized_for, action_type='schedule_recheck', schedule='本周内', requires_confirmation=False):
    """统一行动结构：每条建议都要能回答“为什么是这个人、何时做、依据是什么”。"""
    return {
        'priority': priority, 'action': action, 'reason': reason, 'evidence': evidence,
        'evidence_ids': [evidence], 'personalized_for': personalized_for,
        'action_type': action_type, 'schedule': schedule,
        'requires_confirmation': requires_confirmation,
        'medical_boundary': '不自行调整药物；出现危险症状立即就医',
    }

def derive_weekly_plan(disease, context, recommendations):
    """生成可执行的 7 天行动序列；行为建议只用于管理计划，不包装成疾病预测。"""
    latest = (context or {}).get('latest') or {}
    trend = (context or {}).get('trend_by_type') or {}
    profile = (context or {}).get('profile') or {}
    behavior = (context or {}).get('behavior') or {}
    bp = latest.get('bp') or {}
    bp_trend = trend.get('bp') or {}
    fall_risk = profile.get('fall_risk') in (1, '1', True)
    plan = []
    def add(day, action, reason, evidence, metric=None, action_type='create_todo', priority='normal', confirmation=False):
        plan.append({'day_offset': day, 'day_label': f'第{day + 1}天', 'action': action, 'reason': reason,
                     'evidence': evidence, 'evidence_ids': [evidence], 'metric_type': metric,
                     'action_type': action_type, 'priority': priority, 'requires_confirmation': confirmation,
                     'medical_boundary': '不自行调整药物；出现危险症状立即就医'})
    if disease == 'hypertension' and bp:
        add(0, '早晚各测一次血压，测前安静坐5分钟，并记录姿势、时间和数值', f'当前血压 {bp.get("value")}/{bp.get("value2")}，需要先排除测量条件造成的波动', 'who_hypertension_2025.md#识别与复测', 'bp', 'schedule_recheck', 'high' if bp_trend.get('direction') == 'rising' else 'normal')
        add(1, '记录当天腌制食品、汤汁和酱料摄入，不要求突然改变饮食', '先找到个人最可能的盐来源，再决定下一步调整', 'who_hypertension_2025.md#危险因素')
        add(2, '继续早晚固定时间复测血压，保持同一测量条件', '连续记录比单次读数更能反映个人趋势', 'who_hypertension_2025.md#识别与复测', 'bp', 'schedule_recheck', 'high' if bp_trend.get('direction') == 'rising' else 'normal')
        if fall_risk or profile.get('age', 0) >= 75:
            add(3, '只做室内或有人陪同的轻缓活动，感觉头晕立即停止', '档案显示年龄较高或有跌倒风险，活动计划优先保证安全', 'older_adult_safety.md#安全边界', 'steps')
        else:
            add(3, '完成一次10–20分钟舒缓活动，记录活动后是否不适', '在当前活动资料不足时先用短时、可停止的活动建立耐受记录', 'who_physical_activity_2020.md#老年人安全', 'steps')
        add(4, '记录一晚入睡时间、夜间醒来次数和第二天精神状态', '睡眠会影响血压解释，但本系统不把睡眠当作精确疾病预测', 'aha_lifes_essential_8_2022.md#八项指标', 'sleep')
        add(5, '整理本周血压记录，查看是否仍连续偏高', '需要把个人趋势和测量条件一起交给医生判断', 'who_hypertension_2025.md#识别与复测', 'bp', 'review_trend')
        add(6, '若连续多次仍偏高，准备记录并联系医生；不要自行改药', '连续异常比一次异常更值得医学复核', 'who_hypertension_2025.md#并发症', None, 'contact_doctor', 'high', True)
    elif disease == 'diabetes':
        glucose = latest.get('glucose') or {}
        add(0, '确认下一次血糖是空腹还是餐后，并按同一条件记录', '血糖数值必须结合测量时点解释', 'who_diabetes_2024.md#监测与并发症', 'glucose', 'schedule_recheck', 'high' if isinstance(glucose.get('value'), (int, float)) and glucose.get('value') >= 7 else 'normal')
        add(1, '记录一天三餐时间和加餐，不先自行大幅减少主食', '先获得个人饮食—血糖对应关系，避免泛化饮食建议', 'dpp_2002.md#生活方式干预')
        add(2, '在无头晕、出汗或乏力时做10–20分钟轻缓活动', '老年人需同时关注低血糖和跌倒风险', 'ada_older_adults_2025.md#功能状态与低血糖')
        add(3, '复测血糖并补充餐前/餐后条件', '用同一条件的重复数据判断变化', 'who_diabetes_2024.md#监测与并发症', 'glucose', 'schedule_recheck')
        add(4, '记录一次睡眠和白天精力，观察是否影响饮食与活动', '睡眠是行为上下文，不作为精确疾病预测', 'aha_lifes_essential_8_2022.md#八项指标', 'sleep')
        add(5, '整理血糖、饮食和活动记录，准备复诊时带给医生', '将指标与个人行为上下文绑定，减少笼统建议', 'ada_older_adults_2025.md#功能状态与低血糖')
        add(6, '若重复结果仍异常，联系医生评估；不自行调整药物', '持续异常需要专业复核', 'who_diabetes_2024.md#监测与并发症', None, 'contact_doctor', 'high', True)
    elif disease == 'chronic_kidney_disease':
        add(0, '核对最近一次 eGFR、肌酐和尿白蛋白的日期，缺哪项就标出来', '肾功能判断依赖成套指标和时间变化', 'kdigo_ckd_2024.md#评估与复测', 'egfr', 'review_trend')
        add(1, '固定时间测血压并记录，避免自行改变药物或保健品', '肾功能与血压需要一起管理', 'kdigo_ckd_2024.md#血压与共病', 'bp', 'schedule_recheck')
        add(2, '整理正在使用的药物和保健品清单，复诊时交给医生', '肾功能变化可能影响用药安全，需要医生审核', 'kdigo_ckd_2024.md#用药安全', None, 'contact_doctor', 'high', True)
        add(3, '按医生安排复查肾功能，不用单次结果自行判断', '单次 eGFR 不能替代连续评估', 'kdigo_ckd_2024.md#评估与复测', 'egfr', 'schedule_recheck', 'high')
        add(4, '记录血糖或饮食情况（若有糖尿病/血压问题），带给医生综合判断', '共病因素会改变肾脏风险管理重点', 'kdigo_ckd_2024.md#血压与共病')
        add(5, '检查本周是否完成测量和复查预约', '用完成情况决定是否需要家属协助', 'kdigo_ckd_2024.md#筛查人群')
        add(6, '若出现明显水肿、呼吸困难或尿量异常，及时就医', '出现危险变化不能等待趋势外推', 'kdigo_ckd_2024.md#评估与复测', None, 'contact_doctor', 'urgent', True)
    elif disease == 'frailty':
        add(0, '记录一次起身、走路是否需要扶持，以及最近是否跌倒', '衰弱评估优先看功能和安全，不用单日步数替代', 'elderly_frailty.md#评估维度')
        add(1, '记录体重和一次轻缓活动后的疲劳程度', '体重和疲劳变化需要连续观察', 'elderly_frailty.md#可观察指标', 'weight')
        add(2, '安排家属陪同的安全活动或功能评估', '存在跌倒风险时不建议独自增加活动强度', 'elderly_frailty.md#安全行动', None, 'notify_caregiver', 'high', True)
        add(3, '记录睡眠和白天精神状态', '睡眠和认知状态影响功能表现', 'older_adult_safety.md#安全边界', 'sleep')
        add(4, '复测体重或握力，并记录日期和条件', '需要重复测量确认变化', 'elderly_frailty.md#可观察指标', 'weight', 'schedule_recheck')
        add(5, '整理跌倒、活动、体重和睡眠记录', '为医生或家属提供完整上下文', 'elderly_frailty.md#评估维度')
        add(6, '若发生跌倒、意识改变或明显功能下降，联系医生', '危险信号需要人工评估', 'older_adult_safety.md#危险信号', None, 'contact_doctor', 'urgent', True)
    else:
        # 未命中特定疾病时仍提供个体化的数据补采，而不是泛化生活方式口号。
        missing = (context or {}).get('data_completeness', {}).get('missing') or []
        add(0, f'固定时间补充{", ".join(missing[:2]) or "当前核心指标"}记录', '当前数据完整度不足，先补齐最影响判断的指标', 'older_adult_safety.md#数据不足', missing[0] if missing else None, 'schedule_recheck', 'normal')
        add(1, '记录测量条件和当天不适症状', '没有测量条件时，单次数值很难与个人基线比较', 'older_adult_safety.md#安全边界')
        add(3, '回看一周记录，优先处理重复出现的异常', '连续趋势比单次波动更有解释价值', 'older_adult_safety.md#数据不足', None, 'review_trend')
        add(6, '把一周记录带给医生或家属共同查看', '复杂或持续异常需要人工复核', 'older_adult_safety.md#安全边界', None, 'contact_doctor', 'normal', True)
    return plan[:7]

def derive_recommendations(disease, context, question):
    """把图谱证据转成结构化行动；LLM只能解释这些行动，不能凭空添加数值。"""
    latest = (context or {}).get('latest') or {}
    behavior = (context or {}).get('behavior') or {}
    profile = (context or {}).get('profile') or {}
    recs = []
    bp = latest.get('bp') or {}
    trend = (context or {}).get('trend_by_type') or {}
    quality = (context or {}).get('data_completeness') or {}
    systo, diasto = bp.get('value'), bp.get('value2')
    danger_hit = any(x in str(question or '') for x in ENTITY_TERMS['danger_sign'])
    if danger_hit and disease not in ('heart_disease', 'stroke'):
        if disease == 'diabetes' and any(x in str(question or '') for x in ('低血糖', '昏沉', '叫不醒', '意识')):
            urgent_action = '疑似严重低血糖或意识改变：立即呼叫急救并通知家属，不要自行调整药物或等待预测。'
            urgent_evidence = 'diabetes.md#危险信号'
        elif disease == 'chronic_kidney_disease' and any(x in str(question or '') for x in ('呼吸困难', '气短', '水肿')):
            urgent_action = '出现呼吸困难、明显水肿或意识改变：立即联系急救或医务人员，不要等待趋势外推。'
            urgent_evidence = 'kdigo_ckd_2024.md#评估与复测'
        else:
            urgent_action = '问题包含危险信号：立即呼叫急救并通知家属，不要等待模型预测。'
            urgent_evidence = 'older_adult_safety.md#危险信号'
        recs.append({'priority': 'urgent', 'action': urgent_action, 'reason': '问题包含急症或危险症状的口语表达', 'evidence': urgent_evidence, 'evidence_ids': [urgent_evidence], 'requires_confirmation': False, 'medical_boundary': '急症优先急救，不自行调整药物'})
    if disease == 'hypertension':
        if isinstance(systo, (int, float)) and isinstance(diasto, (int, float)) and (systo >= 180 or diasto >= 120):
            recs.append({'priority': 'urgent', 'action': '立即安静休息并重新测量；若伴胸痛、呼吸困难、意识改变或单侧无力，立即呼叫急救。', 'reason': '当前血压达到危险信号门槛', 'evidence': 'who_hypertension_2025.md#并发症'})
        elif isinstance(systo, (int, float)) and isinstance(diasto, (int, float)) and (systo >= 140 or diasto >= 90):
            direction = (trend.get('bp') or {}).get('direction')
            recs.append(_personal_action('high', '今天固定时间复测两次并记录；若连续多次偏高，联系医务人员评估。', f'最近一次血压 {systo}/{diasto} mmHg 偏高，趋势为{direction or "未知"}', 'who_hypertension_2025.md#识别与复测', ['recent_bp_high', 'repeated_measurements'], 'schedule_recheck', '今天'))
        elif latest.get('bp'):
            recs.append(_personal_action('normal', '继续固定时间测量并记录，观察连续趋势，不因单次波动自行调整用药。', '已有血压记录但当前未触发高风险规则', 'who_hypertension_2025.md#识别与复测', ['recent_bp'], 'schedule_recheck', '本周'))
        if profile.get('smoking_status') not in (None, 0, '0', False):
            recs.append(_personal_action('high', '把减少烟草暴露列为近期重点；如果需要，和医生讨论戒烟支持。', '个人档案显示存在烟草暴露', 'who_hypertension_2025.md#危险因素', ['tobacco_exposure'], 'create_todo', '本周', True))
        if isinstance(profile.get('exercise_level'), (int, float)) and profile['exercise_level'] < 60:
            recs.append(_personal_action('normal', '在活动耐受允许时，从短时散步或舒缓活动开始，逐步减少久坐；出现不适先停止并咨询医生。', '个人档案显示每周活动量偏少', 'older_physical_activity_review_2022.md#系统使用边界', ['low_activity'], 'create_todo', '本周'))
    if disease == 'diabetes':
        glucose = (latest.get('glucose') or {}).get('value')
        if isinstance(glucose, (int, float)) and glucose >= 7:
            recs.append({'priority': 'high', 'action': '确认这次是否为空腹测量，按同一条件复测并联系医生评估。', 'reason': f'记录血糖 {glucose} mmol/L 需要结合测量条件复核', 'evidence': 'who_diabetes_2024.md#监测与并发症'})
        elif latest.get('glucose'):
            recs.append({'priority': 'normal', 'action': '继续按相同测量条件记录血糖，补充餐前/餐后信息，便于医生判断。', 'reason': '血糖需要结合测量时点解释', 'evidence': 'who_diabetes_2024.md#监测与并发症'})
        if latest.get('bp') and isinstance(glucose, (int, float)) and glucose >= 7:
            recs.append({'priority': 'high', 'action': '血压和血糖同时需要复核；分别记录测量时间与空腹/餐后条件，再带给医生综合评估。', 'reason': '血糖偏高且近期同时有血压记录，属于共同心代谢风险线索', 'evidence': 'who_cvd_2025.md#风险网络'})
    if disease in ('heart_disease', 'stroke') and any(x in question for x in ENTITY_TERMS['danger_sign']):
        recs.append({'priority': 'urgent', 'action': '出现胸痛、呼吸困难、单侧无力或言语不清时立即呼叫急救并通知家属。', 'reason': '问题包含危险信号关键词', 'evidence': 'aha_stroke_prevention_2024.md#社会决定因素与急症'})
    if disease == 'chronic_kidney_disease':
        egfr = (latest.get('egfr') or {}).get('value')
        creatinine = (latest.get('creatinine') or {}).get('value')
        albumin = (latest.get('urine_albumin') or latest.get('albuminuria') or {}).get('value')
        if isinstance(egfr, (int, float)) and egfr < 60:
            recs.append({'priority': 'high', 'action': '按医生安排复查肾功能，并同时记录血压和血糖；不要自行调整药物。', 'reason': f'eGFR 记录为 {egfr}，需要结合复测和医生评估', 'evidence': 'kdigo_ckd_2024.md#评估与复测'})
        elif isinstance(creatinine, (int, float)) or isinstance(albumin, (int, float)):
            recs.append({'priority': 'normal', 'action': '保留肌酐、eGFR和尿白蛋白的检测日期，按同一实验室或医生建议复查。', 'reason': '已有肾功能相关指标，需要看连续变化而非单次结果', 'evidence': 'kdigo_ckd_2024.md#评估与复测'})
        else:
            recs.append({'priority': 'normal', 'action': '如果有糖尿病或血压偏高，和医生确认是否需要补充肾功能与尿白蛋白检查。', 'reason': '当前缺少可判断肾功能的核心指标', 'evidence': 'kdigo_ckd_2024.md#筛查人群'})
        if latest.get('bp'):
            recs.append({'priority': 'high' if ((latest.get('bp') or {}).get('value') or 0) >= 140 else 'normal', 'action': '继续固定时间监测血压；肾脏疾病与血压需要一起管理。', 'reason': '血压是肾脏风险管理的重要监测信号', 'evidence': 'kdigo_ckd_2024.md#血压与共病'})
    if disease == 'frailty':
        grip = latest.get('grip') or {}
        weight = latest.get('weight') or {}
        if profile.get('fall_risk') in (1, '1', True) or profile.get('frailty_score') not in (None, ''):
            recs.append({'priority': 'high', 'action': '先安排跌倒风险和功能状态评估，再决定活动强度；出现反复跌倒请联系家属和医生。', 'reason': '档案包含跌倒或衰弱相关信息，需要优先保证安全', 'evidence': 'elderly_frailty.md#安全行动'})
        elif grip.get('value') is not None or weight.get('value') is not None:
            recs.append({'priority': 'normal', 'action': '连续记录握力、体重和活动模式，观察数周变化，不用单日步数判断衰弱。', 'reason': '已有功能或体重观察线索，但需要连续数据确认', 'evidence': 'elderly_frailty.md#可观察指标'})
        else:
            recs.append({'priority': 'normal', 'action': '补充握力、体重变化、跌倒史和日常活动情况，便于做老年功能评估。', 'reason': '当前缺少衰弱评估所需的关键资料', 'evidence': 'elderly_frailty.md#评估维度'})
    sleep = behavior.get('sleep') or {}
    if isinstance(sleep.get('rolling_7d_average'), (int, float)) and sleep['rolling_7d_average'] < 6:
        recs.append({'priority': 'normal', 'action': '先固定上床和起床时间，连续记录一周睡眠；不要把睡眠波动当作疾病预测。', 'reason': '近7天睡眠平均偏少', 'evidence': 'aha_lifes_essential_8_2022.md#八项指标'})
    elif isinstance(sleep.get('rolling_7d_average'), (int, float)):
        recs.append({'priority': 'normal', 'action': '继续保持相对固定的作息，记录睡眠质量；如白天仍明显困倦，再和医生讨论原因。', 'reason': '近7天睡眠平均达到基本观察水平', 'evidence': 'aha_lifes_essential_8_2022.md#八项指标'})
    if quality.get('measurement_condition_missing') and latest:
        recs.append(_personal_action('normal', '下一次测量时补充时间、姿势和测量前状态，保持条件一致。', '近期记录缺少测量条件，可能影响个人趋势判断', 'older_adult_safety.md#数据不足', ['missing_measurement_condition'], 'schedule_recheck', '下一次测量'))
    # 优先显示高风险和真正由用户上下文触发的行动，减少通用口号挤占建议位。
    recs.sort(key=lambda r: ({'urgent': 0, 'high': 1, 'normal': 2}.get(r.get('priority'), 3), 0 if r.get('personalized_for') else 1))
    return recs[:4]

def main():
    # 服务端通过 stdin 传 JSON，命令行仍保留 build/query 入口。
    raw = sys.stdin.buffer.read()
    if raw.strip():
        try:
            req = json.loads(raw.decode('utf-8'))
            globals()['_QUERY_CONTEXT'] = req.get('context') or {}
            options = req.get('options') or {}
            top_k = int(options.get('top_k', req.get('top_k', 4)) or 4)
            print(json.dumps(query(req.get('question', ''), req.get('disease'), top_k, options), ensure_ascii=False)); return
        except Exception as exc:
            print(json.dumps({'success': False, 'error': type(exc).__name__}, ensure_ascii=False)); return
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    build_parser = sub.add_parser('build')
    build_parser.add_argument('--output-path')
    build_parser.add_argument('--report-path')
    build_parser.add_argument('--update-docs', action='store_true')
    dense = sub.add_parser('build-retrieval-index')
    dense.add_argument('--vector-model', default='hashing_char_ngram_v1')
    dense.add_argument('--output')
    q = sub.add_parser('query'); q.add_argument('--question', required=True); q.add_argument('--disease')
    args = ap.parse_args()
    out = build(args.output_path, args.report_path, args.update_docs) if args.cmd == 'build' else build_retrieval_index(args.vector_model, args.output) if args.cmd == 'build-retrieval-index' else query(args.question, args.disease)
    print(json.dumps(out, ensure_ascii=False))
if __name__ == '__main__': main()
