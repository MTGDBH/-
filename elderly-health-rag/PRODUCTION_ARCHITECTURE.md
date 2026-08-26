# GraphRAG 生产化交付边界

当前代码已经具备可验收的知识闭环：版本化来源 → 分块 → 实体关系 → 疾病社区 → 证据分层检索 → 个性化行动 → 7天行动计划 → DeepSeek 解释 → 引用、关系路径和免责声明。当前索引版本与统计只从 `output/index_stats.json` 自动生成，见本文末尾构建区块；`validate_graph.py` 还会检查观察性证据的因果标记、来源字段、审核队列和矛盾关系。`evaluate_graph.py`、`evaluate_personalization.py`、`evaluate_golden.py`、`evaluate_counterfactual.py` 和 `evaluate_retrieval_methods.py` 用于校验检索、个性化、计划、反事实差异和三路方法对照。

离线检索层现在拆分为五步流水线：过滤 → BM25/dense 独立召回 → RRF 融合 → 受限 GraphStore 扩展 → reranker。原始 BM25 与 cosine 分数只作为 `stage_scores` 审计字段，不直接相加；图阶段采用偏向直接命中的 weighted RRF，防止弱图邻居覆盖强直接证据。BM25 医学词表扩展也是确定、可追踪的 lexical 行为。`GraphStore` 定义后端边界，当前实现为 `JsonGraphStore`；Neo4j 仍是可选部署项。联网搜索结果不会进入该构建入口，只有 `input/guidelines` 和审核注册表能够写入正式索引。

Node 侧保持 `queryKnowledgeGraph(question, disease, context, options)` 接口，原字段继续保留，并兼容新增 `confidence` 与真实有序路径字段。老人及照护者端默认隐藏 `relationship_candidates`；医生/临床/审计端可读取待审核候选，其他角色必须同时满足显式 `research_preview=true` 和服务端授权。

真正公网工业部署还必须把本地 hashing/JSON 基线替换或扩展为：

1. Neo4j/同类图数据库保存实体、关系、时间版本和证据来源；
2. 经医学语料评估并离线固定版本的向量模型与向量数据库；
3. 经验证的 Cross-encoder 重排器，结合疾病、指标、严重程度和用户角色做权限过滤；
4. 医学审核工作流、来源版本、失效日期和回滚；
5. 离线检索评估（Recall@k、MRR、证据覆盖率）、建议安全评估和人工审核；
6. 生产监控、审计日志、密钥托管、限流和故障降级。

当前已增加本地审计字段：聊天记录保存 GraphRAG 证据快照、索引版本、引用和个性化因素；来源可由医生在 `/api/knowledge/graph/reviews` 审核；本地模式故障时仍可返回有证据的结构化降级结果。迁移 Neo4j 或向量库时不得改变 Node 工具接口，必须保留 `graph_mode`、检索能力和索引版本字段。

在这些基础设施尚未部署前，系统明确标记为课堂演示/局域网试用，不把轻量索引冒充临床生产 GraphRAG。

<!-- GRAPHRAG_STATS:START -->
索引 `2026-08-26.v9`：83 个可审计来源、129 个分块、192 个实体、557 条关系、6 个疾病社区、221 条待审核关系候选。

> 此段由 `output/index_stats.json` 在 `python graphrag_index.py build` 时自动生成，请勿手写统计。
<!-- GRAPHRAG_STATS:END -->
