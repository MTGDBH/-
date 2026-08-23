// GraphRAG 建议质量回归：危险/高值/睡眠数据应产生分层建议、关系链和可读证据排版。
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const name = `图谱建议回归${Date.now()}`;
async function request(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text}`);
  return { body, headers: res.headers };
}
const login = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, age: 78, gender: 'female', password: '123456' }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]; const auth = { Cookie: cookie };
try {
  await request('/api/health/metrics', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'bp', value: 152, value2: 94, unit: 'mmHg', source: 'manual' }) });
  await request('/api/health/metrics', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'glucose', value: 7.4, unit: 'mmol/L', source: 'manual' }) });
  await request('/api/health/metrics', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'sleep', value: 5.4, unit: 'h', source: 'manual' }) });
  const chat = (await request('/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ message: '血压偏高怎么办？' }) })).body;
  if (!chat.content || !chat.evidence) throw new Error('grounded response missing content/evidence');
  if (!['health_card','plain'].includes(chat.presentation?.mode)) throw new Error('response card is not structured');
  if (!chat.tool_trace?.some(item => item.name === 'knowledge')) throw new Error('knowledge evidence tool was not called');
  if (/who_[a-z_]+_\d+\.md/i.test(JSON.stringify(chat))) throw new Error('raw filename leaked into senior-facing response');
  if ((chat.plan || []).length > 2 || !(chat.plan || []).every(p => p.title && (p.desc || p.description))) throw new Error('plan cards violate elderly limit');
  if (!chat.evidence?.graph?.citations?.length) throw new Error('knowledge citations missing');
  console.log(JSON.stringify({ pass: true, source: chat.source, plan_count: chat.plan.length, presentation: chat.presentation.mode, knowledge_trace: true }));
} finally {
  const deleted = await request('/api/profile/me', { method: 'DELETE', headers: auth });
  if (!deleted.body?.ok) throw new Error('graph grounding test account cleanup failed');
}
