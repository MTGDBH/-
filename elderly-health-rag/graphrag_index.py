# -*- coding: utf-8 -*-
"""轻量、可审计的本地 GraphRAG 索引与查询服务（仅标准库）。"""
import argparse, hashlib, json, math, re, sys
from pathlib import Path

ROOT = Path(__file__).parent
INPUT = ROOT / 'input' / 'guidelines'
OUTPUT = ROOT / 'output'
RELATIONS_FILE = ROOT / 'input' / 'relations.json'
DISEASE_ALIASES = {
    'hypertension': ['高血压', '血压'], 'diabetes': ['糖尿病', '血糖'],
    'heart_disease': ['心脏病', '心血管', '胸痛'], 'stroke': ['脑卒中', '中风', '单侧无力'],
}
ENTITY_TERMS = {
    'measurement': ['血压', '血糖', '血脂', '体重', '活动', '睡眠'],
    'risk_factor': ['吸烟', '盐', '体重', '血压', '血糖', '血脂'],
    'intervention': ['复测', '记录', '减少盐', '活动', '睡眠', '联系家属', '就医'],
    'danger_sign': ['胸痛', '呼吸困难', '意识改变', '单侧无力', '言语不清', '意识模糊'],
}

ENTITY_LABELS = {
    'disease': '疾病', 'risk_factor': '风险因素', 'metric': '指标',
    'intervention': '干预', 'symptom': '症状', 'complication': '并发症',
    'behavior': '行为', 'population': '人群',
}

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
    for path in sorted(INPUT.glob('*.md')):
        text = path.read_text(encoding='utf-8')
        metadata = parse_metadata(text)
        source_manifest.append({'file': path.name, 'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
                                'source_url': metadata.get('source_url', ''), 'publisher': metadata.get('publisher', metadata.get('source', '')),
                                'publication_year': metadata.get('publication_year', ''), 'document_type': metadata.get('document_type', 'guideline_note'),
                                'evidence_level': metadata.get('evidence_level', 'public_guidance'),
                                'review_status': metadata.get('review_status', '演示知识，需医学审核后生产使用')})
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
    # 显式关系是图谱的主干：疾病、风险因素、指标、并发症和干预之间的边必须带出处和强度。
    for row in load_relations():
        if not row.get('source') or not row.get('target') or not row.get('type'): continue
        for entity_id in (row['source'], row['target']):
            if entity_id not in entities: entities[entity_id] = entity_from_id(entity_id)
        rel = dict(row)
        rel['chunk_id'] = relation_chunk_id(row.get('evidence'), chunks)
        relationships.append(rel)
    for ent in entities.values():
        ent['chunk_ids'] = sorted({r['chunk_id'] for r in relationships if r.get('chunk_id') and (r.get('target') == ent['id'] or r.get('source') == ent['id'])})
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT/'chunks.json').write_text(json.dumps(chunks, ensure_ascii=False, indent=2), encoding='utf-8')
    (OUTPUT/'entities.json').write_text(json.dumps(list(entities.values()), ensure_ascii=False, indent=2), encoding='utf-8')
    (OUTPUT/'relationships.json').write_text(json.dumps(relationships, ensure_ascii=False, indent=2), encoding='utf-8')
    communities = []
    for disease in DISEASE_ALIASES:
        ids = [e['id'] for e in entities.values() if e['id'] == f'disease:{disease}' or e['id'] in {r['target'] for r in relationships if r['source'] == f'disease:{disease}'}]
        communities.append({'id': f'community:{disease}', 'disease': disease, 'entity_ids': sorted(ids), 'entity_count': len(ids), 'chunk_count': len([c for c in chunks if c['disease'] == disease])})
    (OUTPUT/'communities.json').write_text(json.dumps(communities, ensure_ascii=False, indent=2), encoding='utf-8')
    (OUTPUT/'source_manifest.json').write_text(json.dumps(source_manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'chunks': len(chunks), 'entities': len(entities), 'relationships': len(relationships), 'communities': len(communities), 'sources': len(source_manifest)}

def query(question, disease=None, top_k=4):
    if not (OUTPUT/'chunks.json').exists(): build()
    chunks = json.loads((OUTPUT/'chunks.json').read_text(encoding='utf-8'))
    relationships = json.loads((OUTPUT/'relationships.json').read_text(encoding='utf-8')) if (OUTPUT/'relationships.json').exists() else []
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
    graph_edges = [r for r in relationships if r.get('source') in graph_seeds or r.get('target') in graph_seeds]
    graph_chunk_ids = {r.get('chunk_id') for r in graph_edges if r.get('chunk_id')}
    scored = []
    for c in chunks:
        if disease and c['disease'] != disease and not (disease in ('heart_disease', 'stroke') and c['disease'] == 'cardiovascular'):
            # 关系型问题允许把图中相邻疾病的权威证据带入结果，避免只回答单病种模板。
            if not relation_query or c['disease'] not in related_diseases: continue
        overlap = len(qtokens & set(c['tokens']))
        alias_bonus = sum(1 for x in aliases if x in c['text'])
        danger_bonus = 2 if any(x in question for x in ENTITY_TERMS['danger_sign']) and any(x in c['text'] for x in ENTITY_TERMS['danger_sign']) else 0
        graph_bonus = 4 if c['id'] in graph_chunk_ids else 0
        authority_bonus = 1 if c.get('evidence_level') in ('authoritative_guidance', 'professional_guideline', 'professional_statement', 'clinical_standard') else 0
        score = overlap + alias_bonus * 2 + danger_bonus + graph_bonus + authority_bonus
        if score: scored.append((score, c))
    scored.sort(key=lambda x: (-x[0], x[1]['id']))
    results = []
    for s, c in scored[:top_k]:
        support = [r for r in graph_edges if r.get('chunk_id') == c['id']]
        results.append({'chunk_id': c['id'], 'disease': c['disease'], 'section': c['section'], 'text': c['text'], 'source': c['source'], 'citation': c['citation'], 'evidence_level': c['evidence_level'], 'publisher': c.get('publisher', ''), 'publication_year': c.get('publication_year', ''), 'source_url': c.get('source_url', ''), 'score': round(s / max(1, len(qtokens)), 3), 'graph_support': [{'type': r.get('type'), 'target': r.get('target'), 'strength': r.get('strength'), 'evidence': r.get('evidence')} for r in support]})
    context = globals().get('_QUERY_CONTEXT', {}) or {}
    recommendations = derive_recommendations(disease, context, question)
    graph_edges = sorted(graph_edges, key=lambda r: (r.get('type') == 'mentions', r.get('strength') != 'high', r.get('evidence', '')))
    graph_context = [{'source': r.get('source'), 'target': r.get('target'), 'type': r.get('type'), 'strength': r.get('strength'), 'evidence': r.get('evidence')} for r in graph_edges[:20]]
    return {'query': question, 'disease': disease, 'results': results, 'recommendations': recommendations, 'graph_context': graph_context,
            'retrieval_trace': {'lexical_terms': sorted(qtokens)[:20], 'graph_seeds': sorted(graph_seeds), 'graph_edges': len(graph_edges), 'chunks_considered': len(chunks), 'top_k': top_k},
            'graph_mode': 'local_hybrid', 'disclaimer': '知识检索用于解释和健康教育，不替代医生诊断。'}

def derive_recommendations(disease, context, question):
    """把图谱证据转成结构化行动；LLM只能解释这些行动，不能凭空添加数值。"""
    latest = (context or {}).get('latest') or {}
    behavior = (context or {}).get('behavior') or {}
    profile = (context or {}).get('profile') or {}
    recs = []
    bp = latest.get('bp') or {}
    systo, diasto = bp.get('value'), bp.get('value2')
    if disease == 'hypertension':
        if isinstance(systo, (int, float)) and isinstance(diasto, (int, float)) and (systo >= 180 or diasto >= 120):
            recs.append({'priority': 'urgent', 'action': '立即安静休息并重新测量；若伴胸痛、呼吸困难、意识改变或单侧无力，立即呼叫急救。', 'reason': '当前血压达到危险信号门槛', 'evidence': 'who_hypertension_2025.md#并发症'})
        elif isinstance(systo, (int, float)) and isinstance(diasto, (int, float)) and (systo >= 140 or diasto >= 90):
            recs.append({'priority': 'high', 'action': '今天固定时间复测两次并记录；若连续多次偏高，联系医务人员评估。', 'reason': f'最近一次血压 {systo}/{diasto} mmHg 偏高', 'evidence': 'who_hypertension_2025.md#识别与复测'})
        elif latest.get('bp'):
            recs.append({'priority': 'normal', 'action': '继续固定时间测量并记录，观察连续趋势，不因单次波动自行调整用药。', 'reason': '已有血压记录但当前未触发高风险规则', 'evidence': 'who_hypertension_2025.md#识别与复测'})
        if profile.get('smoking_status') not in (None, 0, '0', False):
            recs.append({'priority': 'high', 'action': '把减少烟草暴露列为近期重点；如果需要，和医生讨论戒烟支持。', 'reason': '个人档案显示存在烟草暴露', 'evidence': 'who_hypertension_2025.md#危险因素'})
        if isinstance(profile.get('exercise_level'), (int, float)) and profile['exercise_level'] < 60:
            recs.append({'priority': 'normal', 'action': '在活动耐受允许时，从短时散步或舒缓活动开始，逐步减少久坐；出现不适先停止并咨询医生。', 'reason': '个人档案显示每周活动量偏少', 'evidence': 'older_physical_activity_review_2022.md#系统使用边界'})
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
    sleep = behavior.get('sleep') or {}
    if isinstance(sleep.get('rolling_7d_average'), (int, float)) and sleep['rolling_7d_average'] < 6:
        recs.append({'priority': 'normal', 'action': '先固定上床和起床时间，连续记录一周睡眠；不要把睡眠波动当作疾病预测。', 'reason': '近7天睡眠平均偏少', 'evidence': 'aha_lifes_essential_8_2022.md#八项指标'})
    elif isinstance(sleep.get('rolling_7d_average'), (int, float)):
        recs.append({'priority': 'normal', 'action': '继续保持相对固定的作息，记录睡眠质量；如白天仍明显困倦，再和医生讨论原因。', 'reason': '近7天睡眠平均达到基本观察水平', 'evidence': 'aha_lifes_essential_8_2022.md#八项指标'})
    return recs[:4]

def main():
    # 服务端通过 stdin 传 JSON，命令行仍保留 build/query 入口。
    raw = sys.stdin.buffer.read()
    if raw.strip():
        try:
            req = json.loads(raw.decode('utf-8'))
            globals()['_QUERY_CONTEXT'] = req.get('context') or {}
            print(json.dumps(query(req.get('question', ''), req.get('disease')), ensure_ascii=False)); return
        except Exception as exc:
            print(json.dumps({'success': False, 'error': type(exc).__name__}, ensure_ascii=False)); return
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('build')
    q = sub.add_parser('query'); q.add_argument('--question', required=True); q.add_argument('--disease')
    args = ap.parse_args()
    out = build() if args.cmd == 'build' else query(args.question, args.disease)
    print(json.dumps(out, ensure_ascii=False))
if __name__ == '__main__': main()
