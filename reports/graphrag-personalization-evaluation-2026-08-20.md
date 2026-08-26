# GraphRAG 个性化建议评估（2026-08-20）

- 结果：PASS
- 场景数：4；上下文变体数：9
- 评价范围：知识证据可追溯、同题不同数据的行动差异、行为指标安全边界。

## 结果

| 场景 | 数据画像 | 优先级 | 行动 | 理由 | 证据 |
|---|---|---|---|---|---|
| hypertension_same_question | urgent | urgent | 立即安静休息并重新测量；若伴胸痛、呼吸困难、意识改变或单侧无力，立即呼叫急救。 | 当前血压达到危险信号门槛 | who_hypertension_2025.md#并发症 |
| hypertension_same_question | high | high | 请把相关记录和证据交给医生确认；确认前不要据此自行改变治疗或用药。 | 该行动所依据的高风险关系尚未完成医生审核，不能作为普通行动输出。 | who_hypertension_2025.md#识别与复测 |
| hypertension_same_question | normal | normal | 请把相关记录和证据交给医生确认；确认前不要据此自行改变治疗或用药。 | 该行动所依据的高风险关系尚未完成医生审核，不能作为普通行动输出。 | who_hypertension_2025.md#识别与复测 |
| diabetes_same_question | high | high | 确认这次是否为空腹测量，按同一条件复测并联系医生评估。 | 记录血糖 8.1 mmol/L 需要结合测量条件复核 | who_diabetes_2024.md#监测与并发症 |
| diabetes_same_question | normal | normal | 继续按相同测量条件记录血糖，补充餐前/餐后信息，便于医生判断。 | 血糖需要结合测量时点解释 | who_diabetes_2024.md#监测与并发症 |
| behavior_boundary | short_sleep | normal | 先固定上床和起床时间，连续记录一周睡眠；不要把睡眠波动当作疾病预测。 | 近7天睡眠平均偏少 | aha_lifes_essential_8_2022.md#八项指标 |
| behavior_boundary | adequate_sleep | normal | 继续保持相对固定的作息，记录睡眠质量；如白天仍明显困倦，再和医生讨论原因。 | 近7天睡眠平均达到基本观察水平 | aha_lifes_essential_8_2022.md#八项指标 |
| ckd_same_question | reduced_egfr | high | 请把相关记录和证据交给医生确认；确认前不要据此自行改变治疗或用药。 | 该行动所依据的高风险关系尚未完成医生审核，不能作为普通行动输出。 | kdigo_ckd_2024.md#评估与复测 |
| ckd_same_question | missing_renal_metrics | normal | 如果有糖尿病或血压偏高，和医生确认是否需要补充肾功能与尿白蛋白检查。 | 当前缺少可判断肾功能的核心指标 | kdigo_ckd_2024.md#筛查人群 |

## 失败项

- 无

## 上下文消融（去掉老人当前数据后的对照）

| 场景 | 无上下文行动 | 变体数 | 因上下文改变的变体 | 改变率 |
|---|---|---:|---:|---:|
| hypertension_same_question | — | 3 | 3 | 100.0% |
| diabetes_same_question | — | 2 | 2 | 100.0% |
| behavior_boundary | — | 2 | 2 | 100.0% |
| ckd_same_question | 如果有糖尿病或血压偏高，和医生确认是否需要补充肾功能与尿白蛋白检查。 | 2 | 1 | 50.0% |

## 解释与限制

- 评估对象是可审计知识层的个性化行动差异，不等同于临床诊断准确率。
- 知识源当前为演示指南，正式申报前需要医学专家审核、版本管理和外部病例验证。
