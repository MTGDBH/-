# GraphRAG 独立数据收集、冻结与仲裁协议

本协议只提供工具和空白材料。当前 `blind.json`、`external.json` 均为空；不得用 AI 生成的问题、答案或标签补足样本量，也不得把项目开发者的答案当作独立金标准。

## 数据层级

- `regression_internal`：保留现有 61 条，仅用于开发回归。
- `blind_internal`（schema 中为 `dataset_split=blind`）：建议至少 100 条。问题作者必须未参与检索代码开发；在数据冻结前，开发人员不得看到答案标注。
- `external_clinician`（schema 中为 `dataset_split=external`）：建议 50～100 条，由真实医生或合作机构提供。公开数据仅保存匿名 `annotator_id`，真实身份映射置于获批的受控存储。

## 问题覆盖

blind 问题作者应按预注册配额覆盖：同义改写、常见错别字、口语/方言化表达、多疾病问题、否定问题、数据不足、急症、恶意诱导和需要拒答的问题。配额由数据保管人在收集前冻结，开发者不能根据系统失败类型追加针对题。

## 两阶段收集

1. 问题作者填写 `templates/blind_question_intake.csv` 或 `templates/external_clinician_question_intake.csv`，不填写答案标签。
2. 数据保管人分配匿名 case。至少两位标注者分别填写独立的 `case_annotation.csv`，字段包括：
   - `relevant_evidence_ids_json`
   - `acceptable_relations_json`
   - `forbidden_claims_json`
   - `urgency_label`
   - `required_abstention`
   - `audience`
   - `patient_context_json`
3. 在解盲系统输出前运行一致性计算。若任一核心分类字段 kappa/alpha 低于预注册阈值，或多标签 Jaccard 低于阈值，先修订指南并重新培训，不得为提高系统成绩直接改标签。
4. 有分歧时填写 `case_adjudication.csv`。高风险题（急症、用药、需拒答、包含 forbidden claim）必须由有资格的第三人仲裁并记录理由；原始两份标注不可覆盖。
5. 使用 `collect_cases.py` 生成最终 JSON。工具只接受双人标注和已解决分歧，不调用模型生成金标准。

## 收集与一致性命令

```powershell
cd D:\BIGCHUANG\-\elderly-health-rag

python eval_framework\case_agreement.py `
  --annotations private-artifacts\annotations\annotator_a.csv private-artifacts\annotations\annotator_b.csv `
  --output private-artifacts\annotations\agreement.json

python eval_framework\collect_cases.py `
  --split blind `
  --questions private-artifacts\collection\blind_questions.csv `
  --annotations private-artifacts\annotations\blind_a.csv private-artifacts\annotations\blind_b.csv `
  --adjudication private-artifacts\annotations\blind_adjudication.csv `
  --output eval_framework\cases\blind.json
```

external 使用相同命令，将 `--split` 改为 `external`。问题表的 `source_type` 必须为 `clinician` 或 `partner_institution`。这只是来源声明字段，项目不得虚构医生或机构。

## 数据完整性和冻结

正式冻结前先检查：

```powershell
python eval_framework\validate_datasets.py `
  --require-ready `
  --output private-artifacts\eval-integrity.json

python eval_framework\seal_datasets.py `
  --require-ready `
  --protocol-id EVICARE-EVAL-001 `
  --custodian-id <anonymous_custodian_id> `
  --output private-artifacts\eval-seal.json
```

`--require-ready` 会在 blind 少于 100、external 少于 50、未完成双标注或仲裁时阻止冻结。seal 后不得依据测试结果修改题目、证据 ID 或标签；任何必要更正都必须新建 protocol/version、保留旧 seal，并说明原因。

## 分歧仲裁

1. 一致性不足：暂停仲裁，先修订指南并用非测试练习题重新培训。
2. 一般分歧：第三位独立标注者查看原始证据和两份理由，形成裁决。
3. 高风险分歧：必须由具备相应临床角色的仲裁者处理；记录匿名 ID、角色、时间、版本和理由。
4. 仲裁者不得查看待评系统输出、方法名称或性能。
5. 保留原始标注、仲裁记录和版本历史，不以多数投票掩盖系统性指南问题。

## 报告

使用 `templates/EMPTY_EVALUATION_REPORT.json` 和 `templates/METRICS_REPORT.md`。`regression_internal`、`blind`、`external` 必须分开报告，禁止跨 split 平均。数据未收集、未冻结、样本不足或一致性不足时填写 `not_collected`/`blocked`，不得填写推测分数。
