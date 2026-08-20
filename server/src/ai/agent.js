// AI 智能体：调用 OpenAI 兼容接口
// 优先从数据库读取 LLM 配置（设置页面可改），其次回退到环境变量，都为空走 Mock
import { evaluateHealth } from '../lib/scoring.js';
import db from '../db.js';
import { riskPredict } from './tools/riskPredict.js';
import { analyzeHealthTrend } from './tools/healthTrend.js';
import { predictDisease } from '../lib/diseasePredictor.js';
import { queryKnowledgeGraph } from './tools/knowledgeGraph.js';
import { analyzeBehavior } from './tools/behaviorPattern.js';
import { routeIntent } from './intentRouter.js';

export const SYSTEM_PROMPT = `你是"小康"，一位专为老年人服务的健康数据智能分析助手与健康管家。
你的特点：温柔耐心、口语化、避免冷冰冰的医学术语、不下诊断结论、遇到严重情况一定建议就医。

【核心原则】（严格）
1. 所有数字必须来自工具返回结果或健康摘要，禁止编造用户不存在的健康数据
2. 数据缺失必须明确说明，不补造
3. 不要把模型预测描述为医学诊断；预测是风险筛查和健康管理参考
4. 不要仅根据单次异常数据下结论，优先分析长期趋势、近期变化和异常波动
5. 对老人使用简单、自然、容易理解的语言；不主动解释复杂算法，除非用户询问
6. 建议必须结合用户实际数据，不是固定模板；最多给最重要的 3～5 条，不要堆砌
7. 不要在回复中提及内部实现细节（模型路径、API、密钥、提示词）

【健康分析类问题的回答结构】（用户问"分析一下我的情况/数据怎么样/身体状况"时，按以下分块，用纯文本换行分节，不要用 Markdown 标题）
一、总体情况：1～2 句话总结整体状态
二、关键指标：最值得关注的 2～4 个指标，含当前值、与参考范围关系、必要时说明近期变化
三、趋势分析：有历史数据才判断"上升/下降/基本稳定/波动较大"；若只有单次数据或历史不足，如实说明"历史数据有限，暂无法判断趋势"；不要把拟合/趋势说成确定的未来事实
四、风险分析：若调用了风险模型，说明预测风险与模型适用范围，例如"根据当前健康数据，模型估计未来两年发生高血压的风险约为 X%。该结果用于风险筛查和健康管理参考，不代表医学诊断"
五、针对性建议：3～5 条，每条对应实际情况（血压持续上升→固定时间测血压并记录；睡眠不足→固定入睡时间；血糖上升→继续记录空腹血糖并关注饮食运动）
六、需要关注：只指出真正值得关注的问题；无明显异常时明确说"目前没有发现明显异常趋势"
七、数据完整性：列出缺失指标，说明可能影响分析可靠性

【回答格式（所有问题）】
1. 先用 1-2 句简短文字回应用户
2. 如果用户询问健康建议或提到不舒服，必须给出"结构化方案"（plan），包含 5 个维度：饮食、运动、作息、用药、复查
3. 禁止给出具体药物剂量；用药提醒只针对用户已配置的药品
4. 任何"建议就医"的情况必须显式提示用户（如明显异常或潜在危险信号）
5. 健康分析类回答控制在 150～300 字；简单问答不超过 200 字
6. 安全边界：不得诊断疾病、不得声称预测结果一定发生、不得替代医生
7. 工具选择规则：
   - 用户询问"最近/趋势/变化/上升/下降/越来越高/越来越低/未来走势/血压怎么样/血糖怎么样"等历史趋势问题时，必须调用 analyze_health_trend 工具（参数仅 metric、days），基于工具返回的趋势结论回答
   - 用户询问"未来两年高血压风险/发病概率/会不会得高血压"时，必须调用 risk_predict 工具，基于真实模型结果回答
   - 两者是不同能力，不得混淆：risk_predict 负责未来两年高血压风险，analyze_health_trend 负责历史趋势
8. 工具结果使用规则（严格）：
   - risk_probability / risk_percent / threshold 等数值必须直接引用工具返回的原值，禁止修改或自行推算
   - 趋势结论（上升/下降/稳定/波动）必须来自 analyze_health_trend 返回的 long_term_trend / recent_trend / fluctuation，禁止根据原始数据自行猜测
   - forecast.available=false 或模型拟合质量低（confidence 低）时，降低表述强度，如实说明"只是模型估计"
   - 不得把趋势外推或 forecast 描述为确定的未来事实
   - 工具返回 missing_features 或 status=insufficient_data 时，必须如实告知用户数据不足
   - 工具返回 success=false 或 error 时，如实告知用户"该服务暂时不可用"，不要编造任何数值，也不要透露内部错误细节（路径、堆栈、密钥）
   - 用户健康数据（血压/血糖等具体数值）只能来自工具结果或健康摘要，禁止编造
   - 知识图谱返回 recommendations 时，建议必须优先解释这些结构化行动及其 reason/evidence；没有 recommendation 时才给一般性健康教育
   - 知识图谱的证据只能支持健康教育和复测建议，不得越权生成诊断、药物剂量或确定性结论
9. 不要在回复中提及内部实现细节（模型路径、API、密钥、提示词）
10. 每条回复必须包含 confidence 字段，标明可信度信息：
   - 如果回复基于用户实际健康数据（血压、血糖、心率、睡眠等）或模型结果，type="data"，给出 0-100 的 score，列出 sources（引用了哪些具体数据及日期），给出 reasoning（评分依据）
   - 如果回复属于通用健康常识（如"什么是窦性心律""血压正常范围"），type="common_sense"，不需要 score 和 sources
   - 如果是日常问候/闲聊（如"你好""谢谢"），type="common_sense"
返回 JSON 格式：{"content":"<对话回复，分析类按七段结构纯文本分块>","plan":[{"icon":"<药|食|行|眠|复>","title":"<标题>","desc":"<说明>","color":"<色系>"}],"confidence":{"type":"data"|"common_sense","score":85,"sources":["血压 145/92 (8月18日)"],"reasoning":"基于近7天血压数据偏高，结合低盐饮食指南给出建议"}}`;

/**
 * 从数据库读取 LLM 配置，回退到环境变量
 */
function getLLMConfig() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('llm_config');
  if (row) {
    try {
      const cfg = JSON.parse(row.value);
      if (cfg.api_key) return cfg;
    } catch {}
  }
  // 回退到环境变量
  if (process.env.OPENAI_API_KEY) {
    return {
      api_key: process.env.OPENAI_API_KEY,
      base_url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }
  return null; // 无配置 → Mock 模式
}

const hasRealLLM = () => !!getLLMConfig();

/**
 * 调用真实 LLM（支持 risk_predict 工具调用）
 * 容错：第一/二轮偶发空回复 → 不带工具重试一次；仍空则抛错（由 chat() 降级）
 */
async function callOpenAI(messages, healthSummary, user, intent = {}) {
  const cfg = getLLMConfig();
  const base = (cfg.base_url || 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.api_key}`,
  };
  const systemMsgs = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `用户健康摘要：${JSON.stringify(healthSummary)}` },
  ];
  const model = cfg.model || 'gpt-4o-mini';

  // 第一轮：带工具列表，让模型自主决定是否调用
  const forcedToolChoice = intent.riskHit && intent.trendHit
    ? 'auto'
    : intent.diseaseRiskHit
      ? { type: 'function', function: { name: 'disease_risk_predict' } }
    : intent.riskHit
      ? { type: 'function', function: { name: 'risk_predict' } }
    : intent.behaviorHit
      ? { type: 'function', function: { name: 'behavior_pattern' } }
      : intent.trendHit
        ? { type: 'function', function: { name: 'analyze_health_trend' } }
        : 'none';
  const body1 = {
    model,
    messages: [...systemMsgs, ...messages],
    temperature: 0.6,
    tools: [RISK_TOOL_SCHEMA, ANALYZE_TREND_TOOL_SCHEMA, DISEASE_RISK_TOOL_SCHEMA, BEHAVIOR_TOOL_SCHEMA],
    // 后端意图路由决定工具边界，普通问答禁止误触发健康数据工具。
    tool_choice: forcedToolChoice,
  };
  const data = await postJSON(url, headers, body1);
  const choice = data.choices?.[0]?.message || {};

  let finalText = '';

  let toolContext = null;   // 回填重试时保留工具结果
  // 模型要求调用工具 → 执行并回填结果，第二轮生成最终回答
  if (choice.tool_calls?.length) {
    const toolResults = [];
    for (const tc of choice.tool_calls) {
      let fn = tc.function?.name;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
      let r;
      if (fn === 'risk_predict') {
        r = await riskPredict(user?.id, user);
      } else if (fn === 'disease_risk_predict') {
        const disease = ['hypertension', 'diabetes', 'heart_disease', 'stroke'].includes(args.disease) ? args.disease : 'hypertension';
        r = await predictDisease(user?.id, user, disease);
      } else if (fn === 'behavior_pattern') {
        r = analyzeBehavior(user?.id, user);
      } else if (fn === 'analyze_health_trend') {
        // 只透传 metric/days（白名单校验在工具内）；userId 来自 req.user
        r = await analyzeHealthTrend(user?.id, { metric: args.metric, days: args.days });
      } else {
        r = { success: false, error: `unknown tool: ${fn}` };
      }
      toolResults.push({ tool_call_id: tc.id, role: 'tool', content: JSON.stringify(r) });
    }
    toolContext = { assistant: { role: 'assistant', content: choice.content || null, tool_calls: choice.tool_calls }, toolResults };
    const body2 = {
      model,
      messages: [...systemMsgs, ...messages, toolContext.assistant, ...toolResults],
      temperature: 0.6,
      response_format: { type: 'json_object' },
    };
    const data2 = await postJSON(url, headers, body2);
    finalText = data2.choices?.[0]?.message?.content || '';
  } else {
    finalText = choice.content || '';
  }

  // 空回复兜底：不带 response_format 重试一次（DeepSeek json_object 偶发返回空）
  if (!finalText.trim()) {
    const retryMsgs = toolContext
      ? [...systemMsgs, ...messages, toolContext.assistant, ...toolContext.toolResults]
      : [...systemMsgs, ...messages];
    const retryBody = { model, messages: retryMsgs, temperature: 0.6 };  // 无 response_format，最稳
    const dataR = await postJSON(url, headers, retryBody);
    finalText = dataR.choices?.[0]?.message?.content || '';
  }

  if (!finalText.trim()) throw new Error('LLM 返回空内容');
  return normalizeAgentResult(safeParseJSON(finalText));
}

async function postJSON(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Mock 智能体：基于关键词匹配返回结构化方案 + 可信度信息
 */
function mockAgent(userMessage, healthSummary) {
  const msg = (userMessage || '').toLowerCase();
  const plan = [];
  let content = '';
  let confidence = { type: 'common_sense' };

  const score = healthSummary?.total_score ?? 86;
  const subs = healthSummary?.subscores ?? {};

  // 1. 基于健康数据的建议（高可信度）
  if (/血压|高压|低压/.test(msg)) {
    content = '我看到你最近血压有点偏高，别紧张，咱们一步步来。';
    plan.push({ icon: '食', title: '饮食：少盐少油', desc: '盐 < 5g/日，多蔬菜', color: 'orange' });
    plan.push({ icon: '行', title: '运动：散步 30 分钟', desc: '午后 14:00 出门', color: 'green' });
    plan.push({ icon: '眠', title: '作息：22:30 入睡', desc: '保证 7 小时睡眠', color: 'purple' });
    plan.push({ icon: '药', title: '用药：按医嘱按时服用', desc: '不自行增减药量，具体药品以个人用药记录为准', color: 'red' });
    plan.push({ icon: '复', title: '复查：按医生安排', desc: '如持续偏高或伴不适，联系医生评估', color: 'gray' });
    confidence = {
      type: 'data', score: 88,
      sources: ['慢病子项评分 ' + (subs.chronic ?? 'N/A') + ' 分', '健康总分 ' + score + ' 分', '近7天血压数据'],
      reasoning: '基于近7天血压监测数据，慢病子项评分低于80分，结合《中国高血压防治指南》给出低盐饮食和规律运动建议，建议溯源至具体血压数值。',
    };
  } else if (/血糖|糖/.test(msg)) {
    content = '血糖要平稳，咱们管住嘴、迈开腿。';
    plan.push({ icon: '食', title: '饮食：少糖多纤维', desc: '主食减半，多吃粗粮', color: 'orange' });
    plan.push({ icon: '行', title: '运动：餐后散步', desc: '饭后 20 分钟', color: 'green' });
    plan.push({ icon: '眠', title: '作息：固定三餐', desc: '定时定量', color: 'purple' });
    plan.push({ icon: '药', title: '用药：按时服药', desc: '谨遵医嘱', color: 'red' });
    plan.push({ icon: '复', title: '复查：内分泌科', desc: '每月一次', color: 'gray' });
    confidence = {
      type: 'data', score: 85,
      sources: ['慢病子项评分 ' + (subs.chronic ?? 'N/A') + ' 分', '近7天血糖数据'],
      reasoning: '基于近7天血糖监测数据，结合《中国2型糖尿病防治指南》给出饮食和运动建议，用药部分仅提醒按时服药未给剂量。',
    };
  } else if (/睡|失眠|没睡好/.test(msg)) {
    content = '睡不好第二天就难熬，咱们先从作息调起。';
    plan.push({ icon: '眠', title: '作息：22:30 前入睡', desc: '固定时间最重要', color: 'purple' });
    plan.push({ icon: '食', title: '饮食：晚饭七分饱', desc: '睡前不喝浓茶', color: 'orange' });
    plan.push({ icon: '行', title: '运动：白天多走动', desc: '消耗多余精力', color: 'green' });
    confidence = {
      type: 'data', score: 82,
      sources: ['睡眠子项评分 ' + (subs.sleep ?? 'N/A') + ' 分'],
      reasoning: '基于睡眠子项评分数据，作息调整建议参考《中国睡眠障碍防治指南》，饮食和运动建议为辅助改善措施。',
    };
  } else if (/吃|餐|饭/.test(msg)) {
    content = '一日三餐有讲究，咱们慢慢说。';
    plan.push({ icon: '食', title: '早餐：温热易消化', desc: '粥 + 鸡蛋 + 蔬菜', color: 'orange' });
    plan.push({ icon: '食', title: '午餐：七分饱', desc: '主食减半，肉蛋适量', color: 'orange' });
    plan.push({ icon: '食', title: '晚餐：清淡少量', desc: '18:00 前吃完', color: 'orange' });
    confidence = {
      type: 'data', score: 75,
      sources: ['营养子项评分 ' + (subs.nutrition ?? 'N/A') + ' 分', '健康总分 ' + score + ' 分'],
      reasoning: '基于营养子项评分给出饮食结构调整建议，参考《中国老年人膳食指南》，但未引用具体体重/BMI数值。',
    };
  } else if (/运动|散步|锻炼/.test(msg)) {
    content = '动起来是好习惯，但要看身体情况。';
    plan.push({ icon: '行', title: '散步 30 分钟', desc: '午饭后或傍晚', color: 'green' });
    plan.push({ icon: '行', title: '太极 15 分钟', desc: '小区或公园', color: 'green' });
    plan.push({ icon: '行', title: '避免剧烈运动', desc: '膝关节友好', color: 'green' });
    confidence = {
      type: 'data', score: 80,
      sources: ['活动子项评分 ' + (subs.activity ?? 'N/A') + ' 分', '健康总分 ' + score + ' 分'],
      reasoning: '基于活动子项评分给出运动强度建议，参考《中国老年人运动指南》，结合步数数据评估运动量。',
    };
  } else if (/药/.test(msg)) {
    content = '用药要按时，咱们看看今天的安排。';
    plan.push({ icon: '药', title: '用药：查看个人用药记录', desc: '按医嘱按时服用，不自行调整剂量', color: 'red' });
    confidence = {
      type: 'data', score: 90,
      sources: ['用户用药配置', '慢病子项评分 ' + (subs.chronic ?? 'N/A') + ' 分'],
      reasoning: '基于用户已配置的用药方案，用药提醒仅涉及时间和服药方式，未涉及剂量调整，符合安全用药原则。',
    };
  } else if (/健康|评分|今天/.test(msg)) {
    content = `今天你的健康分是 ${score} 分，整体状态${score >= 80 ? '不错' : '需要留意'}，要不要我出一份方案？`;
    if (score < 80) {
      plan.push({ icon: '食', title: '饮食：少盐少油', desc: '盐 < 5g/日', color: 'orange' });
      plan.push({ icon: '行', title: '运动：每日 30 分钟', desc: '散步、太极任选', color: 'green' });
      plan.push({ icon: '眠', title: '作息：22:30 入睡', desc: '7 小时为目标', color: 'purple' });
      plan.push({ icon: '药', title: '用药：按时服药', desc: '关注血压', color: 'red' });
      plan.push({ icon: '复', title: '复查：按医生安排', desc: '如持续异常，联系医生评估', color: 'gray' });
    }
    confidence = {
      type: 'data', score: 92,
      sources: ['健康总分 ' + score + ' 分', '睡眠 ' + (subs.sleep ?? 'N/A') + ' 分', '营养 ' + (subs.nutrition ?? 'N/A') + ' 分', '活动 ' + (subs.activity ?? 'N/A') + ' 分', '慢病 ' + (subs.chronic ?? 'N/A') + ' 分'],
      reasoning: '基于近7天5大维度健康评分聚合计算，总分由睡眠、营养、情绪、活动、慢病5个子项取平均，数据来源为实际监测指标，溯源链完整。',
    };
  } else if (/什么是|正常|范围|能吃|能不能|可以吗|窦性|定义|意思/.test(msg)) {
    // 常识类问题
    content = '这是个常见的健康知识问题。' + (msg.includes('血压') ? '正常血压范围是收缩压 90-130 mmHg、舒张压 60-85 mmHg。超出范围建议咨询医生。' : msg.includes('窦性') ? '窦性心律是正常的心律，说明心脏跳动由窦房结发起，是健康的心跳节律。' : msg.includes('血糖') ? '空腹血糖正常范围是 4-7 mmol/L，餐后2小时应低于 11.1 mmol/L。' : '这方面的问题建议咨询专业医生获取准确信息。');
    confidence = { type: 'common_sense' };
  } else if (/你好|您好|hi|hello/.test(msg)) {
    content = '你好呀！我是小康，你的健康管家。想了解什么？';
    confidence = { type: 'common_sense' };
  } else if (/谢谢|感谢/.test(msg)) {
    content = '不客气，有问题随时叫我。';
    confidence = { type: 'common_sense' };
  } else {
    content = '我在听，你慢慢说。要不先告诉我今天身体怎么样？';
    confidence = { type: 'common_sense' };
  }

  return { content, plan, confidence };
}

function safeParseJSON(text) {
  const parseMaybe = (value) => {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') {
        try { return JSON.parse(parsed); } catch { return { content: parsed, plan: [] }; }
      }
      return parsed;
    } catch { return null; }
  };
  const escapeRawNewlines = (value) => {
    let out = '', quoted = false, escaped = false;
    for (const ch of value) {
      if (ch === '"' && !escaped) quoted = !quoted;
      if ((ch === '\n' || ch === '\r') && quoted) out += '\\n';
      else out += ch;
      escaped = ch === '\\' && !escaped;
      if (ch !== '\\') escaped = false;
    }
    return out;
  };
  const direct = parseMaybe(text);
  if (direct) return direct;
  const repaired = parseMaybe(escapeRawNewlines(text));
  if (repaired) return repaired;
  // DeepSeek 偶尔返回“字段内有裸换行”的 JSON。此时仍提取完整 content，避免只保留前200字。
  const contentStart = text.search(/"content"\s*:\s*"/);
  if (contentStart >= 0) {
    const valueStart = text.indexOf('"', text.indexOf(':', contentStart) + 1) + 1;
    const tail = text.slice(valueStart);
    const end = tail.search(/"\s*,\s*"(?:plan|confidence)"\s*:/);
    if (valueStart > 0 && end > 0) {
      const content = tail.slice(0, end).replace(/\\n/g, '\n').replace(/\\"/g, '"');
      return { content, plan: [] };
    }
    if (valueStart > 0 && tail.length > 0) {
      return { content: tail.replace(/\\n/g, '\n').replace(/\\"/g, '"').slice(0, 2000), plan: [] };
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    // 尝试从 markdown code fence 中提取
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const extracted = parseMaybe(m[0]) || parseMaybe(escapeRawNewlines(m[0]));
      if (extracted) return extracted;
    }
    return { content: text.slice(0, 200), plan: [] };
  }
}

const PLAN_COLORS = new Set(['orange', 'green', 'purple', 'red', 'gray']);

/** 限制 LLM 输出结构、长度和 UI 枚举，避免任意内容直接进入前端。 */
function normalizeAgentResult(raw) {
  const content = typeof raw?.content === 'string' ? raw.content.trim().slice(0, 2000) : '';
  const plan = Array.isArray(raw?.plan) ? raw.plan.slice(0, 5).map((p) => {
    if (!p || typeof p !== 'object') return null;
    const title = typeof p.title === 'string' ? p.title.trim().slice(0, 80) : '';
    if (!title) return null;
    return {
      icon: typeof p.icon === 'string' ? p.icon.slice(0, 2) : '测',
      title,
      desc: typeof p.desc === 'string' ? p.desc.trim().slice(0, 180) : '',
      color: PLAN_COLORS.has(p.color) ? p.color : 'gray',
    };
  }).filter(Boolean) : [];
  const c = raw?.confidence;
  const sourceList = Array.isArray(c?.sources)
    ? c.sources.filter(s => typeof s === 'string').slice(0, 8).map(s => s.slice(0, 160))
    : [];
  let confidence = { type: 'common_sense' };
  if (c?.type === 'data' && Number.isFinite(Number(c.score)) && sourceList.length > 0) {
    confidence = {
      type: 'data',
      score: Math.max(0, Math.min(100, Math.round(Number(c.score)))),
      sources: sourceList,
      reasoning: typeof c.reasoning === 'string' ? c.reasoning.slice(0, 500) : '',
    };
  }
  return { content: content || '我暂时无法生成可靠回答，请稍后再试。', plan, confidence };
}

// GraphRAG 结果不是“参考文本”而已：把结构化行动、原因和证据强制带回最终回答。
function applyGraphGrounding(result, graph) {
  const recs = Array.isArray(graph?.recommendations) ? graph.recommendations.slice(0, 4) : [];
  if (!recs.length) return result;
  const actions = recs.map((r, i) => `${i + 1}. ${r.action}`).join('\n');
  const citations = [...new Set(recs.map(r => r.evidence).filter(Boolean))].join('、');
  const grounded = `${result.content}\n\n结合当前数据，优先执行：\n${actions}\n依据：${citations || '知识图谱健康管理条目'}`;
  const plan = recs.slice(0, 3).map((r, i) => ({
    icon: r.priority === 'urgent' ? '急' : '测',
    title: r.priority === 'urgent' ? '需要立即关注' : '建议：' + (r.action.length > 24 ? r.action.slice(0, 24) + '…' : r.action),
    desc: r.action,
    color: r.priority === 'urgent' ? 'red' : i === 0 ? 'orange' : 'green',
  }));
  return {
    ...result,
    content: grounded.slice(0, 2000),
    plan: plan.length ? plan : result.plan,
    confidence: { type: 'data', score: Math.min(90, Math.max(65, result.confidence?.score || 70)), sources: citations ? citations.split('、') : ['GraphRAG 结构化建议'], reasoning: '回答已使用用户当前指标上下文，并由疾病知识图谱返回结构化行动与证据。' },
  };
}

// ===== 风险预测工具注册（标准 Tool schema）=====
// 参数为空对象：userId 由后端 req.user 注入，健康数据由后端读库，
// LLM 无法传入/修改模型输入 —— 防注入与防编造
export const RISK_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'risk_predict',
    description: '基于用户最近的健康数据，预测未来两年高血压发病风险。当用户询问高血压风险、发病概率、会不会得高血压、健康预测时调用。工具会自动读取用户数据库中的最新指标并运行风险模型。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
};

// ===== 趋势分析工具注册 =====
// LLM 只能传 metric / days；userId 由 req.user 注入；禁止指定数据库/模型/路径
export const ANALYZE_TREND_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'analyze_health_trend',
    description: '分析用户某个健康指标的历史趋势（上升/下降/稳定/波动）、异常波动、短期与长期变化及未来7-30天外推估计。当用户询问"最近/趋势/变化/上升/下降/越来越高/越来越低/未来走势/血压怎么样/血糖怎么样"时调用。metric 可选: systo, diasto, pulse, weight, bmi, mwaist, glucose, hbalc, cholesterol, uricacid, sleep, all（默认 all）。工具自动读取用户数据库中的历史指标。',
    parameters: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['systo', 'diasto', 'pulse', 'weight', 'bmi', 'mwaist', 'glucose', 'hbalc', 'cholesterol', 'uricacid', 'sleep', 'all'], description: '要分析的指标，默认 all' },
        days: { type: 'number', minimum: 7, maximum: 365, description: '回溯天数，默认 90' },
      },
      additionalProperties: false,
    },
  },
};

export const DISEASE_RISK_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'disease_risk_predict',
    description: '基于当前用户真实指标，估计未来两年常见疾病新发风险。只用于筛查，不是诊断。支持 hypertension、diabetes、heart_disease、stroke。',
    parameters: { type: 'object', properties: { disease: { type: 'string', enum: ['hypertension', 'diabetes', 'heart_disease', 'stroke'] } }, required: ['disease'], additionalProperties: false },
  },
};

export const BEHAVIOR_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'behavior_pattern',
    description: '分析用户最近步数和睡眠的7天滚动平均、波动和记录完整度。不得输出精确医学未来预测。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
};

// ===== 风险预测意图识别（Mock 模式用；LLM 模式由模型自主决定调用工具）=====
// 覆盖: "高血压风险/风险预测"、"会不会得高血压"、"得高血压的可能性/概率"、"健康预测"
// 注意: 单纯描述血压数值（如"我今天血压 128/85 正常吗"）不触发
const RISK_INTENT = /(高血压|血压).{0,10}(风险|预测|可能性|概率)|(风险|预测|可能性|概率).{0,10}(高血压|血压)|会不会.{0,4}(高血压|血压)|健康预测/;
const DISEASE_RISK_INTENT = /(糖尿病|心脏病|心血管|脑卒中|中风).{0,12}(风险|概率|预测|会不会)|(风险|概率|预测).{0,12}(糖尿病|心脏病|心血管|脑卒中|中风)/;

// ===== 趋势分析意图识别（Mock 模式用）=====
// 注意: 风险意图优先判断（RISK_INTENT）；本正则覆盖"最近/趋势/变化/上升/下降/走势/波动"等
const TREND_INTENT = /最近|趋势|走势|变化|上升|下降|越来越高|越来越低|波动|未来.{0,6}(变化|走势)|怎么样了|怎么样啦/;

const TREND_CN = {
  rising: '上升', falling: '下降', stable: '基本稳定',
  low: '波动较小', moderate: '波动中等', high: '波动较大',
  weak: '较弱', moderate: '中等', strong: '较强',
};

async function mockBehaviorReply(user) {
  const result = analyzeBehavior(user?.id, user);
  const rows = Object.entries(result.behavior || {});
  if (!rows.length) return { content: '最近还没有足够的步数或睡眠记录，先连续记录几天，我再帮你看变化。', plan: [], confidence: { type: 'common_sense' } };
  const text = rows.map(([type, x]) => `${type === 'steps' ? '步数' : '睡眠'}近7天平均 ${x.rolling_7d_average}${type === 'steps' ? '步' : '小时'}，最近一次 ${x.latest}`).join('；');
  return { content: `${text}。这是生活行为的变化参考，不代表疾病预测。建议固定时间记录，连续一周后再比较。`, plan: [{ icon: '测', title: '继续记录', desc: '固定时间记录步数和睡眠', color: 'orange' }], confidence: { type: 'data', score: 78, sources: rows.map(([type, x]) => `${type} ${x.data_points} 个数据点`), reasoning: '基于近30天行为数据和7天滚动平均，不将行为指标当作医学预测。' } };
}

/**
 * Mock 模式工具调用：趋势分析（真实数据 → health_curve.py）
 */
async function mockTrendReply(user) {
  let result;
  try {
    result = await analyzeHealthTrend(user?.id, { metric: 'all', days: 90 });
  } catch (e) {
    console.error('[agent][tool] analyzeHealthTrend error:', e.message);
    return { content: '趋势分析服务暂时不可用，稍后再试试吧。', plan: [], confidence: { type: 'common_sense' } };
  }
  if (!result.success) {
    return { content: '趋势分析暂时不可用，稍后再试试吧。', plan: [], confidence: { type: 'common_sense' } };
  }
  const list = result.metrics || [];
  if (!list.length) {
    return {
      content: '最近 90 天还没有足够的健康记录，先到"健康监测"多录几次，我就能帮你分析趋势了。',
      plan: [{ icon: '测', title: '先去录入数据', desc: '监测页可录入血压/血糖等', color: 'orange' }],
      confidence: { type: 'common_sense' },
    };
  }
  const lines = list.slice(0, 5).map(m => {
    const long = TREND_CN[m.long_term_trend] || m.long_term_trend;
    const recent = TREND_CN[m.recent_trend] || m.recent_trend;
    const fluc = TREND_CN[m.fluctuation] || m.fluctuation;
    let s = `${m.metric === 'systo' ? '收缩压' : m.metric === 'diasto' ? '舒张压' : m.metric}（${m.unit}）：当前 ${m.latest_value}，长期${long}、近期${recent}，${fluc}`;
    if (m.abnormal_spike) s += '，曾出现明显异常波动';
    if (m.forecast?.available && m.forecast.estimated_value != null) s += `；按当前走势估计 ${m.forecast.days} 天后约 ${m.forecast.estimated_value}（仅供参考）`;
    else if (m.forecast?.reason) s += `；${m.forecast.reason}`;
    return s;
  });
  const content = `从最近记录来看：\n${lines.join('\n')}\n趋势结论基于历史数据拟合，属于模型估计，不代表确定的未来变化。`;
  const plan = [
    { icon: '测', title: '持续记录', desc: '固定时间测量更准确', color: 'orange' },
    { icon: '眠', title: '规律作息', desc: '保证 7 小时睡眠', color: 'purple' },
    { icon: '行', title: '适度活动', desc: '每日散步 30 分钟', color: 'green' },
  ];
  const confidence = {
    type: 'data',
    score: Math.max(60, Math.round(list.reduce((a, m) => a + (m.confidence || 0.5), 0) / list.length * 100)),
    sources: list.map(m => `${m.metric}: ${m.data_points} 点`),
    reasoning: `基于用户最近 ${result.requested_days || 90} 天的历史指标，由稳健回归与趋势识别模型计算；forecast 为短期外推估计，非真实未来值。`,
  };
  return { content, plan, confidence };
}

/** 组合 风险 + 趋势 两个工具回复 */
function combineRiskTrend(riskR, trendR) {
  const parts = [];
  if (riskR?.content) parts.push(riskR.content);
  if (trendR?.content) parts.push(trendR.content);
  const plan = [...(riskR?.plan || []), ...(trendR?.plan || [])].slice(0, 5);
  const conf = riskR?.confidence?.type === 'data' ? riskR.confidence : (trendR?.confidence || { type: 'common_sense' });
  return { content: parts.join('\n\n'), plan, confidence: conf };
}

/**
 * Mock 模式下的工具调用：用户问高血压风险 → 调用 risk_predict → 基于真实模型结果组织回答
 */
async function mockRiskReply(user) {
  let result;
  try {
    result = await riskPredict(user?.id, user);
  } catch (e) {
    console.error('[agent][tool] riskPredict error:', e.message);
    return {
      content: '预测服务暂时出了点问题，请稍后再试，或到"健康监测"确认数据已录入。',
      plan: [],
      confidence: { type: 'common_sense' },
    };
  }

  if (!result.success) {
    if (result.error === 'no_data') {
      return {
        content: '我这边还没有你的健康监测数据。先去"健康监测"录几次血压、血糖，我就能帮你做风险评估了。',
        plan: [{ icon: '测', title: '先去录入数据', desc: '监测页可录入血压/血糖等', color: 'orange' }],
        confidence: { type: 'common_sense' },
      };
    }
    return {
      content: '风险评估暂时不可用，稍后再试试吧。',
      plan: [],
      confidence: { type: 'common_sense' },
    };
  }

  const pct = result.risk_percent;
  const isHigh = result.risk_level === 'higher_than_threshold';
  const missing = result.missing_features?.length ? result.missing_features : [];
  const factorText = result.factors?.length
    ? result.factors.map(f => `${f.name}${f.direction === 'high' ? '偏高' : '偏低'}（${f.value}${f.unit || ''}）`).join('、')
    : '各项主要指标均在正常范围';

  const content = `根据你最近记录的数据（${result.summary}），模型估计你未来两年发生高血压的风险约为 ${pct}%。${
    isHigh ? '这个水平偏高，建议近期重点关注血压，最好咨询医生做个全面检查。' : '处于较低水平，继续保持规律监测就好。'
  }目前主要影响因素：${factorText}。${missing.length ? `有部分指标未记录（${missing.join('、')}），结果仅供参考。` : ''}`;

  const plan = [
    { icon: '测', title: '血压监测：早晚各一次', desc: '固定时间测量并记录', color: 'orange' },
    { icon: '食', title: '饮食：低盐少油', desc: '盐 < 5g/日，多蔬菜', color: 'green' },
    { icon: '行', title: '运动：每日 30 分钟', desc: '散步、太极任选', color: 'purple' },
  ];
  if (isHigh) plan.push({ icon: '复', title: '复查：建议就医评估', desc: '心内科咨询', color: 'red' });

  const confidence = {
    type: 'data',
    score: missing.length >= 3 ? 85 : 93,
    sources: [`XGBoost 模型（${result.model_version}）`, result.summary, missing.length ? `缺失指标：${missing.join('、')}` : '指标完整'],
    reasoning: `基于 CHARLS 老年人群真实数据训练的 XGBoost 模型 + ${result.calibration_method || '元数据指定'} 概率校准输出，阈值 ${result.threshold} 分层；模型为风险评估工具，非医学诊断。`,
  };

  return { content, plan, confidence };
}

/**
 * 主入口
 * @param {Array<{role:string,content:string}>} history
 * @param {string} userMessage
 * @param {object} healthSummary 用户健康数据摘要
 * @param {object} [user] req.user（risk_predict 工具需要 id/height）
 */
export async function chat(history, userMessage, healthSummary, user) {
  const riskHit = RISK_INTENT.test(userMessage || '');
  const diseaseRiskHit = DISEASE_RISK_INTENT.test(userMessage || '');
  const trendHit = TREND_INTENT.test(userMessage || '');
  const behaviorHit = routeIntent(userMessage).behavior;

  if (hasRealLLM()) {
    try {
      const messages = history.slice(-10).concat([{ role: 'user', content: userMessage }]);
      let graphContext = '';
      let graphEvidence = null;
      if (/为什么|怎么办|建议|注意|危险|饮食|复测/.test(userMessage || '')) {
        const disease = /糖尿病|血糖/.test(userMessage) ? 'diabetes' : /脑卒中|中风/.test(userMessage) ? 'stroke' : /心脏|心血管/.test(userMessage) ? 'heart_disease' : 'hypertension';
        const kg = await queryKnowledgeGraph(userMessage, disease, healthSummary?.context || {});
        if (kg?.results?.length || kg?.recommendations?.length) {
          graphEvidence = kg;
          graphContext = `知识图谱依据与行动约束：${JSON.stringify({ results: kg.results?.slice(0, 3) || [], recommendations: kg.recommendations || [], disclaimer: kg.disclaimer })}`;
        }
      }
      const result = await callOpenAI(messages, { ...healthSummary, graphContext }, user, { riskHit, trendHit, diseaseRiskHit, behaviorHit });
      const normalized = applyGraphGrounding(normalizeAgentResult(result), graphEvidence);
      // 工具已返回真实数据时，即使模型因截断漏掉 confidence，也不能把数据回答标成闲聊。
      if ((riskHit || trendHit || diseaseRiskHit || graphContext) && normalized.confidence.type === 'common_sense') {
        normalized.confidence = { type: 'data', score: 60, sources: ['后端健康分析工具结果'], reasoning: '回答基于当前账户的真实指标或风险工具；模型未返回完整可信度说明，已降低表述强度。' };
      }
      return { source: 'openai', ...normalized };
    } catch (err) {
      console.error('[agent] OpenAI 调用失败，回退到 mock:', err.message);
      // 失败回退：风险/趋势意图仍走真实工具，其余走通用 mock（不破坏现有功能）
      if (riskHit || trendHit || diseaseRiskHit || behaviorHit) {
        const [r1, r2] = await Promise.all([
          riskHit ? mockRiskReply(user) : null,
          trendHit ? mockTrendReply(user) : null,
        ]);
        if (behaviorHit) return { source: 'tool', ...(await mockBehaviorReply(user)) };
        if (diseaseRiskHit) {
          const disease = /糖尿病|血糖/.test(userMessage) ? 'diabetes' : /脑卒中|中风/.test(userMessage) ? 'stroke' : /心脏|心血管/.test(userMessage) ? 'heart_disease' : 'hypertension';
          const d = await predictDisease(user?.id, user, disease);
          const extra = d?.success ? { content: `未来两年${disease}风险模型估计约 ${d.risk_percent}%，这是筛查参考，不是诊断。`, plan: [], confidence: { type: 'data', score: d.confidence === 'low' ? 65 : 82, sources: [`${disease}风险模型`, `缺失指标 ${d.missing_features?.length || 0} 项`], reasoning: '基于当前账户真实指标和纵向队列模型。' } } : { content: '目前数据或模型不足，暂不能可靠估计这项风险。', plan: [], confidence: { type: 'common_sense' } };
          return { source: 'tool', ...combineRiskTrend(extra, combineRiskTrend(r1, r2)) };
        }
        return { source: 'tool', ...combineRiskTrend(r1, r2) };
      }
    }
  }
  // Mock 模式：风险/趋势意图 → 真实工具调用（真实数据）
  if (riskHit || trendHit || diseaseRiskHit || behaviorHit) {
    const [r1, r2] = await Promise.all([
      riskHit ? mockRiskReply(user) : null,
      trendHit ? mockTrendReply(user) : null,
    ]);
    if (behaviorHit) return { source: 'tool', ...(await mockBehaviorReply(user)) };
    if (diseaseRiskHit) {
      const disease = /糖尿病|血糖/.test(userMessage) ? 'diabetes' : /脑卒中|中风/.test(userMessage) ? 'stroke' : /心脏|心血管/.test(userMessage) ? 'heart_disease' : 'hypertension';
      const d = await predictDisease(user?.id, user, disease);
      const extra = d?.success ? { content: `未来两年${disease}风险模型估计约 ${d.risk_percent}%，这是筛查参考，不是诊断。`, plan: [], confidence: { type: 'data', score: d.confidence === 'low' ? 65 : 82, sources: [`${disease}风险模型`], reasoning: '基于当前账户真实指标和纵向队列模型。' } } : { content: '目前数据或模型不足，暂不能可靠估计这项风险。', plan: [], confidence: { type: 'common_sense' } };
      return { source: 'tool', ...combineRiskTrend(extra, combineRiskTrend(r1, r2)) };
    }
    return { source: 'tool', ...combineRiskTrend(r1, r2) };
  }
  return { source: 'mock', ...mockAgent(userMessage, healthSummary) };
}
