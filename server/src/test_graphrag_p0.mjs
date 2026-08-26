import assert from 'node:assert/strict';
import { queryKnowledgeGraph } from './ai/tools/knowledgeGraph.js';

const question = '营养 肌力 活动 跌倒 认知 情绪 多重用药';
const elderly = await queryKnowledgeGraph(question, null, {}, {
  audience: 'elderly', enableHiddenRelationships: true, topK: 8, maxHops: 2,
});
assert.deepEqual(elderly.relationship_candidates, [], 'legacy preview flag bypassed authorization');

const doctor = await queryKnowledgeGraph(question, null, {}, {
  audience: 'doctor', topK: 8, maxHops: 2,
});
assert.ok(doctor.relationship_candidates.length > 0, 'doctor audit view missing candidates');
assert.ok(doctor.relationship_candidates.every(row =>
  row.review_status === 'pending_medical_review' && row.usage_status === 'research_preview_active' && row.not_for_actions === true));

const graph = await queryKnowledgeGraph('血压连续偏高怎么复测', 'hypertension', {
  latest: { bp: { value: 150, value2: 92 } },
}, { audience: 'elderly', topK: 6, maxHops: 2, sourceReviewPenalty: 1 });
assert.notEqual(graph.uncertainty.level, 'high');
assert.ok(graph.graph_paths.every(path => path.hop_count === path.edges.length && path.nodes.length === path.hop_count + 1));
assert.equal(graph.retrieval_trace.source_review_penalty, 1);

const hybrid = await queryKnowledgeGraph('血压连续偏高怎么复测', 'hypertension', {}, {
  audience: 'elderly', backend: 'full_hybrid', topK: 5,
  vectorModel: 'hashing_char_ngram_v1', rerankerModel: 'local_linear_v1',
});
assert.equal(hybrid.retrieval_capabilities.stages.vector.active, true);
assert.equal(hybrid.retrieval_capabilities.stages.reranker.active, true);
assert.ok(hybrid.results.every(row => row.source_id && row.chunk_id && row.source_version
  && row.review_status && row.retrieved_at && row.evidence_level && row.stage_scores));
assert.deepEqual(hybrid.results.map(row => row.stage_scores.final_rank), [1, 2, 3, 4, 5]);

const degraded = await queryKnowledgeGraph('血压连续偏高怎么复测', 'hypertension', {}, {
  backend: 'full_hybrid', vectorModel: 'Z:/missing/vector-model', rerankerModel: 'Z:/missing/reranker-model',
});
assert.equal(degraded.retrieval_capabilities.stages.vector.active, false);
assert.equal(degraded.retrieval_capabilities.stages.reranker.active, false);
assert.ok(degraded.retrieval_capabilities.degradations.some(row => row.stage === 'vector'));

console.log(JSON.stringify({ pass: true, doctor_candidates: doctor.relationship_candidates.length,
  elderly_candidates: elderly.relationship_candidates.length, paths: graph.graph_paths.length,
  hybrid_results: hybrid.results.length, degradations: degraded.retrieval_capabilities.degradations.length }));
