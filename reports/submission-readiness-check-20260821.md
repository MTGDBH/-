# 提交前自检清单（2026-08-21）

生成日期：`2026-08-21`
通过：**36/36**

> 这份清单只检查材料、代码和边界声明是否齐全，不替代医生审核、真实用户研究或外部时间验证。

| 检查项 | 状态 | 证据/说明 |
|---|---|---|
| 最终交付说明 | 通过 | `FINAL_DELIVERY.md` |
| 国家奖 PPT | 通过 | `deliverables/national_award/elderly_health_national_award.pptx` |
| 项目总结书 PDF | 通过 | `deliverables/national_award/latex/project_summary.pdf` |
| 项目总结书 LaTeX 源码 | 通过 | `deliverables/national_award/latex/project_summary.tex` |
| GraphRAG 任务矩阵 | 通过 | `reports/national-award-task-matrix-20260821.md` |
| 风险模型审计 | 通过 | `reports/national-award-risk-evaluation-20260821.md` |
| 风险模型波次时间审计 | 通过 | `reports/national-award-risk-temporal-evaluation-20260821.md` |
| 风险模型参与者独立敏感性分析 | 通过 | `reports/national-award-risk-temporal-disjoint-evaluation-20260821.md` |
| Curve V2 本地评测 | 通过 | `reports/curve-model-evaluation-2026-08-20.md` |
| Curve 时间验证干跑 | 通过 | `reports/curve-temporal-validation-20260821.md` |
| Curve 外部采集包 | 通过 | `reports/curve-external-data-collection-kit-20260821.md` |
| Curve 外部数据模板 | 通过 | `ml/curve/external_dataset_template.csv` |
| Curve 外部数据校验脚本 | 通过 | `ml/curve/validate_external_dataset.py` |
| 人因评价采集包 | 通过 | `reports/human-evaluation-data-collection-kit-20260821.md` |
| 人因评价数据模板 | 通过 | `reports/human-evaluation-data-template.csv` |
| 人因评价分析脚本 | 通过 | `reports/analyze_human_evaluation.py` |
| 人因评价合成流程夹具 | 通过 | `reports/human-evaluation-synthetic-pipeline-20260821.md` |
| 人因评价知情同意模板 | 通过 | `reports/human-evaluation-consent-template.md` |
| GraphRAG 来源完整性审计 | 通过 | `reports/source-integrity-audit-20260821.md` |
| 人因评价协议 | 通过 | `reports/human-evaluation-protocol-20260821.md` |
| 人因评价干跑 | 通过 | `reports/human-evaluation-dry-run-20260821.md` |
| 医生审核包 | 通过 | `reports/clinician-review-packet-20260821.md` |
| 医生审核结构化表 | 通过 | `reports/clinician-review-submission-guide-20260821.md` |
| 医生审核导入保护脚本 | 通过 | `elderly-health-rag/apply_clinician_reviews.py` |
| 数据卡 | 通过 | `deliverables/national_award/data_card.md` |
| 模型卡 | 通过 | `deliverables/national_award/model_card.md` |
| 提交物哈希清单 | 通过 | `reports/submission-artifact-manifest-20260821.json` |
| 风险校准图 | 通过 | `ml/reports/national-award-risk-figures/calibration-curves.svg` |
| 风险决策曲线图 | 通过 | `ml/reports/national-award-risk-figures/decision-curves.svg` |
| GraphRAG 内部改写留出评测 | 通过 | `reports/graphrag-internal-holdout-20260821.md` |
| DeepSeek 运行链路审计 | 通过 | `reports/deepseek-runtime-audit-20260821.md` |
| GraphRAG 关系审核状态未伪造批准 | 通过 | `pending=83, approved=0` |
| 风险模型明确记录时间验证边界 | 通过 | `当前 CHARLS 派生表只有 Wave1 基线和 Wave2 结局，没有个体测量日期/时间排序字段；不能用 ID 顺序冒充时间切分。` |
| Curve 时间验证标记为合成干跑 | 通过 | `forecasted=29, refused=1` |
| 人因评价未把合成样本写成真实样本 | 通过 | `真实样本仍待招募` |
| 提交物哈希清单无缺失 | 通过 | `artifacts=73, missing=0` |

## 提交前仍需人工完成

1. 邀请 3–5 名医生或健康管理人员，完成 `clinician-review-packet-20260821.md` 的逐条审核和签名。
2. 招募 15–30 名老人完成知情同意和人因评价，替换合成干跑结果。
3. 获取带个体日期的外部纵向数据，完成 Curve V2 60–90 天外部验证。
4. 风险模型补充时间切分或独立外部队列后，再更新模型卡和答辩数字。