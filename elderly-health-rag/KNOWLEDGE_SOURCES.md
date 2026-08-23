# GraphRAG 知识源与证据治理清单

更新时间：2026-08-23

本轮知识库不是把网页全文复制进系统，而是将公开权威页面和论文的关键结论做成可审计摘要，并在每条摘要上保留来源 URL、发布机构、年份、文献类型和证据等级。正式医疗使用前仍需医学专家逐条审核。

当前索引为 `2026-08-23.v7`：共 83 个可审计来源、129 个分块、192 个实体和 557 条索引关系。每条来源登记版本、发布时间、适用人群、限制、PMID/DOI（如有）、原文 URL 和审核状态；不复制论文全文。

所有高强度关系以及急症、用药、医生复核、疾病风险和干预关系，都会写入 `output/relation_review_manifest.json`。默认状态为 `pending_medical_review`，在医学人员确认前只能用于演示、检索审计和健康教育；`validate_graph.py` 会检查每条高风险索引关系是否具有明确审核状态。

逐条审核字段和准入规则见 [`MEDICAL_REVIEW_PROTOCOL.md`](MEDICAL_REVIEW_PROTOCOL.md)。当前已生成 90 条高风险关系的 AI 预审核报告 `output/medical_pre_review.json`：70 条仅可用于演示/健康教育，20 条仍需临床确认。该报告建立的是可审计的预审核队列，不把 `pending_medical_review` 误报为临床批准。

系统还生成 `output/hidden_relationship_candidates.json`，当前包含 221 条缺少直接边的两跳关联候选。测试版通过 `GRAPHRAG_RESEARCH_RELATIONSHIPS` 启用研究预览：医生最多查看 8 条，老人和家属最多查看 3 条；每条必须显示中间节点、两段证据和“尚未证明直接因果”提示。候选可参与知识解释，但不会自动写回图谱，也不能生成诊断、用药调整、急症降级或自动健康行动。

证据冲突检测结果写入 `output/evidence_conflicts.json`，查询结果同时返回 `evidence_conflicts`、`graph_paths[].explanation`、证据等级、适用人群、关系条件、审核状态和 AI 预审核状态。老人端会过滤待临床确认关系，医生/审计端保留完整路径；准入回归见 `reports/medical-gate-regression-20260821.json`。关键词、普通 RAG、GraphRAG 的同题对照见 `reports/graphrag-method-comparison-20260821.md`；61 条黄金问题和 20 组配对老人个性化评测见 `reports/graphrag-personalization-pairs-20260821.md`。

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
| `kdigo_ckd_2024.md` | [KDIGO CKD Evaluation and Management](https://kdigo.org/guidelines/ckd-evaluation-and-management/) | 临床指南摘要 | eGFR、肌酐、尿白蛋白、血压和糖尿病共病 |
| `who_physical_activity_2020.md` | [WHO Guidelines on Physical Activity](https://www.who.int/publications/i/item/9789240015128) | 全球指南摘要 | 活动、久坐、老年人功能状态和安全边界 |
| `older_adult_safety.md` | [ADA Older Adults Standards](https://diabetesjournals.org/care/article/48/Supplement_1/S266/157556/13-Older-Adults-Standards-of-Care-in-Diabetes-2025) | 临床标准摘要 | 虚弱、跌倒、认知、低血糖、多重用药和回答边界 |
| `who_icope_2017.md` | [WHO ICOPE](https://www.who.int/publications/i/item/9789241550109) | WHO 指南 | 功能、营养、视听、认知、情绪、跌倒和照护支持的整合评估 |
| `cdc_steadi_2025.md` | [CDC STEADI 药学照护](https://www.cdc.gov/steadi/hcp/clinical-resources/pharmacy-care.html) | 公共卫生临床资源 | 多重用药、头晕、体位性变化、药物复核与跌倒风险 |
| `cdc_vision_falls_2024.md` | [CDC 视力与跌倒](https://www.cdc.gov/vision-health/prevention/older-adult-falls.html) | 公共卫生资料 | 视力、慢病、药物、社会隔离与跌倒的综合发现 |
| `aha_sleep_brain_2024.md` | [AHA 睡眠与脑健康声明](https://pubmed.ncbi.nlm.nih.gov/38235581/) | 科学声明 | 睡眠紊乱与卒中、认知及脑健康的关联边界 |
| `ada_older_adults_2026.md` | [ADA 老年照护标准 2026](https://diabetesjournals.org/care/article/49/Supplement_1/S277/163921/13-Older-Adults-Standards-of-Care-in-Diabetes-2026) | 临床标准 | 功能、认知、低血糖、虚弱、营养、多重用药和照护支持 |
| `elderly_frailty.md` | [WHO/ADA older-adult safety summaries](https://diabetesjournals.org/care/article/48/Supplement_1/S266/157556/13-Older-Adults-Standards-of-Care-in-Diabetes-2025) | 老年安全摘要 | 虚弱、跌倒风险、认知和分层行动 |
| `hypertension.md` | 项目早期高血压知识摘要 | 内部演示摘要 | 血压阈值、复测和安全边界（待医学审核） |
| `diabetes.md` | 项目早期糖尿病知识摘要 | 内部演示摘要 | 血糖监测和生活方式（待医学审核） |
| `cardiovascular.md` | 项目早期心血管知识摘要 | 内部演示摘要 | 共同危险因素（待医学审核） |

## 关系模型

当前图谱显式区分以下边类型：

- `has_risk_factor` / `has_nonmodifiable_factor`：疾病与可改变、不可改变因素；
- `measured_by` / `monitoring_signal`：疾病与血压、血糖、HbA1c、血脂等观测指标；
- `increases_risk_of` / `coexists_with`：疾病间风险和共病关联；
- `managed_by` / `prevention_evidence` / `supportive_evidence`：干预方向与证据；
- `urgent_signal`：危险信号与急救行动；
- `predictive_factor_in_older_adults`：老年风险模型中的预测因素，明确标记为“预测证据”，不等同因果。
- `complicates` / `shares_risk_factor_with`：共病和共同风险网络；
- `threshold_contextualized_by` / `trend_signal_for`：阈值和趋势必须结合测量条件解释；
- `requires_remeasurement` / `requires_medical_review` / `do_not_self_adjust_medication`：安全与行动边界。
- `major_preventable_driver` / `complicates` / `shares_risk_factor_with`：共同风险网络和共病管理复杂性。
- `associated_with` / `predictive_factor_in_older_adults`：仅表示统计关联或预测因素，默认禁止改写为因果。

每条关系都保留 `evidence`、`strength` 和对应文本片段，查询结果同时返回 `graph_context`、`retrieval_trace` 和来源元数据。

## 质量边界

GraphRAG 负责“根据证据解释和排序建议”，不负责诊断、处方、药物剂量和个体治疗目标。风险模型的概率必须与缺失数据、适用人群和外部验证一起展示；行为指标（步数、睡眠）用于行为模式，不做精确疾病未来预测。

## 更新流程

1. 新增文献摘要到 `input/guidelines/`，填写 `source_url/publisher/publication_year/document_type/evidence_level/review_status`。
2. 新增关系到 `input/relations.json`，关系必须指向已有或明确新建的实体，并填写证据片段。
3. 运行 `python graphrag_index.py build` 重建索引。
4. 运行 `test_graphrag.py`、`evaluate_graph.py` 和个性化评估，确认检索、证据和行动差异没有回归。
5. 运行 `validate_graph.py`，确保关系类型、来源元数据和实体引用通过 schema 校验。
