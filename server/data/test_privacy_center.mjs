import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const db = new Database(process.env.DB_PATH);
const stamp = Date.now();
const password = 'Privacy-123';

async function request(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body, text, headers: response.headers };
}
async function register(name) {
  const response = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, password, age: 76, gender: 'female', role: 'senior' }) });
  assert.equal(response.status, 201); return { id: response.body.user.id, cookie: response.headers.get('set-cookie').split(';')[0], name };
}
const owner = await register(`隐私老人${stamp}`);
const other = await register(`其他用户绝密标记${stamp}`);
const auth = user => ({ Cookie: user.cookie });

try {
  db.prepare("UPDATE users SET emergency_name='家属甲',emergency_phone='13800138000' WHERE id=?").run(owner.id);
  db.prepare("INSERT INTO metrics (user_id,type,value,unit,recorded_at,note) VALUES (?,'bp',132,'mmHg',?,'本人健康内容')").run(owner.id, new Date().toISOString());
  db.prepare("INSERT INTO chat_messages (user_id,subject_user_id,actor_user_id,role,content) VALUES (?,?,?,'user','本人对话内容')").run(owner.id, owner.id, owner.id);
  db.prepare("INSERT INTO chat_messages (user_id,subject_user_id,actor_user_id,role,content) VALUES (?,?,?,'user',?)").run(other.id, other.id, other.id, other.name);

  assert.equal((await request('/api/privacy/overview')).status, 401, 'privacy API requires authentication');
  const overview = await request('/api/privacy/overview', { headers: auth(owner) });
  assert.equal(overview.status, 200); assert.equal(overview.body.categories.length, 8);
  assert.match(overview.body.profile_preview.emergency_phone, /\*\*\*\*/);

  const jsonExport = await request('/api/privacy/exports', { method: 'POST', headers: auth(owner), body: JSON.stringify({ format: 'json' }) });
  assert.equal(jsonExport.status, 200); assert.equal(jsonExport.body.profile.name, owner.name);
  assert.ok(jsonExport.text.includes('本人健康内容')); assert.ok(jsonExport.text.includes('本人对话内容'));
  assert.ok(!jsonExport.text.includes(other.name), 'export leaked another user');
  const forbiddenKey = /"(?:password(?:_algo)?|token|api_key|authorization|cookie|secret|credential|locked_until|login_failures)"\s*:/i;
  assert.ok(!forbiddenKey.test(jsonExport.text), 'export contains a forbidden sensitive field');

  const csvExport = await request('/api/privacy/exports', { method: 'POST', headers: auth(owner), body: JSON.stringify({ format: 'csv' }) });
  assert.equal(csvExport.status, 200); assert.match(csvExport.text, /category,path,value/); assert.match(csvExport.text, /本人健康内容/);
  assert.ok(!csvExport.text.includes(other.name), 'CSV leaked another user');
  assert.equal((await request('/api/privacy/exports', { method: 'POST', headers: auth(owner), body: JSON.stringify({ format: 'json' }) })).status, 200);
  assert.equal((await request('/api/privacy/exports', { method: 'POST', headers: auth(owner), body: JSON.stringify({ format: 'json' }) })).status, 429, 'fourth export must be rate limited');

  const deletion = await request('/api/privacy/deletion-requests', { method: 'POST', headers: auth(owner), body: '{}' });
  assert.equal(deletion.status, 201); assert.equal(deletion.body.categories.length, 7);
  assert.equal((await request(`/api/privacy/deletion-requests/${deletion.body.id}/confirm`, { method: 'POST', headers: auth(owner), body: JSON.stringify({ confirmation_text: '删除', password }) })).status, 400);
  assert.equal((await request(`/api/privacy/deletion-requests/${deletion.body.id}/confirm`, { method: 'POST', headers: auth(owner), body: JSON.stringify({ confirmation_text: deletion.body.confirmation_text, password: 'wrong' }) })).status, 401);
  const removed = await request(`/api/privacy/deletion-requests/${deletion.body.id}/confirm`, { method: 'POST', headers: auth(owner), body: JSON.stringify({ confirmation_text: deletion.body.confirmation_text, password }) });
  assert.equal(removed.status, 200); assert.equal(removed.body.status, 'completed');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM users WHERE id=?').get(owner.id).count, 0);
  for (const [table, column] of [['sessions','user_id'],['metrics','user_id'],['chat_messages','user_id'],['privacy_export_events','user_id'],['care_relationships','senior_id'],['agent_memories','subject_user_id'],['interventions','subject_user_id']]) {
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${column}=?`).get(owner.id).count, 0, `${table} was not cleaned`);
  }
  const retained = db.prepare("SELECT actor_user_id,subject_user_id,metadata FROM audit_logs WHERE event_type='privacy_data_management' AND action='account_deletion_confirmed' ORDER BY id DESC LIMIT 1").get();
  assert.ok(retained); assert.equal(retained.actor_user_id, null); assert.equal(retained.subject_user_id, null); assert.equal(retained.metadata, '{}');
  assert.equal((await request('/api/auth/me', { headers: auth(owner) })).status, 401);

  console.log(JSON.stringify({ pass: true, permissions: true, isolation: true, json_integrity: true, csv_integrity: true, sensitive_field_exclusion: true, rate_limit: true, second_confirmation: true, account_cleanup: true, minimized_audit_retention: true }));
} finally {
  // 测试数据库是一次性的；避免用任何生产删除捷径绕过二次确认流程。
  db.close();
}
