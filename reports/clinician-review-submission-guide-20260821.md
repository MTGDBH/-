# 医生审核结构化提交指南

## 用途

当前正式输入是 `elderly-health-rag/eval_framework/review_packets/clinician_review_v1/high_risk_relation_review.csv`，包含 v9 的 90 条高风险关系且仍为 0 条审核。`reports/clinician-review-template.csv` 是 83 条历史版本，不得继续作为当前审核输入。任何空表都不是医生审核结果，也不会自动改变 `review_status`。

## 填写规则

- 每一行对应一个 `relation_index`，不能删除、复制或改写关系本体字段。
- 当前表的 `decision` 只能填写：`approve`、`revise`、`reject`。
- 只要填写结论，就必须填写真实审核人的匿名受控编号、角色、ISO 日期、审核版本和理由；`revise` 还必须填写 `revision_text`。
- `approve` 前必须核对来源摘录、URL、版本、发布日期和适用人群；急症、用药、阈值和疾病因果关系不能仅凭 AI 预审批准。

## 校验命令

```powershell
$py = 'python'
& $py D:\BIGCHUANG\-\elderly-health-rag\generate_clinician_review_packet.py --output-dir D:\BIGCHUANG\-\elderly-health-rag\eval_framework\review_packets\clinician_review_v1
& $py D:\BIGCHUANG\-\elderly-health-rag\validate_clinician_reviews.py D:\BIGCHUANG\-\elderly-health-rag\eval_framework\review_packets\clinician_review_v1\high_risk_relation_review.csv --out D:\BIGCHUANG\-\reports\clinician-review-validation-latest.json
```

当前空表校验结果应为 `pending`、90 行、0 条审核；这证明表格完整，不证明医生审核已完成。最小 3–5 人核心关系评价使用 `reports/clinician-panel-ratings-template.csv`，但它也不能替代全部 90 条正式逐条审核。校验脚本不会写入生产索引。

只有当前 90 条全部完成真实审核、且没有 `revise` 或 `reject` 时，才可以运行：

```powershell
& $py D:\BIGCHUANG\-\elderly-health-rag\apply_clinician_reviews.py D:\BIGCHUANG\-\elderly-health-rag\eval_framework\review_packets\clinician_review_v1\high_risk_relation_review.csv --apply
```

该命令只生成版本化 `output/clinician_review_decisions.v1.json`，不会覆盖 live GraphRAG；当前空表会被拒绝。
