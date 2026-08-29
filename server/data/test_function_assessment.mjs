import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const database = new Database(process.env.DB_PATH);
const stamp = Date.now();
const name = `生活能力评估测试${stamp}`;

async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json();
  return { status: response.status, body, cookie: response.headers.get('set-cookie') || '' };
}

const registered = await request('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ name, password: 'FunctionTest-123', age: 72, gender: 'female', role: 'senior' }),
});
assert.equal(registered.status, 201);
const cookie = registered.cookie.split(';')[0];
const userId = registered.body.user.id;

const answers = {
  adl_dressing: 1, adl_bathing: 0, adl_eating: 0, adl_bed: 1, adl_toilet: 0, adl_continence: 0,
  iadl_shopping: 1, iadl_cooking: 0, iadl_medication: 0, iadl_money: 1, iadl_housework: 0,
};
const saved = await request('/api/prediction/intakes', {
  method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ answers, status: 'completed' }),
});
assert.equal(saved.status, 201);
assert.equal(saved.body.scores.adlab_c, 2);
assert.equal(saved.body.scores.iadl, 2);

const latest = await request('/api/assessments/latest', { headers: { Cookie: cookie } });
assert.equal(latest.status, 200);
assert.equal(latest.body.adl, 2);
assert.equal(latest.body.iadl, 2);
assert.equal(latest.body.functional_complete, true);
assert.ok(latest.body.functional_evaluated_at);

database.prepare('DELETE FROM users WHERE id=?').run(userId);
database.close();
console.log(JSON.stringify({ pass: true, adl: 2, iadl: 2, assessment_sync: true }));
