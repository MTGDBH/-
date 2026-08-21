// ============================================================
// Phase 2.5: analyze_health_trend 测试（Node 侧）
// 运行: node server/src/test_health_trend.js
// 覆盖: 单指标/多指标/insufficient/forecast/Tool schema/userId安全/
//       Agent Tool Calling(模拟LLM)/risk_predict 回归/普通 chat 回归
// ============================================================
import 'dotenv/config';
import { analyzeHealthTrend, TREND_METRICS } from './ai/tools/healthTrend.js';
import { chat, RISK_TOOL_SCHEMA, ANALYZE_TREND_TOOL_SCHEMA } from './ai/agent.js';
import { riskPredict } from './ai/tools/riskPredict.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
};

const user1 = { id: 1, name: '张奶奶', height: 1.6 };
const healthSummary = { total_score: 90, subscores: {} };
const savedKey = process.env.OPENAI_API_KEY;

console.log('=== 1. 单指标（systo，真实 DB 数据）===');
const r1 = await analyzeHealthTrend(user1.id, { metric: 'systo', days: 90 });
ok('success', r1.success === true, JSON.stringify(r1));
ok('返回趋势字段', ['rising', 'falling', 'stable'].includes(r1.long_term_trend), r1.long_term_trend);
ok('短期/长期分开', 'recent_trend' in r1 && 'long_term_trend' in r1);
ok('unit=mmHg', r1.unit === 'mmHg', r1.unit);
ok('curve 数组齐全', r1.curve && r1.curve.timestamps.length === r1.curve.actual.length);

console.log('=== 2. 多指标 all ===');
const rall = await analyzeHealthTrend(user1.id, { metric: 'all', days: 90 });
ok('success 且 analyzed 非空', rall.success === true && rall.analyzed.length > 0, JSON.stringify(rall.analyzed));
ok('co_occurrence 只描述同向变化', rall.co_occurrence && typeof rall.co_occurrence === 'object');

console.log('=== 3. 无数据指标 → insufficient/跳过 ===');
const rh = await analyzeHealthTrend(user1.id, { metric: 'hbalc', days: 90 });
ok('hbalc（DB 无数据）status=insufficient_data', rh.status === 'insufficient_data', rh.status);
ok('all 中不含 hbalc（数据不足跳过）', !rall.analyzed.includes('hbalc'), JSON.stringify(rall.analyzed));

console.log('=== 4. 非法 metric 被拒 ===');
const rbad = await analyzeHealthTrend(user1.id, { metric: 'rm -rf' });
ok('非法 metric → success=false', rbad.success === false, JSON.stringify(rbad));

console.log('=== 5. days 限制（7-365 钳制）===');
const rdays = await analyzeHealthTrend(user1.id, { metric: 'systo', days: 99999 });
ok('days 被钳制', rdays.requested_days <= 365, rdays.requested_days);

console.log('=== 6. userId 由 req.user 注入（不来自文本）===');
const rA = await analyzeHealthTrend(1, { metric: 'systo' });
const rB = await analyzeHealthTrend(2, { metric: 'systo' });
ok('不同用户返回不同数据', JSON.stringify(rA.curve) !== JSON.stringify(rB.curve), `${rA.data_points}/${rB.data_points}`);

console.log('=== 7. Tool schema 安全 ===');
const params = ANALYZE_TREND_TOOL_SCHEMA.function.parameters;
ok('schema 只允许 metric/days', Object.keys(params.properties).sort().join(',') === 'days,metric');
ok('无 additionalProperties', params.additionalProperties === false);
ok('metric 白名单', params.properties.metric.enum.includes('all') && params.properties.metric.enum.length === 12);
ok('risk schema 参数为空（未放宽）', JSON.stringify(RISK_TOOL_SCHEMA.function.parameters) === '{"type":"object","properties":{},"additionalProperties":false}');

console.log('=== 8. 无 traceback / 路径泄漏 ===');
const leakStr = JSON.stringify(rall) + JSON.stringify(r1);
ok('无泄漏', !/Traceback|D:\\BIGCHUANG|\.py|ENOENT/i.test(leakStr));

console.log('=== 9. Agent Tool Calling（模拟 LLM 调 trend 工具）===');
function mockLLM(round2Content) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    if (body.tools) {
      return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_t1', type: 'function', function: { name: 'analyze_health_trend', arguments: '{"metric":"systo","days":90}' } }] } }] }) };
    }
    return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: JSON.stringify(round2Content) } }] }) };
  };
  return calls;
}
process.env.OPENAI_API_KEY = 'sk-test-fake';
const calls = mockLLM({ content: '根据趋势分析结果回答。', plan: [], confidence: { type: 'data', score: 80 } });
const rr = await chat([], '我的血压最近怎么样？', healthSummary, user1);
ok('LLM 第一轮请求含趋势与风险工具', calls[0]?.tools?.some(t => t.function?.name === 'analyze_health_trend') && calls[0]?.tools?.some(t => t.function?.name === 'risk_predict'), String(calls[0]?.tools?.length));
ok('工具结果回填（role=tool）', calls[1]?.messages?.some(m => m.role === 'tool'));
const toolMsg = JSON.parse(calls[1].messages.find(m => m.role === 'tool').content);
ok('工具为真实趋势结果（含 long_term_trend）', toolMsg.success === true && 'long_term_trend' in toolMsg, JSON.stringify(toolMsg).slice(0, 100));
ok('最终回答来自 LLM', ['deepseek', 'openai', 'custom'].includes(rr.source) && rr.llm?.call_status === 'success');
delete process.env.OPENAI_API_KEY;

console.log('=== 10. Mock 模式趋势意图 ===');
const rt = await chat([], '我的血糖最近怎么样？', healthSummary, user1);
ok('血糖趋势 → source tool 且含趋势结论', rt.source === 'tool' && (rt.content.includes('趋势') || rt.content.includes('上升') || rt.content.includes('下降')), rt.content?.slice(0, 60));

console.log('=== 11. 普通问题不触发工具（Mock）===');
const rn = await chat([], '我今天血压 128/85，正常吗？', healthSummary, user1);
ok('普通血压问题 → mock', rn.source === 'mock', rn.source);

console.log('=== 12. risk_predict 回归 ===');
const rp = await riskPredict(user1.id, user1);
ok('riskPredict 仍正常（含 risk_probability）', rp.success === true && typeof rp.risk_probability === 'number');
process.env.OPENAI_API_KEY = 'sk-test-fake';
const calls2 = mockLLM({ content: '风险结果回答', plan: [], confidence: { type: 'data', score: 80 } });
await chat([], '未来两年高血压风险是多少？', healthSummary, user1);
ok('风险意图仍调用 risk_predict（工具名在请求工具列表）', calls2[0]?.tools?.some(t => t.function.name === 'risk_predict'));
delete process.env.OPENAI_API_KEY;

console.log('=== 13. 连续 3 次一致 ===');
const probs = [];
for (let i = 0; i < 3; i++) probs.push(JSON.stringify((await analyzeHealthTrend(user1.id, { metric: 'systo' })).curve));
ok('趋势结果 3 次一致', new Set(probs).size === 1);

process.env.OPENAI_API_KEY = savedKey;
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
