import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FACADE_ATLAS_URL = new URL('../assets/house-facade-atlas-ai.webp', import.meta.url).href;
const FACADE_ROUGHNESS_URL = new URL('../assets/house-facade-roughness.webp', import.meta.url).href;
const ROOF_ATLAS_URL = new URL('../assets/house-roof-atlas-ai.webp', import.meta.url).href;
const ROOF_ROUGHNESS_URL = new URL('../assets/house-roof-roughness.webp', import.meta.url).href;

export const HOUSE_TEXTURE_ASSETS = Object.freeze({
  facadeAtlas: FACADE_ATLAS_URL,
  facadeRoughness: FACADE_ROUGHNESS_URL,
  roofAtlas: ROOF_ATLAS_URL,
  roofRoughness: ROOF_ROUGHNESS_URL,
});

export const HOUSE_STYLES = Object.freeze(['farmhouse', 'craftsman', 'cottage', 'barn']);

const STYLE_SPECS = Object.freeze({
  farmhouse: { facade: 0, roof: 0, width: [8.4, 10.2], depth: [7.2, 8.8], wallHeight: [5.5, 6.4], roofRise: [2.1, 2.8], porch: true, stories: 2 },
  craftsman: { facade: 2, roof: 1, width: [9.5, 11.6], depth: [7.4, 9.0], wallHeight: [4.3, 5.0], roofRise: [1.8, 2.4], porch: true, stories: 1 },
  cottage: { facade: 0, roof: 3, width: [7.2, 9.0], depth: [6.5, 8.1], wallHeight: [4.2, 4.9], roofRise: [2.0, 2.7], porch: true, stories: 1 },
  barn: { facade: 1, roof: 2, width: [10.5, 13.2], depth: [11.2, 15.0], wallHeight: [6.0, 7.6], roofRise: [3.0, 4.2], porch: false, stories: 2 },
});

function seededRandom(seed) {
  let state = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function range(rng, [minimum, maximum]) {
  return THREE.MathUtils.lerp(minimum, maximum, rng());
}

function normalizePosition(value) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value)) return new THREE.Vector3(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  return new THREE.Vector3(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
}

function createFallbackTexture(seed, roof = false, roughness = false) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const rng = seededRandom(seed);
  const base = new THREE.Color(roof ? 0x494846 : 0x9a8c75);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const macro = Math.sin(x * 0.11 + seed) * Math.cos(y * 0.09 - seed) * 0.09;
      const course = roof ? (y % 9 < 2 ? -0.15 : 0.05) : (y % 8 < 2 ? -0.12 : 0.04);
      const fine = (rng() - 0.5) * 0.13;
      const value = THREE.MathUtils.clamp(0.72 + macro + course + fine, 0.24, 1);
      const offset = (y * size + x) * 4;
      if (roughness) {
        const channel = Math.round((0.55 + value * 0.4) * 255);
        data[offset] = channel;
        data[offset + 1] = channel;
        data[offset + 2] = channel;
      } else {
        data[offset] = Math.round(base.r * value * 255);
        data[offset + 1] = Math.round(base.g * value * 255);
        data[offset + 2] = Math.round(base.b * value * 255);
      }
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function createAtlasTexture(url, quadrant, roughness, resources, seed, roof = false) {
  let texture;
  if (typeof document === 'undefined') {
    texture = createFallbackTexture(seed, roof, roughness);
  } else {
    texture = new THREE.TextureLoader().load(url);
    texture.userData.sourceAsset = url;
  }
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const inset = 0.004;
  texture.repeat.set(0.5 - inset * 2, 0.5 - inset * 2);
  texture.offset.set((quadrant % 2) * 0.5 + inset, (quadrant > 1 ? 0 : 0.5) + inset);
  texture.anisotropy = 4;
  texture.colorSpace = roughness ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  resources.textures.add(texture);
  return texture;
}

function createMaterials(style, rng, resources) {
  const spec = STYLE_SPECS[style];
  const facadeMap = createAtlasTexture(FACADE_ATLAS_URL, spec.facade, false, resources, 101 + spec.facade, false);
  const facadeSurface = createAtlasTexture(FACADE_ROUGHNESS_URL, spec.facade, true, resources, 301 + spec.facade, false);
  const roofMap = createAtlasTexture(ROOF_ATLAS_URL, spec.roof, false, resources, 501 + spec.roof, true);
  const roofSurface = createAtlasTexture(ROOF_ROUGHNESS_URL, spec.roof, true, resources, 701 + spec.roof, true);
  const paintVariation = new THREE.Color().setHSL(rng() * 0.04 + 0.04, 0.08, 0.92 + rng() * 0.08);
  const materials = {
    facade: new THREE.MeshStandardMaterial({
      color: paintVariation,
      map: facadeMap,
      roughnessMap: facadeSurface,
      bumpMap: facadeSurface,
      bumpScale: style === 'barn' ? 0.095 : 0.065,
      roughness: 0.92,
      metalness: 0,
    }),
    foundation: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: createAtlasTexture(FACADE_ATLAS_URL, 3, false, resources, 104, false),
      roughnessMap: createAtlasTexture(FACADE_ROUGHNESS_URL, 3, true, resources, 304, false),
      bumpMap: facadeSurface,
      bumpScale: 0.11,
      roughness: 0.98,
    }),
    roof: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: roofMap,
      roughnessMap: roofSurface,
      bumpMap: roofSurface,
      bumpScale: spec.roof === 2 ? 0.035 : 0.075,
      roughness: spec.roof === 2 ? 0.62 : 0.91,
      metalness: spec.roof === 2 ? 0.48 : 0.02,
    }),
    trim: new THREE.MeshStandardMaterial({ color: style === 'barn' ? 0xe7dfc8 : 0xebe4d1, roughness: 0.78 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x71513a, roughness: 0.91, bumpMap: facadeSurface, bumpScale: 0.035 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x86aab5, roughness: 0.16, metalness: 0.05, transmission: 0.22, transparent: true, opacity: 0.82 }),
    interior: new THREE.MeshStandardMaterial({ color: 0xffc477, emissive: 0xff9d42, emissiveIntensity: 0.45 + rng() * 0.5, roughness: 0.7 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x34383a, roughness: 0.48, metalness: 0.7 }),
    copper: new THREE.MeshStandardMaterial({ color: 0x63554a, roughness: 0.55, metalness: 0.62 }),
    door: new THREE.MeshStandardMaterial({ color: style === 'barn' ? 0x4a251d : 0x425745, roughness: 0.82, bumpMap: facadeSurface, bumpScale: 0.035 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffd48b, emissive: 0xffa64d, emissiveIntensity: 2.1, roughness: 0.28 }),
  };
  Object.values(materials).forEach((material) => resources.materials.add(material));
  materials.facade.userData.materialLayers = ['generated_macro_albedo', 'board_or_masonry_midscale', 'fine_roughness_weathering'];
  materials.roof.userData.materialLayers = ['generated_shingle_macro', 'course_or_seam_midscale', 'granular_fine_roughness'];
  return materials;
}

function registerGeometry(resources, geometry) {
  resources.geometries.add(geometry);
  return geometry;
}

function createWindowFrameGeometry() {
  const outline = new THREE.Shape();
  outline.moveTo(-0.5, -0.5);
  outline.lineTo(0.5, -0.5);
  outline.lineTo(0.5, 0.5);
  outline.lineTo(-0.5, 0.5);
  outline.closePath();
  const opening = new THREE.Path();
  opening.moveTo(-0.38, -0.38);
  opening.lineTo(-0.38, 0.38);
  opening.lineTo(0.38, 0.38);
  opening.lineTo(0.38, -0.38);
  opening.closePath();
  outline.holes.push(opening);
  return new THREE.ShapeGeometry(outline);
}

function addMesh(parent, geometry, material, name, position, scale, rotation = null, stats) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = !name.includes('Glass') && !name.includes('LampGlow');
  mesh.receiveShadow = true;
  parent.add(mesh);
  stats.meshCount += 1;
  return mesh;
}

function addBeam(parent, box, material, name, start, end, thickness, stats) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const delta = b.clone().sub(a);
  const mesh = addMesh(parent, box, material, name, [0, 0, 0], [thickness, delta.length(), thickness], null, stats);
  mesh.position.copy(a.add(b).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return mesh;
}

function addWindow(parent, geometries, materials, x, y, z, width, height, face, shuttered, stats) {
  const window = new THREE.Group();
  window.name = `DetailedWindow_${face}`;
  const sideFace = face === 'left' || face === 'right';
  window.position.set(x, y, z);
  if (sideFace) window.rotation.y = Math.PI / 2;
  addMesh(window, geometries.box, materials.interior, 'WarmInteriorPane', [0, 0, 0.025], [width * 0.86, height * 0.86, 0.06], null, stats);
  addMesh(window, geometries.box, materials.glass, 'WindowGlass', [0, 0, -0.015], [width, height, 0.07], null, stats);
  addMesh(window, geometries.windowFrame, materials.trim, 'WindowFrame', [0, 0, -0.075], [width + 0.24, height + 0.24, 1], null, stats);
  addMesh(window, geometries.box, materials.trim, 'WindowMullionVertical', [0, 0, -0.075], [0.06, height, 0.12], null, stats);
  addMesh(window, geometries.box, materials.trim, 'WindowMullionHorizontal', [0, 0, -0.075], [width, 0.055, 0.12], null, stats);
  addMesh(window, geometries.box, materials.trim, 'WindowSill', [0, -height / 2 - 0.12, -0.10], [width + 0.32, 0.10, 0.25], null, stats);
  if (shuttered) {
    for (const sx of [-1, 1]) addMesh(window, geometries.box, materials.door, 'WindowShutter', [sx * (width / 2 + 0.24), 0, 0], [0.31, height * 1.04, 0.07], null, stats);
  }
  parent.add(window);
  stats.windowCount += 1;
  stats.framePieceCount += 4 + (shuttered ? 2 : 0);
}

function addDoor(parent, geometries, materials, wallDepth, stats, barn = false) {
  const doorWidth = barn ? 2.8 : 1.25;
  const doorHeight = barn ? 3.7 : 2.45;
  const z = -wallDepth / 2 - 0.075;
  addMesh(parent, geometries.box, materials.door, 'DetailedFrontDoor', [0, doorHeight / 2 + 0.42, z], [doorWidth, doorHeight, 0.14], null, stats);
  for (const x of [-doorWidth / 2, doorWidth / 2]) addMesh(parent, geometries.box, materials.trim, 'DoorFrameVertical', [x, doorHeight / 2 + 0.42, z - 0.08], [0.14, doorHeight + 0.28, 0.12], null, stats);
  addMesh(parent, geometries.box, materials.trim, 'DoorLintel', [0, doorHeight + 0.49, z - 0.08], [doorWidth + 0.28, 0.14, 0.12], null, stats);
  const panelCount = barn ? 4 : 3;
  for (let panel = 0; panel < panelCount; panel += 1) {
    addMesh(parent, geometries.box, materials.trim, 'DoorRaisedPanel', [0, 0.83 + panel * (doorHeight - 0.65) / panelCount, z - 0.095], [doorWidth * 0.70, 0.42, 0.035], null, stats);
  }
  if (!barn) addMesh(parent, geometries.sphere, materials.copper, 'DoorKnob', [doorWidth * 0.31, 1.53, z - 0.18], [0.07, 0.07, 0.07], null, stats);
  stats.doorCount += 1;
}

function addGableRoof(parent, geometries, materials, width, depth, wallHeight, rise, stats) {
  const angle = Math.atan2(rise, width / 2);
  const panelLength = Math.hypot(width / 2 + 0.5, rise);
  for (const side of [-1, 1]) {
    addMesh(
      parent,
      geometries.box,
      materials.roof,
      'DetailedRoofPlane',
      [side * width * 0.25, wallHeight + rise * 0.5 + 0.35, 0],
      [panelLength, 0.20, depth + 1.0],
      [0, 0, side < 0 ? angle : -angle],
      stats,
    );
  }
  addMesh(parent, geometries.cylinder, materials.copper, 'RoofRidgeCap', [0, wallHeight + rise + 0.38, 0], [0.10, (depth + 1.02) / 2, 0.10], [Math.PI / 2, 0, 0], stats);
  stats.roofPanelCount += 2;
  return angle;
}

function addPorch(parent, geometries, materials, width, depth, wallHeight, rng, stats) {
  const porchWidth = width * THREE.MathUtils.lerp(0.72, 0.92, rng());
  const porchDepth = THREE.MathUtils.lerp(2.0, 2.65, rng());
  const porchZ = -depth / 2 - porchDepth / 2;
  addMesh(parent, geometries.box, materials.wood, 'PorchDeck', [0, 0.57, porchZ], [porchWidth, 0.24, porchDepth], null, stats);
  addMesh(parent, geometries.box, materials.roof, 'PorchRoof', [0, Math.min(wallHeight - 0.55, 3.55), porchZ - 0.08], [porchWidth + 0.55, 0.20, porchDepth + 0.48], [0.07, 0, 0], stats);
  const postY = Math.min(wallHeight - 0.55, 3.55) / 2 + 0.35;
  for (const x of [-porchWidth * 0.43, porchWidth * 0.43]) {
    addMesh(parent, geometries.box, materials.trim, 'PorchColumn', [x, postY, -depth / 2 - porchDepth + 0.24], [0.20, postY * 1.75, 0.20], null, stats);
  }
  const railZ = -depth / 2 - porchDepth + 0.18;
  for (const side of [-1, 1]) {
    const inner = side * 0.78;
    const outer = side * porchWidth * 0.42;
    addBeam(parent, geometries.box, materials.trim, 'PorchHandrail', [inner, 1.48, railZ], [outer, 1.48, railZ], 0.10, stats);
    for (let baluster = 0; baluster < 4; baluster += 1) {
      const x = THREE.MathUtils.lerp(inner, outer, baluster / 3);
      addMesh(parent, geometries.box, materials.trim, 'PorchBaluster', [x, 1.07, railZ], [0.07, 0.72, 0.07], null, stats);
    }
  }
  for (let step = 0; step < 3; step += 1) {
    addMesh(parent, geometries.box, materials.wood, 'PorchStep', [0, 0.39 - step * 0.12, -depth / 2 - porchDepth - 0.15 - step * 0.21], [1.8 + step * 0.35, 0.16, 0.45], null, stats);
  }
  stats.porchCount += 1;
}

function addChimneyAndDrainage(parent, geometries, materials, width, depth, wallHeight, roofRise, stats) {
  const chimneyX = width * 0.25;
  addMesh(parent, geometries.box, materials.foundation, 'MasonryChimney', [chimneyX, wallHeight + roofRise * 0.62, depth * 0.16], [0.78, roofRise + 1.7, 0.92], null, stats);
  addMesh(parent, geometries.box, materials.copper, 'ChimneyCap', [chimneyX, wallHeight + roofRise + 1.28, depth * 0.16], [1.04, 0.18, 1.15], null, stats);
  for (const side of [-1, 1]) {
    addMesh(parent, geometries.cylinder, materials.copper, 'EaveGutter', [side * (width / 2 + 0.28), wallHeight + 0.22, 0], [0.085, (depth + 0.85) / 2, 0.085], [Math.PI / 2, 0, 0], stats);
    addMesh(parent, geometries.cylinder, materials.copper, 'Downspout', [side * (width / 2 + 0.28), wallHeight / 2, -depth / 2 - 0.38], [0.075, wallHeight / 2, 0.075], null, stats);
  }
  stats.chimneyCount += 1;
  stats.gutterCount += 4;
}

function addEntranceLamp(parent, geometries, materials, depth, wallHeight, stats) {
  const x = 1.02;
  const z = -depth / 2 - 0.19;
  addMesh(parent, geometries.cylinder, materials.darkMetal, 'LampWallPlate', [x, Math.min(3.05, wallHeight - 0.45), z], [0.12, 0.08, 0.12], [Math.PI / 2, 0, 0], stats);
  addMesh(parent, geometries.sphere, materials.lamp, 'LampGlow', [x, Math.min(2.82, wallHeight - 0.68), z - 0.08], [0.16, 0.22, 0.16], null, stats);
  stats.lampCount += 1;
}

function addDormer(parent, geometries, materials, width, depth, wallHeight, roofRise, stats) {
  const dormerWidth = width * 0.25;
  const y = wallHeight + roofRise * 0.48;
  const z = -depth * 0.20;
  addMesh(parent, geometries.box, materials.facade, 'DormerBody', [0, y, z], [dormerWidth, 1.45, 1.65], null, stats);
  addMesh(parent, geometries.box, materials.roof, 'DormerRoof', [0, y + 0.86, z - 0.05], [dormerWidth + 0.35, 0.18, 2.0], [0.04, 0, 0], stats);
  addWindow(parent, geometries, materials, 0, y, z - 0.86, dormerWidth * 0.45, 0.72, 'front', false, stats);
  stats.dormerCount += 1;
}

function batchStaticHouse(root, materials, resources, stats) {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const buckets = new Map();
  root.traverse((object) => {
    if (!object.isMesh) return;
    if (!buckets.has(object.material)) buckets.set(object.material, []);
    const relative = new THREE.Matrix4().multiplyMatrices(rootInverse, object.matrixWorld);
    buckets.get(object.material).push(object.geometry.clone().applyMatrix4(relative));
  });
  root.clear();
  let batchIndex = 0;
  for (const [material, geometries] of buckets) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) throw new Error('Roadside house material batch could not be merged');
    resources.geometries.add(merged);
    const materialName = Object.entries(materials).find(([, candidate]) => candidate === material)?.[0] ?? `material${batchIndex}`;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `HouseBatch_${materialName}`;
    mesh.castShadow = material !== materials.glass && material !== materials.lamp;
    mesh.receiveShadow = true;
    root.add(mesh);
    batchIndex += 1;
  }
  stats.modeledPartCount = stats.meshCount;
  stats.drawMeshCount = batchIndex;
  return batchIndex;
}

function parseArguments(parentOrOptions, position, seed, style, scale) {
  if (parentOrOptions?.isObject3D || parentOrOptions == null) {
    return { parent: parentOrOptions ?? null, position, seed, style, scale };
  }
  return parentOrOptions;
}

export function createRoadsideBuilding(parentOrOptions, position, seed, style, scale) {
  const options = parseArguments(parentOrOptions, position, seed, style, scale);
  const resolvedSeed = options.seed ?? 2808;
  const rng = seededRandom(resolvedSeed);
  const requestedStyle = HOUSE_STYLES.includes(options.style) ? options.style : HOUSE_STYLES[Math.floor(rng() * HOUSE_STYLES.length)];
  const spec = STYLE_SPECS[requestedStyle];
  const resources = { geometries: new Set(), materials: new Set(), textures: new Set() };
  const materials = createMaterials(requestedStyle, rng, resources);
  const geometries = {
    box: registerGeometry(resources, new THREE.BoxGeometry(1, 1, 1)),
    cylinder: registerGeometry(resources, new THREE.CylinderGeometry(1, 1, 1, 10)),
    sphere: registerGeometry(resources, new THREE.SphereGeometry(1, 12, 8)),
    windowFrame: registerGeometry(resources, createWindowFrameGeometry()),
  };
  const width = range(rng, spec.width);
  const depth = range(rng, spec.depth);
  const wallHeight = range(rng, spec.wallHeight);
  const roofRise = range(rng, spec.roofRise);
  const root = new THREE.Group();
  root.name = `DetailedRoadsideHouse_${requestedStyle}`;
  root.position.copy(normalizePosition(options.position));
  const resolvedScale = Math.max(0.35, Number(options.scale ?? 1));
  root.scale.setScalar(resolvedScale);

  const stats = {
    style: requestedStyle,
    seed: resolvedSeed,
    dimensions: { width, depth, wallHeight, roofRise, scale: resolvedScale },
    meshCount: 0,
    windowCount: 0,
    framePieceCount: 0,
    doorCount: 0,
    roofPanelCount: 0,
    porchCount: 0,
    chimneyCount: 0,
    gutterCount: 0,
    lampCount: 0,
    dormerCount: 0,
    materialLayerCount: 3,
    generatedTextureCount: 4,
  };

  addMesh(root, geometries.box, materials.foundation, 'FieldstoneFoundation', [0, 0.32, 0], [width + 0.35, 0.64, depth + 0.35], null, stats);
  addMesh(root, geometries.box, materials.facade, 'TexturedHouseShell', [0, wallHeight / 2 + 0.62, 0], [width, wallHeight, depth], null, stats);
  addGableRoof(root, geometries, materials, width, depth, wallHeight + 0.62, roofRise, stats);
  addDoor(root, geometries, materials, depth, stats, requestedStyle === 'barn');

  const frontWindowY = requestedStyle === 'barn' ? 4.95 : 2.35;
  const frontXs = requestedStyle === 'barn' ? [-width * 0.29, width * 0.29] : [-width * 0.29, width * 0.29];
  for (const x of frontXs) addWindow(root, geometries, materials, x, frontWindowY, -depth / 2 - 0.09, 1.12, 1.35, 'front', requestedStyle !== 'barn', stats);
  if (spec.stories > 1 && requestedStyle !== 'barn') {
    for (const x of [-width * 0.27, width * 0.27]) addWindow(root, geometries, materials, x, 4.65, -depth / 2 - 0.09, 0.98, 1.18, 'front-upper', false, stats);
  }
  for (const side of [-1, 1]) {
    const face = side < 0 ? 'left' : 'right';
    addWindow(root, geometries, materials, side * (width / 2 + 0.08), 2.5, -depth * 0.14, 1.0, 1.22, face, false, stats);
  }

  if (spec.porch) addPorch(root, geometries, materials, width, depth, wallHeight, rng, stats);
  if (requestedStyle === 'cottage' || (requestedStyle === 'farmhouse' && rng() > 0.46)) addDormer(root, geometries, materials, width, depth, wallHeight + 0.62, roofRise, stats);
  if (requestedStyle === 'barn') {
    addMesh(root, geometries.box, materials.roof, 'BarnLeanToRoof', [-width * 0.42, wallHeight * 0.54, depth * 0.12], [width * 0.37, 0.18, depth * 0.68], [0, 0, 0.22], stats);
    addMesh(root, geometries.box, materials.trim, 'BarnLoftCrossBraceA', [0, wallHeight * 0.75, -depth / 2 - 0.18], [0.16, 3.15, 0.10], [0, 0, 0.72], stats);
    addMesh(root, geometries.box, materials.trim, 'BarnLoftCrossBraceB', [0, wallHeight * 0.75, -depth / 2 - 0.19], [0.16, 3.15, 0.10], [0, 0, -0.72], stats);
  }
  addChimneyAndDrainage(root, geometries, materials, width, depth, wallHeight + 0.62, roofRise, stats);
  addEntranceLamp(root, geometries, materials, depth, wallHeight, stats);
  batchStaticHouse(root, materials, resources, stats);

  const parent = options.parent ?? null;
  if (parent?.add) parent.add(root);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    resources.geometries.forEach((geometry) => geometry.dispose());
    resources.materials.forEach((material) => material.dispose());
    resources.textures.forEach((texture) => texture.dispose());
    root.clear();
  };
  root.userData.roadsideBuilding = { stats, dispose };
  return { group: root, stats, dispose, isDisposed: () => disposed };
}
