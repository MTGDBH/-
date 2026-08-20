# GraphRAG 知识源与证据治理清单

更新时间：2026-08-20

本轮知识库不是把网页全文复制进系统，而是将公开权威页面和论文的关键结论做成可审计摘要，并在每条摘要上保留来源 URL、发布机构、年份、文献类型和证据等级。正式医疗使用前仍需医学专家逐条审核。

## 已纳入来源

| 文件 | 来源 | 类型 | 用途 |
|---|---|---|---|
| `who_hypertension_2025.md` | [WHO Hypertension](https://www.who.int/news-room/fact-sheets/detail/hypertension) | WHO事实表 | 血压复测、盐、活动、烟草、并发症与急症 |
| `who_diabetes_2024.md` | [WHO Diabetes](https://www.who.int/news-room/fact-sheets/detail/diabetes) | WHO事实表 | 糖尿病危险因素、监测和并发症 |
| `who_cvd_2025.md` | [WHO CVD](https://www.who.int/en/news-room/fact-sheets/detail/cardiovascular-diseases-%28cvds%29) | WHO事实表 | 心血管共同危险因素和疾病关联 |
| `aha_lifes_essential_8_2022.md` | [AHA Life’s Essential 8](https://professional.heart.org/en/science-news/lifes-essential-8) | AHA科学声明摘要 | 饮食、活动、尼古丁、睡眠、体重、血脂、血糖、血压共同框架 |
| `aha_stroke_prevention_2024.md` | [AHA/ASA Stroke Prevention 2024](https://professional.heart.org/en/science-news/2024-guideline-for-the-primary-prevention-of-stroke/top-things-to-know) | 专业指南摘要 | 卒中预防、久坐、饮食、社会决定因素和急症 |
| `ada_older_adults_2025.md` | [ADA Older Adults 2025](https://diabetesjournals.org/care/article/48/Supplement_1/S266/157556/13-Older-Adults-Standards-of-Care-in-Diabetes-2025) | 临床标准 | 老年糖尿病的功能、低血糖、虚弱、活动和用药边界 |
| `dpp_2002.md` | [DPP trial](https://pubmed.ncbi.nlm.nih.gov/12453955/) | 随机试验 | 生活方式干预延缓2型糖尿病的群体证据 |
| `sprint_2015.md` | [SPRINT trial](https://pubmed.ncbi.nlm.nih.gov/26551272/) | 随机试验 | 血压强化控制的研究证据与外推限制 |
| `predimed_2018.md` | [PREDIMED trial](https://pubmed.ncbi.nlm.nih.gov/29897866/) | 随机试验 | 地中海饮食与心血管预防 |
| `older_cvd_risk_review_2020.md` | [老年心血管风险系统综述](https://pubmed.ncbi.nlm.nih.gov/31958478/) | 系统综述 | 60岁以上人群风险因素和模型中等表现限制 |
| `older_physical_activity_review_2022.md` | [老年慢病身体活动系统综述](https://pubmed.ncbi.nlm.nih.gov/34664329/) | 系统综述/Meta分析 | 低至中等强度活动与血压、HbA1c和血脂 |

## 关系模型

当前图谱显式区分以下边类型：

- `has_risk_factor` / `has_nonmodifiable_factor`：疾病与可改变、不可改变因素；
- `measured_by` / `monitoring_signal`：疾病与血压、血糖、HbA1c、血脂等观测指标；
- `increases_risk_of` / `coexists_with`：疾病间风险和共病关联；
- `managed_by` / `prevention_evidence` / `supportive_evidence`：干预方向与证据；
- `urgent_signal`：危险信号与急救行动；
- `predictive_factor_in_older_adults`：老年风险模型中的预测因素，明确标记为“预测证据”，不等同因果。

每条关系都保留 `evidence`、`strength` 和对应文本片段，查询结果同时返回 `graph_context`、`retrieval_trace` 和来源元数据。

## 质量边界

GraphRAG 负责“根据证据解释和排序建议”，不负责诊断、处方、药物剂量和个体治疗目标。风险模型的概率必须与缺失数据、适用人群和外部验证一起展示；行为指标（步数、睡眠）用于行为模式，不做精确疾病未来预测。

## 更新流程

1. 新增文献摘要到 `input/guidelines/`，填写 `source_url/publisher/publication_year/document_type/evidence_level/review_status`。
2. 新增关系到 `input/relations.json`，关系必须指向已有或明确新建的实体，并填写证据片段。
3. 运行 `python graphrag_index.py build` 重建索引。
4. 运行 `test_graphrag.py`、`evaluate_graph.py` 和个性化评估，确认检索、证据和行动差异没有回归。
