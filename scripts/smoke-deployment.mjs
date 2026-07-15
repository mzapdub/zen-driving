import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const htmlPath = path.join(dist, 'index.html');

assert.equal(fs.existsSync(htmlPath), true, 'dist/index.html must exist');
const html = fs.readFileSync(htmlPath, 'utf8');
assert.match(html, /<title>Zen Driving/);
assert.match(html, /\/zen-driving\/assets\/index-[^"']+\.js/);
assert.match(html, /\/zen-driving\/assets\/index-[^"']+\.css/);
assert.doesNotMatch(html, /(?:src|href)=["']\/(?:src|assets)\//, 'root-absolute runtime URLs break project Pages');

const files = fs.readdirSync(path.join(dist, 'assets'));
assert.equal(files.some((file) => file.startsWith('zen-driving-logo-v1-')), true, 'logo must be bundled');
assert.equal(files.some((file) => file.endsWith('.js')), true, 'game bundle must be present');
assert.equal(files.some((file) => file.endsWith('.css')), true, 'style bundle must be present');

console.log(`Deployment smoke passed: repository-relative HTML and ${files.length} bundled assets.`);

