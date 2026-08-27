import db from '../db.js';

export const authRepository = {
  findUser(identifier) {
    return db.prepare('SELECT * FROM users WHERE name = ? OR emergency_phone = ? LIMIT 1').get(identifier, identifier);
  },
  findUserById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); },
  createUser({ name, gender, age, password, avatarColor, role }) {
    return db.prepare('INSERT INTO users (name,gender,age,password,avatar_color,role,password_algo) VALUES (?,?,?,?,?,?,?)')
      .run(name, gender, age, password, avatarColor, role, 'bcrypt');
  },
  updatePassword(id, hash) { db.prepare("UPDATE users SET password=?,password_algo='bcrypt',password_changed_at=? WHERE id=?").run(hash, new Date().toISOString(), id); },
  recordFailure(id, failures, lockedUntil) {
    db.prepare('UPDATE users SET login_failures=?,locked_until=?,last_failed_login_at=? WHERE id=?')
      .run(failures, lockedUntil, new Date().toISOString(), id);
  },
  clearFailures(id) { db.prepare('UPDATE users SET login_failures=0,locked_until=NULL,last_failed_login_at=NULL WHERE id=?').run(id); },
  createSession(tokenHash, userId, expiresAt, userAgentHash, ipHash) {
    db.prepare('INSERT INTO sessions (token,user_id,expires_at,user_agent_hash,ip_hash,last_seen_at) VALUES (?,?,?,?,?,?)')
      .run(tokenHash, userId, expiresAt, userAgentHash, ipHash, new Date().toISOString());
  },
  findSession(tokenHash) {
    return db.prepare(`SELECT s.token,s.expires_at,s.last_seen_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`).get(tokenHash);
  },
  touchSession(tokenHash) { db.prepare('UPDATE sessions SET last_seen_at=? WHERE token=?').run(new Date().toISOString(), tokenHash); },
  deleteSession(tokenHash) { db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash); },
  deleteExpiredSessions(now) { db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now); },
};

