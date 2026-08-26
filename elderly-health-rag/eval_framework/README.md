# GraphRAG 正式评测框架

本目录把既有 `eval/golden_questions.json` 固定定义为 `regression_internal`。它只用于开发回归，不再被称为外部验证，也不得与 blind 或 external 的结果混合平均。真实 blind/external 数据必须由数据保管人独立写入 `cases/blind.json` 和 `cases/external.json`；仓库不伪造外部样本。

## 防泄漏原则

1. 在运行待评方法前完成题目、qrel、可接受关系、禁断声明、紧急度和拒答标签的双人标注与裁决。
2. 用 `seal_datasets.py` 记录三个 split 的 SHA-256、协议号、保管人和时间。blind/external 的原文及 seal 不交给开发者。
3. 方法开发只能查看 `regression_internal`。blind/external 由独立执行者运行；开发者只接收冻结后的分 split 报告与错误类别。
4. 禁止改测试答案、从 case ID/题目文本分支、针对单题添加词表或检索扩展。`leakage_check.py` 会检查跨 split 重复、受保护题目/ID 是否出现在实现代码、双标注状态和 seal 变更。
5. 任何调参后的 blind 重跑都要登记为一次新的分析；用于发布判定的 blind 结果只能来自预注册的一次冻结运行。external 在最终锁定后运行。

## 数据

- `schema/case.schema.json`：要求的统一 case schema，并允许用 `test_design` 表达配对干预。
- `schema/run-record.schema.json`：方法输出契约。`asserted_claim_ids` 使用预注册声明 ID，不用字符串关键词匹配回答。
- `datasets.json`：三类数据注册表。旧 golden 通过只读适配器映射，不修改原题或答案。
- `examples/case_examples.json`：仅演示，不得计入发布结果。

`acceptable_relations` 是一个或多个完整可接受路径。只有预测覆盖其中一条路径的全部 `(source, relation, target)` 边才算正确。`patient_context` 的键是可归因因素；配对个性化 case 的 `trigger_factors` 必须对应这些键。

## 运行流程

```powershell
cd D:\BIGCHUANG\-\elderly-health-rag

# 1. 冻结数据（seal 文件应由独立保管人保管）
python eval_framework\seal_datasets.py --protocol-id EVICARE-EVAL-001 --custodian-id data_custodian --output private-artifacts\eval-seal.json

# 2. 检查泄漏；发布审计必须带 --seal
python eval_framework\leakage_check.py --seal private-artifacts\eval-seal.json --output reports\leakage-audit.json

# 3. 系统按 run-record schema 生成原始预测 predictions.jsonl

# 4. 生成盲评包（salt 和 private/ 解盲表不能交给评审）
python eval_framework\blind_review.py --predictions predictions.jsonl --annotators reviewer_a reviewer_b --salt "<random-secret>" --output-dir private-artifacts\blind-review

# 5. 两位评审独立填写 annotation_*.csv，计算一致性
python eval_framework\agreement.py --annotations private-artifacts\blind-review\annotation_reviewer_a.csv private-artifacts\blind-review\annotation_reviewer_b.csv --fields citation_support personalization_reasonable personalization_attributable counterfactual_appropriate irrelevant_robust attack_resisted --output reports\interrater-agreement.json

# 6. 有分歧时由第三方裁决；合并到新文件，不覆盖原始预测
python eval_framework\merge_annotations.py --predictions predictions.jsonl --blind-items private-artifacts\blind-review\blind_items.jsonl --codebook private-artifacts\blind-review\private\method_codebook.json --annotations private-artifacts\blind-review\annotation_reviewer_a.csv private-artifacts\blind-review\annotation_reviewer_b.csv --adjudication adjudication.csv --output adjudicated_predictions.json

# 7. 分 split 评分、门槛和错误案例表
python eval_framework\evaluator.py --predictions adjudicated_predictions.json --output-dir reports\formal-eval
```

## 指标解释

- 检索：Recall@1/3/5/10、MRR、nDCG@10，以预注册 `relevant_evidence_ids` 为 qrel。
- 关系：至少命中一条完整 `acceptable_relations` 路径。
- 引用：`citation_retrieval_consistency` 仅检查引用是否来自本次检索；“真正支持”只使用盲评后的 `citation_support_rate`，缺标注不打分。
- 急症：分别给出漏报率和误报率；不以准确率掩盖少数急症。
- 拒答：需拒答样本的拒答率，以及不需拒答样本的不必要拒答率。
- 个性化：配对答案/完整行动集合需要发生变化，使用因素必须存在于病例上下文并属于预注册触发因素，还必须由评审确认“合理”和“可归因”。不比较第一条行动字符串。
- 反事实：删除关键证据后记录输出是否改变，并由评审判断变化是否适当。
- 鲁棒性：加入无关健康记录后记录输出不变性，并由评审判断临床语义是否保持。
- 攻击：提示注入和恶意问题由盲评判定是否抵抗；禁断声明用结构化 claim ID 检查。

## 发布判定

`release_gates.json` 的性能/安全阈值在评测前登记，均未写死为 100%。每个 split、每个方法独立过门槛；预测必须覆盖该 split 的全部注册 case（这是输入完整性校验，不是性能指标）。任何必需 split 缺数据、指标缺少适用样本/盲评、样本数不足或泄漏审计失败都会阻止发布。框架没有跨 split 的总平均数。

## 数据治理

blind/external 的 `annotator_ids` 在 `adjudication_status=adjudicated` 时至少包含两人。对含真实健康信息的数据，仓库只保存去标识 case ID；原始映射、seal、方法解盲表和评审身份映射保存在 `private-artifacts/` 或组织批准的受控存储中。
