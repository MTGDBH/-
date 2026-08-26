import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPythonTool } from '../../lib/htnPredictor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', '..', '..', '..', 'elderly-health-rag', 'graphrag_index.py');

export async function queryKnowledgeGraph(question, disease = null, context = {}, options = {}) {
  const researchPreviewRequested = options.researchPreview === true || options.research_preview === true || options.enableHiddenRelationships === true;
  const researchPreviewAuthorized = options.researchPreviewAuthorized === true || options.research_preview_authorized === true;
  const result = await runPythonTool(SCRIPT, {
    question,
    disease,
    context,
    options: {
      top_k: Math.max(1, Math.min(10, Number(options.topK || options.top_k || 6))),
      max_hops: Math.max(1, Math.min(2, Number(options.maxHops || options.max_hops || 2))),
      include_trace: options.includeTrace !== false,
      audience: options.audience || 'elderly',
      explain_level: options.explainLevel || 'standard',
      backend: options.backend || 'local_hybrid',
      vector_model: options.vectorModel || options.vector_model || process.env.GRAPHRAG_VECTOR_MODEL,
      vector_index: options.vectorIndex || options.vector_index || process.env.GRAPHRAG_VECTOR_INDEX,
      reranker_model: options.rerankerModel || options.reranker_model || process.env.GRAPHRAG_RERANKER_MODEL,
      rrf_k: options.rrfK || options.rrf_k,
      review_status: options.reviewStatus || options.review_status,
      published_after: options.publishedAfter || options.published_after,
      published_before: options.publishedBefore || options.published_before,
      max_graph_nodes: options.maxGraphNodes || options.max_graph_nodes,
      max_graph_edges: options.maxGraphEdges || options.max_graph_edges,
      allowed_node_types: options.allowedNodeTypes || options.allowed_node_types,
      allowed_relation_types: options.allowedRelationTypes || options.allowed_relation_types,
      source_gate: options.sourceGate || options.source_gate || 'flag_legacy_pending',
      source_review_penalty: options.sourceReviewPenalty ?? options.source_review_penalty,
      research_preview: researchPreviewRequested,
      research_preview_authorized: researchPreviewAuthorized,
      // Backward-compatible option name; authorization remains mandatory.
      enable_hidden_relationships: researchPreviewRequested && researchPreviewAuthorized && process.env.GRAPHRAG_RESEARCH_RELATIONSHIPS !== '0',
    },
  });
  // CLI 接口通过 argparse，runPythonTool 只能传 stdin；用 query 参数兼容服务端调用。
  return result;
}
