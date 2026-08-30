// 鉴权、全站应用框架与用户信息
(function () {
  const NAV_ITEMS = [
    { key: 'overview', icon: '⌂', label: '健康总览', href: 'index.html' },
    { key: 'monitoring', icon: '⌁', label: '记录与趋势', href: 'monitoring.html' },
    { key: 'agent', icon: '✦', label: '智能管家', href: 'agent.html' },
    { key: 'intervention', icon: '✓', label: '今日计划', href: 'intervention.html' },
    { key: 'care', icon: '♧', label: '照护协同', href: 'care.html' },
    { key: 'profile', icon: '人', label: '我的与隐私', href: 'profile.html' },
  ];

  const MOBILE_NAV_ITEMS = [
    { key: 'home', icon: '⌂', label: '首页', href: 'index.html' },
    { key: 'record', icon: '＋', label: '记录', href: 'monitoring.html' },
    { key: 'agent', icon: '康', label: '管家', href: 'agent.html' },
    { key: 'plan', icon: '✓', label: '计划', href: 'intervention.html' },
    { key: 'me', icon: '人', label: '我的', href: 'profile.html' },
  ];

  function activeKeyFromPath() {
    const p = location.pathname.split('/').pop() || 'index.html';
    const hit = NAV_ITEMS.find(n => n.href === p);
    if (hit) return hit.key;
    if (['metric.html', 'prediction.html', 'alerts.html'].includes(p)) return 'monitoring';
    if (['assessment.html'].includes(p)) return 'intervention';
    if (['knowledge.html', 'confidence.html'].includes(p)) return 'agent';
    if (['privacy.html', 'settings.html'].includes(p)) return 'profile';
    return null;
  }

  function mobileKeyFromPath() {
    const p = location.pathname.split('/').pop() || 'index.html';
    if (p === 'index.html' || p === 'alerts.html') return 'home';
    if (['monitoring.html', 'metric.html', 'prediction.html'].includes(p)) return 'record';
    if (['agent.html', 'knowledge.html', 'confidence.html'].includes(p)) return 'agent';
    if (['intervention.html', 'assessment.html'].includes(p)) return 'plan';
    if (['profile.html', 'privacy.html', 'care.html', 'settings.html'].includes(p)) return 'me';
    return 'home';
  }

  function renderNav(user) {
    const slot = document.getElementById('app-nav');
    if (!slot) return;
    const activeKey = activeKeyFromPath();
    const mobileKey = mobileKeyFromPath();
    const initials = (user.name || '你').slice(0, 1);
    const avColor = user.avatar_color || '#0F766E';
    const navLink = n => `<a href="${n.href}" class="app-nav-link${n.key === activeKey ? ' is-active' : ''}"${n.key === activeKey ? ' aria-current="page"' : ''}><span aria-hidden="true">${n.icon}</span><strong>${n.label}</strong></a>`;
    const mobileLink = n => `<a href="${n.href}" class="app-mobile-tab${n.key === mobileKey ? ' is-active' : ''}"${n.key === mobileKey ? ' aria-current="page"' : ''}><span aria-hidden="true">${n.icon}</span><strong>${n.label}</strong></a>`;
    const mobileTitle = MOBILE_NAV_ITEMS.find(item => item.key === mobileKey)?.label || '首页';
    const skipLink = document.querySelector('.skip-link') ? '' : '<a class="skip-link" href="#main-content">跳到主要内容</a>';

    slot.outerHTML = `
      ${skipLink}
      <header class="app-desktop-topbar desktop-only">
        <a href="index.html" class="app-desktop-brand" aria-label="小康健康管家首页"><span>康</span><strong>小康健康</strong></a>
        <div class="app-desktop-tools">
          <span class="app-sync-state"><i></i> 数据已同步</span>
          <a href="alerts.html" class="app-desktop-icon" aria-label="预警中心">♢<i class="bell-badge" data-alert-badge hidden></i></a>
          <button type="button" class="app-desktop-icon" data-theme-toggle aria-label="切换显示模式" aria-pressed="false"><span data-theme-icon aria-hidden="true">月</span></button>
          <a href="profile.html" class="app-desktop-user"><span class="avatar" style="background:${avColor}">${initials}</span><div><strong>${user.name}</strong><small>${user.age ? `${user.age} 岁` : '健康账户'}</small></div><b>⌄</b></a>
        </div>
      </header>
      <aside class="app-sidebar" aria-label="应用导航">
        <nav class="app-sidebar-nav">${NAV_ITEMS.map(navLink).join('')}</nav>
        <div class="app-sidebar-help"><span>?</span><div><strong>需要帮助？</strong><small>查看使用指南</small></div><a href="settings.html" aria-label="系统设置与 API 配置" style="display:grid;place-items:center;width:28px;height:28px;margin-left:auto;border-radius:8px;background:#fff0f3;color:#ff5268;font-size:12px;font-weight:800">⚙</a></div>
      </aside>
      <header class="app-mobilebar">
        <a href="index.html" class="app-mobile-brand"><span>康</span><strong>小康·健康管家</strong></a>
        <span class="app-mobile-page-title">${mobileTitle}</span>
        <button type="button" class="app-mobile-a11y" data-mobile-a11y-launch aria-label="打开显示与朗读工具"><span aria-hidden="true">辅</span></button>
        <a href="alerts.html" class="app-mobile-alert" aria-label="预警中心"><span aria-hidden="true">醒</span><i class="bell-badge" data-alert-badge hidden></i></a>
        <a href="profile.html" class="avatar" style="background:${avColor}" aria-label="个人资料：${user.name}">${initials}</a>
      </header>
      <nav class="app-mobile-bottomnav" aria-label="移动端主导航">${MOBILE_NAV_ITEMS.map(mobileLink).join('')}</nav>
    `;
    document.body.classList.add('has-app-shell');
    document.body.classList.add(`mobile-route-${mobileKey}`);

    const main = document.querySelector('main');
    if (main && !main.id) main.id = 'main-content';
    document.querySelector('[data-mobile-a11y-launch]')?.addEventListener('click', () => {
      document.querySelector('.a11y-toolbar-toggle')?.click();
    });
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

  function setupMobileCareConsole() {
    const owner = document.getElementById('owner-console');
    const invitePanel = owner?.querySelector(':scope > .care-panel');
    if (!owner || !invitePanel || owner.querySelector('.mobile-care-invite-toggle')) return;
    owner.classList.add('mobile-owner-console');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mobile-care-invite-toggle mobile-only';
    toggle.innerHTML = '<span aria-hidden="true">＋</span><strong>邀请家属或医生</strong><small>创建限时、可撤回的授权</small><b aria-hidden="true">›</b>';
    toggle.addEventListener('click', () => {
      const open = invitePanel.classList.toggle('is-mobile-expanded');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('strong').textContent = open ? '收起邀请表单' : '邀请家属或医生';
      toggle.querySelector('small').textContent = open ? '暂时不创建新的授权' : '创建限时、可撤回的授权';
      toggle.querySelector('b').textContent = open ? '⌃' : '›';
      if (open) invitePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'mobile-invite-panel');
    invitePanel.id = invitePanel.id || 'mobile-invite-panel';
    owner.append(toggle);
  }

  function makeMobileCollapsible(card, title, open = false) {
    if (!card || card.querySelector(':scope > .mobile-section-toggle')) return;
    card.classList.add('mobile-collapsible-card');
    card.classList.toggle('is-mobile-collapsed', !open);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mobile-section-toggle mobile-only';
    toggle.innerHTML = `<span>${title}</span><small>${open ? '收起' : '展开'}</small><b aria-hidden="true">${open ? '⌃' : '⌄'}</b>`;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.addEventListener('click', () => {
      const expanded = card.classList.toggle('is-mobile-collapsed') === false;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.querySelector('small').textContent = expanded ? '收起' : '展开';
      toggle.querySelector('b').textContent = expanded ? '⌃' : '⌄';
    });
    card.prepend(toggle);
  }

  function setupMobileProfileSections() {
    const risk = document.getElementById('form-risk-profile')?.closest('.profile-form-card');
    const basic = document.getElementById('form-basic')?.closest('.profile-form-card');
    const emergency = document.getElementById('emergency-contact');
    const security = document.getElementById('account-security');
    if (risk) risk.id = risk.id || 'risk-profile';
    if (basic) basic.id = basic.id || 'basic-profile';
    [[risk, '健康档案'], [basic, '基本信息'], [emergency, '紧急联系人'], [security, '账号安全']]
      .forEach(([card, title]) => makeMobileCollapsible(card, title));

    document.querySelectorAll('.mobile-profile-menu a[href^="#"]').forEach(link => {
      link.addEventListener('click', event => {
        const card = document.querySelector(link.getAttribute('href'));
        if (!card?.classList.contains('mobile-collapsible-card')) return;
        event.preventDefault();
        if (card.classList.contains('is-mobile-collapsed')) card.querySelector('.mobile-section-toggle')?.click();
        requestAnimationFrame(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      });
    });
    document.querySelector('[data-profile-a11y]')?.addEventListener('click', () => {
      document.querySelector('.a11y-toolbar-toggle')?.click();
    });
  }

  function setupMobileSettings() {
    const llmForm = document.getElementById('form-llm');
    makeMobileCollapsible(llmForm?.closest('.profile-form-card'), 'AI 模型配置');
  }

  function setupMobilePrivacy() {
    makeMobileCollapsible(document.getElementById('privacy-retention')?.closest('.privacy-panel'), '数据保留与删除范围');
    makeMobileCollapsible(document.querySelector('.privacy-policy'), '隐私说明');
  }

  function setupMobileConfidence() {
    const head = document.querySelector('.confidence-page')?.previousElementSibling;
    if (head?.classList.contains('page-head') && !head.querySelector('.mobile-confidence-back')) {
      const back = document.createElement('a');
      back.className = 'mobile-confidence-back mobile-only';
      back.href = 'agent.html';
      back.textContent = '← 返回智能管家';
      head.prepend(back);
    }
    document.querySelectorAll('.confidence-dimension-card').forEach((card, index) => {
      const title = card.querySelector('.confidence-dim-title')?.textContent?.trim() || (index === 4 ? '后续优化计划' : `评分维度 ${index + 1}`);
      makeMobileCollapsible(card, title);
    });
    const senseBanners = document.querySelectorAll('.confidence-sense-banner');
    if (senseBanners[1]) makeMobileCollapsible(senseBanners[1], '常识类回复说明');
    document.querySelectorAll('.confidence-example-card').forEach((card, index) => {
      makeMobileCollapsible(card, card.querySelector('.ex-tag')?.textContent?.trim() || `示例 ${index + 1}`);
    });
  }

  async function renderMobileHomeVitals() {
    const score = document.querySelector('.score-card');
    const anchor = score?.querySelector('.score-number');
    if (!score || !anchor || score.querySelector('.mobile-vital-grid')) return;
    const host = document.createElement('section');
    host.className = 'mobile-vital-grid mobile-only';
    host.setAttribute('aria-label', '今日主要健康指标');
    host.innerHTML = '<div class="mobile-vital-loading">正在读取今日指标…</div>';
    anchor.insertAdjacentElement('afterend', host);
    try {
      const metrics = await API.get('/api/health/metrics');
      const bp = metrics.bp;
      const hr = metrics.hr;
      const sleep = metrics.sleep;
      const items = [
        { tone: 'orange', icon: '压', label: '血压', value: bp ? `${Math.round(bp.value)}/${Math.round(bp.value2)}` : '—', unit: 'mmHg' },
        { tone: 'coral', icon: '心', label: '心率', value: hr ? Math.round(hr.value) : '—', unit: 'bpm' },
        { tone: 'purple', icon: '眠', label: '睡眠', value: sleep ? `${Number(sleep.value).toFixed(1)}h` : '—', unit: '昨晚' },
      ];
      host.innerHTML = items.map(item => `<article class="mobile-vital ${item.tone}"><span aria-hidden="true">${item.icon}</span><div><small>${item.label}</small><strong>${item.value}</strong><em>${item.unit}</em></div></article>`).join('');
    } catch {
      host.innerHTML = '<div class="mobile-vital-loading">今日指标暂时无法读取</div>';
    }
  }

  function enhanceMobilePage() {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    const p = location.pathname.split('/').pop() || 'index.html';
    if (p === 'index.html') renderMobileHomeVitals();
    if (p === 'care.html') setupMobileCareConsole();
    if (p === 'profile.html') setupMobileProfileSections();
    if (p === 'settings.html') setupMobileSettings();
    if (p === 'privacy.html') setupMobilePrivacy();
    if (p === 'confidence.html') setupMobileConfidence();
  }

  async function init() {
    if (/login\.html$/.test(location.pathname) || location.pathname === '/login.html') return;
    try {
      const user = await getMe();
      renderNav(user);
      window.__CURRENT_USER__ = user;
      document.dispatchEvent(new CustomEvent('auth:ready', { detail: user }));
      enhanceMobilePage();
    } catch (err) {
      console.error('[auth] not logged in:', err.message);
    }
  }

  window.Auth = { init, getMe, renderNav };
})();
