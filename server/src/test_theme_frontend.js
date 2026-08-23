import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../../assets/js/api.js', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../../assets/js/auth.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../../assets/js/main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../assets/css/styles.css', import.meta.url), 'utf8');

new Function(api);
new Function(auth);
new Function(main);
assert.match(api, /xiaokang-theme-v1/);
assert.match(api, /prefers-color-scheme: dark/);
assert.match(auth, /data-theme-toggle/);
assert.match(auth, /aria-pressed="false"/);
assert.match(main, /theme:change/);
assert.match(main, /localStorage\.setItem\(THEME_KEY/);
assert.match(css, /html\[data-theme="dark"\]/);
assert.match(css, /\.icon-theme/);
assert.match(css, /color-scheme:dark/);
assert.match(css, /html\[data-theme="dark"\] \.disease-discovery-card/);
assert.match(css, /html\[data-theme="dark"\] \.event-card/);
assert.match(css, /html\[data-theme="dark"\] #relationship-lab/);
assert.match(css, /html\[data-theme="dark"\] \.agent-inbox-item/);
assert.match(css, /html\[data-theme="dark"\] \.pred-alert/);
assert.match(css, /html\[data-theme="dark"\] \.disease-risk-cta/);
assert.match(css, /\.life-row/);
assert.match(css, /\.imp-row/);

console.log('global dark theme frontend: PASS');
