# 医生审核结构化提交指南

## 用途

`clinician-review-template.csv` 是从当前 GraphRAG v6 的 83 条高风险关系导出的空白审核表。它不是医生审核结果，也不会自动改变 `review_status`。

## 填写规则

- 每一行对应一个 `relation_index`，不能删除、复制或改写关系本体字段。
- `clinician_decision` 只能填写：`approve_education`、`approve_with_guardrails`、`needs_revision`、`reject`。
- 只要填写结论，就必须填写医生/健康管理人员编号、角色、ISO 日期、理由和签名确认字段。
- `approve_education` 只能允许健康教育；`approve_with_guardrails` 必须在 `approved_wording` 和 `forbidden_wording` 中写清边界；急症、用药、阈值和疾病因果关系不能仅凭 AI 预审批准。

## 校验命令

```powershell
$py = 'C:\Users\zhaoq\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
& $py D:\BIGCHUANG\-\elderly-health-rag\generate_clinician_review_template.py
& $py D:\BIGCHUANG\-\elderly-health-rag\validate_clinician_reviews.py D:\BIGCHUANG\-\reports\clinician-review-template.csv --out D:\BIGCHUANG\-\reports\clinician-review-validation.json
```

当前空表校验结果应为 `pending`、83 行、0 条签字；这证明表格完整，不证明医生审核已完成。校验脚本不会写入生产索引，避免误把未签署内容变成 `approved`。

只有 83 条全部完成签字、且没有 `needs_revision` 或 `reject` 时，才可以运行：

```powershell
& $py D:\BIGCHUANG\-\elderly-health-rag\apply_clinician_reviews.py D:\BIGCHUANG\-\reports\clinician-review-template.csv --apply
```

该命令只生成版本化 `output/clinician_review_decisions.v1.json`，不会覆盖 live GraphRAG；当前空表会被拒绝。
