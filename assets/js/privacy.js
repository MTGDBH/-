(function () {
  const state = { overview: null, deletionRequest: null };
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const dateText = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无';
  const actionLabels = { auth_login: '账号登录', api_mutation: '修改数据', personal_data_export: '导出数据', authorization_revoked: '撤回授权', authorization_updated: '调整授权', view_summary: '查看健康摘要' };

  async function load() {
    $('#privacy-live').hidden = false; $('#privacy-error').hidden = true; $('#privacy-content').hidden = true;
    try {
      const [overview, authorizations, access] = await Promise.all([
        API.get('/api/privacy/overview'), API.get('/api/privacy/authorizations'), API.get('/api/privacy/access-records?limit=100'),
      ]);
      state.overview = overview; renderOverview(overview); renderAuthorizations(authorizations.items || []); renderAccess(access.items || []);
      $('#privacy-live').hidden = true; $('#privacy-content').hidden = false;
    } catch (error) {
      $('#privacy-live').hidden = true; $('#privacy-error').hidden = false; $('#privacy-error-message').textContent = error.message;
    }
  }

  function renderOverview(data) {
    const total = data.categories.reduce((sum, item) => sum + Number(item.count || 0), 0);
    $('#privacy-total').textContent = `共 ${total} 条相关记录`;
    $('#privacy-categories').innerHTML = data.categories.map((item, index) => `<article class="privacy-category"><span aria-hidden="true">${['人','测','器','聊','预','行','权','审'][index] || '数'}</span><div><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.description)}</p></div><strong>${Number(item.count || 0)} 条</strong></article>`).join('');
    $('#privacy-retention').innerHTML = data.retention_policy.map(item => `<div><strong>${escapeHtml(item.category)}</strong><span>${escapeHtml(item.period)}</span><p>${escapeHtml(item.deletion)}</p></div>`).join('');
  }

  function renderAuthorizations(items) {
    if (!items.length) { $('#privacy-authorizations').innerHTML = '<p class="privacy-empty">目前没有家属或医生授权。</p>'; return; }
    $('#privacy-authorizations').innerHTML = items.map(item => `<article class="privacy-row"><div><strong>${escapeHtml(item.recipient_name)} · ${item.member_role === 'doctor' ? '医生' : '家属'}</strong><p>${escapeHtml((item.scopes || []).join('、') || '未设置范围')} · ${item.status === 'active' ? '有效' : item.status === 'revoked' ? '已撤回' : '已到期'}</p><small>最近访问：${dateText(item.last_access_at)}</small></div>${item.status === 'active' ? `<button class="btn btn-danger btn-small" data-revoke="${Number(item.id)}" type="button">撤回授权</button>` : ''}</article>`).join('');
  }

  function renderAccess(items) {
    if (!items.length) { $('#privacy-access').innerHTML = '<p class="privacy-empty">暂时没有访问记录。</p>'; return; }
    $('#privacy-access').innerHTML = items.map(item => `<article class="privacy-row"><div><strong>${escapeHtml(item.actor_name || actionLabels[item.event_type] || actionLabels[item.action] || item.action || '系统事件')}</strong><p>${escapeHtml(item.scope || item.resource || item.source)}</p><small>${dateText(item.created_at)} · ${item.outcome === 'success' ? '成功' : item.outcome === 'denied' ? '已拒绝' : escapeHtml(item.outcome || '已记录')}</small></div></article>`).join('');
  }

  async function revoke(id, button) {
    if (!confirm('撤回后，对方下一次访问会立即失去相应权限。确定撤回吗？')) return;
    button.disabled = true;
    try { await API.post(`/api/care/relationships/${id}/revoke`, { reason: '从隐私与数据管理中心撤回' }); await load(); }
    catch (error) { button.disabled = false; alert(error.message); }
  }

  async function download(format, button) {
    const status = $('#export-status'); button.disabled = true; status.textContent = '正在准备安全导出…';
    try {
      const response = await fetch(`${API.BASE}/api/privacy/exports`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `导出失败 (${response.status})`); }
      const blob = await response.blob(); const disposition = response.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `xiaokang-personal-data.${format}`;
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
      status.textContent = `导出完成，今日剩余 ${response.headers.get('x-export-quota-remaining') || 0} 次`;
    } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
  }

  async function startDeletion() {
    const button = $('#start-delete'); button.disabled = true;
    try {
      const request = await API.post('/api/privacy/deletion-requests', {}); state.deletionRequest = request;
      $('#delete-categories').innerHTML = request.categories.map(item => `<li>${escapeHtml(item)}</li>`).join('');
      $('#confirm-phrase').textContent = `“${request.confirmation_text}”`; $('#delete-confirmation').value = ''; $('#delete-password').value = ''; $('#delete-check').checked = false; $('#confirm-delete').disabled = true; $('#delete-status').textContent = '';
      $('#delete-dialog').showModal();
    } catch (error) { alert(error.message); } finally { button.disabled = false; }
  }

  async function confirmDeletion(event) {
    event.preventDefault(); if (!state.deletionRequest) return;
    const button = $('#confirm-delete'); button.disabled = true; $('#delete-status').textContent = '正在删除，请不要关闭页面…';
    try {
      const result = await API.post(`/api/privacy/deletion-requests/${state.deletionRequest.id}/confirm`, { confirmation_text: $('#delete-confirmation').value, password: $('#delete-password').value });
      $('#delete-status').textContent = result.status === 'completed' ? '删除完成，正在退出…' : `当前状态：${result.status}`;
      setTimeout(() => { location.href = 'login.html?account_deleted=1'; }, 700);
    } catch (error) { $('#delete-status').textContent = error.message; button.disabled = !$('#delete-check').checked; }
  }

  document.addEventListener('click', event => {
    const revokeButton = event.target.closest('[data-revoke]'); if (revokeButton) revoke(Number(revokeButton.dataset.revoke), revokeButton);
    const exportButton = event.target.closest('[data-export]'); if (exportButton) download(exportButton.dataset.export, exportButton);
  });
  $('#privacy-refresh').addEventListener('click', load); $('#privacy-retry').addEventListener('click', load); $('#start-delete').addEventListener('click', startDeletion);
  $('#cancel-delete').addEventListener('click', () => $('#delete-dialog').close()); $('#delete-check').addEventListener('change', event => { $('#confirm-delete').disabled = !event.target.checked; });
  $('#delete-form').addEventListener('submit', confirmDeletion);
  document.addEventListener('auth:ready', load, { once: true });
})();
