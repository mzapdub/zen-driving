import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const assetsDir = path.join(projectRoot, 'assets');
export const sourceDir = path.join(assetsDir, 'source');
export const manifestPath = path.join(assetsDir, 'textures.manifest.json');

/** Extensions that are allowed to reach the published bundle. */
export const SHIPPABLE_IMAGE_EXTENSIONS = new Set(['.webp']);

/** Anything in this list is a texture format we deliberately refuse to ship. */
export const BANNED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.avif']);

const VALID_ROLES = new Set(['color', 'data', 'cutout']);

function fail(message) {
  throw new Error(`textures.manifest.json: ${message}`);
}

/**
 * Reads the texture manifest and enforces the invariants that keep the asset
 * pipeline honest. Both the optimizer and the deployment smoke test read the
 * same file, so a texture cannot be added to the game without a declared budget.
 */
export function loadManifest() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const budgets = manifest.budgets ?? {};

  if (!Number.isInteger(budgets.perImageBytes) || budgets.perImageBytes <= 0) {
    fail('budgets.perImageBytes must be a positive integer');
  }
  if (!Number.isInteger(budgets.totalImageBytes) || budgets.totalImageBytes <= 0) {
    fail('budgets.totalImageBytes must be a positive integer');
  }
  if (!Array.isArray(manifest.textures) || manifest.textures.length === 0) {
    fail('textures must be a non-empty array');
  }

  const seen = new Set();
  let declaredTotal = 0;

  for (const texture of manifest.textures) {
    const { id, file, source, role, size, maxBytes, encode } = texture;

    if (!id || seen.has(id)) fail(`duplicate or missing texture id "${id}"`);
    seen.add(id);

    if (!VALID_ROLES.has(role)) {
      fail(`${id}: role must be one of ${[...VALID_ROLES].join(', ')}`);
    }
    if (path.extname(file) !== '.webp') {
      fail(`${id}: shipped textures are WebP only, got "${file}"`);
    }
    if (!source || path.extname(source) !== '.png') {
      fail(`${id}: source must be a lossless .png, got "${source}"`);
    }
    if (!Number.isInteger(size) || size <= 0) {
      fail(`${id}: size must be a positive integer`);
    }
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      fail(`${id}: maxBytes must be a positive integer`);
    }
    if (maxBytes > budgets.perImageBytes) {
      fail(`${id}: maxBytes ${maxBytes} exceeds the global per-image budget ${budgets.perImageBytes}`);
    }
    if (!encode || typeof encode !== 'object') {
      fail(`${id}: encode options are required`);
    }

    // The rule that matters most: lossy alpha reads as a halo on anything the
    // renderer samples with alphaTest, so cutouts pin alphaQuality at 100.
    if (role === 'cutout' && encode.alphaQuality !== 100) {
      fail(`${id}: cutout textures must encode with alphaQuality: 100 (got ${encode.alphaQuality ?? 'undefined'})`);
    }
    if (role !== 'cutout' && encode.alphaQuality !== undefined) {
      fail(`${id}: only cutout textures carry an alpha channel; drop encode.alphaQuality`);
    }

    declaredTotal += maxBytes;
  }

  // declaredTotal is intentionally allowed to exceed the total budget: per-image
  // caps are individual worst cases, while totalImageBytes is a hard ceiling on
  // the bytes actually produced. Both are asserted against real output later.
  return { budgets, textures: manifest.textures, declaredTotal };
}

export function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
