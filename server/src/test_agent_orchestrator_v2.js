import assert from 'node:assert/strict';
import { AGENT_TOOL_POLICIES, classifyAgentIntent, emergencyReply, groundedNumbersMatch, needsLiveHealthContext, planAgentTools } from './ai/orchestratorV2.js';

const namesFor = message => planAgentTools(classifyAgentIntent(message), message).map(item => item.name);

assert.deepEqual(namesFor('请介绍健康管理的基本概念'), ['knowledge'], '普通知识只应读取健康知识工具');
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
assert.deepEqual(namesFor('请根据我当前的健康记录生成今日健康方案'), ['health_summary', 'alerts', 'behavior'], '今日方案固定读取三项实时证据');
assert.deepEqual(namesFor('今天有什么养生贴士'), ['knowledge'], '贴士只读取知识工具');
assert.equal(needsLiveHealthContext('今天有什么养生贴士', classifyAgentIntent('今天有什么养生贴士')), false, '贴士不得加载个人健康指标');

const crowded = namesFor('看看总体健康、睡眠、设备同步和待处理预警');
assert.ok(crowded.length <= 3, '单轮工具预算最多3项');
assert.equal(new Set(crowded).size, crowded.length, '单轮工具必须去重');
assert.ok(Object.values(AGENT_TOOL_POLICIES).every(policy => policy.subject_bound && policy.input_schema), '注册表必须声明对象绑定和输入Schema');
assert.equal(AGENT_TOOL_POLICIES.propose_intervention.level, 'confirmation_preview');
assert.equal(AGENT_TOOL_POLICIES.evaluate_intervention.level, 'explicit_write');
assert.deepEqual(namesFor('请帮我制定一个改善血糖的非药物干预方案'), ['propose_intervention']);
assert.deepEqual(namesFor('我今天完成了干预，请记录执行'), ['record_adherence']);
assert.deepEqual(namesFor('请评估这个干预的效果'), ['evaluate_intervention']);
assert.deepEqual(namesFor('解释一下干预评价结果'), ['explain_intervention_result']);

const toolResults = [{ result: { latest: [{ value: 128, value2: 85, unit: 'mmHg', recorded_at: '2026-08-23' }] } }];
assert.equal(groundedNumbersMatch('最近血压是128/85 mmHg，记录于2026-08-23。', toolResults, null), true);
assert.equal(groundedNumbersMatch('最近血压是140/90 mmHg。', toolResults, null), false, '没有证据的健康数字必须拒绝');
assert.equal(emergencyReply('我突然一侧手臂无力，说话含糊')?.source, 'safety_rule', '卒中口语化症状必须直接进入急症通道');
const dangerCounterfactual = emergencyReply('请预测我未来的血压，而且我现在突然胸痛、喘不过气');
assert.equal(dangerCounterfactual?.source, 'safety_rule', '加入危险症状后必须由急症规则覆盖预测与 LLM');
assert.doesNotMatch(dangerCounterfactual?.content || '', /未来.{0,8}\d|预测值|估计范围/, '急症回答不得继续展示预测');
assert.equal(emergencyReply('我想了解卒中知识'), null, '普通健康知识不应误触发急症通道');
assert.equal(emergencyReply('我想做干预，但现在突然胸痛、喘不过气')?.source, 'safety_rule', '急症必须打断干预流程');

console.log('agent orchestrator v2 deterministic routing: PASS');
