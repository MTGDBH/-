import crypto from 'node:crypto';
import { appendAuditEvent } from '../repositories/auditRepository.js';

const hash = value => value ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24) : null;
const SECRET_KEY = /(?:password|passphrase|token|api[_-]?key|authorization|cookie|secret|credential)/i;
const HEALTH_TEXT_KEY = /(?:health[_-]?(?:text|summary|content)|medical[_-]?text|symptom[_-]?text|(?:^|_)(?:text|content|message|prompt|query)$)/i;

export function sanitizeAuditValue(value, depth = 0) {
  if (depth > 5) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeAuditValue(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 500) : value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key) || HEALTH_TEXT_KEY.test(key)) result[key] = '[REDACTED]';
    else result[key] = sanitizeAuditValue(item, depth + 1);
  }
  return result;
}
export const requestFingerprint = req => ({ ip_hash: hash(req.ip || req.socket?.remoteAddress), user_agent_hash: hash(req.get?.('user-agent')) });

export function audit(event) {
  try { appendAuditEvent(sanitizeAuditValue(event)); } catch (error) { console.error('[audit] write_failed', error?.code || 'unknown'); }
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
