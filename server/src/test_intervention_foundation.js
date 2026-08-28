import assert from 'node:assert/strict';
import db from './db.js';
import {
  INTERVENTION_REASON_CODES, canTransitionIntervention, validateExecutionLogInput, validateInterventionInput,
} from './contracts/interventionContract.js';
import { interventionRepository } from './repositories/interventionRepository.js';

const rollback = Symbol('rollback');
const stamp = Date.now();
const windows = {
  baseline_start: '2026-01-01T00:00:00.000Z', baseline_end: '2026-01-07T23:59:59.000Z',
  intervention_start: '2026-01-08T00:00:00.000Z', intervention_end: '2026-01-14T23:59:59.000Z',
  outcome_start: '2026-01-15T00:00:00.000Z', outcome_end: '2026-01-21T23:59:59.000Z',
};

assert.equal(canTransitionIntervention('proposed', 'pending_confirmation'), true);
assert.equal(canTransitionIntervention('pending_confirmation', 'active'), true);
assert.equal(canTransitionIntervention('active', 'completed'), false);
assert.equal(canTransitionIntervention('active', 'safety_stopped'), true);
assert.equal(canTransitionIntervention('evaluating', 'completed'), true);
assert.equal(canTransitionIntervention('completed', 'active'), false);
const unsafe = validateInterventionInput({ intervention_type: 'activity', title: '自行停药后散步', protocol: {}, target_metrics: ['bp'], adherence_target: { minimum_rate: 0.8 }, ...windows });
assert.equal(unsafe.ok, false);
assert.equal(unsafe.reason_code, INTERVENTION_REASON_CODES.MEDICAL_BOUNDARY);
assert.equal(validateExecutionLogInput({ performed: false, performed_at: new Date().toISOString() }).ok, false);

try {
  db.transaction(() => {
    const userId = Number(db.prepare(`INSERT INTO users (name,password,role,age,gender) VALUES (?,?,'senior',72,'female')`)
      .run(`intervention-unit-${stamp}`, 'test-only').lastInsertRowid);
    const parsed = validateInterventionInput({
      intervention_type: 'activity', title: '晚饭后步行十分钟',
      protocol: { action: '饭后在安全环境步行', frequency: 'daily' }, target_metrics: ['steps'],
      adherence_target: { minimum_rate: 0.7 }, evidence_source_ids: ['source:test'], ...windows,
    });
    assert.equal(parsed.ok, true);
    const first = interventionRepository.create({ subjectUserId: userId, actorUserId: userId, input: parsed.value, idempotencyKey: `create-${stamp}` });
    assert.equal(first.intervention.status, 'pending_confirmation');
    assert.ok(first.intervention.action_request_id);
    const replay = interventionRepository.create({ subjectUserId: userId, actorUserId: userId, input: parsed.value, idempotencyKey: `create-${stamp}` });
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.intervention.intervention_id, first.intervention.intervention_id);

    const active = interventionRepository.transition(first.intervention.intervention_id, ['pending_confirmation'], 'active', { actorUserId: userId });
    assert.equal(active.intervention.status, 'active');
    assert.ok(active.intervention.confirmed_at);
    assert.equal(db.prepare('SELECT status FROM action_requests WHERE id=?').get(first.intervention.action_request_id).status, 'executed');

    const logInput = validateExecutionLogInput({ performed: true, performed_at: '2026-01-10T10:00:00Z', user_note: '完成', data_source: 'self_report', idempotency_key: `log-${stamp}` });
    assert.equal(logInput.ok, true);
    const log = interventionRepository.appendExecutionLog(first.intervention.intervention_id, userId, logInput.value);
    assert.equal(log.log.revision, 1);
    assert.equal(interventionRepository.appendExecutionLog(first.intervention.intervention_id, userId, logInput.value).idempotentReplay, true);
    const correction = interventionRepository.appendExecutionLog(first.intervention.intervention_id, userId, {
      ...logInput.value, performed: false, skip_reason: '膝部不适', idempotency_key: `log-correction-${stamp}`,
      supersedes_execution_log_id: log.log.execution_log_id, change_reason: '更正误点的已完成状态',
    });
    assert.equal(correction.log.revision, 2);
    assert.equal(correction.log.supersedes_execution_log_id, log.log.execution_log_id);

    const availability = interventionRepository.dataAvailability(first.intervention.intervention_id);
    assert.equal(availability.ready, false);
    assert.equal(availability.target_metrics[0].baseline_count, 0);
    const insufficient = interventionRepository.transition(first.intervention.intervention_id, ['active'], 'insufficient_data', {
      actorUserId: userId, reasonCode: INTERVENTION_REASON_CODES.INSUFFICIENT_DATA, message: 'test',
    });
    assert.equal(insufficient.intervention.status, 'insufficient_data');
    throw rollback;
  })();
} catch (error) { if (error !== rollback) throw error; }

console.log('N-of-1 intervention contract, repository and audit log: PASS');
