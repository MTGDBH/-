// 数据质量、复测闭环和医生知识审核接口回归。
import db from '../src/db.js';
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
db.prepare("UPDATE users SET role='doctor' WHERE id=?").run(doctor.body.user.id);
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
  const confirmed = await request(`/api/actions/${action.body.request.id}/confirm`, { method: 'POST', headers: auth, body: JSON.stringify({ confirmation_token: action.body.confirmation.one_time_token }) });
  const followup = confirmed.body.followup;
  if (!followup?.id || followup.status !== 'scheduled') throw new Error('follow-up was not created atomically');
  const recheck = await request('/api/health/metrics', { method: 'POST', headers: auth, body: JSON.stringify({ type: 'bp', value: 136, value2: 84, measurement_condition: '静坐5分钟后', recorded_at: new Date(Date.now() + 2 * 60000).toISOString() }) });
  if (recheck.body.followup_match?.status !== 'pending_result_confirmation') throw new Error('new measurement was not matched to the scheduled follow-up');
  const completed = await request(`/api/actions/followups/${followup.id}/candidate/confirm`, { method: 'POST', headers: auth, body: JSON.stringify({ metric_id: recheck.body.id }) });
  if (completed.body.status !== 'completed' || completed.body.result_metric_id !== recheck.body.id) throw new Error('follow-up result was not confirmed');
  if (completed.body.comparison?.delta !== -9 || completed.body.comparison?.delta2 !== -4) throw new Error('follow-up comparison does not match evidence');
  const sources = (await request('/api/knowledge/graph/sources', { headers: doctorAuth })).body;
  const sourceId = sources.sources?.[0]?.source_id;
  const review = await request('/api/knowledge/graph/reviews', { method: 'POST', headers: doctorAuth, body: JSON.stringify({ source_id: sourceId, status: 'approved', notes: '演示审核通过' }) });
  if (review.body.status !== 'approved') throw new Error('knowledge review was not persisted');
  console.log(JSON.stringify({ pass: true, quality_flags: duplicate.body.quality?.flags || [], duplicate_marked: true, followup_status: completed.body.status, comparison: { delta: completed.body.comparison.delta, delta2: completed.body.comparison.delta2 }, source_review: review.body.status }));
} finally {
  // 隔离数据库由主测试入口统一销毁。
}
