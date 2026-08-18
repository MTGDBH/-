// AI 智能体：调用 OpenAI 兼容接口
// 优先从数据库读取 LLM 配置（设置页面可改），其次回退到环境变量，都为空走 Mock
import { evaluateHealth } from '../lib/scoring.js';
import db from '../db.js';

const SYSTEM_PROMPT = `你是"小康"，一位专为老年人服务的健康管家 AI。
你的特点是：温柔耐心、口语化、避免冷冰冰的医学术语、不会下诊断结论、遇到严重情况一定建议就医。
你的回答格式：
1. 先用 1-2 句简短文字回应用户
2. 如果用户询问健康建议或提到不舒服，必须给出"结构化方案"，包含 5 个维度：饮食、运动、作息、用药、复查
3. 禁止给出具体药物剂量；用药提醒只针对用户已配置的药品
4. 任何"建议就医"的情况必须显式提示用户
5. 回答总长度不超过 200 字
6. 你只能基于"用户健康摘要"中的数据回答，不要编造数据
返回 JSON 格式：{"content":"<对话回复>","plan":[{"icon":"<药|食|行|眠|复>","title":"<标题>","desc":"<说明>","color":"<色系>"}]}`;

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
 * 调用真实 LLM
 */
async function callOpenAI(messages, healthSummary) {
  const cfg = getLLMConfig();
  const base = (cfg.base_url || 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const body = {
    model: cfg.model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: `用户健康摘要：${JSON.stringify(healthSummary)}` },
      ...messages,
    ],
    temperature: 0.6,
    response_format: { type: 'json_object' },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.api_key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${text}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '{}';
  return safeParseJSON(text);
}

/**
 * Mock 智能体：基于关键词匹配返回结构化方案
 */
function mockAgent(userMessage, healthSummary) {
  const msg = (userMessage || '').toLowerCase();
  const plan = [];
  let content = '';

  // 1. 高频关键词
  if (/血压|高压|低压/.test(msg)) {
    content = '我看到你最近血压有点偏高，别紧张，咱们一步步来。';
    plan.push({ icon: '食', title: '饮食：少盐少油', desc: '盐 < 5g/日，多蔬菜', color: 'orange' });
    plan.push({ icon: '行', title: '运动：散步 30 分钟', desc: '午后 14:00 出门', color: 'green' });
    plan.push({ icon: '眠', title: '作息：22:30 入睡', desc: '保证 7 小时睡眠', color: 'purple' });
    plan.push({ icon: '药', title: '用药：18:00 降压药', desc: '饭后服用', color: 'red' });
    plan.push({ icon: '复', title: '复查：下周三 心内科', desc: '8月21日 9:00', color: 'gray' });
  } else if (/血糖|糖/.test(msg)) {
    content = '血糖要平稳，咱们管住嘴、迈开腿。';
    plan.push({ icon: '食', title: '饮食：少糖多纤维', desc: '主食减半，多吃粗粮', color: 'orange' });
    plan.push({ icon: '行', title: '运动：餐后散步', desc: '饭后 20 分钟', color: 'green' });
    plan.push({ icon: '眠', title: '作息：固定三餐', desc: '定时定量', color: 'purple' });
    plan.push({ icon: '药', title: '用药：按时服药', desc: '谨遵医嘱', color: 'red' });
    plan.push({ icon: '复', title: '复查：内分泌科', desc: '每月一次', color: 'gray' });
  } else if (/睡|失眠|没睡好/.test(msg)) {
    content = '睡不好第二天就难熬，咱们先从作息调起。';
    plan.push({ icon: '眠', title: '作息：22:30 前入睡', desc: '固定时间最重要', color: 'purple' });
    plan.push({ icon: '食', title: '饮食：晚饭七分饱', desc: '睡前不喝浓茶', color: 'orange' });
    plan.push({ icon: '行', title: '运动：白天多走动', desc: '消耗多余精力', color: 'green' });
  } else if (/吃|餐|饭/.test(msg)) {
    content = '一日三餐有讲究，咱们慢慢说。';
    plan.push({ icon: '食', title: '早餐：温热易消化', desc: '粥 + 鸡蛋 + 蔬菜', color: 'orange' });
    plan.push({ icon: '食', title: '午餐：七分饱', desc: '主食减半，肉蛋适量', color: 'orange' });
    plan.push({ icon: '食', title: '晚餐：清淡少量', desc: '18:00 前吃完', color: 'orange' });
  } else if (/运动|散步|锻炼/.test(msg)) {
    content = '动起来是好习惯，但要看身体情况。';
    plan.push({ icon: '行', title: '散步 30 分钟', desc: '午饭后或傍晚', color: 'green' });
    plan.push({ icon: '行', title: '太极 15 分钟', desc: '小区或公园', color: 'green' });
    plan.push({ icon: '行', title: '避免剧烈运动', desc: '膝关节友好', color: 'green' });
  } else if (/药/.test(msg)) {
    content = '用药要按时，咱们看看今天的安排。';
    plan.push({ icon: '药', title: '08:00 降压药', desc: '已服用 ✓', color: 'red' });
    plan.push({ icon: '药', title: '18:00 降压药', desc: '饭后服用', color: 'red' });
    plan.push({ icon: '药', title: '21:00 钙片', desc: '随晚餐服用', color: 'red' });
  } else if (/健康|评分|今天/.test(msg)) {
    const score = healthSummary?.total_score ?? 86;
    content = `今天你的健康分是 ${score} 分，整体状态${score >= 80 ? '不错' : '需要留意'}，要不要我出一份方案？`;
    if (score < 80) {
      plan.push({ icon: '食', title: '饮食：少盐少油', desc: '盐 < 5g/日', color: 'orange' });
      plan.push({ icon: '行', title: '运动：每日 30 分钟', desc: '散步、太极任选', color: 'green' });
      plan.push({ icon: '眠', title: '作息：22:30 入睡', desc: '7 小时为目标', color: 'purple' });
      plan.push({ icon: '药', title: '用药：按时服药', desc: '关注血压', color: 'red' });
      plan.push({ icon: '复', title: '复查：下周复诊', desc: '心内科 9:00', color: 'gray' });
    }
  } else if (/你好|您好|hi|hello/.test(msg)) {
    content = '你好呀！我是小康，你的健康管家。想了解什么？';
  } else if (/谢谢|感谢/.test(msg)) {
    content = '不客气，有问题随时叫我。';
  } else {
    content = '我在听，你慢慢说。要不先告诉我今天身体怎么样？';
  }

  return { content, plan };
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    // 尝试从 markdown code fence 中提取
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return { content: text.slice(0, 200), plan: [] };
  }
}

/**
 * 主入口
 * @param {Array<{role:string,content:string}>} history
 * @param {string} userMessage
 * @param {object} healthSummary 用户健康数据摘要
 */
export async function chat(history, userMessage, healthSummary) {
  if (hasRealLLM()) {
    try {
      const messages = history.slice(-10).concat([{ role: 'user', content: userMessage }]);
      const result = await callOpenAI(messages, healthSummary);
      return { source: 'openai', ...result };
    } catch (err) {
      console.error('[agent] OpenAI 调用失败，回退到 mock:', err.message);
      // 失败回退
    }
  }
  return { source: 'mock', ...mockAgent(userMessage, healthSummary) };
}
