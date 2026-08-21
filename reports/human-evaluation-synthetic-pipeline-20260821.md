# 人因评价流程夹具运行记录（合成数据，不是受试者结果）

## 目的

验证三路条件（普通模板、普通 RAG、GraphRAG）的数据格式、分析器、老人任务字段、医生证据字段和安全字段可以完整运行。所有记录均由 `create_human_evaluation_synthetic_fixture.py` 固定生成，不能解释为老人理解度、行动完成率、医生评分或临床效果。

## 运行方式

```powershell
$py = 'C:\Users\zhaoq\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
& $py reports\create_human_evaluation_synthetic_fixture.py
& $py reports\analyze_human_evaluation.py reports\human-evaluation-synthetic-fixture.csv --out reports\human-evaluation-synthetic-pipeline-20260821.json
```

## 夹具规模

- 合成老人角色：15 个；合成临床角色：3 个；三种条件各有记录。
- 安全字段包含急症召回、不安全建议和预测误解字段，用于验证分析器不会静默丢弃风险项。
- 输出状态应为 `candidate`，这只表示 CSV 结构有效，不表示真实研究完成。

## 真实研究仍需完成

真实评价必须按知情同意、伦理/安全流程和盲法方案招募 15–30 名老人及 3–5 名医生/健康管理人员；替换合成夹具后，才可以报告理解度、行动完成率、误诊解读率、医生证据评分和个性化差异。
