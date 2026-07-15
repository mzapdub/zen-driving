import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MIN_CLEARANCE = 10.5;
const RIDGE_COUNT = 14;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function hash(x, z, seed = 0) {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function createLayerTexture(baseHex, seed, repeatX = 5, repeatY = 5) {
  const size = 96;
  const data = new Uint8Array(size * size * 4);
  const base = new THREE.Color(baseHex);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const macro = Math.sin((x + seed * 3) * 0.085) * Math.cos((y - seed) * 0.071) * 0.10;
      const mid = (hash(Math.floor(x / 8), Math.floor(y / 8), seed) - 0.5) * 0.14;
      const fine = (hash(x, y, seed + 19) - 0.5) * 0.075;
      const shade = THREE.MathUtils.clamp(1 + macro + mid + fine, 0.68, 1.24);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(THREE.MathUtils.clamp(base.r * shade, 0, 1) * 255);
      data[offset + 1] = Math.round(THREE.MathUtils.clamp(base.g * shade, 0, 1) * 255);
      data[offset + 2] = Math.round(THREE.MathUtils.clamp(base.b * shade, 0, 1) * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.needsUpdate = true;
  return texture;
}

function makeMaterial(color, seed, roughness = 0.88, metalness = 0) {
  const map = createLayerTexture(color, seed);
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness, metalness });
}

function positionBesideRoad(route, routeZ, side, distance) {
  const heading = route.roadHeadingAt(routeZ);
  const normalX = Math.cos(heading) * side;
  const normalZ = -Math.sin(heading) * side;
  const x = route.roadXAt(routeZ) + normalX * distance;
  const z = routeZ + normalZ * distance;
  return {
    position: new THREE.Vector3(x, route.terrainHeightAt(x, z), z),
    heading,
    normalX,
    normalZ,
    side,
  };
}

function approximateRoadClearance(x, z, route) {
  let minimum = Infinity;
  for (let sample = -12; sample <= 12; sample += 1.5) {
    const roadZ = z + sample;
    const dx = x - route.roadXAt(roadZ);
    minimum = Math.min(minimum, Math.hypot(dx, sample));
  }
  return minimum;
}

class InstanceBatcher {
  constructor(group) {
    this.group = group;
    this.batches = new Map();
    this.meshes = [];
    this.nonFiniteMatrices = 0;
  }

  add(key, geometry, material, position, scale, quaternion = new THREE.Quaternion(), color = null) {
    if (!this.batches.has(key)) this.batches.set(key, { geometry, material, items: [] });
    this.batches.get(key).items.push({
      position: position.clone(),
      scale: scale.clone(),
      quaternion: quaternion.clone(),
      color: color?.clone() ?? null,
    });
  }

  addBeam(key, geometry, material, start, end, thickness, color = null) {
    const delta = end.clone().sub(start);
    const length = delta.length();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(X_AXIS, delta.normalize());
    this.add(
      key,
      geometry,
      material,
      start.clone().add(end).multiplyScalar(0.5),
      new THREE.Vector3(length, thickness, thickness),
      quaternion,
      color,
    );
  }

  flush() {
    const matrix = new THREE.Matrix4();
    for (const [key, batch] of this.batches) {
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.items.length);
      mesh.name = key;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      batch.items.forEach((item, index) => {
        matrix.compose(item.position, item.quaternion, item.scale);
        if (!matrix.elements.every(Number.isFinite)) this.nonFiniteMatrices += 1;
        mesh.setMatrixAt(index, matrix);
        if (item.color) mesh.setColorAt(index, item.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = key.includes('Tractor') || key.includes('Bench') || key.includes('FencePost');
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    return this.meshes;
  }
}

function createRidgeGeometry(side, layer, route, rng) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const colors = [];
  const indices = [];
  const zSegments = 72;
  const columns = 5;
  const centerDistance = 76 + layer * 19;
  const width = 20 + layer * 4.2;
  const baseHeight = 22 + layer * 7.2;
  const haze = layer / 6;
  const low = new THREE.Color(0x405747).lerp(new THREE.Color(0x77909a), haze * 0.62);
  const rock = new THREE.Color(0x6c675d).lerp(new THREE.Color(0x8799a2), haze * 0.68);
  const snowlessTop = new THREE.Color(0x59635b).lerp(new THREE.Color(0x99a9ae), haze * 0.72);
  const profile = [0.03, 0.43, 1, 0.67, 0.06];
  const phaseA = rng() * Math.PI * 2;
  const phaseB = rng() * Math.PI * 2;

  for (let iz = 0; iz <= zSegments; iz += 1) {
    const t = iz / zSegments;
    const z = THREE.MathUtils.lerp(-415, 415, t);
    const silhouette = 0.78
      + Math.sin(z * (0.012 + layer * 0.0008) + phaseA) * 0.18
      + Math.sin(z * 0.034 + phaseB) * 0.095
      + (hash(iz, layer, side + 4) - 0.5) * 0.12;
    const centerX = side * (centerDistance + Math.sin(z * 0.008 + phaseB) * (5 + layer));

    for (let column = 0; column < columns; column += 1) {
      const u = column / (columns - 1);
      const x = centerX + side * (u - 0.5) * width;
      const ground = route.terrainHeightAt(x, z);
      const cliffBias = column === 1 ? -2.2 : column === 3 ? 1.7 : 0;
      const y = ground + baseHeight * silhouette * profile[column] + cliffBias;
      positions.push(x, y, z);

      const normalizedHeight = profile[column] * silhouette;
      const strata = Math.sin(y * 1.45 + z * 0.018 + layer) * 0.5 + 0.5;
      const macro = Math.sin(z * 0.009 + column) * 0.5 + 0.5;
      const color = low.clone().lerp(rock, THREE.MathUtils.clamp(normalizedHeight * 0.9 + strata * 0.16, 0, 1));
      color.lerp(snowlessTop, THREE.MathUtils.clamp((normalizedHeight - 0.68) * 1.7 + macro * 0.08, 0, 0.42));
      color.offsetHSL(0, 0, (hash(iz, column, layer) - 0.5) * 0.055);
      colors.push(color.r, color.g, color.b);
    }
  }

  for (let iz = 0; iz < zSegments; iz += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = iz * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function addMountainRidges(group, route, rng, resources) {
  const meshes = [];
  for (const side of [-1, 1]) {
    for (let layer = 0; layer < RIDGE_COUNT / 2; layer += 1) {
      const geometry = createRidgeGeometry(side, layer, route, rng);
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.98,
        metalness: 0,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `LayeredRidge_${side < 0 ? 'West' : 'East'}_${layer + 1}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.renderOrder = -layer;
      group.add(mesh);
      meshes.push(mesh);
      resources.geometries.add(geometry);
      resources.materials.add(material);
    }
  }
  return meshes;
}

function createFlowerGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const colors = [];
  const indices = [];
  const stemColor = new THREE.Color(0x416c35);
  const petalColors = [new THREE.Color(0xe5bd42), new THREE.Color(0xd880a4), new THREE.Color(0xe6e2cf)];
  for (let stem = 0; stem < 5; stem += 1) {
    const angle = stem * 2.39996;
    const x = Math.cos(angle) * 0.24;
    const z = Math.sin(angle) * 0.24;
    const height = 0.55 + (stem % 3) * 0.12;
    const base = positions.length / 3;
    positions.push(x - 0.018, 0, z, x + 0.018, 0, z, x + 0.012, height, z, x - 0.012, height, z);
    for (let i = 0; i < 4; i += 1) colors.push(stemColor.r, stemColor.g, stemColor.b);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    const flowerBase = positions.length / 3;
    const petal = petalColors[stem % petalColors.length];
    positions.push(x - 0.11, height, z, x + 0.11, height, z, x, height + 0.15, z);
    for (let i = 0; i < 3; i += 1) colors.push(petal.r, petal.g, petal.b);
    indices.push(flowerBase, flowerBase + 1, flowerBase + 2);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function quaternionFromEuler(x = 0, y = 0, z = 0) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
}

function createTreelineBeam(start, end, radius, radialSegments = 5) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius * 0.62, radius, length, radialSegments, 2);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize());
  geometry.applyMatrix4(new THREE.Matrix4().compose(
    start.clone().add(end).multiplyScalar(0.5),
    quaternion,
    new THREE.Vector3(1, 1, 1),
  ));
  return geometry;
}

function createComplexTreelineGeometries() {
  const woodParts = [];
  const foliageParts = [];
  const trunkSegments = [
    [0.18, 0.36, 0.055],
    [0.46, 0.26, 0.044],
    [0.68, 0.24, 0.034],
  ];
  for (const [centerY, length, radius] of trunkSegments) {
    const geometry = new THREE.CylinderGeometry(radius * 0.72, radius, length, 6, 2);
    geometry.translate(0, centerY, 0);
    woodParts.push(geometry);
  }

  for (let branch = 0; branch < 6; branch += 1) {
    const t = branch / 5;
    const angle = branch * 2.39996;
    const length = THREE.MathUtils.lerp(0.27, 0.16, t);
    const start = new THREE.Vector3(0, THREE.MathUtils.lerp(0.34, 0.7, t), 0);
    const end = start.clone().add(new THREE.Vector3(
      Math.cos(angle) * length,
      THREE.MathUtils.lerp(0.1, 0.055, t),
      Math.sin(angle) * length,
    ));
    woodParts.push(createTreelineBeam(start, end, THREE.MathUtils.lerp(0.026, 0.016, t), 5));

    const splitStart = start.clone().lerp(end, 0.56);
    const splitAngle = angle + (branch % 2 === 0 ? -0.58 : 0.58);
    const splitLength = length * 0.56;
    const splitEnd = splitStart.clone().add(new THREE.Vector3(
      Math.cos(splitAngle) * splitLength,
      0.055,
      Math.sin(splitAngle) * splitLength,
    ));
    woodParts.push(createTreelineBeam(splitStart, splitEnd, THREE.MathUtils.lerp(0.013, 0.009, t), 5));

    for (const [point, size, verticalScale] of [
      [end, THREE.MathUtils.lerp(0.145, 0.105, t), 0.66],
      [splitEnd, THREE.MathUtils.lerp(0.11, 0.082, t), 0.58],
    ]) {
      const cluster = new THREE.IcosahedronGeometry(1, 0);
      cluster.applyMatrix4(new THREE.Matrix4().compose(
        point,
        quaternionFromEuler(0, angle + branch * 0.17, 0),
        new THREE.Vector3(size, size * verticalScale, size * 0.82),
      ));
      foliageParts.push(cluster);
    }
  }

  const wood = mergeGeometries(woodParts, false);
  const foliage = mergeGeometries(foliageParts, false);
  woodParts.forEach((geometry) => geometry.dispose());
  foliageParts.forEach((geometry) => geometry.dispose());
  wood.name = 'ComplexTreelineWoodGeometry';
  foliage.name = 'LayeredTreelineFoliageGeometry';
  wood.userData.treeStructure = { trunkSegments: 3, primaryBranches: 6, secondaryBranches: 6 };
  foliage.userData.treeStructure = { foliageClusters: 12 };
  return { wood, foliage };
}

function addTreeline(group, route, rng, materials, resources) {
  const count = 460;
  const geometries = createComplexTreelineGeometries();
  const wood = new THREE.InstancedMesh(geometries.wood, materials.wood, count);
  const foliage = new THREE.InstancedMesh(geometries.foliage, materials.foliage, count);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const profile = route.environmentProfile;
  const foliagePalette = profile?.materials?.foliage?.macro?.canopy
    ?.map((value) => new THREE.Color(value).getHex())
    ?? [0x294936, 0x365744];
  for (let index = 0; index < count; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const z = THREE.MathUtils.lerp(-390, 390, rng());
    const x = side * THREE.MathUtils.lerp(58, 108, rng());
    const y = route.terrainHeightAt(x, z);
    const height = THREE.MathUtils.lerp(2.4, 7.2, rng());
    matrix.compose(
      new THREE.Vector3(x, y, z),
      quaternionFromEuler(0, rng() * Math.PI, 0),
      new THREE.Vector3(height * THREE.MathUtils.lerp(0.88, 1.12, rng()), height, height * THREE.MathUtils.lerp(0.88, 1.12, rng())),
    );
    wood.setMatrixAt(index, matrix);
    foliage.setMatrixAt(index, matrix);
    wood.setColorAt(index, color.set(0x765742).offsetHSL(0, -0.08, (rng() - 0.5) * 0.1));
    const foliageBase = foliagePalette[index % foliagePalette.length];
    foliage.setColorAt(index, color.set(foliageBase).offsetHSL(0, 0, (rng() - 0.5) * 0.12));
  }
  for (const mesh of [wood, foliage]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  wood.name = 'RidgeComplexTreelineWood';
  foliage.name = 'RidgeLayeredTreelineFoliage';
  resources.geometries.add(geometries.wood);
  resources.geometries.add(geometries.foliage);
  return {
    meshes: [wood, foliage],
    count,
    structure: Object.freeze({ trunkSegments: 3, primaryBranches: 6, secondaryBranches: 6, foliageClusters: 12, drawCalls: 2 }),
  };
}

function addRoadsideProps(group, route, rng, materials, geometries, resources) {
  const batcher = new InstanceBatcher(group);
  const anchors = [];
  const breakdown = {
    fenceSpans: 56,
    mailboxes: 14,
    roadSigns: 18,
    wildflowerClumps: 50,
    hayBales: 18,
    culverts: 10,
    rockWallSections: 20,
    benches: 6,
    pullOffs: 3,
    tractor: 1,
    utilityTrailer: 1,
  };

  function remember(position, kind) {
    anchors.push({ position: position.clone(), kind });
  }

  // Post-and-rail fence spans follow the terrain on both sides of the route.
  for (let index = 0; index < breakdown.fenceSpans; index += 1) {
    const z = -292 + index * (584 / (breakdown.fenceSpans - 1));
    const side = index % 4 < 2 ? -1 : 1;
    const a = positionBesideRoad(route, z, side, 16.5);
    const b = positionBesideRoad(route, z + 8.5, side, 16.5);
    remember(a.position, 'fence');
    for (const point of [a.position, b.position]) {
      batcher.add('FencePosts', geometries.box, materials.wood, point.clone().add(new THREE.Vector3(0, 0.75, 0)), new THREE.Vector3(0.17, 1.5, 0.17));
    }
    for (const height of [0.55, 1.08]) {
      batcher.addBeam('FenceRails', geometries.box, materials.wood, a.position.clone().add(new THREE.Vector3(0, height, 0)), b.position.clone().add(new THREE.Vector3(0, height, 0)), 0.13);
    }
  }

  for (let index = 0; index < breakdown.mailboxes; index += 1) {
    const anchor = positionBesideRoad(route, -270 + index * 42, index % 2 ? 1 : -1, 13.8);
    remember(anchor.position, 'mailbox');
    batcher.add('MailboxPosts', geometries.box, materials.wood, anchor.position.clone().add(new THREE.Vector3(0, 0.7, 0)), new THREE.Vector3(0.12, 1.4, 0.12));
    batcher.add('MailboxBodies', geometries.box, materials.metal, anchor.position.clone().add(new THREE.Vector3(0, 1.47, 0)), new THREE.Vector3(0.5, 0.38, 0.72), quaternionFromEuler(0, anchor.heading, 0));
    const flagPos = anchor.position.clone().add(new THREE.Vector3(anchor.normalX * 0.3, 1.68, anchor.normalZ * 0.3));
    batcher.add('MailboxFlags', geometries.box, materials.warning, flagPos, new THREE.Vector3(0.06, 0.38, 0.25), quaternionFromEuler(0, anchor.heading, 0));
  }

  for (let index = 0; index < breakdown.roadSigns; index += 1) {
    const anchor = positionBesideRoad(route, -288 + index * 34, index % 3 === 0 ? -1 : 1, 12.4);
    remember(anchor.position, 'sign');
    batcher.add('SignPosts', geometries.box, materials.metal, anchor.position.clone().add(new THREE.Vector3(0, 1.15, 0)), new THREE.Vector3(0.1, 2.3, 0.1));
    const plateQ = quaternionFromEuler(0, anchor.heading, index % 2 === 0 ? Math.PI / 4 : 0);
    batcher.add(index % 2 === 0 ? 'WarningDiamonds' : 'ChevronSigns', geometries.box, index % 2 === 0 ? materials.warning : materials.sign, anchor.position.clone().add(new THREE.Vector3(0, 2.35, 0)), new THREE.Vector3(0.82, 0.82, 0.08), plateQ);
    if (index % 2 === 1) {
      batcher.add('ChevronMarks', geometries.box, materials.dark, anchor.position.clone().add(new THREE.Vector3(0, 2.35, -0.06)), new THREE.Vector3(0.14, 0.58, 0.07), quaternionFromEuler(0, anchor.heading, -0.55));
    }
  }

  for (let index = 0; index < breakdown.wildflowerClumps; index += 1) {
    const anchor = positionBesideRoad(route, THREE.MathUtils.lerp(-305, 305, rng()), rng() < 0.5 ? -1 : 1, THREE.MathUtils.lerp(11.8, 27, rng()));
    remember(anchor.position, 'wildflower');
    const scale = THREE.MathUtils.lerp(0.7, 1.45, rng());
    batcher.add('WildflowerClumps', geometries.flower, materials.flower, anchor.position.clone().add(new THREE.Vector3(0, 0.02, 0)), new THREE.Vector3(scale, scale, scale), quaternionFromEuler(0, rng() * Math.PI, 0));
  }

  for (let index = 0; index < breakdown.hayBales; index += 1) {
    const anchor = positionBesideRoad(route, -255 + index * 31, index % 2 ? -1 : 1, THREE.MathUtils.lerp(29, 44, rng()));
    remember(anchor.position, 'hay bale');
    batcher.add('HayBales', geometries.hay, materials.hay, anchor.position.clone().add(new THREE.Vector3(0, 0.66, 0)), new THREE.Vector3(1.15, 1.25, 1.15), quaternionFromEuler(Math.PI / 2, rng() * Math.PI, 0), new THREE.Color(0xc39a43).offsetHSL(0, 0, (rng() - 0.5) * 0.12));
  }

  for (let index = 0; index < breakdown.culverts; index += 1) {
    const anchor = positionBesideRoad(route, -270 + index * 60, index % 2 ? 1 : -1, 11.9);
    remember(anchor.position, 'culvert');
    const q = quaternionFromEuler(Math.PI / 2, anchor.heading, 0);
    batcher.add('CulvertPipes', geometries.pipe, materials.darkMetal, anchor.position.clone().add(new THREE.Vector3(0, 0.42, 0)), new THREE.Vector3(0.68, 1.8, 0.68), q);
    batcher.add('CulvertRims', geometries.rim, materials.metal, anchor.position.clone().add(new THREE.Vector3(anchor.normalX * -0.85, 0.42, anchor.normalZ * -0.85)), new THREE.Vector3(0.72, 0.72, 0.72), quaternionFromEuler(0, anchor.heading, 0));
  }

  for (let section = 0; section < breakdown.rockWallSections; section += 1) {
    const anchor = positionBesideRoad(route, -280 + section * 29, section % 4 < 2 ? -1 : 1, 19);
    remember(anchor.position, 'rock wall');
    for (let stone = 0; stone < 5; stone += 1) {
      const along = (stone - 2) * 1.05;
      const x = anchor.position.x + Math.sin(anchor.heading) * along;
      const z = anchor.position.z + Math.cos(anchor.heading) * along;
      const y = route.terrainHeightAt(x, z);
      batcher.add('RockWallStones', geometries.rock, materials.stone, new THREE.Vector3(x, y + 0.43, z), new THREE.Vector3(0.68 + rng() * 0.3, 0.55 + rng() * 0.28, 0.55 + rng() * 0.25), quaternionFromEuler(rng() * 0.2, rng() * Math.PI, rng() * 0.12), new THREE.Color(0x77766e).offsetHSL(0, 0, (rng() - 0.5) * 0.16));
    }
  }

  const pullOffZs = [-184, 22, 214];
  for (let pull = 0; pull < breakdown.pullOffs; pull += 1) {
    const side = pull % 2 ? -1 : 1;
    const anchor = positionBesideRoad(route, pullOffZs[pull], side, 19.5);
    remember(anchor.position, 'pull-off');
    batcher.add('ScenicPullOffs', geometries.disc, materials.gravel, anchor.position.clone().add(new THREE.Vector3(0, 0.035, 0)), new THREE.Vector3(7.2, 7.2, 7.2), quaternionFromEuler(-Math.PI / 2, 0, 0));
    for (let bench = 0; bench < 2; bench += 1) {
      const along = (bench - 0.5) * 3.4;
      const base = anchor.position.clone().add(new THREE.Vector3(Math.sin(anchor.heading) * along, 0, Math.cos(anchor.heading) * along));
      remember(base, 'bench');
      batcher.add('BenchWood', geometries.box, materials.wood, base.clone().add(new THREE.Vector3(0, 0.72, 0)), new THREE.Vector3(2.2, 0.18, 0.48), quaternionFromEuler(0, anchor.heading, 0));
      batcher.add('BenchWood', geometries.box, materials.wood, base.clone().add(new THREE.Vector3(anchor.normalX * 0.34, 1.2, anchor.normalZ * 0.34)), new THREE.Vector3(2.2, 0.18, 0.52), quaternionFromEuler(0, anchor.heading, 0));
      for (const leg of [-0.78, 0.78]) {
        batcher.add('BenchLegs', geometries.box, materials.darkMetal, base.clone().add(new THREE.Vector3(Math.sin(anchor.heading) * leg, 0.36, Math.cos(anchor.heading) * leg)), new THREE.Vector3(0.14, 0.72, 0.36));
      }
    }
  }

  // One recognizable parked tractor and a separate utility trailer at a farm pull-in.
  const tractor = positionBesideRoad(route, 112, -1, 31);
  remember(tractor.position, 'tractor');
  const tq = quaternionFromEuler(0, tractor.heading, 0);
  batcher.add('TractorBodies', geometries.box, materials.tractor, tractor.position.clone().add(new THREE.Vector3(0, 1.3, 0)), new THREE.Vector3(1.7, 1.05, 2.7), tq);
  batcher.add('TractorCab', geometries.box, materials.dark, tractor.position.clone().add(new THREE.Vector3(0, 2.25, 0.55)), new THREE.Vector3(1.5, 1.55, 1.35), tq);
  for (const wheel of [-1, 1]) {
    batcher.add('TractorWheels', geometries.wheel, materials.rubber, tractor.position.clone().add(new THREE.Vector3(wheel * 1.02, 0.85, 0.7)), new THREE.Vector3(0.92, 0.62, 0.92), quaternionFromEuler(0, 0, Math.PI / 2));
    batcher.add('TractorWheels', geometries.wheel, materials.rubber, tractor.position.clone().add(new THREE.Vector3(wheel * 0.9, 0.62, -1.05)), new THREE.Vector3(0.62, 0.5, 0.62), quaternionFromEuler(0, 0, Math.PI / 2));
  }
  batcher.add('TractorExhaust', geometries.pipe, materials.darkMetal, tractor.position.clone().add(new THREE.Vector3(0.62, 2.4, -0.45)), new THREE.Vector3(0.11, 1.4, 0.11));

  const trailer = positionBesideRoad(route, 154, 1, 29);
  remember(trailer.position, 'utility trailer');
  const trailerQ = quaternionFromEuler(0, trailer.heading, 0);
  batcher.add('UtilityTrailerBed', geometries.box, materials.metal, trailer.position.clone().add(new THREE.Vector3(0, 0.92, 0)), new THREE.Vector3(2.1, 0.35, 4.1), trailerQ);
  for (const side of [-1, 1]) {
    batcher.add('UtilityTrailerRails', geometries.box, materials.darkMetal, trailer.position.clone().add(new THREE.Vector3(side * 1.02, 1.45, 0)), new THREE.Vector3(0.09, 1.05, 4.0), trailerQ);
    batcher.add('TrailerWheels', geometries.wheel, materials.rubber, trailer.position.clone().add(new THREE.Vector3(side * 1.12, 0.66, 0.65)), new THREE.Vector3(0.56, 0.38, 0.56), quaternionFromEuler(0, 0, Math.PI / 2));
  }

  const meshes = batcher.flush();
  for (const geometry of Object.values(geometries)) resources.geometries.add(geometry);
  return { meshes, anchors, breakdown, batcher };
}

export function buildWorldDetail(scene, route) {
  const required = ['roadXAt', 'roadYAt', 'terrainHeightAt', 'roadHeadingAt'];
  required.forEach((name) => {
    if (typeof route?.[name] !== 'function') throw new TypeError(`buildWorldDetail requires route.${name}()`);
  });

  const group = new THREE.Group();
  group.name = 'WorldDetailV3';
  group.userData.environmentId = route.environmentProfile?.id ?? 'catskills_scenic';
  const profile = route.environmentProfile;
  const autumn = group.userData.environmentId === 'adirondack_autumn';
  const snow = group.userData.environmentId === 'hokkaido_snow';
  const desert = group.userData.environmentId === 'arizona_desert';
  group.userData.environmentSignature = Object.freeze({
    surfaceMode: profile?.props?.surfaceMode ?? 'meadow_forest',
    propSet: profile?.props?.propSet ?? 'rural_farm',
  });
  const rng = mulberry32(0x57564c44);
  const resources = { geometries: new Set(), materials: new Set(), textures: new Set() };
  const materials = {
    wood: makeMaterial(snow ? 0x5f5650 : desert ? 0x77513a : 0x725336, 11, 0.92),
    metal: makeMaterial(0x8c9290, 17, 0.56, 0.42),
    darkMetal: makeMaterial(0x3d4546, 23, 0.62, 0.5),
    warning: makeMaterial(0xe4b62f, 29, 0.72),
    sign: makeMaterial(0xf0e4b7, 31, 0.74),
    dark: makeMaterial(0x262c2a, 37, 0.68),
    hay: makeMaterial(snow ? 0xaab9b7 : desert ? 0xa76f38 : 0xb98c38, 41, 0.97),
    stone: makeMaterial(snow ? 0x71838a : desert ? 0xa54c2f : autumn ? 0x85898b : 0x74736c, 43, 0.96),
    gravel: makeMaterial(snow ? 0xc9d9db : desert ? 0xbd7643 : 0x746f66, 47, 0.99),
    tractor: makeMaterial(0x9d2e24, 53, 0.68, 0.08),
    rubber: makeMaterial(0x151817, 59, 0.98),
    flower: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }),
    treelineWood: makeMaterial(snow ? 0xb9c4c1 : desert ? 0x755039 : 0x684c38, 67, 0.96),
    treelineFoliage: makeMaterial(new THREE.Color(profile?.materials?.foliage?.macro?.canopy?.[0] ?? (autumn ? 0xb65327 : 0x365744)).getHex(), 71, 0.91),
  };
  materials.treelineWood.bumpMap = materials.treelineWood.map;
  materials.treelineWood.bumpScale = 0.13;
  materials.treelineWood.roughnessMap = materials.treelineWood.map;
  materials.treelineFoliage.bumpMap = materials.treelineFoliage.map;
  materials.treelineFoliage.bumpScale = 0.1;
  materials.treelineFoliage.roughnessMap = materials.treelineFoliage.map;
  materials.treelineFoliage.userData.materialLayers = [
    'macro_species_and_season_palette',
    'midscale_crown_and_cluster_breakup',
    'fine_edge_and_roughness_variation',
  ];
  Object.values(materials).forEach((material) => {
    resources.materials.add(material);
    if (material.map) resources.textures.add(material.map);
  });

  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    rock: new THREE.DodecahedronGeometry(1, 0),
    hay: new THREE.CylinderGeometry(1, 1, 1, 14, 3),
    pipe: new THREE.CylinderGeometry(1, 1, 1, 14, 1, true),
    rim: new THREE.TorusGeometry(1, 0.12, 6, 14),
    wheel: new THREE.CylinderGeometry(1, 1, 1, 14, 2),
    disc: new THREE.CircleGeometry(1, 28),
    flower: createFlowerGeometry(),
  };

  const ridges = addMountainRidges(group, route, rng, resources);
  const treeline = addTreeline(
    group,
    route,
    rng,
    { wood: materials.treelineWood, foliage: materials.treelineFoliage },
    resources,
  );
  const props = addRoadsideProps(group, route, rng, materials, geometries, resources);
  scene.add(group);

  const clearances = props.anchors.map(({ position }) => approximateRoadClearance(position.x, position.z, route));
  const minRoadClearance = Math.min(...clearances);
  if (minRoadClearance < MIN_CLEARANCE) {
    scene.remove(group);
    throw new Error(`World-detail prop clearance ${minRoadClearance.toFixed(2)}m is below ${MIN_CLEARANCE}m`);
  }
  if (props.batcher.nonFiniteMatrices > 0) {
    scene.remove(group);
    throw new Error(`World-detail generated ${props.batcher.nonFiniteMatrices} non-finite instance matrices`);
  }

  const roadsidePropCount = Object.values(props.breakdown).reduce((sum, count) => sum + count, 0);
  const stats = Object.freeze({
    mountainRidges: ridges.length,
    treelineInstances: treeline.count,
    treelineStructure: treeline.structure,
    roadsideProps: roadsidePropCount,
    propBreakdown: Object.freeze({ ...props.breakdown }),
    minRoadClearance,
    nonFiniteMatrices: props.batcher.nonFiniteMatrices,
    instancedBatches: props.meshes.length + treeline.meshes.length,
    estimatedDrawCalls: ridges.length + props.meshes.length + treeline.meshes.length,
  });

  let disposed = false;
  function update(time, playerPosition) {
    const playerX = Number.isFinite(playerPosition?.x) ? playerPosition.x : 0;
    materials.warning.emissive.setHex(0x2a1b00);
    materials.warning.emissiveIntensity = 0.045 + Math.sin(time * 1.25 + playerX * 0.01) * 0.018;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(group);
    resources.geometries.forEach((geometry) => geometry.dispose());
    resources.materials.forEach((material) => material.dispose());
    resources.textures.forEach((texture) => texture.dispose());
  }

  return { group, update, dispose, stats };
}
