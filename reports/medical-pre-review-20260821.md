# GraphRAG 高风险关系 AI 预审核报告

索引版本：`2026-08-23.v7`；生成日期：`2026-08-23`；审核对象：90 条。

> 这是一份证据治理预审核，不是医生签字或临床批准。`review_status` 仍保持 `pending_medical_review`。

## 结果统计

- `eligible_for_demo_education`：70 条
- `needs_clinician_confirmation`：20 条
- `reject_until_fixed`：0 条

## 使用边界

- `eligible_for_demo_education` 只能用于演示、证据展示和健康教育。
- `needs_clinician_confirmation` 不得在老人端生成确定性医疗结论。
- `reject_until_fixed` 必须补齐来源或修正关系后才能重新进入审核。
- 急症、用药、阈值和疾病因果关系始终需要具备资质的临床人员确认。

## 需临床确认的逐条意见

### 关系 457：`disease:hypertension` —[increases_risk_of]→ `disease:heart_disease`
- 证据：`who_hypertension_2025.md#并发症`（authoritative_guidance）
- 允许表达：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- 禁止表达：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 458：`disease:hypertension` —[increases_risk_of]→ `disease:stroke`
- 证据：`who_hypertension_2025.md#并发症`（authoritative_guidance）
- 允许表达：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- 禁止表达：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 459：`disease:hypertension` —[increases_risk_of]→ `disease:chronic_kidney_disease`
- 证据：`who_hypertension_2025.md#并发症`（authoritative_guidance）
- 允许表达：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- 禁止表达：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 468：`disease:diabetes` —[increases_risk_of]→ `disease:heart_disease`
- 证据：`who_diabetes_2024.md#长期影响`（public_guidance）
- 允许表达：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- 禁止表达：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 469：`disease:diabetes` —[increases_risk_of]→ `disease:stroke`
- 证据：`who_diabetes_2024.md#长期影响`（public_guidance）
- 允许表达：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- 禁止表达：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 470：`disease:diabetes` —[increases_risk_of]→ `disease:chronic_kidney_disease`
- 证据：`who_diabetes_2024.md#长期影响`（public_guidance）
- 允许表达：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- 禁止表达：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 479：`disease:stroke` —[major_preventable_driver]→ `disease:hypertension`
- 证据：`aha_stroke_prevention_2024.md#血压管理`（public_guidance）
- 允许表达：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- 禁止表达：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 483：`disease:stroke` —[urgent_signal]→ `symptom:face_arm_speech_emergency`
- 证据：`cardiovascular.md#危险信号`（public_guidance）
- 允许表达：出现明确危险信号时，立即停止等待模型并联系急救/医务人员。
- 禁止表达：不得建议继续观察、等待预测结果或自行处理替代急救。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 504：`disease:chronic_kidney_disease` —[requires_clinician_review]→ `risk_factor:polypharmacy`
- 证据：`kdigo_ckd_2024.md#老年人安全边界`（authoritative_guidance）
- 允许表达：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- 禁止表达：不得由系统替医生决定用药、诊断或复查结果。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 507：`disease:chronic_kidney_disease` —[requires_remeasurement]→ `care_action:kidney_function_recheck`
- 证据：`kdigo_ckd_2024.md#评估与复测`（authoritative_guidance）
- 允许表达：建议在相同或可比条件下按医生安排复测，并比较日期、趋势和测量条件。
- 禁止表达：不得把一次异常直接写成慢性病诊断或个人治疗目标。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 508：`disease:chronic_kidney_disease` —[requires_clinician_review]→ `care_action:clinician_review`
- 证据：`kdigo_ckd_2024.md#老年人安全边界`（authoritative_guidance）
- 允许表达：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- 禁止表达：不得由系统替医生决定用药、诊断或复查结果。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 512：`population:frail_older_adults` —[requires_clinician_review]→ `intervention:low_to_moderate_activity`
- 证据：`who_physical_activity_2020.md#安全提醒`（authoritative_guidance）
- 允许表达：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- 禁止表达：不得由系统替医生决定用药、诊断或复查结果。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 513：`population:frail_older_adults` —[requires_medical_review]→ `care_action:fall_risk_review`
- 证据：`older_adult_safety.md#功能和虚弱`（professional_guideline）
- 允许表达：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- 禁止表达：不得由系统替医生决定用药、诊断或复查结果。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 515：`disease:diabetes` —[urgent_signal]→ `risk_factor:hypoglycemia`
- 证据：`older_adult_safety.md#低血糖与用药`（professional_guideline）
- 允许表达：出现明确危险信号时，立即停止等待模型并联系急救/医务人员。
- 禁止表达：不得建议继续观察、等待预测结果或自行处理替代急救。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 516：`risk_factor:hypoglycemia` —[requires_medical_review]→ `care_action:clinician_review`
- 证据：`older_adult_safety.md#低血糖与用药`（professional_guideline）
- 允许表达：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- 禁止表达：不得由系统替医生决定用药、诊断或复查结果。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 517：`risk_factor:polypharmacy` —[do_not_self_adjust_medication]→ `care_action:do_not_self_adjust_medication`
- 证据：`older_adult_safety.md#低血糖与用药`（professional_guideline）
- 允许表达：明确提醒不要自行加减药，出现不适时联系医生或药师。
- 禁止表达：不得给出剂量、换药、停药或服药时间调整方案。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 522：`disease:frailty` —[requires_medical_review]→ `care_action:fall_risk_review`
- 证据：`elderly_frailty.md#安全行动`（authoritative_guidance）
- 允许表达：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- 禁止表达：不得由系统替医生决定用药、诊断或复查结果。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 538：`risk_factor:fall_risk` —[requires_clinician_review]→ `care_action:medication_review`
- 证据：`cdc_steadi_2025.md#协同处理`（public_guidance）
- 允许表达：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- 禁止表达：不得由系统替医生决定用药、诊断或复查结果。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 539：`risk_factor:polypharmacy` —[do_not_self_adjust_medication]→ `care_action:do_not_self_adjust_medication`
- 证据：`cdc_steadi_2025.md#药物与跌倒`（public_guidance）
- 允许表达：明确提醒不要自行加减药，出现不适时联系医生或药师。
- 禁止表达：不得给出剂量、换药、停药或服药时间调整方案。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

### 关系 546：`behavior:disturbed_sleep` —[requires_medical_review]→ `care_action:sleep_symptom_review`
- 证据：`aha_sleep_brain_2024.md#老年人解释边界`（professional_statement）
- 允许表达：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- 禁止表达：不得由系统替医生决定用药、诊断或复查结果。
- 决定：保留 `pending_medical_review`，不得自动转为临床批准。

逐条机器可读明细见 `output/medical_pre_review.json`。
