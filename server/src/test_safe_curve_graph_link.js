import assert from 'node:assert/strict';
import {
  buildGraphEvidenceSnapshot, buildPredictionSnapshot, createPredictionEvent,
  enforceSafeCurveGraphResponse, predictionUncertain,
} from './ai/safeCurveGraphLink.js';

const base = {
  metric: 'systo', status: 'ok', unit: 'mmHg', latest_value: 142, long_term_trend: 'rising',
  schema_version: 'curve.v2', model: 'robust_linear', measurement_condition_coverage: 1,
  change_point: false, forecast: { available: true, model: 'robust_linear', horizon_days: 7,
    coverage_target: 0.8, calibration_coverage: 0.85, mean_interval_width: 12, boundary_hit: false,
    calibration_status: 'rolling_residual_conformal', curve: { lower: [138, 139], upper: [150, 151] } },
};
const approvedGraph = {
  index_version: 'test.v1',
  results: [{ citation: 'guide.md#正确复测', section: '正确复测与医生评估', text: '按相同条件连续复测；连续异常需要医生评估。', review_status: 'approved', source_review_state: 'approved' }],
  recommendations: [{ priority: 'high', action: '按相同条件复测，若连续异常请医生评估。', reason: '连续异常', evidence: 'guide.md#正确复测', action_type: 'schedule_recheck' }],
};

const snapshot = buildPredictionSnapshot({ metrics: [base] }, '2026-08-27T00:00:00.000Z');
const graph = buildGraphEvidenceSnapshot(approvedGraph, '2026-08-27T00:00:00.000Z');
const normal = enforceSafeCurveGraphResponse({ content: 'LLM invented 999' }, snapshot, graph, { systo: 'mmHg' });
assert.match(normal.content, /138–151/);
assert.doesNotMatch(normal.content, /999/);
assert.ok(normal.prediction_snapshot.snapshot_hash);
assert.ok(normal.graph_evidence_snapshot.snapshot_hash);

// 反事实 1：关闭预测后，回答不得出现未来区间。
const off = createPredictionEvent({ ...base, forecast: { ...base.forecast, available: false } }, '2026-08-27T00:00:00.000Z');
const offReply = enforceSafeCurveGraphResponse({}, { ...snapshot, events: [off] }, graph, { systo: 'mmHg' });
assert.match(offReply.content, /当前不提供未来数值/);
assert.doesNotMatch(offReply.content, /138–151/);

// 反事实 2：扩大区间后只能表达“不确定”。
const wide = createPredictionEvent({ ...base, forecast: { ...base.forecast, mean_interval_width: 80, curve: { lower: [100], upper: [180] } } });
assert.equal(predictionUncertain(wide), true);
assert.match(enforceSafeCurveGraphResponse({}, { ...snapshot, events: [wide] }, graph).content, /不确定/);

// 反事实 3：删除近期数据使预测门槛失效，回答退回“不提供未来数值”。
const noRecent = createPredictionEvent({ ...base, status: 'insufficient_data', quality_flags: ['recent_data_removed'], forecast: { ...base.forecast, available: false } });
assert.match(enforceSafeCurveGraphResponse({}, { ...snapshot, events: [noRecent] }, graph).content, /当前不提供未来数值/);

// 引用门禁：未审核的一般科普不得支撑具体行动。
const unreviewed = buildGraphEvidenceSnapshot({ index_version: 'test.v1', results: [{ citation: 'general.md#科普', section: '一般科普', text: '健康知识', review_status: 'pending_medical_review' }], recommendations: [{ action: '血压达到 180 时采取具体行动', evidence: 'general.md#科普' }] });
assert.equal(unreviewed.recommendations.length, 0);

console.log('safe curve -> GraphRAG counterfactual tests passed');
