# 国奖冲刺任务矩阵（截至 2026-08-21）

## 结论

工程演示、可复现实验和证据治理已形成可提交的原型材料；真实临床审核、真实受试者评价和带日期外部验证必须由项目组在校内/合作机构完成，当前不以合成数据冒充完成。

| 任务 | 状态 | 当前证据 | 仍需补的外部项 |
|---|---|---|---|
| 风险数据版本、样本数统一 | 已完成 | `ml/risk_data_manifest.json`，六个派生工件分别列 n/阳性数/哈希 | 答辩前冻结原始数据授权凭证 |
| Curve V2 评测 | 已完成（本地/演示集） | `reports/curve-model-evaluation-2026-08-20.md`，28/28；张奶奶演示序列 90 个有效日期见 `reports/demo-curve-data-generation-20260821.md` | 60–90 天真实纵向外部集 |
| DeepSeek/验收字段契约 | 已完成 | `server/src/test_tool_calling.js`，22/22；Node 22 最终验收 PASS；`reports/deepseek-runtime-audit-20260821.md` 记录 provider/model/call_status 契约 | 演示现场配置真实 Key 并保留脱敏日志 |
| 统一实验运行 ID | 已完成 | `ml/experiment_metadata.py`、`ml/reports/*audit*.json` | 提交前锁定 Git tag |
| 数据/代码/模型/参数留痕 | 已完成 | `experiment-run.v1` manifests、SHA256、参数 | 归档只读副本 |
| 演示/研究/测试数据分离 | 已完成 | `ml/DATA_CLASSIFICATION.md`、`risk_data_manifest.json` | 现场展示数据授权说明 |
| 高风险关系医学状态 | 已完成（AI 预审 + 结构化待签署表） | 83/83 有预审；66 教育可用、17 需临床确认；老人端门槛回归通过；`reports/clinician-review-report-20260821.md`、`reports/clinician-review-template.csv`；空表校验 pending | 4 类核心疾病持证医生逐条签字 |
| 核心疾病 A/B/C 证据分层 | 已完成 | GraphRAG v6：78 来源、111 chunks、159 entities、419 edges；来源门控回归见 `reports/graphrag-source-gate-regression-20260821.json` | 继续补最新版本并完成医学复核 |
| 来源版本、适用人群、限制 | 已完成 | `source_manifest.json` | 对 4 个 legacy pending 来源补签或移出核心证据 |
| 冲突检测与路径解释 | 已完成 | `evidence_conflicts.json`、61 题 GraphRAG 评测 | 医生复核冲突语义 |
| 关键词/普通 RAG/GraphRAG 对照 | 已完成（内部集） | `reports/graphrag-method-comparison-20260821.md`；新增 24 题内部改写留出集，必需证据/引用/路径/急症召回均 100% | 扩到独立外部问题集 |
| 个性化差异 | 已完成（合成） | 20/20 配对变化率 1.0 | 真实老人盲评 |
| 风险模型 Logistic/XGBoost | 已完成（随机留出 + CHARLS 波次时间留出 + 参与者独立敏感性分析） | `ml/reports/national-award-risk-evaluation-20260821.*`、`reports/national-award-risk-temporal-evaluation-20260821.md`、`reports/national-award-risk-temporal-disjoint-evaluation-20260821.md`；Wave1→2/2→3/3→4 训练，Wave4→5 测试，敏感性分析重叠=0 | 带日级日期的独立外部队列和真实临床验证 |
| Bootstrap/Brier/校准/决策曲线 | 已完成（随机留出 + 波次时间审计） | 同上 JSON/MD；校准与决策曲线 SVG 已生成于 `ml/reports/national-award-risk-figures/` | 外部队列校准 |
| 65–74/75+/性别/缺失分层 | 已完成 | 扩展风险审计 JSON | 小组置信区间与外部公平性 |
| 真实老人/医生评价 | 评测框架、采集包和合成流程夹具已完成，真实样本未完成 | `reports/human-evaluation-protocol-20260821.md`、`reports/human-evaluation-data-collection-kit-20260821.md`、`reports/analyze_human_evaluation.py`、`reports/human-evaluation-synthetic-pipeline-20260821.md`；合成 54 行仅验证流水线 | 招募、伦理/知情同意、盲评 |
| 60–90 天 Curve 外部验证 | 框架和采集包已完成，真实数据未完成 | `ml/curve/temporal_validation.py`、`ml/curve/validate_external_dataset.py`、`reports/curve-external-data-collection-kit-20260821.md`；90 天合成干跑 29 个预测窗口/1 个拒绝窗口 | 采集并按老人隔离测试 |
| 数据卡、模型卡、架构图 | 已完成/本包补齐 | `reports/model-card-and-experiment-protocol-2026-08-20.md`、本目录材料 | 项目组署名与指导教师确认 |
| 5 分钟演示脚本 | 本轮生成 | `deliverables/national_award/demo_script.md` | 按现场数据走一遍 |
| 汇报 PPT | 本轮生成 | `deliverables/national_award/elderly_health_national_award.pptx` | 现场字体/视频兼容检查 |
| 项目总结书 | 本轮生成 | `.tex` 与 `.pdf`；提交前自检 `reports/submission-readiness-check-20260821.md` 为 36/36 | 补学校模板、作者和指导教师信息 |
| 最终提交审计与外部闸门清单 | 已完成（本地） | `reports/final-submission-audit-20260821.md/json`；`reports/external-gate-execution-checklist-20260821.md`；本地状态 `ready_with_external_gates` | 医生签字、真实人因、真实 Curve 外部集和独立风险队列仍需线下完成 |

## 不能写进申报书的表述

- 不能把 AI 预审核写成“医生审核已完成”；
- 不能把 61 题黄金集写成真实患者疗效；
- 不能把随机留出写成时间外部验证；
- 不能把演示账号或合成曲线写成临床数据；
- 不能把风险概率写成诊断或个体必然患病。

## 现场提交前最小动作

1. 将 4 个 legacy pending 来源完成医生确认或明确移出核心知识范围；
2. 在学校/合作机构完成至少一轮真实老人和医生盲评；
3. 用带日期纵向数据补跑 Curve V2 外部验证；
4. 用学校申报模板替换总结书封面作者信息，并由指导教师确认安全边界。
