# 多疾病风险个性化评估（2026-08-20）

- 结果：PASS
- 账号：6；疾病：4；有效评估行：24
- 目标：验证不同账户数据是否产生不同风险概率，并检查概率、元数据、来源和可信度契约。

## 按疾病汇总

| 疾病 | 样本数 | 最低概率 | 最高概率 | 均值 | 范围 | 是否因人变化 |
|---|---:|---:|---:|---:|---:|---|
| hypertension | 6 | 4.44% | 12.39% | 7.45% | 7.95pp | 是 |
| diabetes | 6 | 0.08% | 0.24% | 0.14% | 0.16pp | 是 |
| heart_disease | 6 | 0.15% | 0.16% | 0.16% | 0.01pp | 是 |
| stroke | 6 | 0.57% | 0.85% | 0.63% | 0.28pp | 是 |

## 账户明细

| 画像 | 疾病 | 风险 | 等级 | 可信度 | 缺失字段数 | 数据来源数 |
|---|---|---:|---|---|---:|---:|
| stable | hypertension | 5.05% | moderate | low | 21 | 10 |
| stable | diabetes | 0.08% | low | low | 21 | 10 |
| stable | heart_disease | 0.16% | low | low | 21 | 10 |
| stable | stroke | 0.57% | low | low | 21 | 10 |
| hypertension | hypertension | 9.31% | moderate | low | 21 | 10 |
| hypertension | diabetes | 0.10% | low | low | 21 | 10 |
| hypertension | heart_disease | 0.16% | low | low | 21 | 10 |
| hypertension | stroke | 0.58% | low | low | 21 | 10 |
| diabetes | hypertension | 6.27% | moderate | low | 21 | 10 |
| diabetes | diabetes | 0.23% | low | low | 21 | 10 |
| diabetes | heart_disease | 0.15% | low | low | 21 | 10 |
| diabetes | stroke | 0.61% | low | low | 21 | 10 |
| mixed | hypertension | 12.39% | moderate | low | 21 | 10 |
| mixed | diabetes | 0.24% | low | low | 21 | 10 |
| mixed | heart_disease | 0.15% | low | low | 21 | 10 |
| mixed | stroke | 0.85% | low | low | 21 | 10 |
| sparse | hypertension | 4.44% | low | low | 21 | 10 |
| sparse | diabetes | 0.09% | low | low | 21 | 10 |
| sparse | heart_disease | 0.16% | low | low | 21 | 10 |
| sparse | stroke | 0.57% | low | low | 21 | 10 |
| recovery | hypertension | 7.22% | moderate | low | 21 | 10 |
| recovery | diabetes | 0.10% | low | low | 21 | 10 |
| recovery | heart_disease | 0.16% | low | low | 21 | 10 |
| recovery | stroke | 0.57% | low | low | 21 | 10 |

## 失败项

- 无

## 限制

- 风险输出是队列筛查概率，不是个体诊断。
- 演示账户为合成/演示数据，需独立真实队列验证后才能用于正式科研结论。
