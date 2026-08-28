// 照护协同集成测试：角色绑定、范围分离、URL 越权、到期/撤权即时失效与审计。
import Database from 'better-sqlite3';

const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
const stamp = Date.now();
const names = { senior: `授权老人${stamp}`, other: `其他老人${stamp}`, caregiver: `授权家属${stamp}`, doctor: `授权医生${stamp}`, stranger: `未授权家属${stamp}` };
const db = new Database(process.env.DB_PATH);

async function request(path, options = {}) {
  const res = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body, headers: res.headers };
}
async function register(name, role = 'senior') {
  const response = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, role, age: 76, gender: 'female', password: '123456' }) });
  if (response.status !== 201) throw new Error(`register ${name} failed: ${JSON.stringify(response.body)}`);
  return { cookie: (response.headers.get('set-cookie') || '').split(';')[0], id: response.body.user.id };
}
const senior = await register(names.senior, 'senior');
const other = await register(names.other, 'senior');
const caregiver = await register(names.caregiver, 'caregiver');
const doctor = await register(names.doctor, 'caregiver');
const stranger = await register(names.stranger, 'caregiver');
db.prepare("UPDATE users SET role='doctor' WHERE id=?").run(doctor.id);
const auth = account => ({ Cookie: account.cookie });

function expectStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`);
}

try {
  const caregiverInvite = await request('/api/care/invitations', { method: 'POST', headers: auth(senior), body: JSON.stringify({ member_role: 'caregiver', scopes: ['view_summary'], valid_days: 30 }) });
  expectStatus(caregiverInvite, 201, 'caregiver invite');
  const doctorInvite = await request('/api/care/invitations', { method: 'POST', headers: auth(senior), body: JSON.stringify({ member_role: 'doctor', scopes: ['view_summary', 'view_trends', 'view_clinical_evidence', 'review_graphrag', 'review_interventions'], valid_days: 30 }) });
  expectStatus(doctorInvite, 201, 'doctor invite');

  const roleTamper = await request('/api/care/accept', { method: 'POST', headers: auth(caregiver), body: JSON.stringify({ code: doctorInvite.body.code, member_role: 'caregiver' }) });
  expectStatus(roleTamper, 403, 'invitation role tampering');
  const acceptedCaregiver = await request('/api/care/accept', { method: 'POST', headers: auth(caregiver), body: JSON.stringify({ code: caregiverInvite.body.code, member_role: 'doctor', scopes: ['view_trends'] }) });
  expectStatus(acceptedCaregiver, 200, 'caregiver accept');
  if (acceptedCaregiver.body.relationship.scopes.join(',') !== 'view_summary') throw new Error('accepting client expanded invitation scopes');
  const acceptedDoctor = await request('/api/care/accept', { method: 'POST', headers: auth(doctor), body: JSON.stringify({ code: doctorInvite.body.code }) });
  expectStatus(acceptedDoctor, 200, 'doctor accept');

  expectStatus(await request(`/api/care/seniors/${senior.id}/summary`, { headers: auth(stranger) }), 403, 'unrelated user read');
  expectStatus(await request(`/api/care/seniors/${other.id}/summary`, { headers: auth(caregiver) }), 403, 'subject id URL escalation');
  const summary = await request(`/api/care/seniors/${senior.id}/summary`, { headers: auth(caregiver) });
  expectStatus(summary, 200, 'scoped summary');
  if ('severe_alerts' in summary.body || 'active_interventions' in summary.body) throw new Error('summary leaked fields outside scope');
  expectStatus(await request('/api/prediction/intakes', { method: 'POST', headers: auth(caregiver), body: JSON.stringify({ subject_user_id: senior.id, answers: { self_rated_health: 4 } }) }), 403, 'view scope must not imply intake write');
  expectStatus(await request(`/api/prediction/overview/list?subject_user_id=${senior.id}`, { headers: auth(caregiver) }), 403, 'summary view must not imply trend view');

  const relationships = await request('/api/care/relationships', { headers: auth(senior) });
  const caregiverRelation = relationships.body.as_senior.find(row => row.member_id === caregiver.id);
  const updated = await request(`/api/care/relationships/${caregiverRelation.id}`, { method: 'PATCH', headers: auth(senior), body: JSON.stringify({ scopes: ['view_summary', 'record_intake'], expires_at: caregiverRelation.expires_at }) });
  expectStatus(updated, 200, 'scope update');
  const caregiverWrite = await request('/api/prediction/intakes', { method: 'POST', headers: auth(caregiver), body: JSON.stringify({ subject_user_id: senior.id, answers: { self_rated_health: 4, fall_recent: 0 } }) });
  expectStatus(caregiverWrite, 201, 'separately granted intake write');
  if (caregiverWrite.body.respondent_role !== 'caregiver') throw new Error('proxy intake actor role was not retained');
  expectStatus(await request('/api/prediction/intakes', { method: 'POST', headers: auth(caregiver), body: JSON.stringify({ subject_user_id: other.id, answers: { self_rated_health: 5 } }) }), 403, 'subject id intake escalation');

  expectStatus(await request(`/api/prediction/overview/list?subject_user_id=${senior.id}`, { headers: auth(doctor) }), 200, 'authorized doctor trend');
  expectStatus(await request(`/api/care/seniors/${senior.id}/clinical-evidence`, { headers: auth(doctor) }), 200, 'authorized doctor evidence');
  expectStatus(await request(`/api/care/seniors/${senior.id}/graphrag/reviews`, { headers: auth(doctor) }), 200, 'authorized doctor GraphRAG review queue');
  expectStatus(await request('/api/prediction/intakes', { method: 'POST', headers: auth(doctor), body: JSON.stringify({ subject_user_id: senior.id, answers: { self_rated_health: 2 } }) }), 403, 'doctor read/review does not imply intake');

  const revoke = await request(`/api/care/relationships/${caregiverRelation.id}/revoke`, { method: 'POST', headers: auth(senior), body: JSON.stringify({ reason: '权限集成测试撤回' }) });
  expectStatus(revoke, 200, 'revoke');
  expectStatus(await request(`/api/care/seniors/${senior.id}/summary`, { headers: auth(caregiver) }), 403, 'revoked old session read');
  expectStatus(await request('/api/prediction/intakes', { method: 'POST', headers: auth(caregiver), body: JSON.stringify({ subject_user_id: senior.id, answers: { self_rated_health: 3 } }) }), 403, 'revoked old session write');
  const subjectsAfterRevoke = await request('/api/care/subjects', { headers: auth(caregiver) });
  if (subjectsAfterRevoke.body.items.some(item => item.senior.id === senior.id)) throw new Error('revoked subject remained in old session dashboard');

  const doctorRelationId = acceptedDoctor.body.relationship.id;
  db.prepare("UPDATE care_relationships SET expires_at=datetime('now','-1 minute') WHERE id=?").run(doctorRelationId);
  expectStatus(await request(`/api/prediction/overview/list?subject_user_id=${senior.id}`, { headers: auth(doctor) }), 403, 'expired authorization');

  const logs = await request(`/api/care/relationships/${caregiverRelation.id}/logs`, { headers: auth(senior) });
  expectStatus(logs, 200, 'audit log view');
  if (!logs.body.items.some(row => row.outcome === 'denied') || !logs.body.items.some(row => row.action === 'authorization_revoked')) throw new Error('audit log missing denied access or revoke lifecycle');
  const saved = db.prepare('SELECT last_access_at,status,revoked_at,revision FROM care_relationships WHERE id=?').get(caregiverRelation.id);
  if (!saved.last_access_at || saved.status !== 'revoked' || !saved.revoked_at || saved.revision < 3) throw new Error('authorization lifecycle fields incomplete');

  console.log(JSON.stringify({ pass: true, role_binding: true, scopes_separated: true, url_escalation_denied: true, revoked_session_denied: true, expiry_denied: true, audit_verified: true }));
} finally {
  db.close();
  for (const account of [stranger, doctor, caregiver, other, senior]) await request('/api/profile/me', { method: 'DELETE', headers: auth(account) });
}
