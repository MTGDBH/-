import crypto from 'node:crypto';
import { appendAuditEvent } from '../repositories/auditRepository.js';

const hash = value => value ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24) : null;
export const requestFingerprint = req => ({ ip_hash: hash(req.ip || req.socket?.remoteAddress), user_agent_hash: hash(req.get?.('user-agent')) });

export function audit(event) {
  try { appendAuditEvent(event); } catch (error) { console.error('[audit] write_failed', error?.code || 'unknown'); }
}

export function auditMutations(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const started = Date.now();
  res.on('finish', () => audit({
    actor_user_id: req.user?.id || null,
    subject_user_id: Number(req.body?.subject_user_id || req.query?.subject_user_id) || req.user?.id || null,
    event_type: 'api_mutation', resource: req.path, action: req.method,
    outcome: res.statusCode < 400 ? 'success' : 'failure', request_id: req.request_id,
    ...requestFingerprint(req), metadata: { status_code: res.statusCode, latency_ms: Date.now() - started },
  }));
  next();
}

