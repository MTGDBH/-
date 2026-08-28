const MAX_CONCURRENCY = Math.max(1, Number(process.env.HTTP_MAX_CONCURRENCY || 100));
const MAX_QUEUE = Math.max(0, Number(process.env.HTTP_MAX_QUEUE || 200));
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 30_000));
let active = 0;
const queue = [];

function admit(entry) {
  active += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(entry.queueTimer); clearTimeout(requestTimer);
    active = Math.max(0, active - 1);
    while (queue.length) {
      const next = queue.shift();
      if (!next.req.destroyed && !next.res.writableEnded) { admit(next); break; }
    }
  };
  const requestTimer = setTimeout(() => {
    if (!entry.res.headersSent) entry.res.status(504).json({ error: '请求处理超时', code: 'REQUEST_TIMEOUT' });
    else entry.res.end();
  }, REQUEST_TIMEOUT_MS);
  requestTimer.unref?.();
  entry.res.once('finish', release); entry.res.once('close', release);
  entry.next();
}

export function requestLimits(req, res, next) {
  const entry = { req, res, next, queueTimer: null };
  if (active < MAX_CONCURRENCY) return admit(entry);
  if (queue.length >= MAX_QUEUE) return res.status(503).json({ error: '服务繁忙，请稍后重试', code: 'REQUEST_QUEUE_FULL' });
  entry.queueTimer = setTimeout(() => {
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    if (!res.headersSent) res.status(503).json({ error: '排队超时，请稍后重试', code: 'REQUEST_QUEUE_TIMEOUT' });
  }, REQUEST_TIMEOUT_MS);
  entry.queueTimer.unref?.(); queue.push(entry);
}

export function requestLimitSnapshot() {
  return { active, queued: queue.length, max_concurrency: MAX_CONCURRENCY, max_queue: MAX_QUEUE, timeout_ms: REQUEST_TIMEOUT_MS };
}
