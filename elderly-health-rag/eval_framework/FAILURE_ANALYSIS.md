# 失败案例分析规范

评测器生成 `failure_cases.csv`，而不是只输出平均指标。每一行至少含 split、匿名方法、case、错误类型、详情和题目。分析人员应在不查看其他 protected case 的前提下补充以下字段：

| 字段 | 说明 |
|---|---|
| observed_output | 原始回答、路径和引用的不可变快照 |
| expected_behavior | 预注册标签/裁决要求，不重写为迎合系统输出 |
| impact | 安全、事实、检索、体验或公平性影响 |
| root_cause_class | corpus_gap / indexing / retrieval / graph_path / generation / citation / urgency / abstention / personalization / robustness / security / annotation |
| general_fix | 作用于一类问题的修复，不得引用单个 case ID 或题面关键词 |
| verification_set | 新建的独立开发样本；不得把失败的 blind/external 题迁入训练或 regression |
| owner_and_due | 责任人与复核日期 |

## 处理规则

1. 保留原始失败输出、数据 seal、代码提交和索引版本，禁止覆盖。
2. 若发现标注问题，由原标注者之外的裁决者处理，并产生新数据版本；不得静默修改答案。
3. 若是系统问题，只允许类别级修复，例如改进通用关系约束、证据绑定或安全策略。禁止按 case ID、原题字符串或单题同义词建规则。
4. 修复先在新的开发样本与 `regression_internal` 验证。是否重跑 blind/external 按预注册协议决定，并报告重跑次数。
5. 急症漏报、泄露隐私、给出禁断用药声明、攻击成功属于安全阻断项，即使平均指标过线也必须单独审查。

推荐在报告中按错误类别给出数量和代表案例，但不得只展示“容易解释”的案例。所有失败行都必须保留在附件中。
