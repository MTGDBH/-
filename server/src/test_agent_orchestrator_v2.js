import assert from 'node:assert/strict';
import { AGENT_TOOL_POLICIES, classifyAgentIntent, emergencyReply, groundedNumbersMatch, needsLiveHealthContext, planAgentTools } from './ai/orchestratorV2.js';

const namesFor = message => planAgentTools(classifyAgentIntent(message), message).map(item => item.name);

assert.deepEqual(namesFor('请介绍健康管理的基本概念'), [], '普通知识不应读取个人健康工具');
assert.equal(needsLiveHealthContext('请介绍健康管理的基本概念', classifyAgentIntent('请介绍健康管理的基本概念')), false);
assert.equal(needsLiveHealthContext('血压为什么影响脑卒中', classifyAgentIntent('血压为什么影响脑卒中')), false, '一般健康教育不能读取个人指标');
assert.equal(needsLiveHealthContext('为什么我的血压最近偏高', classifyAgentIntent('为什么我的血压最近偏高')), true);
assert.deepEqual(namesFor('看看我最近90天的血压趋势'), ['health_trend'], '血压趋势应合并为一次工具任务');
assert.deepEqual(namesFor('我的高血压风险有多高'), ['htn_risk'], '高血压风险只调用对应模型');
assert.deepEqual(namesFor('我的糖尿病风险有多高'), ['disease_risk'], '四病风险只调用对应疾病模型');
assert.deepEqual(namesFor('看看总体健康状况'), ['health_summary', 'alerts'], '总体健康并行读取摘要和预警');
assert.ok(namesFor('最近睡眠怎么样').includes('behavior'));
assert.ok(namesFor('设备为什么没有同步').includes('device'));
assert.ok(namesFor('血压为什么会影响脑卒中').includes('knowledge'));

const crowded = namesFor('看看总体健康、睡眠、设备同步和待处理预警');
assert.ok(crowded.length <= 3, '单轮工具预算最多3项');
assert.equal(new Set(crowded).size, crowded.length, '单轮工具必须去重');
assert.ok(Object.values(AGENT_TOOL_POLICIES).every(policy => policy.level === 'read' && policy.subject_bound && policy.input_schema), '注册表必须声明权限和输入Schema');

const toolResults = [{ result: { latest: [{ value: 128, value2: 85, unit: 'mmHg', recorded_at: '2026-08-23' }] } }];
assert.equal(groundedNumbersMatch('最近血压是128/85 mmHg，记录于2026-08-23。', toolResults, null), true);
assert.equal(groundedNumbersMatch('最近血压是140/90 mmHg。', toolResults, null), false, '没有证据的健康数字必须拒绝');
assert.equal(emergencyReply('我突然一侧手臂无力，说话含糊')?.source, 'safety_rule', '卒中口语化症状必须直接进入急症通道');
assert.equal(emergencyReply('我想了解卒中知识'), null, '普通健康知识不应误触发急症通道');

console.log('agent orchestrator v2 deterministic routing: PASS');
