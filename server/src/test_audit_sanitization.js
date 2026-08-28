import assert from 'node:assert/strict';
import { sanitizeAuditValue } from './services/auditService.js';

const clean = sanitizeAuditValue({
  metadata: {
    password: 'plain', token: 'bearer', api_key: 'key', authorization: 'Bearer secret',
    health_text: '完整健康文本', nested: { content: '症状详情', safe_count: 3 },
  },
});
assert.equal(clean.metadata.password, '[REDACTED]');
assert.equal(clean.metadata.token, '[REDACTED]');
assert.equal(clean.metadata.api_key, '[REDACTED]');
assert.equal(clean.metadata.authorization, '[REDACTED]');
assert.equal(clean.metadata.health_text, '[REDACTED]');
assert.equal(clean.metadata.nested.content, '[REDACTED]');
assert.equal(clean.metadata.nested.safe_count, 3);
console.log('Audit redaction: PASS');
