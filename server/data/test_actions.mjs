// 智能体行动闭环回归：普通建议直接创建待办，敏感建议必须二次确认，注销清理不应触发外键错误。
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
  if (!todo.result?.id || todo.requires_confirmation) throw new Error('普通行动未直接创建待办');
  await request(`/api/todos/${todo.result.id}`, { method: 'DELETE', headers: auth });
  const pending = (await request('/api/actions', { method: 'POST', headers: auth, body: JSON.stringify({ action_type: 'contact_doctor', title: '测试联系医生' }) })).body;
  if (!pending.requires_confirmation || !pending.request?.id) throw new Error('敏感行动未触发确认门槛');
  const executed = (await request(`/api/actions/${pending.request.id}/confirm`, { method: 'POST', headers: auth, body: '{}' })).body;
  if (executed.request?.status !== 'executed') throw new Error('确认后行动未执行');
  console.log(JSON.stringify({ pass: true, todo_created: true, confirmation_required: true, action_status: executed.request.status }));
} finally {
  const deleted = await request('/api/profile/me', { method: 'DELETE', headers: auth });
  if (!deleted.body?.ok) throw new Error('测试账号清理失败');
}
