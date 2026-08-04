/**
 * Encodes every manifest texture from its lossless PNG source to the WebP that
 * actually ships, then asserts the size budgets.
 *
 *   npm run assets:optimize   regenerate sources + re-encode every WebP
 *   npm run assets:verify     check the committed WebPs without rewriting them
 *
 * Encode settings live in assets/textures.manifest.json so a re-encode is
 * reproducible: same sources + same settings + same sharp version = same bytes.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  BANNED_IMAGE_EXTENSIONS,
  assetsDir,
  formatBytes,
  loadManifest,
  projectRoot,
  sourceDir,
} from './asset-manifest.mjs';

const verifyOnly = process.argv.includes('--verify');

/** assets/ may only ever contain WebP (plus the manifest and the ignored source dir). */
function assertNoBannedFormatsCommitted() {
  const strays = fs
    .readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => BANNED_IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()));

  if (strays.length > 0) {
    throw new Error(
      `assets/ must contain WebP only, found: ${strays.join(', ')}. ` +
        `Put the lossless original in assets/source/ and add a manifest entry instead.`,
    );
  }
}

async function encode(texture) {
  const sourcePath = path.join(sourceDir, path.basename(texture.source));
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`${texture.id}: missing source ${texture.source}. Run \`npm run assets:source\` first.`);
  }

  const options = { ...texture.encode };
  if (texture.role === 'cutout') {
    // Belt and braces — the manifest loader already refuses anything else.
    options.alphaQuality = 100;
  }

  const buffer = await sharp(sourcePath)
    .webp(options)
    .toBuffer();

  fs.writeFileSync(path.join(assetsDir, texture.file), buffer);
  return buffer.length;
}

async function inspect(texture) {
  const filePath = path.join(assetsDir, texture.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${texture.id}: ${texture.file} is missing. Run \`npm run assets:optimize\`.`);
  }

  const metadata = await sharp(filePath).metadata();
  if (metadata.format !== 'webp') {
    throw new Error(`${texture.id}: ${texture.file} is ${metadata.format}, expected webp`);
  }
  if (metadata.width !== texture.size || metadata.height !== texture.size) {
    throw new Error(
      `${texture.id}: expected ${texture.size}x${texture.size}, got ${metadata.width}x${metadata.height}`,
    );
  }
  if (texture.role === 'cutout' && !metadata.hasAlpha) {
    throw new Error(`${texture.id}: declared as a cutout but the encoded WebP has no alpha channel`);
  }
  if (texture.role !== 'cutout' && metadata.hasAlpha) {
    throw new Error(`${texture.id}: opaque texture carries an alpha channel — wasted bytes`);
  }

  return fs.statSync(filePath).size;
}

async function main() {
  const { budgets, textures } = loadManifest();
  assertNoBannedFormatsCommitted();

  const failures = [];
  let total = 0;

  for (const texture of textures) {
    const bytes = verifyOnly ? await inspect(texture) : await encode(texture);
    total += bytes;

    const budget = Math.min(texture.maxBytes, budgets.perImageBytes);
    const over = bytes > budget;
    if (over) {
      failures.push(
        `${texture.id}: ${formatBytes(bytes)} exceeds its ${formatBytes(budget)} budget`,
      );
    }

    const share = ((bytes / budget) * 100).toFixed(0).padStart(3);
    console.log(
      `${over ? 'OVER' : '  ok'} ${texture.id.padEnd(24)} ${formatBytes(bytes).padStart(10)} ` +
        `/ ${formatBytes(budget).padStart(10)} (${share}%)  ${texture.role}` +
        `${texture.role === 'cutout' ? ' alphaQuality=100' : ''}`,
    );
  }

  console.log(
    `\nTotal shipped image weight: ${formatBytes(total)} / ${formatBytes(budgets.totalImageBytes)} ` +
      `(${((total / budgets.totalImageBytes) * 100).toFixed(0)}%)`,
  );

  if (total > budgets.totalImageBytes) {
    failures.push(
      `total image weight ${formatBytes(total)} exceeds the ${formatBytes(budgets.totalImageBytes)} budget`,
    );
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} budget failure(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    throw new Error('Image budgets exceeded. Re-author the texture or raise the budget deliberately.');
  }

  if (!verifyOnly) {
    console.log(`Re-encoded ${textures.length} textures into ${path.relative(projectRoot, assetsDir)}/.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
