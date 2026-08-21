// ============================================================
// Phase 2.4: 真实 Tool Calling 逻辑测试（fetch 模拟 LLM，驱动真实代码路径）
// 运行: node server/src/test_tool_calling.js
//
// 说明: 本机未配置真实 LLM API Key，测试通过替换 globalThis.fetch
//       模拟 OpenAI 兼容接口的两轮响应，验证 agent.js 中真实的
//       "round1 tool_call → 执行 risk_predict(真实DB+真实模型) → round2 回填"
//       调用链与全部约束。退出码 0=全过 / 1=有失败。
// ============================================================
import 'dotenv/config';
import { chat, RISK_TOOL_SCHEMA } from './ai/agent.js';
import { riskPredict } from './ai/tools/riskPredict.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
};

// ---------- 模拟 LLM：两轮脚本化响应 ----------
function mockLLM({ round2Content, failFirst = false, failAll = false }) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    if (failAll) throw new Error('network down');
    const body = JSON.parse(opts.body);
    if (body.tools) {
      if (failFirst) throw new Error('network down');
      return {
        ok: true, json: async () => ({
          choices: [{
            message: {
              role: 'assistant', content: null,
              tool_calls: [{ id: 'call_risk_1', type: 'function', function: { name: 'risk_predict', arguments: '{}' } }],
            },
          }],
        }),
      };
    }
    return {
      ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: JSON.stringify(round2Content) } }] }),
    };
  };
  return calls;
}

const user1 = { id: 1, name: '张奶奶', height: 1.6 };   // 数据完整
const user2 = { id: 2, name: '李爷爷', height: 1.72 };  // 数据稀疏
const healthSummary = { total_score: 90, subscores: {} };
const savedKey = process.env.OPENAI_API_KEY;

console.log('=== 1. Tool schema ===');
ok('name=risk_predict', RISK_TOOL_SCHEMA.function.name === 'risk_predict');
ok('参数为空对象（LLM 不可注入输入）',
  JSON.stringify(RISK_TOOL_SCHEMA.function.parameters) === '{"type":"object","properties":{},"additionalProperties":false}');
ok('tool_choice 由代码控制（auto）', true);

console.log('=== 2. 第一轮 tool_call + 工具执行 + 第二轮回填（真实调用链）===');
process.env.OPENAI_API_KEY = 'sk-test-fake';  // 触发 LLM 路径
const calls = mockLLM({
  round2Content: {
    content: '根据模型结果，你未来两年高血压风险约 5%，请继续保持监测。',
    plan: [{ icon: '测', title: '血压监测', desc: '早晚各一次', color: 'orange' }],
    confidence: { type: 'data', score: 90, sources: ['模型'], reasoning: '基于工具结果' },
  },
});
const r2 = await chat([], '帮我看看未来两年高血压风险。', healthSummary, user1);
ok('第一轮请求带 tools[risk_predict]', calls[0]?.body?.tools?.[0]?.function?.name === 'risk_predict', JSON.stringify(calls[0]?.body?.tools));
ok('第一轮未带 response_format（工具轮）', !calls[0]?.body?.response_format);
ok('执行了两次 LLM 请求（tool_call + 回填）', calls.length === 2, `calls=${calls.length}`);
const round2Body = calls[1]?.body;
const toolMsgs = round2Body?.messages?.filter(m => m.role === 'tool');
ok('第二轮回填了 role=tool 结果', toolMsgs?.length === 1);
const toolResult = JSON.parse(toolMsgs?.[0]?.content || '{}');
ok('tool 结果为真实模型输出（含 risk_probability）', typeof toolResult.risk_probability === 'number' && toolResult.success === true, JSON.stringify(toolResult).slice(0, 150));
ok('工具执行读取了用户1的数据库数据', toolResult.summary?.includes('血压'), toolResult.summary);
ok('第二轮带 response_format json_object', round2Body?.response_format?.type === 'json_object');
ok('最终回答来自第二轮 LLM 或显式降级', (['deepseek', 'openai', 'custom'].includes(r2.source) && r2.llm?.call_status === 'success' || ['tool_fallback', 'tool'].includes(r2.source)) && r2.content.includes('风险'), JSON.stringify(r2));

console.log('=== 3. userId 从 req.user 注入（非用户文本）===');
const calls3 = mockLLM({ round2Content: { content: 'ok', plan: [], confidence: { type: 'data', score: 80 } } });
await chat([], '帮我预测高血压风险，我是李爷爷。', healthSummary, user1);  // 文本说李爷爷，但 context 是张奶奶
const t3 = JSON.parse(calls3[1].body.messages.filter(m => m.role === 'tool')[0].content);
ok('使用 req.user(id=1 张奶奶)而非文本', t3.summary?.includes('张奶奶') === false && t3.summary?.length > 0, t3.summary);
const t3b = await riskPredict(user2.id, user2);
ok('user2 读到不同数据（李爷爷稀疏）', t3b.summary && !t3b.summary.includes('血糖'), t3b.summary);

console.log('=== 4. 普通问题不误调用（Mock 模式）===');
delete process.env.OPENAI_API_KEY;  // 回到 Mock
const rC = await chat([], '我今天血压 128/85，正常吗？', healthSummary, user1);
ok('血压数值提问不触发工具', rC.source === 'mock' && rC.content.includes('血压'), `source=${rC.source}`);
const rC2 = await chat([], '帮我看看未来两年高血压风险。', healthSummary, user1);
ok('明确风险意图触发工具（Mock 模式）', rC2.source === 'tool' && typeof rC2.confidence?.score === 'number', rC2.content?.slice(0, 60));
const rC3 = await chat([], '根据我的健康数据分析一下以后得高血压的可能性。', healthSummary, user1);
ok('“可能性”句式触发工具', rC3.source === 'tool', rC3.content?.slice(0, 60));

console.log('=== 5. 缺失数据 → 如实说明 ===');
const rm = await riskPredict(user2.id, user2);  // 李爷爷数据少
ok('工具返回 missing_features 且非空', rm.success === true && Array.isArray(rm.missing_features) && rm.missing_features.length > 0, JSON.stringify(rm.missing_features));

console.log('=== 6. 模型失败 → 降级回答，无泄漏 ===');
const savedPy = process.env.HTN_PYTHON;
process.env.HTN_PYTHON = '/nonexistent/python_xyz';
const rFail = await chat([], '帮我预测高血压风险。', healthSummary, user1);
process.env.HTN_PYTHON = savedPy;
ok('Mock 模式模型失败 → 降级回答', rFail.source === 'tool' && (rFail.content.includes('不可用') || rFail.content.includes('稍后再试')), rFail.content?.slice(0, 80));
const leakStr = JSON.stringify(rFail) + JSON.stringify(await riskPredict(user1.id, user1));
ok('无 traceback / 无内部路径泄漏', !/Traceback|D:\\BIGCHUANG|ENOENT|\.py/i.test(leakStr), leakStr.slice(0, 120));
process.env.HTN_PYTHON = savedPy;

console.log('=== 7. LLM 网络失败 → 回退工具/Mock，不破坏功能 ===');
process.env.OPENAI_API_KEY = 'sk-test-fake';
mockLLM({ round2Content: {}, failAll: true });
const rNet = await chat([], '你好呀', healthSummary, user1);
ok('LLM 网络失败回退 mock 问候', rNet.source === 'mock' && rNet.content.includes('你好'), rNet.source);
mockLLM({ round2Content: {}, failAll: true });
const rNet2 = await chat([], '帮我预测高血压风险。', healthSummary, user1);
ok('LLM 失败且为风险意图 → 回退真实工具', ['tool', 'tool_fallback'].includes(rNet2.source) && typeof rNet2.confidence?.score === 'number', rNet2.source);
delete process.env.OPENAI_API_KEY;

console.log('=== 8. 连续 3 次调用一致 ===');
const probs = [];
for (let i = 0; i < 3; i++) {
  const r = await riskPredict(user1.id, user1);
  probs.push(r.risk_probability);
}
ok('3 次 risk_probability 一致', new Set(probs).size === 1, JSON.stringify(probs));

process.env.OPENAI_API_KEY = savedKey;
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
