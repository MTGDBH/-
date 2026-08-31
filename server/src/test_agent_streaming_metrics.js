import assert from 'node:assert/strict';
import { activeAgentRunCount, cancelAgentRun, registerAgentRun, throwIfAgentCancelled } from './services/agentRunCancellation.js';
import { metricsSnapshot } from './services/opsMetrics.js';
import db from './db.js';
import { buildEvidenceCard, buildHealthContext } from './ai/contextBuilder.js';

const task = registerAgentRun(7, 'stream-test');
assert.equal(activeAgentRunCount(), 1);
assert.equal(cancelAgentRun(7, 'stream-test'), true);
assert.equal(task.signal.aborted, true);
assert.throws(() => throwIfAgentCancelled(task.signal), error => error.code === 'AGENT_CANCELLED');
task.finish();
assert.equal(activeAgentRunCount(), 0);
assert.equal(cancelAgentRun(7, 'missing'), false);

const metrics = metricsSnapshot();
assert.equal(metrics.schema_version, 'ops-metrics.v1');
assert.equal(typeof metrics.llm.last_24h.failure_rate, 'number');
assert.equal(typeof metrics.llm.last_7d.fallback_count, 'number');
assert.equal(typeof metrics.llm.last_7d.total_tokens, 'number');
assert.equal(typeof metrics.llm.last_7d.estimated_cost_cny, 'number');
const user = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
const evidence = buildEvidenceCard(buildHealthContext(user, 90), '看看最近血压趋势', { type: 'data', score: 80 });
const bp = evidence.items.find(item => item.metric === '血压');
assert.ok(bp.measured_at && bp.trend_start_date && bp.trend_end_date, '证据必须包含最新和趋势引用日期');
assert.ok(bp.series.length >= 2 && bp.series.every(row => row.recorded_at && Number.isFinite(row.value)), '趋势图必须使用带日期的真实序列');
console.log('agent streaming cancellation and LLM metrics contract: PASS');
