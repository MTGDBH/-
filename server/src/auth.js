import express from 'express';
import { authRepository } from './repositories/authRepository.js';
import { audit, requestFingerprint } from './services/auditService.js';
import {
  authenticate, cleanupSessions, cookieHeader, cookieName, createSession,
  hashPassword, resolveSession, revokeSession, safeUser,
} from './services/authService.js';
import { validateLoginInput, validateRegistrationInput } from './validators/authValidator.js';

const router = express.Router();
const ipWindows = new Map();
const RATE_WINDOW_MS = Math.max(10_000, Number(process.env.LOGIN_RATE_WINDOW_MS || 60_000));
const RATE_MAX = Math.max(3, Number(process.env.LOGIN_RATE_MAX || 10));

function getTokenFromReq(req) {
  const match = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${cookieName()}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function rateLimited(req) {
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const current = ipWindows.get(key);
  if (!current || current.resetAt <= now) { ipWindows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS }); return false; }
  current.count += 1;
  return current.count > RATE_MAX;
}

export function sessionMiddleware(req, _res, next) {
  req.user = null;
  req.session_token_hash = null;
  const session = resolveSession(getTokenFromReq(req));
  if (session) { req.user = session.row; req.session_token_hash = session.tokenHash; }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '登录状态已失效，请重新登录' });
  next();
}

router.post('/login', async (req, res) => {
  if (rateLimited(req)) {
    audit({ event_type: 'auth_login', action: 'login', outcome: 'rate_limited', request_id: req.request_id, ...requestFingerprint(req) });
    return res.status(429).json({ error: '尝试次数较多，请稍后再试' });
  }
  const parsed = validateLoginInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const result = await authenticate(parsed.value.identifier, parsed.value.password);
  if (!result.ok) {
    audit({ actor_user_id: result.user?.id, event_type: 'auth_login', action: 'login', outcome: result.code, request_id: req.request_id, ...requestFingerprint(req) });
    if (result.code === 'ACCOUNT_LOCKED') return res.status(423).json({ error: '账号暂时锁定，请稍后再试', retry_at: result.retry_at });
    return res.status(401).json({ error: '账号或密码不对，请核对后再试' });
  }
  const session = createSession(result.user.id, req);
  res.setHeader('Set-Cookie', cookieHeader(session.rawToken));
  audit({ actor_user_id: result.user.id, subject_user_id: result.user.id, event_type: 'auth_login', action: 'login', outcome: 'success', request_id: req.request_id, ...requestFingerprint(req) });
  res.json({ user: safeUser(result.user), expires_at: session.expiresAt });
});

router.post('/register', async (req, res) => {
  const parsed = validateRegistrationInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  if (authRepository.findUser(parsed.value.name)) return res.status(409).json({ error: '该姓名已被注册，请换一个或直接登录' });
  const colors = ['#F4A261', '#E76F51', '#5A8045', '#386FBD', '#80649B', '#A65D32'];
  const inserted = authRepository.createUser({ ...parsed.value, password: await hashPassword(parsed.value.password), avatarColor: colors[Math.floor(Math.random() * colors.length)] });
  const user = authRepository.findUserById(inserted.lastInsertRowid);
  const session = createSession(user.id, req);
  res.setHeader('Set-Cookie', cookieHeader(session.rawToken));
  audit({ actor_user_id: user.id, subject_user_id: user.id, event_type: 'auth_register', action: 'register', outcome: 'success', request_id: req.request_id, ...requestFingerprint(req), metadata: { role: user.role } });
  res.status(201).json({ user: safeUser(user), expires_at: session.expiresAt });
});

router.post('/logout', (req, res) => {
  revokeSession(getTokenFromReq(req));
  res.setHeader('Set-Cookie', cookieHeader('', { clear: true }));
  audit({ actor_user_id: req.user?.id, subject_user_id: req.user?.id, event_type: 'auth_logout', action: 'logout', outcome: 'success', request_id: req.request_id, ...requestFingerprint(req) });
  res.json({ ok: true });
});

router.get('/me', (req, res) => req.user ? res.json(safeUser(req.user)) : res.status(401).json({ error: '登录状态已失效，请重新登录' }));

cleanupSessions();
export default router;
