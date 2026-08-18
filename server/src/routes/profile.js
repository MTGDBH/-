// 个人资料路由
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 当前用户资料（与 /api/auth/me 类似，但支持 PUT）
router.get('/me', (req, res) => {
  const { password: _, ...safe } = req.user;
  res.json(safe);
});

router.put('/me', (req, res) => {
  const { name, age, height, emergency_name, emergency_phone, notification_prefs } = req.body;
  const fields = [];
  const values = [];

  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (age !== undefined) { fields.push('age = ?'); values.push(parseInt(age, 10) || null); }
  if (height !== undefined) { fields.push('height = ?'); values.push(parseFloat(height) || null); }
  if (emergency_name !== undefined) { fields.push('emergency_name = ?'); values.push(emergency_name); }
  if (emergency_phone !== undefined) { fields.push('emergency_phone = ?'); values.push(emergency_phone); }
  if (notification_prefs !== undefined) { fields.push('notification_prefs = ?'); values.push(JSON.stringify(notification_prefs)); }

  if (fields.length === 0) return res.json(req.user);

  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const { password: _, ...safe } = updated;
  res.json(safe);
});

// 修改密码
router.post('/password', (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    return res.status(400).json({ error: '请填写当前密码和新密码' });
  }
  if (req.user.password !== old_password) {
    return res.status(401).json({ error: '当前密码不对' });
  }
  if (new_password.length < 4) {
    return res.status(400).json({ error: '新密码至少 4 位' });
  }
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(new_password, req.user.id);
  res.json({ ok: true });
});

// 注销账号（demo 仅保留逻辑：删除用户，会级联清理数据）
router.delete('/me', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

export default router;
