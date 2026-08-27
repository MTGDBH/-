function providerFromBaseUrl(baseUrl = '') {
  return /deepseek/i.test(String(baseUrl)) ? 'deepseek' : /openai/i.test(String(baseUrl)) ? 'openai' : 'custom';
}

export function getLLMConfig() {
  const deepseek = process.env.DEEPSEEK_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const generic = process.env.LLM_API_KEY;
  const apiKey = deepseek || openai || generic;
  if (!apiKey) return null;
  const baseUrl = deepseek ? (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1')
    : openai ? (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
      : (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1');
  return {
    api_key: apiKey, base_url: baseUrl,
    model: deepseek ? (process.env.DEEPSEEK_MODEL || 'deepseek-chat') : openai ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : (process.env.LLM_MODEL || 'deepseek-chat'),
    provider: providerFromBaseUrl(baseUrl), secret_source: 'environment',
  };
}

export function publicLLMConfig() {
  const cfg = getLLMConfig();
  return {
    api_key_masked: cfg ? '环境变量已配置' : '', api_key_set: !!cfg,
    base_url: cfg?.base_url || process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
    model: cfg?.model || process.env.LLM_MODEL || 'deepseek-chat', provider: cfg?.provider || 'none',
    mode: cfg ? 'llm' : 'mock', secret_source: cfg ? 'environment' : 'none',
  };
}

