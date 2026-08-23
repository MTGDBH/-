// 鉴权 / 导航 / 用户
// 每个非登录页面 HTML 中：
//   <script>API.script('/assets/js/auth.js'); Auth.init();</script>
(function () {
  const NAV_ITEMS = [
    { key: 'overview',    label: '概览',       href: 'index.html' },
    { key: 'monitoring',  label: '健康监测',   href: 'monitoring.html' },
    { key: 'assessment',  label: '健康评估',   href: 'assessment.html' },
    { key: 'agent',       label: '智能管家',   href: 'agent.html' },
    { key: 'knowledge',   label: '健康知识',   href: 'knowledge.html' },
  ];

  // 当前页面属于哪个导航项（根据 URL 推断）
  function activeKeyFromPath() {
    const p = location.pathname.split('/').pop() || 'index.html';
    const hit = NAV_ITEMS.find(n => n.href === p);
    if (hit) return hit.key;
    if (p === 'metric.html') return 'monitoring';
    if (p === 'alerts.html') return 'monitoring';
    if (p === 'profile.html') return null;
    return null;
  }

  // 渲染顶部栏
  function renderNav(user) {
    const slot = document.getElementById('app-nav');
    if (!slot) return;
    const activeKey = activeKeyFromPath();

    const initials = (user.name || '你').slice(0, 1);
    const avColor = user.avatar_color || '#7FB069';

    slot.outerHTML = `
      <header class="topbar">
        <div class="topbar-inner">
          <a href="index.html" class="brand">
            <span class="brand-mark">康</span>
            <span class="brand-name">小康·健康管家</span>
          </a>
          <nav class="primary-nav" aria-label="主导航">
            ${NAV_ITEMS.map(n => `
              <a href="${n.href}" class="${n.key === activeKey ? 'is-active' : ''}">${n.label}</a>
            `).join('')}
          </nav>
          <div class="topbar-right">
            <button type="button" class="icon-theme" data-theme-toggle aria-label="切换到深色模式" aria-pressed="false" title="切换到深色模式">
              <span data-theme-icon aria-hidden="true">月</span>
            </button>
            <a href="alerts.html" class="icon-bell" title="预警中心" aria-label="预警中心">
              🔔
              <span class="bell-badge" data-alert-badge hidden></span>
            </a>
            <a href="profile.html" class="avatar" style="background:${avColor}" title="${user.name}">${initials}</a>
            <a href="settings.html" class="icon-settings" title="设置" aria-label="设置">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </a>
          </div>
        </div>
      </header>
    `;

    window.Theme?.syncButton?.();
    loadAlertCount();
  }

  async function loadAlertCount() {
    try {
      const s = await API.get('/api/alerts/summary');
      const badge = document.querySelector('[data-alert-badge]');
      if (badge && s.pending > 0) {
        badge.hidden = false;
        badge.textContent = s.pending;
      }
    } catch {}
  }

  // 当前登录用户（未登录抛错）
  async function getMe() {
    return await API.get('/api/auth/me');
  }

  // 初始化入口（每个已登录页面调用）
  async function init() {
    // login.html 不调用此函数，其他页面都调用
    if (/login\.html$/.test(location.pathname) || location.pathname === '/login.html') return;
    try {
      const user = await getMe();
      renderNav(user);
      window.__CURRENT_USER__ = user;
      document.dispatchEvent(new CustomEvent('auth:ready', { detail: user }));
    } catch (err) {
      // api.js 已经会跳 login.html
      console.error('[auth] not logged in:', err.message);
    }
  }

  window.Auth = { init, getMe, renderNav };
})();
