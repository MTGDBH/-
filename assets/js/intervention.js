(function () {
  'use strict';

  const STATUS = {
    proposed: { label: '草案待提交', icon: '？', tone: 'pending' },
    pending_confirmation: { label: '等待本人确认', icon: '？', tone: 'pending' },
    active: { label: '正在执行', icon: '行', tone: 'active' },
    evaluating: { label: '等待效果评价', icon: '测', tone: 'retest' },
    completed: { label: '已完成记录', icon: '果', tone: 'result' },
    insufficient_data: { label: '数据不足，无法判断', icon: '缺', tone: 'paused' },
    safety_stopped: { label: '因安全原因已暂停', icon: '停', tone: 'paused' },
    cancelled: { label: '计划已取消', icon: '停', tone: 'paused' },
  };
  const METRICS = { bp: '血压', glucose: '血糖', hr: '心率', steps: '步数', sleep: '睡眠', weight: '体重', spo2: '血氧' };
  const EVIDENCE = {
    insufficient: '证据不足', descriptive_only: '仅描述性个人记录',
    personal_preliminary: '个人初步证据', personal_repeated: '个人重复证据',
  };
  const state = { items: [], accessRole: 'self', subjectId: null, currentUser: null, pendingAction: null };

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function dateText(value, withTime = false) {
    if (!value || Number.isNaN(Date.parse(value))) return '尚未安排';
    const date = new Date(value);
    const options = withTime
      ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'long', day: 'numeric' };
    return new Intl.DateTimeFormat('zh-CN', options).format(date);
  }

  function numberText(value, unit = '') {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '无法计算';
    return `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;
  }

  function adherenceText(item) {
    const logs = latestLogs(item.execution_logs || []);
    const evaluation = item.evaluations?.[0]?.result;
    if (logs.length < 3 && evaluation?.evidence_level !== 'insufficient' && Number.isFinite(Number(evaluation?.adherence_rate))) {
      return `${Math.round(Number(evaluation.adherence_rate) * 100)}%（效果评价记录）`;
    }
    if (logs.length < 3) return logs.length ? `数据积累中（已记录 ${logs.length} 次）` : '尚无执行记录';
    const completed = logs.filter(log => log.performed).length;
    return `${Math.round((completed / logs.length) * 100)}%（${completed}/${logs.length} 次）`;
  }

  function latestLogs(logs) {
    const superseded = new Set(logs.map(log => log.supersedes_execution_log_id).filter(Boolean));
    return logs.filter(log => !superseded.has(log.execution_log_id));
  }

  function classify(item, now = new Date()) {
    if (['proposed', 'pending_confirmation'].includes(item.status)) return 'pending';
    if (item.status === 'completed') return 'completed';
    if (['insufficient_data', 'safety_stopped', 'cancelled'].includes(item.status)) return 'paused';
    if (item.status === 'evaluating' || (item.status === 'active' && item.outcome_start && new Date(item.outcome_start) <= now)) return 'retest';
    return 'active';
  }

  function canManage() { return state.accessRole === 'self'; }
  function canRecord() { return state.accessRole === 'self' || state.accessRole === 'caregiver'; }
  function protocolText(item, key, fallback) { return item.protocol?.[key] || fallback; }
  function metricText(item) { return (item.target_metrics || []).map(metric => METRICS[metric] || metric).join('、') || '尚未设置'; }
  function sourceText(item) { return (item.evidence_source_ids || []).length ? item.evidence_source_ids.join('；') : '未提供外部证据编号'; }
  function safetyText(item) { return protocolText(item, 'safety', '出现胸痛、呼吸困难、明显头晕或其他不适时立即停止，并联系家属或医生。'); }

  function emptyHTML(kind) {
    const copy = {
      pending: ['暂无待确认计划', '智能管家提出计划后，会先在这里等您确认。'],
      active: ['暂无进行中计划', '已确认的改善计划会显示在这里。'],
      today: ['今天没有需要打卡的计划', '今天可以安心按原有节奏生活。'],
      retest: ['暂无待复测计划', '到达复测时间后会在这里提醒您。'],
      completed: ['暂无已完成效果', '完成执行和复测后，可在这里查看个人结果。'],
      paused: ['暂无暂停计划', '数据不足、主动取消或安全暂停的计划会显示在这里。'],
    }[kind];
    return `<div class="intervention-empty"><span aria-hidden="true">○</span><div><strong>${copy[0]}</strong><p>${copy[1]}</p></div></div>`;
  }

  function planDetails(item) {
    return `<dl class="plan-details">
      <div><dt>干预内容</dt><dd>${escapeHTML(protocolText(item, 'action', item.title || '尚未填写'))}</dd></div>
      <div><dt>目标指标</dt><dd>${escapeHTML(metricText(item))}</dd></div>
      <div><dt>执行周期</dt><dd>${escapeHTML(dateText(item.intervention_start))} 至 ${escapeHTML(dateText(item.intervention_end))}</dd></div>
      <div><dt>今日任务</dt><dd>${escapeHTML(protocolText(item, 'frequency', '按计划执行'))} · ${escapeHTML(protocolText(item, 'action', item.title || '按计划执行'))}</dd></div>
      <div><dt>依从率</dt><dd>${escapeHTML(adherenceText(item))}</dd></div>
      <div><dt>下次复测时间</dt><dd>${escapeHTML(dateText(item.outcome_start, true))}</dd></div>
    </dl>`;
  }

  function evidenceAndSafety(item) {
    return `<details class="plan-safety"><summary>证据来源与安全提示</summary><div><p><strong>证据来源：</strong>${escapeHTML(sourceText(item))}</p><p><strong>安全提示：</strong>${escapeHTML(safetyText(item))}</p></div></details>`;
  }

  function actionButtons(item, context = 'card') {
    const id = escapeHTML(item.intervention_id);
    const evidence = `<button class="btn btn-ghost" type="button" data-action="evidence" data-id="${id}">查看证据</button>`;
    if (context === 'today') {
      if (!canRecord()) return `${evidence}<span class="permission-note">仅本人或获授权家属可记录</span>`;
      return `<button class="btn btn-primary" type="button" data-action="checkin" data-id="${id}">✓ 今日打卡</button><button class="btn btn-secondary" type="button" data-action="backfill" data-id="${id}">补记</button>${evidence}`;
    }
    if (item.status === 'pending_confirmation' && canManage()) return `<button class="btn btn-primary" type="button" data-action="confirm" data-id="${id}">✓ 确认计划</button><button class="btn btn-secondary" type="button" data-action="reject" data-id="${id}">× 拒绝</button>${evidence}`;
    if (item.status === 'proposed' && canManage()) return `<button class="btn btn-primary" type="button" data-action="submit" data-id="${id}">提交本人确认</button><button class="btn btn-secondary" type="button" data-action="reject" data-id="${id}">× 拒绝</button>${evidence}`;
    if (item.status === 'active' && canManage()) return `<button class="btn btn-secondary" type="button" data-action="cancel" data-id="${id}">暂停或取消</button>${evidence}`;
    return `${evidence}${!canManage() && ['proposed', 'pending_confirmation', 'active'].includes(item.status) ? '<span class="permission-note">当前账号仅可查看</span>' : ''}`;
  }

  function planCard(item, context = 'card') {
    const status = STATUS[item.status] || { label: '状态待核实', icon: '·', tone: 'paused' };
    const isPaused = ['insufficient_data', 'safety_stopped', 'cancelled'].includes(item.status);
    return `<article class="intervention-card tone-${status.tone}" data-plan-id="${escapeHTML(item.intervention_id)}">
      <div class="plan-card-head"><span class="status-symbol" aria-hidden="true">${status.icon}</span><div><span class="status-label">${escapeHTML(status.label)}</span><h3>${escapeHTML(item.title || '未命名改善计划')}</h3></div></div>
      ${isPaused ? `<div class="plan-state-explanation"><strong>${status.icon} ${escapeHTML(status.label)}</strong><p>${escapeHTML(item.status_message || (item.status === 'insufficient_data' ? '记录数量不足，系统没有生成效果百分比。' : '该计划当前不再执行。'))}</p></div>` : ''}
      ${planDetails(item)}
      ${evidenceAndSafety(item)}
      <div class="plan-actions">${actionButtons(item, context)}</div>
    </article>`;
  }

  function resultCard(item) {
    const evaluation = item.evaluations?.[0]?.result;
    if (!evaluation) return `${planCard(item)}<div class="result-missing" role="note"><strong>○ 暂无可展示的效果评价</strong><p>计划记录已完成，但尚未生成独立效果评价，因此不显示变化百分比。</p></div>`;
    const insufficient = evaluation.evidence_level === 'insufficient' || evaluation.baseline_summary == null || evaluation.outcome_summary == null;
    const unit = evaluation.target_metric?.unit || '';
    const count = evaluation.measurement_count || {};
    if (insufficient) return `<article class="intervention-card result-card tone-paused"><div class="plan-card-head"><span class="status-symbol" aria-hidden="true">缺</span><div><span class="status-label">数据不足，无法判断</span><h3>${escapeHTML(item.title)}</h3></div></div>${planDetails(item)}<div class="insufficient-result"><strong>未生成效果百分比</strong><p>${escapeHTML(evaluation.message || '个人基线或干预后数据不足。')}</p><p>现有数据量：基线 ${Number(count.baseline || 0)} 次，干预后 ${Number(count.outcome || 0)} 次。</p></div>${evidenceAndSafety(item)}<div class="plan-actions">${actionButtons(item)}</div></article>`;
    const interval = evaluation.uncertainty_interval;
    const change = numberText(evaluation.absolute_change, unit);
    const direction = Number(evaluation.absolute_change) === 0 ? '变化不明显' : Number(evaluation.absolute_change) > 0 ? '数值上升' : '数值下降';
    const confounders = evaluation.confounders?.length ? evaluation.confounders.map(c => c.message || c.code).join('；') : '未记录明显混杂因素';
    return `<article class="intervention-card result-card tone-result">
      <div class="plan-card-head"><span class="status-symbol" aria-hidden="true">果</span><div><span class="status-label">个人效果记录</span><h3>${escapeHTML(item.title)}</h3></div></div>
      ${planDetails(item)}
      <div class="result-comparison" aria-label="个人基线与干预后结果对比"><div><span>个人基线</span><strong>${escapeHTML(numberText(evaluation.baseline_summary?.value, unit))}</strong></div><span class="result-arrow" aria-hidden="true">→</span><div><span>干预后结果</span><strong>${escapeHTML(numberText(evaluation.outcome_summary?.value, unit))}</strong></div></div>
      <dl class="result-details">
        <div><dt>变化幅度</dt><dd><span class="result-word-icon" aria-hidden="true">↕</span>${escapeHTML(direction)}，绝对变化 ${escapeHTML(change)}</dd></div>
        <div><dt>不确定区间</dt><dd>${interval ? `${escapeHTML(numberText(interval.lower, unit))} 至 ${escapeHTML(numberText(interval.upper, unit))}（${Math.round(Number(interval.confidence_level || .95) * 100)}% 区间）` : '无法计算'}</dd></div>
        <div><dt>数据量</dt><dd>基线 ${Number(count.baseline || 0)} 次，干预后 ${Number(count.outcome || 0)} 次，共 ${Number(count.total || 0)} 次</dd></div>
        <div><dt>证据等级</dt><dd>${escapeHTML(EVIDENCE[evaluation.evidence_level] || '尚未分级')}</dd></div>
        <div><dt>混杂因素</dt><dd>${escapeHTML(confounders)}</dd></div>
      </dl>
      <p class="result-boundary"><strong>说明：</strong>${escapeHTML(evaluation.message || '这是个人观察结果，不代表临床因果关系。')}</p>
      ${evidenceAndSafety(item)}
      <div class="plan-actions">${actionButtons(item)}</div>
    </article>`;
  }

  function todayCard(item) {
    return `<article class="intervention-card today-card tone-active" data-plan-id="${escapeHTML(item.intervention_id)}"><div class="plan-card-head"><span class="status-symbol" aria-hidden="true">今</span><div><span class="status-label">今天要做</span><h3>${escapeHTML(protocolText(item, 'action', item.title))}</h3><p>${escapeHTML(item.title)}</p></div></div><div class="today-meta"><span>目标：${escapeHTML(metricText(item))}</span><span>当前记录：${escapeHTML(adherenceText(item))}</span></div><p class="today-safety">盾 ${escapeHTML(safetyText(item))}</p><div class="plan-actions">${actionButtons(item, 'today')}</div></article>`;
  }

  async function enrichItem(item) {
    const [detail, evaluations] = await Promise.allSettled([
      API.get(`/api/actions/interventions/${encodeURIComponent(item.intervention_id)}`),
      API.get(`/api/actions/interventions/${encodeURIComponent(item.intervention_id)}/evaluations`),
    ]);
    return {
      ...item,
      ...(detail.status === 'fulfilled' ? detail.value.intervention : {}),
      access: detail.status === 'fulfilled' ? detail.value.access : null,
      evaluations: evaluations.status === 'fulfilled' ? evaluations.value.items : [],
      detail_error: detail.status === 'rejected' || evaluations.status === 'rejected',
    };
  }

  function render(items) {
    const groups = { pending: [], active: [], today: [], retest: [], completed: [], paused: [] };
    items.forEach(item => {
      const group = classify(item);
      groups[group].push(item);
      if (item.status === 'active' && classify(item) === 'active') groups.today.push(item);
    });
    Object.entries(groups).forEach(([kind, rows]) => {
      const host = document.querySelector(`[data-list="${kind}"]`);
      const count = document.querySelector(`[data-count="${kind}"]`);
      count.textContent = `${rows.length} 项`;
      host.innerHTML = rows.length ? rows.map(item => kind === 'completed' ? resultCard(item) : kind === 'today' ? todayCard(item) : planCard(item)).join('') : emptyHTML(kind);
    });
    document.getElementById('intervention-sections').setAttribute('aria-busy', 'false');
  }

  function showError(error) {
    const box = document.getElementById('intervention-error');
    const copy = errorCopy(error);
    document.getElementById('intervention-error-title').textContent = copy.title;
    document.getElementById('intervention-error-message').textContent = copy.message;
    box.hidden = false;
    document.getElementById('intervention-sections').hidden = true;
  }

  function errorCopy(error) {
    const message = error?.message || '';
    const forbidden = /权限|授权|只有老人|403|不能默认读取/.test(message);
    return forbidden
      ? { title: '当前账号权限不足', message: '您没有查看该老人改善计划的授权，请让本人重新授权。' }
      : { title: '计划暂时无法读取', message: message || '请检查网络后重试，已保存的数据不会丢失。' };
  }

  async function load() {
    const live = document.getElementById('intervention-live');
    live.hidden = false; live.textContent = '正在读取改善计划…';
    document.getElementById('intervention-error').hidden = true;
    document.getElementById('intervention-sections').hidden = false;
    try {
      const params = new URLSearchParams(location.search);
      state.subjectId = Number(params.get('subject_user_id')) || state.currentUser?.id;
      const data = await API.get(`/api/actions/interventions?subject_user_id=${encodeURIComponent(state.subjectId)}`);
      state.accessRole = data.access_role || 'self';
      const settled = await Promise.all(data.items.map(enrichItem));
      state.items = settled;
      render(state.items);
      live.textContent = state.items.length ? `已读取 ${state.items.length} 个计划` : '当前还没有改善计划';
      setTimeout(() => { live.hidden = true; }, 1200);
    } catch (error) {
      live.hidden = true;
      showError(error);
    }
  }

  function itemById(id) { return state.items.find(item => item.intervention_id === id); }
  function openEvidence(item) {
    const dialog = document.getElementById('evidence-dialog');
    const sources = item.evidence_source_ids || [];
    document.getElementById('evidence-content').innerHTML = sources.length
      ? `<ul>${sources.map(source => `<li><span aria-hidden="true">据</span><div><strong>${escapeHTML(source)}</strong><p>证据编号来自计划创建记录；可交由医生或智能管家进一步核对原文。</p></div></li>`).join('')}</ul><a class="btn btn-secondary" href="knowledge.html?query=${encodeURIComponent(sources[0])}">到健康知识中查询</a>`
      : '<div class="intervention-empty"><span aria-hidden="true">○</span><div><strong>没有登记证据编号</strong><p>请先向计划提出者核实来源，不要据此自行调整用药。</p></div></div>';
    dialog.showModal();
  }

  const ACTION_COPY = {
    submit: ['提交计划确认', '提交后仍需本人再次确认，计划不会立即开始。', '提交'],
    confirm: ['确认开始这项计划', '请再次核对干预内容、周期和安全提示。确认后计划将进入执行阶段。', '确认开始'],
    reject: ['拒绝这项计划', '拒绝后计划不会执行，并会保留原因供后续查看。', '确认拒绝'],
    checkin: ['确认今日已执行', '本次打卡将写入您的个人健康记录。', '确认打卡'],
    backfill: ['补记一次执行', '请选择真实执行时间；补记会写入个人健康记录。', '确认补记'],
    cancel: ['暂停或取消计划', '取消后将停止后续执行与评价流程。如因身体不适，请先联系家属或医生。', '确认取消'],
  };

  function openConfirm(action, item) {
    const dialog = document.getElementById('intervention-dialog');
    const [title, message, button] = ACTION_COPY[action];
    state.pendingAction = { action, item };
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-message').textContent = `${message} 当前计划：“${item.title}”。`;
    document.getElementById('dialog-confirm').textContent = button;
    document.getElementById('dialog-icon').textContent = action === 'confirm' || action === 'checkin' ? '✓' : action === 'backfill' ? '记' : '!';
    const needsReason = ['reject', 'cancel'].includes(action);
    document.getElementById('dialog-reason-wrap').hidden = !needsReason;
    document.getElementById('dialog-reason-label').textContent = action === 'reject' ? '请填写拒绝原因（必填）' : '请填写暂停或取消原因（必填）';
    document.getElementById('dialog-time-wrap').hidden = action !== 'backfill';
    document.getElementById('dialog-reason').value = '';
    document.getElementById('dialog-time').value = '';
    document.getElementById('dialog-confirm-check').checked = false;
    document.getElementById('dialog-confirm').disabled = true;
    dialog.showModal();
    document.getElementById('dialog-confirm-check').focus();
  }

  async function performAction() {
    const pending = state.pendingAction;
    if (!pending) return;
    const { action, item } = pending;
    const reason = document.getElementById('dialog-reason').value.trim();
    const timeValue = document.getElementById('dialog-time').value;
    if (['reject', 'cancel'].includes(action) && !reason) {
      document.getElementById('dialog-reason').setCustomValidity('请填写原因');
      document.getElementById('dialog-reason').reportValidity();
      return;
    }
    if (action === 'backfill' && !timeValue) {
      document.getElementById('dialog-time').setCustomValidity('请选择补记时间');
      document.getElementById('dialog-time').reportValidity();
      return;
    }
    const button = document.getElementById('dialog-confirm');
    button.disabled = true; button.textContent = '正在保存…';
    const root = `/api/actions/interventions/${encodeURIComponent(item.intervention_id)}`;
    try {
      if (action === 'submit') await API.post(`${root}/submit`, {});
      if (action === 'confirm') await API.post(`${root}/confirm`, {});
      if (action === 'reject') await API.post(`${root}/reject`, { reason });
      if (action === 'cancel') await API.post(`${root}/cancel`, { reason });
      if (action === 'checkin' || action === 'backfill') await API.post(`${root}/executions`, {
        performed: true,
        performed_at: action === 'backfill' ? new Date(timeValue).toISOString() : new Date().toISOString(),
        data_source: state.accessRole === 'caregiver' ? 'caregiver_report' : 'self_report',
        idempotency_key: `${action}-${item.intervention_id}-${action === 'backfill' ? timeValue : new Date().toISOString().slice(0, 10)}`,
      });
      document.getElementById('intervention-dialog').close();
      state.pendingAction = null;
      await load();
      const live = document.getElementById('intervention-live'); live.hidden = false; live.textContent = '操作已保存';
    } catch (error) {
      button.disabled = false; button.textContent = ACTION_COPY[action][2];
      document.getElementById('dialog-message').textContent = `未能保存：${error.message}。请核对后重试。`;
    }
  }

  function bind() {
    document.getElementById('intervention-retry').addEventListener('click', load);
    document.getElementById('intervention-sections').addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const item = itemById(button.dataset.id);
      if (!item) return;
      if (button.dataset.action === 'evidence') openEvidence(item);
      else openConfirm(button.dataset.action, item);
    });
    document.getElementById('dialog-confirm-check').addEventListener('change', event => {
      document.getElementById('dialog-confirm').disabled = !event.target.checked;
    });
    document.getElementById('dialog-confirm-check').addEventListener('keydown', event => {
      if (![' ', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      event.currentTarget.checked = !event.currentTarget.checked;
      event.currentTarget.dispatchEvent(new Event('change', { bubbles: true }));
    });
    document.getElementById('dialog-reason').addEventListener('input', event => event.target.setCustomValidity(''));
    document.getElementById('dialog-time').addEventListener('input', event => event.target.setCustomValidity(''));
    document.getElementById('dialog-cancel').addEventListener('click', () => document.getElementById('intervention-dialog').close());
    document.getElementById('intervention-dialog').addEventListener('cancel', event => {
      event.preventDefault();
      state.pendingAction = null;
      event.currentTarget.close();
    });
    document.getElementById('intervention-dialog').addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      state.pendingAction = null;
      event.currentTarget.close();
    });
    document.getElementById('intervention-dialog-form').addEventListener('submit', event => { event.preventDefault(); performAction(); });
    document.getElementById('evidence-close').addEventListener('click', () => document.getElementById('evidence-dialog').close());
  }

  document.addEventListener('auth:ready', event => { state.currentUser = event.detail; bind(); load(); }, { once: true });
  window.InterventionPageContract = { escapeHTML, classify, adherenceText, planCard, resultCard, emptyHTML, errorCopy };
})();
