import crypto from 'node:crypto';
import db from '../db.js';
import { INTERVENTION_SCHEMA_VERSION } from '../contracts/interventionContract.js';

function parseJSON(value, fallback) { try { return JSON.parse(value ?? '') ?? fallback; } catch { return fallback; } }
function nowIso() { return new Date().toISOString(); }

function hydrateLog(row) {
  if (!row) return null;
  return { ...row, performed: Boolean(row.performed) };
}

function hydrate(row, { includeLogs = false } = {}) {
  if (!row) return null;
  const item = {
    ...row,
    protocol: parseJSON(row.protocol, {}), target_metrics: parseJSON(row.target_metrics, []),
    adherence_target: parseJSON(row.adherence_target, {}), evidence_source_ids: parseJSON(row.evidence_source_ids, []),
  };
  if (includeLogs) item.execution_logs = db.prepare(`SELECT l.*,p.execution_log_id AS supersedes_execution_log_id
    FROM intervention_execution_logs l LEFT JOIN intervention_execution_logs p ON p.id=l.supersedes_log_id
    WHERE l.intervention_db_id=? ORDER BY l.performed_at DESC,l.id DESC`).all(row.id).map(hydrateLog);
  return item;
}

function publicId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }

export const interventionRepository = {
  findByPublicId(interventionId, options = {}) {
    return hydrate(db.prepare('SELECT * FROM interventions WHERE intervention_id=?').get(interventionId), options);
  },

  findByActorIdempotency(actorUserId, idempotencyKey) {
    if (!idempotencyKey) return null;
    return hydrate(db.prepare('SELECT * FROM interventions WHERE actor_user_id=? AND idempotency_key=?').get(actorUserId, idempotencyKey), { includeLogs: true });
  },

  listForSubject(subjectUserId, { status = null, limit = 50 } = {}) {
    const capped = Math.max(1, Math.min(100, Number(limit) || 50));
    const rows = status
      ? db.prepare('SELECT * FROM interventions WHERE subject_user_id=? AND status=? ORDER BY created_at DESC,id DESC LIMIT ?').all(subjectUserId, status, capped)
      : db.prepare('SELECT * FROM interventions WHERE subject_user_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(subjectUserId, capped);
    return rows.map(row => hydrate(row));
  },

  listPendingEvaluation(subjectUserId, at = nowIso()) {
    return db.prepare(`SELECT * FROM interventions WHERE subject_user_id=?
      AND (status='evaluating' OR (status='active' AND outcome_end<=?))
      ORDER BY intervention_end ASC,id ASC`).all(subjectUserId, at).map(row => hydrate(row));
  },

  create({ subjectUserId, actorUserId, input, idempotencyKey = null }) {
    return db.transaction(() => {
      const existing = idempotencyKey ? this.findByActorIdempotency(actorUserId, idempotencyKey) : null;
      if (existing) return { intervention: existing, idempotentReplay: true };
      const interventionId = publicId('intv');
      const initialStatus = input.draft ? 'proposed' : 'pending_confirmation';
      const action = db.prepare(`INSERT INTO action_requests
        (user_id,actor_user_id,subject_user_id,action_type,payload,status,idempotency_key)
        VALUES (?,?,?,?,?,?,?)`).run(subjectUserId, actorUserId, subjectUserId, 'n_of_1_intervention',
          JSON.stringify({ intervention_id: interventionId, title: input.title, intervention_type: input.intervention_type }),
          initialStatus, idempotencyKey ? `intervention:${idempotencyKey}` : null);
      const inserted = db.prepare(`INSERT INTO interventions
        (intervention_id,user_id,subject_user_id,actor_user_id,action_request_id,followup_id,intervention_type,title,protocol,target_metrics,
         baseline_start,baseline_end,intervention_start,intervention_end,outcome_start,outcome_end,adherence_target,status,
         evidence_source_ids,idempotency_key,schema_version,rule_version,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          interventionId, subjectUserId, subjectUserId, actorUserId, action.lastInsertRowid, input.followup_id,
          input.intervention_type, input.title, JSON.stringify(input.protocol), JSON.stringify(input.target_metrics),
          input.baseline_start, input.baseline_end, input.intervention_start, input.intervention_end,
          input.outcome_start, input.outcome_end, JSON.stringify(input.adherence_target), initialStatus,
          JSON.stringify(input.evidence_source_ids), idempotencyKey, INTERVENTION_SCHEMA_VERSION, input.rule_version, nowIso(),
        );
      return { intervention: hydrate(db.prepare('SELECT * FROM interventions WHERE id=?').get(inserted.lastInsertRowid)), idempotentReplay: false };
    })();
  },

  transition(interventionId, fromStatuses, toStatus, { actorUserId, reasonCode = null, message = null } = {}) {
    return db.transaction(() => {
      const row = db.prepare('SELECT * FROM interventions WHERE intervention_id=?').get(interventionId);
      if (!row) return null;
      if (row.status === toStatus) return { intervention: hydrate(row, { includeLogs: true }), idempotentReplay: true };
      if (!fromStatuses.includes(row.status)) return { intervention: hydrate(row), invalidTransition: true };
      const now = nowIso();
      const confirmedAt = toStatus === 'active' ? now : row.confirmed_at;
      const completedAt = ['completed','insufficient_data','safety_stopped'].includes(toStatus) ? now : row.completed_at;
      const cancelledAt = toStatus === 'cancelled' ? now : row.cancelled_at;
      db.prepare(`UPDATE interventions SET status=?,status_reason_code=?,status_message=?,confirmed_at=?,completed_at=?,cancelled_at=?,
        updated_at=?,revision=revision+1 WHERE id=?`).run(toStatus, reasonCode, message, confirmedAt, completedAt, cancelledAt, now, row.id);
      if (row.action_request_id) {
        if (toStatus === 'pending_confirmation') db.prepare(`UPDATE action_requests SET status='pending_confirmation' WHERE id=?`).run(row.action_request_id);
        else if (toStatus === 'active') db.prepare(`UPDATE action_requests SET status='executed',confirmed_at=?,executed_at=? WHERE id=?`).run(now, now, row.action_request_id);
        else if (toStatus === 'cancelled') db.prepare(`UPDATE action_requests SET status='cancelled' WHERE id=?`).run(row.action_request_id);
      }
      return { intervention: hydrate(db.prepare('SELECT * FROM interventions WHERE id=?').get(row.id), { includeLogs: true }), idempotentReplay: false, actorUserId };
    })();
  },

  appendExecutionLog(interventionId, actorUserId, input) {
    return db.transaction(() => {
      const intervention = db.prepare('SELECT * FROM interventions WHERE intervention_id=?').get(interventionId);
      if (!intervention) return null;
      if (input.idempotency_key) {
        const existing = db.prepare(`SELECT l.*,p.execution_log_id AS supersedes_execution_log_id
          FROM intervention_execution_logs l LEFT JOIN intervention_execution_logs p ON p.id=l.supersedes_log_id
          WHERE l.intervention_db_id=? AND l.actor_user_id=? AND l.idempotency_key=?`).get(intervention.id, actorUserId, input.idempotency_key);
        if (existing) return { log: hydrateLog(existing), idempotentReplay: true };
      }
      let supersedes = null; let revision = 1;
      if (input.supersedes_execution_log_id) {
        supersedes = db.prepare(`SELECT * FROM intervention_execution_logs WHERE execution_log_id=? AND intervention_db_id=?`)
          .get(input.supersedes_execution_log_id, intervention.id);
        if (!supersedes) return { invalidSupersededLog: true };
        if (!input.change_reason) return { changeReasonRequired: true };
        revision = Number(supersedes.revision || 1) + 1;
      }
      const executionLogId = publicId('iexec');
      const inserted = db.prepare(`INSERT INTO intervention_execution_logs
        (execution_log_id,intervention_db_id,actor_user_id,performed,performed_at,user_note,skip_reason,data_source,idempotency_key,
         supersedes_log_id,revision,change_reason)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(executionLogId, intervention.id, actorUserId, input.performed ? 1 : 0,
          input.performed_at, input.user_note, input.skip_reason, input.data_source, input.idempotency_key,
          supersedes?.id || null, revision, input.change_reason);
      db.prepare('UPDATE interventions SET updated_at=?,revision=revision+1 WHERE id=?').run(nowIso(), intervention.id);
      return { log: hydrateLog(db.prepare(`SELECT l.*,p.execution_log_id AS supersedes_execution_log_id
        FROM intervention_execution_logs l LEFT JOIN intervention_execution_logs p ON p.id=l.supersedes_log_id WHERE l.id=?`).get(inserted.lastInsertRowid)), idempotentReplay: false };
    })();
  },

  dataAvailability(interventionId) {
    const row = db.prepare('SELECT * FROM interventions WHERE intervention_id=?').get(interventionId);
    if (!row) return null;
    const metrics = parseJSON(row.target_metrics, []);
    const counts = metrics.map(type => ({
      type,
      baseline_count: db.prepare('SELECT COUNT(*) count FROM metrics WHERE user_id=? AND type=? AND recorded_at BETWEEN ? AND ?')
        .get(row.subject_user_id, type, row.baseline_start, row.baseline_end).count,
      outcome_count: db.prepare('SELECT COUNT(*) count FROM metrics WHERE user_id=? AND type=? AND recorded_at BETWEEN ? AND ?')
        .get(row.subject_user_id, type, row.outcome_start, row.outcome_end).count,
    }));
    const ready = counts.length > 0 && counts.every(item => item.baseline_count > 0 && item.outcome_count > 0);
    return { ready, target_metrics: counts, rule: 'each_target_requires_at_least_one_baseline_and_one_outcome_measurement' };
  },

  saveEvaluation(interventionId, targetMetric, result) {
    const intervention = db.prepare('SELECT id,subject_user_id FROM interventions WHERE intervention_id=?').get(interventionId);
    if (!intervention) return null;
    const evaluationId = publicId('ieval');
    const inserted = db.prepare(`INSERT INTO intervention_evaluations
      (evaluation_id,intervention_db_id,subject_user_id,target_metric,schema_version,algorithm_version,input_fingerprint,
       evidence_level,reason_code,result) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      evaluationId, intervention.id, intervention.subject_user_id, targetMetric, result.schema_version,
      result.algorithm_version, result.input_fingerprint || null, result.evidence_level, result.reason_code,
      JSON.stringify(result),
    );
    return this.findEvaluationById(inserted.lastInsertRowid);
  },

  findEvaluationById(id) {
    const row = db.prepare('SELECT * FROM intervention_evaluations WHERE id=?').get(id);
    return row ? { ...row, result: parseJSON(row.result, {}) } : null;
  },

  listEvaluations(interventionId) {
    return db.prepare(`SELECT e.* FROM intervention_evaluations e JOIN interventions i ON i.id=e.intervention_db_id
      WHERE i.intervention_id=? ORDER BY e.created_at DESC,e.id DESC`).all(interventionId)
      .map(row => ({ ...row, result: parseJSON(row.result, {}) }));
  },
};
