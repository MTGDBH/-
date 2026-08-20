// 总体健康摘要闭环：录入真实指标 → 智能体调用 health_summary → 返回真实证据。
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const name = `健康摘要回归${Date.now()}`;
async function request(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text(); let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text}`);
  return { body, headers: res.headers };
}

const login = await request('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ name, age: 76, gender: 'female', password: '123456' }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const auth = { Cookie: cookie };
try {
  const now = Date.now();
  const points = [
    { type: 'bp', value: 128, value2: 78, unit: 'mmHg', recorded_at: new Date(now - 2 * 86400000).toISOString() },
    { type: 'glucose', value: 5.6, unit: 'mmol/L', recorded_at: new Date(now - 86400000).toISOString() },
    { type: 'sleep', value: 7.2, unit: 'h', recorded_at: new Date(now - 3600000).toISOString() },
  ];
  for (const point of points) await request('/api/health/metrics', { method: 'POST', headers: auth, body: JSON.stringify({ ...point, source: 'manual' }) });
  const chat = (await request('/api/chat', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ message: '最近身体怎么样？' }),
  })).body;
  if (!chat.content || !['deepseek', 'openai', 'custom', 'tool', 'tool_fallback', 'mock'].includes(chat.source)) throw new Error('health summary agent response unavailable');
  if (!chat.evidence || !Array.isArray(chat.evidence.items)) throw new Error('evidence card missing');
  const mentionsMetric = /血压|血糖|睡眠/.test(chat.content);
  if (!mentionsMetric) throw new Error(`summary did not mention recorded metrics: ${chat.content}`);
  const history = (await request('/api/chat/history', { headers: auth })).body;
  const persisted = history.find(row => row.role === 'assistant' && row.evidence?.items?.length);
  if (!persisted) throw new Error('evidence was not persisted in chat history');
  console.log(JSON.stringify({ pass: true, source: chat.source, evidence_items: chat.evidence.items.length, history_evidence: persisted.evidence.items.length, mentions_metric: mentionsMetric }));
} finally {
  const deleted = await request('/api/profile/me', { method: 'DELETE', headers: auth });
  if (!deleted.body?.ok) throw new Error('health summary test account cleanup failed');
}
