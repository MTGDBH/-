import bcrypt from 'bcryptjs';
import db from '../src/db.js';

const dryRun = process.argv.includes('--dry-run');
const users = db.prepare('SELECT id,password,password_algo FROM users').all();
const legacy = users.filter(user => !String(user.password || '').startsWith('$2'));
const sessionCount = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
const adminUserId = Number(process.env.ADMIN_USER_ID || 0);
const secretRow = db.prepare("SELECT value FROM settings WHERE key='llm_config'").get();
let secretRemoved = false;
let metadata = null;
if (secretRow) {
  try {
    const old = JSON.parse(secretRow.value || '{}');
    secretRemoved = Boolean(old.api_key);
    metadata = { base_url: old.base_url || '', model: old.model || '', secret_source: 'environment' };
  } catch {}
}

if (!dryRun) db.transaction(() => {
  const update = db.prepare("UPDATE users SET password=?,password_algo='bcrypt',password_changed_at=? WHERE id=?");
  for (const user of legacy) update.run(bcrypt.hashSync(String(user.password), 12), new Date().toISOString(), user.id);
  db.prepare('DELETE FROM sessions').run();
  db.prepare("DELETE FROM settings WHERE key='llm_config'").run();
  if (Number.isInteger(adminUserId) && adminUserId > 0) db.prepare("UPDATE users SET role='admin' WHERE id=?").run(adminUserId);
  if (metadata) db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('llm_metadata',?,datetime('now','localtime'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now','localtime')`).run(JSON.stringify(metadata));
})();

console.log(JSON.stringify({ dry_run: dryRun, legacy_passwords: legacy.length, sessions_to_invalidate: sessionCount, plaintext_api_key_found: secretRemoved, admin_user_id: adminUserId || null, next: '在服务器环境变量中设置 API Key；迁移后所有用户需重新登录。' }, null, 2));
