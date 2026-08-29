// 鉴权、全站应用框架与用户信息
(function () {
  const NAV_ITEMS = [
    { key: 'overview', icon: '概', label: '健康概览', href: 'index.html' },
    { key: 'monitoring', icon: '测', label: '健康监测', href: 'monitoring.html' },
    { key: 'assessment', icon: '评', label: '健康评估', href: 'assessment.html' },
    { key: 'agent', icon: '智', label: '智能管家', href: 'agent.html' },
    { key: 'intervention', icon: '计', label: '改善计划', href: 'intervention.html' },
    { key: 'care', icon: '护', label: '照护协同', href: 'care.html' },
    { key: 'knowledge', icon: '知', label: '健康知识', href: 'knowledge.html' },
  ];

  function activeKeyFromPath() {
    const p = location.pathname.split('/').pop() || 'index.html';
    const hit = NAV_ITEMS.find(n => n.href === p);
    if (hit) return hit.key;
    if (p === 'metric.html' || p === 'alerts.html') return 'monitoring';
    return null;
  }

  function renderNav(user) {
    const slot = document.getElementById('app-nav');
    if (!slot) return;
    const activeKey = activeKeyFromPath();
    const initials = (user.name || '你').slice(0, 1);
    const avColor = user.avatar_color || '#0F766E';
    const workspaceItems = NAV_ITEMS.slice(0, 4);
    const serviceItems = NAV_ITEMS.slice(4);
    const navLink = n => `<a href="${n.href}" class="app-nav-link${n.key === activeKey ? ' is-active' : ''}"${n.key === activeKey ? ' aria-current="page"' : ''}><span aria-hidden="true">${n.icon}</span><strong>${n.label}</strong></a>`;

    slot.outerHTML = `
      <a class="skip-link" href="#main-content">跳到主要内容</a>
      <aside class="app-sidebar" aria-label="应用导航">
        <a href="index.html" class="app-sidebar-brand" aria-label="小康健康管家首页"><span>康</span><div><strong>小康健康管家</strong><small>HEALTH OS</small></div></a>
        <nav class="app-sidebar-nav">
          <section><p>健康工作台</p>${workspaceItems.map(navLink).join('')}</section>
          <section><p>服务与知识</p>${serviceItems.map(navLink).join('')}</section>
        </nav>
        <div class="app-sidebar-tools">
          <a href="alerts.html" class="app-tool-link"><span aria-hidden="true">醒</span><strong>预警中心</strong><i class="bell-badge" data-alert-badge hidden></i></a>
          <a href="settings.html" class="app-tool-link"><span aria-hidden="true">设</span><strong>系统设置</strong></a>
          <button type="button" class="app-tool-link" data-theme-toggle aria-label="切换到深色模式" aria-pressed="false"><span data-theme-icon aria-hidden="true">月</span><strong>显示模式</strong></button>
        </div>
        <a href="profile.html" class="app-user-card"><span class="avatar" style="background:${avColor}">${initials}</span><div><strong>${user.name}</strong><small>查看个人资料</small></div><b aria-hidden="true">›</b></a>
      </aside>
      <header class="app-mobilebar">
        <a href="index.html" class="app-mobile-brand"><span>康</span><strong>小康健康管家</strong></a>
        <details class="app-mobile-menu"><summary aria-label="打开导航">菜单</summary><nav>${NAV_ITEMS.map(navLink).join('')}<a href="alerts.html" class="app-nav-link"><span>醒</span><strong>预警中心</strong><i class="bell-badge" data-alert-badge hidden></i></a><a href="settings.html" class="app-nav-link"><span>设</span><strong>设置</strong></a></nav></details>
        <a href="profile.html" class="avatar" style="background:${avColor}" aria-label="个人资料：${user.name}">${initials}</a>
      </header>
    `;
    document.body.classList.add('has-app-shell');

    const main = document.querySelector('main');
    if (main && !main.id) main.id = 'main-content';
    window.Theme?.syncButton?.();
    loadAlertCount();
  }

  async function loadAlertCount() {
    try {
      const s = await API.get('/api/alerts/summary');
      document.querySelectorAll('[data-alert-badge]').forEach(badge => {
        badge.hidden = !(s.pending > 0);
        if (s.pending > 0) badge.textContent = s.pending;
      });
    } catch {}
  }

  async function getMe() {
    return await API.get('/api/auth/me');
  }

  async function init() {
    if (/login\.html$/.test(location.pathname) || location.pathname === '/login.html') return;
    try {
      const user = await getMe();
      renderNav(user);
      window.__CURRENT_USER__ = user;
      document.dispatchEvent(new CustomEvent('auth:ready', { detail: user }));
    } catch (err) {
      console.error('[auth] not logged in:', err.message);
    }
  }

  window.Auth = { init, getMe, renderNav };
})();
