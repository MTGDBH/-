// 家属/医生授权回归：未授权不可读，授权后只读摘要可读，注销可清理关系。
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const stamp = Date.now();
const names = { senior: `\u6388\u6743\u8001\u4eba${stamp}`, member: `\u6388\u6743\u5bb6\u5c5e${stamp}`, stranger: `\u672a\u6388\u6743${stamp}` };
async function request(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body, headers: res.headers };
}
async function register(name, role) {
  const x = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, role, age: 76, gender: 'female', password: '123456' }) });
  if (x.status !== 201) throw new Error(`register ${role} failed: ${JSON.stringify(x.body)}`);
  return (x.headers.get('set-cookie') || '').split(';')[0];
}
const seniorCookie = await register(names.senior, 'senior');
const memberCookie = await register(names.member, 'caregiver');
const strangerCookie = await register(names.stranger, 'caregiver');
const seniorAuth = { Cookie: seniorCookie }; const memberAuth = { Cookie: memberCookie }; const strangerAuth = { Cookie: strangerCookie };
try {
  const invite = await request('/api/care/invitations', { method: 'POST', headers: seniorAuth, body: JSON.stringify({ member_role: 'caregiver' }) });
  if (invite.status !== 201 || !invite.body.code) throw new Error('invite creation failed');
  const before = await request(`/api/care/seniors/${invite.body.senior_id}/summary`, { headers: strangerAuth });
  if (before.status !== 403) throw new Error(`unauthorized access was not denied: ${before.status} ${JSON.stringify(before.body)}`);
  const accepted = await request('/api/care/accept', { method: 'POST', headers: memberAuth, body: JSON.stringify({ code: invite.body.code }) });
  if (accepted.status !== 200) throw new Error(`invite accept failed: ${JSON.stringify(accepted.body)}`);
  const relationships = await request('/api/care/relationships', { headers: memberAuth });
  const seniorId = accepted.body.senior_id;
  const summary = await request(`/api/care/seniors/${seniorId}/summary`, { headers: memberAuth });
  if (summary.status !== 200 || summary.body.access !== 'authorized_read_only') throw new Error('authorized summary failed');
  console.log(JSON.stringify({ pass: true, unauthorized_status: before.status, accepted: true, read_only: summary.body.access, relationship_count: relationships.body.as_member?.length || 0 }));
} finally {
  for (const cookie of [seniorCookie, memberCookie, strangerCookie]) await request('/api/profile/me', { method: 'DELETE', headers: { Cookie: cookie } });
}
