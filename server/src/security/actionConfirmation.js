import crypto from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

export function actionPayloadHash({ actorUserId, subjectUserId, actionType, payload }) {
  return crypto.createHash('sha256').update(JSON.stringify(stable({
    actor_user_id: Number(actorUserId), subject_user_id: Number(subjectUserId), action_type: String(actionType), payload,
  }))).digest('hex');
}

export function createOneTimeConfirmation(binding, ttlMs = 15 * 60 * 1000) {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    payloadHash: actionPayloadHash(binding),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
}

export function verifyOneTimeConfirmation(request, token, payload) {
  if (!request?.confirmation_token_hash || !request?.payload_hash || !request?.confirmation_expires_at) return { ok: false, code: 'CONFIRMATION_BINDING_MISSING' };
  if (request.confirmation_consumed_at) return { ok: false, code: 'CONFIRMATION_REPLAYED' };
  if (new Date(request.confirmation_expires_at) <= new Date()) return { ok: false, code: 'CONFIRMATION_EXPIRED' };
  const supplied = crypto.createHash('sha256').update(String(token || '')).digest();
  const expected = Buffer.from(request.confirmation_token_hash, 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return { ok: false, code: 'CONFIRMATION_TOKEN_INVALID' };
  const currentHash = actionPayloadHash({ actorUserId: request.actor_user_id, subjectUserId: request.subject_user_id, actionType: request.action_type, payload });
  if (currentHash !== request.payload_hash) return { ok: false, code: 'CONFIRMATION_PAYLOAD_CHANGED' };
  return { ok: true };
}
