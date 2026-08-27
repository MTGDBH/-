import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authRepository } from '../repositories/authRepository.js';

const BCRYPT_ROUNDS = Math.max(10, Math.min(14, Number(process.env.BCRYPT_ROUNDS || 12)));
const MAX_FAILURES = Math.max(3, Number(process.env.LOGIN_MAX_FAILURES || 5));
const LOCK_MS = Math.max(60_000, Number(process.env.LOGIN_LOCK_MS || 15 * 60_000));
const SESSION_TTL_MS = Math.max(15 * 60_000, Number(process.env.SESSION_TTL_MS || 7 * 24 * 3600_000));
const SESSION_IDLE_MS = Math.max(5 * 60_000, Number(process.env.SESSION_IDLE_MS || 12 * 3600_000));
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.1Z8Wgk6q6Q6UzQx8M1bPi2xQw4oU8aW';

export const tokenHash = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
export const fingerprintHash = value => value ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32) : null;
export const hashPassword = password => bcrypt.hash(String(password), BCRYPT_ROUNDS);

function legacyMatches(stored, supplied) {
  const left = Buffer.from(String(stored || ''));
  const right = Buffer.from(String(supplied || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function authenticate(identifier, password) {
  const user = authRepository.findUser(identifier);
  const now = Date.now();
  if (user?.locked_until && Date.parse(user.locked_until) > now) return { ok: false, code: 'ACCOUNT_LOCKED', retry_at: user.locked_until, user };
  const bcryptStored = String(user?.password || '').startsWith('$2');
  const matched = user
    ? (bcryptStored ? await bcrypt.compare(password, user.password) : legacyMatches(user.password, password))
    : await bcrypt.compare(password, DUMMY_HASH).then(() => false);
  if (!matched) {
    if (user) {
      const failures = Number(user.login_failures || 0) + 1;
      authRepository.recordFailure(user.id, failures, failures >= MAX_FAILURES ? new Date(now + LOCK_MS).toISOString() : null);
    }
    return { ok: false, code: 'INVALID_CREDENTIALS', user };
  }
  if (!bcryptStored) authRepository.updatePassword(user.id, await hashPassword(password));
  authRepository.clearFailures(user.id);
  return { ok: true, user: authRepository.findUserById(user.id) };
}

export function createSession(userId, req) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  authRepository.createSession(tokenHash(rawToken), userId, expiresAt, fingerprintHash(req.get('user-agent')), fingerprintHash(req.ip || req.socket?.remoteAddress));
  return { rawToken, expiresAt };
}

export function resolveSession(rawToken) {
  if (!rawToken) return null;
  const hashed = tokenHash(rawToken);
  const row = authRepository.findSession(hashed);
  if (!row) return null;
  const now = Date.now();
  const idleAt = Date.parse(row.last_seen_at || row.created_at || row.expires_at);
  if (Date.parse(row.expires_at) <= now || (Number.isFinite(idleAt) && now - idleAt > SESSION_IDLE_MS)) {
    authRepository.deleteSession(hashed);
    return null;
  }
  authRepository.touchSession(hashed);
  return { row, tokenHash: hashed };
}

export function revokeSession(rawToken) { if (rawToken) authRepository.deleteSession(tokenHash(rawToken)); }
export function cleanupSessions() { authRepository.deleteExpiredSessions(new Date().toISOString()); }
export function cookieName() { return process.env.NODE_ENV === 'production' ? '__Host-sid' : 'sid'; }
export function cookieHeader(token, { clear = false } = {}) {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1';
  return `${cookieName()}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${clear ? 0 : Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function safeUser(user) {
  if (!user) return null;
  const { password, password_algo, password_changed_at, login_failures, locked_until, last_failed_login_at, token, ...safe } = user;
  return safe;
}
