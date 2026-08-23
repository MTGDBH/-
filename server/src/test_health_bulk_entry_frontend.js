import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const html = fs.readFileSync(path.join(root, 'monitoring.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets', 'js', 'health-bulk-entry.js'), 'utf8');

assert.match(html, /id="health-description"/);
assert.match(html, /id="bulk-voice-btn"/);
assert.match(html, /id="bulk-draft-summary"/);
assert.match(html, /不会自动保存/);
assert.match(script, /SpeechRecognition \|\| window\.webkitSpeechRecognition/);
assert.match(script, /parse-description/);
assert.match(script, /user_confirmed: true/);
assert.match(script, /确认并保存/);
assert.match(script, /getDraft/);
assert.match(html, /entry-card-draft/);
assert.doesNotMatch(script, /recognition\.start\(\).*API\.post\('\/api\/health\/metrics'/s);

console.log('health bulk entry frontend: PASS');
