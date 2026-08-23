import db from '../db.js';

export const FOLLOWUP_RULE_VERSION = 'agent-followup.2026-08.v1-unreviewed-default';
const ACTIVE = ['scheduled', 'due', 'overdue', 'pending_result_confirmation'];

function parseJSON(value, fallback) { try { return JSON.parse(value ?? '') ?? fallback; } catch { return fallback; } }
function nowIso() { return new Date().toISOString(); }

export function defaultFollowupDueAt(now = new Date()) {
  const due = new Date(now);
  due.setDate(due.getDate() + 1);
  due.setHours(8, 0, 0, 0);
  return due.toISOString();
}

export function normalizeDueAt(value) {
  if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return defaultFollowupDueAt();
}

export function refreshFollowupStates(userId, at = new Date()) {
  const now = at.toISOString();
  const overdue = new Date(at.getTime() - 24 * 3600 * 1000).toISOString();
  db.prepare(`UPDATE followups SET status='overdue',updated_at=? WHERE user_id=? AND status IN ('scheduled','due') AND due_at<=?`).run(now, userId, overdue);
  db.prepare(`UPDATE followups SET status='due',updated_at=? WHERE user_id=? AND status='scheduled' AND due_at<=?`).run(now, userId, now);
}

function metricLabel(type) {
  return db.prepare('SELECT name FROM metric_defs WHERE type=?').get(type)?.name || type || '健康指标';
}

function cleanMetric(row) {
  if (!row) return null;
  return { id: row.id, type: row.type, value: row.value, value2: row.value2, unit: row.unit, recorded_at: row.recorded_at, measurement_condition: row.measurement_condition || 'unknown' };
}

export function buildFollowupComparison(followup, baselineRow = null, resultRow = null) {
  const baseline = baselineRow || (followup.baseline_metric_id ? db.prepare('SELECT * FROM metrics WHERE id=? AND user_id=?').get(followup.baseline_metric_id, followup.user_id) : null);
  const result = resultRow || ((followup.result_metric_id || followup.candidate_metric_id) ? db.prepare('SELECT * FROM metrics WHERE id=? AND user_id=?').get(followup.result_metric_id || followup.candidate_metric_id, followup.user_id) : null);
  if (!result) return null;
  const def = db.prepare('SELECT normal_min,normal_max,unit FROM metric_defs WHERE type=?').get(followup.metric_type) || {};
  const comparable = !!baseline && baseline.measurement_condition !== 'unknown' && result.measurement_condition !== 'unknown'
    && baseline.measurement_condition === result.measurement_condition;
  const delta = baseline ? Number((Number(result.value) - Number(baseline.value)).toFixed(2)) : null;
  const delta2 = baseline?.value2 != null && result.value2 != null ? Number((Number(result.value2) - Number(baseline.value2)).toFixed(2)) : null;
  const outsideReference = followup.metric_type === 'bp'
    ? Number(result.value) > 140 || Number(result.value) < 90 || Number(result.value2) > 90 || Number(result.value2) < 60
    : (def.normal_min != null && Number(result.value) < Number(def.normal_min)) || (def.normal_max != null && Number(result.value) > Number(def.normal_max));
  const direction = delta == null ? 'unknown' : delta > 0 ? 'higher' : delta < 0 ? 'lower' : 'same';
  return {
    schema_version: 'agent-followup-comparison.v1', metric_type: followup.metric_type, label: metricLabel(followup.metric_type),
    baseline: cleanMetric(baseline), result: cleanMetric(result), delta, delta2, direction,
    comparable, comparison_note: !baseline ? '缺少基线测量，仅展示本次结果。' : comparable ? '测量条件一致，可作为复测对照。' : '测量条件不同，暂不宜直接比较。',
    outside_reference: outsideReference,
    action: outsideReference ? '本次读数仍在参考范围外，请结合症状按规范复测或咨询医生。' : '继续保持相同条件的规律记录。',
  };
}

function hydrate(row) {
  if (!row) return null;
  const baseline = row.baseline_metric_id ? db.prepare('SELECT * FROM metrics WHERE id=? AND user_id=?').get(row.baseline_metric_id, row.user_id) : null;
  const candidate = row.candidate_metric_id ? db.prepare('SELECT * FROM metrics WHERE id=? AND user_id=?').get(row.candidate_metric_id, row.user_id) : null;
  return { ...row, label: metricLabel(row.metric_type), baseline: cleanMetric(baseline), candidate: cleanMetric(candidate), comparison: parseJSON(row.comparison, null) || (candidate ? buildFollowupComparison(row, baseline, candidate) : null) };
}

export function listFollowups(userId, { activeOnly = false, limit = 50 } = {}) {
  refreshFollowupStates(userId);
  const where = activeOnly ? `AND status IN (${ACTIVE.map(() => '?').join(',')})` : '';
  const args = activeOnly ? [userId, ...ACTIVE, limit] : [userId, limit];
  return db.prepare(`SELECT * FROM followups WHERE user_id=? ${where} ORDER BY due_at ASC,id DESC LIMIT ?`).all(...args).map(hydrate);
}

export function createFollowupForAction(request, payload, todoId) {
  const metricType = String(payload.metric_type || '').slice(0, 40) || null;
  if (!metricType || !db.prepare('SELECT type FROM metric_defs WHERE type=?').get(metricType)) throw Object.assign(new Error('metric_type is required for recheck'), { code: 'INVALID_METRIC' });
  let baselineId = payload.baseline_metric_id == null ? null : Number(payload.baseline_metric_id);
  if (baselineId && !db.prepare('SELECT id FROM metrics WHERE id=? AND user_id=? AND type=?').get(baselineId, request.subject_user_id, metricType)) throw Object.assign(new Error('baseline metric not found'), { code: 'INVALID_BASELINE' });
  if (!baselineId) baselineId = db.prepare('SELECT id FROM metrics WHERE user_id=? AND type=? ORDER BY recorded_at DESC,id DESC LIMIT 1').get(request.subject_user_id, metricType)?.id || null;
  const due = normalizeDueAt(payload.due_at);
  const inserted = db.prepare(`INSERT INTO followups
    (user_id,actor_user_id,action_request_id,metric_type,due_at,suggested_due_at,status,baseline_metric_id,todo_id,rule_version,updated_at)
    VALUES (?,?,?,?,?,?,'scheduled',?,?,?,?)`).run(request.subject_user_id, request.actor_user_id, request.id, metricType, due, due, baselineId, todoId, FOLLOWUP_RULE_VERSION, nowIso());
  return hydrate(db.prepare('SELECT * FROM followups WHERE id=?').get(inserted.lastInsertRowid));
}

export function matchMeasurementToFollowup(userId, metricRow) {
  if (!metricRow?.id || !metricRow?.type) return null;
  refreshFollowupStates(userId);
  const candidates = db.prepare(`SELECT * FROM followups WHERE user_id=? AND metric_type=?
    AND status IN ('scheduled','due','overdue')
    ORDER BY CASE status WHEN 'overdue' THEN 0 WHEN 'due' THEN 1 ELSE 2 END,due_at ASC,id ASC`).all(userId, metricRow.type);
  const followup = candidates.find(row => {
    const baseline = row.baseline_metric_id ? db.prepare('SELECT recorded_at FROM metrics WHERE id=? AND user_id=?').get(row.baseline_metric_id, userId) : null;
    const boundary = baseline?.recorded_at ? new Date(baseline.recorded_at) : new Date(String(row.created_at).replace(' ', 'T'));
    return new Date(metricRow.recorded_at) >= boundary
      && !parseJSON(row.candidate_rejected_ids, []).map(Number).includes(Number(metricRow.id))
      && Number(row.baseline_metric_id || 0) !== Number(metricRow.id);
  });
  if (!followup) return null;
  const comparison = buildFollowupComparison(followup, null, metricRow);
  db.prepare(`UPDATE followups SET status='pending_result_confirmation',candidate_metric_id=?,comparison=?,updated_at=? WHERE id=?`)
    .run(metricRow.id, JSON.stringify(comparison), nowIso(), followup.id);
  return hydrate(db.prepare('SELECT * FROM followups WHERE id=?').get(followup.id));
}

export function rescheduleFollowup(id, userId, actorId, dueAt) {
  const due = normalizeDueAt(dueAt);
  const changed = db.prepare(`UPDATE followups SET due_at=?,suggested_due_at=?,status='scheduled',updated_at=? WHERE id=? AND user_id=? AND status IN ('scheduled','due','overdue')`).run(due, due, nowIso(), id, userId);
  return changed.changes ? hydrate(db.prepare('SELECT * FROM followups WHERE id=?').get(id)) : null;
}

export function cancelFollowup(id, userId) {
  const changed = db.prepare(`UPDATE followups SET status='cancelled',updated_at=? WHERE id=? AND user_id=? AND status NOT IN ('completed','cancelled')`).run(nowIso(), id, userId);
  return changed.changes ? hydrate(db.prepare('SELECT * FROM followups WHERE id=?').get(id)) : null;
}

export function rejectFollowupCandidate(id, userId, candidateId) {
  const row = db.prepare('SELECT * FROM followups WHERE id=? AND user_id=?').get(id, userId);
  if (!row || row.status !== 'pending_result_confirmation' || Number(row.candidate_metric_id) !== Number(candidateId)) return null;
  const rejected = [...new Set([...parseJSON(row.candidate_rejected_ids, []), Number(candidateId)])];
  const overdueBoundary = new Date(Date.now() - 24 * 3600 * 1000);
  const next = new Date(row.due_at) <= overdueBoundary ? 'overdue' : new Date(row.due_at) <= new Date() ? 'due' : 'scheduled';
  db.prepare('UPDATE followups SET status=?,candidate_metric_id=NULL,candidate_rejected_ids=?,comparison=NULL,updated_at=? WHERE id=?').run(next, JSON.stringify(rejected), nowIso(), id);
  return hydrate(db.prepare('SELECT * FROM followups WHERE id=?').get(id));
}

export function confirmFollowupCandidate(id, userId, actorId, candidateId) {
  const row = db.prepare('SELECT * FROM followups WHERE id=? AND user_id=?').get(id, userId);
  if (!row) return null;
  if (row.status === 'completed' && Number(row.result_metric_id) === Number(candidateId)) return hydrate(row);
  if (row.status !== 'pending_result_confirmation' || Number(row.candidate_metric_id) !== Number(candidateId)) return null;
  const metric = db.prepare('SELECT * FROM metrics WHERE id=? AND user_id=? AND type=?').get(candidateId, userId, row.metric_type);
  if (!metric) return null;
  const comparison = buildFollowupComparison(row, null, metric);
  db.prepare(`UPDATE followups SET status='completed',result_metric_id=?,comparison=?,confirmed_by=?,completed_at=?,updated_at=? WHERE id=?`)
    .run(candidateId, JSON.stringify(comparison), actorId, nowIso(), nowIso(), id);
  if (row.todo_id) db.prepare(`UPDATE todos SET completed=1,completed_at=? WHERE id=? AND user_id=?`).run(nowIso(), row.todo_id, userId);
  return hydrate(db.prepare('SELECT * FROM followups WHERE id=?').get(id));
}
