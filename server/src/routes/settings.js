// 设置路由：LLM 模型配置管理
import express from 'express';
import db from '../db.js';
import { getLLMStatus } from '../ai/agent.js';

const router = express.Router();

// 获取 LLM 配置（不返回完整 API Key，只返回掩码）
router.get('/llm', (req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('llm_config');
  let cfg = { api_key: '', base_url: '', model: '' };

  if (row) {
    try { cfg = { ...cfg, ...JSON.parse(row.value) }; } catch {}
  }

  // 回退到环境变量
  if (!cfg.api_key && (process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY)) {
    cfg.api_key = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
    cfg.base_url = cfg.base_url || (process.env.DEEPSEEK_API_KEY ? process.env.DEEPSEEK_BASE_URL : process.env.OPENAI_BASE_URL) || '';
    cfg.model = cfg.model || (process.env.DEEPSEEK_API_KEY ? process.env.DEEPSEEK_MODEL : process.env.OPENAI_MODEL) || '';
  }

  // 掩码处理：只返回前 4 位 + ****
  const maskedKey = cfg.api_key
    ? cfg.api_key.slice(0, 4) + '****' + cfg.api_key.slice(-4)
    : '';

  const mode = cfg.api_key ? 'llm' : 'mock';

  const baseUrl = cfg.base_url || (cfg.api_key ? 'https://api.deepseek.com/v1' : 'https://api.deepseek.com/v1');
  const model = cfg.model || (cfg.api_key ? 'deepseek-chat' : 'deepseek-chat');
  res.json({
    api_key_masked: maskedKey,
    api_key_set: !!cfg.api_key,
    base_url: baseUrl,
    model,
    provider: /deepseek/i.test(baseUrl) ? 'deepseek' : /openai/i.test(baseUrl) ? 'openai' : 'custom',
    mode,
  });
});

router.get('/llm/status', (req, res) => {
  res.json(getLLMStatus());
});

// 保存 LLM 配置
router.put('/llm', (req, res) => {
  const { api_key, base_url, model } = req.body;

  // 读取现有配置
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('llm_config');
  let existing = { api_key: '', base_url: '', model: '' };
  if (row) {
    try { existing = { ...existing, ...JSON.parse(row.value) }; } catch {}
  }

  // 如果前端传了空 api_key，保留原有的（不覆盖）
  const finalKey = api_key !== undefined && api_key !== '' ? api_key : existing.api_key;

  const cfg = {
    api_key: finalKey,
    base_url: base_url || existing.base_url || 'https://api.deepseek.com/v1',
    model: model || existing.model || 'deepseek-chat',
  };

  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('llm_config', ?, datetime('now', 'localtime'))
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now', 'localtime')
  `).run(JSON.stringify(cfg), JSON.stringify(cfg));

  const maskedKey = cfg.api_key
    ? cfg.api_key.slice(0, 4) + '****' + cfg.api_key.slice(-4)
    : '';

  res.json({
    api_key_masked: maskedKey,
    api_key_set: !!cfg.api_key,
    base_url: cfg.base_url,
    model: cfg.model,
    mode: cfg.api_key ? 'llm' : 'mock',
    provider: /deepseek/i.test(cfg.base_url) ? 'deepseek' : /openai/i.test(cfg.base_url) ? 'openai' : 'custom',
  });
});

// 测试 LLM 连接
router.post('/llm/test', async (req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('llm_config');
  let cfg = { api_key: '', base_url: '', model: '' };
  if (row) {
    try { cfg = { ...cfg, ...JSON.parse(row.value) }; } catch {}
  }
  // 回退到环境变量
  if (!cfg.api_key && (process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY)) {
    cfg.api_key = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
    cfg.base_url = cfg.base_url || (process.env.DEEPSEEK_API_KEY ? process.env.DEEPSEEK_BASE_URL : process.env.OPENAI_BASE_URL) || '';
    cfg.model = cfg.model || (process.env.DEEPSEEK_API_KEY ? process.env.DEEPSEEK_MODEL : process.env.OPENAI_MODEL) || '';
  }

  if (!cfg.api_key) {
    return res.json({ success: false, message: '未配置 API Key，当前为 Mock 模式' });
  }

  const base = (cfg.base_url || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.api_key}`,
      },
      body: JSON.stringify({
        model: cfg.model || 'deepseek-chat',
        messages: [{ role: 'user', content: '你好' }],
        max_tokens: 10,
      }),
    });

    if (!response.ok) {
      await response.text();
      return res.json({ success: false, message: `API 返回 ${response.status}` });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '(空回复)';
    res.json({ success: true, message: `连接成功！模型回复：${reply}` });
  } catch (err) {
    res.json({ success: false, message: `连接失败：${err.message}` });
  }
});

export default router;
