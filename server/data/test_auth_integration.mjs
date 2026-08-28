import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const database = new Database(process.env.DB_PATH);
const stamp = Date.now();
const password = 'AuthTest-123';
const name = `认证回归${stamp}`;

async function request(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: response.status, body, cookie: response.headers.get('set-cookie') || '' };
}

const register = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, password, age: 70, gender: 'female', role: 'senior' }) });
assert.equal(register.status, 201);
assert.match(register.cookie, /HttpOnly/i);
assert.match(register.cookie, /SameSite=Strict/i);
assert.match(register.cookie, /Secure/i);
const originalCookie = register.cookie.split(';')[0];
const userId = register.body.user.id;

// A legacy plaintext row is upgraded only after a successful password check.
database.prepare("UPDATE users SET password=?,password_algo='legacy_plaintext' WHERE id=?").run(password, userId);
const migrated = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: name, password }) });
assert.equal(migrated.status, 200);
const migratedRow = database.prepare('SELECT password,password_algo FROM users WHERE id=?').get(userId);
assert.match(migratedRow.password, /^\$2/);
assert.equal(migratedRow.password_algo, 'bcrypt');

// Repeated bad credentials lock the account. A correct password does not bypass
// an active lock; once the lock expires it clears the failure state.
for (let index = 0; index < 3; index += 1) {
  const failed = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: name, password: 'wrong-password' }) });
  assert.equal(failed.status, 401);
}
const locked = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: name, password }) });
assert.equal(locked.status, 423);
database.prepare("UPDATE users SET locked_until=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), userId);
const recovered = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: name, password }) });
assert.equal(recovered.status, 200);
assert.equal(database.prepare('SELECT login_failures FROM users WHERE id=?').get(userId).login_failures, 0);
const recoveredCookie = recovered.cookie.split(';')[0];

// Expired sessions and logout both invalidate the bearer cookie.
const rawToken = recoveredCookie.split('=', 2)[1];
const sessionHash = crypto.createHash('sha256').update(rawToken).digest('hex');
database.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(new Date(Date.now() - 1000).toISOString(), sessionHash);
assert.equal((await request('/api/auth/me', { headers: { Cookie: recoveredCookie } })).status, 401);
const relogin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: name, password }) });
const liveCookie = relogin.cookie.split(';')[0];
assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { Cookie: liveCookie }, body: '{}' })).status, 200);
assert.equal((await request('/api/auth/me', { headers: { Cookie: liveCookie } })).status, 401);

// Permission matrix: a senior cannot inspect operations; the same authenticated
// account can after its persisted role is changed to admin.
assert.equal((await request('/api/ops/metrics', { headers: { Cookie: originalCookie } })).status, 403);
database.prepare("UPDATE users SET role='admin' WHERE id=?").run(userId);
assert.equal((await request('/api/ops/metrics', { headers: { Cookie: originalCookie } })).status, 200);

// Two independent connections observe one atomic SQLite bucket, matching local
// multi-process behaviour. Production uses the Redis implementation instead.
const { SqliteRateLimitStore } = await import('../src/services/rateLimitStore.js');
const secondDatabase = new Database(process.env.DB_PATH);
const storeA = new SqliteRateLimitStore(database);
const storeB = new SqliteRateLimitStore(secondDatabase);
const sharedKey = `test:${stamp}`;
assert.equal((await storeA.consume([sharedKey], { windowMs: 60_000, maxAttempts: 2 }))[0].limited, false);
assert.equal((await storeB.consume([sharedKey], { windowMs: 60_000, maxAttempts: 2 }))[0].limited, false);
assert.equal((await storeA.consume([sharedKey], { windowMs: 60_000, maxAttempts: 2 }))[0].limited, true);
await storeB.clear([sharedKey]);
secondDatabase.close();

database.prepare('DELETE FROM users WHERE id=?').run(userId);
database.close();
console.log(JSON.stringify({ pass: true, bcrypt_migration: true, lockout: true, recovery: true, session_expiry: true, logout: true, cookie_policy: true, permission_matrix: true, shared_rate_limit: true }));
