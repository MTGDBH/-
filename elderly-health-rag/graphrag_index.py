# -*- coding: utf-8 -*-
"""轻量、可审计的本地 GraphRAG 索引与查询服务（仅标准库）。"""
import argparse, hashlib, json, math, re, sys
from pathlib import Path
from retrieval_backends import capabilities

ROOT = Path(__file__).parent
INPUT = ROOT / 'input' / 'guidelines'
OUTPUT = ROOT / 'output'
RELATIONS_FILE = ROOT / 'input' / 'relations.json'
EVIDENCE_REGISTRY_FILE = ROOT / 'input' / 'evidence_registry.json'
INDEX_VERSION = '2026-08-21.v6'
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

def is_legacy_pending_status(status):
    value = str(status or '').strip().lower()
    return any(marker.lower() in value for marker in LEGACY_PENDING_MARKERS)
DISEASE_ALIASES = {
    'hypertension': ['高血压', '血压'], 'diabetes': ['糖尿病', '血糖'],
    'heart_disease': ['心脏病', '心血管', '胸痛'], 'stroke': ['脑卒中', '中风', '单侧无力'],
    'chronic_kidney_disease': ['慢性肾脏病', '慢性肾病', '肾功能', '肾脏'],
    'frailty': ['老年衰弱', '衰弱', '跌倒风险', '功能下降'],
}
ENTITY_TERMS = {
    'measurement': ['血压', '血糖', '血脂', '体重', '活动', '睡眠', '肌酐', 'eGFR', '尿白蛋白'],
    'risk_factor': ['吸烟', '盐', '体重', '血压', '血糖', '血脂', '蛋白尿', '肾功能', '跌倒', '虚弱'],
    'intervention': ['复测', '记录', '减少盐', '活动', '睡眠', '联系家属', '就医', '肾功能检查'],
    # 同时覆盖指南术语和老人常用口语，避免“叫不醒/胸闷/突然没力气”等急症表达漏检。
    'danger_sign': ['胸痛', '胸闷', '呼吸困难', '气短', '意识改变', '意识模糊', '叫不醒', '昏迷', '昏沉', '单侧无力', '突然没力气', '面歪', '言语不清', '说话含糊', '失语', '晕厥', '严重低血糖'],
    'older_adult_context': ['老年', '虚弱', '跌倒', '认知', '低血糖', '功能状态'],
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
    if 'frailty' in name or 'elderly_frailty' in name: return 'frailty'
    if 'cvd' in name or 'cardiovascular' in name or 'lifes_essential' in name: return 'cardiovascular'
    return stem

def tokenize(text):
    """中文按知识词表+二字片段切分，避免整句中文被当成一个 token。"""
    text = (text or '').lower()
    terms = set(re.findall(r'[a-zA-Z]{3,}', text))
    for term in sorted({x for xs in DISEASE_ALIASES.values() for x in xs} | {x for xs in ENTITY_TERMS.values() for x in xs}, key=len, reverse=True):
        if term in text: terms.add(term)
    han = ''.join(re.findall(r'[\u4e00-\u9fff]', text))
    terms.update(han[i:i+2] for i in range(max(0, len(han)-1)))
    return terms

def build():
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
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT/'chunks.json').write_text(json.dumps(chunks, ensure_ascii=False, indent=2), encoding='utf-8')
    (OUTPUT/'entities.json').write_text(json.dumps(list(entities.values()), ensure_ascii=False, indent=2), encoding='utf-8')
    (OUTPUT/'relationships.json').write_text(json.dumps(relationships, ensure_ascii=False, indent=2), encoding='utf-8')
    evidence_conflicts = detect_evidence_conflicts(relationships)
    (OUTPUT/'evidence_conflicts.json').write_text(json.dumps({
        'schema_version': 'evidence-conflict.v1', 'index_version': INDEX_VERSION,
        'checked_relationships': len(relationships), 'conflict_count': len(evidence_conflicts),
        'conflicts': evidence_conflicts,
        'policy': '冲突关系进入医生审核，老人端不直接使用冲突结论。'
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    # 高风险关系必须显式进入医学审核队列，不能只依赖关系对象的默认字段。
    high_risk_types = {
        'urgent_signal', 'emergency_action', 'requires_medical_review',
        'requires_clinician_review', 'do_not_self_adjust_medication',
        'contraindicated_or_caution', 'increases_risk_of',
        'major_preventable_driver', 'managed_by', 'prevention_evidence'
    }
    review_rows = []
    for relation_index, rel in enumerate(relationships):
        if rel.get('strength') == 'high' or rel.get('type') in high_risk_types:
            review_rows.append({
                'relation_index': relation_index,
                'source': rel.get('source'), 'target': rel.get('target'),
                'type': rel.get('type'), 'strength': rel.get('strength'),
                'evidence': rel.get('evidence'),
                'evidence_level': rel.get('evidence_level'),
                'review_status': rel.get('review_status') or 'pending_medical_review',
                'reviewer_role': 'geriatric_or_primary_care_clinician',
                'review_reason': '高风险关系进入老人端建议或安全过滤前必须完成医学审核',
                'last_verified': rel.get('last_verified')
            })
    (OUTPUT/'relation_review_manifest.json').write_text(json.dumps({
        'schema_version': 'relation-review.v1', 'index_version': INDEX_VERSION,
        'generated_at': '2026-08-21', 'policy': 'high_strength_or_safety_relation',
        'statuses': {'pending_medical_review': sum(r['review_status'] == 'pending_medical_review' for r in review_rows),
                     'approved': sum(r['review_status'] == 'approved' for r in review_rows),
                     'rejected': sum(r['review_status'] == 'rejected' for r in review_rows)},
        'relations': review_rows
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    communities = []
    for disease in DISEASE_ALIASES:
        ids = [e['id'] for e in entities.values() if e['id'] == f'disease:{disease}' or e['id'] in {r['target'] for r in relationships if r['source'] == f'disease:{disease}'}]
        communities.append({'id': f'community:{disease}', 'disease': disease, 'entity_ids': sorted(ids), 'entity_count': len(ids), 'chunk_count': len([c for c in chunks if c['disease'] == disease])})
    (OUTPUT/'communities.json').write_text(json.dumps(communities, ensure_ascii=False, indent=2), encoding='utf-8')
    for record in curated_source_registry():
        source_manifest.append({'file': f"registry:{record['source_id']}", 'source_id': record['source_id'],
                                'sha256': hashlib.sha256(json.dumps(record, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest(),
                                'source_url': record['source_url'], 'publisher': record['publisher'],
                                'publication_year': record['publication_year'], 'document_type': record['document_type'],
                                'evidence_level': record['evidence_level'], 'review_status': record['review_status'],
                                'version': record.get('version', f"{record['publication_year']}.registry"),
                                'population': record.get('population', 'older_adults'),
                                'limitations': record.get('limitations', '来源摘要，不能替代原文或个体医学判断。'),
                                'retrieved_at': record.get('retrieved_at', '2026-08-21'),
                                'index_version': INDEX_VERSION})
    (OUTPUT/'source_manifest.json').write_text(json.dumps({'index_version': INDEX_VERSION, 'generated_at': '2026-08-21', 'sources': source_manifest, 'invalid_relations': invalid_relations}, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'index_version': INDEX_VERSION, 'chunks': len(chunks), 'entities': len(entities), 'relationships': len(relationships), 'communities': len(communities), 'sources': len(source_manifest), 'invalid_relations': len(invalid_relations)}

def query(question, disease=None, top_k=4, options=None):
    if not (OUTPUT/'chunks.json').exists(): build()
    chunks = json.loads((OUTPUT/'chunks.json').read_text(encoding='utf-8'))
    source_manifest = json.loads((OUTPUT/'source_manifest.json').read_text(encoding='utf-8')) if (OUTPUT/'source_manifest.json').exists() else {'sources': []}
    source_status_by_key = {}
    for source in source_manifest.get('sources', []):
        status = source.get('review_status', '')
        for key in (source.get('file'), source.get('source_id'), f"registry:{source.get('source_id')}"):
            if key:
                source_status_by_key[str(key)] = status
    relationships = json.loads((OUTPUT/'relationships.json').read_text(encoding='utf-8')) if (OUTPUT/'relationships.json').exists() else []
    relationships = [dict(row, _relation_index=index) for index, row in enumerate(relationships)]
    evidence_conflicts = json.loads((OUTPUT/'evidence_conflicts.json').read_text(encoding='utf-8')) if (OUTPUT/'evidence_conflicts.json').exists() else {'conflicts': []}
    medical_pre_review = json.loads((OUTPUT/'medical_pre_review.json').read_text(encoding='utf-8')) if (OUTPUT/'medical_pre_review.json').exists() else {'relations': [], 'counts': {}}
    pre_review_by_index = {row.get('relation_index'): row for row in medical_pre_review.get('relations', [])}
    entities = {e['id']: e for e in json.loads((OUTPUT/'entities.json').read_text(encoding='utf-8'))} if (OUTPUT/'entities.json').exists() else {}
    qtokens = tokenize(question)
    aliases = set(DISEASE_ALIASES.get(disease or '', []))
    graph_seeds = {f'disease:{disease}'} if disease else set()
    # 中文问题使用别名时也要落到英文规范疾病节点，才能跨疾病检索关系边。
    for disease_id, aliases_for_disease in DISEASE_ALIASES.items():
        if any(alias in question for alias in aliases_for_disease): graph_seeds.add(f'disease:{disease_id}')
    relation_query = bool(re.search(r'关系|相关|影响|共同|并发|导致|关联|之间', question))
    related_diseases = {x.split(':', 1)[1] for x in graph_seeds if x.startswith('disease:')}
    for entity_id, entity in entities.items():
        tail = entity_id.split(':', 1)[-1]
        if any(token in tail or tail in token for token in qtokens): graph_seeds.add(entity_id)
    options = options or {}
    audience = str(options.get('audience', 'elderly') or 'elderly').lower()
    source_gate = str(options.get('source_gate', 'flag_legacy_pending') or 'flag_legacy_pending')
    max_hops = max(1, min(2, int(options.get('max_hops', 2) or 2)))
    def chunk_review_status(chunk):
        return chunk.get('review_status') or source_status_by_key.get(chunk.get('source'), '')
    def chunk_is_legacy_pending(chunk):
        return is_legacy_pending_status(chunk_review_status(chunk))
    chunk_by_id = {c.get('id'): c for c in chunks}
    def edge_is_legacy_pending(edge):
        chunk = chunk_by_id.get(edge.get('chunk_id'))
        return bool(chunk and chunk_is_legacy_pending(chunk))
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
        # 待临床确认的关系不进入老人端的普通建议上下文；急症边作为安全信号保留，
        # 以免过滤逻辑反而延迟急救。医生/审计视图保留全部关系。
        if audience in {'doctor', 'clinician', 'audit'}:
            return True
        if source_gate_enabled and edge_is_legacy_pending(edge):
            return False
        pre_status = pre_review_by_index.get(edge.get('_relation_index'), {}).get('ai_pre_review_status')
        if pre_status == 'needs_clinician_confirmation' and edge.get('type') not in {'urgent_signal', 'emergency_action'}:
            return False
        return True
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
    contradiction_pairs = {frozenset({'increases_risk_of', 'protective_against'}), frozenset({'managed_by', 'contraindicated_or_caution'}), frozenset({'recommended_for', 'not_sufficient_alone_for'})}
    pair_types = {}
    for edge in relationships:
        pair_types.setdefault((edge.get('source'), edge.get('target')), set()).add(edge.get('type'))
    conflict_pairs = {pair for pair, types in pair_types.items() if any(combo.issubset(types) for combo in contradiction_pairs)}
    scored = []
    excluded_legacy_chunks = 0
    for c in chunks:
        if source_gate_enabled and chunk_is_legacy_pending(c):
            excluded_legacy_chunks += 1
            continue
        if disease and c['disease'] != disease and not (disease in ('heart_disease', 'stroke') and c['disease'] == 'cardiovascular'):
            # 关系型问题允许把图中相邻疾病的权威证据带入结果，避免只回答单病种模板。
            if not relation_query or c['disease'] not in related_diseases: continue
        overlap = len(qtokens & set(c['tokens']))
        alias_bonus = sum(1 for x in aliases if x in c['text'])
        danger_bonus = 2 if any(x in question for x in ENTITY_TERMS['danger_sign']) and any(x in c['text'] for x in ENTITY_TERMS['danger_sign']) else 0
        graph_bonus = 4 if c['id'] in {r.get('chunk_id') for r in direct_edges if r.get('chunk_id')} else 1 if c['id'] in graph_chunk_ids else 0
        conflict_penalty = 2 if any((r.get('source'), r.get('target')) in conflict_pairs for r in graph_edges if r.get('chunk_id') == c['id']) else 0
        authority_bonus = EVIDENCE_LEVELS.get(c.get('evidence_level'), 0) * 0.5
        section_text = f"{c.get('section', '')} {c.get('text', '')}"
        topic_bonus = 0
        if '睡眠' in question and ('生活方式' in section_text or '八项指标' in section_text): topic_bonus += 8
        if '步数' in question and '可观察指标' in c.get('section', ''): topic_bonus += 20
        if ('活动' in question or '行为' in question) and '可观察指标' in c.get('section', ''): topic_bonus += 12
        if ('增加' in question or '停药' in question or '药' in question) and '生活方式干预' in section_text: topic_bonus += 8
        # 复测/监测问题应优先命中明确的监测章节，而不是被生活方式摘要淹没。
        # 这项加权只改变同病种候选的排序，不会跨越疾病过滤或安全策略。
        if any(term in question for term in ('复测', '监测', '记录')) and any(term in section_text for term in ('监测', '复测', '评估与复测')):
            topic_bonus += 8
        # 注册表摘要扩大证据覆盖，但同题已有原始章节时稍作降权，保证黄金问题仍优先命中具体段落。
        registry_penalty = 2 if str(c.get('source', '')).startswith('registry:') else 0
        # 默认只做可见的待复核标记，不牺牲关键问题的证据召回；严格审核场景可通过 source_gate=exclude_legacy_pending 排除。
        source_review_penalty = 0
        score = overlap + alias_bonus * 2 + danger_bonus + graph_bonus + authority_bonus + topic_bonus - conflict_penalty - registry_penalty - source_review_penalty
        if score: scored.append((score, c))
    scored.sort(key=lambda x: (-x[0], x[1]['id']))
    results = []
    for s, c in scored[:top_k]:
        support = [r for r in graph_edges if r.get('chunk_id') == c['id']]
        results.append({'chunk_id': c['id'], 'disease': c['disease'], 'section': c['section'], 'text': c['text'], 'source': c['source'], 'citation': c['citation'], 'evidence_level': c['evidence_level'], 'publisher': c.get('publisher', ''), 'publication_year': c.get('publication_year', ''), 'source_url': c.get('source_url', ''), 'review_status': chunk_review_status(c), 'source_review_required': bool(source_flag_enabled and chunk_is_legacy_pending(c)), 'score': round(s / max(1, len(qtokens)), 3), 'graph_support': [{'type': r.get('type'), 'target': r.get('target'), 'strength': r.get('strength'), 'evidence': r.get('evidence'), 'evidence_ids': r.get('evidence_ids') or [r.get('evidence')], 'conflict': (r.get('source'), r.get('target')) in conflict_pairs, 'ai_pre_review_status': pre_review_by_index.get(r.get('_relation_index'), {}).get('ai_pre_review_status')} for r in support]})
    context = globals().get('_QUERY_CONTEXT', {}) or {}
    recommendations = derive_recommendations(disease, context, question)
    weekly_plan = derive_weekly_plan(disease, context, recommendations)
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
    graph_context = [{'source': r.get('source'), 'target': r.get('target'), 'type': r.get('type'), 'strength': r.get('strength'), 'evidence': r.get('evidence'), 'evidence_ids': r.get('evidence_ids') or [r.get('evidence')], 'review_status': r.get('review_status'), 'source_review_required': bool(source_flag_enabled and edge_is_legacy_pending(r)), 'ai_pre_review_status': pre_review_by_index.get(r.get('_relation_index'), {}).get('ai_pre_review_status'), 'ai_pre_review_reasons': pre_review_by_index.get(r.get('_relation_index'), {}).get('ai_pre_review_reasons', []), 'conflict': (r.get('source'), r.get('target')) in conflict_pairs, 'hop': edge_hop(r), 'context_match': bool(r.get('source') in contextual_nodes or r.get('target') in contextual_nodes)} for r in visible_edges[:12]]
    graph_paths = []
    def explain_path(edge):
        source, target = edge.get('source'), edge.get('target')
        source_name = entities.get(source, {}).get('name', source)
        target_name = entities.get(target, {}).get('name', target)
        relation = edge.get('type', 'related_to')
        causal = edge.get('causal_status', 'unknown')
        wording = '存在统计关联' if causal == 'association' else '指南/证据支持该管理关系' if causal in ('guidance', 'causal') else '关系方向需要审核'
        return {
            'nodes': [source, target], 'node_labels': [source_name, target_name],
            'relation': relation, 'strength': edge.get('strength'),
            'evidence': edge.get('evidence'), 'evidence_ids': edge.get('evidence_ids') or [edge.get('evidence')],
            'evidence_level': edge.get('evidence_level'), 'population': edge.get('population'),
            'condition': edge.get('condition'), 'causal_status': causal, 'source_review_required': bool(source_flag_enabled and edge_is_legacy_pending(edge)),
            'review_status': edge.get('review_status'), 'ai_pre_review_status': pre_review_by_index.get(edge.get('_relation_index'), {}).get('ai_pre_review_status'), 'ai_pre_review_reasons': pre_review_by_index.get(edge.get('_relation_index'), {}).get('ai_pre_review_reasons', []), 'hop': edge_hop(edge),
            'explanation': f"{source_name} —[{relation}]→ {target_name}：{wording}；依据 {edge.get('evidence')}。"
        }
    for edge in visible_edges:
        if edge.get('source') in graph_seeds and edge.get('target') in entities:
            graph_paths.append(explain_path(edge))
    for edge in visible_edges:
        if edge.get('source') not in graph_seeds and edge.get('target') not in graph_seeds:
            graph_paths.append(explain_path(edge))
    personalization = build_personalization(context, disease, recommendations)
    safety_flags = build_safety_flags(context, question, recommendations)
    evidence_scores = [EVIDENCE_LEVELS.get(x.get('evidence_level'), 0) for x in results]
    uncertainty = {'level': 'high' if evidence_scores and max(evidence_scores) >= 4 and recommendations else 'medium' if results else 'low', 'reasons': []}
    if not results: uncertainty['reasons'].append('未召回足够证据')
    if not context.get('latest'): uncertainty['reasons'].append('缺少用户近期指标')
    quality = context.get('data_completeness') or {}
    if quality.get('quality_flags') or quality.get('measurement_condition_missing'):
        uncertainty['level'] = 'medium' if uncertainty['level'] == 'high' else uncertainty['level']
        if quality.get('quality_flags'): uncertainty['reasons'].append('存在测量质量标记')
        if quality.get('measurement_condition_missing'): uncertainty['reasons'].append('部分记录缺少测量条件')
    citations = [{'citation': x['citation'], 'source_url': x.get('source_url', ''), 'publisher': x.get('publisher', ''), 'publication_year': x.get('publication_year', ''), 'evidence_level': x.get('evidence_level', ''), 'review_status': x.get('review_status', ''), 'source_review_required': x.get('source_review_required', False)} for x in results]
    requested_backend = options.get('backend', 'local_hybrid')
    caps = capabilities(requested_backend)
    return {'query': question, 'disease': disease, 'results': results, 'recommendations': recommendations, 'weekly_plan': weekly_plan, 'graph_context': graph_context,
            'graph_paths': graph_paths[:12], 'personalization': personalization, 'safety_flags': safety_flags,
            'uncertainty': uncertainty, 'citations': citations,
            'evidence_conflicts': evidence_conflicts.get('conflicts', []),
            'medical_gate': {'audience': audience, 'blocked_edge_count': blocked_edge_count, 'policy': '老人端过滤待临床确认关系；明确 legacy 待复核来源默认只标记并降权，严格模式才排除；urgent_signal/emergency_action仅作为安全提示保留；医生/审计视图保留完整关系'},
            'retrieval_trace': {'lexical_terms': sorted(qtokens)[:20], 'graph_seeds': sorted(graph_seeds), 'contextual_nodes': sorted(contextual_nodes), 'graph_edges': len(graph_edges), 'blocked_edge_count': blocked_edge_count, 'direct_edges': len(direct_edges), 'expanded_nodes': len(expanded_nodes), 'chunks_considered': len(chunks), 'excluded_legacy_pending_chunks': excluded_legacy_chunks, 'flagged_legacy_pending_results': sum(1 for x in results if x.get('source_review_required')), 'source_gate': source_gate, 'source_gate_enabled': source_gate_enabled, 'source_flag_enabled': source_flag_enabled, 'top_k': top_k, 'max_hops': max_hops, 'audience': audience, 'evidence_levels': sorted({x.get('evidence_level') for x in results}), 'conflict_pairs': [list(x) for x in sorted(conflict_pairs)], 'conflict_count': len(evidence_conflicts.get('conflicts', [])), 'pre_review_count': len(medical_pre_review.get('relations', [])), 'pre_review_statuses': medical_pre_review.get('counts', {}), 'ranking': 'lexical+graph+context+authority-freshness-conflict+source-review-flag+medical-gate'},
            'index_version': INDEX_VERSION, 'graph_mode': caps.backend, 'retrieval_capabilities': caps.__dict__, 'disclaimer': '知识检索用于解释和健康教育，不替代医生诊断。'}

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
    sub.add_parser('build')
    q = sub.add_parser('query'); q.add_argument('--question', required=True); q.add_argument('--disease')
    args = ap.parse_args()
    out = build() if args.cmd == 'build' else query(args.question, args.disease)
    print(json.dumps(out, ensure_ascii=False))
if __name__ == '__main__': main()
