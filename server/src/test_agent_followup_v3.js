import assert from 'node:assert/strict';
import db from './db.js';
import { buildFollowupComparison, confirmFollowupCandidate, createFollowupForAction, matchMeasurementToFollowup, refreshFollowupStates, rejectFollowupCandidate } from './lib/followups.js';

const rollback = Symbol('rollback');
try {
  db.transaction(() => {
    const userId = 1, actorId = 1;
    const baselineInsert = db.prepare(`INSERT INTO metrics (user_id,type,value,value2,unit,recorded_at,source,measurement_condition) VALUES (?,?,?,?,?,?,?,?)`)
      .run(userId, 'bp', 146, 94, 'mmHg', new Date(Date.now() - 3600000).toISOString(), 'manual', 'morning_rest');
    const actionInsert = db.prepare(`INSERT INTO action_requests (user_id,actor_user_id,subject_user_id,action_type,payload,status,idempotency_key) VALUES (?,?,?,?,?,'pending_confirmation',?)`)
      .run(userId, actorId, userId, 'schedule_recheck', '{}', `v3-test-${Date.now()}`);
    const request = db.prepare('SELECT * FROM action_requests WHERE id=?').get(actionInsert.lastInsertRowid);
    const todo = db.prepare(`INSERT INTO todos (user_id,title,time,kind,date) VALUES (?,?,?,?,?)`).run(userId, '复测血压', '08:00', 'recheck', '2026-08-24');
    const followup = createFollowupForAction(request, { metric_type: 'bp', baseline_metric_id: Number(baselineInsert.lastInsertRowid), due_at: new Date(Date.now() + 3600000).toISOString() }, Number(todo.lastInsertRowid));
    assert.equal(followup.status, 'scheduled');
    assert.equal(followup.metric_type, 'bp');

    const candidateInsert = db.prepare(`INSERT INTO metrics (user_id,type,value,value2,unit,recorded_at,source,measurement_condition) VALUES (?,?,?,?,?,?,?,?)`)
      .run(userId, 'bp', 139, 88, 'mmHg', new Date(Date.now() + 1000).toISOString(), 'manual', 'evening_rest');
    const candidate = db.prepare('SELECT * FROM metrics WHERE id=?').get(candidateInsert.lastInsertRowid);
    const matched = matchMeasurementToFollowup(userId, candidate);
    assert.equal(matched.status, 'pending_result_confirmation');
    assert.equal(matched.candidate_metric_id, candidate.id);
    assert.equal(matched.comparison.comparable, false, '不同测量条件不应直接比较');

    const rejected = rejectFollowupCandidate(followup.id, userId, candidate.id);
    assert.equal(rejected.candidate_metric_id, null);
    assert.ok(JSON.parse(rejected.candidate_rejected_ids).includes(candidate.id));
    assert.equal(matchMeasurementToFollowup(userId, candidate), null, '被拒绝的候选不得再次匹配');

    const secondInsert = db.prepare(`INSERT INTO metrics (user_id,type,value,value2,unit,recorded_at,source,measurement_condition) VALUES (?,?,?,?,?,?,?,?)`)
      .run(userId, 'bp', 136, 86, 'mmHg', new Date(Date.now() + 2000).toISOString(), 'manual', 'morning_rest');
    const second = db.prepare('SELECT * FROM metrics WHERE id=?').get(secondInsert.lastInsertRowid);
    assert.equal(matchMeasurementToFollowup(userId, second)?.candidate_metric_id, second.id);
    const completed = confirmFollowupCandidate(followup.id, userId, actorId, second.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.comparison.comparable, true);
    assert.equal(completed.comparison.delta, -10);
    assert.equal(confirmFollowupCandidate(followup.id, userId, actorId, second.id).status, 'completed', '重复确认必须幂等');
    assert.equal(db.prepare('SELECT completed FROM todos WHERE id=?').get(todo.lastInsertRowid).completed, 1);

    const standalone = buildFollowupComparison({ user_id: userId, metric_type: 'bp', baseline_metric_id: baselineInsert.lastInsertRowid }, null, second);
    assert.equal(standalone.delta2, -8);

    const overdueAction = db.prepare(`INSERT INTO action_requests (user_id,actor_user_id,subject_user_id,action_type,payload,status) VALUES (?,?,?,?,?,'executed')`).run(userId, actorId, userId, 'schedule_recheck', '{}');
    const past = new Date(Date.now() - 25 * 3600000).toISOString();
    const overdue = db.prepare(`INSERT INTO followups (user_id,actor_user_id,action_request_id,metric_type,due_at,status,updated_at) VALUES (?,?,?,?,?,'scheduled',?)`).run(userId,actorId,overdueAction.lastInsertRowid,'hr',past,new Date().toISOString());
    refreshFollowupStates(userId);
    assert.equal(db.prepare('SELECT status FROM followups WHERE id=?').get(overdue.lastInsertRowid).status, 'overdue');
    throw rollback;
  })();
} catch (error) { if (error !== rollback) throw error; }

console.log('agent v3 follow-up state machine: PASS');
