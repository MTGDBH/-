# 老年人常见疾病 GraphRAG 知识层

本目录提供一个可离线运行的、可审计的 GraphRAG-style 知识检索层：先把指南段落切片，再抽取疾病、指标、危险信号和行动之间的关系，查询时同时使用关键词相似度、证据等级和图邻居扩展。返回结果包含来源文件、章节、证据等级、关系路径、个性化因素、安全标记和索引版本，供智能体引用。

它是课堂演示和局域网试用的轻量实现，不是临床决策系统。当前知识库包含 18 个原始 WHO、AHA/ASA、ADA、KDIGO、PubMed 摘要、42 个分层来源注册条目和 18 个可追溯指南/系统综述/关键研究登记，共 78 个可审计来源；索引含 111 个分块、159 个实体、419 条关系和 6 个疾病社区，并通过 `input/relations.json` 与 `input/evidence_registry.json` 显式维护五类慢病、老年衰弱、危险因素、指标、干预和急症关系。来源、证据等级、审核协议和更新规则见 `KNOWLEDGE_SOURCES.md` 与 `MEDICAL_REVIEW_PROTOCOL.md`。

## 构建与查询

```powershell
python graphrag_index.py build
python graphrag_index.py query --question "血压连续偏高应该怎么办" --disease hypertension
python validate_graph.py
```

Node 智能体通过 `server/src/ai/tools/knowledgeGraph.js` 调用同一个 `query` CLI，因此不会把知识常识和用户实际测量数据混在一起。

查询结果现在还会返回 `recommendations`、`weekly_plan`、`graph_paths`、`personalization`、`safety_flags` 和 `citations`：行动由疾病、当前指标上下文、个人趋势、测量条件和危险信号共同决定，包含 `priority/action/reason/evidence_ids/personalized_for/schedule`；智能体会把这些结构化行动和证据强制带入最终回答。默认老人端会过滤待临床确认关系；4 个 legacy 待复核来源默认只显示 `source_review_required` 标记，不被伪装为已批准知识，严格审计可传 `source_gate=exclude_legacy_pending`；医生/审计端可通过 `audience=doctor` 查看完整路径。`evaluate_graph.py`、`evaluate_personalization.py`、`evaluate_counterfactual.py`、`test_medical_gate.py` 和 `test_source_gate.py` 用不同用户上下文验证行动差异、审核准入和来源门控。

配套的 `evaluate_golden.py`、`evaluate_counterfactual.py`、`evaluate_retrieval_methods.py` 和 `validate_graph.py` 分别覆盖人工标注问题、单因素反事实个性化、关键词/普通 RAG/GraphRAG 对照和关系/来源冲突检查；`retrieval_backends.py` 预留向量召回、Cross-Encoder 重排和 Neo4j 混合检索接口，当前不可用时自动回退本地模式。

注意：这已经是可审计的本地 GraphRAG 闭环，但尚未冒充公网临床工业部署。当前已完成高风险关系的 AI 证据预审核，但不替代医生签字；Neo4j/向量数据库、医学审核、权限、监控和外部验证要求见 `PRODUCTION_ARCHITECTURE.md`。
