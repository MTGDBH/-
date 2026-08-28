#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate a deterministic synthetic-only dry run for pipeline verification."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ml.intervention_evaluation.engine import evaluate_intervention


def iso(day: int, hour: int = 8) -> str:
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return (start + timedelta(days=day, hours=hour)).isoformat().replace("+00:00", "Z")


measurements = [
    {"recorded_at": iso(day), "value": 7.0 + (day % 3) * 0.1,
     "measurement_condition": "fasting", "device_id": "synthetic-meter-A",
     "data_quality": {"flags": []}}
    for day in range(14)
] + [
    {"recorded_at": iso(day), "value": 6.2 + (day % 3) * 0.1,
     "measurement_condition": "fasting", "device_id": "synthetic-meter-A",
     "data_quality": {"flags": []}}
    for day in range(21, 28)
]

payload = {
    "synthetic": True,
    "intervention": {"intervention_id": "synthetic-walk-after-dinner", "definition": {"title": "晚餐后步行10分钟"},
                     "minimum_adherence_rate": 0.7, "planned_execution_count": 7},
    "target_metric": {"metric": "glucose", "unit": "mmol/L"},
    "baseline_window": {"start": iso(0, 0), "end": iso(13, 23)},
    "intervention_window": {"start": iso(14, 0), "end": iso(20, 23)},
    "outcome_window": {"start": iso(21, 0), "end": iso(27, 23)},
    "execution_records": [{"execution_log_id": f"synthetic-{i}", "performed": i != 3} for i in range(7)],
    "measurements": measurements,
    "measurement_conditions": {"policy": "strict_exact_group_v1"},
    "data_quality_flags": {"source": "synthetic"},
    "expected_measurement_count": {"baseline": 14, "outcome": 7},
    "concurrent_interventions": [], "acute_events": [], "prior_evaluations": [],
    "timezone": "Asia/Shanghai", "confidence_level": 0.95, "bootstrap_iterations": 2000,
    "random_seed": 20260828,
}

result = evaluate_intervention(payload)
artifact = {"synthetic": True, "purpose": "pipeline_dry_run_only", "input": payload, "output": result}
(ROOT / "reports" / "intervention-evaluation-synthetic-dry-run-20260828.json").write_text(
    json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

markdown = f"""# N-of-1 个体干预效果评估：合成干跑报告

> **SYNTHETIC / 合成数据。** 本报告只证明输入、统计引擎、版本化输出和报告流水线可以运行；不代表真实患者效果、临床有效性或外部验证结果。

## 合成案例

- 干预：晚餐后步行 10 分钟（纯合成定义）
- 指标：空腹血糖，单位 mmol/L
- 基线：14 个本地日；结局：7 个本地日
- 条件：全部为 fasting，设备固定为 synthetic-meter-A
- 执行：计划 7 次、完成 6 次
- 随机种子：20260828；bootstrap：2000 次；置信水平：95%

## 流水线输出摘要

- 契约：`{result.get('schema_version')}`
- 算法：`{result.get('algorithm_version')}`
- 证据等级：`{result.get('evidence_level')}`
- 基线稳健中心：{result.get('baseline_summary', {}).get('value')} mmol/L
- 结局稳健中心：{result.get('outcome_summary', {}).get('value')} mmol/L
- 绝对变化：{result.get('absolute_change')} mmol/L
- 相对变化：{result.get('relative_change')}
- bootstrap 区间：{result.get('uncertainty_interval', {}).get('lower')} 至 {result.get('uncertainty_interval', {}).get('upper')}
- 依从率：{result.get('adherence_rate')}
- reason_code：`{result.get('reason_code')}`

中文安全消息：{result.get('message')}

## 结论边界

该案例不是临床数据，不评估诊断、治疗或药物决策，不提供群体推广结论。即使合成区间不跨 0，也只能说明确定性测试数据按预期通过了流水线。
"""
(ROOT / "reports" / "intervention-evaluation-synthetic-dry-run-20260828.md").write_text(markdown, encoding="utf-8")
print(json.dumps({"synthetic": True, "evidence_level": result.get("evidence_level"),
                  "reason_code": result.get("reason_code")}, ensure_ascii=False))
