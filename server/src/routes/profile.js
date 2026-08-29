// 个人资料路由
import express from 'express';
import db from '../db.js';
import bcrypt from 'bcryptjs';
import { hashPassword, safeUser } from '../services/authService.js';

const router = express.Router();

// 当前用户资料（与 /api/auth/me 类似，但支持 PUT）
router.get('/me', (req, res) => {
  res.json(safeUser(req.user));
});

router.put('/me', (req, res) => {
  const {
    name, age, height, emergency_name, emergency_phone, notification_prefs,
    education_level, smoking_status, cigarettes_per_day, drinking_status,
    drinking_frequency, exercise_level, self_rated_health, chronic_hypertension, chronic_diabetes,
    chronic_heart, chronic_stroke, dyslipidemia, lung_disease,
  } = req.body;
  const fields = [];
  const values = [];
  const numberOrNull = (value, min, max, integer = false) => {
    if (value === undefined || value === null || value === '') return null;
    const n = integer ? parseInt(value, 10) : parseFloat(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const binaryOrNull = (value) => {
    if (value === undefined || value === null || value === '') return null;
    return Number(value) === 1 ? 1 : Number(value) === 0 ? 0 : null;
  };

  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (age !== undefined) { fields.push('age = ?'); values.push(parseInt(age, 10) || null); }
  if (height !== undefined) { fields.push('height = ?'); values.push(parseFloat(height) || null); }
  if (emergency_name !== undefined) { fields.push('emergency_name = ?'); values.push(emergency_name); }
  if (emergency_phone !== undefined) { fields.push('emergency_phone = ?'); values.push(emergency_phone); }
  if (notification_prefs !== undefined) { fields.push('notification_prefs = ?'); values.push(JSON.stringify(notification_prefs)); }
  if (education_level !== undefined) { fields.push('education_level = ?'); values.push(numberOrNull(education_level, 1, 4, true)); }
  if (smoking_status !== undefined) { fields.push('smoking_status = ?'); values.push(binaryOrNull(smoking_status)); }
  if (cigarettes_per_day !== undefined) { fields.push('cigarettes_per_day = ?'); values.push(numberOrNull(cigarettes_per_day, 0, 100)); }
  if (drinking_status !== undefined) { fields.push('drinking_status = ?'); values.push(binaryOrNull(drinking_status)); }
  if (drinking_frequency !== undefined) { fields.push('drinking_frequency = ?'); values.push(numberOrNull(drinking_frequency, 0, 365)); }
  if (exercise_level !== undefined) { fields.push('exercise_level = ?'); values.push(numberOrNull(exercise_level, 0, 200)); }
  if (self_rated_health !== undefined) { fields.push('self_rated_health = ?'); values.push(numberOrNull(self_rated_health, 1, 5, true)); }
  for (const [input, column] of [['chronic_hypertension', 'chronic_hypertension'], ['chronic_diabetes', 'chronic_diabetes'], ['chronic_heart', 'chronic_heart'], ['chronic_stroke', 'chronic_stroke'], ['dyslipidemia', 'dyslipidemia'], ['lung_disease', 'lung_disease']]) {
    if (req.body[input] !== undefined) { fields.push(`${column} = ?`); values.push(binaryOrNull(req.body[input])); }
  }

  if (fields.length === 0) return res.json(req.user);

  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json(safeUser(updated));
});

// 修改密码
router.post('/password', async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    return res.status(400).json({ error: '请填写当前密码和新密码' });
  }
  const valid = String(req.user.password || '').startsWith('$2')
    ? await bcrypt.compare(String(old_password), req.user.password)
    : String(req.user.password || '') === String(old_password);
  if (!valid) {
    return res.status(401).json({ error: '当前密码不对' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: '新密码至少 6 位' });
  }
  const hashed = await hashPassword(new_password);
  db.transaction(() => {
    db.prepare("UPDATE users SET password=?,password_algo='bcrypt',password_changed_at=? WHERE id=?").run(hashed, new Date().toISOString(), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(req.user.id, req.session_token_hash || '');
  })();
  res.json({ ok: true, message: '密码已更新，其他设备需要重新登录' });
});

// 禁止绕过隐私中心的预览和二次确认流程。
router.delete('/me', (_req, res) => res.status(409).json({
  error: '请前往隐私与数据管理中心，查看删除范围并完成二次确认',
  privacy_center: '/privacy.html',
}));

export default router;
