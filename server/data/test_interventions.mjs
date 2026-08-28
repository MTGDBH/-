import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const database = new Database(process.env.DB_PATH);
const stamp = Date.now();

async function request(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: response.status, body, cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
}

async function register(label, role = 'senior') {
  const result = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: `${label}-${stamp}`, password: 'Test-123456', age: 70, gender: 'female', role: role === 'caregiver' ? 'caregiver' : 'senior' }) });
  assert.equal(result.status, 201);
  if (role !== result.body.user.role) database.prepare('UPDATE users SET role=? WHERE id=?').run(role, result.body.user.id);
  return { id: result.body.user.id, cookie: result.cookie, headers: { Cookie: result.cookie } };
}

const senior = await register('干预老人');
const caregiver = await register('干预家属', 'caregiver');
const doctor = await register('干预医生', 'doctor');
const admin = await register('干预管理员', 'admin');
const stranger = await register('干预陌生人', 'caregiver');
database.prepare(`INSERT INTO care_relationships (senior_id,member_id,member_role,status) VALUES (?,?,?,'active')`).run(senior.id, caregiver.id, 'caregiver');
database.prepare(`INSERT INTO care_relationships (senior_id,member_id,member_role,status) VALUES (?,?,?,'active')`).run(senior.id, doctor.id, 'doctor');

const windows = {
  baseline_start: '2026-01-01T00:00:00.000Z', baseline_end: '2026-01-07T23:59:59.000Z',
  intervention_start: '2026-01-08T00:00:00.000Z', intervention_end: '2026-01-14T23:59:59.000Z',
  outcome_start: '2026-01-15T00:00:00.000Z', outcome_end: '2026-01-21T23:59:59.000Z',
};
const proposal = {
  subject_user_id: senior.id, intervention_type: 'activity', title: '每天晚饭后步行十分钟',
  protocol: { action: '在平坦且照明良好的环境步行', frequency: 'daily', safety: '不适时停止并求助' },
  target_metrics: ['steps'], adherence_target: { minimum_rate: 0.7 }, evidence_source_ids: ['guideline:test'],
  idempotency_key: `create-${stamp}`, ...windows,
};

try {
  const unsafe = await request('/api/actions/interventions', { method: 'POST', headers: senior.headers,
    body: JSON.stringify({ ...proposal, idempotency_key: `unsafe-${stamp}`, title: '自行减药并散步' }) });
  assert.equal(unsafe.status, 400);
  assert.equal(unsafe.body.reason_code, 'INTERVENTION_MEDICAL_BOUNDARY_VIOLATION');

  const created = await request('/api/actions/interventions', { method: 'POST', headers: senior.headers, body: JSON.stringify(proposal) });
  assert.equal(created.status, 201);
  assert.equal(created.body.intervention.status, 'pending_confirmation');
  const interventionId = created.body.intervention.intervention_id;
  const legacyConfirm = await request(`/api/actions/${created.body.intervention.action_request_id}/confirm`, { method: 'POST', headers: senior.headers, body: '{}' });
  assert.equal(legacyConfirm.status, 409);
  assert.equal(legacyConfirm.body.reason_code, 'INTERVENTION_CONFIRM_VIA_DEDICATED_API');
  const replay = await request('/api/actions/interventions', { method: 'POST', headers: senior.headers, body: JSON.stringify(proposal) });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent_replay, true);
  assert.equal(replay.body.intervention.intervention_id, interventionId);

  const preConfirmLog = await request(`/api/actions/interventions/${interventionId}/executions`, { method: 'POST', headers: senior.headers,
    body: JSON.stringify({ performed: true, performed_at: '2026-01-09T10:00:00Z', data_source: 'self_report' }) });
  assert.equal(preConfirmLog.status, 409);
  assert.equal(preConfirmLog.body.reason_code, 'INTERVENTION_CONFIRMATION_REQUIRED');

  assert.equal((await request(`/api/actions/interventions?subject_user_id=${senior.id}`, { headers: caregiver.headers })).status, 200);
  assert.equal((await request(`/api/actions/interventions?subject_user_id=${senior.id}`, { headers: doctor.headers })).status, 200);
  const strangerRead = await request(`/api/actions/interventions?subject_user_id=${senior.id}`, { headers: stranger.headers });
  assert.equal(strangerRead.status, 403);
  assert.equal(strangerRead.body.reason_code, 'INTERVENTION_FORBIDDEN');
  const adminRead = await request(`/api/actions/interventions?subject_user_id=${senior.id}`, { headers: admin.headers });
  assert.equal(adminRead.status, 403);
  const caregiverConfirm = await request(`/api/actions/interventions/${interventionId}/confirm`, { method: 'POST', headers: caregiver.headers, body: '{}' });
  assert.equal(caregiverConfirm.status, 403);
  const doctorLog = await request(`/api/actions/interventions/${interventionId}/executions`, { method: 'POST', headers: doctor.headers,
    body: JSON.stringify({ performed: true, performed_at: '2026-01-09T10:00:00Z', data_source: 'self_report' }) });
  assert.equal(doctorLog.status, 403);

  const confirmed = await request(`/api/actions/interventions/${interventionId}/confirm`, { method: 'POST', headers: senior.headers, body: '{}' });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.intervention.status, 'active');
  const caregiverLogBody = { performed: false, performed_at: '2026-01-09T10:00:00Z', skip_reason: '下雨路滑', data_source: 'caregiver_report', idempotency_key: `care-log-${stamp}` };
  const caregiverLog = await request(`/api/actions/interventions/${interventionId}/executions`, { method: 'POST', headers: caregiver.headers, body: JSON.stringify(caregiverLogBody) });
  assert.equal(caregiverLog.status, 201);
  const caregiverLogReplay = await request(`/api/actions/interventions/${interventionId}/executions`, { method: 'POST', headers: caregiver.headers, body: JSON.stringify(caregiverLogBody) });
  assert.equal(caregiverLogReplay.status, 200);
  assert.equal(caregiverLogReplay.body.idempotent_replay, true);

  const pendingEvaluation = await request(`/api/actions/interventions/pending-evaluation?subject_user_id=${senior.id}`, { headers: senior.headers });
  assert.equal(pendingEvaluation.status, 200);
  assert.ok(pendingEvaluation.body.items.some(item => item.intervention_id === interventionId));
  const ended = await request(`/api/actions/interventions/${interventionId}/end`, { method: 'POST', headers: senior.headers, body: '{}' });
  assert.equal(ended.status, 200);
  assert.equal(ended.body.reason_code, 'INTERVENTION_INSUFFICIENT_DATA');
  assert.equal(ended.body.intervention.status, 'insufficient_data');

  const second = await request('/api/actions/interventions', { method: 'POST', headers: senior.headers,
    body: JSON.stringify({ ...proposal, idempotency_key: `cancel-${stamp}`, title: '每日固定时间测量血压', intervention_type: 'measurement_routine', target_metrics: ['bp'] }) });
  const secondId = second.body.intervention.intervention_id;
  assert.equal((await request(`/api/actions/interventions/${secondId}/confirm`, { method: 'POST', headers: senior.headers, body: '{}' })).body.intervention.status, 'active');
  const cancelled = await request(`/api/actions/interventions/${secondId}/cancel`, { method: 'POST', headers: senior.headers, body: JSON.stringify({ reason: '个人安排变化' }) });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.intervention.status, 'cancelled');
  const cancelReplay = await request(`/api/actions/interventions/${secondId}/cancel`, { method: 'POST', headers: senior.headers, body: JSON.stringify({ reason: '个人安排变化' }) });
  assert.equal(cancelReplay.status, 200);
  assert.equal(cancelReplay.body.idempotent_replay, true);

  for (const metric of [
    { type: 'hr', value: 78, recorded_at: '2026-01-03T08:00:00Z', measurement_condition: 'resting' },
    { type: 'hr', value: 74, recorded_at: '2026-01-18T08:00:00Z', measurement_condition: 'resting' },
  ]) {
    assert.equal((await request('/api/health/metrics', { method: 'POST', headers: senior.headers, body: JSON.stringify(metric) })).status, 200);
  }
  const evaluable = await request('/api/actions/interventions', { method: 'POST', headers: senior.headers,
    body: JSON.stringify({ ...proposal, idempotency_key: `complete-${stamp}`, title: '固定时间进行呼吸放松', intervention_type: 'stress_management', target_metrics: ['hr'] }) });
  const evaluableId = evaluable.body.intervention.intervention_id;
  assert.equal((await request(`/api/actions/interventions/${evaluableId}/confirm`, { method: 'POST', headers: senior.headers, body: '{}' })).body.intervention.status, 'active');
  const evaluating = await request(`/api/actions/interventions/${evaluableId}/end`, { method: 'POST', headers: senior.headers, body: '{}' });
  assert.equal(evaluating.status, 200);
  assert.equal(evaluating.body.intervention.status, 'evaluating');
  const completed = await request(`/api/actions/interventions/${evaluableId}/complete`, { method: 'POST', headers: senior.headers, body: JSON.stringify({ evaluation_note: '仅完成人工数据核对，不生成算法效果结论' }) });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.intervention.status, 'completed');

  const draft = await request('/api/actions/interventions', { method: 'POST', headers: senior.headers,
    body: JSON.stringify({ ...proposal, draft: true, idempotency_key: `draft-${stamp}`, title: '睡前保持固定放松流程', intervention_type: 'sleep_hygiene', target_metrics: ['sleep'] }) });
  const draftId = draft.body.intervention.intervention_id;
  assert.equal(draft.body.intervention.status, 'proposed');
  assert.equal((await request(`/api/actions/interventions/${draftId}/submit`, { method: 'POST', headers: senior.headers, body: '{}' })).body.intervention.status, 'pending_confirmation');
  assert.equal((await request(`/api/actions/interventions/${draftId}/confirm`, { method: 'POST', headers: senior.headers, body: '{}' })).body.intervention.status, 'active');
  const safetyStopped = await request(`/api/actions/interventions/${draftId}/end`, { method: 'POST', headers: senior.headers, body: JSON.stringify({ safety_stop: true, reason: '出现不适，停止并联系医生' }) });
  assert.equal(safetyStopped.status, 200);
  assert.equal(safetyStopped.body.intervention.status, 'safety_stopped');

  const rejected = await request('/api/actions/interventions', { method: 'POST', headers: senior.headers,
    body: JSON.stringify({ ...proposal, idempotency_key: `reject-${stamp}`, title: '每日记录睡眠时间', intervention_type: 'measurement_routine', target_metrics: ['sleep'] }) });
  const rejectedResult = await request(`/api/actions/interventions/${rejected.body.intervention.intervention_id}/reject`, { method: 'POST', headers: senior.headers, body: JSON.stringify({ reason: '本人暂不参加' }) });
  assert.equal(rejectedResult.status, 200);
  assert.equal(rejectedResult.body.intervention.status, 'cancelled');
  assert.equal(rejectedResult.body.intervention.status_reason_code, 'INTERVENTION_USER_REJECTED');

  console.log(JSON.stringify({ pass: true, creation_idempotency: true, confirmation_gate: true, caregiver_record_only: true,
    doctor_read_only: true, admin_privacy_default: true, unauthorized_denied: true, cancellation: true, insufficient_data: true,
    evaluation_completion: true, draft_submission: true, rejection: true, safety_stop: true, medical_boundary: true }));
} finally {
  for (const account of [senior, caregiver, doctor, admin, stranger]) {
    await request('/api/profile/me', { method: 'DELETE', headers: account.headers, body: '{}' });
  }
  database.close();
}
