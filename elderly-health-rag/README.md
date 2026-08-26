# 老年人常见疾病 GraphRAG 知识层

本目录提供一个可离线运行的、可审计的 GraphRAG-style 知识检索层：先把指南段落切片，再抽取疾病、指标、危险信号和行动之间的关系，查询时同时使用关键词相似度、证据等级和图邻居扩展。返回结果包含来源文件、章节、证据等级、关系路径、个性化因素、安全标记和索引版本，供智能体引用。

它是课堂演示和局域网试用的轻量实现，不是临床决策系统。索引版本和统计只以构建产物 `output/index_stats.json` 及本文末尾自动生成区块为准，避免手写数字漂移。图谱通过 `input/relations.json` 与 `input/evidence_registry.json` 显式维护五类慢病、老年衰弱、危险因素、指标、干预和急症关系。来源、证据等级、审核协议和更新规则见 `KNOWLEDGE_SOURCES.md` 与 `MEDICAL_REVIEW_PROTOCOL.md`。

## 构建与查询

```powershell
python graphrag_index.py build
python graphrag_index.py build-retrieval-index --vector-model hashing_char_ngram_v1
python graphrag_index.py query --question "血压连续偏高应该怎么办" --disease hypertension
python validate_graph.py
python evaluate_retrieval_methods.py --config eval/retrieval_methods_config.json
```

## 离线混合检索

主查询按四个明确检索阶段执行：BM25 lexical → dense vector → 有界图扩展 → 可选 reranker；lexical 与 vector 之间使用 RRF 排名融合，图扩展使用偏向直接命中的 weighted RRF。BM25 的确定性医学词表扩展会记录在 trace 中，仍属于 lexical 阶段。`local_hybrid` 保留为无模型降级路径，只启用 BM25、JSON 图扩展和既有医学门控；它不会把词项重叠伪装成向量检索。

默认离线评测配置位于 `eval/retrieval_methods_config.json`。内置 `hashing_char_ngram_v1` 是确定性的稠密向量基线，使用余弦相似度，但不是学习型语义 embedding；`local_linear_v1` 是确定性本地重排基线。也可以把模型值改成本地 SentenceTransformers/CrossEncoder 目录，系统不会下载模型。

Node/环境配置示例：

```text
GRAPHRAG_VECTOR_MODEL=hashing_char_ngram_v1
GRAPHRAG_VECTOR_INDEX=D:\BIGCHUANG\-\elderly-health-rag\output\dense_index.json
GRAPHRAG_RERANKER_MODEL=local_linear_v1
```

请求 `backend=full_hybrid` 时，返回的 `retrieval_capabilities.stages` 会逐阶段记录 `requested/available/active/model/fallback_reason`。模型或索引缺失时保留 BM25/图路径，并在 `degradations` 中说明原因；不会声称 dense 或 reranker 已启用。

图存储通过 `GraphStore` 接口隔离。当前 `JsonGraphStore` 只从融合检索命中的 chunk 实体和显式疾病实体开始扩展，并限制跳数、节点类型、关系类型、节点数和边数；`Neo4jGraphStore` 仅保留可选接口，不会隐式联网。

Node 智能体通过 `server/src/ai/tools/knowledgeGraph.js` 调用同一个 `query` CLI，因此不会把知识常识和用户实际测量数据混在一起。

查询结果还会返回 `recommendations`、`weekly_plan`、`graph_paths`、`personalization`、`safety_flags`、`citations`、`uncertainty` 和兼容新增的 `confidence`。`graph_paths` 是有序的 `nodes/edges/hop_count/path_score/evidence_ids/review_status` 结构。默认老人及照护者端不返回关系候选；只有医生/临床/审计，或 `research_preview=true` 且服务端确认授权时可见。legacy 待复核来源默认带标记并按 `source_review_penalty` 降权，严格模式 `source_gate=exclude_legacy_pending` 直接排除。

配套的 `evaluate_golden.py`、`evaluate_counterfactual.py`、`evaluate_retrieval_methods.py` 和 `validate_graph.py` 分别覆盖人工标注问题、单因素反事实个性化、BM25 lexical baseline/dense RAG/GraphRAG 六路消融和关系/来源冲突检查。`retrieval_backends.py` 已实现 BM25、可配置 dense、可配置 Cross-Encoder 重排和 JSON 图扩展；任一模型不可用时会结构化回退，Neo4j 仅为可选后端接口。

注意：这已经是可审计的本地 GraphRAG 闭环，但尚未冒充公网临床工业部署。当前已完成高风险关系的 AI 证据预审核，但不替代医生签字；Neo4j/向量数据库、医学审核、权限、监控和外部验证要求见 `PRODUCTION_ARCHITECTURE.md`。

<!-- GRAPHRAG_STATS:START -->
索引 `2026-08-26.v9`：83 个可审计来源、129 个分块、192 个实体、557 条关系、6 个疾病社区、221 条待审核关系候选。

> 此段由 `output/index_stats.json` 在 `python graphrag_index.py build` 时自动生成，请勿手写统计。
<!-- GRAPHRAG_STATS:END -->
