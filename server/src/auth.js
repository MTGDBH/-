// 登录鉴权路由 + session 中间件
// 注意：Mock 实现：仅做本地演示，未做密码哈希、未做防爆破、未做 HTTPS 强制
// 生产环境必须：bcrypt + rate-limit + secure cookie + CSRF
import express from 'express';
import crypto from 'node:crypto';
import db from './db.js';

const router = express.Router();
const COOKIE_NAME = 'sid';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 天

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 从 cookie 取 token
function getTokenFromReq(req) {
  const cookieHeader = req.headers.cookie || '';
  const m = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return m ? m[1] : null;
}

// ===== session 中间件 =====
// 从 cookie 拿 token，查 session，挂 req.user；查不到不报错（让路由自己决定 401）
export function sessionMiddleware(req, _res, next) {
  req.user = null;
  const token = getTokenFromReq(req);
  if (!token) return next();
  const row = db.prepare(`
    SELECT s.token, s.expires_at, u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return next();
  if (new Date(row.expires_at) < new Date()) {
    // 过期清理
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return next();
  }
  req.user = row;
  req.token = token;
  next();
}

// ===== 需要登录的守卫 =====
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not authenticated' });
  next();
}

// ===== 登录 =====
router.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  // identifier 可以是 name 或 emergency_phone
  if (!identifier || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }
  const user = db.prepare(`
    SELECT * FROM users WHERE name = ? OR emergency_phone = ? LIMIT 1
  `).get(identifier.trim(), identifier.trim());

  if (!user || user.password !== password) {
    return res.status(401).json({ error: '账号或密码不对，再试试？' });
  }

  // 创建 session
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)
  `).run(token, user.id, expires);

  // 设置 cookie（httpOnly 防 XSS）
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
  );

  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser, expires_at: expires });
});

// ===== 注册 =====
router.post('/register', (req, res) => {
  const { name, gender, age, password } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '请输入姓名' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }

  // 检查姓名是否已存在
  const existing = db.prepare('SELECT id FROM users WHERE name = ?').get(name.trim());
  if (existing) {
    return res.status(409).json({ error: '该姓名已被注册，请换一个或直接登录' });
  }

  // 随机暖色头像
  const avatarColors = ['#F4A261', '#E76F51', '#7FB069', '#6C8EBF', '#B084CC', '#E9A368'];
  const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];

  const result = db.prepare(`
    INSERT INTO users (name, gender, age, password, avatar_color)
    VALUES (?, ?, ?, ?, ?)
  `).run(name.trim(), gender || 'unknown', age || null, password, avatarColor);

  // 自动创建 session（注册即登录）
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)
  `).run(token, result.lastInsertRowid, expires);

  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
  );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const { password: _, ...safeUser } = user;
  res.status(201).json({ user: safeUser, expires_at: expires });
});

// ===== 登出 =====
router.post('/logout', (req, res) => {
  const token = getTokenFromReq(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
  res.json({ ok: true });
});

// ===== 当前用户 =====
router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not authenticated' });
  const { password: _, ...safeUser } = req.user;
  res.json(safeUser);
});

export default router;
