# GraphRAG 生产化交付边界

当前代码已经具备可验收的知识闭环：版本化来源 → 分块 → 实体关系 → 疾病社区 → 证据分层检索 → 个性化行动 → 7天行动计划 → DeepSeek 解释 → 引用、关系路径和免责声明。当前索引为 `2026-08-21.v6`，包含 78 个可审计来源、6 个疾病社区、157 个实体和 416 条关系；`validate_graph.py` 还会检查观察性证据的因果标记、来源字段、审核队列和矛盾关系。`evaluate_graph.py`、`evaluate_personalization.py`、`evaluate_golden.py`、`evaluate_counterfactual.py` 和 `evaluate_retrieval_methods.py` 用于校验检索、个性化、计划、反事实差异和三路方法对照。

Node 侧保持 `queryKnowledgeGraph(question, disease, context, options)` 接口，当前返回 `results`、`graph_paths`、`personalization`、`safety_flags`、`citations`、`uncertainty` 和 `index_version`。老人端读取结论和行动，医生端可读取完整检索追踪，不让原始文件名或内部节点 ID直接暴露给老人。

真正公网工业部署还必须把本地 JSON 索引替换为：

1. Neo4j/同类图数据库保存实体、关系、时间版本和证据来源；
2. BGE-M3 或经过医学语料评估的向量模型 + 向量数据库做语义召回；
3. Cross-encoder 重排，结合疾病、指标、严重程度和用户角色做权限过滤；
4. 医学审核工作流、来源版本、失效日期和回滚；
5. 离线检索评估（Recall@k、MRR、证据覆盖率）、建议安全评估和人工审核；
6. 生产监控、审计日志、密钥托管、限流和故障降级。

当前已增加本地审计字段：聊天记录保存 GraphRAG 证据快照、索引版本、引用和个性化因素；来源可由医生在 `/api/knowledge/graph/reviews` 审核；本地模式故障时仍可返回有证据的结构化降级结果。迁移 Neo4j 或向量库时不得改变 Node 工具接口，必须保留 `graph_mode`、检索能力和索引版本字段。

在这些基础设施尚未部署前，系统明确标记为课堂演示/局域网试用，不把轻量索引冒充临床生产 GraphRAG。
