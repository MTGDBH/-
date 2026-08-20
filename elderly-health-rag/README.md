# 老年人常见疾病 GraphRAG 知识层

本目录提供一个可离线运行的、可审计的 GraphRAG-style 知识检索层：先把指南段落切片，再抽取疾病、指标、危险信号和行动之间的关系，查询时同时使用关键词相似度和图邻居扩展。返回结果包含来源文件、章节和证据等级，供智能体引用。

它是课堂演示和局域网试用的轻量实现，不是临床决策系统。当前知识库包含 WHO、AHA/ASA、ADA、PubMed 随机试验和系统综述摘要，并通过 `input/relations.json` 显式维护疾病、危险因素、指标、干预和急症关系。来源、证据等级和更新规则见 `KNOWLEDGE_SOURCES.md`。

## 构建与查询

```powershell
python graphrag_index.py build
python graphrag_index.py query --question "血压连续偏高应该怎么办" --disease hypertension
```

Node 智能体通过 `server/src/ai/tools/knowledgeGraph.js` 调用同一个 `query` CLI，因此不会把知识常识和用户实际测量数据混在一起。

查询结果现在还会返回 `recommendations`：它由疾病、当前指标上下文和危险信号共同决定，包含 `priority/action/reason/evidence`；智能体会把这些结构化行动和证据强制带入最终回答。`evaluate_graph.py` 用不同用户上下文验证同一问题会得到不同优先级。

注意：这已经是可审计的本地 GraphRAG 闭环，但尚未冒充公网临床工业部署。Neo4j/向量数据库、医学审核、权限、监控和外部验证要求见 `PRODUCTION_ARCHITECTURE.md`。
