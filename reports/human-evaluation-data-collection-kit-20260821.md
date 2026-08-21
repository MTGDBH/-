# 人因评价数据采集包

## 用途

用于收集匿名的老人端理解度、行动完成率和医生/健康管理人员证据评价。三种条件固定为：`template`（普通模板）、`ordinary_rag`（普通 RAG）和 `graphrag`（GraphRAG）。

## 采集原则

- 只使用去标识化的 `participant_id`，不记录姓名、联系方式或病历号。
- 真实老人目标 15–30 人；医生/健康管理人员目标 3–5 人。
- 每个参与者在相同问题和相同界面条件下完成对照，条件顺序随机化并记录。
- 先完成伦理/知情同意和急症安全培训；遇到急症题目不让参与者等待系统预测。
- `forecast_mistaken_as_diagnosis=1`、`unsafe_advice=1` 或 `urgent_recall=0` 必须进入安全复核，不得隐藏在平均分中。

## 运行分析

```powershell
$py = 'C:\Users\zhaoq\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
& $py D:\BIGCHUANG\-\reports\analyze_human_evaluation.py D:\path\to\human_eval.csv --out D:\path\to\human_eval_result.json
```

空模板或样本量不足时，脚本只返回 `incomplete/candidate` 和缺口，不会生成“完成率”结论。模板文件为 `reports/human-evaluation-data-template.csv`。
