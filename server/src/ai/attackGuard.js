const DIRECT_INJECTION = /(?:忽略|无视|覆盖|绕过|取消).{0,18}(?:之前|以上|系统|安全|权限|确认|规则|指令)|(?:system prompt|developer message|ignore previous|jailbreak|越狱)/i;
const SECRET_REQUEST = /(?:显示|泄露|输出|告诉我|读取).{0,18}(?:系统提示词|密钥|api\s*key|数据库内容|内部路径|堆栈|环境变量)/i;
const IDENTITY_OVERRIDE = /(?:我是|假装我是|把我当成).{0,10}(?:医生|家属|管理员)|(?:切换|改成).{0,10}(?:用户|老人|健康对象)/i;

export function inspectUntrustedInput(text, source = 'user') {
  const value = String(text || '').slice(0, 12000);
  const flags = [];
  if (DIRECT_INJECTION.test(value)) flags.push('instruction_override');
  if (SECRET_REQUEST.test(value)) flags.push('secret_exfiltration');
  if (IDENTITY_OVERRIDE.test(value)) flags.push('identity_override');
  return { source, trust_level: source === 'user' ? 'untrusted_user' : 'untrusted_external', blocked: flags.length > 0, flags };
}

export function sanitizeUntrustedToolText(text) {
  return String(text || '')
    .replace(/(?:忽略|无视|覆盖).{0,80}(?:指令|规则|系统|权限)/gi, '[已移除不可信指令]')
    .replace(/(?:system prompt|ignore previous|developer message).{0,120}/gi, '[已移除不可信指令]')
    .slice(0, 600);
}

export function securityRefusal() {
  return {
    source: 'security_rule',
    content: '我不能更改身份、权限、安全规则或泄露系统信息。你可以直接告诉我需要查看的健康指标、时间范围，或要完成的健康管理任务。',
    plan: [], confidence: { type: 'common_sense', score: 100, sources: ['后端安全规则'], reasoning: '检测到试图改变受保护边界的内容' },
  };
}
