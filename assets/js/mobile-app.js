(function () {
  "use strict";

  const root = document.getElementById("mobile-app");
  const requestedView = new URLSearchParams(location.search).get("view");
  const state = {
    user: null,
    view: requestedView || "home",
    health: null,
    metrics: null,
    toastTimer: null,
    previous: "home",
  };

  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>'"]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[char],
    );
  const num = (value, fallback = "—") =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const timeLabel = (value) =>
    value
      ? new Date(value).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "暂无";
  const spark = (values, color) => {
    const nums = values.map(Number).filter(Number.isFinite);
    if (nums.length < 2) return '<span class="spark"></span>';
    const min = Math.min(...nums),
      max = Math.max(...nums),
      range = max - min || 1;
    const points = nums
      .map(
        (value, index) =>
          `${Math.round((index * 110) / (nums.length - 1))},${Math.round(34 - ((value - min) * 27) / range)}`,
      )
      .join(" ");
    return `<svg class="spark" viewBox="0 0 112 40" aria-hidden="true"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };
  const wideChart = (points, color = "#776ef4", secondKey = null) => {
    const rows = Array.isArray(points)
      ? points.filter((point) => Number.isFinite(Number(point.value)))
      : [];
    if (rows.length < 2)
      return '<div class="empty-state"><b>数据不足</b>继续记录后会显示趋势</div>';
    const values = rows.flatMap((point) =>
      secondKey && Number.isFinite(Number(point[secondKey]))
        ? [Number(point.value), Number(point[secondKey])]
        : [Number(point.value)],
    );
    const min = Math.min(...values),
      max = Math.max(...values),
      range = max - min || 1;
    const line = (key) =>
      rows
        .map(
          (point, index) =>
            `${14 + (index * 292) / (rows.length - 1)},${125 - ((Number(point[key]) - min) * 94) / range}`,
        )
        .join(" ");
    const labels = [rows[0], rows[Math.floor(rows.length / 2)], rows.at(-1)]
      .map(
        (point, index) =>
          `<text x="${14 + index * 146}" y="142">${esc(String(point.recorded_at || "").slice(5, 10))}</text>`,
      )
      .join("");
    const primaryLine = line("value");
    const gradientId = `trend-${color.replace(/[^a-z0-9]/gi, "")}`;
    return `<svg class="wide-chart" viewBox="0 0 320 150" role="img" aria-label="最近趋势"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><line x1="14" y1="125" x2="306" y2="125" stroke="#eceef2"/><polygon points="14,125 ${primaryLine} 306,125" fill="url(#${gradientId})"/><polyline points="${primaryLine}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${secondKey ? `<polyline points="${line(secondKey)}" fill="none" stroke="#f3ae69" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ""}${labels}</svg>`;
  };

  const iconPaths = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    home: '<path d="m3 11 9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z"/>',
    moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.6 6.6 0 0 0 21 12.8z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-13 5 2.2 2.2L16 12"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z"/>',
    bot: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/>',
    mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>',
    activity: '<path d="M13 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-2 4 3 2 2-3m-5 1-2 5-4 2m6-7 4 5 4 1m-8-1-1 8m5-8 2 8"/>',
    chart: '<path d="M3 3v18h18M7 16l4-5 3 3 6-8"/>',
    droplet: '<path d="M12 2s7 7.1 7 12a7 7 0 0 1-14 0c0-4.9 7-12 7-12z"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    scale: '<path d="M5 4h14l2 17H3L5 4zm4 4a3 3 0 0 1 6 0"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zm0 0A2.5 2.5 0 0 0 6.5 22H20"/>',
    food: '<path d="M7 2v8m-3-8v5a3 3 0 0 0 6 0V2M7 10v12m10-20v20m0-20c-3 3-3 8 0 10"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zm-3-10 2 2 4-4"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>',
    eyeOff: '<path d="m3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.1 3M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a10 10 0 0 0 4.1-.9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
    warning: '<path d="M10.3 3.8 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0zM12 9v4m0 4h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7zM11 13 22 2"/>',
    sparkle: '<path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3L12 3zm6 11 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z"/>',
  };

  function iconSvg(name, label = "") {
    return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"${label ? ` aria-label="${esc(label)}" role="img"` : ' aria-hidden="true"'}>${iconPaths[name] || iconPaths.sparkle}</svg>`;
  }

  function enhanceIcons(scope = document) {
    const map = {
      "⌂": "home", "♡": "heart", "♥": "heart", "☾": "moon",
      "✓": "calendar", "♧": "users", "♟": "activity", "步": "activity",
      "滴": "droplet", "心": "pulse", "氧": "pulse", "重": "scale",
      "食": "food", "书": "book", "⚙": "settings", "⌁": "chart",
      "!": "warning", "医": "pulse", "人": "user", "锁": "lock",
      "年": "calendar", "角": "users", "AI": "sparkle", "◉": "bot",
      "♙": "user", "◎": "chart",
    };
    scope.querySelectorAll("i").forEach((node) => {
      const name = map[node.textContent.trim()];
      if (name) node.innerHTML = iconSvg(name);
    });
    const direct = [
      ["[data-menu]", "menu"], ["[data-back]", "back"],
      ["[data-auth-back]", "back"], ["[data-close]", "close"],
      [".big-mic", "mic"], ['[aria-label="发送"]', "send"],
      ['[aria-label="搜索"]', "search"], [".ask-box > b", "mic"],
    ];
    direct.forEach(([selector, name]) =>
      scope.querySelectorAll(selector).forEach((node) => {
        node.innerHTML = iconSvg(name);
      }),
    );
    scope.querySelectorAll(".health-good > i").forEach((node) => {
      node.innerHTML = iconSvg("check");
    });
    scope.querySelectorAll(".avatar-large").forEach((node) => {
      if (node.textContent.trim() === "锁") node.innerHTML = iconSvg("shield");
    });
    scope.querySelectorAll(".bottom-nav button.active").forEach((node) => {
      node.setAttribute("aria-current", "page");
    });
    scope.querySelectorAll("[data-password-toggle]").forEach((node) => {
      const input = node.parentElement?.querySelector("input");
      node.innerHTML = iconSvg(input?.type === "password" ? "eye" : "eyeOff");
    });
  }

  function toast(message) {
    document.querySelector(".toast")?.remove();
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    document.querySelector(".mobile-app")?.append(node);
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => node.remove(), 2400);
  }

  function authField({
    icon,
    id,
    name,
    label,
    type = "text",
    autocomplete,
    value = "",
    inputmode = "",
  }) {
    const toggle =
      type === "password"
        ? '<button class="password-toggle" type="button" data-password-toggle aria-label="显示密码">◎</button>'
        : "";
    return `<label class="auth-field" for="${id}"><i aria-hidden="true">${icon}</i><input id="${id}" name="${name}" aria-label="${label}" placeholder="${label}" type="${type}" autocomplete="${autocomplete || "off"}" value="${esc(value)}"${inputmode ? ` inputmode="${inputmode}"` : ""}>${toggle}</label>`;
  }

  function bindPasswordToggle() {
    document.querySelectorAll("[data-password-toggle]").forEach((button) =>
      button.addEventListener("click", () => {
        const input = button.parentElement.querySelector("input");
        input.type = input.type === "password" ? "text" : "password";
        button.innerHTML = iconSvg(input.type === "password" ? "eye" : "eyeOff");
        button.setAttribute(
          "aria-label",
          input.type === "password" ? "显示密码" : "隐藏密码",
        );
      }),
    );
  }

  function renderLogin(message = "") {
    root.innerHTML = `<section class="mobile-app"><div class="auth-screen"><div class="auth-brand"><h1>小康健康</h1><p>陪您一起管理每天的健康</p></div><form class="auth-form" id="login-form">${authField({ icon: "人", id: "login-account", name: "identifier", label: "请输入姓名或手机号", autocomplete: "username", value: "张奶奶" })}${authField({ icon: "锁", id: "login-password", name: "password", label: "请输入密码", type: "password", autocomplete: "current-password" })}<p class="form-error" id="login-error" role="alert">${esc(message)}</p><button class="primary-button" type="submit">登录</button><button class="text-button" type="button" data-register>注册新账号</button></form><div class="demo-note">ⓘ 演示账号：张奶奶 / 123456</div></div></section>`;
    enhanceIcons(root);
    bindPasswordToggle();
    document
      .querySelector("[data-register]")
      .addEventListener("click", renderRegister);
    document
      .getElementById("login-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector("[type=submit]");
        const error = document.getElementById("login-error");
        const data = new FormData(event.currentTarget);
        button.disabled = true;
        button.textContent = "正在登录…";
        error.textContent = "";
        try {
          const result = await API.post("/api/auth/login", {
            identifier: data.get("identifier"),
            password: data.get("password"),
          });
          state.user = result.user;
          navigate("home");
        } catch (err) {
          error.textContent = err.message || "登录失败，请稍后重试";
          button.disabled = false;
          button.textContent = "登录";
        }
      });
  }

  function renderRegister() {
    root.innerHTML = `<section class="mobile-app"><button class="icon-button" data-auth-back aria-label="返回" style="position:absolute;z-index:2;top:calc(8px + env(safe-area-inset-top));left:12px">‹</button><div class="auth-screen"><div class="auth-brand" style="margin-top:clamp(88px,15dvh,140px)"><h1 style="font-size:27px">创建健康账户</h1></div><form class="auth-form" id="register-form">${authField({ icon: "人", id: "register-name", name: "name", label: "请输入姓名", autocomplete: "name" })}${authField({ icon: "年", id: "register-age", name: "age", label: "请输入年龄", type: "number", inputmode: "numeric" })}<label class="auth-field" for="register-role"><i>角</i><select id="register-role" name="role" aria-label="账户角色" style="width:100%;height:58px;border:0;background:transparent;outline:0"><option value="senior">老人账户</option><option value="caregiver">家属账户</option></select></label>${authField({ icon: "锁", id: "register-password", name: "password", label: "请设置至少6位密码", type: "password", autocomplete: "new-password" })}<p class="form-error" id="register-error" role="alert"></p><button class="primary-button" type="submit">创建账户</button></form><div class="demo-note" style="border:0">ⓘ 信息仅用于健康管理</div></div></section>`;
    enhanceIcons(root);
    bindPasswordToggle();
    document
      .querySelector("[data-auth-back]")
      .addEventListener("click", () => renderLogin());
    document
      .getElementById("register-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget,
          button = form.querySelector("[type=submit]"),
          data = new FormData(form);
        button.disabled = true;
        button.textContent = "正在创建…";
        document.getElementById("register-error").textContent = "";
        try {
          const result = await API.post("/api/auth/register", {
            name: data.get("name"),
            age: Number(data.get("age")) || null,
            role: data.get("role"),
            password: data.get("password"),
          });
          state.user = result.user;
          navigate("home");
        } catch (error) {
          document.getElementById("register-error").textContent =
            error.message || "创建账户失败";
          button.disabled = false;
          button.textContent = "创建账户";
        }
      });
  }

  function topbar(title = "小康健康", back = false) {
    const online = title === "和小康聊聊";
    return `<header class="topbar"><button class="icon-button" ${back ? "data-back" : "data-menu"} aria-label="${back ? "返回" : "菜单"}">${back ? "‹" : "☰"}</button><span class="topbar-title"><strong>${esc(title)}</strong>${online ? "<small><i></i>小康在线</small>" : ""}</span><span></span></header>`;
  }

  function bottomNav(active = "home") {
    const items = [
      ["home", "⌂", "首页"],
      ["monitor", "♡", "记录"],
      ["chat", "◉", "管家"],
      ["profile", "♙", "我的"],
    ];
    return `<nav class="bottom-nav" aria-label="主导航">${items.map(([view, icon, label]) => `<button class="${active === view ? "active" : ""}" data-view="${view}"><i>${icon}</i><span>${label}</span></button>`).join("")}</nav>`;
  }

  function shell(content, active = "home", title = "小康健康", options = {}) {
    root.innerHTML = `<section class="mobile-app">${topbar(title, options.back)}<div class="app-screen">${content}</div>${bottomNav(active)}</section>`;
    enhanceIcons(root);
    bindNavigation();
    document
      .querySelector("[data-menu]")
      ?.addEventListener("click", openDrawer);
    document
      .querySelector("[data-back]")
      ?.addEventListener("click", () =>
        navigate(options.backTo || state.previous || "home"),
      );
  }

  function bindNavigation() {
    document
      .querySelectorAll("[data-view]")
      .forEach((button) =>
        button.addEventListener("click", () => navigate(button.dataset.view)),
      );
  }

  function openDrawer() {
    const app = document.querySelector(".mobile-app");
    if (!app || app.querySelector(".drawer-backdrop")) return;
    const items = [
      ["home", "⌂", "健康首页"],
      ["monitor", "♥", "健康监测"],
      ["trends", "⌁", "健康趋势"],
      ["risk", "!", "风险提醒"],
      ["assessment", "◎", "健康评估"],
      ["knowledge", "书", "健康知识"],
      ["care", "♧", "照护协同"],
      ["settings", "⚙", "隐私与设置"],
    ];
    const layer = document.createElement("div");
    layer.className = "drawer-backdrop";
    layer.innerHTML = `<aside class="drawer"><div class="drawer-head"><strong>小康健康</strong><button class="icon-button" data-close aria-label="关闭">×</button></div><div class="drawer-user"><i>${esc((state.user?.name || "您").slice(0, 1))}</i><span><b>${esc(state.user?.name || "健康账户")}</b><small>● 健康服务已连接</small></span></div><nav class="drawer-nav">${items.map(([view, icon, label]) => `<button data-view="${view}"><i>${icon}</i><span>${label}</span><b>›</b></button>`).join("")}</nav></aside>`;
    enhanceIcons(layer);
    app.append(layer);
    layer.addEventListener("click", (event) => {
      if (event.target === layer || event.target.closest("[data-close]"))
        layer.remove();
    });
    layer
      .querySelectorAll("[data-view]")
      .forEach((button) =>
        button.addEventListener("click", () => navigate(button.dataset.view)),
      );
  }

  async function renderHome() {
    shell(
      '<div class="app-loading"><span></span><p>正在读取健康数据…</p></div>',
    );
    try {
      const [health, metrics, bpHistory, sleepHistory, stepsHistory] =
        await Promise.all([
          API.get("/api/health/summary"),
          API.get("/api/health/metrics"),
          API.get("/api/health/metrics/bp/history?days=7"),
          API.get("/api/health/metrics/sleep/history?days=7"),
          API.get("/api/health/metrics/steps/history?days=7"),
        ]);
      state.health = health;
      state.metrics = metrics;
      state.user = health.user || state.user;
      const bp = metrics.bp,
        sleep = metrics.sleep,
        steps = metrics.steps;
      const name = state.user?.name || "您";
      const content = `<h1 class="home-title">早上好，${esc(name)}</h1><button class="ask-box" data-view="chat"><span>想问小康什么？</span><i>♩</i><b>◉</b></button><div class="quick-grid"><button class="quick-card coral" data-view="record-bp"><i>♥</i><span><b>记录血压</b><small>添加血压数据</small></span></button><button class="quick-card violet" data-view="monitor"><i>☾</i><span><b>看看睡眠</b><small>分析睡眠质量</small></span></button><button class="quick-card green" data-view="plans"><i>✓</i><span><b>今日计划</b><small>查看今日任务</small></span></button><button class="quick-card orange" data-view="care"><i>♧</i><span><b>联系家属</b><small>分享健康情况</small></span></button></div><div class="section-title"><h2>健康摘要</h2><button data-view="monitor">查看全部</button></div><div class="summary-card"><button class="summary-row health-good" data-view="assessment"><i>✓</i><div><small>今日健康状态</small><strong>${Number(health.total_score) >= 75 ? "良好" : "需要关注"}</strong><p>${esc(health.summary || `综合评分 ${num(health.total_score)} 分`)}</p></div></button><button class="summary-row" data-view="monitor"><i style="color:var(--orange)">♥</i><div><small>血压</small><strong>${bp ? `${Math.round(bp.value)} / ${Math.round(bp.value2)}` : "暂无"} <em>mmHg</em></strong><p>${bp ? `● ${timeLabel(bp.recorded_at)}` : "● 等待记录"}</p></div>${spark(
        bpHistory.points.map((point) => point.value),
        "#f58a2f",
      )}</button><button class="summary-row" data-view="monitor"><i style="color:var(--violet)">☾</i><div><small>睡眠</small><strong>${sleep ? Number(sleep.value).toFixed(1) : "暂无"} <em>小时</em></strong><p>${sleep ? "● 已记录" : "● 等待记录"}</p></div>${spark(
        sleepHistory.points.map((point) => point.value),
        "#8177f6",
      )}</button><button class="summary-row" data-view="monitor"><i style="color:var(--green)">♟</i><div><small>步数</small><strong>${steps ? Number(steps.value).toLocaleString("zh-CN") : "暂无"} <em>步</em></strong><p>${steps ? "● 今日活动" : "● 等待记录"}</p></div>${spark(
        stepsHistory.points.map((point) => point.value),
        "#39b96a",
      )}</button></div>`;
      shell(content, "home");
      const summaryText = String(health.summary || "");
      const statusLabel = /需关注|异常|风险/.test(summaryText)
        ? "需要关注"
        : Number(health.total_score) >= 80
          ? "良好"
          : "一般";
      const statusNode = document.querySelector(".health-good strong");
      if (statusNode) statusNode.textContent = statusLabel;
    } catch (error) {
      if (error.status === 401) return renderLogin();
      shell(
        `<div class="app-loading"><p>${esc(error.message || "健康数据暂时无法读取")}</p><button class="primary-button" data-retry>重新加载</button></div>`,
      );
      document
        .querySelector("[data-retry]")
        ?.addEventListener("click", renderHome);
    }
  }

  const metricMeta = {
    bp: { label: "血压", icon: "♥", unit: "mmHg", color: "#f58a2f" },
    glucose: { label: "血糖", icon: "滴", unit: "mmol/L", color: "#5e8deb" },
    hr: { label: "心率", icon: "心", unit: "bpm", color: "#ff6666" },
    spo2: { label: "血氧", icon: "氧", unit: "%", color: "#5e8deb" },
    weight: { label: "体重", icon: "重", unit: "kg", color: "#f2a132" },
    sleep: { label: "睡眠", icon: "☾", unit: "小时", color: "#8177f6" },
    steps: { label: "步数", icon: "步", unit: "步", color: "#39b96a" },
  };

  function metricValue(type, row) {
    if (!row) return "暂无记录";
    if (type === "bp")
      return `${Math.round(row.value)} / ${Math.round(row.value2)} mmHg`;
    const digits = ["glucose", "sleep", "weight"].includes(type) ? 1 : 0;
    return `${Number(row.value).toFixed(digits)} ${metricMeta[type]?.unit || row.unit || ""}`;
  }

  async function renderMonitor() {
    shell(
      '<div class="app-loading"><span></span><p>正在读取测量记录…</p></div>',
      "monitor",
      "健康监测",
    );
    try {
      const metrics = await API.get("/api/health/metrics");
      state.metrics = metrics;
      const types = ["bp", "glucose", "hr", "sleep", "steps"];
      const rows = types
        .map((type) => {
          const item = metrics[type],
            meta = metricMeta[type];
          return `<button class="data-card measure-card" data-record-type="${type}"><i style="color:${meta.color}">${meta.icon}</i><div><small>最近一次${meta.label}</small><strong>${esc(metricValue(type, item))}</strong></div><span>${item ? timeLabel(item.recorded_at) : "暂无"}<br>${item ? "● 已同步" : "等待记录"}</span><b>›</b></button>`;
        })
        .join("");
      shell(
        `<div class="pill-tabs"><button class="active">最近测量</button><button data-view="trends">健康趋势</button><button data-view="assessment">健康评估</button></div><div class="page-heading"><h1>最近测量</h1><p>定期监测有助于了解健康趋势</p></div><div class="card-stack">${rows}</div><button class="black-button" data-view="record" style="margin-top:14px">＋ 记录一次测量</button>`,
        "monitor",
        "健康监测",
      );
      const recentTab = document.querySelector(".pill-tabs .active");
      if (recentTab) {
        recentTab.disabled = true;
        recentTab.setAttribute("aria-current", "page");
      }
      document
        .querySelectorAll("[data-record-type]")
        .forEach((button) =>
          button.addEventListener("click", () =>
            navigate(`record-${button.dataset.recordType}`),
          ),
        );
    } catch (error) {
      shell(
        `<div class="empty-state"><b>暂时无法读取</b>${esc(error.message)}</div>`,
        "monitor",
        "健康监测",
      );
    }
  }

  function renderRecord(initialType = "bp") {
    const type = metricMeta[initialType] ? initialType : "bp";
    const options = Object.entries(metricMeta)
      .map(
        ([key, meta]) =>
          `<option value="${key}"${key === type ? " selected" : ""}>${meta.label}</option>`,
      )
      .join("");
    shell(
      `<div class="page-heading"><h1>记录健康数据</h1><p>测量后请核对数值，再保存到个人健康档案</p></div><form class="data-card form-card" id="metric-form"><label class="field"><span>指标类型</span><select name="type" id="metric-type">${options}</select></label><label class="field"><span id="metric-value-label">${metricMeta[type].label}数值</span><input name="value" type="number" step="0.1" required inputmode="decimal" placeholder="请输入数值"></label><label class="field" id="secondary-field"${type === "bp" ? "" : " hidden"}><span>舒张压</span><input name="value2" type="number" step="1" inputmode="numeric" placeholder="例如 82"></label><label class="field"><span>测量备注（选填）</span><input name="note" maxlength="100" placeholder="例如：晨起静息测量"></label><p class="form-error" id="metric-error"></p><button class="primary-button" type="submit">保存记录</button></form>`,
      "monitor",
      "记录测量",
      { back: true, backTo: "monitor" },
    );
    const select = document.getElementById("metric-type"),
      secondary = document.getElementById("secondary-field"),
      label = document.getElementById("metric-value-label"),
      primaryInput = document.querySelector('#metric-form [name="value"]'),
      secondaryInput = document.querySelector('#metric-form [name="value2"]');
    const syncMetricFields = () => {
      secondary.hidden = select.value !== "bp";
      secondaryInput.required = select.value === "bp";
      label.textContent =
        select.value === "bp"
          ? "收缩压（高压）"
          : `${metricMeta[select.value].label}数值`;
      secondary.querySelector("span").textContent = "舒张压（低压）";
      primaryInput.placeholder = select.value === "bp" ? "例如 138" : "请输入测量数值";
      primaryInput.step = ["glucose", "sleep", "weight"].includes(select.value)
        ? "0.1"
        : "1";
    };
    syncMetricFields();
    select.addEventListener("change", syncMetricFields);
    document
      .getElementById("metric-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget,
          data = new FormData(form),
          type = data.get("type"),
          button = form.querySelector("[type=submit]");
        const primaryValue = Number(data.get("value"));
        const secondaryValue = Number(data.get("value2"));
        if (!Number.isFinite(primaryValue) || primaryValue <= 0) {
          document.getElementById("metric-error").textContent = "请输入有效的测量数值";
          primaryInput.focus();
          return;
        }
        if (type === "bp" && (!Number.isFinite(secondaryValue) || secondaryValue <= 0)) {
          document.getElementById("metric-error").textContent = "请同时填写有效的高压和低压";
          secondaryInput.focus();
          return;
        }
        button.disabled = true;
        button.textContent = "正在保存…";
        document.getElementById("metric-error").textContent = "";
        try {
          await API.post("/api/health/metrics", {
            type,
            value: primaryValue,
            value2: type === "bp" ? secondaryValue : null,
            unit: metricMeta[type].unit,
            note: data.get("note"),
            measurement_condition: type === "bp" ? "morning_rest" : "unknown",
          });
          toast("健康数据已保存");
          setTimeout(() => navigate("monitor"), 350);
        } catch (error) {
          document.getElementById("metric-error").textContent =
            error.message || "保存失败";
          button.disabled = false;
          button.textContent = "保存记录";
        }
      });
  }

  async function renderTrends() {
    shell(
      '<div class="app-loading"><span></span><p>正在分析最近趋势…</p></div>',
      "monitor",
      "健康趋势",
    );
    try {
      const [bp, sleep, steps] = await Promise.all([
        API.get("/api/health/metrics/bp/history?days=30"),
        API.get("/api/health/metrics/sleep/history?days=30"),
        API.get("/api/health/metrics/steps/history?days=30"),
      ]);
      const card = (type, title, text, data, color, second) =>
        `<article class="data-card chart-card" data-trend-card="${type}"><div class="chart-card-title"><span class="row-icon">${iconSvg(type === "bp" ? "heart" : type === "sleep" ? "moon" : "activity")}</span><div><h3>${title}</h3><p>${text}</p></div></div>${wideChart(data.points, color, second)}</article>`;
      shell(
        `<div class="pill-tabs" aria-label="趋势分类"><button class="active" data-trend-filter="all">全部</button><button data-trend-filter="bp">血压</button><button data-trend-filter="sleep">睡眠</button><button data-trend-filter="activity">活动</button></div><div class="page-heading"><h1>最近有什么变化</h1><p>基于近 30 天真实记录分析</p></div><div class="card-stack" id="trend-cards">${card("bp", "血压总体稳定", "关注长期变化，不以单次读数作判断", bp, "#f58a2f", "value2")}${card("sleep", "睡眠有所改善", "规律作息有助于保持睡眠质量", sleep, "#8177f6")}${card("activity", "步数稳步增加", "量力而行，逐步增加日常活动", steps, "#39b96a")}</div>`,
        "monitor",
        "健康趋势",
      );
      document.querySelectorAll("[data-trend-filter]").forEach((button) =>
        button.addEventListener("click", () => {
          const filter = button.dataset.trendFilter;
          document
            .querySelectorAll("[data-trend-filter]")
            .forEach((item) => item.classList.toggle("active", item === button));
          document.querySelectorAll("[data-trend-card]").forEach((item) => {
            item.hidden = filter !== "all" && item.dataset.trendCard !== filter;
          });
        }),
      );
    } catch (error) {
      shell(
        `<div class="empty-state"><b>趋势暂时不可用</b>${esc(error.message)}</div>`,
        "monitor",
        "健康趋势",
      );
    }
  }

  async function renderPlans() {
    shell(
      '<div class="app-loading"><span></span><p>正在读取今日计划…</p></div>',
      "home",
      "今日计划",
      { back: true },
    );
    try {
      const todos = await API.get("/api/todos/today");
      const list = todos.length
        ? todos
            .map(
              (item) =>
                `<label class="todo-row"><input type="checkbox" data-todo="${item.id}"${item.completed ? " checked" : ""}><span class="row-copy"><b>${esc(item.title)}</b><small>${esc(item.time || "今天")} · ${item.completed ? "已完成" : "待完成"}</small></span></label>`,
            )
            .join("")
        : '<div class="empty-state"><b>今天还没有计划</b>添加一项适合自己的健康任务吧</div>';
      shell(
        `<div class="page-heading"><h1>今天要做什么？</h1><p>循序渐进完成任务，身体不适时请先休息</p></div><div class="data-card" style="padding:0">${list}</div><form class="data-card form-card" id="todo-form" style="margin-top:14px"><label class="field"><span>新增任务</span><input name="title" required maxlength="80" placeholder="例如：晚饭后散步 20 分钟"></label><label class="field"><span>时间</span><input name="time" type="time" required value="18:30"></label><button class="black-button" type="submit">＋ 添加任务</button></form>`,
        "home",
        "今日计划",
        { back: true },
      );
      document.querySelectorAll("[data-todo]").forEach((input) =>
        input.addEventListener("change", async () => {
          try {
            await API.patch(`/api/todos/${input.dataset.todo}`, {
              completed: input.checked,
            });
            toast(input.checked ? "任务已完成" : "已恢复为待完成");
          } catch (error) {
            input.checked = !input.checked;
            toast(error.message);
          }
        }),
      );
      document
        .getElementById("todo-form")
        .addEventListener("submit", async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          try {
            await API.post("/api/todos", {
              title: data.get("title"),
              time: data.get("time"),
              kind: "health",
            });
            toast("任务已添加");
            renderPlans();
          } catch (error) {
            toast(error.message);
          }
        });
    } catch (error) {
      shell(
        `<div class="empty-state"><b>计划暂时不可用</b>${esc(error.message)}</div>`,
        "home",
        "今日计划",
        { back: true },
      );
    }
  }

  async function renderAssessment() {
    shell(
      '<div class="app-loading"><span></span><p>正在生成健康评估…</p></div>',
      "home",
      "健康评估",
      { back: true },
    );
    try {
      const assessment = await API.get("/api/assessments/latest");
      const score = Math.round(Number(assessment.total_score) || 0);
      const labels = {
        chronic: "慢病管理",
        metrics: "慢病管理",
        activity: "活动",
        sleep: "睡眠",
        todos: "计划完成",
        nutrition: "营养",
      };
      const dimensionViews = {
        chronic: "monitor",
        metrics: "monitor",
        activity: "trends",
        sleep: "trends",
        todos: "plans",
        nutrition: "knowledge",
      };
      const dimensionIcons = {
        chronic: "heart",
        metrics: "heart",
        activity: "activity",
        sleep: "moon",
        todos: "calendar",
        nutrition: "food",
      };
      const dimensions = Object.entries(assessment.subscores || {})
        .map(
          ([key, value]) =>
            `<button class="dimension-row" data-dimension-view="${dimensionViews[key] || "monitor"}"><i class="row-icon">${iconSvg(dimensionIcons[key] || "sparkle")}</i><span class="row-copy"><b>${esc(labels[key] || key)}</b><small>查看相关记录与建议</small></span><span class="row-value">${Math.round(Number(value) || 0)} 分</span><b>›</b></button>`,
        )
        .join("");
      shell(
        `<div class="score-ring" style="--score:${Math.max(0, Math.min(100, score))}"><div><strong>${score}</strong><span>分</span></div></div><div style="text-align:center;margin-bottom:24px"><h1 style="font-size:23px;margin:0 0 8px">${score >= 75 ? "近期状态良好" : "近期需要关注"}</h1><p style="color:var(--muted);font-size:13px">${esc(assessment.summary || "继续保持健康的生活方式")}</p></div><h2 style="font-size:17px">评估维度</h2><div class="data-card" style="padding:0">${dimensions || '<div class="empty-state">暂无细分评分</div>'}</div><p style="text-align:center;color:var(--muted);font-size:10px">ⓘ 用于日常健康管理参考，不作为医疗诊断</p><button class="black-button" id="save-assessment">保存本次评估</button>`,
        "home",
        "健康评估",
        { back: true },
      );
      const assessmentLabel = /需关注|异常|风险/.test(
        String(assessment.summary || ""),
      )
        ? "近期需要关注"
        : score >= 80
          ? "近期状态良好"
          : "近期状态一般";
      const assessmentTitle = document.querySelector(".score-ring + div h1");
      if (assessmentTitle) assessmentTitle.textContent = assessmentLabel;
      document.querySelectorAll("[data-dimension-view]").forEach((button) =>
        button.addEventListener("click", () =>
          navigate(button.dataset.dimensionView),
        ),
      );
      document
        .getElementById("save-assessment")
        .addEventListener("click", async () => {
          try {
            await API.post("/api/assessments", {});
            toast("评估已保存");
          } catch (error) {
            toast(error.message);
          }
        });
    } catch (error) {
      shell(
        `<div class="empty-state"><b>评估暂时不可用</b>${esc(error.message)}</div>`,
        "home",
        "健康评估",
        { back: true },
      );
    }
  }

  async function renderRisk() {
    shell(
      '<div class="app-loading"><span></span><p>正在读取风险提醒…</p></div>',
      "home",
      "风险提醒",
      { back: true },
    );
    try {
      const data = await API.get("/api/alerts");
      const items = data.items || [];
      const rows = items.length
        ? items
            .map(
              (item, index) =>
                `<button class="alert-row ${esc(item.severity)}" data-alert="${item.id}"${index >= 5 ? " hidden data-extra-alert" : ""}><i class="row-icon">!</i><span class="row-copy"><b>${esc(item.title)}</b><small>${esc(item.message || "请留意近期健康变化")}</small></span><span class="row-value">${item.status === "pending" ? "待处理" : "已查看"}</span></button>`,
            )
            .join("")
        : '<div class="empty-state"><b>今天暂无异常提醒</b>继续保持良好的生活习惯</div>';
      shell(
        `<div class="page-heading"><h1>${items.some((item) => item.status === "pending") ? "需要关注" : "近期状态稳定"}</h1><p>提醒来自已记录数据，只用于健康管理参考</p></div><div class="data-card" style="padding:0">${rows}</div>${items.length > 5 ? `<button class="outline-button alert-toggle" id="toggle-alerts">查看其余 ${items.length - 5} 条提醒</button>` : ""}<div class="data-card safety-tip"><span class="row-icon">${iconSvg("shield")}</span><div><h3>温馨提示</h3><p>如出现胸痛、呼吸困难、意识改变、单侧无力或言语含糊，请及时联系急救服务。</p></div></div>`,
        "home",
        "风险提醒",
        { back: true },
      );
      document.querySelectorAll("[data-alert]").forEach((button) =>
        button.addEventListener("click", async () => {
          try {
            await API.patch(`/api/alerts/${button.dataset.alert}`, {
              status: "acknowledged",
            });
            toast("提醒已标记为已查看");
            renderRisk();
          } catch (error) {
            toast(error.message);
          }
        }),
      );
      document.getElementById("toggle-alerts")?.addEventListener("click", (event) => {
        const shouldShow = document.querySelector("[data-extra-alert]")?.hidden;
        document.querySelectorAll("[data-extra-alert]").forEach((item) => {
          item.hidden = !shouldShow;
        });
        event.currentTarget.textContent = shouldShow
          ? "收起其余提醒"
          : `查看其余 ${Math.max(0, items.length - 5)} 条提醒`;
      });
    } catch (error) {
      shell(
        `<div class="empty-state"><b>提醒暂时不可用</b>${esc(error.message)}</div>`,
        "home",
        "风险提醒",
        { back: true },
      );
    }
  }

  function renderChat() {
    shell(
      `<div class="chat-hero"><button class="big-mic" data-chat-prompt="我今天身体怎么样？" aria-label="询问今日身体状况">◉</button><div class="suggestion-list"><button data-chat-prompt="我今天身体怎么样？">♥　我今天身体怎么样？</button><button data-chat-prompt="帮我看看最近的血压变化">滴　帮我看看血压</button><button data-chat-prompt="我今天要做什么？">☾　我今天要做什么？</button></div></div><form class="chat-composer" id="chat-form"><input name="message" maxlength="500" placeholder="继续问小康" aria-label="向小康提问"><button type="submit" aria-label="发送">➤</button></form><div id="chat-answer"></div>`,
      "chat",
      "和小康聊聊",
    );
    const promptIcons = ["heart", "droplet", "moon"];
    document
      .querySelectorAll(".suggestion-list [data-chat-prompt]")
      .forEach((button, index) => {
        const label = button.textContent.trim().replace(/^[♥滴☾]\s*/, "");
        button.innerHTML = `<span class="prompt-icon">${iconSvg(promptIcons[index] || "sparkle")}</span><span>${esc(label)}</span>`;
      });
    const ask = async (message) => {
      const answer = document.getElementById("chat-answer");
      if (!message.trim()) return;
      answer.className = "data-card chat-answer";
      answer.innerHTML =
        '<div class="app-loading"><span></span><p>小康正在分析您的健康记录…</p></div>';
      try {
        const result = await API.post("/api/chat", { message });
        answer.textContent = result.content || "暂时没有生成回答";
      } catch (error) {
        answer.textContent = error.message || "小康暂时无法回答，请稍后重试";
      }
    };
    document
      .querySelectorAll("[data-chat-prompt]")
      .forEach((button) =>
        button.addEventListener("click", () => ask(button.dataset.chatPrompt)),
      );
    document.getElementById("chat-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = event.currentTarget.elements.message;
      const value = input.value;
      input.value = "";
      ask(value);
    });
  }

  async function renderKnowledge(query = "") {
    shell(
      '<div class="app-loading"><span></span><p>正在读取健康知识…</p></div>',
      "chat",
      "健康知识",
      { back: true, backTo: "chat" },
    );
    try {
      const data = await API.get(
        `/api/knowledge${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      );
      const items = (data.items || []).slice(0, 20);
      const rows = items.length
        ? items
            .map(
              (item, index) =>
                `<button class="article-row" data-article="${item.id}"><i class="row-icon">${["♥", "☾", "步", "食"][index % 4]}</i><span class="row-copy"><b>${esc(item.title)}</b><small>${esc(item.summary || "点击查看健康知识详情")}</small></span><b>›</b></button>`,
            )
            .join("")
        : '<div class="empty-state"><b>没有找到相关文章</b>换一个关键词再试试</div>';
      shell(
        `<div class="page-heading"><h1>🍃 今日健康贴士</h1><p>科学知识，助力健康生活</p></div><form class="chat-composer" id="knowledge-search" style="margin:0 0 16px"><input name="q" value="${esc(query)}" placeholder="搜索健康知识"><button type="submit" aria-label="搜索">⌕</button></form><div class="data-card" style="padding:0">${rows}</div>`,
        "chat",
        "健康知识",
        { back: true, backTo: "chat" },
      );
      document
        .getElementById("knowledge-search")
        .addEventListener("submit", (event) => {
          event.preventDefault();
          renderKnowledge(new FormData(event.currentTarget).get("q") || "");
        });
      document.querySelectorAll("[data-article]").forEach((button) =>
        button.addEventListener("click", async () => {
          try {
            const item = await API.get(
              `/api/knowledge/${button.dataset.article}`,
            );
            shell(
              `<article class="data-card"><h2>${esc(item.title)}</h2><p>${esc(item.summary || "")}</p><div style="white-space:pre-wrap;line-height:1.8;font-size:14px">${esc(item.body || "暂无正文")}</div><p>来源：${esc(item.source_label || "健康知识库")}</p></article>`,
              "chat",
              "知识详情",
              { back: true, backTo: "knowledge" },
            );
          } catch (error) {
            toast(error.message);
          }
        }),
      );
    } catch (error) {
      shell(
        `<div class="empty-state"><b>知识库暂时不可用</b>${esc(error.message)}</div>`,
        "chat",
        "健康知识",
        { back: true, backTo: "chat" },
      );
    }
  }

  async function renderProfile() {
    shell(
      '<div class="app-loading"><span></span><p>正在读取个人资料…</p></div>',
      "profile",
      "个人资料",
    );
    try {
      const user = await API.get("/api/profile/me");
      state.user = user;
      shell(
        `<div class="profile-hero"><div><h1>我的健康档案</h1><p>完善个人信息，获得更精准的健康服务。</p></div><span class="avatar-large">${esc((user.name || "您").slice(0, 1))}</span></div><form class="data-card form-card" id="profile-form"><label class="field"><span>姓名</span><input name="name" value="${esc(user.name || "")}" required></label><label class="field"><span>年龄</span><input name="age" type="number" min="1" max="120" value="${esc(user.age || "")}"></label><label class="field"><span>身高（厘米）</span><input name="height" type="number" min="80" max="230" value="${esc(user.height || "")}"></label><label class="field"><span>紧急联系人</span><input name="emergency_name" value="${esc(user.emergency_name || "")}" placeholder="姓名"></label><label class="field"><span>紧急联系电话</span><input name="emergency_phone" type="tel" value="${esc(user.emergency_phone || "")}" placeholder="手机号"></label><button class="primary-button" type="submit">保存资料</button></form><div class="data-card" style="padding:0;margin-top:14px"><button class="setting-row" data-view="care"><i class="row-icon">♧</i><span class="row-copy"><b>照护协同</b><small>管理家属和医生授权</small></span><b>›</b></button><button class="setting-row" data-view="settings"><i class="row-icon">⚙</i><span class="row-copy"><b>隐私与设置</b><small>密码、隐私和服务状态</small></span><b>›</b></button></div>`,
        "profile",
        "个人资料",
      );
      const profileForm = document.getElementById("profile-form");
      const heightInput = profileForm.elements.height;
      heightInput.min = "1";
      heightInput.max = "2.2";
      heightInput.step = "0.01";
      heightInput.parentElement.querySelector("span").textContent = "身高（米）";
      document
        .getElementById("profile-form")
        .addEventListener("submit", async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          try {
            state.user = await API.put("/api/profile/me", {
              name: data.get("name"),
              age: Number(data.get("age")) || null,
              height: Number(data.get("height")) || null,
              emergency_name: data.get("emergency_name"),
              emergency_phone: data.get("emergency_phone"),
            });
            toast("个人资料已保存");
          } catch (error) {
            toast(error.message);
          }
        });
    } catch (error) {
      shell(
        `<div class="empty-state"><b>资料暂时不可用</b>${esc(error.message)}</div>`,
        "profile",
        "个人资料",
      );
    }
  }

  async function renderCare() {
    shell(
      '<div class="app-loading"><span></span><p>正在读取照护关系…</p></div>',
      "profile",
      "照护协同",
      { back: true, backTo: "profile" },
    );
    try {
      const data = await API.get("/api/care/relationships");
      const rows = [...(data.as_senior || []), ...(data.as_member || [])];
      const list = rows.length
        ? rows
            .map(
              (row) =>
                `<div class="relationship-row"><i class="row-icon">${row.member_role === "doctor" ? "医" : "人"}</i><span class="row-copy"><b>${esc(row.name || "协作者")}</b><small>${row.effective_status === "active" ? "已授权" : "授权已失效"} · ${esc((row.scope_labels || []).slice(0, 2).join("、"))}</small></span><span class="row-value">${row.effective_status === "active" ? "有效" : "失效"}</span></div>`,
            )
            .join("")
        : '<div class="empty-state"><b>还没有协作者</b>您可以邀请家属或医生共同守护健康</div>';
      const owner = (state.user?.role || "senior") === "senior";
      shell(
        `<div class="page-heading"><h1>我的家属和医生</h1><p>授权后，对方只能查看您明确同意的健康信息</p></div><div class="data-card" style="padding:0">${list}</div>${owner ? `<form class="data-card form-card" id="invite-form" style="margin-top:16px"><h3>邀请家属或医生</h3><label class="field"><span>角色</span><select name="member_role"><option value="caregiver">家属</option><option value="doctor">医生</option></select></label><label class="field"><span>授权有效天数</span><input name="valid_days" type="number" min="1" max="365" value="30"></label><button class="primary-button" type="submit">生成一次性授权码</button><p id="invite-result" style="text-align:center;font-size:14px"></p></form>` : ""}`,
        "profile",
        "照护协同",
        { back: true, backTo: "profile" },
      );
      document
        .getElementById("invite-form")
        ?.addEventListener("submit", async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget),
            role = data.get("member_role");
          try {
            const capabilities = await API.get("/api/care/capabilities");
            const definitions = capabilities.definitions || {};
            const caregiver = [
              "view_summary",
              "view_alerts",
              "view_retest",
              "manage_followups",
              "view_interventions",
              "view_adherence",
              "record_intake",
              "remind_execution",
              "record_adherence",
              "use_agent",
            ];
            const doctor = [
              "view_summary",
              "view_alerts",
              "view_retest",
              "view_interventions",
              "view_adherence",
              "view_trends",
              "view_clinical_evidence",
              "review_graphrag",
              "review_interventions",
              "use_agent",
            ];
            const scopes = (role === "doctor" ? doctor : caregiver).filter(
              (scope) => scope in definitions,
            );
            const invite = await API.post("/api/care/invitations", {
              member_role: role,
              valid_days: Number(data.get("valid_days")),
              scopes,
            });
            document.getElementById("invite-result").innerHTML =
              `授权码：<strong style="font-size:22px;letter-spacing:2px">${esc(invite.code)}</strong><br><small>请只发给指定的${role === "doctor" ? "医生" : "家属"}</small>`;
          } catch (error) {
            toast(error.message);
          }
        });
    } catch (error) {
      shell(
        `<div class="empty-state"><b>照护关系暂时不可用</b>${esc(error.message)}</div>`,
        "profile",
        "照护协同",
        { back: true, backTo: "profile" },
      );
    }
  }

  async function renderSettings() {
    shell(
      '<div class="app-loading"><span></span><p>正在读取设置…</p></div>',
      "profile",
      "隐私与设置",
      { back: true, backTo: "profile" },
    );
    let llm = {};
    try {
      llm = await API.get("/api/settings/llm/status");
    } catch {}
    shell(
      `<div class="profile-hero"><div><h1>隐私与设置</h1><p>管理账号安全与服务设置，安心使用小康健康。</p></div><span class="avatar-large">锁</span></div><div class="data-card" style="padding:0"><button class="setting-row" data-view="care"><i class="row-icon">人</i><span class="row-copy"><b>谁可以查看我的数据</b><small>管理家属、医生等授权</small></span><b>›</b></button><button class="setting-row" data-view="knowledge"><i class="row-icon">书</i><span class="row-copy"><b>健康知识来源</b><small>查看经过治理的知识内容</small></span><b>›</b></button><div class="setting-row"><i class="row-icon">AI</i><span class="row-copy"><b>智能管家服务</b><small>${esc(llm.configured ? `${llm.provider || "模型"}已连接` : "本地安全降级模式")}</small></span><span class="row-value">${llm.configured ? "可用" : "降级"}</span></div></div><form class="data-card form-card" id="password-form" style="margin-top:16px"><h3>修改密码</h3><label class="field"><span>当前密码</span><input name="old_password" type="password" autocomplete="current-password" required></label><label class="field"><span>新密码</span><input name="new_password" type="password" autocomplete="new-password" minlength="6" required></label><button class="black-button" type="submit">更新密码</button></form><button class="outline-button danger-text" id="logout" style="margin-top:14px">退出登录</button>`,
      "profile",
      "隐私与设置",
      { back: true, backTo: "profile" },
    );
    document
      .getElementById("password-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        try {
          const result = await API.post("/api/profile/password", {
            old_password: data.get("old_password"),
            new_password: data.get("new_password"),
          });
          toast(result.message || "密码已更新");
          event.currentTarget.reset();
        } catch (error) {
          toast(error.message);
        }
      });
    document.getElementById("logout").addEventListener("click", async () => {
      try {
        await API.post("/api/auth/logout", {});
      } catch {}
      state.user = null;
      renderLogin();
    });
  }

  function navigate(view) {
    if (!view) return;
    state.previous = state.view || "home";
    state.view = view;
    history.replaceState(null, "", `/mobile?view=${encodeURIComponent(view)}`);
    if (view.startsWith("record-") && metricMeta[view.slice(7)]) {
      renderRecord(view.slice(7));
      return;
    }
    const routes = {
      home: renderHome,
      monitor: renderMonitor,
      record: () => renderRecord("bp"),
      "record-bp": () => renderRecord("bp"),
      trends: renderTrends,
      plans: renderPlans,
      assessment: renderAssessment,
      risk: renderRisk,
      chat: renderChat,
      knowledge: renderKnowledge,
      profile: renderProfile,
      care: renderCare,
      settings: renderSettings,
    };
    (routes[view] || renderHome)();
  }

  async function init() {
    try {
      state.user = await API.get("/api/auth/me");
      navigate(state.view);
    } catch (error) {
      renderLogin(error.status && error.status !== 401 ? error.message : "");
    }
  }

  init();
})();
