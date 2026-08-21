# 回归测试汇总（2026-08-21）

本报告记录提交前在本机实际运行的核心回归，不把静态文件存在性检查当成行为测试。

## Python 回归

| 测试 | 结果 | 关键证据 |
|---|---|---|
| `elderly-health-rag/test_graphrag.py` | PASS | v6；78 sources、111 chunks、159 entities、419 relationships、0 invalid |
| `elderly-health-rag/test_medical_gate.py` | PASS | 老人端阻断 16 条；医生/审计端阻断 0 条 |
| `elderly-health-rag/test_source_gate.py` | PASS | 默认标记 legacy pending；严格模式排除 12 chunks |
| `ml/curve/test_health_curve.py` | PASS | 28/28 |
| `ml/curve/test_temporal_validation.py` | PASS | 30 个窗口；29 forecasted；1 refused |
| `ml/curve/test_validate_external_dataset.py` | PASS | 空模板被正确拒绝，原因 `dataset is empty` |
| `ml/test_risk_data_manifest.py` | PASS | `charls_w1w2_incidence.v2`；6 artifacts |
| `ml/disease_risk/test_multidisease.py` | PASS | 多病种测试通过 |

## Node 验收

`server/final_acceptance.mjs`：PASS，覆盖登录、DeepSeek 趋势、疾病风险、GraphRAG、行为模式和历史记录。

## 解释边界

- Curve 时间验证使用的是合成干跑，不能替代真实 60–90 天外部数据。
- 风险模型的 CHARLS 波次时间切分不能替代独立地区/机构外部验证。
- 医学门控通过表示安全策略生效，不表示高风险关系已获得医生签字。
