// 智能体行动闭环回归：所有写操作先预览，一次性确认后执行，重放不产生重复记录。
import db from '../src/db.js';
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const name = `\u884c\u52a8\u56de\u5f52\u6d4b\u8bd5${Date.now()}`;
async function request(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text}`);
  return { body, headers: res.headers };
}
const login = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, age: 75, gender: 'female', password: '123456' }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const auth = { Cookie: cookie };
try {
  const todo = (await request('/api/actions', { method: 'POST', headers: auth, body: JSON.stringify({ action_type: 'create_todo', title: '测试记录血压', desc: '行动闭环回归' }) })).body;
  if (!todo.requires_confirmation || !todo.confirmation?.one_time_token) throw new Error('普通写操作未触发确认门槛');
  const todoExecuted = (await request(`/api/actions/${todo.request.id}/confirm`, { method: 'POST', headers: auth, body: JSON.stringify({ confirmation_token: todo.confirmation.one_time_token }) })).body;
  if (!todoExecuted.result?.id) throw new Error('确认后未创建待办');
  await request(`/api/todos/${todoExecuted.result.id}`, { method: 'DELETE', headers: auth });
  const pending = (await request('/api/actions', { method: 'POST', headers: auth, body: JSON.stringify({ action_type: 'contact_doctor', title: '测试联系医生' }) })).body;
  if (!pending.requires_confirmation || !pending.request?.id) throw new Error('敏感行动未触发确认门槛');
  const denied = await fetch(base + `/api/actions/${pending.request.id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: '{}' });
  if (denied.status !== 409) throw new Error('缺少一次性令牌仍可确认');
  const executed = (await request(`/api/actions/${pending.request.id}/confirm`, { method: 'POST', headers: auth, body: JSON.stringify({ confirmation_token: pending.confirmation.one_time_token }) })).body;
  if (executed.request?.status !== 'executed') throw new Error('确认后行动未执行');
  const beforeReplay = db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE user_id=? AND title='建议联系医生'").get(login.body.id).n;
  const replay = (await request(`/api/actions/${pending.request.id}/confirm`, { method: 'POST', headers: auth, body: JSON.stringify({ confirmation_token: pending.confirmation.one_time_token }) })).body;
  const afterReplay = db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE user_id=? AND title='建议联系医生'").get(login.body.id).n;
  if (!replay.idempotent_replay || beforeReplay !== afterReplay) throw new Error('确认重放产生了重复写入');
  console.log(JSON.stringify({ pass: true, todo_created_after_confirmation: true, confirmation_required: true, replay_safe: true, action_status: executed.request.status }));
} finally {
  // 本文件只在 run-tests.mjs 创建的隔离数据库中执行，测试进程结束后整个临时库会删除。
}
