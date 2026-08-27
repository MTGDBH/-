# GraphRAG 正式评测报告

协议号：`<protocol_id>`  
数据 seal：`<sha256 / seal path>`  
运行 ID：`<run_id>`  
模型/索引版本：`<immutable versions>`  
评审一致性：`<Cohen's kappa or Krippendorff's alpha by field>`

> 本报告禁止给出跨 split 平均数。`regression_internal` 仅为开发回归，不是外部验证。

## regression_internal

样本数：`<n>`；方法：`<blinded or released method id>`；门槛：`pass/fail`。

| 指标 | 值 | 适用样本数 | 门槛 | 结论 |
|---|---:|---:|---:|---|
| Recall@5 | | | | |
| MRR | | | | |
| nDCG@10 | | | | |
| 关系路径正确率 | | | | |
| 急症漏报率 | | | | |
| 急症误报率 | | | | |
| 应拒答率 | | | | |

## blind

状态：`not_collected / collected_unsealed / sealed_not_run / evaluated`。样本不足 100 时必须醒目标记。使用同一指标表，并补充引用支持率、个性化有效率、证据删除反事实适当率、无关记录鲁棒率、攻击抵抗率。不得与其他 split 合并。

## external

状态：`not_collected / collected_unsealed / sealed_not_run / evaluated`。样本不足 50 时必须醒目标记。使用同一指标表。说明数据来源机构、独立性、纳排标准、匿名标注者和裁决流程。不得与其他 split 合并。

若 blind/external 尚未真实收集，所有指标填写 `NA`，不得用 regression_internal、AI 标注或示例数据代填。

## 失败案例

附 `failure_cases.csv`，逐例说明错误类型、证据、影响、根因类别和拟采取的通用修复。不得通过改答案或为该题增加关键词规则来关闭错误。

## 发布结论

- 泄漏审计：`pass/fail`
- 三个 split 门槛：分别列出
- 未通过项和阻断原因：`<items>`
- 决定：`release / no release`
