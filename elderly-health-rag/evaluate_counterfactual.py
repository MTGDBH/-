# -*- coding: utf-8 -*-
"""逐因素反事实评估：只改变一个用户变量，观察建议是否只在相关维度变化。"""
import json, os, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).parent

CASES = [
    ('bp_only', '血压偏高怎么办', 'hypertension', {'latest': {'bp': {'value': 124, 'value2': 78}}}, {'latest': {'bp': {'value': 155, 'value2': 96}}}, 'bp'),
    ('egfr_only', '肾功能怎么复测', 'chronic_kidney_disease', {'latest': {'egfr': {'value': 90}}}, {'latest': {'egfr': {'value': 54}}}, 'egfr'),
    ('fall_risk_only', '老人衰弱需要注意什么', 'frailty', {'profile': {'fall_risk': 0}}, {'profile': {'fall_risk': 1}}, 'fall_risk'),
    ('sleep_only', '最近睡眠怎么样', 'hypertension', {'behavior': {'sleep': {'rolling_7d_average': 7.2}}}, {'behavior': {'sleep': {'rolling_7d_average': 5.2}}}, 'sleep'),
]

def run(question, disease, context):
    payload = json.dumps({'question': question, 'disease': disease, 'context': context}, ensure_ascii=False).encode('utf-8')
    raw = subprocess.run([sys.executable, str(ROOT / 'graphrag_index.py')], input=payload, capture_output=True, check=True, env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'}).stdout
    return json.loads(raw.decode('utf-8'))

def main():
    rows, failures = [], []
    for name, question, disease, baseline_ctx, changed_ctx, factor in CASES:
        a, b = run(question, disease, baseline_ctx), run(question, disease, changed_ctx)
        aa = (a.get('recommendations') or [{}])[0]
        bb = (b.get('recommendations') or [{}])[0]
        changed = aa.get('action') != bb.get('action') or aa.get('priority') != bb.get('priority')
        rows.append({'case': name, 'factor': factor, 'baseline_priority': aa.get('priority'), 'changed_priority': bb.get('priority'), 'baseline_action': aa.get('action'), 'changed_action': bb.get('action'), 'changed': changed})
        if not changed: failures.append(f'{name}: changing {factor} did not change priority/action')
    report = {'passed': not failures, 'cases': len(CASES), 'changed_count': sum(x['changed'] for x in rows), 'change_rate': round(sum(x['changed'] for x in rows) / len(rows), 3), 'failures': failures, 'rows': rows}
    (ROOT.parent / 'reports' / 'graphrag-counterfactual-2026-08-20.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report['passed'] else 1)

if __name__ == '__main__': main()
