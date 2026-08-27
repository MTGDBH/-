import db from '../db.js';

export function findCurvePoints(userId, type, since) {
  return db.prepare(`SELECT id,value,value2,recorded_at,source,measurement_condition FROM metrics
    WHERE user_id=? AND type=? AND recorded_at>=? ORDER BY recorded_at ASC`).all(userId, type, since);
}

export function latestPredictionInputMap(userId) {
  return Object.fromEntries(db.prepare(`SELECT p.field,p.value,p.recorded_at FROM prediction_inputs p
    JOIN (SELECT field,MAX(recorded_at) recorded_at FROM prediction_inputs WHERE user_id=? GROUP BY field) x
      ON x.field=p.field AND x.recorded_at=p.recorded_at WHERE p.user_id=?`).all(userId, userId).map(row => [row.field, row]));
}

