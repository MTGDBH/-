# 数据卡（提交版）

## 数据组成

- 研究数据：CHARLS Wave1 基线与 Wave2 新发结局派生表，原始来源和 SHA256 见 `ml/risk_data_manifest.json`。
- 时间审计数据：原始 `D:\大创数据2\CHARLS.csv` 的 Wave1–5 重复参与者记录；用于 Wave1→2、2→3、3→4 训练，Wave4→5 时间留出审计，详情见 `reports/national-award-risk-temporal-evaluation-20260821.md`。
- 演示数据：`server/data/app.db` 中标记为 `synthetic` 的账号和指标，仅用于界面与闭环演示。
- 测试数据：Curve V2 合成序列、Node 工具夹具和 GraphRAG 黄金问题，不进入风险模型训练。
- 真实评价候选数据：当前未采集；`reports/real-world-evaluation-status.json` 保持 `pending`。空白医生、老人和纵向模板不计作样本。

## 风险模型样本

| 派生管线 | 疾病 | n | 阳性 | 阳性率 |
|---|---|---:|---:|---:|
| multidisease_baseline | hypertension | 11010 | 506 | 4.60% |
| multidisease_baseline | diabetes | 13858 | 223 | 1.61% |
| multidisease_baseline | heart_disease | 13069 | 304 | 2.33% |
| multidisease_baseline | stroke | 14534 | 94 | 0.65% |
| app_core12 | hypertension | 10619 | 494 | 4.65% |

## 使用边界

训练排除演示和测试数据；缺失值保留并进入数据完整度提示；当前风险派生表没有个体测量日期，不能宣称时间外部验证。真实医疗使用前需要数据授权、脱敏、独立外部验证和临床审核。
