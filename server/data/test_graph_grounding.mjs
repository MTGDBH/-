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
  if (!/先说结论|结合当前数据|依据|疾病关系与影响因素|未来7天行动安排/.test(chat.content)) throw new Error('response layout is not structured');
  if (!/WHO|AHA|ADA|PREDIMED|DPP|SPRINT/.test(chat.content)) throw new Error('authoritative citation not rendered');
  if (/who_[a-z_]+_\d+\.md/.test(chat.content)) throw new Error('raw filename leaked into senior-facing response');
  if (!chat.plan?.length || !chat.plan.every(p => p.title && p.desc)) throw new Error('plan cards are incomplete');
  if (!chat.evidence?.graph?.weekly_plan?.length) throw new Error('weekly personalized plan missing');
  console.log(JSON.stringify({ pass: true, source: chat.source, plan_count: chat.plan.length, has_relation_section: /疾病关系与影响因素/.test(chat.content), citation_readable: /WHO|AHA|ADA/.test(chat.content) }));
} finally {
  const deleted = await request('/api/profile/me', { method: 'DELETE', headers: auth });
  if (!deleted.body?.ok) throw new Error('graph grounding test account cleanup failed');
}
