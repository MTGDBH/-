// 数据质量、复测闭环和医生知识审核接口回归。
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
async function request(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text}`);
  return { body, headers: res.headers };
}
const name = `质量闭环${Date.now()}`;
const login = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, age: 80, password: '123456' }) });
const auth = { Cookie: (login.headers.get('set-cookie') || '').split(';')[0] };
let doctorAuth;
const doctor = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: `${name}医生`, age: 42, role: 'doctor', password: '123456' }) });
doctorAuth = { Cookie: (doctor.headers.get('set-cookie') || '').split(';')[0] };
try {
  const invalid = await request('/api/health/metrics', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'bp', value: 300, value2: 90 }) }).catch(e => ({ body: { error: e.message } }));
  if (!String(invalid.body.error).includes('invalid measurement') && !String(invalid.body.error).includes('value outside')) throw new Error('invalid measurement was accepted');
  const first = await request('/api/health/metrics', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'bp', value: 145, value2: 88, measurement_condition: '静坐5分钟后', recorded_at: new Date().toISOString() }) });
  const duplicate = await request('/api/health/metrics', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'bp', value: 145, value2: 88, measurement_condition: '静坐5分钟后', recorded_at: first.body.recorded_at }) });
  if (!duplicate.body.duplicate) throw new Error('duplicate measurement was not marked');
  const due = new Date(Date.now() + 24 * 3600000).toISOString();
  const action = await request('/api/actions', { method: 'POST', headers: auth, body: JSON.stringify({ action_type: 'schedule_recheck', title: '复测血压', desc: '明早固定时间测量', metric_type: 'bp', baseline_metric_id: first.body.id, due_at: due, idempotency_key: `quality-${Date.now()}` }) });
  if (!action.body.requires_confirmation || action.body.request.status !== 'pending_confirmation') throw new Error('recheck action bypassed confirmation');
  const confirmed = await request(`/api/actions/${action.body.request.id}/confirm`, { method: 'POST', headers: auth, body: '{}' });
  const followup = confirmed.body.followup;
  if (!followup?.id || followup.status !== 'scheduled') throw new Error('follow-up was not created atomically');
  const sources = (await request('/api/knowledge/graph/sources', { headers: doctorAuth })).body;
  const sourceId = sources.sources?.[0]?.source_id;
  const review = await request('/api/knowledge/graph/reviews', { method: 'POST', headers: doctorAuth, body: JSON.stringify({ source_id: sourceId, status: 'approved', notes: '演示审核通过' }) });
  if (review.body.status !== 'approved') throw new Error('knowledge review was not persisted');
  console.log(JSON.stringify({ pass: true, quality_flags: duplicate.body.quality?.flags || [], duplicate_marked: true, followup_status: followup.status, source_review: review.body.status }));
} finally {
  await request('/api/profile/me', { method: 'DELETE', headers: auth });
  await request('/api/profile/me', { method: 'DELETE', headers: doctorAuth });
}
