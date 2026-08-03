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

const distAssets = path.join(dist, 'assets');
const files = fs.readdirSync(distAssets);
assert.equal(files.some((file) => file.startsWith('zen-driving-logo-v1-')), true, 'logo must be bundled');
assert.equal(files.some((file) => file.endsWith('.js')), true, 'game bundle must be present');
assert.equal(files.some((file) => file.endsWith('.css')), true, 'style bundle must be present');

// Bark and foliage are awaited during scene build, so an oversized texture
// delays the first playable frame rather than merely costing bandwidth.
// Keep every shipped image in the budget WebP already comfortably meets.
const IMAGE_BUDGET_BYTES = 768 * 1024;
const TOTAL_IMAGE_BUDGET_BYTES = 4 * 1024 * 1024;
const imagePattern = /\.(png|jpe?g|webp|avif|gif)$/i;

let imageBytes = 0;
for (const file of files.filter((name) => imagePattern.test(name))) {
  const bytes = fs.statSync(path.join(distAssets, file)).size;
  imageBytes += bytes;
  assert.ok(
    bytes <= IMAGE_BUDGET_BYTES,
    `${file} is ${(bytes / 1024).toFixed(0)} KB, over the ${IMAGE_BUDGET_BYTES / 1024} KB per-image budget; run npm run assets:optimize`,
  );
}
assert.ok(
  imageBytes <= TOTAL_IMAGE_BUDGET_BYTES,
  `bundled images total ${(imageBytes / 1048576).toFixed(2)} MB, over the ${TOTAL_IMAGE_BUDGET_BYTES / 1048576} MB budget`,
);

console.log(
  `Deployment smoke passed: repository-relative HTML, ${files.length} bundled assets, `
  + `${(imageBytes / 1048576).toFixed(2)} MB of images.`,
);

