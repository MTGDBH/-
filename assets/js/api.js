// API 客户端：fetch 封装 + Cookie + 401 处理
// 所有页面通过 window.API 调后端
(function () {
  // 在页面绘制前尽早应用主题，减少深色模式刷新时的白色闪烁。
  try {
    const savedTheme = localStorage.getItem('xiaokang-theme-v1');
    const theme = savedTheme === 'dark' || savedTheme === 'light'
      ? savedTheme
      : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {}

  // 手机端统一进入新版应用；保留 desktop=1 作为桌面版显式入口。
  const mobileAppPath = location.pathname === '/mobile' || /mobile\.html$/.test(location.pathname);
  const forceDesktop = new URLSearchParams(location.search).get('desktop') === '1';
  if (!mobileAppPath && !forceDesktop && window.matchMedia?.('(max-width: 900px)').matches) {
    const page = location.pathname.split('/').pop() || 'index.html';
    const viewByPage = {
      'index.html':'home', 'login.html':'home', 'register.html':'home', 'monitoring.html':'monitor', 'metric.html':'monitor',
      'prediction.html':'trends', 'alerts.html':'risk', 'assessment.html':'assessment', 'intervention.html':'plans',
      'agent.html':'chat', 'knowledge.html':'knowledge', 'confidence.html':'knowledge', 'care.html':'care',
      'profile.html':'profile', 'privacy.html':'settings', 'settings.html':'settings',
    };
    location.replace(`/mobile?view=${encodeURIComponent(viewByPage[page] || 'home')}`);
    return;
  }

  // 如果通过 file:// 协议打开，自动跳转到后端服务地址（同源才能正常读写 cookie）
  if (location.protocol === 'file:') {
    var page = location.pathname.split('/').pop() || 'index.html';
    location.replace('http://localhost:3001/' + page + location.search + location.hash);
    return;
  }

  const resolveBase = () => {
    const configured = window.__API_BASE__;
    if (configured !== undefined && configured !== null && String(configured).trim() !== '') {
      return String(configured).replace(/\/$/, '');
    }
    if (configured === '') return '';

    const origin = window.location.origin;
    const isLocalStaticSite = location.protocol === 'file:' || /:(3000|4173|8080|8000)$/.test(origin) || /^(https?:\/\/)?(localhost|127\.0\.0\.1)(?::(3000|4173|8080|8000))?$/.test(origin);

    if (isLocalStaticSite) return 'http://localhost:3001';

    return origin;
  };

  const BASE = resolveBase();
  const isLoginPage = () => /login\.html$/.test(location.pathname) || location.pathname === '/login.html' || /mobile\.html$/.test(location.pathname) || location.pathname === '/mobile';

  class APIError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'APIError';
      Object.assign(this, details);
    }
  }

  function requestSignal(opts = {}) {
    const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 65_000));
    const timeoutSignal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : null;
    if (opts.signal && timeoutSignal && typeof AbortSignal?.any === 'function') return AbortSignal.any([opts.signal, timeoutSignal]);
    return opts.signal || timeoutSignal || undefined;
  }

  async function request(method, url, opts = {}) {
    const finalUrl = url.startsWith('http') ? url : `${BASE}${url}`;
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
    }

    let res;
    try {
      res = await fetch(finalUrl, {
        method,
        headers,
        credentials: 'include', // 关键：发送并接收 cookie
        body: opts.body,
        signal: requestSignal(opts),
      });
    } catch (err) {
      const cancelled = opts.signal?.aborted;
      const timedOut = err?.name === 'TimeoutError';
      throw new APIError(cancelled ? '已停止本次生成' : timedOut ? '等待回答超时，请稍后重试' : '网络连接不上，请稍后再试', {
        code: cancelled ? 'CLIENT_CANCELLED' : timedOut ? 'CLIENT_TIMEOUT' : 'NETWORK_ERROR',
        retryable: !cancelled,
        stage: cancelled ? 'cancelled' : timedOut ? 'client_timeout' : 'network',
      });
    }

    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      data = await res.text().catch(() => '');
    }

    if (res.status === 401) {
      // 未登录或登录过期
      if (!isLoginPage()) {
        const next = encodeURIComponent(location.pathname + location.search);
        location.href = `login.html?next=${next}`;
      }
      const msg = (data && data.error) || '请先登录';
      throw new APIError(msg, { status: 401, code: data?.code || 'UNAUTHENTICATED', requestId: data?.request_id || res.headers.get('x-request-id'), retryable: false, stage: 'authentication' });
    }

    if (!res.ok) {
      const msg = (data && data.error) || `请求失败 (${res.status})`;
      throw new APIError(msg, {
        status: res.status,
        code: data?.code || `HTTP_${res.status}`,
        requestId: data?.request_id || res.headers.get('x-request-id'),
        retryable: data?.retryable ?? [408, 425, 429, 502, 503, 504].includes(res.status),
        retryAfterMs: data?.retry_after_ms || null,
        stage: data?.stage || 'server',
      });
    }

    return data;
  }

  async function stream(url, body, opts = {}) {
    const finalUrl = url.startsWith('http') ? url : `${BASE}${url}`;
    let res;
    try {
      res = await fetch(finalUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        credentials: 'include', body: JSON.stringify(body), signal: requestSignal(opts) });
    } catch (err) {
      const cancelled = opts.signal?.aborted;
      throw new APIError(cancelled ? '已取消本次生成' : err?.name === 'TimeoutError' ? '等待回答超时，请稍后重试' : '网络连接不上，请稍后再试', {
        code: cancelled ? 'CLIENT_CANCELLED' : err?.name === 'TimeoutError' ? 'CLIENT_TIMEOUT' : 'NETWORK_ERROR', retryable: !cancelled,
      });
    }
    if (res.status === 401) {
      if (!isLoginPage()) location.href = `login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
      throw new APIError('请先登录', { status: 401, code: 'UNAUTHENTICATED', retryable: false });
    }
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => null);
      throw new APIError(data?.error || `请求失败 (${res.status})`, { status: res.status, code: data?.code || `HTTP_${res.status}`,
        requestId: data?.request_id || res.headers.get('x-request-id'), retryable: data?.retryable ?? res.status >= 500 });
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', finalResult = null;
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const event = block.split(/\r?\n/).find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
          const raw = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
          if (!raw) continue;
          const payload = JSON.parse(raw);
          opts.onEvent?.(event, payload);
          if (event === 'result') finalResult = payload;
          if (event === 'error') throw new APIError(payload.error || '智能管家生成失败', { status: payload.status, code: payload.code,
            retryable: payload.retryable, stage: payload.stage, requestId: payload.request_id });
        }
        if (done) break;
      }
    } catch (error) {
      if (error instanceof APIError) throw error;
      if (opts.signal?.aborted) throw new APIError('已取消本次生成', { code: 'CLIENT_CANCELLED', retryable: false, stage: 'cancelled' });
      throw new APIError('流式连接中断，请稍后重试', { code: 'STREAM_INTERRUPTED', retryable: true, stage: 'stream' });
    }
    if (!finalResult) throw new APIError('流式回答未完整结束，请重试', { code: 'STREAM_INCOMPLETE', retryable: true });
    return finalResult;
  }

  window.API = {
    BASE,
    Error: APIError,
    stream,
    get:    (u, o)       => request('GET', u, o),
    post:   (u, body, o) => request('POST', u, { ...o, body }),
    put:    (u, body, o) => request('PUT', u, { ...o, body }),
    patch:  (u, body, o) => request('PATCH', u, { ...o, body }),
    delete: (u, o)       => request('DELETE', u, o),
  };
})();
