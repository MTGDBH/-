# GraphRAG 高风险关系医学审核包（待签署）

- 索引版本：`2026-08-21.v6`
- 生成日期：`2026-08-21`
- 待审核关系数：**83**
- 用途：供老年医学/全科/慢病管理专业人员逐条审核；本文件不会自动改变系统中的 `review_status`。

> 审核规则：未完成医学审核的高风险关系不得在老人端生成确定性诊断、用药调整或急症处置建议。AI 预审结果仅用于分流，不等同于医生批准。

## 审核汇总

| 关系索引 | 来源节点 | 目标节点 | 关系类型 | 强度 | 证据等级 | 原始状态 | AI预审 | 医生结论 | 医生签名/日期 |
|---:|---|---|---|---|---|---|---|---|---|
| 294 | `disease:cardiovascular` | `evidence_source:cardiovascular_curated_01` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 295 | `disease:cardiovascular` | `evidence_source:cardiovascular_curated_02` | `supportive_evidence` | high | professional_guideline | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 299 | `disease:cardiovascular` | `evidence_source:cardiovascular_curated_06` | `supportive_evidence` | high | professional_statement | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 300 | `disease:cardiovascular` | `evidence_source:cardiovascular_curated_07` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 399 | `disease:chronic_kidney_disease` | `care_action:clinician_review` | `requires_clinician_review` | high | authoritative_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 398 | `disease:chronic_kidney_disease` | `care_action:kidney_function_recheck` | `requires_remeasurement` | high | authoritative_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 393 | `disease:chronic_kidney_disease` | `disease:diabetes` | `coexists_with` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 392 | `disease:chronic_kidney_disease` | `disease:hypertension` | `coexists_with` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 308 | `disease:chronic_kidney_disease` | `evidence_source:chronic_kidney_disease_curated_01` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 309 | `disease:chronic_kidney_disease` | `evidence_source:chronic_kidney_disease_curated_02` | `supportive_evidence` | high | professional_guideline | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 313 | `disease:chronic_kidney_disease` | `evidence_source:chronic_kidney_disease_curated_06` | `supportive_evidence` | high | professional_statement | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 314 | `disease:chronic_kidney_disease` | `evidence_source:chronic_kidney_disease_curated_07` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 334 | `disease:chronic_kidney_disease` | `evidence_source:kdigo_ckd_2024_guidance` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 390 | `disease:chronic_kidney_disease` | `metric:creatinine` | `measured_by` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 389 | `disease:chronic_kidney_disease` | `metric:egfr` | `measured_by` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 391 | `disease:chronic_kidney_disease` | `metric:urine_albumin` | `measured_by` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 395 | `disease:chronic_kidney_disease` | `risk_factor:polypharmacy` | `requires_clinician_review` | high | authoritative_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 361 | `disease:diabetes` | `disease:chronic_kidney_disease` | `increases_risk_of` | high | public_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 359 | `disease:diabetes` | `disease:heart_disease` | `increases_risk_of` | high | public_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 360 | `disease:diabetes` | `disease:stroke` | `increases_risk_of` | high | public_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 325 | `disease:diabetes` | `evidence_source:ada_older_adults_2025_guidance` | `supportive_evidence` | high | professional_guideline | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 287 | `disease:diabetes` | `evidence_source:diabetes_curated_01` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 288 | `disease:diabetes` | `evidence_source:diabetes_curated_02` | `supportive_evidence` | high | professional_guideline | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 292 | `disease:diabetes` | `evidence_source:diabetes_curated_06` | `supportive_evidence` | high | professional_statement | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 293 | `disease:diabetes` | `evidence_source:diabetes_curated_07` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 364 | `disease:diabetes` | `intervention:annual_complication_screening` | `managed_by` | high | professional_guideline | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 362 | `disease:diabetes` | `intervention:healthy_diet` | `managed_by` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 363 | `disease:diabetes` | `intervention:regular_activity` | `managed_by` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 357 | `disease:diabetes` | `metric:glucose` | `measured_by` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 358 | `disease:diabetes` | `metric:hba1c` | `measured_by` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 406 | `disease:diabetes` | `risk_factor:hypoglycemia` | `urgent_signal` | high | professional_guideline | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 354 | `disease:diabetes` | `risk_factor:obesity` | `has_risk_factor` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 355 | `disease:diabetes` | `risk_factor:physical_inactivity` | `has_risk_factor` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 413 | `disease:frailty` | `care_action:fall_risk_review` | `requires_medical_review` | high | authoritative_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 315 | `disease:frailty` | `evidence_source:frailty_curated_01` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 316 | `disease:frailty` | `evidence_source:frailty_curated_02` | `supportive_evidence` | high | professional_guideline | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 320 | `disease:frailty` | `evidence_source:frailty_curated_06` | `supportive_evidence` | high | professional_statement | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 321 | `disease:frailty` | `evidence_source:frailty_curated_07` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 337 | `disease:frailty` | `evidence_source:who_ageing_2024_frailty_guidance` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 412 | `disease:frailty` | `risk_factor:fall_risk` | `has_risk_factor` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 328 | `disease:heart_disease` | `evidence_source:who_cvd_2025_guidance` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 365 | `disease:heart_disease` | `risk_factor:high_bp` | `has_risk_factor` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 366 | `disease:heart_disease` | `risk_factor:high_glucose` | `has_risk_factor` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 367 | `disease:heart_disease` | `risk_factor:high_lipids` | `has_risk_factor` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 368 | `disease:heart_disease` | `risk_factor:tobacco` | `has_risk_factor` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 350 | `disease:hypertension` | `disease:chronic_kidney_disease` | `increases_risk_of` | high | authoritative_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 348 | `disease:hypertension` | `disease:heart_disease` | `increases_risk_of` | high | authoritative_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 349 | `disease:hypertension` | `disease:stroke` | `increases_risk_of` | high | authoritative_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 280 | `disease:hypertension` | `evidence_source:hypertension_curated_01` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 281 | `disease:hypertension` | `evidence_source:hypertension_curated_02` | `supportive_evidence` | high | professional_guideline | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 285 | `disease:hypertension` | `evidence_source:hypertension_curated_06` | `supportive_evidence` | high | professional_statement | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 286 | `disease:hypertension` | `evidence_source:hypertension_curated_07` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 322 | `disease:hypertension` | `evidence_source:who_hypertension_2025_guidance` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 351 | `disease:hypertension` | `intervention:home_bp_remeasurement` | `managed_by` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 353 | `disease:hypertension` | `intervention:regular_activity` | `managed_by` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 352 | `disease:hypertension` | `intervention:salt_reduction` | `managed_by` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 346 | `disease:hypertension` | `metric:bp` | `measured_by` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 345 | `disease:hypertension` | `risk_factor:age_over_65` | `has_nonmodifiable_factor` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 344 | `disease:hypertension` | `risk_factor:alcohol` | `has_risk_factor` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 340 | `disease:hypertension` | `risk_factor:high_salt_diet` | `has_risk_factor` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 342 | `disease:hypertension` | `risk_factor:obesity` | `has_risk_factor` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 341 | `disease:hypertension` | `risk_factor:physical_inactivity` | `has_risk_factor` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 343 | `disease:hypertension` | `risk_factor:tobacco` | `has_risk_factor` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 370 | `disease:stroke` | `disease:hypertension` | `major_preventable_driver` | high | public_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 331 | `disease:stroke` | `evidence_source:aha_asa_stroke_2024_guidance` | `supportive_evidence` | high | professional_guideline | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 301 | `disease:stroke` | `evidence_source:stroke_curated_01` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 302 | `disease:stroke` | `evidence_source:stroke_curated_02` | `supportive_evidence` | high | professional_guideline | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 306 | `disease:stroke` | `evidence_source:stroke_curated_06` | `supportive_evidence` | high | professional_statement | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 307 | `disease:stroke` | `evidence_source:stroke_curated_07` | `supportive_evidence` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 371 | `disease:stroke` | `risk_factor:sedentary_behavior` | `has_risk_factor` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 372 | `disease:stroke` | `risk_factor:unhealthy_diet` | `has_risk_factor` | high | professional_guideline | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 374 | `disease:stroke` | `symptom:face_arm_speech_emergency` | `urgent_signal` | high | public_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 378 | `intervention:lifestyle_program` | `disease:diabetes` | `prevention_evidence` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 381 | `intervention:mediterranean_diet` | `disease:heart_disease` | `prevention_evidence` | moderate | randomized_trial | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 377 | `intervention:mediterranean_diet` | `disease:stroke` | `prevention_evidence` | moderate | professional_guideline | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 382 | `intervention:mediterranean_diet` | `disease:stroke` | `prevention_evidence` | moderate | randomized_trial | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 396 | `metric:bp` | `disease:chronic_kidney_disease` | `monitoring_signal` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 380 | `metric:bp` | `disease:stroke` | `monitoring_signal` | high | public_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 397 | `metric:glucose` | `disease:chronic_kidney_disease` | `monitoring_signal` | high | authoritative_guidance | `pending_medical_review` | eligible_for_demo_education; AI预审：允许演示/健康教育 |  |  |
| 404 | `population:frail_older_adults` | `care_action:fall_risk_review` | `requires_medical_review` | high | professional_guideline | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 403 | `population:frail_older_adults` | `intervention:low_to_moderate_activity` | `requires_clinician_review` | high | authoritative_guidance | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 407 | `risk_factor:hypoglycemia` | `care_action:clinician_review` | `requires_medical_review` | high | professional_guideline | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |
| 408 | `risk_factor:polypharmacy` | `care_action:do_not_self_adjust_medication` | `do_not_self_adjust_medication` | high | professional_guideline | `pending_medical_review` | needs_clinician_confirmation; AI预审：保留并要求临床确认 |  |  |

## 逐条审核记录

### 1. 关系 #294

- **关系**：`disease:cardiovascular` → `evidence_source:cardiovascular_curated_01`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:cardiovascular_curated_01#心血管疾病老年人证据摘要：共同危险因素`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 2. 关系 #295

- **关系**：`disease:cardiovascular` → `evidence_source:cardiovascular_curated_02`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:cardiovascular_curated_02#心血管疾病老年人证据摘要：血脂与血压`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 3. 关系 #299

- **关系**：`disease:cardiovascular` → `evidence_source:cardiovascular_curated_06`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:cardiovascular_curated_06#心血管疾病老年人证据摘要：系统综述与预测因素`
- **证据等级**：`professional_statement`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 4. 关系 #300

- **关系**：`disease:cardiovascular` → `evidence_source:cardiovascular_curated_07`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:cardiovascular_curated_07#心血管疾病老年人证据摘要：关键随机试验`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 5. 关系 #399

- **关系**：`disease:chronic_kidney_disease` → `care_action:clinician_review`
- **类型/强度**：`requires_clinician_review` / `high`
- **证据**：`kdigo_ckd_2024.md#老年人安全边界`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- **AI 预审禁止表达**：不得由系统替医生决定用药、诊断或复查结果。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 6. 关系 #398

- **关系**：`disease:chronic_kidney_disease` → `care_action:kidney_function_recheck`
- **类型/强度**：`requires_remeasurement` / `high`
- **证据**：`kdigo_ckd_2024.md#评估与复测`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：建议在相同或可比条件下按医生安排复测，并比较日期、趋势和测量条件。
- **AI 预审禁止表达**：不得把一次异常直接写成慢性病诊断或个人治疗目标。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 7. 关系 #393

- **关系**：`disease:chronic_kidney_disease` → `disease:diabetes`
- **类型/强度**：`coexists_with` / `high`
- **证据**：`kdigo_ckd_2024.md#血压与共病`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 8. 关系 #392

- **关系**：`disease:chronic_kidney_disease` → `disease:hypertension`
- **类型/强度**：`coexists_with` / `high`
- **证据**：`kdigo_ckd_2024.md#血压与共病`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 9. 关系 #308

- **关系**：`disease:chronic_kidney_disease` → `evidence_source:chronic_kidney_disease_curated_01`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:chronic_kidney_disease_curated_01#慢性肾脏病老年人证据摘要：定义与持续时间`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 10. 关系 #309

- **关系**：`disease:chronic_kidney_disease` → `evidence_source:chronic_kidney_disease_curated_02`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:chronic_kidney_disease_curated_02#慢性肾脏病老年人证据摘要：eGFR与肌酐`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 11. 关系 #313

- **关系**：`disease:chronic_kidney_disease` → `evidence_source:chronic_kidney_disease_curated_06`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:chronic_kidney_disease_curated_06#慢性肾脏病老年人证据摘要：系统综述与预测因素`
- **证据等级**：`professional_statement`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 12. 关系 #314

- **关系**：`disease:chronic_kidney_disease` → `evidence_source:chronic_kidney_disease_curated_07`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:chronic_kidney_disease_curated_07#慢性肾脏病老年人证据摘要：关键随机试验`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 13. 关系 #334

- **关系**：`disease:chronic_kidney_disease` → `evidence_source:kdigo_ckd_2024_guidance`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:kdigo_ckd_2024_guidance#KDIGO慢性肾脏病评估与管理指南`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 14. 关系 #390

- **关系**：`disease:chronic_kidney_disease` → `metric:creatinine`
- **类型/强度**：`measured_by` / `high`
- **证据**：`kdigo_ckd_2024.md#评估与复测`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为观察和复测指标，但单个读数不等于诊断。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 15. 关系 #389

- **关系**：`disease:chronic_kidney_disease` → `metric:egfr`
- **类型/强度**：`measured_by` / `high`
- **证据**：`kdigo_ckd_2024.md#评估与复测`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为观察和复测指标，但单个读数不等于诊断。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 16. 关系 #391

- **关系**：`disease:chronic_kidney_disease` → `metric:urine_albumin`
- **类型/强度**：`measured_by` / `high`
- **证据**：`kdigo_ckd_2024.md#评估与复测`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为观察和复测指标，但单个读数不等于诊断。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 17. 关系 #395

- **关系**：`disease:chronic_kidney_disease` → `risk_factor:polypharmacy`
- **类型/强度**：`requires_clinician_review` / `high`
- **证据**：`kdigo_ckd_2024.md#老年人安全边界`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- **AI 预审禁止表达**：不得由系统替医生决定用药、诊断或复查结果。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 18. 关系 #361

- **关系**：`disease:diabetes` → `disease:chronic_kidney_disease`
- **类型/强度**：`increases_risk_of` / `high`
- **证据**：`who_diabetes_2024.md#长期影响`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- **AI 预审禁止表达**：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 19. 关系 #359

- **关系**：`disease:diabetes` → `disease:heart_disease`
- **类型/强度**：`increases_risk_of` / `high`
- **证据**：`who_diabetes_2024.md#长期影响`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- **AI 预审禁止表达**：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 20. 关系 #360

- **关系**：`disease:diabetes` → `disease:stroke`
- **类型/强度**：`increases_risk_of` / `high`
- **证据**：`who_diabetes_2024.md#长期影响`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- **AI 预审禁止表达**：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 21. 关系 #325

- **关系**：`disease:diabetes` → `evidence_source:ada_older_adults_2025_guidance`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:ada_older_adults_2025_guidance#ADA老年糖尿病标准：功能、低血糖与个体化管理`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 22. 关系 #287

- **关系**：`disease:diabetes` → `evidence_source:diabetes_curated_01`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:diabetes_curated_01#2型糖尿病老年人证据摘要：定义与老年特点`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 23. 关系 #288

- **关系**：`disease:diabetes` → `evidence_source:diabetes_curated_02`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:diabetes_curated_02#2型糖尿病老年人证据摘要：空腹与餐后血糖`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 24. 关系 #292

- **关系**：`disease:diabetes` → `evidence_source:diabetes_curated_06`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:diabetes_curated_06#2型糖尿病老年人证据摘要：系统综述与预测因素`
- **证据等级**：`professional_statement`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 25. 关系 #293

- **关系**：`disease:diabetes` → `evidence_source:diabetes_curated_07`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:diabetes_curated_07#2型糖尿病老年人证据摘要：关键随机试验`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 26. 关系 #364

- **关系**：`disease:diabetes` → `intervention:annual_complication_screening`
- **类型/强度**：`managed_by` / `high`
- **证据**：`ada_older_adults_2025.md#老年人综合评估`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为生活方式或监测方向，具体目标结合年龄、虚弱、共病和医生意见。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 27. 关系 #362

- **关系**：`disease:diabetes` → `intervention:healthy_diet`
- **类型/强度**：`managed_by` / `high`
- **证据**：`ada_older_adults_2025.md#生活方式`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为生活方式或监测方向，具体目标结合年龄、虚弱、共病和医生意见。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 28. 关系 #363

- **关系**：`disease:diabetes` → `intervention:regular_activity`
- **类型/强度**：`managed_by` / `high`
- **证据**：`ada_older_adults_2025.md#生活方式`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为生活方式或监测方向，具体目标结合年龄、虚弱、共病和医生意见。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 29. 关系 #357

- **关系**：`disease:diabetes` → `metric:glucose`
- **类型/强度**：`measured_by` / `high`
- **证据**：`who_diabetes_2024.md#诊断与治疗`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为观察和复测指标，但单个读数不等于诊断。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 30. 关系 #358

- **关系**：`disease:diabetes` → `metric:hba1c`
- **类型/强度**：`measured_by` / `high`
- **证据**：`ada_older_adults_2025.md#综合评估`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为观察和复测指标，但单个读数不等于诊断。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 31. 关系 #406

- **关系**：`disease:diabetes` → `risk_factor:hypoglycemia`
- **类型/强度**：`urgent_signal` / `high`
- **证据**：`older_adult_safety.md#低血糖与用药`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：出现明确危险信号时，立即停止等待模型并联系急救/医务人员。
- **AI 预审禁止表达**：不得建议继续观察、等待预测结果或自行处理替代急救。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 32. 关系 #354

- **关系**：`disease:diabetes` → `risk_factor:obesity`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`who_diabetes_2024.md#2型糖尿病`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 33. 关系 #355

- **关系**：`disease:diabetes` → `risk_factor:physical_inactivity`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`who_diabetes_2024.md#预防`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 34. 关系 #413

- **关系**：`disease:frailty` → `care_action:fall_risk_review`
- **类型/强度**：`requires_medical_review` / `high`
- **证据**：`elderly_frailty.md#安全行动`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- **AI 预审禁止表达**：不得由系统替医生决定用药、诊断或复查结果。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 35. 关系 #315

- **关系**：`disease:frailty` → `evidence_source:frailty_curated_01`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:frailty_curated_01#老年衰弱与跌倒风险老年人证据摘要：衰弱识别`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 36. 关系 #316

- **关系**：`disease:frailty` → `evidence_source:frailty_curated_02`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:frailty_curated_02#老年衰弱与跌倒风险老年人证据摘要：握力与功能`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 37. 关系 #320

- **关系**：`disease:frailty` → `evidence_source:frailty_curated_06`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:frailty_curated_06#老年衰弱与跌倒风险老年人证据摘要：系统综述与预测因素`
- **证据等级**：`professional_statement`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 38. 关系 #321

- **关系**：`disease:frailty` → `evidence_source:frailty_curated_07`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:frailty_curated_07#老年衰弱与跌倒风险老年人证据摘要：关键随机试验`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 39. 关系 #337

- **关系**：`disease:frailty` → `evidence_source:who_ageing_2024_frailty_guidance`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:who_ageing_2024_frailty_guidance#WHO老龄化与健康：功能和衰弱安全框架`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 40. 关系 #412

- **关系**：`disease:frailty` → `risk_factor:fall_risk`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`elderly_frailty.md#安全行动`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 41. 关系 #328

- **关系**：`disease:heart_disease` → `evidence_source:who_cvd_2025_guidance`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:who_cvd_2025_guidance#WHO心血管疾病事实表与共同危险因素框架`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 42. 关系 #365

- **关系**：`disease:heart_disease` → `risk_factor:high_bp`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`who_cvd_2025.md#风险因素`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 43. 关系 #366

- **关系**：`disease:heart_disease` → `risk_factor:high_glucose`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`who_cvd_2025.md#风险因素`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 44. 关系 #367

- **关系**：`disease:heart_disease` → `risk_factor:high_lipids`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`who_cvd_2025.md#风险因素`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 45. 关系 #368

- **关系**：`disease:heart_disease` → `risk_factor:tobacco`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`who_cvd_2025.md#风险因素`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 46. 关系 #350

- **关系**：`disease:hypertension` → `disease:chronic_kidney_disease`
- **类型/强度**：`increases_risk_of` / `high`
- **证据**：`who_hypertension_2025.md#并发症`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- **AI 预审禁止表达**：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 47. 关系 #348

- **关系**：`disease:hypertension` → `disease:heart_disease`
- **类型/强度**：`increases_risk_of` / `high`
- **证据**：`who_hypertension_2025.md#并发症`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- **AI 预审禁止表达**：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 48. 关系 #349

- **关系**：`disease:hypertension` → `disease:stroke`
- **类型/强度**：`increases_risk_of` / `high`
- **证据**：`who_hypertension_2025.md#并发症`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- **AI 预审禁止表达**：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 49. 关系 #280

- **关系**：`disease:hypertension` → `evidence_source:hypertension_curated_01`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:hypertension_curated_01#高血压老年人证据摘要：定义与老年特点`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 50. 关系 #281

- **关系**：`disease:hypertension` → `evidence_source:hypertension_curated_02`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:hypertension_curated_02#高血压老年人证据摘要：家庭测量与复测`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 51. 关系 #285

- **关系**：`disease:hypertension` → `evidence_source:hypertension_curated_06`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:hypertension_curated_06#高血压老年人证据摘要：系统综述与预测因素`
- **证据等级**：`professional_statement`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 52. 关系 #286

- **关系**：`disease:hypertension` → `evidence_source:hypertension_curated_07`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:hypertension_curated_07#高血压老年人证据摘要：关键随机试验`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 53. 关系 #322

- **关系**：`disease:hypertension` → `evidence_source:who_hypertension_2025_guidance`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:who_hypertension_2025_guidance#高血压：WHO事实表与管理原则`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 54. 关系 #351

- **关系**：`disease:hypertension` → `intervention:home_bp_remeasurement`
- **类型/强度**：`managed_by` / `high`
- **证据**：`who_hypertension_2025.md#识别与复测`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为生活方式或监测方向，具体目标结合年龄、虚弱、共病和医生意见。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 55. 关系 #353

- **关系**：`disease:hypertension` → `intervention:regular_activity`
- **类型/强度**：`managed_by` / `high`
- **证据**：`who_hypertension_2025.md#生活方式干预`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为生活方式或监测方向，具体目标结合年龄、虚弱、共病和医生意见。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 56. 关系 #352

- **关系**：`disease:hypertension` → `intervention:salt_reduction`
- **类型/强度**：`managed_by` / `high`
- **证据**：`who_hypertension_2025.md#生活方式干预`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为生活方式或监测方向，具体目标结合年龄、虚弱、共病和医生意见。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 57. 关系 #346

- **关系**：`disease:hypertension` → `metric:bp`
- **类型/强度**：`measured_by` / `high`
- **证据**：`who_hypertension_2025.md#识别与复测`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为观察和复测指标，但单个读数不等于诊断。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 58. 关系 #345

- **关系**：`disease:hypertension` → `risk_factor:age_over_65`
- **类型/强度**：`has_nonmodifiable_factor` / `high`
- **证据**：`who_hypertension_2025.md#危险因素`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 59. 关系 #344

- **关系**：`disease:hypertension` → `risk_factor:alcohol`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`who_hypertension_2025.md#危险因素`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 60. 关系 #340

- **关系**：`disease:hypertension` → `risk_factor:high_salt_diet`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`who_hypertension_2025.md#危险因素`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 61. 关系 #342

- **关系**：`disease:hypertension` → `risk_factor:obesity`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`who_hypertension_2025.md#危险因素`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 62. 关系 #341

- **关系**：`disease:hypertension` → `risk_factor:physical_inactivity`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`who_hypertension_2025.md#危险因素`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 63. 关系 #343

- **关系**：`disease:hypertension` → `risk_factor:tobacco`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`who_hypertension_2025.md#危险因素`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 64. 关系 #370

- **关系**：`disease:stroke` → `disease:hypertension`
- **类型/强度**：`major_preventable_driver` / `high`
- **证据**：`aha_stroke_prevention_2024.md#血压管理`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：可说“该因素与另一疾病风险增加有关/是可预防的重要驱动因素之一”，并说明这是群体证据。
- **AI 预审禁止表达**：不得说“这个老人一定会患病”或把风险关联改写成个人因果诊断。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 65. 关系 #331

- **关系**：`disease:stroke` → `evidence_source:aha_asa_stroke_2024_guidance`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:aha_asa_stroke_2024_guidance#AHA/ASA卒中一级预防指南要点`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 66. 关系 #301

- **关系**：`disease:stroke` → `evidence_source:stroke_curated_01`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:stroke_curated_01#脑卒中老年人证据摘要：一级预防`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 67. 关系 #302

- **关系**：`disease:stroke` → `evidence_source:stroke_curated_02`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:stroke_curated_02#脑卒中老年人证据摘要：血压与卒中`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 68. 关系 #306

- **关系**：`disease:stroke` → `evidence_source:stroke_curated_06`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:stroke_curated_06#脑卒中老年人证据摘要：系统综述与预测因素`
- **证据等级**：`professional_statement`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 69. 关系 #307

- **关系**：`disease:stroke` → `evidence_source:stroke_curated_07`
- **类型/强度**：`supportive_evidence` / `high`
- **证据**：`registry:stroke_curated_07#脑卒中老年人证据摘要：关键随机试验`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 70. 关系 #371

- **关系**：`disease:stroke` → `risk_factor:sedentary_behavior`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`aha_stroke_prevention_2024.md#身体活动`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 71. 关系 #372

- **关系**：`disease:stroke` → `risk_factor:unhealthy_diet`
- **类型/强度**：`has_risk_factor` / `high`
- **证据**：`aha_stroke_prevention_2024.md#饮食模式`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可解释为风险背景或共病关系，必须结合该用户实际数据和时间线。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 72. 关系 #374

- **关系**：`disease:stroke` → `symptom:face_arm_speech_emergency`
- **类型/强度**：`urgent_signal` / `high`
- **证据**：`cardiovascular.md#危险信号`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：出现明确危险信号时，立即停止等待模型并联系急救/医务人员。
- **AI 预审禁止表达**：不得建议继续观察、等待预测结果或自行处理替代急救。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 73. 关系 #378

- **关系**：`intervention:lifestyle_program` → `disease:diabetes`
- **类型/强度**：`prevention_evidence` / `high`
- **证据**：`dpp_2002.md#试验结论`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 74. 关系 #381

- **关系**：`intervention:mediterranean_diet` → `disease:heart_disease`
- **类型/强度**：`prevention_evidence` / `moderate`
- **证据**：`predimed_2018.md#试验要点`
- **证据等级**：`randomized_trial`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 75. 关系 #377

- **关系**：`intervention:mediterranean_diet` → `disease:stroke`
- **类型/强度**：`prevention_evidence` / `moderate`
- **证据**：`aha_stroke_prevention_2024.md#饮食模式`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 76. 关系 #382

- **关系**：`intervention:mediterranean_diet` → `disease:stroke`
- **类型/强度**：`prevention_evidence` / `moderate`
- **证据**：`predimed_2018.md#试验要点`
- **证据等级**：`randomized_trial`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：使用“可能、相关、需要结合连续记录/医生评估”等保守表述。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 77. 关系 #396

- **关系**：`metric:bp` → `disease:chronic_kidney_disease`
- **类型/强度**：`monitoring_signal` / `high`
- **证据**：`kdigo_ckd_2024.md#血压与共病`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为观察和复测指标，但单个读数不等于诊断。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 78. 关系 #380

- **关系**：`metric:bp` → `disease:stroke`
- **类型/强度**：`monitoring_signal` / `high`
- **证据**：`aha_stroke_prevention_2024.md#血压管理`
- **证据等级**：`public_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为观察和复测指标，但单个读数不等于诊断。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 79. 关系 #397

- **关系**：`metric:glucose` → `disease:chronic_kidney_disease`
- **类型/强度**：`monitoring_signal` / `high`
- **证据**：`kdigo_ckd_2024.md#血压与共病`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：eligible_for_demo_education
- **AI 预审意见**：AI预审：允许演示/健康教育
- **AI 预审允许表达**：可作为观察和复测指标，但单个读数不等于诊断。
- **AI 预审禁止表达**：不得使用“必然、已经确诊、只要这样做就能避免”等确定性表述。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 80. 关系 #404

- **关系**：`population:frail_older_adults` → `care_action:fall_risk_review`
- **类型/强度**：`requires_medical_review` / `high`
- **证据**：`older_adult_safety.md#功能和虚弱`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- **AI 预审禁止表达**：不得由系统替医生决定用药、诊断或复查结果。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 81. 关系 #403

- **关系**：`population:frail_older_adults` → `intervention:low_to_moderate_activity`
- **类型/强度**：`requires_clinician_review` / `high`
- **证据**：`who_physical_activity_2020.md#安全提醒`
- **证据等级**：`authoritative_guidance`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- **AI 预审禁止表达**：不得由系统替医生决定用药、诊断或复查结果。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 82. 关系 #407

- **关系**：`risk_factor:hypoglycemia` → `care_action:clinician_review`
- **类型/强度**：`requires_medical_review` / `high`
- **证据**：`older_adult_safety.md#低血糖与用药`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：提示安排医生复核，并把指标时间线、测量条件和用药清单带给医生。
- **AI 预审禁止表达**：不得由系统替医生决定用药、诊断或复查结果。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：

### 83. 关系 #408

- **关系**：`risk_factor:polypharmacy` → `care_action:do_not_self_adjust_medication`
- **类型/强度**：`do_not_self_adjust_medication` / `high`
- **证据**：`older_adult_safety.md#低血糖与用药`
- **证据等级**：`professional_guideline`
- **原始审核状态**：`pending_medical_review`
- **AI 预审状态**：needs_clinician_confirmation
- **AI 预审意见**：AI预审：保留并要求临床确认
- **AI 预审允许表达**：明确提醒不要自行加减药，出现不适时联系医生或药师。
- **AI 预审禁止表达**：不得给出剂量、换药、停药或服药时间调整方案。

#### 医学审核（由医生填写）

- 结论：□ 通过  □ 限定条件通过  □ 退回修改  □ 拒绝
- 适用人群/限制条件：
- 可用于老人端的表达：
- 必须屏蔽的表达或行动：
- 是否需要复测/就医边界：
- 审核人：
- 执业信息/机构：
- 审核日期：
- 签名：
