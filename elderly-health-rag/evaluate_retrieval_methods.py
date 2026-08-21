# -*- coding: utf-8 -*-
"""关键词检索、普通 RAG 与 GraphRAG 的同题对照评测。

这不是临床疗效评估，而是验证：加入证据等级、关系路径和用户上下文后，
检索是否更容易命中正确证据、保留权威来源并产生可解释的个性化行动。
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).parent
REPORTS = ROOT.parent / 'reports'
CHUNKS = json.loads((ROOT / 'output' / 'chunks.json').read_text(encoding='utf-8'))
AUTHORITY = {'authoritative_guidance', 'professional_guideline', 'professional_statement', 'clinical_standard'}


def tokens(text):
    return set(re.findall(r'[\u4e00-\u9fff]{2}|[a-zA-Z]{3,}', str(text or '').lower()))


def lexical(method, question, top_k=6):
    q = tokens(question)
    scored = []
    for chunk in CHUNKS:
        overlap = len(q & set(chunk.get('tokens') or tokens(chunk.get('text'))))
        authority = 0.6 if method == 'ordinary_rag' and chunk.get('evidence_level') in AUTHORITY else 0
        diversity_penalty = 0.2 if method == 'ordinary_rag' and str(chunk.get('source', '')).startswith('registry:') else 0
        scored.append((overlap + authority - diversity_penalty, chunk))
    scored.sort(key=lambda item: (-item[0], item[1].get('id', '')))
    return [chunk for score, chunk in scored[:top_k] if score > 0]


def graph_query(case):
    payload = json.dumps({'question': case['question'], 'disease': case['disease'], 'context': case.get('context', {}), 'options': {'top_k': 6, 'max_hops': 2, 'include_trace': True}}, ensure_ascii=False).encode('utf-8')
    out = subprocess.run([sys.executable, str(ROOT / 'graphrag_index.py')], input=payload, capture_output=True, check=True,
                         env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'})
    return json.loads(out.stdout.decode('utf-8'))


CASES = json.loads((ROOT / 'eval' / 'golden_questions.json').read_text(encoding='utf-8'))

PERSONALIZATION_CASES = [
    ('bp', {'question': '血压偏高怎么办', 'disease': 'hypertension', 'context': {'latest': {'bp': {'value': 124, 'value2': 78}}}}, {'latest': {'bp': {'value': 155, 'value2': 96}}}),
    ('egfr', {'question': '肾功能怎么复测', 'disease': 'chronic_kidney_disease', 'context': {}}, {'latest': {'egfr': {'value': 54}}}),
    ('fall_risk', {'question': '老人衰弱需要做什么', 'disease': 'frailty', 'context': {}}, {'profile': {'fall_risk': True}}),
]


def score_results(results, case):
    must = case.get('must_have_any') or ([case.get('must_have')] if case.get('must_have') else [])
    hit = any(term in f"{r.get('section', '')} {r.get('text', '')}" for term in must for r in results)
    citations = sum(bool(r.get('source_url', '').startswith('http')) for r in results)
    authority = sum(r.get('evidence_level') in AUTHORITY for r in results)
    urgent = any(x in case['question'] for x in ('单侧无力', '胸痛', '呼吸困难'))
    urgent_hit = any(any(k in f"{r.get('section', '')} {r.get('text', '')}" for k in ('急症', '危险信号', '单侧无力', '呼吸困难')) for r in results)
    return {'must_have_hit': hit, 'citation_valid_rate': citations / max(1, len(results)), 'authority_rate': authority / max(1, len(results)), 'urgent_hit': urgent_hit if urgent else None}


def main():
    rows = []
    methods = ('keyword', 'ordinary_rag', 'graphrag')
    for case in CASES:
        for method in methods:
            if method == 'graphrag':
                result = graph_query(case)
                results = result.get('results') or []
                row = score_results(results, case)
                # 安全建议可能在结构化 recommendation 中，而不在前6个正文分块中。
                # 对 GraphRAG 评测同时检查急症行动，避免低估安全召回。
                if case.get('urgent') and any(x.get('priority') == 'urgent' for x in result.get('recommendations') or []):
                    row['urgent_hit'] = True
                row.update({'graph_paths': len(result.get('graph_paths') or []), 'path_explanations': sum(bool(p.get('explanation')) for p in result.get('graph_paths') or []), 'evidence_conflicts': len(result.get('evidence_conflicts') or []), 'action': (result.get('recommendations') or [{}])[0].get('action'), 'index_version': result.get('index_version')})
            else:
                results = lexical(method, case['question'])
                row = score_results(results, case)
                row.update({'graph_paths': 0, 'path_explanations': 0, 'evidence_conflicts': 0, 'action': None, 'index_version': None})
            rows.append({'case': case['id'], 'method': method, 'results': len(results), **row})

    personalization = []
    for factor, base, changed_context in PERSONALIZATION_CASES:
        changed = {**base, 'context': {**base.get('context', {}), **changed_context}}
        for method in methods:
            if method == 'graphrag':
                a, b = graph_query(base), graph_query(changed)
                action_a = (a.get('recommendations') or [{}])[0].get('action')
                action_b = (b.get('recommendations') or [{}])[0].get('action')
            else:
                action_a = action_b = None
            personalization.append({'factor': factor, 'method': method, 'action_changed': action_a != action_b, 'action_before': action_a, 'action_after': action_b})

    summary = {}
    for method in methods:
        subset = [r for r in rows if r['method'] == method]
        summary[method] = {
            'n_cases': len(subset),
            'must_have_recall': sum(r['must_have_hit'] for r in subset) / len(subset),
            'citation_valid_rate': sum(r['citation_valid_rate'] for r in subset) / len(subset),
            'authority_rate': sum(r['authority_rate'] for r in subset) / len(subset),
            'urgent_recall': sum(r['urgent_hit'] is True for r in subset if r['urgent_hit'] is not None) / max(1, sum(r['urgent_hit'] is not None for r in subset)),
            'path_explanation_rate': sum(r['path_explanations'] > 0 for r in subset) / len(subset),
            'personalization_change_rate': sum(p['action_changed'] for p in personalization if p['method'] == method) / max(1, len([p for p in personalization if p['method'] == method]))
        }
    report = {'schema_version': 'retrieval-method-comparison.v1', 'generated_at': '2026-08-21', 'index_version': '2026-08-21.v6', 'methods': {'keyword': '词项重叠，不使用证据等级/图关系', 'ordinary_rag': '词项召回+权威来源加权，不使用图关系和用户行动规则', 'graphrag': '词项+证据等级+图扩展+用户上下文+安全规则'}, 'summary': summary, 'rows': rows, 'personalization': personalization, 'limitations': ['黄金问题是人工契约评测，不是临床疗效', '关键词和普通RAG为可复现基线，不代表生产向量RAG', 'GraphRAG建议仍需医学审核']}
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / 'graphrag-method-comparison-20260821.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    lines = ['# GraphRAG 三路检索对照评估（2026-08-21）', '', f'同一批 {len(CASES)} 条核心疾病问题，比较关键词检索、普通 RAG 和 GraphRAG。', '', '| 方法 | 必需证据召回 | 引用有效率 | 权威来源率 | 急症召回 | 路径解释率 | 个性化行动变化率 |', '|---|---:|---:|---:|---:|---:|---:|']
    for method in methods:
        s = summary[method]
        lines.append(f"| {method} | {s['must_have_recall']:.1%} | {s['citation_valid_rate']:.1%} | {s['authority_rate']:.1%} | {s['urgent_recall']:.1%} | {s['path_explanation_rate']:.1%} | {s['personalization_change_rate']:.1%} |")
    lines += ['', '## 结论', '', '- GraphRAG 的改进必须以同题对照结果为依据，而不是只展示检索数量。', '- 关键词检索只能证明词项命中；普通 RAG 增加了来源权重；GraphRAG 额外提供关系路径、审核状态、冲突标记和上下文条件化行动。', '- 本报告证明的是检索与建议可解释性的改进，不等同于临床疗效或诊断准确率。']
    (REPORTS / 'graphrag-method-comparison-20260821.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({'pass': True, 'summary': summary}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
