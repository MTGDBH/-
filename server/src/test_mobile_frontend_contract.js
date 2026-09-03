import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../../mobile.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../assets/css/mobile-app.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../../assets/js/mobile-app.js', import.meta.url), 'utf8');
const bluetooth = fs.readFileSync(new URL('../../assets/js/bluetooth-health.js', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../../assets/js/api.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');

new Function(js);
new Function(bluetooth)();
assert.match(html, /name="viewport"[^>]+viewport-fit=cover/);
assert.match(html, /assets\/css\/mobile-app\.css/);
assert.match(html, /assets\/js\/api\.js/);
assert.match(html, /assets\/js\/bluetooth-health\.js/);
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
  '/api/care/relationships', '/api/care/invitations', '/api/settings/llm/status', '/api/devices',
]) assert.ok(js.includes(endpoint), `${endpoint} mobile integration missing`);

for (const view of ['home','monitor','wearable','record-bp','trends','plans','assessment','risk','chat','knowledge','profile','care','settings']) {
  assert.ok(js.includes(view), `${view} mobile view missing`);
}
assert.match(js, /data-trend-filter/);
assert.match(js, /data-dimension-view/);
assert.match(js, /view\.startsWith\("record-"\)/);
assert.match(js, /function iconSvg/);
assert.match(js, /aria-current/);
assert.match(js, /data-voice-input/);
assert.match(js, /window\.SpeechRecognition\s*\|\|\s*window\.webkitSpeechRecognition/);
assert.match(js, /recognition\.lang\s*=\s*["']zh-CN["']/);
assert.match(js, /state\.voiceRecognition\?\.stop\(\)/);
assert.match(js, /state\.voiceRecognition\.abort\(\)/);
assert.match(js, /健康评估：我今天身体怎么样/);
assert.doesNotMatch(js, /class="big-mic"[^>]+data-chat-prompt/);
assert.match(css, /\.big-mic\.listening/);
assert.match(js, /function renderHealthAnswer/);
assert.match(js, /result\?\.presentation/);
assert.match(js, /最需要看的数据/);
assert.match(js, /今天怎么做/);
assert.match(js, /什么时候需要求助/);
assert.match(js, /answer\.scrollIntoView/);
assert.match(css, /\.health-answer-card/);
assert.match(css, /\.wearable-entry/);
assert.match(css, /\.band-reading/);
assert.match(js, /function renderWearable/);
assert.match(js, /选择并连接手环/);
assert.match(js, /核对无误，存入健康档案/);
assert.match(bluetooth, /navigator\.bluetooth\.requestDevice/);
assert.match(bluetooth, /acceptAllDevices:\s*true/);
assert.match(bluetooth, /optionalServices:\s*OPTIONAL_SERVICES/);

const parsers = globalThis.BluetoothHealth.parsers;
assert.deepEqual(parsers.parseHeartRateMeasurement(new Uint8Array([0, 72]))[0].value, 72);
const bp = parsers.parseBloodPressureMeasurement(new Uint8Array([0, 128, 0, 82, 0, 100, 0]))[0];
assert.deepEqual([bp.value, bp.value2, bp.unit], [128, 82, 'mmHg']);
assert.equal(parsers.parseTemperatureMeasurement(new Uint8Array([0, 109, 1, 0, 255]))[0].value, 36.5);
assert.equal(parsers.parsePulseOximeterMeasurement(new Uint8Array([0, 98, 0, 70, 0]))[0].value, 98);
assert.equal(parsers.parseWeightMeasurement(new Uint8Array([0, 176, 54]))[0].value, 70);
assert.match(css, /\.field\[hidden\]/);
assert.match(js, /replace\(\s*\/\[&<>'"\]\/g/);
assert.ok((js.match(/esc\(/g) || []).length >= 40, 'dynamic mobile content must be escaped');
assert.match(js, /role="alert"/);
assert.match(js, /aria-label="主导航"/);
assert.match(api, /max-width: 900px/);
assert.match(api, /\/mobile\?view=/);
assert.match(server, /app\.get\('\/mobile'/);

console.log('mobile frontend contract: PASS');
