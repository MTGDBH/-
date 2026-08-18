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

  // ====== 启动 ======
  document.addEventListener('DOMContentLoaded', () => {
    bindTabs();
    bindPrompts();
  });
})();
