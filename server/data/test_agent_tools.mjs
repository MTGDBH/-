// 智能体工具回归：预警查询使用真实提醒；行动请求只生成可确认计划，不越过用户确认执行。
import db from '../src/db.js';
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const name = `智能体工具回归${Date.now()}`;
async function request(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${body.error || text}`);
  return { body, headers: res.headers };
}
const login = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, age: 75, gender: 'female', password: '123456' }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0]; const auth = { Cookie: cookie };
try {
  const me = await request('/api/auth/me', { headers: auth });
  db.prepare("INSERT INTO alerts (user_id, metric_type, severity, title, message) VALUES (?, 'bp', 'warning', ?, ?)")
    .run(me.body.id, '工具回归提醒', '请复测血压并记录结果');
  const alertChat = (await request('/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ message: '我有哪些待处理提醒？' }) })).body;
  if (!alertChat.content || !/工具回归提醒|待处理提醒|提醒/.test(alertChat.content)) throw new Error('alert tool response did not use current alert');
  const actionChat = (await request('/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ message: '帮我明早测血压' }) })).body;
  if (!actionChat.plan?.some(p => p.action_type === 'schedule_recheck') || !/待办|记录/.test(actionChat.content)) throw new Error('action plan was not structured');
  const pending = (await request('/api/actions', { headers: auth })).body.items;
  if (pending.length) throw new Error('agent action unexpectedly executed without button confirmation');
  console.log(JSON.stringify({ pass: true, alert_source: alertChat.source, action_source: actionChat.source, action_type: actionChat.plan[0].action_type }));
} finally {
  const deleted = await request('/api/profile/me', { method: 'DELETE', headers: auth });
  if (!deleted.body?.ok) throw new Error('agent tools test account cleanup failed');
}
