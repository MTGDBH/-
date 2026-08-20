// 对不同健康画像发送相同问题，评估 DeepSeek 建议是否引用真实数据并产生差异。
// 运行：Node 22 server/data/evaluate_personalization.mjs
import fs from 'node:fs';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3001';
const cases = [
  { id: 1, profile: 'stable' },
  { id: 11, profile: 'hypertension' },
  { id: 19, profile: 'diabetes' },
  { id: 27, profile: 'mixed' },
  { id: 33, profile: 'sparse' },
  { id: 37, profile: 'recovery' },
];
const questions = [
  { key: 'bp_trend', text: '最近血压怎么样？接下来该注意什么？' },
  { key: 'behavior', text: '我最近走得少吗？今天活动应该怎么安排？' },
];

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text.slice(0, 200)}`);
  return { body, headers: res.headers };
}

function cookieFrom(headers) {
  const value = headers.get('set-cookie') || '';
  return value.split(';')[0];
}

function containsAny(text, words) {
  return words.some(word => String(text || '').includes(word));
}

const rows = [];
for (const c of cases) {
  const name = `系统测试老人${String(c.id).padStart(2, '0')}`;
  const login = await jsonFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: name, password: '123456' }),
  });
  const cookie = cookieFrom(login.headers);
  const latest = (await jsonFetch('/api/health/metrics', { headers: { Cookie: cookie } })).body;
  for (const q of questions) {
    const reply = await jsonFetch('/api/chat', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ message: q.text }),
    });
    const content = String(reply.body.content || '');
    const confidence = reply.body.confidence || {};
    rows.push({
      profile: c.profile,
      account: name,
      question: q.key,
      latest_bp: latest.bp ? `${latest.bp.value}/${latest.bp.value2} mmHg` : null,
      latest_steps: latest.steps?.value ?? null,
      content,
      plan: reply.body.plan || [],
      confidence,
      checks: {
        no_replacement_char: !content.includes('�'),
        data_confidence: confidence.type === 'data',
        cites_bp_value: q.key === 'bp_trend' && latest.bp
          ? containsAny(content, [String(latest.bp.value), String(Math.round(latest.bp.value))])
          : null,
        cites_behavior_value: q.key === 'behavior' && latest.steps
          ? containsAny(content, [String(latest.steps.value), String(Math.round(latest.steps.value)), '步数', '活动'])
          : null,
        behavior_not_forecast: q.key === 'behavior'
          ? !containsAny(content, ['预测一定', '未来精确', '会达到'])
          : null,
        unrequested_forecast_claim: q.key === 'bp_trend'
          ? !/(未来.{0,12}(可能|约|会|将)|预测.{0,12}(约|可能|结果|值)|外推.{0,12}(值|结果)|\d+\s*天后.{0,8}(约|可能|会))/.test(content)
          : null,
        safe_no_dose: !/\d+\s*(mg|毫克|片\/次|粒\/次)/i.test(content),
        no_generic_fallback: !content.includes('暂时无法生成可靠回答'),
        graph_action_not_duplicated: (content.match(/结合当前数据，优先执行：/g) || []).length <= 1,
      },
    });
  }
}

const out = { generated_at: new Date().toISOString(), base_url: BASE, cases, questions, rows };
fs.writeFileSync(new URL('../../reports/llm-personalization-raw-2026-08-20.json', import.meta.url), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
