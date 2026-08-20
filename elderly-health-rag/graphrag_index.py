# -*- coding: utf-8 -*-
"""轻量、可审计的本地 GraphRAG 索引与查询服务（仅标准库）。"""
import argparse, hashlib, json, math, re, sys
from pathlib import Path

ROOT = Path(__file__).parent
INPUT = ROOT / 'input' / 'guidelines'
OUTPUT = ROOT / 'output'
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
        source_manifest.append({'file': path.name, 'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(), 'review_status': '演示知识，需医学审核后生产使用'})
        sections = re.split(r'\n(?=## )', text)
        disease = path.stem
        for idx, section in enumerate(sections):
            lines = section.strip().splitlines()
            if not lines: continue
            title = lines[0].lstrip('# ').strip()
            body = '\n'.join(lines[1:]).strip()
            if not body or title.startswith('source:'): continue
            cid = f'{disease}:{idx}'
            chunk = {'id': cid, 'disease': disease, 'section': title, 'text': body,
                     'source': path.name, 'citation': f'{path.name}#{title}', 'evidence_level': 'public_guidance', 'tokens': sorted(tokenize(body))}
            chunks.append(chunk)
            dkey = f'disease:{disease}'
            entities[dkey] = {'id': dkey, 'type': 'disease', 'name': disease}
            for etype, terms in ENTITY_TERMS.items():
                for term in terms:
                    if term in body:
                        key = f'{etype}:{term}'
                        entities[key] = {'id': key, 'type': etype, 'name': term}
                        relationships.append({'source': dkey, 'target': key, 'type': 'mentions', 'chunk_id': cid, 'evidence': f'{path.name}#{title}'})
    for ent in entities.values():
        ent['chunk_ids'] = sorted({r['chunk_id'] for r in relationships if r['target'] == ent['id']})
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
    qtokens = tokenize(question)
    aliases = set(DISEASE_ALIASES.get(disease or '', []))
    scored = []
    for c in chunks:
        if disease and c['disease'] != disease and not (disease in ('heart_disease', 'stroke') and c['disease'] == 'cardiovascular'): continue
        overlap = len(qtokens & set(c['tokens']))
        alias_bonus = sum(1 for x in aliases if x in c['text'])
        danger_bonus = 2 if any(x in question for x in ENTITY_TERMS['danger_sign']) and any(x in c['text'] for x in ENTITY_TERMS['danger_sign']) else 0
        score = overlap + alias_bonus * 2 + danger_bonus
        if score: scored.append((score, c))
    scored.sort(key=lambda x: (-x[0], x[1]['id']))
    results = []
    for s, c in scored[:top_k]:
        results.append({'chunk_id': c['id'], 'disease': c['disease'], 'section': c['section'], 'text': c['text'], 'source': c['source'], 'citation': c['citation'], 'evidence_level': c['evidence_level'], 'score': round(s / max(1, len(qtokens)), 3)})
    context = globals().get('_QUERY_CONTEXT', {}) or {}
    recommendations = derive_recommendations(disease, context, question)
    return {'query': question, 'disease': disease, 'results': results, 'recommendations': recommendations,
            'retrieval_trace': {'lexical_terms': sorted(qtokens)[:20], 'chunks_considered': len(chunks), 'top_k': top_k},
            'graph_mode': 'local_hybrid', 'disclaimer': '知识检索用于解释和健康教育，不替代医生诊断。'}

def derive_recommendations(disease, context, question):
    """把图谱证据转成结构化行动；LLM只能解释这些行动，不能凭空添加数值。"""
    latest = (context or {}).get('latest') or {}
    behavior = (context or {}).get('behavior') or {}
    recs = []
    bp = latest.get('bp') or {}
    systo, diasto = bp.get('value'), bp.get('value2')
    if disease == 'hypertension':
        if isinstance(systo, (int, float)) and isinstance(diasto, (int, float)) and (systo >= 180 or diasto >= 120):
            recs.append({'priority': 'urgent', 'action': '立即安静休息并重新测量；若伴胸痛、呼吸困难、意识改变或单侧无力，立即呼叫急救。', 'reason': '当前血压达到危险信号门槛', 'evidence': 'hypertension.md#危险信号'})
        elif isinstance(systo, (int, float)) and isinstance(diasto, (int, float)) and (systo >= 140 or diasto >= 90):
            recs.append({'priority': 'high', 'action': '今天固定时间复测两次并记录；若连续多次偏高，联系医务人员评估。', 'reason': f'最近一次血压 {systo}/{diasto} mmHg 偏高', 'evidence': 'hypertension.md#识别与复测'})
        elif latest.get('bp'):
            recs.append({'priority': 'normal', 'action': '继续固定时间测量并记录，观察连续趋势，不因单次波动自行调整用药。', 'reason': '已有血压记录但当前未触发高风险规则', 'evidence': 'hypertension.md#识别与复测'})
    if disease == 'diabetes':
        glucose = (latest.get('glucose') or {}).get('value')
        if isinstance(glucose, (int, float)) and glucose >= 7:
            recs.append({'priority': 'high', 'action': '确认这次是否为空腹测量，按同一条件复测并联系医生评估。', 'reason': f'记录血糖 {glucose} mmol/L 需要结合测量条件复核', 'evidence': 'diabetes.md#监测'})
        elif latest.get('glucose'):
            recs.append({'priority': 'normal', 'action': '继续按相同测量条件记录血糖，补充餐前/餐后信息，便于医生判断。', 'reason': '血糖需要结合测量时点解释', 'evidence': 'diabetes.md#监测'})
    if disease in ('heart_disease', 'stroke') and any(x in question for x in ENTITY_TERMS['danger_sign']):
        recs.append({'priority': 'urgent', 'action': '出现胸痛、呼吸困难、单侧无力或言语不清时立即呼叫急救并通知家属。', 'reason': '问题包含危险信号关键词', 'evidence': 'cardiovascular.md#危险信号'})
    sleep = behavior.get('sleep') or {}
    if isinstance(sleep.get('rolling_7d_average'), (int, float)) and sleep['rolling_7d_average'] < 6:
        recs.append({'priority': 'normal', 'action': '先固定上床和起床时间，连续记录一周睡眠；不要把睡眠波动当作疾病预测。', 'reason': '近7天睡眠平均偏少', 'evidence': 'hypertension.md#生活方式'})
    elif isinstance(sleep.get('rolling_7d_average'), (int, float)):
        recs.append({'priority': 'normal', 'action': '继续保持相对固定的作息，记录睡眠质量；如白天仍明显困倦，再和医生讨论原因。', 'reason': '近7天睡眠平均达到基本观察水平', 'evidence': 'hypertension.md#生活方式'})
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
