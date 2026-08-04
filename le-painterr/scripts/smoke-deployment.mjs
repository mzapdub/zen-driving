/**
 * Deployment smoke test: run against dist/ after `npm run build`.
 *
 * Beyond checking that the bundle is repository-relative, this asserts the
 * image budgets on the *shipped* files — an oversized or wrongly-encoded
 * texture fails the build here rather than on someone's phone data plan.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  BANNED_IMAGE_EXTENSIONS,
  SHIPPABLE_IMAGE_EXTENSIONS,
  assetsDir,
  formatBytes,
  loadManifest,
  projectRoot,
} from './asset-manifest.mjs';

const dist = path.join(projectRoot, 'dist');
const repository = (process.env.GITHUB_REPOSITORY ?? '').split('/')[1] || 'le-painterr';
const base = process.env.GITHUB_ACTIONS === 'true' ? `/${repository}/` : '/';

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

/* ---------- HTML ---------- */

const htmlPath = path.join(dist, 'index.html');
assert.equal(fs.existsSync(htmlPath), true, 'dist/index.html must exist — run `npm run build` first');

const html = fs.readFileSync(htmlPath, 'utf8');
assert.match(html, /<title>Le Painterr/, 'the page title must identify the game');

const escapedBase = base.replace(/[/]/g, '\\/');
assert.match(
  html,
  new RegExp(`${escapedBase}assets\\/index-[^"']+\\.js`),
  `the JS bundle must be referenced under the repository-relative base ${base}`,
);
assert.match(
  html,
  new RegExp(`${escapedBase}assets\\/index-[^"']+\\.css`),
  `the CSS bundle must be referenced under the repository-relative base ${base}`,
);

if (base !== '/') {
  assert.doesNotMatch(
    html,
    /(?:src|href)=["']\/(?:src|assets)\//,
    'root-absolute runtime URLs break project Pages',
  );
}

/* ---------- bundles ---------- */

const distAssets = path.join(dist, 'assets');
assert.equal(fs.existsSync(distAssets), true, 'dist/assets must exist');

const bundled = fs.readdirSync(distAssets);
assert.equal(bundled.some((file) => file.endsWith('.js')), true, 'game bundle must be present');
assert.equal(bundled.some((file) => file.endsWith('.css')), true, 'style bundle must be present');

const scriptBundle = bundled.find((file) => file.endsWith('.js'));
const scriptSource = fs.readFileSync(path.join(distAssets, scriptBundle), 'utf8');
assert.match(
  scriptSource,
  /le-painterr-mark-[^"']+\.webp/,
  'the brand mark must be bundled through the asset pipeline, not linked loose',
);

/* ---------- texture budgets ---------- */

const { budgets, textures } = loadManifest();

// Committed WebP -> manifest entry, keyed by content hash. Matching on bytes
// (not on the hashed filename) also proves Vite shipped the optimizer's output
// untouched.
const byHash = new Map();
for (const texture of textures) {
  const committed = path.join(assetsDir, texture.file);
  assert.equal(fs.existsSync(committed), true, `assets/${texture.file} is missing — run \`npm run assets:optimize\``);
  byHash.set(sha256(committed), texture);
}

const shippedFiles = walk(dist);
const shippedImages = shippedFiles.filter((file) => {
  const extension = path.extname(file).toLowerCase();
  return SHIPPABLE_IMAGE_EXTENSIONS.has(extension) || BANNED_IMAGE_EXTENSIONS.has(extension);
});

const banned = shippedImages.filter((file) =>
  BANNED_IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()),
);
assert.deepEqual(
  banned.map((file) => path.relative(dist, file)),
  [],
  'textures ship as WebP only — a PNG/JPEG reached dist/',
);

const failures = [];
const seen = new Set();
let totalImageBytes = 0;

for (const file of shippedImages) {
  const bytes = fs.statSync(file).size;
  totalImageBytes += bytes;

  const relative = path.relative(dist, file);
  const texture = byHash.get(sha256(file));
  if (!texture) {
    failures.push(`${relative}: shipped image is not in assets/textures.manifest.json (no declared budget)`);
    continue;
  }
  seen.add(texture.id);

  const budget = Math.min(texture.maxBytes, budgets.perImageBytes);
  if (bytes > budget) {
    failures.push(`${relative}: ${formatBytes(bytes)} exceeds the ${formatBytes(budget)} budget for ${texture.id}`);
  }
}

for (const texture of textures) {
  if (!seen.has(texture.id)) {
    failures.push(`${texture.id}: declared in the manifest but never reached dist/ — is it still imported?`);
  }
}

if (totalImageBytes > budgets.totalImageBytes) {
  failures.push(
    `total shipped image weight ${formatBytes(totalImageBytes)} exceeds the ` +
      `${formatBytes(budgets.totalImageBytes)} budget`,
  );
}

if (failures.length > 0) {
  console.error(`Image budget check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
  throw new Error('Deployment smoke failed on image budgets.');
}

console.log(
  `Deployment smoke passed: base "${base}", ${shippedFiles.length} files, ` +
    `${shippedImages.length} WebP textures at ${formatBytes(totalImageBytes)} / ` +
    `${formatBytes(budgets.totalImageBytes)} (${((totalImageBytes / budgets.totalImageBytes) * 100).toFixed(0)}% of budget).`,
);
