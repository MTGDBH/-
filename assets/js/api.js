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
  const isLoginPage = () => /login\.html$/.test(location.pathname) || location.pathname === '/login.html';

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
      });
    } catch (err) {
      // 网络层错误
      throw new Error('网络连接不上，请稍后再试');
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
      throw new Error(msg);
    }

    if (!res.ok) {
      const msg = (data && data.error) || `请求失败 (${res.status})`;
      throw new Error(msg);
    }

    return data;
  }

  window.API = {
    BASE,
    get:    (u, o)       => request('GET', u, o),
    post:   (u, body, o) => request('POST', u, { ...o, body }),
    put:    (u, body, o) => request('PUT', u, { ...o, body }),
    patch:  (u, body, o) => request('PATCH', u, { ...o, body }),
    delete: (u, o)       => request('DELETE', u, o),
  };
})();
