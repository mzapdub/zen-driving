import * as THREE from 'three';
import { getEnvironmentProfile } from './environment-profiles.js';

export const CHUNK_LENGTH = 220;
export const ACTIVE_CHUNK_COUNT = 7;
const GENERATE_AHEAD = 4;
const RETAIN_BEHIND = 2;
export const ROAD_HALF_WIDTH = 7.8;
export const ROAD_LANE_CENTERS = Object.freeze([-4.6, 0, 4.6]);
export const LANDSCAPE_MATERIAL_KEYS = Object.freeze([
  'road',
  'shoulder',
  'grass',
  'lineYellow',
  'lineWhite',
  'rocks',
  'mountains',
  'water',
  'snow',
]);
const TERRAIN_HALF_WIDTH = 185;
const BIOMES = [
  { name: 'hemlock-valley', low: 0x64794b, high: 0x294838, pine: 0x153b2c, leaf: 0x466c37, rock: 0x696b64 },
  { name: 'maple-ridge', low: 0x77804a, high: 0x40543c, pine: 0x234c36, leaf: 0x788044, rock: 0x746e61 },
  { name: 'highland-meadow', low: 0x82905b, high: 0x4a624a, pine: 0x28513d, leaf: 0x627d48, rock: 0x797d73 },
  { name: 'rocky-pass', low: 0x6a754d, high: 0x384a40, pine: 0x193c32, leaf: 0x4e693e, rock: 0x5f645f },
];

function environmentBiomes(profileInput) {
  const profile = getEnvironmentProfile(profileInput?.id ?? profileInput);
  if (profile.id === 'catskills_scenic') return BIOMES;
  const canopy = profile.materials.foliage.macro.canopy;
  const terrain = profile.materials.terrain.macro;
  const rock = profile.materials.rock.macro;
  if (profile.id === 'hokkaido_snow') {
    return [
      { name: 'hokkaido-powder-spruce', low: terrain.low, high: terrain.high, pine: canopy[3], leaf: canopy[0], rock: rock.base },
      { name: 'hokkaido-birch-cut', low: '#cfdee3', high: '#edf4f4', pine: canopy[2], leaf: '#e6eeeb', rock: rock.strata },
      { name: 'hokkaido-frozen-valley', low: '#b9d0d7', high: '#e8f0f1', pine: '#1c4148', leaf: canopy[1], rock: '#65747b' },
      { name: 'hokkaido-volcanic-pass', low: '#aebfc3', high: '#dfe9e8', pine: '#173942', leaf: '#d9e6e3', rock: '#48565e' },
    ];
  }
  if (profile.id === 'arizona_desert') {
    return [
      { name: 'arizona-saguaro-flat', low: terrain.low, high: '#a74d2e', pine: canopy[2], leaf: canopy[0], rock: rock.strata },
      { name: 'arizona-red-mesa', low: '#c7773d', high: '#813326', pine: '#3f6040', leaf: canopy[1], rock: rock.base },
      { name: 'arizona-sandy-wash', low: '#d09255', high: '#a85231', pine: canopy[3], leaf: '#8f9148', rock: '#bd6235' },
      { name: 'arizona-painted-canyon', low: '#b65331', high: '#672b2a', pine: '#35553d', leaf: '#747c3e', rock: '#d47d47' },
    ];
  }
  return [
    { name: 'adirondack-crimson-maple', low: terrain.low, high: terrain.high, pine: canopy[3], leaf: canopy[0], rock: rock.base },
    { name: 'adirondack-amber-lake', low: '#754229', high: '#2f4638', pine: canopy[3], leaf: canopy[2], rock: rock.strata },
    { name: 'adirondack-orange-ridge', low: '#82472b', high: '#33433b', pine: '#173c35', leaf: canopy[1], rock: rock.base },
    { name: 'adirondack-granite-pass', low: '#5b4937', high: '#273d38', pine: canopy[3], leaf: '#b84a25', rock: rock.strata },
  ];
}

function hashInt(value, salt = 0) {
  let result = (value | 0) ^ (salt | 0) ^ 0x9e3779b9;
  result = Math.imul(result ^ result >>> 16, 0x21f0aaad);
  result = Math.imul(result ^ result >>> 15, 0x735a2d97);
  return (result ^ result >>> 15) >>> 0;
}

function hash01(value, salt = 0) {
  return hashInt(value, salt) / 4294967295;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function fract(value) {
  return value - Math.floor(value);
}

function valueNoise(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const sample = (sx, sz) => fract(Math.sin(sx * 127.1 + sz * 311.7 + seed * 53.3) * 43758.5453123);
  const a = sample(ix, iz);
  const b = sample(ix + 1, iz);
  const c = sample(ix, iz + 1);
  const d = sample(ix + 1, iz + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, ux), THREE.MathUtils.lerp(c, d, ux), uz);
}

function fbm(x, z, seed = 0) {
  let value = 0;
  let amplitude = 0.54;
  let frequency = 1;
  for (let octave = 0; octave < 4; octave += 1) {
    value += valueNoise(x * frequency, z * frequency, seed + octave * 17) * amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / 1.015;
}

function routeNodeX(index) {
  const random = (hash01(index, 0x2841) - 0.5) * 31;
  return random + Math.sin(index * 1.713) * 7 + Math.sin(index * 0.417) * 5;
}

function routeNodeY(index) {
  return (hash01(index, 0x791d) - 0.5) * 5.2 + Math.sin(index * 0.73) * 1.6;
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function sampleRouteNodes(z, sampler) {
  const scaled = z / CHUNK_LENGTH;
  const index = Math.floor(scaled);
  const t = scaled - index;
  return catmullRom(
    sampler(index - 1),
    sampler(index),
    sampler(index + 1),
    sampler(index + 2),
    t,
  );
}

export function roadXAt(z) {
  return sampleRouteNodes(z, routeNodeX);
}

export function roadYAt(z) {
  return sampleRouteNodes(z, routeNodeY);
}

export function roadHeadingAt(z) {
  const step = 0.75;
  return Math.atan2(roadXAt(z + step) - roadXAt(z - step), step * 2);
}

export function terrainHeightAt(x, z, profileInput = null) {
  const profile = getEnvironmentProfile(profileInput?.id ?? profileInput);
  const roadX = roadXAt(z);
  const lateral = Math.abs(x - roadX);
  const corridor = THREE.MathUtils.smoothstep(lateral, 8, 26);
  const relief = profile.props.terrainReliefScale ?? 1;
  const roughness = sampleRouteNodes(z, (index) => 0.86 + hash01(index, 0xc46d ^ profile.seedSalt) * 0.3);
  const ridgeHeight = sampleRouteNodes(z, (index) => (34 + hash01(index, 0x91e7 ^ profile.seedSalt) * 25) * relief);
  const broad = (fbm(x * 0.018, z * 0.018, 37 ^ profile.seedSalt) - 0.49) * 11 * roughness * relief;
  const midFrequency = profile.id === 'arizona_desert' ? 0.034 : 0.055;
  const mid = (fbm(x * midFrequency + 31, z * midFrequency - 19, 91 ^ profile.seedSalt) - 0.5) * 3 * roughness * relief;
  const ridge = Math.pow(Math.max(0, (lateral - 58) / 120), 1.55) * ridgeHeight;
  return THREE.MathUtils.lerp(roadYAt(z) - 0.22, roadYAt(z) - 0.9 + broad + mid + ridge, corridor);
}

export function describeChunk(index, profileInput = null) {
  const profile = getEnvironmentProfile(profileInput?.id ?? profileInput);
  const biomes = environmentBiomes(profile);
  const profileSalt = profile.seedSalt | 0;
  const biomeIndex = hashInt(index, 0x51b3 ^ profileSalt) % biomes.length;
  const bend = routeNodeX(index + 1) - routeNodeX(index);
  const previousBend = routeNodeX(index) - routeNodeX(index - 1);
  return Object.freeze({
    index,
    seed: hashInt(index, 0x7f4a ^ profileSalt),
    biomeIndex,
    biome: biomes[biomeIndex].name,
    environmentId: profile.id,
    curvature: Number(((bend - previousBend) / CHUNK_LENGTH).toFixed(5)),
    elevationDelta: Number((routeNodeY(index + 1) - routeNodeY(index)).toFixed(3)),
    settlementDensity: Number(((0.12 + hash01(index, 0xb8d1 ^ profileSalt) * 0.88) * profile.props.settlementScale).toFixed(3)),
    mountainHeight: Number((38 + hash01(index, 0x4ac9) * 47).toFixed(2)),
    treeDensity: Number((0.55 + hash01(index, 0x1387) * 0.75).toFixed(3)),
    propSeed: hashInt(index, 0xe5a1 ^ profileSalt),
  });
}

export function settlementSitesForChunk(index, profileInput = null) {
  const descriptor = describeChunk(index, profileInput);
  const count = descriptor.settlementDensity > 0.76
    ? 2
    : descriptor.settlementDensity > 0.34
      ? 1
      : 0;
  const rng = mulberry32(descriptor.propSeed ^ 0x484f4d45);
  const zMin = index * CHUNK_LENGTH;
  const sites = [];
  for (let siteIndex = 0; siteIndex < count; siteIndex += 1) {
    const lane = (siteIndex + 1) / (count + 1);
    sites.push(Object.freeze({
      routeZ: THREE.MathUtils.lerp(zMin + 34, zMin + CHUNK_LENGTH - 34, THREE.MathUtils.clamp(lane + (rng() - 0.5) * 0.18, 0.12, 0.88)),
      side: rng() < 0.5 ? -1 : 1,
      offset: 25 + rng() * 9,
      styleIndex: hashInt(index * 3 + siteIndex, 0x5354594c) % 4,
      scale: 0.82 + rng() * 0.24,
      seed: hashInt(index * 7 + siteIndex, descriptor.propSeed),
    }));
  }
  return Object.freeze(sites);
}

function layeredTexture(baseHex, accentHex, seed, lineMode = false) {
  const size = 96;
  const data = new Uint8Array(size * size * 4);
  const base = new THREE.Color(baseHex);
  const accent = new THREE.Color(accentHex);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const macro = valueNoise(x / 31, y / 31, seed);
      const mid = valueNoise(x / 7, y / 7, seed + 19);
      const fine = valueNoise(x * 0.77, y * 0.77, seed + 43);
      let blend = macro * 0.4 + mid * 0.24 + fine * 0.12;
      if (lineMode) blend += (Math.sin((x + mid * 7) * 0.46) * 0.5 + 0.5) * 0.2;
      const color = base.clone().lerp(accent, THREE.MathUtils.clamp(blend, 0, 0.94));
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(color.r * 255);
      data[offset + 1] = Math.round(color.g * 255);
      data[offset + 2] = Math.round(color.b * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function makeSurfaceMaterial(base, accent, seed, repeat, options = {}) {
  const map = layeredTexture(base, accent, seed, options.lineMode);
  map.repeat.set(...repeat);
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    bumpMap: map,
    bumpScale: options.bumpScale ?? 0.08,
    roughnessMap: map,
    roughness: options.roughness ?? 0.94,
    // Natural/world surfaces are dielectric. Keeping this unconditional stops
    // profile-specific options from reintroducing the edge glare regression.
    metalness: 0,
  });
}

function markLandscapeMaterials(materials) {
  for (const key of LANDSCAPE_MATERIAL_KEYS) {
    const values = Array.isArray(materials[key]) ? materials[key] : [materials[key]];
    for (let index = 0; index < values.length; index += 1) {
      const material = values[index];
      material.name = `Landscape_${key}${values.length > 1 ? `_${index}` : ''}`;
      material.metalness = 0;
      material.userData.worldSurface = true;
      material.userData.worldSurfaceKey = key;
    }
  }
  return materials;
}

function createMaterials(profileInput = null) {
  const profile = getEnvironmentProfile(profileInput?.id ?? profileInput);
  const biomes = environmentBiomes(profile);
  const terrain = profile.materials.terrain;
  const rockProfile = profile.materials.rock;
  const road = makeSurfaceMaterial(0x35393b, 0x111416, 17, [2.2, 28], { bumpScale: 0.055, roughness: 0.88 });
  const shoulder = makeSurfaceMaterial(profile.materials.rock.macro.base, terrain.midscale.soil, 31 ^ profile.seedSalt, [2, 25], { bumpScale: 0.14, roughness: 0.98 });
  const grass = makeSurfaceMaterial(terrain.macro.low, terrain.midscale.grass, 47 ^ profile.seedSalt, [18, 24], { bumpScale: 0.16, roughness: terrain.fine.roughness });
  grass.userData.materialLayers = [
    'macro_terrain_gradient',
    'midscale_soil_or_surface_breakup',
    'fine_speckle_bump_and_roughness',
  ];
  const pines = biomes.map((biome, index) => makeSurfaceMaterial(
    biome.pine,
    new THREE.Color(biome.pine).offsetHSL(0.012, 0.08, 0.14).getHex(),
    113 + index * 17,
    [2.4, 3.7],
    { bumpScale: 0.12, roughness: 0.91 },
  ));
  const leaves = biomes.map((biome, index) => makeSurfaceMaterial(
    biome.leaf,
    new THREE.Color(biome.leaf).offsetHSL(-0.018, 0.07, 0.16).getHex(),
    181 + index * 19,
    [2.1, 2.9],
    { bumpScale: 0.1, roughness: 0.88 },
  ));
  const rocks = biomes.map((biome, index) => makeSurfaceMaterial(
    biome.rock,
    rockProfile.midscale.lichen,
    211 + index * 23 ^ profile.seedSalt,
    [2.7, 3.4],
    { bumpScale: 0.18, roughness: rockProfile.fine.roughness },
  ));
  const mountains = biomes.map((biome, index) => makeSurfaceMaterial(
    new THREE.Color(biome.high).lerp(new THREE.Color(profile.props.hazeColor), 0.34).getHex(),
    rockProfile.macro.strata,
    307 + index * 29 ^ profile.seedSalt,
    [4.2, 6.8],
    { lineMode: true, bumpScale: 0.22, roughness: 1 },
  ));
  for (const material of [...pines, ...leaves]) {
    material.userData.materialLayers = [
      'macro_species_and_season_palette',
      'midscale_crown_and_cluster_breakup',
      'fine_edge_and_roughness_variation',
    ];
  }
  for (const material of [...rocks, ...mountains]) {
    material.userData.materialLayers = [
      'macro_strata_and_base_palette',
      'midscale_cellular_or_lichen_breakup',
      'fine_grain_bump_and_roughness',
    ];
  }
  return markLandscapeMaterials({
    road,
    shoulder,
    grass,
    lineYellow: new THREE.MeshStandardMaterial({ color: 0xf5c94e, roughness: 0.72, metalness: 0, emissive: 0x291e05, emissiveIntensity: 0.12 }),
    lineWhite: new THREE.MeshStandardMaterial({ color: 0xeeeadd, roughness: 0.8, metalness: 0 }),
    bark: makeSurfaceMaterial(0x5b3a26, 0x241a14, 71, [2, 6], { lineMode: true, bumpScale: 0.2, roughness: 1 }),
    pines,
    leaves,
    rocks,
    mountains,
    water: new THREE.MeshStandardMaterial({
      color: profile.props.waterColor,
      roughness: profile.props.waterRoughness,
      metalness: 0,
      transparent: true,
      opacity: profile.props.waterMode === 'ephemeral_wash' ? 0.36 : 0.86,
    }),
    pole: new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.96 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x707875, roughness: 0.55, metalness: 0.72 }),
    sign: new THREE.MeshStandardMaterial({ color: 0x245f48, roughness: 0.72 }),
    snow: makeSurfaceMaterial(0xe8f1f3, 0xb8d2da, 233 ^ profile.seedSalt, [4, 11], { bumpScale: 0.09, roughness: 0.72 }),
    cactus: makeSurfaceMaterial(0x3f693f, 0x78904b, 251 ^ profile.seedSalt, [2.2, 5.5], { lineMode: true, bumpScale: 0.15, roughness: 0.94 }),
    scrub: makeSurfaceMaterial(0x77783b, 0xb0a15a, 263 ^ profile.seedSalt, [2.5, 3.2], { bumpScale: 0.11, roughness: 0.98 }),
    lantern: new THREE.MeshStandardMaterial({ color: 0xffd987, emissive: 0xffa62e, emissiveIntensity: 2.2, roughness: 0.34 }),
  });
}

function makeRibbon(offsetA, offsetB, yOffset, zMin, zMax, segments = 64) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let index = 0; index <= segments; index += 1) {
    const z = THREE.MathUtils.lerp(zMax, zMin, index / segments);
    const heading = roadHeadingAt(z);
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);
    for (const [u, offset] of [[0, offsetA], [1, offsetB]]) {
      positions.push(roadXAt(z) + rightX * offset, roadYAt(z) + yOffset, z + rightZ * offset);
      normals.push(0, 1, 0);
      uvs.push(u, -z / 8);
    }
    if (index < segments) {
      const a = index * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function createTerrainGeometry(zMin, zMax, profileInput = null) {
  const profile = getEnvironmentProfile(profileInput?.id ?? profileInput);
  const biomes = environmentBiomes(profile);
  const xSegments = 38;
  const zSegments = 40;
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const chunkIndex = Math.floor(zMin / CHUNK_LENGTH);
  for (let iz = 0; iz <= zSegments; iz += 1) {
    const z = THREE.MathUtils.lerp(zMin, zMax, iz / zSegments);
    const center = roadXAt(z);
    const scaled = z / CHUNK_LENGTH;
    const paletteIndex = Math.floor(scaled);
    const paletteT = THREE.MathUtils.smoothstep(scaled - paletteIndex, 0, 1);
    const biomeA = biomes[describeChunk(paletteIndex, profile).biomeIndex];
    const biomeB = biomes[describeChunk(paletteIndex + 1, profile).biomeIndex];
    const low = new THREE.Color(biomeA.low).lerp(new THREE.Color(biomeB.low), paletteT);
    const high = new THREE.Color(biomeA.high).lerp(new THREE.Color(biomeB.high), paletteT);
    for (let ix = 0; ix <= xSegments; ix += 1) {
      const x = center + THREE.MathUtils.lerp(-TERRAIN_HALF_WIDTH, TERRAIN_HALF_WIDTH, ix / xSegments);
      const y = terrainHeightAt(x, z, profile);
      positions.push(x, y, z);
      const shade = THREE.MathUtils.clamp((y + 4) / 72, 0, 1);
      const color = low.clone().lerp(high, shade * 0.66 + valueNoise(ix * 0.27, iz * 0.27, chunkIndex) * 0.16);
      colors.push(color.r, color.g, color.b);
      uvs.push(ix / xSegments, -z / CHUNK_LENGTH);
      if (ix < xSegments && iz < zSegments) {
        const a = iz * (xSegments + 1) + ix;
        const b = a + xSegments + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function setInstance(mesh, index, position, scale, rotationY, color = null) {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0));
  matrix.compose(position, quaternion, scale);
  mesh.setMatrixAt(index, matrix);
  if (color) mesh.setColorAt(index, color);
}

function setBranchInstance(mesh, index, start, end, radius, color = null) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  const position = start.clone().add(end).multiplyScalar(0.5);
  const matrix = new THREE.Matrix4().compose(
    position,
    quaternion,
    new THREE.Vector3(radius, length, radius),
  );
  mesh.setMatrixAt(index, matrix);
  if (color) mesh.setColorAt(index, color);
}

function makeSharedGeometry() {
  return {
    treeTrunkSegment: new THREE.CylinderGeometry(0.72, 1, 1, 7, 2),
    treePrimaryBranch: new THREE.CylinderGeometry(0.58, 1, 1, 6, 2),
    treeSecondaryBranch: new THREE.CylinderGeometry(0.44, 1, 1, 5, 2),
    treeFoliageCluster: new THREE.IcosahedronGeometry(1, 0),
    lake: new THREE.CircleGeometry(1, 36),
    rock: new THREE.DodecahedronGeometry(1, 0),
    mountain: new THREE.ConeGeometry(1, 1, 9, 4),
    environmentProp: new THREE.BoxGeometry(1, 1, 1),
    cactusColumn: new THREE.CylinderGeometry(0.72, 0.88, 1, 8, 2),
    cactusArm: new THREE.CylinderGeometry(0.55, 0.7, 1, 7, 2),
    agaveLeaf: new THREE.ConeGeometry(0.22, 1, 5, 1),
    lantern: new THREE.SphereGeometry(0.24, 8, 6),
    pole: new THREE.CylinderGeometry(0.14, 0.2, 10.5, 7),
    crossarm: new THREE.BoxGeometry(2.5, 0.16, 0.16),
    signPost: new THREE.BoxGeometry(0.13, 2.6, 0.13),
    signBoard: new THREE.BoxGeometry(2.8, 1.05, 0.16),
  };
}

function addMesh(group, geometry, material, name, receiveShadow = true) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = receiveShadow;
  group.add(mesh);
  return mesh;
}

function addRoad(group, materials, owned, zMin, zMax) {
  const definitions = [
    [-10.3, -ROAD_HALF_WIDTH, 0.015, materials.shoulder, 'StreamedLeftShoulder'],
    [ROAD_HALF_WIDTH, 10.3, 0.015, materials.shoulder, 'StreamedRightShoulder'],
    [-ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0.055, materials.road, 'StreamedAsphalt'],
    [-2.36, -2.24, 0.075, materials.lineYellow, 'StreamedLeftLaneLine'],
    [2.24, 2.36, 0.075, materials.lineYellow, 'StreamedRightLaneLine'],
    [-7.36, -7.22, 0.075, materials.lineWhite, 'StreamedLeftEdgeLine'],
    [7.22, 7.36, 0.075, materials.lineWhite, 'StreamedRightEdgeLine'],
  ];
  for (const [a, b, y, material, name] of definitions) {
    const geometry = makeRibbon(a, b, y, zMin, zMax);
    owned.push(geometry);
    const mesh = addMesh(group, geometry, material, name);
    mesh.castShadow = false;
  }
}

function addChunkDressing(group, materials, geometry, descriptor, zMin, zMax, profileInput = null) {
  const profile = getEnvironmentProfile(profileInput?.id ?? profileInput);
  const rng = mulberry32(descriptor.seed);
  const settlementSites = settlementSitesForChunk(descriptor.index, profile);
  const biomeIndex = descriptor.biomeIndex;
  const forestWeight = profile.props.hardwoodWeight + profile.props.coniferWeight;
  const treeCount = Math.max(16, Math.round((48 + descriptor.treeDensity * 32) * Math.min(1.15, forestWeight)));
  const coniferRatio = profile.props.coniferWeight / Math.max(0.001, forestWeight);
  const pineCount = Math.round(treeCount * THREE.MathUtils.clamp(coniferRatio + (rng() - 0.5) * 0.12, 0.08, 0.94));
  const leafCount = treeCount - pineCount;
  const trunkSegmentsPerTree = 3;
  const primaryBranchesPerTree = 6;
  const secondaryBranchesPerTree = 6;
  const foliageClustersPerTree = 12;
  const rockCount = 10 + Math.floor(rng() * 14);
  const trunks = new THREE.InstancedMesh(geometry.treeTrunkSegment, materials.bark, treeCount * trunkSegmentsPerTree);
  const primaryBranches = new THREE.InstancedMesh(geometry.treePrimaryBranch, materials.bark, treeCount * primaryBranchesPerTree);
  const secondaryBranches = new THREE.InstancedMesh(geometry.treeSecondaryBranch, materials.bark, treeCount * secondaryBranchesPerTree);
  const pines = new THREE.InstancedMesh(geometry.treeFoliageCluster, materials.pines[biomeIndex], pineCount * foliageClustersPerTree);
  const leaves = new THREE.InstancedMesh(geometry.treeFoliageCluster, materials.leaves[biomeIndex], leafCount * foliageClustersPerTree);
  const rocks = new THREE.InstancedMesh(geometry.rock, materials.rocks[biomeIndex], rockCount);
  trunks.name = 'StreamedTreeTrunkSegments';
  primaryBranches.name = 'StreamedTreePrimaryBranches';
  secondaryBranches.name = 'StreamedTreeSecondaryBranches';
  pines.name = 'StreamedConiferFoliageClusters';
  leaves.name = 'StreamedDeciduousFoliageClusters';
  const treePlacements = [];
  let trunkIndex = 0;
  let primaryIndex = 0;
  let secondaryIndex = 0;
  let pineIndex = 0;
  let leafIndex = 0;
  for (let index = 0; index < treeCount; index += 1) {
    const routeZ = THREE.MathUtils.lerp(zMin + 4, zMax - 4, rng());
    const side = rng() < 0.5 ? -1 : 1;
    let distance = THREE.MathUtils.lerp(14, 112, Math.pow(rng(), 0.72));
    for (const site of settlementSites) {
      if (side === site.side && Math.abs(routeZ - site.routeZ) < 25 && Math.abs(distance - site.offset) < 23) {
        distance = Math.min(116, site.offset + 28 + rng() * 14);
      }
    }
    const heading = roadHeadingAt(routeZ);
    const x = roadXAt(routeZ) + Math.cos(heading) * side * distance;
    const z = routeZ - Math.sin(heading) * side * distance;
    const ground = terrainHeightAt(x, z, profile);
    const height = THREE.MathUtils.lerp(6.5, 16, rng());
    const yaw = rng() * Math.PI * 2;
    const isConifer = index < pineCount;
    const barkTint = new THREE.Color(0x98705a).offsetHSL((rng() - 0.5) * 0.02, -0.16, (rng() - 0.5) * 0.12);
    const leafTint = new THREE.Color(isConifer ? 0xb8d2c0 : 0xc5d49a)
      .offsetHSL((rng() - 0.5) * 0.04, -0.12, (rng() - 0.5) * 0.16);
    const origin = new THREE.Vector3(x, ground, z);
    const trunkRadius = height * (isConifer ? 0.034 : 0.043);
    const segmentDefinitions = isConifer
      ? [[0.17, 0.34, 1], [0.43, 0.28, 0.78], [0.68, 0.26, 0.58]]
      : [[0.16, 0.32, 1], [0.42, 0.29, 0.81], [0.66, 0.24, 0.61]];
    for (const [centerFraction, lengthFraction, radiusScale] of segmentDefinitions) {
      setInstance(
        trunks,
        trunkIndex,
        new THREE.Vector3(x, ground + height * centerFraction, z),
        new THREE.Vector3(trunkRadius * radiusScale, height * lengthFraction, trunkRadius * radiusScale),
        yaw,
        barkTint,
      );
      trunkIndex += 1;
    }

    for (let branch = 0; branch < primaryBranchesPerTree; branch += 1) {
      const t = branch / (primaryBranchesPerTree - 1);
      const angle = yaw + branch * 2.39996 + (rng() - 0.5) * 0.34;
      const startY = height * (isConifer ? 0.29 + t * 0.43 : 0.32 + t * 0.34);
      const length = height
        * (isConifer ? THREE.MathUtils.lerp(0.27, 0.13, t) : THREE.MathUtils.lerp(0.25, 0.18, t))
        * THREE.MathUtils.lerp(0.88, 1.12, rng());
      const start = origin.clone().add(new THREE.Vector3(0, startY, 0));
      const end = start.clone().add(new THREE.Vector3(
        Math.cos(angle) * length,
        length * (isConifer ? THREE.MathUtils.lerp(0.06, 0.17, rng()) : THREE.MathUtils.lerp(0.24, 0.46, rng())),
        Math.sin(angle) * length,
      ));
      setBranchInstance(
        primaryBranches,
        primaryIndex,
        start,
        end,
        trunkRadius * THREE.MathUtils.lerp(0.26, 0.16, t),
        barkTint,
      );
      primaryIndex += 1;

      const splitStart = start.clone().lerp(end, THREE.MathUtils.lerp(0.48, 0.62, rng()));
      const splitAngle = angle + (branch % 2 === 0 ? -1 : 1) * THREE.MathUtils.lerp(0.42, 0.72, rng());
      const splitLength = length * THREE.MathUtils.lerp(0.48, 0.64, rng());
      const splitEnd = splitStart.clone().add(new THREE.Vector3(
        Math.cos(splitAngle) * splitLength,
        splitLength * (isConifer ? 0.1 : THREE.MathUtils.lerp(0.18, 0.38, rng())),
        Math.sin(splitAngle) * splitLength,
      ));
      setBranchInstance(
        secondaryBranches,
        secondaryIndex,
        splitStart,
        splitEnd,
        trunkRadius * THREE.MathUtils.lerp(0.13, 0.09, t),
        barkTint,
      );
      secondaryIndex += 1;

      const foliageMesh = isConifer ? pines : leaves;
      const branchClusterWidth = height
        * (isConifer ? THREE.MathUtils.lerp(0.15, 0.095, t) : THREE.MathUtils.lerp(0.16, 0.13, t));
      const firstFoliageIndex = isConifer ? pineIndex : leafIndex;
      setInstance(
        foliageMesh,
        firstFoliageIndex,
        end.clone().lerp(splitEnd, 0.12),
        new THREE.Vector3(
          branchClusterWidth,
          branchClusterWidth * (isConifer ? 0.54 : 0.82),
          branchClusterWidth * THREE.MathUtils.lerp(0.72, 1.02, rng()),
        ),
        angle,
        leafTint,
      );
      setInstance(
        foliageMesh,
        firstFoliageIndex + 1,
        splitEnd,
        new THREE.Vector3(
          branchClusterWidth * 0.78,
          branchClusterWidth * (isConifer ? 0.46 : 0.68),
          branchClusterWidth * THREE.MathUtils.lerp(0.62, 0.88, rng()),
        ),
        splitAngle,
        leafTint.clone().offsetHSL(0, 0, 0.035),
      );
      if (isConifer) pineIndex += 2;
      else leafIndex += 2;
    }
    treePlacements.push({ routeZ, side, distance, x, z, height, isConifer });
  }
  for (let index = 0; index < rockCount; index += 1) {
    const routeZ = THREE.MathUtils.lerp(zMin, zMax, rng());
    const side = rng() < 0.5 ? -1 : 1;
    const distance = THREE.MathUtils.lerp(11, 86, rng());
    const heading = roadHeadingAt(routeZ);
    const x = roadXAt(routeZ) + Math.cos(heading) * side * distance;
    const z = routeZ - Math.sin(heading) * side * distance;
    const size = THREE.MathUtils.lerp(0.45, 2.5, rng() ** 2);
    setInstance(rocks, index, new THREE.Vector3(x, terrainHeightAt(x, z, profile) + size * 0.3, z), new THREE.Vector3(size, size * (0.5 + rng() * 0.35), size * (0.7 + rng() * 0.45)), rng() * Math.PI);
  }
  group.userData.treeStructure = Object.freeze({
    treeCount,
    coniferCount: pineCount,
    deciduousCount: leafCount,
    trunkSegmentsPerTree,
    primaryBranchesPerTree,
    secondaryBranchesPerTree,
    foliageClustersPerTree,
    treeDrawCalls: 5,
    materialLayers: [...materials.leaves[biomeIndex].userData.materialLayers],
  });
  group.userData.treePlacements = treePlacements;
  for (const mesh of [trunks, primaryBranches, secondaryBranches, pines, leaves, rocks]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (profile.props.propSet === 'snowbank_lantern') {
    const bankCount = 12;
    const banks = new THREE.InstancedMesh(geometry.environmentProp, materials.snow, bankCount);
    banks.name = 'StreamedHokkaidoSnowBanks';
    for (let index = 0; index < bankCount; index += 1) {
      const routeZ = THREE.MathUtils.lerp(zMin + 5, zMax - 5, index / (bankCount - 1));
      const side = index % 2 === 0 ? -1 : 1;
      const heading = roadHeadingAt(routeZ);
      const distance = ROAD_HALF_WIDTH + 3.1 + rng() * 1.5;
      const x = roadXAt(routeZ) + Math.cos(heading) * side * distance;
      const z = routeZ - Math.sin(heading) * side * distance;
      setInstance(banks, index, new THREE.Vector3(x, terrainHeightAt(x, z, profile) + 0.42, z), new THREE.Vector3(5 + rng() * 4, 0.65 + rng() * 0.55, 1.8 + rng() * 1.3), heading + rng() * 0.12);
    }
    banks.instanceMatrix.needsUpdate = true;
    banks.receiveShadow = true;
    group.add(banks);

    const lanternCount = descriptor.settlementDensity > 0.26 ? 8 : 4;
    const lanternPoles = new THREE.InstancedMesh(geometry.pole, materials.pole, lanternCount);
    const lanterns = new THREE.InstancedMesh(geometry.lantern, materials.lantern, lanternCount);
    lanternPoles.name = 'StreamedHokkaidoLanternPoles';
    lanterns.name = 'StreamedHokkaidoLanterns';
    for (let index = 0; index < lanternCount; index += 1) {
      const routeZ = THREE.MathUtils.lerp(zMin + 22, zMax - 22, index / Math.max(1, lanternCount - 1));
      const side = index % 2 === 0 ? -1 : 1;
      const heading = roadHeadingAt(routeZ);
      const x = roadXAt(routeZ) + Math.cos(heading) * side * 11.8;
      const z = routeZ - Math.sin(heading) * side * 11.8;
      const ground = terrainHeightAt(x, z, profile);
      setInstance(lanternPoles, index, new THREE.Vector3(x, ground + 2.2, z), new THREE.Vector3(0.6, 0.42, 0.6), heading);
      setInstance(lanterns, index, new THREE.Vector3(x, ground + 4.05, z), new THREE.Vector3(1, 1.18, 1), heading);
    }
    lanternPoles.instanceMatrix.needsUpdate = true;
    lanterns.instanceMatrix.needsUpdate = true;
    group.add(lanternPoles, lanterns);
  }

  if (profile.props.propSet === 'cactus_agave') {
    const cactusCount = 22;
    const cactusColumns = new THREE.InstancedMesh(geometry.cactusColumn, materials.cactus, cactusCount);
    const cactusArms = new THREE.InstancedMesh(geometry.cactusArm, materials.cactus, cactusCount * 2);
    const agaveCount = 18;
    const agaveLeaves = new THREE.InstancedMesh(geometry.agaveLeaf, materials.scrub, agaveCount * 7);
    cactusColumns.name = 'StreamedArizonaSaguaros';
    cactusArms.name = 'StreamedArizonaCactusArms';
    agaveLeaves.name = 'StreamedArizonaAgave';
    for (let index = 0; index < cactusCount; index += 1) {
      const routeZ = THREE.MathUtils.lerp(zMin + 5, zMax - 5, rng());
      const side = rng() < 0.5 ? -1 : 1;
      const distance = THREE.MathUtils.lerp(17, 105, rng());
      const heading = roadHeadingAt(routeZ);
      const x = roadXAt(routeZ) + Math.cos(heading) * side * distance;
      const z = routeZ - Math.sin(heading) * side * distance;
      const ground = terrainHeightAt(x, z, profile);
      const height = THREE.MathUtils.lerp(2.8, 7.6, rng());
      setInstance(cactusColumns, index, new THREE.Vector3(x, ground + height * 0.5, z), new THREE.Vector3(height * 0.075, height, height * 0.075), rng() * Math.PI);
      for (let arm = 0; arm < 2; arm += 1) {
        const sideSign = arm === 0 ? -1 : 1;
        const start = new THREE.Vector3(x, ground + height * (0.38 + arm * 0.17), z);
        const end = start.clone().add(new THREE.Vector3(sideSign * height * 0.22, height * 0.18, (rng() - 0.5) * height * 0.08));
        setBranchInstance(cactusArms, index * 2 + arm, start, end, height * 0.055);
      }
    }
    for (let index = 0; index < agaveCount; index += 1) {
      const routeZ = THREE.MathUtils.lerp(zMin, zMax, rng());
      const side = rng() < 0.5 ? -1 : 1;
      const distance = THREE.MathUtils.lerp(15, 82, rng());
      const heading = roadHeadingAt(routeZ);
      const x = roadXAt(routeZ) + Math.cos(heading) * side * distance;
      const z = routeZ - Math.sin(heading) * side * distance;
      const ground = terrainHeightAt(x, z, profile);
      for (let leaf = 0; leaf < 7; leaf += 1) {
        const angle = leaf / 7 * Math.PI * 2;
        const scale = THREE.MathUtils.lerp(0.7, 1.35, rng());
        setInstance(agaveLeaves, index * 7 + leaf, new THREE.Vector3(x + Math.cos(angle) * 0.22, ground + 0.42, z + Math.sin(angle) * 0.22), new THREE.Vector3(scale, scale, scale), angle);
      }
    }
    for (const mesh of [cactusColumns, cactusArms, agaveLeaves]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    if ((descriptor.index % 3 + 3) % 3 === 0) {
      const wash = new THREE.Mesh(geometry.lake, materials.shoulder);
      wash.name = 'StreamedArizonaSandyWash';
      const washZ = (zMin + zMax) * 0.5;
      const side = descriptor.index % 2 === 0 ? -1 : 1;
      const heading = roadHeadingAt(washZ);
      const x = roadXAt(washZ) + Math.cos(heading) * side * 62;
      const z = washZ - Math.sin(heading) * side * 62;
      wash.position.set(x, terrainHeightAt(x, z, profile) + 0.05, z);
      wash.rotation.x = -Math.PI / 2;
      wash.scale.set(24, 8, 1);
      group.add(wash);
    }
  }

  const forcedFrozenWater = profile.props.waterMode === 'frozen_water'
    && (descriptor.index % 3 + 3) % 3 === 0;
  if (profile.props.lakeChance > 0 && (forcedFrozenWater || hash01(descriptor.index, profile.seedSalt ^ 0x4c414b45) < profile.props.lakeChance)) {
    const side = hash01(descriptor.index, profile.seedSalt ^ 0x53494445) < 0.5 ? -1 : 1;
    const lakeZ = THREE.MathUtils.lerp(zMin + 40, zMax - 40, hash01(descriptor.index, profile.seedSalt ^ 0x5a45444c));
    const heading = roadHeadingAt(lakeZ);
    const distance = 68 + hash01(descriptor.index, profile.seedSalt ^ 0x44495354) * 34;
    const x = roadXAt(lakeZ) + Math.cos(heading) * side * distance;
    const z = lakeZ - Math.sin(heading) * side * distance;
    const lake = new THREE.Mesh(geometry.lake, materials.water);
    lake.name = profile.props.waterMode === 'frozen_water'
      ? 'StreamedHokkaidoFrozenWater'
      : profile.id === 'adirondack_autumn'
        ? 'StreamedAdirondackLake'
        : 'StreamedSeasonalWater';
    lake.position.set(x, terrainHeightAt(x, z, profile) + 0.08, z);
    lake.rotation.x = -Math.PI / 2;
    lake.scale.set(18 + rng() * 18, 11 + rng() * 9, 1);
    lake.receiveShadow = true;
    group.add(lake);
  }

  const mountainCount = 5 + Math.floor(rng() * 4);
  for (let index = 0; index < mountainCount; index += 1) {
    const routeZ = THREE.MathUtils.lerp(zMin - 35, zMax + 35, rng());
    const side = index % 2 === 0 ? -1 : 1;
    const distance = 128 + rng() * 54;
    const heading = roadHeadingAt(routeZ);
    const x = roadXAt(routeZ) + Math.cos(heading) * side * distance;
    const z = routeZ - Math.sin(heading) * side * distance;
    const height = descriptor.mountainHeight * THREE.MathUtils.lerp(0.72, 1.22, rng());
    const mountain = new THREE.Mesh(geometry.mountain, materials.mountains[biomeIndex]);
    mountain.name = `Streamed${descriptor.biome}Mountain`;
    mountain.position.set(x, terrainHeightAt(x, z, profile) + height * 0.44 - 7, z);
    const widthScale = profile.props.mountainWidthScale ?? 1;
    mountain.scale.set(height * THREE.MathUtils.lerp(0.72, 1.18, rng()) * widthScale, height * (profile.props.ridgeScale ?? 1), height * THREE.MathUtils.lerp(0.62, 0.95, rng()) * widthScale);
    mountain.rotation.y = rng() * Math.PI;
    mountain.receiveShadow = true;
    group.add(mountain);
  }

  const poleCount = 6;
  const poles = new THREE.InstancedMesh(geometry.pole, materials.pole, poleCount);
  const arms = new THREE.InstancedMesh(geometry.crossarm, materials.pole, poleCount);
  for (let index = 0; index < poleCount; index += 1) {
    const routeZ = THREE.MathUtils.lerp(zMin + 12, zMax - 12, index / (poleCount - 1));
    const heading = roadHeadingAt(routeZ);
    const x = roadXAt(routeZ) + Math.cos(heading) * 14;
    const z = routeZ - Math.sin(heading) * 14;
    const ground = terrainHeightAt(x, z, profile);
    setInstance(poles, index, new THREE.Vector3(x, ground + 5.15, z), new THREE.Vector3(1, 1, 1), heading);
    setInstance(arms, index, new THREE.Vector3(x, ground + 9.65, z), new THREE.Vector3(1, 1, 1), heading);
  }
  poles.instanceMatrix.needsUpdate = true;
  arms.instanceMatrix.needsUpdate = true;
  poles.castShadow = true;
  arms.castShadow = true;
  group.add(poles, arms);

  if (descriptor.settlementDensity > 0.52) {
    const routeZ = THREE.MathUtils.lerp(zMin + 35, zMax - 35, rng());
    const side = rng() < 0.5 ? -1 : 1;
    const heading = roadHeadingAt(routeZ);
    const x = roadXAt(routeZ) + Math.cos(heading) * side * 10;
    const z = routeZ - Math.sin(heading) * side * 10;
    const sign = new THREE.Group();
    addMesh(sign, geometry.signPost, materials.metal, 'StreamedSignPost').position.y = 1.3;
    addMesh(sign, geometry.signBoard, materials.sign, 'StreamedTownSign').position.y = 2.7;
    sign.position.set(x, terrainHeightAt(x, z, profile), z);
    sign.rotation.y = heading + (side > 0 ? Math.PI : 0);
    group.add(sign);
  }
}

function createChunk(index, materials, sharedGeometry, profile) {
  const zMin = index * CHUNK_LENGTH;
  const zMax = (index + 1) * CHUNK_LENGTH;
  const descriptor = describeChunk(index, profile);
  const group = new THREE.Group();
  group.name = `WorldChunk_${index}_${descriptor.biome}`;
  group.userData.chunkIndex = index;
  group.userData.descriptor = descriptor;
  group.userData.environmentId = profile.id;
  group.userData.environmentSignature = Object.freeze({
    surfaceMode: profile.props.surfaceMode,
    vegetationMode: profile.props.vegetationMode,
    waterMode: profile.props.waterMode,
    propSet: profile.props.propSet,
  });
  const ownedGeometries = [];

  const terrainGeometry = createTerrainGeometry(zMin, zMax, profile);
  ownedGeometries.push(terrainGeometry);
  addMesh(group, terrainGeometry, materials.grass, 'StreamedTerrain');
  addRoad(group, materials, ownedGeometries, zMin, zMax);
  addChunkDressing(group, materials, sharedGeometry, descriptor, zMin, zMax, profile);

  return { index, zMin, zMax, descriptor, group, ownedGeometries, decoratorDisposers: [] };
}

export class ProceduralWorldStream {
  constructor(scene, initialPlayerZOrOptions = 285.3609) {
    const options = typeof initialPlayerZOrOptions === 'object' && initialPlayerZOrOptions !== null
      ? initialPlayerZOrOptions
      : { initialPlayerZ: initialPlayerZOrOptions };
    const initialPlayerZ = Number.isFinite(options.initialPlayerZ) ? options.initialPlayerZ : 285.3609;
    this.scene = scene;
    this.environmentProfile = getEnvironmentProfile(options.profile?.id ?? options.environmentId ?? options.profile);
    this.group = new THREE.Group();
    this.group.name = 'BoundedProceduralWorldStream';
    this.scene?.add(this.group);
    this.materials = createMaterials(this.environmentProfile);
    this.sharedGeometry = makeSharedGeometry();
    this.chunks = new Map();
    this.decorators = new Map();
    this.createdChunkCount = 0;
    this.retiredChunkCount = 0;
    this.lastPlayerZ = initialPlayerZ;
    this.roadHalfWidth = ROAD_HALF_WIDTH;
    this.laneCenters = ROAD_LANE_CENTERS;
    this.routeMetadata = Object.freeze({
      roadHalfWidth: ROAD_HALF_WIDTH,
      laneCenters: ROAD_LANE_CENTERS,
      laneCount: ROAD_LANE_CENTERS.length,
    });
    this.routeLength = Number.POSITIVE_INFINITY;
    // Vehicle bounds remain finite for defensive transform checks while being
    // far beyond any achievable browser run. Streaming, not clamping, owns the
    // playable extent.
    this.minZ = -1_000_000_000;
    this.maxZ = 1_000_000_000;
    this.update(0, { x: roadXAt(initialPlayerZ), y: roadYAt(initialPlayerZ), z: initialPlayerZ });
  }

  roadXAt(z) { return roadXAt(z); }
  roadYAt(z) { return roadYAt(z); }
  roadHeadingAt(z) { return roadHeadingAt(z); }
  terrainHeightAt(x, z) { return terrainHeightAt(x, z, this.environmentProfile); }

  get activeChunkIndices() {
    return [...this.chunks.keys()].sort((a, b) => a - b);
  }

  get stats() {
    return {
      active: this.chunks.size,
      created: this.createdChunkCount,
      retired: this.retiredChunkCount,
      indices: this.activeChunkIndices,
      objectCount: [...this.chunks.values()].reduce((sum, chunk) => sum + chunk.group.children.length, 0),
      environmentId: this.environmentProfile.id,
    };
  }

  registerChunkDecorator(id, decorator) {
    if (!id || typeof decorator !== 'function') throw new TypeError('Chunk decorator requires an id and function.');
    if (this.decorators.has(id)) this.unregisterChunkDecorator(id);
    this.decorators.set(id, decorator);
    for (const chunk of this.chunks.values()) this._decorateChunk(chunk, id, decorator);
    return () => this.unregisterChunkDecorator(id);
  }

  unregisterChunkDecorator(id) {
    this.decorators.delete(id);
    for (const chunk of this.chunks.values()) {
      const retained = [];
      for (const entry of chunk.decoratorDisposers) {
        if (entry.id === id) entry.dispose?.();
        else retained.push(entry);
      }
      chunk.decoratorDisposers = retained;
    }
  }

  _decorateChunk(chunk, id, decorator) {
    const dispose = decorator({
      parent: chunk.group,
      index: chunk.index,
      seed: chunk.descriptor.propSeed,
      zMin: chunk.zMin,
      zMax: chunk.zMax,
      descriptor: chunk.descriptor,
      route: this,
    });
    chunk.decoratorDisposers.push({ id, dispose: typeof dispose === 'function' ? dispose : null });
  }

  _addChunk(index) {
    const chunk = createChunk(index, this.materials, this.sharedGeometry, this.environmentProfile);
    this.chunks.set(index, chunk);
    this.group.add(chunk.group);
    this.createdChunkCount += 1;
    for (const [id, decorator] of this.decorators) this._decorateChunk(chunk, id, decorator);
  }

  _retireChunk(index) {
    const chunk = this.chunks.get(index);
    if (!chunk) return;
    for (const entry of chunk.decoratorDisposers) entry.dispose?.();
    this.group.remove(chunk.group);
    for (const geometry of chunk.ownedGeometries) geometry.dispose();
    this.chunks.delete(index);
    this.retiredChunkCount += 1;
  }

  update(_elapsed = 0, playerPosition = null) {
    if (Number.isFinite(playerPosition?.z)) this.lastPlayerZ = playerPosition.z;
    const currentIndex = Math.floor(this.lastPlayerZ / CHUNK_LENGTH);
    const required = new Set();
    for (let index = currentIndex - GENERATE_AHEAD; index <= currentIndex + RETAIN_BEHIND; index += 1) required.add(index);
    for (const index of required) if (!this.chunks.has(index)) this._addChunk(index);
    for (const index of [...this.chunks.keys()]) if (!required.has(index)) this._retireChunk(index);
  }

  dispose() {
    for (const index of [...this.chunks.keys()]) this._retireChunk(index);
    this.scene?.remove(this.group);
    for (const geometry of Object.values(this.sharedGeometry)) geometry.dispose();
    const disposed = new Set();
    const disposeMaterial = (material) => {
      if (!material || disposed.has(material)) return;
      disposed.add(material);
      for (const key of ['map', 'bumpMap', 'roughnessMap']) material[key]?.dispose?.();
      material.dispose?.();
    };
    for (const value of Object.values(this.materials)) {
      if (Array.isArray(value)) value.forEach(disposeMaterial);
      else disposeMaterial(value);
    }
  }
}

export function buildEnvironment(scene, options = {}) {
  return new ProceduralWorldStream(scene, options);
}
