import * as THREE from 'three';

// Every texture is imported through Vite so the bundler hashes it and rewrites
// the URL against the repository-relative base. Nothing here is a PNG: the
// asset pipeline emits WebP only (see assets/textures.manifest.json).
import houseSidingUrl from '../assets/house-siding.webp';
import houseSidingRoughnessUrl from '../assets/house-siding-roughness.webp';
import roofShinglesUrl from '../assets/roof-shingles.webp';
import groundGrassUrl from '../assets/ground-grass.webp';
import hedgeLeavesUrl from '../assets/hedge-leaves.webp';
import brushStampUrl from '../assets/brush-stamp.webp';
import lePainterrMarkUrl from '../assets/le-painterr-mark.webp';

export { lePainterrMarkUrl, brushStampUrl };

const TEXTURE_SPECS = [
  // The siding pair keeps an identity UV transform: the paint layer is sampled
  // with the same varying, and each wall tiles the siding itself through a
  // uniform so texel density stays constant across differently sized walls.
  { id: 'siding', url: houseSidingUrl, colorSpace: THREE.SRGBColorSpace, repeat: [1, 1] },
  { id: 'sidingRoughness', url: houseSidingRoughnessUrl, colorSpace: THREE.NoColorSpace, repeat: [1, 1] },
  { id: 'roof', url: roofShinglesUrl, colorSpace: THREE.SRGBColorSpace, repeat: [4, 2] },
  { id: 'grass', url: groundGrassUrl, colorSpace: THREE.SRGBColorSpace, repeat: [28, 28] },
  // Sampled with alphaTest — this is exactly the texture that would show WebP
  // alpha fringing if it were not encoded at alphaQuality: 100.
  { id: 'hedge', url: hedgeLeavesUrl, colorSpace: THREE.SRGBColorSpace, repeat: [1, 1] },
];

/** Loads the brush stamp as an HTMLImageElement — it is drawn with the 2D canvas API, not sampled by the GPU. */
function loadBrushStamp() {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load the brush stamp texture'));
    image.src = brushStampUrl;
  });
}

/**
 * Loads every game texture up front so the first frame is never half-dressed.
 * `onProgress` receives (loaded, total) for the loading screen.
 */
export async function loadGameTextures(renderer, onProgress = () => {}) {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const total = TEXTURE_SPECS.length + 1;
  let loaded = 0;

  const tick = () => {
    loaded += 1;
    onProgress(loaded, total);
  };

  const entries = await Promise.all(
    TEXTURE_SPECS.map(async (spec) => {
      const texture = await loader.loadAsync(spec.url);
      texture.colorSpace = spec.colorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(spec.repeat[0], spec.repeat[1]);
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
      tick();
      return [spec.id, texture];
    }),
  );

  const brushStamp = await loadBrushStamp();
  tick();

  return { ...Object.fromEntries(entries), brushStamp };
}
