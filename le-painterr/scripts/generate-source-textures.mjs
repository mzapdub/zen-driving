/**
 * Regenerates the lossless PNG *sources* for every texture in the manifest.
 *
 * The art is procedural on purpose: a clean checkout can rebuild byte-identical
 * sources with `npm run assets:source`, so `npm run assets:optimize` is
 * reproducible without committing binary source art. Replace a generator here
 * (or drop a hand-authored PNG at the manifest's `source` path and delete the
 * matching entry from GENERATORS) and the WebP encode step is unchanged.
 *
 * Sources live in assets/source/ and are git-ignored. They are never shipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { loadManifest, sourceDir, projectRoot } from './asset-manifest.mjs';

/* ------------------------------------------------------------------ *
 * Deterministic noise helpers
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Tileable value noise over a `cells`x`cells` lattice, sampled in [0,1). */
function valueNoise(seed, cells) {
  const rand = mulberry32(seed);
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();

  return (x, y) => {
    const fx = x * cells;
    const fy = y * cells;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smoothstep(fx - ix);
    const ty = smoothstep(fy - iy);
    const i0 = ((ix % cells) + cells) % cells;
    const j0 = ((iy % cells) + cells) % cells;
    const i1 = (i0 + 1) % cells;
    const j1 = (j0 + 1) % cells;
    const top = lerp(grid[j0 * cells + i0], grid[j0 * cells + i1], tx);
    const bottom = lerp(grid[j1 * cells + i0], grid[j1 * cells + i1], tx);
    return lerp(top, bottom, ty);
  };
}

/** Tileable fractal noise; `octaves` are [cells, amplitude] pairs. */
function fbm(seed, octaves) {
  const layers = octaves.map(([cells], index) => valueNoise(seed + index * 977, cells));
  const total = octaves.reduce((sum, [, amplitude]) => sum + amplitude, 0);
  return (x, y) => {
    let sum = 0;
    for (let i = 0; i < layers.length; i += 1) sum += layers[i](x, y) * octaves[i][1];
    return sum / total;
  };
}

/* ------------------------------------------------------------------ *
 * Buffer helpers
 * ------------------------------------------------------------------ */

function rgbCanvas(size) {
  return { size, channels: 3, data: Buffer.alloc(size * size * 3) };
}

function rgbaCanvas(size) {
  return { size, channels: 4, data: Buffer.alloc(size * size * 4) };
}

function setPixel(canvas, x, y, r, g, b, a = 255) {
  const index = (y * canvas.size + x) * canvas.channels;
  canvas.data[index] = Math.round(clamp01(r / 255) * 255);
  canvas.data[index + 1] = Math.round(clamp01(g / 255) * 255);
  canvas.data[index + 2] = Math.round(clamp01(b / 255) * 255);
  if (canvas.channels === 4) canvas.data[index + 3] = Math.round(clamp01(a / 255) * 255);
}

/* ------------------------------------------------------------------ *
 * Texture generators
 * ------------------------------------------------------------------ */

/** Bare primed clapboard. Deliberately drab — the player's paint is the colour. */
function houseSiding(size) {
  const canvas = rgbCanvas(size);
  const grain = fbm(1201, [
    [64, 1],
    [128, 0.5],
    [256, 0.25],
  ]);
  const blotch = fbm(1613, [
    [4, 1],
    [8, 0.5],
  ]);
  const boards = 8;
  const boardHeight = size / boards;
  const boardTint = new Float32Array(boards);
  const rand = mulberry32(4409);
  for (let i = 0; i < boards; i += 1) boardTint[i] = rand() * 12 - 6;

  for (let y = 0; y < size; y += 1) {
    const board = Math.floor(y / boardHeight);
    const t = (y % boardHeight) / boardHeight;
    // Overlap shadow at the top of each board, gentle bevel highlight below it.
    const shadow = t < 0.08 ? lerp(-42, 0, smoothstep(t / 0.08)) : 0;
    const bevel = lerp(6, -4, smoothstep(t));
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      // Grain runs along the board, so stretch the sample horizontally.
      const g = (grain(u * 0.35, v * 3) - 0.5) * 16;
      const patch = (blotch(u, v) - 0.5) * 10;
      const base = 202 + boardTint[board] + shadow + bevel + g + patch;
      setPixel(canvas, x, y, base + 6, base + 1, base - 10);
    }
  }
  return canvas;
}

/** Roughness for the siding: chalky primer, with the shadow groove rougher still. */
function houseSidingRoughness(size) {
  const canvas = rgbCanvas(size);
  const grain = fbm(2207, [
    [64, 1],
    [192, 0.6],
  ]);
  const boardHeight = size / 8;

  for (let y = 0; y < size; y += 1) {
    const t = (y % boardHeight) / boardHeight;
    const groove = t < 0.08 ? lerp(28, 0, smoothstep(t / 0.08)) : 0;
    for (let x = 0; x < size; x += 1) {
      const g = (grain(x / size * 0.35, y / size * 3) - 0.5) * 26;
      const value = 206 + groove + g;
      setPixel(canvas, x, y, value, value, value);
    }
  }
  return canvas;
}

/** Slate shingles in offset courses. */
function roofShingles(size) {
  const canvas = rgbCanvas(size);
  const grit = fbm(3301, [
    [128, 1],
    [256, 0.5],
  ]);
  const rows = 16;
  const cols = 8;
  const rowHeight = size / rows;
  const colWidth = size / cols;
  const rand = mulberry32(7717);
  const tileTint = new Float32Array(rows * cols * 2);
  for (let i = 0; i < tileTint.length; i += 1) tileTint[i] = rand() * 18 - 9;

  for (let y = 0; y < size; y += 1) {
    const row = Math.floor(y / rowHeight);
    const ty = (y % rowHeight) / rowHeight;
    const offset = row % 2 === 0 ? 0 : colWidth / 2;
    // Each course casts a hard shadow on the course below it.
    const courseShade = ty < 0.12 ? lerp(-30, 0, smoothstep(ty / 0.12)) : lerp(0, -8, smoothstep(ty));
    for (let x = 0; x < size; x += 1) {
      const shifted = (x + offset) % size;
      const col = Math.floor(shifted / colWidth);
      const tx = (shifted % colWidth) / colWidth;
      const seam = tx < 0.02 || tx > 0.98 ? -26 : 0;
      const tint = tileTint[(row * cols + col) % tileTint.length];
      const g = (grit(x / size, y / size) - 0.5) * 22;
      const base = 74 + tint + courseShade + seam + g;
      setPixel(canvas, x, y, base * 0.92, base * 0.98, base * 1.12);
    }
  }
  return canvas;
}

/** Lawn around the house. */
function groundGrass(size) {
  const canvas = rgbCanvas(size);
  const patches = fbm(5501, [
    [6, 1],
    [12, 0.5],
    [24, 0.25],
  ]);
  const blades = fbm(5923, [
    [256, 1],
    [512, 0.6],
  ]);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const p = patches(u, v);
      const b = blades(u, v);
      const luma = 0.55 + p * 0.3 + (b - 0.5) * 0.42;
      setPixel(canvas, x, y, 46 * luma + 18, 104 * luma + 26, 42 * luma + 16);
    }
  }
  return canvas;
}

/** Hedge foliage — a real alpha cutout, sampled with alphaTest in the game. */
function hedgeLeaves(size) {
  const canvas = rgbaCanvas(size);
  const rand = mulberry32(8081);
  const leaves = [];
  for (let i = 0; i < 260; i += 1) {
    leaves.push({
      cx: rand() * size,
      cy: rand() * size,
      a: size * (0.035 + rand() * 0.045),
      b: size * (0.016 + rand() * 0.022),
      angle: rand() * Math.PI * 2,
      shade: 0.62 + rand() * 0.5,
    });
  }

  const wrapDelta = (value, span) => {
    let d = value;
    if (d > span / 2) d -= span;
    if (d < -span / 2) d += span;
    return d;
  };

  for (const leaf of leaves) {
    const reach = Math.ceil(Math.max(leaf.a, leaf.b)) + 2;
    const cos = Math.cos(-leaf.angle);
    const sin = Math.sin(-leaf.angle);
    for (let oy = -reach; oy <= reach; oy += 1) {
      for (let ox = -reach; ox <= reach; ox += 1) {
        const px = Math.round(leaf.cx + ox);
        const py = Math.round(leaf.cy + oy);
        const dx = wrapDelta(px - leaf.cx, size);
        const dy = wrapDelta(py - leaf.cy, size);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        const d = Math.hypot(lx / leaf.a, ly / leaf.b);
        if (d > 1.08) continue;
        // Tight edge ramp: enough to avoid stair-stepping, still a crisp cutout.
        const alpha = clamp01((1.02 - d) * 8) * 255;
        if (alpha <= 1) continue;
        const x = ((px % size) + size) % size;
        const y = ((py % size) + size) % size;
        const index = (y * size + x) * 4;
        if (canvas.data[index + 3] > alpha) continue;
        // Midrib runs the long axis of the leaf.
        const rib = 1 - clamp01(Math.abs(ly / leaf.b) * 3);
        const shade = leaf.shade * (1 - rib * 0.22);
        canvas.data[index] = Math.round(clamp01((78 * shade + 26) / 255) * 255);
        canvas.data[index + 1] = Math.round(clamp01((150 * shade + 48) / 255) * 255);
        canvas.data[index + 2] = Math.round(clamp01((66 * shade + 30) / 255) * 255);
        canvas.data[index + 3] = Math.round(alpha);
      }
    }
  }
  return canvas;
}

/** Soft, slightly ragged paint dab used as the brush alpha stamp. */
function brushStamp(size) {
  const canvas = rgbaCanvas(size);
  const wobble = fbm(9109, [
    [8, 1],
    [24, 0.5],
  ]);
  const speckle = fbm(9403, [
    [64, 1],
    [128, 0.6],
  ]);
  const centre = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const angle = Math.atan2(dy, dx);
      const radius = Math.hypot(dx, dy);
      // Perturb the silhouette so repeated dabs do not read as perfect circles.
      const edge = 0.82 + (wobble(0.5 + Math.cos(angle) * 0.3, 0.5 + Math.sin(angle) * 0.3) - 0.5) * 0.22;
      let alpha = clamp01((edge - radius) / 0.34);
      alpha *= 0.72 + speckle(x / size, y / size) * 0.5;
      setPixel(canvas, x, y, 255, 255, 255, clamp01(alpha) * 255);
    }
  }
  return canvas;
}

/** Wordless brand mark: a paint roller with a drip. Cutout, used in the UI. */
function lePainterrMark(size) {
  const canvas = rgbaCanvas(size);
  const s = size / 512;

  const sdRoundBox = (px, py, cx, cy, hw, hh, r) => {
    const qx = Math.abs(px - cx) - (hw - r);
    const qy = Math.abs(py - cy) - (hh - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const sdSegment = (px, py, ax, ay, bx, by, r) => {
    const pax = px - ax;
    const pay = py - ay;
    const bax = bx - ax;
    const bay = by - ay;
    const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay));
    return Math.hypot(pax - bax * h, pay - bay * h) - r;
  };
  const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

  const sleeve = { r: 242, g: 178, b: 58 };
  const metal = { r: 226, g: 228, b: 233 };
  const drip = { r: 92, g: 176, b: 214 };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x / s;
      const py = y / s;

      const dSleeve = sdRoundBox(px, py, 256, 150, 152, 54, 24);
      const dArm = Math.min(
        sdSegment(px, py, 256, 204, 256, 272, 11),
        sdSegment(px, py, 216, 272, 296, 272, 11),
      );
      const dHandle = sdRoundBox(px, py, 256, 372, 26, 92, 24);
      const dDrips = Math.min(
        sdCircle(px, py, 150, 268, 26),
        sdCircle(px, py, 362, 246, 18),
      );

      const layers = [
        { d: dDrips, colour: drip },
        { d: dSleeve, colour: sleeve },
        { d: Math.min(dArm, dHandle), colour: metal },
      ];

      let alpha = 0;
      let colour = sleeve;
      let best = Infinity;
      for (const layer of layers) {
        const a = clamp01(0.5 - layer.d * s);
        if (a <= 0) continue;
        alpha = Math.max(alpha, a);
        if (layer.d < best) {
          best = layer.d;
          colour = layer.colour;
        }
      }
      if (alpha <= 0) continue;

      // Cheap top-lit shading so the mark is not a flat silhouette.
      const shade = 0.86 + 0.24 * (1 - py / 512);
      setPixel(canvas, x, y, colour.r * shade, colour.g * shade, colour.b * shade, alpha * 255);
    }
  }
  return canvas;
}

const GENERATORS = {
  'house-siding': houseSiding,
  'house-siding-roughness': houseSidingRoughness,
  'roof-shingles': roofShingles,
  'ground-grass': groundGrass,
  'hedge-leaves': hedgeLeaves,
  'brush-stamp': brushStamp,
  'le-painterr-mark': lePainterrMark,
};

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

async function main() {
  const { textures } = loadManifest();
  fs.mkdirSync(sourceDir, { recursive: true });

  for (const texture of textures) {
    const generate = GENERATORS[texture.id];
    if (!generate) {
      throw new Error(
        `No source generator for "${texture.id}". Add one to GENERATORS, or hand-author ` +
          `${texture.source} and remove this check for that id.`,
      );
    }

    const canvas = generate(texture.size);
    if (texture.role === 'cutout' && canvas.channels !== 4) {
      throw new Error(`${texture.id} is declared as a cutout but its generator produced no alpha channel`);
    }
    if (texture.role !== 'cutout' && canvas.channels !== 3) {
      throw new Error(`${texture.id} is opaque but its generator produced an alpha channel`);
    }

    const outputPath = path.join(sourceDir, path.basename(texture.source));
    await sharp(canvas.data, {
      raw: { width: canvas.size, height: canvas.size, channels: canvas.channels },
    })
      .png({ compressionLevel: 9, effort: 10 })
      .toFile(outputPath);

    console.log(
      `source ${texture.id.padEnd(24)} ${texture.size}x${texture.size} ` +
        `${canvas.channels === 4 ? 'RGBA' : 'RGB '} -> ${path.relative(projectRoot, outputPath)}`,
    );
  }

  console.log(`\nGenerated ${textures.length} lossless sources in assets/source/ (git-ignored).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
