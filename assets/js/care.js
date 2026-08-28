(function () {
  'use strict';

  const ROLE_LABEL = { senior: '老人本人', caregiver: '家属', doctor: '医生' };
  const STATUS_LABEL = { active: '✓ 授权有效', revoked: '⊘ 已撤回', expired: '⌛ 已到期' };
  const METRIC_LABEL = { bp: '血压', glucose: '血糖', hr: '心率', spo2: '血氧', weight: '体重', sleep: '睡眠', steps: '步数' };
  const state = { user: null, definitions: {}, roleScopes: {}, relationships: [], subjects: [], pending: null, entrySubject: null };

  const $ = selector => document.querySelector(selector);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dateText = value => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '尚无记录';
  const countText = (items, empty = '无') => Array.isArray(items) && items.length ? `${items.length} 项` : empty;
  const allowed = (card, scope) => Boolean(card.capabilities?.[scope]);

  function setLive(message) { $('#care-live').textContent = message; }
  function showError(error) {
    $('#care-error-message').textContent = error?.message || '请检查网络连接后重试。';
    $('#care-error').hidden = false;
    setLive('读取失败');
  }
  function clearError() { $('#care-error').hidden = true; }

  function emptyState(title, text) {
    return `<div class="care-empty"><span aria-hidden="true">○</span><div><strong>${escapeHTML(title)}</strong><p>${escapeHTML(text)}</p></div></div>`;
  }

  function scopeOptions(role, selected = []) {
    const options = state.roleScopes[role] || [];
    return options.map(scope => `<label class="care-scope-option"><input type="checkbox" name="scopes" value="${escapeHTML(scope)}" ${selected.includes(scope) ? 'checked' : ''}><span><strong>${escapeHTML(state.definitions[scope] || scope)}</strong><small>${escapeHTML(scope)}</small></span></label>`).join('');
  }

  function renderInviteScopes() {
    const role = $('#invite-role').value;
    $('#invite-scopes').innerHTML = scopeOptions(role, state.roleScopes[role] || []);
  }

  function authorizationSummary(auth) {
    return `<dl class="care-auth-summary">
      <div><dt>授权状态</dt><dd><span class="care-status status-${escapeHTML(auth.effective_status)}">${STATUS_LABEL[auth.effective_status] || '状态待核实'}</span></dd></div>
      <div><dt>有效期至</dt><dd>${escapeHTML(dateText(auth.expires_at))}</dd></div>
      <div><dt>最后访问</dt><dd>${escapeHTML(dateText(auth.last_access_at))}</dd></div>
      <div><dt>授权版本</dt><dd>第 ${Number(auth.revision || 1)} 版</dd></div>
    </dl>`;
  }

  function relationshipCard(row) {
    const active = row.effective_status === 'active';
    return `<article class="care-card">
      <div class="care-card-head"><span class="care-avatar" style="--avatar:${escapeHTML(row.avatar_color || '#D88A4B')}">${escapeHTML((row.name || '协').slice(0, 1))}</span><div><p>${escapeHTML(ROLE_LABEL[row.member_role] || row.member_role)}</p><h3>${escapeHTML(row.name || '未命名协作者')}</h3></div></div>
      ${authorizationSummary(row)}
      <div class="care-scopes"><strong>已授权范围</strong><ul>${row.scope_labels.map(label => `<li><span aria-hidden="true">✓</span>${escapeHTML(label)}</li>`).join('')}</ul></div>
      ${row.revoked_reason ? `<p class="care-boundary"><strong>撤回原因：</strong>${escapeHTML(row.revoked_reason)}</p>` : ''}
      <div class="care-card-actions">
        <button class="btn btn-secondary" type="button" data-care-action="logs" data-id="${row.id}">查看操作日志</button>
        ${active ? `<button class="btn btn-secondary" type="button" data-care-action="edit" data-id="${row.id}">调整范围</button><button class="btn btn-ghost care-danger" type="button" data-care-action="revoke" data-id="${row.id}">撤回授权</button>` : ''}
      </div>
    </article>`;
  }

  function renderRelationships() {
    $('#relations-count').textContent = `${state.relationships.length} 项`;
    $('#relationships-list').innerHTML = state.relationships.length
      ? state.relationships.map(relationshipCard).join('')
      : emptyState('还没有授权关系', '创建限时授权码后，家属或医生接受时会出现在这里。');
  }

  function healthText(item) {
    if (!item) return '暂无数据';
    const value = item.value2 != null ? `${item.value}/${item.value2}` : item.value;
    return `${METRIC_LABEL[item.type] || item.type} ${value ?? '—'} ${item.unit || ''}`;
  }

  function subjectCard(card) {
    const senior = card.senior;
    const health = card.recent_health || [];
    const alerts = card.severe_alerts;
    const retests = card.overdue_retests;
    const plans = card.active_interventions;
    const execution = card.recent_execution;
    return `<article class="care-card care-subject-card" data-subject="${senior.id}">
      <div class="care-card-head"><span class="care-avatar" style="--avatar:${escapeHTML(senior.avatar_color || '#D88A4B')}">${escapeHTML((senior.name || '长').slice(0, 1))}</span><div><p>${escapeHTML(ROLE_LABEL[card.authorization.member_role])}授权照护</p><h3>${escapeHTML(senior.name)}</h3><span>${senior.age ? `${Number(senior.age)} 岁` : '年龄未记录'}</span></div></div>
      <div class="care-data-grid">
        ${allowed(card, 'view_summary') ? `<div><span>最近健康状态</span><strong>${health.length ? escapeHTML(healthText(health[0])) : '○ 暂无近期数据'}</strong></div>` : ''}
        ${allowed(card, 'view_alerts') ? `<div><span>严重预警</span><strong>${alerts?.length ? `! ${alerts.length} 条待处理` : '✓ 暂无严重预警'}</strong></div>` : ''}
        ${allowed(card, 'view_retest') ? `<div><span>逾期复测</span><strong>${retests?.length ? `⌛ ${retests.length} 项待完成` : '✓ 暂无逾期复测'}</strong></div>` : ''}
        ${allowed(card, 'view_summary') ? `<div><span>数据缺失</span><strong>${card.data_missing?.length ? `○ ${card.data_missing.map(x => METRIC_LABEL[x] || x).join('、')}` : '✓ 常用指标较完整'}</strong></div>` : ''}
        ${allowed(card, 'view_interventions') ? `<div><span>活跃改善计划</span><strong>${plans?.length ? `行 ${plans.length} 项进行中` : '○ 暂无活跃计划'}</strong></div>` : ''}
        ${allowed(card, 'view_adherence') ? `<div><span>最近执行情况</span><strong>${execution?.length ? `${execution[0].performed ? '✓ 已执行' : '○ 未执行'} · ${dateText(execution[0].performed_at)}` : '○ 尚无执行记录'}</strong></div>` : ''}
      </div>
      <details class="care-scope-details"><summary>查看授权摘要</summary>${authorizationSummary(card.authorization)}<ul>${card.authorization.scope_labels.map(label => `<li>✓ ${escapeHTML(label)}</li>`).join('')}</ul></details>
      <div class="care-card-actions">
        ${allowed(card, 'record_intake') ? `<button class="btn btn-primary" type="button" data-care-action="intake" data-subject="${senior.id}">协助录入</button>` : ''}
        ${allowed(card, 'remind_execution') ? `<button class="btn btn-secondary" type="button" data-care-action="remind" data-subject="${senior.id}">提醒执行</button>` : ''}
        ${allowed(card, 'view_retest') ? `<button class="btn btn-secondary" type="button" data-care-action="retests" data-subject="${senior.id}">查看复测状态</button>` : ''}
        ${allowed(card, 'view_trends') ? `<a class="btn btn-secondary" href="monitoring.html?subject_user_id=${senior.id}">查看完整趋势</a>` : ''}
        ${allowed(card, 'view_clinical_evidence') ? `<button class="btn btn-secondary" type="button" data-care-action="evidence" data-subject="${senior.id}">证据与模型限制</button>` : ''}
        ${allowed(card, 'review_graphrag') ? `<button class="btn btn-secondary" type="button" data-care-action="graph" data-subject="${senior.id}">审核高风险关系</button>` : ''}
        ${allowed(card, 'review_interventions') ? `<button class="btn btn-secondary" type="button" data-care-action="plan-review" data-subject="${senior.id}">干预审核意见</button>` : ''}
      </div>
      <p class="care-boundary">盾 以上字段由服务端按当前授权范围裁剪；未授权字段不会下发到页面。</p>
    </article>`;
  }

  function renderSubjects() {
    $('#subjects-count').textContent = `${state.subjects.length} 位`;
    $('#subjects-list').innerHTML = state.subjects.length
      ? state.subjects.map(subjectCard).join('')
      : emptyState('暂无有效照护授权', '请使用老人提供的一次性授权码；已撤回或到期的对象不会显示。');
  }

  async function load() {
    clearError(); setLive('正在核验角色与授权…');
    try {
      state.user = window.__CURRENT_USER__ || await Auth.getMe();
      const capabilities = await API.get('/api/care/capabilities');
      state.definitions = capabilities.definitions || {};
      state.roleScopes.caregiver = Object.keys(state.definitions).filter(scope => ['view_summary','view_alerts','view_retest','manage_followups','view_interventions','view_adherence','record_intake','remind_execution','record_adherence','use_agent'].includes(scope));
      state.roleScopes.doctor = Object.keys(state.definitions).filter(scope => ['view_summary','view_alerts','view_retest','view_interventions','view_adherence','view_trends','view_clinical_evidence','review_graphrag','review_interventions','use_agent'].includes(scope));
      const owner = !state.user.role || state.user.role === 'senior';
      $('#owner-console').hidden = !owner;
      $('#member-console').hidden = owner;
      $('#accept-panel').hidden = owner;
      if (owner) {
        const data = await API.get('/api/care/relationships');
        state.relationships = data.as_senior || [];
        renderInviteScopes(); renderRelationships();
      } else {
        const data = await API.get('/api/care/subjects');
        state.subjects = data.items || [];
        renderSubjects();
      }
      setLive(`已按“${ROLE_LABEL[state.user.role || 'senior']}”权限完成核验。`);
    } catch (error) { showError(error); }
  }

  function confirmAction({ title, message, label, action }) {
    state.pending = action;
    $('#care-confirm-title').textContent = title;
    $('#care-confirm-message').textContent = message;
    $('#care-confirm-label').textContent = label || '我已看清影响，并确认继续';
    $('#care-confirm-check').checked = false;
    $('#care-confirm-submit').disabled = true;
    $('#care-confirm-dialog').showModal();
    $('#care-confirm-check').focus();
  }

  function showDetail(title, html) {
    $('#care-detail-title').textContent = title;
    $('#care-detail-content').innerHTML = html;
    $('#care-detail-dialog').showModal();
  }

  async function createInvitation(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const role = $('#invite-role').value;
    const scopes = [...form.querySelectorAll('[name="scopes"]:checked')].map(input => input.value);
    if (!scopes.length) return showError(new Error('请至少选择一项授权范围。'));
    try {
      const data = await API.post('/api/care/invitations', { member_role: role, scopes, valid_days: Number($('#invite-days').value) });
      const result = $('#invite-result');
      result.hidden = false;
      result.innerHTML = `<strong>一次性授权码：<span>${escapeHTML(data.code)}</span></strong><p>仅限${escapeHTML(ROLE_LABEL[role])}账号在 ${escapeHTML(dateText(data.expires_at))} 前接受。接受后授权有效至 ${escapeHTML(dateText(data.relationship_expires_at))}。</p><p>范围：${data.scope_labels.map(escapeHTML).join('；')}</p>`;
      result.focus(); form.reset(); $('#invite-role').value = role; $('#invite-days').value = 30; $('#invite-confirm').checked = false; form.querySelector('button[type="submit"]').disabled = true; renderInviteScopes();
      setLive('授权码已生成，请通过可信方式交给指定协作者。');
    } catch (error) { showError(error); }
  }

  async function acceptInvitation(event) {
    event.preventDefault();
    const code = $('#invite-code').value.trim();
    confirmAction({ title: '确认接受照护授权', message: '接受后，您只能使用老人预先设定的角色、范围和有效期，不能自行扩权。', label: '我确认使用本人账号接受该授权', action: async () => {
      await API.post('/api/care/accept', { code });
      $('#invite-code').value = ''; await load(); setLive('授权已接受，并已记录到操作日志。');
    }});
  }

  async function openLogs(id) {
    const data = await API.get(`/api/care/relationships/${id}/logs`);
    const rows = data.items || [];
    showDetail('授权操作日志', rows.length ? `<ol class="care-log-list">${rows.map(row => `<li><strong>${escapeHTML(row.action)}</strong><span>${escapeHTML(row.outcome)} · ${escapeHTML(dateText(row.created_at))}</span><small>权限：${escapeHTML(row.scope || '授权生命周期')} · 操作人 #${Number(row.actor_user_id || 0)}</small></li>`).join('')}</ol>` : emptyState('暂无操作日志', '首次访问后会在这里留下可审计记录。'));
  }

  function openEdit(id) {
    const row = state.relationships.find(item => Number(item.id) === Number(id));
    if (!row) return;
    const date = row.expires_at ? new Date(row.expires_at).toISOString().slice(0, 10) : '';
    showDetail('调整授权范围', `<form id="scope-edit-form" class="care-edit-form" data-id="${row.id}"><p>查看、代录、提醒和审核权限分别控制；保存后旧页面下一次请求立即按新范围校验。</p><div class="care-scope-grid">${scopeOptions(row.member_role, row.scopes)}</div><label><span>有效期至</span><input name="expires_at" type="date" value="${escapeHTML(date)}" required></label><label class="care-confirm-line"><input name="confirmed" type="checkbox"><span>我已核对新的权限范围和有效期</span></label><button class="btn btn-primary" type="submit">保存新范围</button></form>`);
  }

  async function saveEdit(form) {
    const scopes = [...form.querySelectorAll('[name="scopes"]:checked')].map(input => input.value);
    if (!form.elements.confirmed.checked || !scopes.length) throw new Error('请至少选择一项权限，并勾选确认。');
    const expires = new Date(`${form.elements.expires_at.value}T23:59:59`);
    await API.patch(`/api/care/relationships/${form.dataset.id}`, { scopes, expires_at: expires.toISOString() });
    $('#care-detail-dialog').close(); await load(); setLive('授权范围已更新，并立即生效。');
  }

  function findSubject(id) { return state.subjects.find(card => Number(card.senior.id) === Number(id)); }

  function openRetests(card) {
    const rows = card.overdue_retests || [];
    showDetail('复测状态', rows.length ? `<ul class="care-detail-list">${rows.map(row => `<li><strong>${escapeHTML(METRIC_LABEL[row.metric_type] || row.metric_type)}</strong><span>${escapeHTML(dateText(row.due_at))} · ${escapeHTML(row.status)}</span></li>`).join('')}</ul>` : emptyState('暂无逾期复测', '目前没有已到期但未完成的复测。'));
  }

  async function openEvidence(card) {
    const data = await API.get(`/api/care/seniors/${card.senior.id}/clinical-evidence`);
    showDetail('证据与模型限制', `<section class="care-limitations"><strong>模型边界</strong><p>${escapeHTML(data.model_boundary)}</p><ul>${data.limitations.map(item => `<li>! ${escapeHTML(item)}</li>`).join('')}</ul><h3>近期个人证据</h3>${data.evaluations.length ? `<ul>${data.evaluations.map(item => `<li><strong>${escapeHTML(item.title)}</strong> · ${escapeHTML(item.evidence_level || '未分级')}</li>`).join('')}</ul>` : '<p>暂无已生成的个人效果评价。</p>'}</section>`);
  }

  async function openGraph(card) {
    const data = await API.get(`/api/care/seniors/${card.senior.id}/graphrag/reviews`);
    const row = data.items?.[0];
    if (!row) return showDetail('GraphRAG 高风险关系', emptyState('暂无待审核关系', '当前关系清单为空。'));
    showDetail('GraphRAG 高风险关系审核', `<form id="graph-review-form" class="care-review-form" data-subject="${card.senior.id}" data-index="${row.relation_index}"><p class="care-boundary">${escapeHTML(data.boundary)}</p><dl><div><dt>来源实体</dt><dd>${escapeHTML(row.source || row.source_entity || '未提供')}</dd></div><div><dt>关系</dt><dd>${escapeHTML(row.relation || row.relation_type || '未提供')}</dd></div><div><dt>目标实体</dt><dd>${escapeHTML(row.target || row.target_entity || '未提供')}</dd></div></dl><label><span>审核结论</span><select name="status"><option value="needs_revision">需要修订</option><option value="approved_for_education">仅批准健康教育使用</option><option value="rejected">拒绝</option></select></label><label><span>审核意见</span><textarea name="notes" maxlength="1000" required></textarea></label><label class="care-confirm-line"><input name="confirmed" type="checkbox"><span>我确认该意见不会自动生成临床行动</span></label><button class="btn btn-primary" type="submit">提交审核意见</button></form>`);
  }

  function openPlanReview(card) {
    const plan = card.active_interventions?.[0];
    if (!plan) return showDetail('干预审核意见', emptyState('暂无活跃干预计划', '老人有进行中或待评价计划后，可在这里添加审核意见。'));
    showDetail('对干预计划添加审核意见', `<form id="plan-review-form" class="care-review-form" data-subject="${card.senior.id}" data-plan="${escapeHTML(plan.intervention_id)}"><p><strong>${escapeHTML(plan.title)}</strong></p><label><span>审核状态</span><select name="status"><option value="commented">补充意见</option><option value="approved_with_caution">谨慎同意</option><option value="needs_revision">需要调整</option></select></label><label><span>审核意见</span><textarea name="comment" maxlength="1000" required></textarea></label><label class="care-confirm-line"><input name="confirmed" type="checkbox"><span>我确认意见基于当前有限信息，不替代面诊</span></label><button class="btn btn-primary" type="submit">提交审核意见</button></form>`);
  }

  async function handleAction(button) {
    const action = button.dataset.careAction;
    const id = button.dataset.id;
    const subjectId = Number(button.dataset.subject);
    const card = subjectId ? findSubject(subjectId) : null;
    if (action === 'logs') return openLogs(id);
    if (action === 'edit') return openEdit(id);
    if (action === 'revoke') return confirmAction({ title: '确认撤回授权', message: '撤回后，该协作者的旧登录会话在下一次相关请求时立即失去查看、代录和审核能力。操作会永久留痕。', label: '我确认立即撤回此授权', action: async () => { await API.post(`/api/care/relationships/${id}/revoke`, { reason: '老人本人在照护协同驾驶舱撤回' }); await load(); setLive('授权已撤回，相关能力已立即失效。'); } });
    if (action === 'intake') { state.entrySubject = subjectId; $('#care-entry-form').reset(); $('#entry-submit').disabled = true; return $('#care-entry-dialog').showModal(); }
    if (action === 'remind') return confirmAction({ title: '确认发送执行提醒', message: `将向${card.senior.name}发送一条温和提醒。此操作不会替老人打卡或确认干预计划。`, label: '我确认只发送提醒，不代替执行', action: async () => { await API.post(`/api/care/seniors/${subjectId}/reminders`, { message: '请记得按计划完成今天的健康任务，如有不适请先暂停。' }); setLive('提醒已发送并写入操作日志。'); } });
    if (action === 'retests') return openRetests(card);
    if (action === 'evidence') return openEvidence(card);
    if (action === 'graph') return openGraph(card);
    if (action === 'plan-review') return openPlanReview(card);
  }

  document.addEventListener('auth:ready', load, { once: true });
  $('#care-refresh').addEventListener('click', load);
  $('#care-retry').addEventListener('click', load);
  $('#invite-role').addEventListener('change', renderInviteScopes);
  $('#invite-confirm').addEventListener('change', event => { $('#invite-form button[type="submit"]').disabled = !event.target.checked; });
  $('#invite-form').addEventListener('submit', createInvitation);
  $('#accept-form').addEventListener('submit', acceptInvitation);
  document.addEventListener('click', event => { const button = event.target.closest('[data-care-action]'); if (button) handleAction(button).catch(showError); });
  $('[data-dialog-cancel]').addEventListener('click', () => $('#care-confirm-dialog').close());
  $('#care-confirm-check').addEventListener('change', event => { $('#care-confirm-submit').disabled = !event.target.checked; });
  $('#care-confirm-form').addEventListener('submit', async event => { event.preventDefault(); const action = state.pending; state.pending = null; $('#care-confirm-dialog').close(); try { await action?.(); } catch (error) { showError(error); } });
  $('[data-detail-close]').addEventListener('click', () => $('#care-detail-dialog').close());
  $('[data-entry-cancel]').addEventListener('click', () => $('#care-entry-dialog').close());
  $('#entry-confirm').addEventListener('change', event => { $('#entry-submit').disabled = !event.target.checked; });
  $('#care-entry-form').addEventListener('submit', async event => { event.preventDefault(); try { await API.post('/api/prediction/intakes', { subject_user_id: state.entrySubject, answers: { self_rated_health: Number($('#entry-health').value), fall_recent: Number($('#entry-fall').value) } }); $('#care-entry-dialog').close(); await load(); setLive('代录已完成，并明确标记了实际操作人。'); } catch (error) { showError(error); } });
  $('#care-detail-content').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      if (event.target.id === 'scope-edit-form') return await saveEdit(event.target);
      if (!event.target.elements.confirmed?.checked) throw new Error('请先勾选确认说明。');
      if (event.target.id === 'graph-review-form') await API.post(`/api/care/seniors/${event.target.dataset.subject}/graphrag/reviews/${event.target.dataset.index}`, { status: event.target.elements.status.value, notes: event.target.elements.notes.value });
      if (event.target.id === 'plan-review-form') await API.post(`/api/care/seniors/${event.target.dataset.subject}/interventions/${encodeURIComponent(event.target.dataset.plan)}/reviews`, { status: event.target.elements.status.value, comment: event.target.elements.comment.value });
      $('#care-detail-dialog').close(); setLive('审核意见已提交并写入审计日志。');
    } catch (error) { showError(error); }
  });
})();
