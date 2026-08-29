# 人因评价数据采集包

## 用途

用于收集匿名的老人端理解度、行动完成率和医生/健康管理人员证据评价。三种条件固定为：`template`（普通模板）、`ordinary_rag`（普通 RAG）和 `graphrag`（GraphRAG）。

## 采集原则

- 只使用去标识化的 `participant_id`，不记录姓名、联系方式或病历号。
- 最小适老化任务评价为 10–15 名真实老人；医生 3–5 人改用独立的核心关系审核评分表，不与老人任务行混填。
- 每个参与者在相同问题和相同界面条件下完成对照，条件顺序随机化并记录。
- 先完成伦理/知情同意和急症安全培训；遇到急症题目不让参与者等待系统预测。
- `forecast_mistaken_as_diagnosis=1`、`unsafe_advice=1` 或 `urgent_recall=0` 必须进入安全复核，不得隐藏在平均分中。

## 运行分析

```powershell
$py = 'C:\Users\zhaoq\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
& $py D:\BIGCHUANG\-\reports\analyze_human_evaluation.py D:\path\to\human_eval.csv --out D:\path\to\human_eval_result.json
```

空模板、合成编号或样本量不足时，脚本保持 `pending` 并列出缺口，不会生成可写作真实研究结论的状态。模板文件为 `reports/human-evaluation-data-template.csv`；完整纳排、停止和安全流程见 `reports/real-world-evaluation-execution-toolkit.md`。
