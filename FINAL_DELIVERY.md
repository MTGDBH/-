# 老年人健康管理系统：四阶段最终交付说明

## 交付范围

1. **时间趋势**：Curve V2 对血压、按条件分组的血糖、体重和静息心率进行稳健历史趋势和分层预测；默认未来 7 天，数据充分时扩展到 14 天，30 天仅给周级区间；步数、睡眠和综合分只做行为/历史趋势，不做精确医学预测。输出原始点、清洗点、趋势线、预测点、预测上下界、异常点、回测指标和拒绝原因。
2. **疾病风险**：用 CHARLS Wave1→Wave2 的新发结局训练四类两年筛查模型；Logistic 与 XGBoost 使用训练集交叉验证选择，测试集只做最终评估，概率经校准并输出缺失特征和模型卡。
3. **GraphRAG**：WHO、AHA/ASA、ADA、KDIGO、PubMed系统综述和关键随机试验等 18 份原始知识源 + 42 条分层摘要 + 18 条可追溯证据记录，共 78 个来源 → 111 个分块/159 个实体/419 条关系/6 个疾病社区。查询返回证据等级、版本、适用人群、限制、关系路径解释、审核状态和冲突标记；4 个 legacy 待复核来源默认只做显式标记，严格模式才排除；三路检索量化对照见 [GraphRAG方法评估](reports/graphrag-method-comparison-20260821.md)。
4. **智能体**：DeepSeek 负责自然语言解释，后端按意图调用健康摘要、趋势、行为模式、设备、风险和 GraphRAG 知识工具；用户数据由服务端按登录身份读取，预测与常识分开，数据不足时禁止编造。

## 验收命令

```powershell
$py = 'C:\Users\zhaoq\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
& $py D:\BIGCHUANG\-\ml\curve\test_health_curve.py
& $py D:\BIGCHUANG\-\ml\disease_risk\test_multidisease.py
& $py D:\BIGCHUANG\-\elderly-health-rag\test_graphrag.py
& $py D:\BIGCHUANG\-\elderly-health-rag\evaluate_personalization.py
& $py D:\BIGCHUANG\-\elderly-health-rag\evaluate_graph.py
& $py D:\BIGCHUANG\-\elderly-health-rag\validate_graph.py
& $py D:\BIGCHUANG\-\elderly-health-rag\medical_pre_review.py
& $py D:\BIGCHUANG\-\elderly-health-rag\test_medical_gate.py
& $py D:\BIGCHUANG\-\elderly-health-rag\evaluate_golden.py
& $py D:\BIGCHUANG\-\elderly-health-rag\evaluate_counterfactual.py
& $py D:\BIGCHUANG\-\elderly-health-rag\evaluate_personalization_pairs.py
& $py D:\BIGCHUANG\-\elderly-health-rag\evaluate_retrieval_methods.py
& $py D:\BIGCHUANG\-\ml\test_risk_data_manifest.py
node D:\BIGCHUANG\-\server\src\test_tool_calling.js
node D:\BIGCHUANG\-\server\src\test_health_trend.js
node D:\BIGCHUANG\-\server\final_acceptance.mjs
node D:\BIGCHUANG\-\server\data\evaluate_risk_personalization.mjs
node D:\BIGCHUANG\-\server\data\test_risk_profile.mjs
node D:\BIGCHUANG\-\server\data\test_actions.mjs
node D:\BIGCHUANG\-\server\data\test_care_permissions.mjs
node D:\BIGCHUANG\-\server\data\test_device_sync.mjs
node D:\BIGCHUANG\-\server\data\test_health_summary.mjs
node D:\BIGCHUANG\-\server\data\test_trend_alerts.mjs
node D:\BIGCHUANG\-\server\data\test_agent_tools.mjs
node D:\BIGCHUANG\-\server\data\test_graph_grounding.mjs
```

Node 端使用 Node 22 启动 `server/src/index.js`，登录张奶奶后依次验证：趋势问题、疾病风险问题、知识解释问题、`/api/chat/history` 和四个疾病预测接口。风险接口同时返回 `data_completeness`，说明缺失字段和建议补采内容；智能体证据卡片由后端真实上下文生成。

当前闭环模块还包括：

- 智能体建议可创建待办/复测；敏感行动需要确认并记录执行状态；
- “最近身体怎么样”会批量读取近 90 天指标、行为、缺失项、待办和预警，并在回复下方生成后端证据卡片；证据随对话持久化，刷新或打开新对话仍可回看；
- 指标保存后仅在异常或明显趋势时异步生成主动提醒，同一指标/提醒类型 24 小时去重；
- “有哪些待处理提醒”会调用只读预警工具；“帮我明早测血压/通知家属/联系医生”先生成带行动类型的计划，只有点击并确认后才写入行动闭环；
- 老人一次性授权家属或医生，只允许授权关系读取只读健康摘要；
- 蓝牙/模拟设备统一通过 `/api/devices/:id/sync` 写入 `metrics.source=device`，智能体可查询同步状态；
- 注销账号会按外键依赖清理会话、健康记录、授权关系、行动和提醒数据。
- GraphRAG 聊天回复会把索引版本、引用、关系路径和个性化理由保存到聊天历史，刷新页面后仍可追溯。
- 83 条高风险关系已完成 AI 证据预审核：66 条仅允许演示/健康教育，17 条必须临床人员确认；每条均有允许表达、禁止表达和安全护栏。预审核不替代医生签字，原审核状态仍为 `pending_medical_review`，明细见 `elderly-health-rag/output/medical_pre_review.json`。

## 国奖提交材料（2026-08-21）

- 提交材料索引：`deliverables/national_award/SUBMISSION_INDEX.md`
- 一键提交包：`deliverables/national_award/national_award_submission_bundle.zip`（不含密钥、原始个人数据和临时文件）
- 项目题目与地址：`deliverables/national_award/project_title.md`
- 汇报 PPT：`deliverables/national_award/elderly_health_national_award.pptx`
- LaTeX 总结书源文件：`deliverables/national_award/latex/project_summary.tex`
- 项目总结书 PDF：`deliverables/national_award/latex/project_summary.pdf`
- 5 分钟演示脚本：`deliverables/national_award/demo_script.md`
- 任务完成矩阵：`reports/national-award-task-matrix-20260821.md`
- 数据卡/模型卡：`deliverables/national_award/data_card.md`、`deliverables/national_award/model_card.md`
- 风险扩展审计：`ml/reports/national-award-risk-evaluation-20260821.json`、`reports/national-award-risk-evaluation-20260821.md`
- CHARLS 波次时间留出审计：`ml/reports/national-award-risk-temporal-evaluation-20260821.json`、`reports/national-award-risk-temporal-evaluation-20260821.md`（Wave4→5 测试；仍不是独立地区外部验证）
- CHARLS 参与者独立敏感性审计：`ml/reports/national-award-risk-temporal-disjoint-evaluation-20260821.json`、`reports/national-award-risk-temporal-disjoint-evaluation-20260821.md`（训练/测试参与者重叠为 0；仍不是独立地区外部验证）
- 真实人因研究协议：`reports/human-evaluation-protocol-20260821.md`
- 人因工程干跑：`reports/human-evaluation-dry-run-20260821.md`（0 名真实受试者，不宣称理解度或行动完成率）
- Curve V2 外部验证协议：`reports/curve-external-validation-protocol-20260821.md`
- Curve V2 时间验证框架：`ml/curve/temporal_validation.py`；合成 90 天干跑：`reports/curve-temporal-validation-20260821.md`
- 医学审核待签署包：`reports/clinician-review-packet-20260821.md`（83 条高风险关系，未自动批准）
- 医学审核结构化表：`reports/clinician-review-submission-guide-20260821.md`、`reports/clinician-review-template.csv`、`reports/clinician-review-validation.json`（83 行，0 条签字，状态 pending）；完整签字后由 `apply_clinician_reviews.py` 生成版本化决策文件，默认不覆盖 live GraphRAG。
- 提交前自检清单：`reports/submission-readiness-check-20260821.md`（材料与边界检查 36/36 通过）
- 提交物哈希清单：`reports/submission-artifact-manifest-20260821.json`（78 个交付物，缺失 0）
- 最终提交审计：`reports/final-submission-audit-20260821.md/json`（本地检查与外部证据门槛分离，状态为 `ready_with_external_gates`）
- 外部证据闸门清单：`reports/external-gate-execution-checklist-20260821.md`（医生审核、真实人因、Curve 外部集和风险外部队列的执行顺序）
- 回归测试汇总：`reports/regression-suite-summary-20260821.md/json`（8 组 Python 回归和 Node 最终验收）
- 医生审核报告：`reports/clinician-review-report-20260821.md/json`（待签署版，不冒充医生批准）
- 张奶奶演示数据说明：`reports/demo-curve-data-generation-20260821.md`（819 条 synthetic 演示记录及验证结果）
- GraphRAG 来源完整性审计：`reports/source-integrity-audit-20260821.md`（78 个来源，6 个核心疾病均具备指南/综述/关键研究层）
- GraphRAG 来源门控回归：`reports/graphrag-source-gate-regression-20260821.json`（老人端默认标记待复核来源，严格模式可排除，医生端保留完整图）
- Curve V2 真实数据采集包：`reports/curve-external-data-collection-kit-20260821.md`
- 人因评价数据采集包：`reports/human-evaluation-data-collection-kit-20260821.md`
- 人因评价合成流程夹具：`reports/human-evaluation-synthetic-pipeline-20260821.md`（54 行，仅验证分析流水线，不是受试者结果）
- DeepSeek 运行链路审计：`reports/deepseek-runtime-audit-20260821.md`
- 风险模型校准/决策曲线：`ml/reports/national-award-risk-figures/`

注意：真实医生签字、真实老人/医生受试者和带日期纵向外部验证是外部依赖，材料中已明确标注，不能用 AI 预审或演示数据替代。
- 审核结果已成为实际准入门槛：老人端过滤未确认的高风险关系，急症关系仅保留为安全提示；医生/审计端保留完整关系路径，门槛回归见 `reports/medical-gate-regression-20260821.json`。
- 黄金问题集已扩展到 61 条，覆盖六类核心疾病、共病、急症、数据不足和行动闭环；20 组配对老人上下文实验中 20/20 组的建议指纹发生变化，报告见 `reports/graphrag-personalization-pairs-20260821.md`。
- 另完成 24 题内部口语改写留出集：必需证据召回、引用覆盖、关系路径覆盖和急症召回均为 100%；该结果明确标为内部测试，不冒充独立外部问题集，详见 `reports/graphrag-internal-holdout-20260821.md`。
- 指标保存会记录测量条件和质量标记；重复值、物理范围异常、缺少测量条件和设备同步失败会进入数据质量/设备可靠性审计，不会被静默当作高可信证据。
- 研究数据、演示数据和测试夹具已经分开登记；`ml/DATA_CLASSIFICATION.md` 与 `ml/risk_data_manifest.json` 明确训练排除规则，演示账号不会回写风险模型训练集。
- 复测提醒与待办形成闭环：创建、确认、执行、到期、回填结果均有状态记录；敏感行动仍需要用户确认。

## 医疗安全边界

模型结果是队列筛查，不是诊断；GraphRAG 条目目前标记为演示知识，必须经专业人员审核后才能用于真实医疗场景。任何胸痛、呼吸困难、意识改变、单侧无力或言语含糊等危险信号都应直接建议急救，不等待模型预测。
