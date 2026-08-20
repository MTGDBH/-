# -*- coding: utf-8 -*-
"""GraphRAG 个性化与安全边界评估。

同一问题在不同健康上下文下查询，验证图谱层是否：
1) 返回可追溯的知识证据；
2) 按当前指标改变行动优先级和行动内容；
3) 对行为指标给出生活方式建议而不是医学未来预测。

该脚本只评估知识层，不把合成数据的结果宣称为临床效果。
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
REPORTS = ROOT.parent / 'reports'

CASES = [
    {
        'group': 'hypertension_same_question',
        'question': '血压偏高怎么办',
        'disease': 'hypertension',
        'variants': [
            ('urgent', {'latest': {'bp': {'value': 185, 'value2': 122}}}),
            ('high', {'latest': {'bp': {'value': 150, 'value2': 95}}}),
            ('normal', {'latest': {'bp': {'value': 124, 'value2': 79}}}),
        ],
    },
    {
        'group': 'diabetes_same_question',
        'question': '血糖怎么复测',
        'disease': 'diabetes',
        'variants': [
            ('high', {'latest': {'glucose': {'value': 8.1}}}),
            ('normal', {'latest': {'glucose': {'value': 5.4}}}),
        ],
    },
    {
        'group': 'behavior_boundary',
        'question': '最近睡眠怎么样',
        'disease': 'hypertension',
        'variants': [
            ('short_sleep', {'behavior': {'sleep': {'rolling_7d_average': 5.4}}}),
            ('adequate_sleep', {'behavior': {'sleep': {'rolling_7d_average': 7.2}}}),
        ],
    },
]


def run_query(question, disease, context):
    payload = json.dumps({'question': question, 'disease': disease, 'context': context}, ensure_ascii=False).encode('utf-8')
    proc = subprocess.run(
        [sys.executable, str(ROOT / 'graphrag_index.py')],
        input=payload,
        capture_output=True,
        check=True,
        env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'},
    )
    return json.loads(proc.stdout.decode('utf-8'))


def evaluate():
    rows = []
    failures = []
    ablation = []
    for case in CASES:
        baseline = run_query(case['question'], case['disease'], {})
        baseline_action = (baseline.get('recommendations') or [{}])[0].get('action')
        for label, context in case['variants']:
            result = run_query(case['question'], case['disease'], context)
            recs = result.get('recommendations') or []
            row = {
                'group': case['group'],
                'variant': label,
                'question': case['question'],
                'result_count': len(result.get('results') or []),
                'recommendation_count': len(recs),
                'priority': recs[0].get('priority') if recs else None,
                'action': recs[0].get('action') if recs else None,
                'reason': recs[0].get('reason') if recs else None,
                'evidence': recs[0].get('evidence') if recs else None,
                'graph_mode': result.get('graph_mode'),
                'has_trace': bool(result.get('retrieval_trace')),
            }
            rows.append(row)
            if not result.get('results'):
                failures.append(f"{case['group']}/{label}: 未返回知识证据")
            if not recs:
                failures.append(f"{case['group']}/{label}: 未返回行动建议")
            if not all(x.get('evidence') for x in recs):
                failures.append(f"{case['group']}/{label}: 行动缺少 evidence 引用")
            if result.get('graph_mode') != 'local_hybrid' or not result.get('retrieval_trace'):
                failures.append(f"{case['group']}/{label}: 缺少可审计检索轨迹")

        group_rows = [x for x in rows if x['group'] == case['group']]
        priorities = {x['priority'] for x in group_rows}
        actions = {x['action'] for x in group_rows}
        if len(priorities) < 2 and len(actions) < 2:
            failures.append(f"{case['group']}: 同一问题不同上下文没有产生可见差异")
        changed = sum(1 for row in group_rows if row['action'] != baseline_action)
        ablation.append({
            'group': case['group'],
            'baseline_action_without_context': baseline_action,
            'variants_with_context': len(group_rows),
            'changed_from_baseline': changed,
            'change_rate': round(changed / max(1, len(group_rows)), 3),
        })

    behavior_rows = [x for x in rows if x['group'] == 'behavior_boundary']
    if any(__import__('re').search(r'未来.{0,8}(会|达到|预测值)|\d+\s*天后', (x['action'] or '') + (x['reason'] or '')) for x in behavior_rows):
        failures.append('behavior_boundary: 行为指标建议不应被表述为疾病或未来数值预测')

    return {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'cases': len(CASES),
        'variants': len(rows),
        'passed': not failures,
        'failures': failures,
        'rows': rows,
        'context_ablation': ablation,
        'limitations': [
            '评估对象是可审计知识层的个性化行动差异，不等同于临床诊断准确率。',
            '知识源当前为演示指南，正式申报前需要医学专家审核、版本管理和外部病例验证。',
        ],
    }


def main():
    report = evaluate()
    REPORTS.mkdir(parents=True, exist_ok=True)
    out_json = REPORTS / 'graphrag-personalization-raw-2026-08-20.json'
    out_md = REPORTS / 'graphrag-personalization-evaluation-2026-08-20.md'
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    lines = [
        '# GraphRAG 个性化建议评估（2026-08-20）', '',
        f"- 结果：{'PASS' if report['passed'] else 'FAIL'}",
        f"- 场景数：{report['cases']}；上下文变体数：{report['variants']}",
        '- 评价范围：知识证据可追溯、同题不同数据的行动差异、行为指标安全边界。', '',
        '## 结果', '',
        '| 场景 | 数据画像 | 优先级 | 行动 | 理由 | 证据 |',
        '|---|---|---|---|---|---|',
    ]
    for row in report['rows']:
        safe = lambda value: str(value or '—').replace('|', '\\|').replace('\n', ' ')
        lines.append(f"| {safe(row['group'])} | {safe(row['variant'])} | {safe(row['priority'])} | {safe(row['action'])} | {safe(row['reason'])} | {safe(row['evidence'])} |")
    lines += ['', '## 失败项', '']
    lines += [f'- {x}' for x in report['failures']] or ['- 无']
    lines += ['', '## 上下文消融（去掉老人当前数据后的对照）', '',
              '| 场景 | 无上下文行动 | 变体数 | 因上下文改变的变体 | 改变率 |',
              '|---|---|---:|---:|---:|']
    for row in report['context_ablation']:
        safe = lambda value: str(value or '—').replace('|', '\\|').replace('\n', ' ')
        lines.append(f"| {safe(row['group'])} | {safe(row['baseline_action_without_context'])} | {row['variants_with_context']} | {row['changed_from_baseline']} | {row['change_rate']:.1%} |")
    lines += ['', '## 解释与限制', ''] + [f'- {x}' for x in report['limitations']]
    out_md.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()
