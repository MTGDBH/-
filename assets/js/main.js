/* ========================================================================
   小康·健康管家 — 共享脚本
   - 通用工具：日期格式化、相对时间、DOM 选择器
   - 智能管家页 tab 切换、快捷提问填入
   - 全局事件：401 处理（由 api.js 处理后跳登录）
   ======================================================================== */

(function () {
  'use strict';

  // ====== 通用 DOM 工具 ======
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, props = {}, children = []) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    if (props.className) n.className = props.className;
    if (props.style && typeof props.style === 'object') Object.assign(n.style, props.style);
    for (const c of [].concat(children)) {
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };
  window.$ = $;
  window.$$ = $$;
  window.el = el;

  // ====== 全站明暗主题 ======
  const THEME_KEY = 'xiaokang-theme-v1';
  const systemTheme = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  function currentTheme() {
    const value = document.documentElement.dataset.theme;
    return value === 'dark' ? 'dark' : 'light';
  }
  function syncThemeButton() {
    const theme = currentTheme();
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const dark = theme === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
      button.setAttribute('title', dark ? '切换到浅色模式' : '切换到深色模式');
      const icon = button.querySelector('[data-theme-icon]');
      if (icon) icon.textContent = dark ? '☀' : '月';
    });
  }
  function applyTheme(theme, persist = false) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    if (persist) localStorage.setItem(THEME_KEY, next);
    syncThemeButton();
    window.dispatchEvent(new CustomEvent('theme:change', { detail: { theme: next } }));
  }
  function toggleTheme() {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
    toast(currentTheme() === 'dark' ? '已切换到深色模式' : '已切换到浅色模式');
  }
  document.addEventListener('click', event => {
    if (event.target.closest('[data-theme-toggle]')) toggleTheme();
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', event => {
    if (!localStorage.getItem(THEME_KEY)) applyTheme(event.matches ? 'dark' : 'light');
  });
  window.Theme = { apply: applyTheme, toggle: toggleTheme, current: currentTheme, syncButton: syncThemeButton, system: systemTheme };

  // ====== 时间格式化 ======
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) {
    const x = new Date(d);
    return `${x.getMonth() + 1}月${pad2(x.getDate())}日`;
  }
  function fmtTime(d) {
    const x = new Date(d);
    return `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
  }
  function fmtFull(d) {
    const x = new Date(d);
    return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())} ${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
  }
  function fromNow(iso) {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d} 天前`;
    return fmtDate(iso);
  }
  window.fmtDate = fmtDate;
  window.fmtTime = fmtTime;
  window.fmtFull = fmtFull;
  window.fromNow = fromNow;

  // ====== Toast 轻提示 ======
  function toast(msg, type = 'info') {
    let host = document.getElementById('toast-host');
    if (!host) {
      host = el('div', { id: 'toast-host', className: 'toast-host' });
      document.body.appendChild(host);
    }
    const item = el('div', { className: `toast toast-${type}` }, msg);
    host.appendChild(item);
    setTimeout(() => {
      item.classList.add('out');
      setTimeout(() => item.remove(), 250);
    }, 2500);
  }
  window.toast = toast;

  // ====== 通用：把数据对象渲染进模板（占位符 {{x}}） ======
  function tplRender(str, data) {
    return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
      const v = k.split('.').reduce((o, p) => (o ? o[p] : ''), data);
      return v == null ? '' : String(v);
    });
  }
  window.tpl = tplRender;

  // ====== Tabs 切换 ======
  function bindTabs(root = document) {
    root.querySelectorAll('[data-tabs]').forEach((group) => {
      const tabs = group.querySelectorAll('[data-tab]');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const target = tab.dataset.tab;
          group.querySelectorAll('[data-panel]').forEach(p => {
            p.hidden = p.dataset.panel !== target;
          });
        });
      });
    });
  }
  window.bindTabs = bindTabs;

  // ====== 通用快捷提问：点击 → 触发自定义事件 ======
  function bindPrompts(root = document) {
    root.querySelectorAll('[data-prompt]').forEach(p => {
      p.addEventListener('click', () => {
        const input = document.querySelector('.chat-input');
        if (input) {
          input.value = p.textContent;
          input.dispatchEvent(new Event('input'));
          input.focus();
        }
        window.dispatchEvent(new CustomEvent('prompt:pick', { detail: p.textContent }));
      });
    });
  }
  window.bindPrompts = bindPrompts;

  // ====== 全站适老化与无障碍 ======
  const A11Y_KEY = 'xiaokang-a11y-v1';
  const FONT_LEVELS = ['normal', 'large', 'xlarge'];
  let speechUtterance = null;
  let lastDialogTrigger = null;

  function readA11ySettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(A11Y_KEY) || '{}');
      return {
        font: FONT_LEVELS.includes(stored.font) ? stored.font : 'normal',
        contrast: Boolean(stored.contrast),
      };
    } catch {
      return { font: 'normal', contrast: false };
    }
  }

  function applyA11ySettings(settings, persist = false) {
    const safe = {
      font: FONT_LEVELS.includes(settings.font) ? settings.font : 'normal',
      contrast: Boolean(settings.contrast),
    };
    document.documentElement.dataset.fontSize = safe.font;
    document.documentElement.dataset.contrast = safe.contrast ? 'high' : 'normal';
    if (persist) localStorage.setItem(A11Y_KEY, JSON.stringify(safe));
    document.querySelectorAll('[data-font-level]').forEach(button => {
      const active = button.dataset.fontLevel === safe.font;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    });
    const contrast = document.querySelector('[data-contrast-toggle]');
    if (contrast) contrast.setAttribute('aria-pressed', String(safe.contrast));
  }

  function createA11yToolbar() {
    if (document.getElementById('a11y-toolbar')) return;
    const host = document.createElement('aside');
    host.id = 'a11y-toolbar';
    host.className = 'a11y-toolbar';
    host.setAttribute('aria-label', '适老化显示与朗读工具');
    host.innerHTML = `
      <button type="button" class="a11y-toolbar-toggle" aria-expanded="false" aria-controls="a11y-toolbar-panel">
        <span aria-hidden="true">辅</span><span>适老工具</span>
      </button>
      <div class="a11y-toolbar-panel" id="a11y-toolbar-panel" hidden>
        <div class="a11y-toolbar-heading"><strong>显示与朗读</strong><button type="button" data-a11y-close aria-label="关闭适老工具">×</button></div>
        <fieldset><legend>字号大小</legend><div class="a11y-segmented">
          <button type="button" data-font-level="normal">普通</button>
          <button type="button" data-font-level="large">大字</button>
          <button type="button" data-font-level="xlarge">特大</button>
        </div></fieldset>
        <button type="button" class="a11y-wide-button" data-contrast-toggle aria-pressed="false"><span aria-hidden="true">◐</span> 高对比模式</button>
        <button type="button" class="a11y-wide-button a11y-read-button" data-read-key-results><span aria-hidden="true">▶</span> 朗读关键结果</button>
        <button type="button" class="a11y-wide-button" data-stop-reading hidden><span aria-hidden="true">■</span> 停止朗读</button>
        <p class="a11y-status" id="a11y-status" role="status" aria-live="polite">朗读只会在您点击后开始。</p>
      </div>`;
    document.body.appendChild(host);
    const toggle = host.querySelector('.a11y-toolbar-toggle');
    const panel = host.querySelector('.a11y-toolbar-panel');
    const setOpen = open => {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) panel.querySelector('button')?.focus();
      else toggle.focus();
    };
    toggle.addEventListener('click', () => setOpen(panel.hidden));
    host.querySelector('[data-a11y-close]').addEventListener('click', () => setOpen(false));
    host.querySelectorAll('[data-font-level]').forEach(button => button.addEventListener('click', () => {
      const settings = readA11ySettings();
      settings.font = button.dataset.fontLevel;
      applyA11ySettings(settings, true);
      announceA11y(`${button.textContent}模式已开启`);
    }));
    host.querySelector('[data-contrast-toggle]').addEventListener('click', event => {
      const settings = readA11ySettings();
      settings.contrast = !settings.contrast;
      applyA11ySettings(settings, true);
      announceA11y(settings.contrast ? '高对比模式已开启' : '高对比模式已关闭');
      event.currentTarget.focus();
    });
    host.querySelector('[data-read-key-results]').addEventListener('click', readKeyResults);
    host.querySelector('[data-stop-reading]').addEventListener('click', stopReading);
    applyA11ySettings(readA11ySettings());
  }

  function announceA11y(message) {
    const status = document.getElementById('a11y-status');
    if (status) status.textContent = message;
  }

  function visibleText(node) {
    if (!node || node.hidden || node.closest('[hidden], [aria-hidden="true"]')) return '';
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    return (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function criticalResultText() {
    const priorities = [
      { title: '今日待办', selectors: '[data-a11y-priority="todo"], .today-card, .todo-card, [data-todo], #today-plan, #plan-list' },
      { title: '严重预警', selectors: '[data-a11y-priority="critical"], .alert-critical, .severity-high, [data-severity="high"], [data-level="critical"]' },
      { title: '预测限制', selectors: '[data-a11y-priority="limit"], .curve-text-summary, .model-evidence, [data-forecast-limit], .prediction-limit' },
      { title: '复测要求', selectors: '[data-a11y-priority="retest"], .symbol-retest, .retest, [data-action-type="schedule_recheck"]' },
      { title: '智能体结论', selectors: '[data-a11y-priority="agent"], .agent-conclusion, .agent-message.assistant, .chat-message.assistant, [data-role="assistant"]' },
    ];
    const output = [];
    const used = new Set();
    priorities.forEach(group => {
      const items = Array.from(document.querySelectorAll(group.selectors))
        .filter(node => !node.matches('button, [aria-hidden="true"]'))
        .map(visibleText).filter(Boolean)
        .filter(text => {
          if (used.has(text)) return false;
          used.add(text);
          return true;
        }).slice(0, 4);
      if (items.length) output.push(`${group.title}。${items.join('。')}`);
    });
    if (!output.length) {
      const main = document.querySelector('main');
      const candidates = Array.from(main?.querySelectorAll('h1, h2, h3, .status, .result, .summary, [role="alert"]') || []);
      const keywords = /今日|待办|严重|预警|限制|不足|复测|结论|建议|下一步/;
      const fallback = candidates.map(visibleText).filter(text => keywords.test(text)).slice(0, 8);
      if (fallback.length) output.push(`本页关键结果。${fallback.join('。')}`);
    }
    return output.join('。');
  }

  function stopReading() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    speechUtterance = null;
    const stop = document.querySelector('[data-stop-reading]');
    if (stop) stop.hidden = true;
    announceA11y('朗读已停止。');
  }

  function readKeyResults() {
    // 此函数只绑定到用户点击事件，页面加载时绝不调用。
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      announceA11y('当前浏览器不支持文字朗读。');
      return;
    }
    const text = criticalResultText();
    if (!text) {
      announceA11y('当前页面没有可朗读的关键结果。');
      return;
    }
    window.speechSynthesis.cancel();
    speechUtterance = new SpeechSynthesisUtterance(text);
    speechUtterance.lang = 'zh-CN';
    speechUtterance.rate = 0.88;
    speechUtterance.pitch = 1;
    const stop = document.querySelector('[data-stop-reading]');
    if (stop) stop.hidden = false;
    speechUtterance.onstart = () => announceA11y('正在朗读关键结果。');
    speechUtterance.onend = () => {
      if (stop) stop.hidden = true;
      announceA11y('关键结果朗读完毕。');
    };
    speechUtterance.onerror = () => {
      if (stop) stop.hidden = true;
      announceA11y('朗读未能完成，请稍后重试。');
    };
    window.speechSynthesis.speak(speechUtterance);
  }

  function ensureLandmarks() {
    const main = document.querySelector('main');
    if (main && !main.id) main.id = 'main-content';
    if (main && !document.querySelector('.skip-link')) {
      const skip = document.createElement('a');
      skip.className = 'skip-link';
      skip.href = `#${main.id}`;
      skip.textContent = '跳转到主内容';
      document.body.insertBefore(skip, document.body.firstChild);
      if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
    }
    const h1 = main?.querySelector('h1');
    if (main && !main.hasAttribute('aria-label') && h1) main.setAttribute('aria-label', h1.textContent.trim());
  }

  function accessibleName(control) {
    if (control.getAttribute('aria-label') || control.getAttribute('aria-labelledby') || visibleText(control)) return;
    const title = control.getAttribute('title');
    const image = control.querySelector('img[alt]')?.getAttribute('alt');
    const svgTitle = control.querySelector('svg title')?.textContent;
    const fallback = title || image || svgTitle || control.dataset.action || control.id?.replace(/[-_]+/g, ' ');
    if (fallback) control.setAttribute('aria-label', fallback);
  }

  function enhanceControls(root = document) {
    root.querySelectorAll('button, a[href], input, select, textarea').forEach(control => {
      if (control.matches('button, a[href]')) accessibleName(control);
      if (!control.hasAttribute('autocomplete') && control instanceof HTMLInputElement) {
        const type = control.type;
        if (['email', 'tel', 'password'].includes(type)) control.autocomplete = type === 'tel' ? 'tel' : type === 'email' ? 'email' : 'current-password';
      }
    });
    root.querySelectorAll('svg:not([role])').forEach(svg => {
      const width = Number.parseFloat(svg.getAttribute('width') || '0');
      const decorative = Boolean(svg.closest('button, a, .brand, [class*="icon"]')) || (width > 0 && width <= 64);
      if (decorative && !svg.querySelector('title')) svg.setAttribute('aria-hidden', 'true');
    });
  }

  function enhanceTabs(root = document) {
    root.querySelectorAll('[data-tabs], .discovery-tabs').forEach(group => {
      if (!group.hasAttribute('role')) group.setAttribute('role', 'tablist');
      const tabs = Array.from(group.querySelectorAll('[data-tab]'));
      tabs.forEach((tab, index) => {
        tab.setAttribute('role', 'tab');
        const selected = tab.classList.contains('active') || tab.classList.contains('is-active');
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected || (!tabs.some(x => x.classList.contains('active') || x.classList.contains('is-active')) && index === 0) ? 0 : -1;
        tab.addEventListener('click', () => tabs.forEach(item => {
          const active = item === tab;
          item.setAttribute('aria-selected', String(active));
          item.tabIndex = active ? 0 : -1;
        }));
        tab.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          let next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          tabs[next].focus();
          tabs[next].click();
        });
      });
    });
  }

  function enhanceForms(root = document) {
    root.querySelectorAll('input, select, textarea').forEach((field, index) => {
      if (!field.id) field.id = `field-${index + 1}`;
      const explicit = root.querySelector(`label[for="${CSS.escape(field.id)}"]`);
      const wrapping = field.closest('label');
      if (!explicit && !wrapping && !field.getAttribute('aria-label') && !field.getAttribute('aria-labelledby')) {
        field.setAttribute('aria-label', field.placeholder || field.name || '输入项');
      }
      const help = field.closest('.form-row, label')?.querySelector('.form-hint, .field-hint, small');
      if (help) {
        if (!help.id) help.id = `${field.id}-help`;
        const described = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        described.add(help.id);
        field.setAttribute('aria-describedby', Array.from(described).join(' '));
      }
    });
    root.querySelectorAll('form').forEach((form, formIndex) => {
      if (form.dataset.a11yValidationBound) return;
      form.dataset.a11yValidationBound = 'true';
      const error = form.querySelector('[role="alert"], .form-error, .login-error, .form-message');
      if (error) {
        if (!error.id) error.id = `form-${formIndex + 1}-error`;
        error.setAttribute('role', error.getAttribute('role') || 'alert');
        error.setAttribute('aria-live', 'assertive');
      }
      form.addEventListener('invalid', event => {
        const field = event.target;
        field.setAttribute('aria-invalid', 'true');
        let message = field.parentElement?.querySelector('.a11y-field-error');
        if (!message) {
          message = document.createElement('span');
          message.className = 'a11y-field-error';
          message.id = `${field.id}-error`;
          field.insertAdjacentElement('afterend', message);
        }
        message.textContent = field.validationMessage || '请检查此项。';
        const described = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        described.add(message.id);
        field.setAttribute('aria-describedby', Array.from(described).join(' '));
      }, true);
      form.addEventListener('input', event => {
        if (event.target.checkValidity?.()) {
          event.target.removeAttribute('aria-invalid');
          const message = document.getElementById(`${event.target.id}-error`);
          if (message) message.remove();
        }
      });
    });
  }

  function enhanceTables(root = document) {
    root.querySelectorAll('table').forEach(table => {
      if (!table.querySelector('caption')) {
        const caption = document.createElement('caption');
        caption.className = 'sr-only';
        caption.textContent = table.getAttribute('aria-label') || table.closest('section')?.querySelector('h2, h3')?.textContent || '数据表格';
        table.prepend(caption);
      }
      const labels = Array.from(table.querySelectorAll('thead th')).map(th => visibleText(th));
      table.querySelectorAll('tbody tr').forEach(row => Array.from(row.children).forEach((cell, index) => {
        if (cell.tagName === 'TD' && labels[index]) cell.dataset.label = labels[index];
      }));
    });
  }

  function chartSummaryText(chart) {
    const supplied = chart.getAttribute('aria-description') || chart.dataset.summary;
    if (supplied) return supplied;
    const area = chart.closest('.metric-chart, .pred-chart, .curve-svg-wrap, .chart-card, section, article');
    const explicit = area?.querySelector('.curve-text-summary, [data-chart-summary], .pred-desc, #pred-desc');
    if (explicit && explicit !== chart) return visibleText(explicit);
    const title = area?.querySelector('h2, h3, .pred-chart-label')?.textContent?.trim() || chart.getAttribute('aria-label') || '图表';
    return `${title}。当前未提供可计算的文字趋势，请结合本区域数值和提示阅读。`;
  }

  function enhanceCharts(root = document) {
    root.querySelectorAll('svg:not([aria-hidden="true"]), canvas').forEach((chart, index) => {
      if (chart.dataset.a11yChartSummary === 'off' || chart.closest('button, a, .brand, .icon-settings')) return;
      const summary = chartSummaryText(chart);
      let description = chart.nextElementSibling?.matches('.a11y-chart-summary') ? chart.nextElementSibling : null;
      if (!description) {
        description = document.createElement('p');
        description.className = 'a11y-chart-summary';
        chart.insertAdjacentElement('afterend', description);
      }
      if (!description.id) description.id = `chart-summary-${index + 1}`;
      const nextText = summary.startsWith('图表文字摘要：') ? summary : `图表文字摘要：${summary}`;
      if (description.textContent !== nextText) description.textContent = nextText;
      chart.setAttribute('role', 'img');
      chart.setAttribute('aria-describedby', description.id);
      if (!chart.getAttribute('aria-label')) chart.setAttribute('aria-label', '健康数据图表');
    });
  }

  function focusableIn(container) {
    return Array.from(container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(node => !node.hidden && getComputedStyle(node).display !== 'none');
  }

  function enhanceDialogs(root = document) {
    root.querySelectorAll('dialog, .modal-mask').forEach(dialog => {
      if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      if (!dialog.getAttribute('aria-labelledby')) {
        const heading = dialog.querySelector('h1, h2, h3');
        if (heading) {
          if (!heading.id) heading.id = `${dialog.id || 'dialog'}-title`;
          dialog.setAttribute('aria-labelledby', heading.id);
        } else if (!dialog.getAttribute('aria-label')) dialog.setAttribute('aria-label', '对话框');
      }
      if (dialog.dataset.a11yDialogBound) return;
      dialog.dataset.a11yDialogBound = 'true';
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape' && dialog.matches('.modal-mask.show')) {
          dialog.classList.remove('show');
          lastDialogTrigger?.focus();
        }
        if (event.key !== 'Tab') return;
        const items = focusableIn(dialog);
        if (!items.length) return;
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      dialog.addEventListener('close', () => lastDialogTrigger?.focus());
    });
    document.addEventListener('click', event => {
      const trigger = event.target.closest('button, a[href]');
      if (trigger && !trigger.closest('dialog, .modal-mask')) lastDialogTrigger = trigger;
    }, true);
  }

  function applyDynamicEnhancements(root = document) {
    enhanceControls(root);
    enhanceTabs(root);
    enhanceForms(root);
    enhanceTables(root);
    enhanceCharts(root);
    enhanceDialogs(root);
  }

  function initAccessibility() {
    applyA11ySettings(readA11ySettings());
    ensureLandmarks();
    createA11yToolbar();
    applyDynamicEnhancements();
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; applyDynamicEnhancements(); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', stopReading);
  }
  window.XiaoKangAccessibility = { apply: applyA11ySettings, settings: readA11ySettings, readKeyResults, stopReading, refresh: applyDynamicEnhancements };

  // ====== 启动 ======
  document.addEventListener('DOMContentLoaded', () => {
    bindTabs();
    bindPrompts();
    syncThemeButton();
    initAccessibility();
  });
})();
