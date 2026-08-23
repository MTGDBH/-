import assert from 'node:assert/strict';
import { classifyAgentIntent, planAgentTools } from './ai/orchestratorV2.js';
import { resolveDialogueTurn } from './ai/orchestratorV3.js';

const subject = { id: 1, name: '张奶奶' };
const conversation = { id: 99, dialogue_state: JSON.stringify({ schema_version: 'agent-dialogue-state.v1', metrics: ['systo','diasto'], days: 90, disease: 'hypertension' }) };
const follow = resolveDialogueTurn(conversation, subject, '那最近一周呢？');
assert.deepEqual(follow.intent.trendMetrics, ['systo','diasto']);
assert.equal(follow.intent.days, 7);
assert.equal(follow.inherited, true);
assert.match(follow.resolvedMessage, /指标=systo,diasto/);

const low = resolveDialogueTurn(conversation, subject, '再看看低压趋势');
assert.deepEqual(low.intent.trendMetrics, ['diasto'], '明确低压不应强制合并高压');
const fresh = resolveDialogueTurn({ id: 100, dialogue_state: '{}' }, subject, '看看最近趋势');
assert.equal(fresh.intent.trendMetrics.length, 0, '新会话不得继承旧指标');

const followupIntent = classifyAgentIntent('我的复测任务到期了吗？');
assert.equal(followupIntent.followupHit, true);
assert.ok(planAgentTools(followupIntent, '我的复测任务到期了吗？').some(item => item.name === 'followup_status'));
const crowded = classifyAgentIntent('看看总体健康、睡眠、设备、预警为什么');
assert.ok(planAgentTools(crowded, '看看总体健康、睡眠、设备、预警为什么', { limit: false }).length > 3);
assert.ok(planAgentTools(crowded, '看看总体健康、睡眠、设备、预警为什么').length <= 3);

console.log('agent v3 dialogue state and tool clarification: PASS');
