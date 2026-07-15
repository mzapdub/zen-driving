import * as THREE from 'three';

const TREE_COUNT = 140;
const ROAD_CLEARANCE = 13;
const UP = new THREE.Vector3(0, 1, 0);
const BUILDING_SITES = [
  [-230, -1], [-165, 1], [-92, -1], [-18, 1],
  [65, -1], [136, 1], [205, -1], [257, 1],
];

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function configureTextures(bark, foliage) {
  bark.colorSpace = THREE.SRGBColorSpace;
  bark.wrapS = THREE.RepeatWrapping;
  bark.wrapT = THREE.RepeatWrapping;
  bark.repeat.set(1.25, 4.5);
  bark.anisotropy = 4;

  foliage.colorSpace = THREE.SRGBColorSpace;
  foliage.wrapS = THREE.ClampToEdgeWrapping;
  foliage.wrapT = THREE.ClampToEdgeWrapping;
  foliage.anisotropy = 4;
}

// Three intersecting vertical cards give each crown clump volume from every road angle.
function createCrossedAtlasGeometry(cell) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const uvs = [];
  const indices = [];
  const cellX = cell % 2;
  const cellY = Math.floor(cell / 2);
  const inset = 0.012;
  const u0 = cellX * 0.5 + inset;
  const u1 = (cellX + 1) * 0.5 - inset;
  // Texture V coordinates start at the bottom, while atlas rows are named top-down.
  const v0 = (1 - cellY) * 0.5 + inset;
  const v1 = (2 - cellY) * 0.5 - inset;

  for (let card = 0; card < 3; card += 1) {
    const angle = card * Math.PI / 3;
    const dx = Math.cos(angle) * 0.5;
    const dz = Math.sin(angle) * 0.5;
    const base = positions.length / 3;
    positions.push(
      -dx, -0.5, -dz,
      dx, -0.5, dz,
      dx, 0.5, dz,
      -dx, 0.5, -dz,
    );
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function isNearBuilding(x, z, route) {
  return BUILDING_SITES.some(([siteZ, side]) => (
    Math.abs(z - siteZ) < 19
    && Math.sign(x - route.roadXAt(z)) === side
    && Math.abs(x - route.roadXAt(z)) < 45
  ));
}

function placeTrees(route, rng) {
  const trees = [];
  let attempts = 0;

  while (trees.length < TREE_COUNT && attempts < 24000) {
    attempts += 1;
    const routeZ = THREE.MathUtils.lerp(-308, 308, rng());
    const side = rng() < 0.5 ? -1 : 1;
    const distance = THREE.MathUtils.lerp(ROAD_CLEARANCE + 1.8, 52, Math.pow(rng(), 0.78));
    const heading = route.roadHeadingAt(routeZ);
    const normalX = Math.cos(heading) * side;
    const normalZ = -Math.sin(heading) * side;
    const x = route.roadXAt(routeZ) + normalX * distance;
    const z = routeZ + normalZ * distance;

    if (Math.abs(x) > 69 || isNearBuilding(x, z, route)) continue;
    if (trees.some((tree) => (tree.origin.x - x) ** 2 + (tree.origin.z - z) ** 2 < 22)) continue;

    const speciesRoll = rng();
    const species = speciesRoll < 0.29 ? 3 : Math.floor(rng() * 3);
    const height = species === 3
      ? THREE.MathUtils.lerp(10.5, 17, rng())
      : THREE.MathUtils.lerp(8.5, 15.5, rng());
    const y = route.terrainHeightAt(x, z);
    trees.push({
      origin: new THREE.Vector3(x, y, z),
      species,
      height,
      radius: height * (species === 3 ? 0.038 : 0.047) * THREE.MathUtils.lerp(0.88, 1.12, rng()),
      yaw: rng() * Math.PI * 2,
      phase: rng() * Math.PI * 2,
      scale: THREE.MathUtils.lerp(0.9, 1.13, rng()),
      tint: rng(),
    });
  }

  if (trees.length !== TREE_COUNT) {
    throw new Error(`Detailed tree placement stopped at ${trees.length}/${TREE_COUNT}`);
  }
  return trees;
}

function transformItem(treeIndex, position, quaternion, scale, color) {
  return {
    treeIndex,
    position: position.clone(),
    quaternion: quaternion.clone(),
    scale: scale.clone(),
    color: color.clone(),
  };
}

function addBranch(items, treeIndex, start, end, radius, color) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize());
  const position = start.clone().add(end).multiplyScalar(0.5);
  items.push(transformItem(
    treeIndex,
    position,
    quaternion,
    new THREE.Vector3(radius, length, radius),
    color,
  ));
}

function addFoliage(items, treeIndex, position, width, height, yaw, color) {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
  items.push(transformItem(
    treeIndex,
    position,
    quaternion,
    new THREE.Vector3(width, height, width),
    color,
  ));
}

function growDeciduous(tree, index, rng, branches, foliageByCell) {
  const { origin, height, species, yaw, scale } = tree;
  const barkColor = new THREE.Color(species === 1 ? 0x8b7a68 : 0x745b45)
    .offsetHSL((tree.tint - 0.5) * 0.025, -0.08, (tree.tint - 0.5) * 0.12);
  const leafBases = [0x73934a, 0x507a3e, 0x64843e];
  const leafColor = new THREE.Color(leafBases[species])
    .offsetHSL((tree.tint - 0.5) * 0.035, 0.04, (tree.tint - 0.5) * 0.14);
  const crownStart = height * 0.35;
  const crownRadius = height * THREE.MathUtils.lerp(0.25, 0.33, tree.tint) * scale;
  const primaryCount = 7 + Math.floor(rng() * 3);

  for (let branch = 0; branch < primaryCount; branch += 1) {
    const fraction = primaryCount === 1 ? 0 : branch / (primaryCount - 1);
    const angle = yaw + branch * 2.39996 + (rng() - 0.5) * 0.38;
    const startY = crownStart + fraction * height * 0.36;
    const length = crownRadius * THREE.MathUtils.lerp(0.7, 1.08, rng()) * (1 - fraction * 0.28);
    const start = origin.clone().add(new THREE.Vector3(0, startY, 0));
    const end = start.clone().add(new THREE.Vector3(
      Math.cos(angle) * length,
      length * THREE.MathUtils.lerp(0.25, 0.48, rng()),
      Math.sin(angle) * length,
    ));
    addBranch(branches, index, start, end, tree.radius * (0.34 - fraction * 0.1), barkColor);

    const splitStart = start.clone().lerp(end, 0.52);
    const splitAngle = angle + (rng() < 0.5 ? -1 : 1) * THREE.MathUtils.lerp(0.35, 0.72, rng());
    const splitEnd = splitStart.clone().add(new THREE.Vector3(
      Math.cos(splitAngle) * length * 0.62,
      length * THREE.MathUtils.lerp(0.2, 0.42, rng()),
      Math.sin(splitAngle) * length * 0.62,
    ));
    addBranch(branches, index, splitStart, splitEnd, tree.radius * 0.17, barkColor);

    const cell = (species + branch) % 3;
    const size = height * THREE.MathUtils.lerp(0.22, 0.29, rng()) * scale;
    addFoliage(foliageByCell[cell], index, end, size, size * THREE.MathUtils.lerp(0.84, 1.08, rng()), angle, leafColor);
    addFoliage(
      foliageByCell[(cell + 1) % 3],
      index,
      splitEnd,
      size * 0.78,
      size * THREE.MathUtils.lerp(0.68, 0.9, rng()),
      splitAngle,
      leafColor.clone().offsetHSL(0, 0, 0.035),
    );
  }

  for (let top = 0; top < 4; top += 1) {
    const angle = yaw + top * Math.PI * 0.5;
    const radius = crownRadius * 0.32;
    const position = origin.clone().add(new THREE.Vector3(
      Math.cos(angle) * radius,
      height * THREE.MathUtils.lerp(0.78, 0.96, rng()),
      Math.sin(angle) * radius,
    ));
    addFoliage(foliageByCell[(species + top) % 4], index, position, height * 0.23 * scale, height * 0.24, angle, leafColor);
  }
}

function growConifer(tree, index, rng, branches, foliageByCell) {
  const { origin, height, yaw, scale } = tree;
  const barkColor = new THREE.Color(0x665542).offsetHSL(0, -0.05, (tree.tint - 0.5) * 0.1);
  const leafColor = new THREE.Color(0x315d38).offsetHSL((tree.tint - 0.5) * 0.02, 0.05, (tree.tint - 0.5) * 0.11);
  const levels = 7;

  for (let level = 0; level < levels; level += 1) {
    const t = level / (levels - 1);
    const y = height * (0.25 + t * 0.58);
    const radius = height * (0.27 * (1 - t) + 0.055) * scale;
    const arms = level < 2 ? 6 : 5;
    for (let arm = 0; arm < arms; arm += 1) {
      const angle = yaw + arm / arms * Math.PI * 2 + level * 0.48;
      const start = origin.clone().add(new THREE.Vector3(0, y, 0));
      const end = start.clone().add(new THREE.Vector3(
        Math.cos(angle) * radius,
        radius * THREE.MathUtils.lerp(0.04, 0.16, rng()),
        Math.sin(angle) * radius,
      ));
      addBranch(branches, index, start, end, tree.radius * THREE.MathUtils.lerp(0.11, 0.18, 1 - t), barkColor);
      addFoliage(
        foliageByCell[(level + arm) % 2 + 1],
        index,
        start.clone().lerp(end, 0.72),
        radius * 0.72,
        height * THREE.MathUtils.lerp(0.13, 0.18, rng()),
        angle,
        leafColor,
      );
    }
  }

  addFoliage(
    foliageByCell[2],
    index,
    origin.clone().add(new THREE.Vector3(0, height * 0.9, 0)),
    height * 0.12,
    height * 0.24,
    yaw,
    leafColor.clone().offsetHSL(0, 0, 0.04),
  );
}

function buildInstancedMesh(geometry, material, items, name, dynamic = false) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const matrix = new THREE.Matrix4();
  mesh.name = name;
  mesh.instanceMatrix.setUsage(dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    matrix.compose(item.position, item.quaternion, item.scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, item.color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function makeTrunkItems(trees) {
  return trees.map((tree, treeIndex) => {
    const trunkHeight = tree.height * (tree.species === 3 ? 0.88 : 0.72);
    const color = new THREE.Color(tree.species === 1 ? 0x8d7a66 : 0x735944)
      .offsetHSL((tree.tint - 0.5) * 0.02, -0.06, (tree.tint - 0.5) * 0.12);
    return transformItem(
      treeIndex,
      tree.origin.clone().add(new THREE.Vector3(0, trunkHeight * 0.5, 0)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, tree.yaw, 0)),
      new THREE.Vector3(tree.radius, trunkHeight, tree.radius),
      color,
    );
  });
}

function updateDynamicMesh(mesh, items, trees, swayQuaternions) {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const tree = trees[item.treeIndex];
    const sway = swayQuaternions[item.treeIndex];
    position.copy(item.position).sub(tree.origin).applyQuaternion(sway).add(tree.origin);
    quaternion.copy(sway).multiply(item.quaternion);
    matrix.compose(position, quaternion, item.scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

export async function buildDetailedTrees(scene, route) {
  const requiredRouteFunctions = ['roadXAt', 'roadYAt', 'terrainHeightAt', 'roadHeadingAt'];
  for (const functionName of requiredRouteFunctions) {
    if (typeof route?.[functionName] !== 'function') {
      throw new TypeError(`buildDetailedTrees requires route.${functionName}()`);
    }
  }

  const loader = new THREE.TextureLoader();
  const [barkTexture, foliageTexture] = await Promise.all([
    loader.loadAsync(new URL('../assets/tree-bark-ai.png', import.meta.url).href),
    loader.loadAsync(new URL('../assets/foliage-atlas-ai.png', import.meta.url).href),
  ]);
  configureTextures(barkTexture, foliageTexture);

  const barkMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: barkTexture,
    roughness: 0.92,
    metalness: 0,
  });
  const foliageMaterials = Array.from({ length: 4 }, () => new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: foliageTexture,
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    roughness: 0.86,
    metalness: 0,
    depthWrite: true,
  }));
  for (const material of foliageMaterials) {
    material.bumpMap = foliageTexture;
    material.bumpScale = 0.045;
    material.roughnessMap = foliageTexture;
    material.userData.materialLayers = [
      'macro_species_and_season_palette',
      'midscale_crown_and_cluster_breakup',
      'fine_edge_and_roughness_variation',
    ];
  }

  const trunkGeometry = new THREE.CylinderGeometry(0.58, 1, 1, 9, 5, false);
  const branchGeometry = new THREE.CylinderGeometry(0.48, 1, 1, 7, 3, false);
  const foliageGeometries = Array.from({ length: 4 }, (_, cell) => createCrossedAtlasGeometry(cell));
  const rng = mulberry32(0x4e595452);
  const trees = placeTrees(route, rng);
  const trunkItems = makeTrunkItems(trees);
  const branchItems = [];
  const foliageItems = Array.from({ length: 4 }, () => []);

  for (let index = 0; index < trees.length; index += 1) {
    const tree = trees[index];
    if (tree.species === 3) growConifer(tree, index, rng, branchItems, foliageItems);
    else growDeciduous(tree, index, rng, branchItems, foliageItems);
  }

  const profile = route.environmentProfile;
  if (profile?.materials?.foliage?.macro?.canopy) {
    const profilePalette = profile.materials.foliage.macro.canopy.map((value) => new THREE.Color(value));
    const blendStrength = profile.id === 'catskills_scenic' ? 0.28 : 0.84;
    for (const items of foliageItems) {
      for (const item of items) {
        const tree = trees[item.treeIndex];
        const target = tree?.species === 3
          ? profilePalette[profilePalette.length - 1]
          : profilePalette[item.treeIndex % Math.max(1, profilePalette.length - 1)];
        item.color.lerp(target, blendStrength);
      }
    }
    if (profile.id === 'hokkaido_snow') {
      for (const item of trunkItems) {
        if (trees[item.treeIndex]?.species !== 3) item.color.lerp(new THREE.Color(0xd5ddd8), 0.72);
      }
      for (const item of branchItems) {
        if (trees[item.treeIndex]?.species !== 3) item.color.lerp(new THREE.Color(0xc8d2ce), 0.58);
      }
    } else if (profile.id === 'arizona_desert') {
      for (const item of trunkItems) item.color.lerp(new THREE.Color(0x7e5538), 0.68);
      for (const item of branchItems) item.color.lerp(new THREE.Color(0x765039), 0.6);
    }
  }

  const group = new THREE.Group();
  group.name = 'DetailedRoadsideTrees';
  group.userData.environmentId = route.environmentProfile?.id ?? 'catskills_scenic';
  const trunks = buildInstancedMesh(trunkGeometry, barkMaterial, trunkItems, 'DetailedTreeTrunks');
  const branches = buildInstancedMesh(branchGeometry, barkMaterial, branchItems, 'DetailedTreeBranches', true);
  const foliageMeshes = foliageItems.map((items, cell) => (
    buildInstancedMesh(foliageGeometries[cell], foliageMaterials[cell], items, `DetailedFoliageAtlasCell${cell}`, true)
  ));

  trunks.castShadow = true;
  trunks.receiveShadow = true;
  branches.castShadow = true;
  branches.receiveShadow = true;
  for (const foliage of foliageMeshes) {
    foliage.castShadow = false;
    foliage.receiveShadow = true;
  }
  group.add(trunks, branches, ...foliageMeshes);
  scene.add(group);

  const swayQuaternions = trees.map(() => new THREE.Quaternion());
  const swayEuler = new THREE.Euler();
  let lastUpdateTime = Number.NEGATIVE_INFINITY;

  function update(time, windStrength = 1) {
    // Cap matrix refresh to ~30 Hz. The canopy still reads as continuous at driving speed.
    if (time - lastUpdateTime < 1 / 30) return;
    lastUpdateTime = time;
    const wind = THREE.MathUtils.clamp(windStrength, 0, 2.5);
    for (let index = 0; index < trees.length; index += 1) {
      const tree = trees[index];
      const gust = 0.72 + Math.sin(time * 0.19 + tree.phase * 0.37) * 0.28;
      swayEuler.set(
        Math.sin(time * 0.83 + tree.phase) * 0.012 * wind * gust,
        0,
        Math.cos(time * 0.67 + tree.phase * 1.41) * 0.018 * wind * gust,
      );
      swayQuaternions[index].setFromEuler(swayEuler);
    }
    updateDynamicMesh(branches, branchItems, trees, swayQuaternions);
    for (let cell = 0; cell < foliageMeshes.length; cell += 1) {
      updateDynamicMesh(foliageMeshes[cell], foliageItems[cell], trees, swayQuaternions);
    }
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(group);
    trunkGeometry.dispose();
    branchGeometry.dispose();
    foliageGeometries.forEach((geometry) => geometry.dispose());
    barkMaterial.dispose();
    foliageMaterials.forEach((material) => material.dispose());
    barkTexture.dispose();
    foliageTexture.dispose();
  }

  return { group, update, dispose };
}
