import express from 'express';
import { getLLMStatus } from '../ai/agent.js';
import { requireCapability } from '../middleware/accessControl.js';
import { getLLMConfig, publicLLMConfig } from '../services/llmConfigService.js';
import { hasPermission } from '../contracts/accessControl.js';

const router = express.Router();

router.get('/llm', (req, res) => res.json({
  ...publicLLMConfig(),
  can_test: hasPermission(req.user?.role, 'manage_system_settings'),
  configuration_method: 'server_environment',
}));
router.get('/llm/status', (_req, res) => res.json(getLLMStatus()));

router.put('/llm', requireCapability('manage_system_settings'), (req, res) => {
  res.status(409).json({
    error: '模型配置由服务器环境变量管理，请修改 server/.env 后重启服务',
    code: 'LLM_CONFIG_READ_ONLY', retryable: false, stage: 'configuration',
  });
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
