# 外部证据闸门执行清单

本清单只列需要项目组、指导教师、持证医生或真实参与者完成的事项。它不把演示账号、合成数据或 AI 预审当成真实医学证据。

## 1. 医学审核（最高优先级）

1. 将 `reports/clinician-review-template.csv` 交给持证医生或健康管理人员。
2. 每一行填写 `reviewer_id`、`reviewed_at`、`decision`、`approved_wording`、`prohibited_wording` 和 `comment`。
3. 决策只能使用：`approve_education`、`approve_with_guardrails`、`needs_revision`、`reject`。
4. 运行校验：

```powershell
python elderly-health-rag/validate_clinician_reviews.py reports/clinician-review-template.csv --out reports/clinician-review-validation.json
```

5. 只有 `review_complete=true` 且不存在 `needs_revision/reject` 时，才允许人工导入版本化审核结果：

```powershell
python elderly-health-rag/apply_clinician_reviews.py reports/clinician-review-template.csv --out elderly-health-rag/output/clinician_review_decisions.v1.json
```

导入脚本默认不覆盖 live GraphRAG；导入前需由指导教师确认版本和备份。

## 2. 真实老人/医生人因评价

- 招募 15–30 名老人和 3–5 名医生/健康管理人员；
- 使用 `reports/human-evaluation-consent-template.md`，完成伦理、知情同意和匿名化编号；
- 使用 `reports/human-evaluation-data-template.csv` 记录模板、普通 RAG、GraphRAG 三种条件；
- 不收集姓名、身份证号、电话号码或原始病历；
- 运行分析：

```powershell
python reports/analyze_human_evaluation.py reports/human-evaluation-data.csv --out reports/human-evaluation-analysis.json
```

申报书只报告真实样本通过完整性检查后的结果；当前 `human-evaluation-synthetic-pipeline-20260821.*` 只能证明流水线可运行。

## 3. Curve V2 外部纵向数据

- 每位参与者至少覆盖 60–90 天；
- 血压每天 1–2 次，收缩压/舒张压同一记录保存；
- 空腹血糖、餐后 2 小时血糖分开填写；
- 体重注明晨起条件，静息心率注明静息条件；
- 保留缺测，不用插值伪造；
- 使用 `ml/curve/external_dataset_schema.json` 和 `ml/curve/external_dataset_template.csv`；
- 先运行：

```powershell
python ml/curve/validate_external_dataset.py path/to/curve_external.csv
```

- 通过验证后，按参与者隔离运行 `ml/curve/temporal_validation.py`，报告 MAE、RMSE、MASE、80% 区间覆盖率、区间宽度、拒绝率和异常点稳定性。

## 4. 风险模型独立外部验证

- 需要独立地区、独立时间或独立机构的队列；
- 必须保留统一特征字典、缺失编码、标签定义和预测时间窗；
- 重新计算 AUC、PR-AUC、Brier、校准截距/斜率、Bootstrap CI 和决策曲线；
- 分层报告 65–74 岁、75 岁以上、性别、基础病和缺失模式；
- 当前 CHARLS 波次时间切分和参与者独立敏感性分析不能替代外部队列。

## 5. 提交前冻结

完成真实闸门后，依次运行：

```powershell
python reports/generate_submission_readiness.py
python reports/final_submission_audit.py
python reports/generate_submission_artifact_manifest.py
python reports/create_submission_bundle.py
```

最终审计状态只有在本地检查通过时为 `ready_with_external_gates`；外部闸门完成后仍需人工核对材料中的数字、署名、伦理批件和数据授权证明。
