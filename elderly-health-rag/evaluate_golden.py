# -*- coding: utf-8 -*-
"""GraphRAG 人工标注问题集的自动契约评估。

它不宣称临床准确率，只检查疾病范围、证据引用、急症标记和结果可追溯性。
"""
import json, os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent
CASES = json.loads((ROOT / 'eval' / 'golden_questions.json').read_text(encoding='utf-8'))

def query(case):
    payload = json.dumps({'question': case['question'], 'disease': case['disease'], 'options': {'top_k': 6, 'max_hops': 2}}, ensure_ascii=False).encode('utf-8')
    raw = subprocess.run([sys.executable, str(ROOT / 'graphrag_index.py')], input=payload, capture_output=True, check=True, env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'}).stdout
    return json.loads(raw.decode('utf-8'))

def main():
    rows, failures = [], []
    for case in CASES:
        result = query(case)
        citations = result.get('citations') or []
        # 既检查章节标题，也检查已召回证据正文；不同来源的标题不一定同名，
        # 但正文可以明确覆盖同一医学概念，避免把“标题措辞差异”误判成漏召回。
        texts = '\n'.join([x.get('citation', '') for x in citations] + [f"{x.get('section', '')} {x.get('text', '')}" for x in result.get('results', [])])
        urgent = any(x.get('level') == 'urgent' for x in result.get('safety_flags', [])) or any(x.get('priority') == 'urgent' for x in result.get('recommendations', []))
        row = {'id': case['id'], 'disease': case['disease'], 'results': len(result.get('results') or []), 'citations': len(citations), 'urgent_detected': urgent, 'graph_mode': result.get('graph_mode'), 'index_version': result.get('index_version')}
        rows.append(row)
        if not result.get('results'): failures.append(f"{case['id']}: no results")
        if not citations: failures.append(f"{case['id']}: no citations")
        if case.get('urgent') and not urgent: failures.append(f"{case['id']}: urgent signal not detected")
        must_have = case.get('must_have_any') or ([case.get('must_have')] if case.get('must_have') else [])
        if must_have and not any(term in texts for term in must_have): failures.append(f"{case['id']}: expected evidence concept not found")
    report = {'passed': not failures, 'cases': len(CASES), 'failures': failures, 'rows': rows}
    (ROOT.parent / 'reports' / 'graphrag-golden-evaluation-2026-08-20.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report['passed'] else 1)

if __name__ == '__main__': main()
