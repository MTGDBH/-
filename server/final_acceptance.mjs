// Deterministic end-to-end acceptance test. Run with Node 22.
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const name = '\u5f20\u5976\u5976';

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text.slice(0, 200)}`);
  return { body, headers: res.headers };
}

const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: name, password: '123456' }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const auth = { Cookie: cookie };
const trend = (await request('/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ message: '\u6700\u8fd1\u8840\u538b\u600e\u4e48\u6837\uff1f' }) })).body;
if (!['openai', 'tool_fallback'].includes(trend.source) || trend.confidence?.type !== 'data') throw new Error('trend agent acceptance failed');
if (!trend.evidence?.items?.length || !trend.evidence.items[0].measured_at || trend.evidence.items[0].data_points < 1) throw new Error('backend evidence card acceptance failed');
const risk = (await request('/api/prediction/disease/diabetes', { headers: auth })).body;
if (!risk.success || risk.risk_probability < 0 || risk.risk_probability > 1) throw new Error('disease risk acceptance failed');
const curve = (await request('/api/prediction/bp?days=90&future=30', { headers: auth })).body;
if (!curve.actual?.length || !curve.fitted?.length || !curve.predicted?.length || !curve.predicted[0].recorded_at || curve.predicted[0].lower > curve.predicted[0].upper) throw new Error('curve acceptance failed');
const behaviorCurve = (await request('/api/prediction/steps?days=90&future=30', { headers: auth })).body;
if (behaviorCurve.predicted?.length !== 0 || !behaviorCurve.analysis?.forecastReason) throw new Error('behavior forecast gate failed');
const graph = (await request(`/api/knowledge/graph/query?q=${encodeURIComponent('\u8840\u538b\u8fde\u7eed\u504f\u9ad8\u600e\u4e48\u529e')}&disease=hypertension`, { headers: auth })).body;
if (!graph.results?.length || !graph.results[0].citation) throw new Error('GraphRAG acceptance failed');
const behavior = (await request('/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ message: '\u6211\u6700\u8fd1\u8d70\u5f97\u5c11\u5417\uff1f' }) })).body;
if (!behavior.content || behavior.confidence?.type !== 'data') throw new Error('behavior acceptance failed');
const history = (await request('/api/chat/history', { headers: auth })).body;
if (!Array.isArray(history) || history.length < 2) throw new Error('history acceptance failed');
console.log('FINAL ACCEPTANCE PASS: login, DeepSeek trend, disease risk, GraphRAG, behavior, history');
