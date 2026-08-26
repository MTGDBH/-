# -*- coding: utf-8 -*-
"""20 组配对老人上下文评测。

每组只改变一个健康因素，比较 GraphRAG 的首要行动、优先级、证据和个性化理由。
这是建议差异/可追溯性的工程评测，不是临床疗效研究。
"""
import json, os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent
EXPECTED_PRE_REVIEW = len(json.loads((ROOT / 'output' / 'medical_pre_review.json').read_text(encoding='utf-8')).get('relations', []))
CASES = [
    ('bp_01', '血压最近怎么样', 'hypertension', {'latest': {'bp': {'value': 128, 'value2': 80}}}, {'latest': {'bp': {'value': 152, 'value2': 94}}}, 'bp'),
    ('bp_02', '血压需要复测吗', 'hypertension', {'latest': {'bp': {'value': 135, 'value2': 84}}}, {'latest': {'bp': {'value': 181, 'value2': 121}}}, 'bp'),
    ('bp_03', '高血压今天应该做什么', 'hypertension', {'latest': {'bp': {'value': 130, 'value2': 82}}}, {'latest': {'bp': {'value': 145, 'value2': 92}}}, 'bp'),
    ('bp_04', '血压趋势如何解释', 'hypertension', {'latest': {'bp': {'value': 126, 'value2': 78}}}, {'latest': {'bp': {'value': 160, 'value2': 100}}}, 'bp'),
    ('bp_05', '我应该怎样记录血压', 'hypertension', {'latest': {'bp': {'value': 128, 'value2': 80}}}, {'latest': {'bp': {'value': 148, 'value2': 95}}}, 'bp'),
    ('glucose_01', '血糖最近怎么样', 'diabetes', {'latest': {'glucose': {'value': 5.8}}}, {'latest': {'glucose': {'value': 8.1}}}, 'glucose'),
    ('glucose_02', '血糖怎么复测', 'diabetes', {'latest': {'glucose': {'value': 6.2}}}, {'latest': {'glucose': {'value': 7.8}}}, 'glucose'),
    ('glucose_03', '糖尿病今天注意什么', 'diabetes', {'latest': {'glucose': {'value': 6.5}}}, {'latest': {'glucose': {'value': 9.0}}}, 'glucose'),
    ('glucose_04', '血糖记录是否异常', 'diabetes', {'latest': {'glucose': {'value': 6.0}}}, {'latest': {'glucose': {'value': 7.2}}}, 'glucose'),
    ('egfr_01', '肾功能需要复查吗', 'chronic_kidney_disease', {'latest': {'egfr': {'value': 90}}}, {'latest': {'egfr': {'value': 54}}}, 'egfr'),
    ('egfr_02', 'eGFR偏低怎么办', 'chronic_kidney_disease', {'latest': {'egfr': {'value': 82}}}, {'latest': {'egfr': {'value': 48}}}, 'egfr'),
    ('egfr_03', '肾功能和血压怎么一起看', 'chronic_kidney_disease', {'latest': {'egfr': {'value': 75}}}, {'latest': {'egfr': {'value': 55}, 'bp': {'value': 148, 'value2': 92}}}, 'egfr_and_bp'),
    ('fall_01', '老人衰弱要注意什么', 'frailty', {'profile': {'fall_risk': 0}}, {'profile': {'fall_risk': 1}}, 'fall_risk'),
    ('fall_02', '今天适合活动吗', 'frailty', {'profile': {'fall_risk': 0}}, {'profile': {'fall_risk': 1}}, 'fall_risk'),
    ('fall_03', '需要做功能评估吗', 'frailty', {'profile': {'fall_risk': 0}}, {'profile': {'fall_risk': 1}}, 'fall_risk'),
    ('sleep_01', '最近睡眠怎么样', 'hypertension', {'behavior': {'sleep': {'rolling_7d_average': 7.3}}}, {'behavior': {'sleep': {'rolling_7d_average': 5.1}}}, 'sleep'),
    ('sleep_02', '睡眠记录怎么改善', 'hypertension', {'behavior': {'sleep': {'rolling_7d_average': 7.0}}}, {'behavior': {'sleep': {'rolling_7d_average': 5.5}}}, 'sleep'),
    ('sleep_03', '睡眠会影响健康管理吗', 'hypertension', {'behavior': {'sleep': {'rolling_7d_average': 8.0}}}, {'behavior': {'sleep': {'rolling_7d_average': 4.8}}}, 'sleep'),
    ('smoking_01', '我近期应该注意什么', 'hypertension', {'latest': {'bp': {'value': 128, 'value2': 80}}, 'profile': {'smoking_status': 0}}, {'latest': {'bp': {'value': 128, 'value2': 80}}, 'profile': {'smoking_status': 1}}, 'smoking_status'),
    ('activity_01', '我最近活动量怎么样', 'hypertension', {'latest': {'bp': {'value': 128, 'value2': 80}}, 'profile': {'exercise_level': 120}}, {'latest': {'bp': {'value': 128, 'value2': 80}}, 'profile': {'exercise_level': 20}}, 'exercise_level'),
]


def run(question, disease, context):
    payload = json.dumps({'question': question, 'disease': disease, 'context': context, 'options': {'top_k': 6, 'include_trace': True}}, ensure_ascii=False).encode('utf-8')
    raw = subprocess.run([sys.executable, str(ROOT / 'graphrag_index.py')], input=payload, capture_output=True, check=True, env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'}).stdout
    return json.loads(raw.decode('utf-8'))


def signature(result):
    recs = result.get('recommendations') or []
    rec = recs[0] if recs else {}
    return {
        'priority': rec.get('priority'),
        'action': rec.get('action'),
        'evidence': rec.get('evidence'),
        'personalized_for': rec.get('personalized_for', []),
        'recommendation_fingerprint': [(x.get('priority'), x.get('action'), x.get('evidence'), x.get('personalized_for', [])) for x in recs],
        'pre_review_count': (result.get('retrieval_trace') or {}).get('pre_review_count', 0),
    }


def main():
    rows, failures = [], []
    for case_id, question, disease, base, changed, factor in CASES:
        a, b = run(question, disease, base), run(question, disease, changed)
        sa, sb = signature(a), signature(b)
        changed_fields = [field for field in ('priority', 'action', 'evidence', 'personalized_for', 'recommendation_fingerprint') if sa[field] != sb[field]]
        row = {'case': case_id, 'factor': factor, 'changed_fields': changed_fields, 'baseline': sa, 'changed_signature': sb, 'changed': bool(changed_fields)}
        rows.append(row)
        if not changed_fields:
            failures.append(f'{case_id}: changing {factor} did not change action/priority/evidence')
        if sa['pre_review_count'] != EXPECTED_PRE_REVIEW or sb['pre_review_count'] != EXPECTED_PRE_REVIEW:
            failures.append(f'{case_id}: pre-review context missing')
    report = {
        'schema_version': 'personalization-pairs.v1',
        'cases': len(CASES),
        'changed_count': sum(r['changed'] for r in rows),
        'change_rate': round(sum(r['changed'] for r in rows) / len(rows), 3),
        'failures': failures,
        'passed': not failures,
        'note': '工程个性化差异评测，不等同临床疗效或诊断准确率。',
        'rows': rows,
    }
    (ROOT.parent / 'reports' / 'graphrag-personalization-pairs-20260821.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    (ROOT.parent / 'reports' / 'graphrag-personalization-pairs-20260821.md').write_text(
        '# GraphRAG 20组配对老人个性化评测\n\n'
        f"样本：{len(CASES)} 组；建议发生变化：{report['changed_count']} 组；变化率：{report['change_rate']:.1%}。\n\n"
        f'> 该结果证明上下文会改变系统行动，不代表临床疗效。每次查询同时携带 {EXPECTED_PRE_REVIEW} 条高风险关系的预审核覆盖信息；该数量从预审核产物读取。\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('schema_version', 'cases', 'changed_count', 'change_rate', 'failures', 'passed')}, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()
