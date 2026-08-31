import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../mobile.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../assets/css/mobile-app.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../../assets/js/mobile-app.js', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../../assets/js/api.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');

new Function(js);
assert.match(html, /name="viewport"[^>]+viewport-fit=cover/);
assert.match(html, /assets\/css\/mobile-app\.css/);
assert.match(html, /assets\/js\/api\.js/);
assert.match(html, /assets\/js\/mobile-app\.js/);
assert.doesNotMatch(html + css + js, /home-indicator|class="status"|9:41/);

assert.match(css, /100dvh/);
assert.match(css, /env\(safe-area-inset-top\)/);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(css, /@media\s*\(min-width:\s*700px\)/);
assert.match(css, /max-width:\s*480px/);

for (const endpoint of [
  '/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/auth/me',
  '/api/health/summary', '/api/health/metrics', '/api/todos/today', '/api/assessments/latest',
  '/api/alerts', '/api/chat', '/api/knowledge', '/api/profile/me', '/api/profile/password',
  '/api/care/relationships', '/api/care/invitations', '/api/settings/llm/status',
]) assert.ok(js.includes(endpoint), `${endpoint} mobile integration missing`);

for (const view of ['home','monitor','record-bp','trends','plans','assessment','risk','chat','knowledge','profile','care','settings']) {
  assert.ok(js.includes(view), `${view} mobile view missing`);
}
assert.match(js, /replace\(\s*\/\[&<>'"\]\/g/);
assert.ok((js.match(/esc\(/g) || []).length >= 40, 'dynamic mobile content must be escaped');
assert.match(js, /role="alert"/);
assert.match(js, /aria-label="主导航"/);
assert.match(api, /max-width: 900px/);
assert.match(api, /\/mobile\?view=/);
assert.match(server, /app\.get\('\/mobile'/);

console.log('mobile frontend contract: PASS');
