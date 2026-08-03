/**
 * Converts the source PNG textures in assets/ to WebP.
 *
 * The four 1254x1254 game textures shipped as uncompressed PNG (10.6 MB
 * combined) and two of them — bark and foliage — are awaited during scene
 * build, so they sat directly on the critical path to the first playable
 * frame. The house atlases were already WebP; this brings the rest in line.
 *
 * Re-run with `npm run assets:optimize` after replacing any source PNG.
 * Originals remain recoverable from git history.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');

// alphaQuality stays at 100 for the cutout atlases: foliage is sampled with
// alphaTest, so a soft alpha channel shows up as fringing on every leaf edge.
const TARGETS = [
  { source: 'tree-bark-ai.png', quality: 82 },
  { source: 'vehicle-paint-ai.png', quality: 82 },
  { source: 'vehicle-trim-ai.png', quality: 82 },
  { source: 'foliage-atlas-ai.png', quality: 88, alphaQuality: 100 },
  { source: 'zen-driving-logo-v1.png', quality: 90, alphaQuality: 100 },
];

const mib = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

async function sizeOf(file) {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

let before = 0;
let after = 0;

for (const { source, quality, alphaQuality } of TARGETS) {
  const sourcePath = path.join(assets, source);
  const outputPath = path.join(assets, source.replace(/\.png$/, '.webp'));
  const sourceBytes = await sizeOf(sourcePath);

  if (!sourceBytes) {
    const existing = await sizeOf(outputPath);
    if (!existing) throw new Error(`Missing both ${source} and its WebP output.`);
    console.log(`${source.padEnd(28)} source absent, keeping ${mib(existing)} WebP`);
    before += existing;
    after += existing;
    continue;
  }

  await sharp(sourcePath)
    .webp({ quality, alphaQuality: alphaQuality ?? quality, effort: 6 })
    .toFile(outputPath);

  const outputBytes = await sizeOf(outputPath);
  before += sourceBytes;
  after += outputBytes;
  const saved = (1 - outputBytes / sourceBytes) * 100;
  console.log(`${source.padEnd(28)} ${mib(sourceBytes)} -> ${mib(outputBytes)} (-${saved.toFixed(1)}%)`);
}

console.log(`\nTotal: ${mib(before)} -> ${mib(after)} (-${((1 - after / before) * 100).toFixed(1)}%)`);
