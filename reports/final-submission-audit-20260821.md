# 最终提交审计（2026-08-21）

状态：**ready_with_external_gates**

## 本地可复现检查

| 检查 | 结果 |
|---|---|
| readiness_36_of_36 | 通过 |
| artifact_manifest_complete | 通过 |
| artifact_hashes_match | 通过 |
| graphrag_source_gate | 通过 |
| medical_gate | 通过 |
| bundle_integrity | 通过 |
| deliverables_present | 通过 |

工件数量：75；哈希缺失：0；哈希不一致：0；压缩包条目：76

## 外部证据门槛

| 项目 | 当前状态 | 必须由项目组完成 |
|---|---|---|
| clinician_review | pending | 由持证医生完成83条关系审核与签字 |
| human_evaluation | synthetic_fixture_only | 招募真实15–30名老人和3–5名医生并完成伦理/知情同意流程 |
| curve_external_validation | synthetic_dry_run_only | 采集至少60–90天真实纵向数据，并按老人隔离完成外部验证 |
| risk_external_validation | temporal_cohort_sensitivity_only | 补充独立地区/日期外部队列并重新校准概率 |

本审计不把合成数据、AI 预审或调查波次时间切分写成临床结论。
