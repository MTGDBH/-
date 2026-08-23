import assert from 'node:assert/strict';
import { buildAgentPresentation, presentationGroundingText } from './ai/presentation.js';
import { groundedNumbersMatch } from './ai/orchestratorV2.js';

const subject = { id: 7, name: '张奶奶' };
const actor = { id: 7, name: '张奶奶' };
const baseIntent = { trendHit: true };
const liveContext = {
  latest: {
    bp: { value: 128, value2: 85, unit: 'mmHg', recorded_at: '2026-08-22T08:00:00.000Z' },
    hr: { value: 72, unit: 'bpm', recorded_at: '2026-08-22T08:01:00.000Z', measurement_condition: '静息' },
    weight: { value: 61.5, unit: 'kg', recorded_at: '2026-08-21T08:00:00.000Z' },
    sleep: { value: 7.2, unit: '小时', recorded_at: '2026-08-21T07:00:00.000Z' },
  },
};
const toolResults = [{
  name: 'health_trend', status: 'success', result: {
    metrics: [
      { metric: 'systo', long_term_trend: 'stable', status: 'ok' },
      { metric: 'diasto', long_term_trend: 'stable', status: 'ok' },
      { metric: 'pulse', long_term_trend: 'stable', status: 'ok' },
      { metric: 'weight', long_term_trend: 'falling', status: 'ok' },
    ],
  },
}];

const plain = buildAgentPresentation({ response: { content: '你好' }, intent: {}, subject, actor });
assert.deepEqual(plain, { mode: 'plain' }, '普通问候应保持文本气泡');

const card = buildAgentPresentation({
  response: { content: '现在：现在：近期血压总体平稳', plan: [
    { title: '继续规范测量', desc: '固定时间并记录测量条件', action_type: 'schedule_recheck' },
    { title: '查看记录', desc: '对照最近一周记录' },
    { title: '不应出现', desc: '超过数量限制' },
  ] }, toolResults, liveContext, intent: baseIntent, subject, actor,
});
assert.equal(card.mode, 'health_card');
assert.equal(card.status.tone, 'stable');
assert.equal(card.status.text, '近期血压总体平稳');
assert.ok(card.facts.length <= 3, '关键数据最多3项');
assert.ok(card.actions.length <= 2, '行动最多2项');
assert.equal(card.facts[0].value, '128/85');
assert.equal(card.facts[0].unit, '毫米汞柱', '老人端不得显示英文单位');
assert.equal(card.facts[0].context, '测量条件未填写');
assert.equal(card.actions[0].requires_confirmation, true);
assert.equal(groundedNumbersMatch(presentationGroundingText(card), toolResults, liveContext), true, '卡片数字必须可在证据中匹配');

const caregiverCard = buildAgentPresentation({
  response: { content: '近期记录已整理', plan: [] }, toolResults, liveContext,
  intent: baseIntent, subject, actor: { id: 9, name: '家属' },
});
assert.equal(caregiverCard.status.title, '张奶奶的当前结论');

const emergency = buildAgentPresentation({
  response: { source: 'safety_rule', content: '请立即联系急救，不要等待智能体分析。', plan: [{ title: '普通建议' }] },
  intent: {}, subject, actor,
});
assert.equal(emergency.mode, 'emergency');
assert.equal(emergency.status.tone, 'urgent');
assert.equal(emergency.actions.length, 1);
assert.equal(emergency.actions[0].title, '立即求助');
assert.equal(emergency.actions[0].requires_confirmation, false);
assert.equal(emergency.safety.level, 'urgent');

const insufficient = buildAgentPresentation({
  response: { content: '相关工具暂时不可用', plan: [] },
  toolResults: [{ name: 'device', status: 'error' }], intent: { deviceHit: true }, subject, actor,
});
assert.equal(insufficient.status.tone, 'insufficient');
assert.equal(insufficient.facts.length, 1);

const localized = buildAgentPresentation({
  response: { content: 'systo stable，单位 mmHg', plan: [] },
  toolResults, liveContext, intent: baseIntent, subject, actor,
});
assert.doesNotMatch(localized.status.text, /systo|mmHg/i, '内部指标代码不得进入卡片');
assert.match(localized.status.text, /高压（收缩压）|毫米汞柱/);

console.log('agent presentation v2 structured cards: PASS');
