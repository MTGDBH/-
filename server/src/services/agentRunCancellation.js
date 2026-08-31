const activeRuns = new Map();

function key(actorUserId, clientRequestId) {
  return `${Number(actorUserId)}:${String(clientRequestId || '')}`;
}

export function registerAgentRun(actorUserId, clientRequestId) {
  const runKey = key(actorUserId, clientRequestId);
  const old = activeRuns.get(runKey);
  if (old) old.controller.abort(new Error('replaced'));
  const controller = new AbortController();
  activeRuns.set(runKey, { controller, started_at: new Date().toISOString() });
  return {
    signal: controller.signal,
    finish() {
      if (activeRuns.get(runKey)?.controller === controller) activeRuns.delete(runKey);
    },
  };
}

export function cancelAgentRun(actorUserId, clientRequestId, reason = 'user_cancelled') {
  const item = activeRuns.get(key(actorUserId, clientRequestId));
  if (!item) return false;
  item.controller.abort(Object.assign(new Error(reason), { code: 'AGENT_CANCELLED' }));
  return true;
}

export function activeAgentRunCount() {
  return activeRuns.size;
}

export function throwIfAgentCancelled(signal) {
  if (!signal?.aborted) return;
  throw Object.assign(signal.reason instanceof Error ? signal.reason : new Error('agent cancelled'), { code: 'AGENT_CANCELLED' });
}
