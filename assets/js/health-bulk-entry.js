(function () {
  const CONDITION_LABELS = {
    fasting: '空腹',
    postprandial_2h: '餐后2小时',
    random: '随机',
    resting: '静息',
    morning_rest: '早晨静坐后',
    evening_rest: '晚间静坐后',
    morning_fasting: '晨起空腹',
    unknown: '测量条件未说明',
  };
  const COLORS = ['#B85D28', '#874018', '#7A58A6', '#3E8E8E', '#5A8045'];
  let records = [];
  let warnings = [];
  let voiceUsed = false;
  let recognition = null;
  let listening = false;
  let initialized = false;

  const el = id => document.getElementById(id);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function setStatus(message, tone = '') {
    const host = el('bulk-entry-status');
    host.textContent = message;
    host.dataset.tone = tone;
  }

  function formatValue(record) {
    return record.type === 'bp' ? `${record.value}/${record.value2}` : `${record.value}`;
  }

  function renderPreview() {
    const preview = el('bulk-preview');
    const summary = el('bulk-draft-summary');
    const warningHost = el('bulk-warning-list');
    preview.hidden = records.length === 0 && warnings.length === 0;
    el('bulk-preview-count').textContent = `${records.length}项`;
    el('bulk-save-btn').disabled = records.length === 0;
    el('bulk-save-btn').textContent = records.length ? `确认并保存 ${records.length} 项` : '没有可保存项目';

    warningHost.innerHTML = warnings.map(text => `<p><span aria-hidden="true">!</span>${escapeHTML(text)}</p>`).join('');
    summary.innerHTML = records.map((record, index) => `
      <span style="--metric-accent:${COLORS[index % COLORS.length]}">
        <strong>${escapeHTML(record.label)}</strong>${escapeHTML(formatValue(record))} ${escapeHTML(record.unit)}
        <button type="button" data-remove="${index}" aria-label="取消填充${escapeHTML(record.label)}">×</button>
      </span>
    `).join('');
    summary.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
      records.splice(Number(button.dataset.remove), 1);
      renderPreview();
      setStatus('已取消填充该项目，其余数据仍在下方今日数据中。');
    }));
    window.refreshTodayCards?.();
  }

  async function parseDescription() {
    const text = el('health-description').value.trim();
    if (!text) {
      setStatus('请先输入或说出一段健康数据。', 'error');
      el('health-description').focus();
      return;
    }
    const button = el('bulk-parse-btn');
    button.disabled = true;
    button.textContent = '正在识别…';
    setStatus('正在把描述拆分成健康数据卡片…', 'loading');
    try {
      const result = await API.post('/api/health/metrics/parse-description', { text });
      records = result.records || [];
      warnings = result.warnings || [];
      renderPreview();
      if (records.length) {
        setStatus(`已将${records.length}项数据填入下方“今日数据”，请核对后确认保存。`, 'success');
        document.querySelector('.entry-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        setStatus('暂时没有识别出完整数据，请按提示补充。', 'error');
      }
    } catch (error) {
      records = [];
      warnings = [];
      renderPreview();
      setStatus(error.message || '识别失败，请稍后再试。', 'error');
    } finally {
      button.disabled = false;
      button.textContent = '识别并填入今日数据';
    }
  }

  async function saveRecords() {
    const invalid = records.some(record => !Number.isFinite(record.value) || (record.type === 'bp' && !Number.isFinite(record.value2)));
    if (invalid) {
      setStatus('有数值为空或格式不正确，请检查后再保存。', 'error');
      return;
    }
    const button = el('bulk-save-btn');
    button.disabled = true;
    button.textContent = '正在保存…';
    let saved = 0;
    const failed = [];
    for (const record of records) {
      try {
        await API.post('/api/health/metrics', {
          type: record.type,
          value: record.value,
          value2: record.value2,
          unit: record.unit,
          source: 'manual',
          note: '由健康数据描述核对后录入',
          measurement_condition: record.measurement_condition,
          measurement_context: {
            entry_mode: voiceUsed ? 'voice_text' : 'text',
            parser_version: 'health_text_v1',
            user_confirmed: true,
          },
        });
        saved += 1;
      } catch (error) {
        failed.push(`${record.label}：${error.message}`);
      }
    }
    if (failed.length) {
      warnings = failed;
      records = records.filter(record => failed.some(item => item.startsWith(`${record.label}：`)));
      renderPreview();
    } else {
      records = [];
      warnings = [];
      el('health-description').value = '';
      el('bulk-preview').hidden = true;
      voiceUsed = false;
    }
    if (saved) {
      setStatus(`已保存${saved}项健康数据，下面的今日数据卡片已更新。`, failed.length ? 'warning' : 'success');
      toast(`已保存 ${saved} 项健康数据`, 'success');
      if (typeof window.loadAll === 'function') await window.loadAll();
    } else {
      window.refreshTodayCards?.();
    }
    button.disabled = false;
  }

  function stopListening() {
    recognition?.stop();
  }

  function setupSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const button = el('bulk-voice-btn');
    if (!SpeechRecognition) {
      button.disabled = true;
      el('bulk-voice-label').textContent = '此浏览器不支持语音';
      el('bulk-speech-help').textContent = '当前浏览器不能直接语音转文字，仍可在上方输入或粘贴一整段数据。';
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    button.addEventListener('click', () => {
      if (listening) return stopListening();
      try {
        recognition.start();
      } catch {
        setStatus('语音服务正在启动，请稍等。', 'loading');
      }
    });
    recognition.onstart = () => {
      listening = true;
      voiceUsed = true;
      button.classList.add('is-listening');
      button.setAttribute('aria-pressed', 'true');
      el('bulk-voice-label').textContent = '正在听，点此结束';
      setStatus('正在听您说话，说完后点击“正在听”。', 'listening');
      recognition._baseText = el('health-description').value.trim();
      recognition._finalText = '';
    };
    recognition.onresult = event => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript;
        if (event.results[index].isFinal) recognition._finalText += `${transcript}，`;
        else interim += transcript;
      }
      el('health-description').value = [recognition._baseText, recognition._finalText, interim].filter(Boolean).join(recognition._baseText ? '，' : '');
    };
    recognition.onerror = event => {
      const messages = {
        'not-allowed': '没有麦克风权限，请允许后重试。',
        'no-speech': '没有听到清晰语音，请靠近麦克风重试。',
        network: '语音服务连接失败，请直接打字输入。',
        'audio-capture': '没有找到可用麦克风。',
      };
      setStatus(messages[event.error] || '语音识别暂时不可用，请直接输入。', 'error');
    };
    recognition.onend = () => {
      listening = false;
      button.classList.remove('is-listening');
      button.setAttribute('aria-pressed', 'false');
      el('bulk-voice-label').textContent = '继续语音输入';
      if (el('health-description').value.trim()) setStatus('语音已转成文字，可以修改或生成卡片。', 'success');
    };
  }

  function clearAll() {
    if (listening) stopListening();
    records = [];
    warnings = [];
    voiceUsed = false;
    el('health-description').value = '';
    el('bulk-preview').hidden = true;
    window.refreshTodayCards?.();
    setStatus('已清空，本次没有保存任何数据。');
  }

  function init() {
    if (initialized || !el('health-description')) return;
    initialized = true;
    el('bulk-parse-btn').addEventListener('click', parseDescription);
    el('bulk-clear-btn').addEventListener('click', clearAll);
    el('bulk-cancel-btn').addEventListener('click', clearAll);
    el('bulk-save-btn').addEventListener('click', saveRecords);
    setupSpeech();
  }

  document.addEventListener('auth:ready', init);
  function getDraft(type) {
    return records.find(record => record.type === type) || null;
  }

  function removeDraft(type) {
    records = records.filter(record => record.type !== type);
    renderPreview();
  }

  window.HealthBulkEntry = { init, parseDescription, getDraft, removeDraft };
})();
