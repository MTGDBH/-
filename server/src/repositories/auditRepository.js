import db from '../db.js';

export function appendAuditEvent(event) {
  db.prepare(`INSERT INTO audit_logs
    (actor_user_id,subject_user_id,event_type,resource,action,outcome,request_id,ip_hash,user_agent_hash,metadata)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    event.actor_user_id || null, event.subject_user_id || null, event.event_type,
    event.resource || null, event.action || null, event.outcome || 'success', event.request_id || null,
    event.ip_hash || null, event.user_agent_hash || null, JSON.stringify(event.metadata || {}),
  );
}

export function listAuditEvents(limit = 100) {
  return db.prepare(`SELECT id,actor_user_id,subject_user_id,event_type,resource,action,outcome,request_id,metadata,created_at
    FROM audit_logs ORDER BY id DESC LIMIT ?`).all(Math.max(1, Math.min(500, Number(limit) || 100))).map(row => ({
      ...row, metadata: (() => { try { return JSON.parse(row.metadata || '{}'); } catch { return {}; } })(),
    }));
}

