import express from 'express';
import db from '../db.js';
import { getLLMStatus } from '../ai/agent.js';
import { requireCapability } from '../middleware/accessControl.js';
import { getLLMConfig, publicLLMConfig } from '../services/llmConfigService.js';

const router = express.Router();

router.get('/llm', (_req, res) => res.json(publicLLMConfig()));
router.get('/llm/status', (_req, res) => res.json(getLLMStatus()));

router.put('/llm', requireCapability('manage_system_settings'), (req, res) => {
  if (String(req.body?.api_key || '').trim()) {
    return res.status(400).json({ error: '为避免密钥明文落库，请通过服务器环境变量配置 API Key' });
  }
  const current = publicLLMConfig();
  const metadata = {
    base_url: String(req.body?.base_url || current.base_url || '').slice(0, 500),
    model: String(req.body?.model || current.model || '').slice(0, 120),
    secret_source: 'environment',
  };
  db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES ('llm_metadata',?,datetime('now','localtime'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now','localtime')`).run(JSON.stringify(metadata));
  res.json({ ...publicLLMConfig(), ...metadata, note: 'API Key 只从环境变量读取，未写入数据库' });
});

router.post('/llm/test', requireCapability('manage_system_settings'), async (_req, res) => {
  const cfg = getLLMConfig();
  if (!cfg) return res.json({ success: false, message: '服务器尚未配置 API Key，当前使用本地降级模式' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${cfg.base_url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: '请回复“连接正常”' }], max_tokens: 12 }),
    });
    await response.text();
    res.json(response.ok ? { success: true, message: '连接正常' } : { success: false, message: `服务返回 ${response.status}` });
  } catch (error) {
    res.json({ success: false, message: error.name === 'AbortError' ? '连接超时，请检查网络或服务地址' : '暂时无法连接模型服务' });
  } finally { clearTimeout(timer); }
});

export default router;
