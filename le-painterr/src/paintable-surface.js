import * as THREE from 'three';

const COVERAGE_GRID = 40;

/**
 * One paintable wall.
 *
 * Paint lives in a 2D canvas that is uploaded as a CanvasTexture and blended
 * over the siding inside the standard material (see patchMaterial). Coverage is
 * tracked in a coarse boolean grid rather than by reading pixels back, so the
 * HUD can update every frame without stalling the GPU.
 */
export class PaintableSurface {
  /**
   * @param {object} options
   * @param {THREE.Mesh} options.mesh          mesh whose UV 0..1 maps to this surface
   * @param {number} options.width             world width in metres
   * @param {number} options.height            world height in metres
   * @param {HTMLImageElement} options.stamp   brush alpha stamp
   * @param {Array<{u:number,v:number,w:number,h:number}>} [options.holes]
   *        UV rectangles that cannot be painted (windows, doors) and are
   *        therefore excluded from the coverage denominator.
   * @param {(u:number,v:number)=>boolean} [options.mask]
   *        Returns false for UV space that is not part of the surface at all —
   *        the gable triangles use this so their corners are not counted.
   * @param {number} [options.texelsPerMetre]
   */
  constructor({ mesh, width, height, stamp, holes = [], mask = null, texelsPerMetre = 96 }) {
    this.mesh = mesh;
    this.width = width;
    this.height = height;
    this.stampImage = stamp;
    this.holes = holes;
    this.mask = mask;

    const canvasWidth = THREE.MathUtils.floorPowerOfTwo(
      THREE.MathUtils.clamp(width * texelsPerMetre, 256, 1024),
    );
    const canvasHeight = THREE.MathUtils.floorPowerOfTwo(
      THREE.MathUtils.clamp(height * texelsPerMetre, 256, 1024),
    );

    this.canvas = document.createElement('canvas');
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;
    this.context = this.canvas.getContext('2d', { willReadFrequently: false });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;

    // Tinted copies of the brush stamp, one per colour, built on first use.
    this.stampCache = new Map();

    this.cells = new Uint8Array(COVERAGE_GRID * COVERAGE_GRID);
    this.paintableCells = 0;
    this.paintedCells = 0;
    this.#markUnpaintableCells();
  }

  #markUnpaintableCells() {
    for (let row = 0; row < COVERAGE_GRID; row += 1) {
      for (let column = 0; column < COVERAGE_GRID; column += 1) {
        const u = (column + 0.5) / COVERAGE_GRID;
        const v = (row + 0.5) / COVERAGE_GRID;
        const outside = this.mask ? !this.mask(u, v) : false;
        const blocked =
          outside ||
          this.holes.some(
            (hole) => Math.abs(u - hole.u) <= hole.w / 2 && Math.abs(v - hole.v) <= hole.h / 2,
          );
        // 2 = permanently excluded, 0 = bare, 1 = painted.
        this.cells[row * COVERAGE_GRID + column] = blocked ? 2 : 0;
        if (!blocked) this.paintableCells += 1;
      }
    }
  }

  #tintedStamp(colorHex) {
    const cached = this.stampCache.get(colorHex);
    if (cached) return cached;

    const { width, height } = this.stampImage;
    const tinted = document.createElement('canvas');
    tinted.width = width;
    tinted.height = height;
    const context = tinted.getContext('2d');
    context.drawImage(this.stampImage, 0, 0);
    // Keep the stamp's alpha, replace its RGB with the paint colour.
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = colorHex;
    context.fillRect(0, 0, width, height);

    this.stampCache.set(colorHex, tinted);
    return tinted;
  }

  /**
   * Lays one dab of paint.
   * @param {THREE.Vector2} uv        hit point in surface UV space
   * @param {string} colorHex         CSS colour of the current paint
   * @param {number} radiusMetres     brush radius in world units
   */
  paint(uv, colorHex, radiusMetres) {
    const stamp = this.#tintedStamp(colorHex);
    const pixelRadiusX = (radiusMetres / this.width) * this.canvas.width;
    const pixelRadiusY = (radiusMetres / this.height) * this.canvas.height;
    const x = uv.x * this.canvas.width;
    // Canvas Y grows downward, UV V grows upward.
    const y = (1 - uv.y) * this.canvas.height;

    this.context.drawImage(
      stamp,
      x - pixelRadiusX,
      y - pixelRadiusY,
      pixelRadiusX * 2,
      pixelRadiusY * 2,
    );
    this.texture.needsUpdate = true;

    this.#markCovered(uv, radiusMetres);
  }

  #markCovered(uv, radiusMetres) {
    // Count a cell only when the dab's solid core reaches it, so coverage does
    // not run ahead of what the player can actually see.
    const solid = 0.62;
    const radiusU = ((radiusMetres * solid) / this.width) * COVERAGE_GRID;
    const radiusV = ((radiusMetres * solid) / this.height) * COVERAGE_GRID;
    const centreColumn = uv.x * COVERAGE_GRID;
    const centreRow = uv.y * COVERAGE_GRID;

    const minColumn = Math.max(0, Math.floor(centreColumn - radiusU));
    const maxColumn = Math.min(COVERAGE_GRID - 1, Math.ceil(centreColumn + radiusU));
    const minRow = Math.max(0, Math.floor(centreRow - radiusV));
    const maxRow = Math.min(COVERAGE_GRID - 1, Math.ceil(centreRow + radiusV));

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const index = row * COVERAGE_GRID + column;
        if (this.cells[index] !== 0) continue;
        const dx = (column + 0.5 - centreColumn) / Math.max(radiusU, 1e-4);
        const dy = (row + 0.5 - centreRow) / Math.max(radiusV, 1e-4);
        if (dx * dx + dy * dy > 1) continue;
        this.cells[index] = 1;
        this.paintedCells += 1;
      }
    }
  }

  /** Fraction of the paintable area covered, 0..1. */
  get coverage() {
    return this.paintableCells === 0 ? 1 : this.paintedCells / this.paintableCells;
  }

  reset() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
    this.paintedCells = 0;
    for (let i = 0; i < this.cells.length; i += 1) {
      if (this.cells[i] === 1) this.cells[i] = 0;
    }
  }

  dispose() {
    this.texture.dispose();
    this.stampCache.clear();
  }
}

/**
 * Blends a surface's paint canvas into a MeshStandardMaterial.
 *
 * The siding is tiled here rather than through `map.repeat` so the paint layer
 * can share the mesh's untransformed UVs — one varying, no second UV channel,
 * and every wall keeps the same siding texel density regardless of its size.
 */
export function patchMaterial(material, surface, tiling) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.paintMap = { value: surface.texture };
    shader.uniforms.sidingTiling = { value: tiling };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D paintMap;
        uniform vec2 sidingTiling;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 sidingTexel = texture2D( map, vMapUv * sidingTiling );
        diffuseColor *= sidingTexel;
        vec4 paintTexel = texture2D( paintMap, vMapUv );
        diffuseColor.rgb = mix( diffuseColor.rgb, paintTexel.rgb, paintTexel.a );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness * texture2D( roughnessMap, vMapUv * sidingTiling ).g;
        // Fresh paint is glossier than bare primer.
        roughnessFactor = mix( roughnessFactor, 0.42, texture2D( paintMap, vMapUv ).a );`,
      );
  };

  // Keep patched walls on their own program; the stock standard material is
  // still used elsewhere in the scene.
  material.customProgramCacheKey = () => 'le-painterr-paintable';
  return material;
}
