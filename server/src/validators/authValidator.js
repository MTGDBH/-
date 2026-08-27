export function validateLoginInput(body = {}) {
  const identifier = String(body.identifier || '').trim().slice(0, 120);
  const password = String(body.password || '');
  if (!identifier || !password) return { ok: false, error: '请输入账号和密码' };
  return { ok: true, value: { identifier, password } };
}

export function validateRegistrationInput(body = {}) {
  const name = String(body.name || '').trim().slice(0, 80);
  const password = String(body.password || '');
  if (!name) return { ok: false, error: '请输入姓名' };
  if (password.length < 6) return { ok: false, error: '密码至少6位' };
  return { ok: true, value: { name, password, gender: body.gender || 'unknown', age: body.age || null, role: body.role === 'caregiver' ? 'caregiver' : 'senior' } };
}
