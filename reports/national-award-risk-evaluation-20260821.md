# 国家奖风险模型扩展审计（2026-08-21）

运行 ID：`risk-national-award-audit-20260821`

## 结果摘要

| 疾病 | 选择模型 | 测试 AUC | Brier | Bootstrap AUC 95% CI |
|---|---|---:|---:|---|
| diabetes | xgboost | 0.6932 | 0.01513 | [0.5875, 0.7695] |
| heart_disease | logistic | 0.6271 | 0.02275 | [0.5557, 0.7091] |
| hypertension | logistic | 0.6643 | 0.04319 | [0.6208, 0.7209] |
| stroke | xgboost | 0.6365 | 0.00652 | [0.5020, 0.7581] |

## 决策曲线

决策曲线以净获益比较模型、全部干预和不干预；阈值仅作复测分层研究，不是临床处方阈值。结果与完整分层、校准分箱和 Bootstrap 明细保存在同名 JSON。

校准与决策曲线图：`ml/reports/national-award-risk-figures/calibration-curves.svg`、`ml/reports/national-award-risk-figures/decision-curves.svg`。

## 波次时间留出补充审计

原始 CHARLS 文件含 `participant_id` 和 Wave1–5。补充报告 `reports/national-award-risk-temporal-evaluation-20260821.md` 使用 Wave1→2、Wave2→3、Wave3→4 训练，Wave4→5 测试；它是时间前训后测的队列审计，但训练与测试可能包含同一参与者的不同波次，不能写成独立地区外部验证。

## 不能宣称的部分

当前数据没有个体日期，时间外部验证标记为 unavailable；不能把随机留出结果写成时间外验证，也不能替代医生审核或外部临床验证。
