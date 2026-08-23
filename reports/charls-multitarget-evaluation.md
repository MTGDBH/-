# CHARLS 多指标预测与化验风险评估

运行 ID：`charls-multitarget-20260822T092456Z`
树模型后端：`lightgbm`（可用：lightgbm, xgboost）
地理外部留出：`四川省`

## 数值预测（Wave1 → Wave2）

| 指标 | 选择模型 | 复杂模型启用 | 测试MAE | MASE | 80%覆盖率 | 拒绝率 |
|---|---|---:|---:|---:|---:|---:|
| systo | linear | False | 13.446049 | 0.929239 | 0.779581 | 0.006716 |
| diasto | linear | False | 8.423057 | 0.93468 | 0.784407 | 0.006734 |
| hr | linear | False | 7.369152 | 0.892167 | 0.785521 | 0.00672 |
| weight | last_value | False | 4.152878 | 0.967935 | 0.810356 | 0.00668 |
| waist | linear | False | 5.293927 | 0.954249 | 0.788306 | 0.006676 |
| grip | linear | False | 5.44688 | 0.828266 | 0.800683 | 0.00678 |

## 化验异常风险（Wave1 → Wave3）

| 指标/输入层 | 选择模型 | 复杂模型启用 | AUROC | PR-AUC | Brier | 灵敏度 | 特异度 |
|---|---|---:|---:|---:|---:|---:|---:|
| glucose/noninvasive | logistic | False | 0.660757 | 0.330909 | 0.216194 | 0.512077 | 0.756206 |
| glucose/micro_anchor | boosting | True | 0.676072 | 0.412259 | 0.113744 | 0.42029 | 0.882092 |
| hba1c/noninvasive | logistic | False | 0.773187 | 0.520038 | 0.17322 | 0.631868 | 0.810717 |
| hba1c/micro_anchor | logistic | False | 0.849117 | 0.66116 | 0.139052 | 0.78022 | 0.761452 |
| cholesterol/noninvasive | logistic | False | 0.594697 | 0.21676 | 0.245959 | 0.721239 | 0.427281 |
| cholesterol/micro_anchor | boosting | True | 0.767138 | 0.465348 | 0.117985 | 0.650442 | 0.776874 |
| uricacid/noninvasive | logistic | False | 0.626638 | 0.1728 | 0.230714 | 0.588652 | 0.596315 |
| uricacid/micro_anchor | logistic | False | 0.713895 | 0.344096 | 0.206091 | 0.638298 | 0.680067 |
| creatinine/noninvasive | logistic | False | 0.604465 | 0.123449 | 0.230383 | 0.456522 | 0.663175 |
| creatinine/micro_anchor | boosting | True | 0.699567 | 0.212682 | 0.060172 | 0.608696 | 0.662369 |

## 家庭问卷长期风险（Wave1 → Wave2）

| 目标 | 选择模型 | AUROC | PR-AUC | Brier | 拒绝率 |
|---|---|---:|---:|---:|---:|
| adl_limitation | logistic | 0.793148 | 0.489304 | 0.183595 | 0.087105 |
| depressive_symptoms | logistic | 0.750486 | 0.560272 | 0.200541 | 0.075943 |
| fall | logistic | 0.649532 | 0.274081 | 0.227781 | 0.087821 |

## 边界

- CHARLS 是波次级人群数据，不是连续设备数据；结果不能解释为未来7天个体预测。
- 外部地区留出仍来自同一研究项目，只是地理迁移审计，不是独立机构临床外部验证。
- 化验模块输出异常风险分层，不输出伪精确化验数值；真实使用以规范检测为准。
- 每个复杂模型只有在预先规定的验证集门槛上优于简单基线才启用。
