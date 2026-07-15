import * as THREE from 'three';
import {
  ONCOMING_HEADLIGHT_BASE_COLOR,
  ONCOMING_HEADLIGHT_EMISSIVE_INTENSITY,
  TRAFFIC_PAINT_CLEARCOAT,
  TRAFFIC_PAINT_CLEARCOAT_ROUGHNESS,
  TRAFFIC_PAINT_LIGHTEST_COLOR,
  TRAFFIC_PAINT_METALNESS,
  TRAFFIC_PAINT_ROUGHNESS,
  TRAFFIC_PAINT_SPECULAR_INTENSITY,
} from './render-effects-config.js';

export const TRAFFIC_POOL_SIZE = 21;
export const RHYTHM_LANE_CENTERS = Object.freeze([-4.6, 0, 4.6]);
const LEGACY_LANE_CENTERS = Object.freeze([-2.3, 2.3]);
const ONCOMING_LANE_OFFSET = LEGACY_LANE_CENTERS[0];
const WHEEL_RADIUS = 0.34;
const SPAWN_NEAR = 85;
const SPAWN_FAR = 260;
const DESPAWN_BEHIND = 45;
const MIN_TRAFFIC_GAP = 8.5;
const COLLISION_HALF_LENGTH = 3.55;
const COLLISION_HALF_WIDTH = 1.55;
const NEAR_MISS_WIDTH = 2.85;
const MAX_WAVE_HISTORY = 64;
const PAINT_TEXTURE_URL = new URL('../assets/vehicle-paint-ai.png', import.meta.url).href;
const TRIM_TEXTURE_URL = new URL('../assets/vehicle-trim-ai.png', import.meta.url).href;

export const TRAFFIC_VEHICLE_FAMILIES = Object.freeze([
  Object.freeze({ id: 'sedan', label: 'Touring sedan', length: 4.55, width: 1.82, roofHeight: 1.38, cabinLength: 0.45, cabinZ: 0.05, wheelScale: 1 }),
  Object.freeze({ id: 'hatchback', label: 'Hot hatch', length: 4.08, width: 1.78, roofHeight: 1.44, cabinLength: 0.53, cabinZ: 0.1, wheelScale: 0.97 }),
  Object.freeze({ id: 'coupe', label: 'Grand touring coupe', length: 4.36, width: 1.84, roofHeight: 1.25, cabinLength: 0.39, cabinZ: 0.03, wheelScale: 1.03 }),
  Object.freeze({ id: 'suv', label: 'Adventure SUV', length: 4.74, width: 1.92, roofHeight: 1.68, cabinLength: 0.52, cabinZ: 0.06, wheelScale: 1.12 }),
  Object.freeze({ id: 'pickup', label: 'Crew-cab pickup', length: 4.98, width: 1.92, roofHeight: 1.56, cabinLength: 0.34, cabinZ: -0.17, wheelScale: 1.1 }),
  Object.freeze({ id: 'van', label: 'Panel van', length: 5.02, width: 1.94, roofHeight: 1.9, cabinLength: 0.65, cabinZ: 0.08, wheelScale: 1.07 }),
]);

const RHYTHM_PATTERNS = Object.freeze({
  'dusk-mile': Object.freeze({ cycle: 8, beats: Object.freeze([0, 2, 4, 6]), doubles: Object.freeze([4]), laneShift: 0 }),
  'pine-rain': Object.freeze({ cycle: 8, beats: Object.freeze([0, 3, 6]), doubles: Object.freeze([6]), laneShift: 1 }),
  'midnight-run': Object.freeze({ cycle: 8, beats: Object.freeze([0, 1, 2, 4, 5, 6]), doubles: Object.freeze([2, 6]), laneShift: 2 }),
  'ridge-lanterns': Object.freeze({ cycle: 8, beats: Object.freeze([0, 2, 5, 7]), doubles: Object.freeze([5]), laneShift: 1 }),
  'storm-signal': Object.freeze({ cycle: 8, beats: Object.freeze([0, 1, 3, 4, 6]), doubles: Object.freeze([1, 4]), laneShift: 2 }),
  'dawn-return': Object.freeze({ cycle: 8, beats: Object.freeze([0, 3, 4, 7]), doubles: Object.freeze([4]), laneShift: 0 }),
});

function hashUnit(value, salt = 0) {
  let state = (value | 0) ^ (salt | 0) ^ 0x9e3779b9;
  state = Math.imul(state ^ state >>> 16, 0x21f0aaad);
  state = Math.imul(state ^ state >>> 15, 0x735a2d97);
  return ((state ^ state >>> 15) >>> 0) / 4294967295;
}

function normalizeRhythmState(snapshot) {
  const pattern = RHYTHM_PATTERNS[snapshot?.songId];
  const bpm = Number(snapshot?.bpm);
  const sixteenthStep = Number(snapshot?.sixteenthStep);
  const schedulerTime = Number(snapshot?.schedulerTime);
  if (!pattern || !Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(sixteenthStep) || !Number.isFinite(schedulerTime)) return null;
  const transition = Number.isFinite(snapshot.playlistTransitionCount)
    ? Math.max(0, Math.floor(snapshot.playlistTransitionCount))
    : 0;
  return {
    songId: snapshot.songId,
    bpm,
    sixteenthStep: Math.max(0, Math.floor(sixteenthStep)),
    schedulerTime: Math.max(0, schedulerTime),
    transition,
    pattern,
  };
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

function addBox(parent, geometry, material, position, scale, name = '') {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function addSphere(parent, geometry, material, position, scale, name = '') {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function makeMicroTexture(seed) {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  let state = seed >>> 0;
  for (let index = 0; index < size * size; index += 1) {
    state = Math.imul(state ^ state >>> 15, state | 1);
    const grain = 108 + ((state ^ state >>> 13) & 55);
    data.set([grain, grain, grain, 255], index * 4);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(7, 11);
  texture.needsUpdate = true;
  return texture;
}

function loadTextureGracefully(url, onLoad) {
  if (typeof document === 'undefined') return;
  try {
    new THREE.TextureLoader().load(url, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      onLoad(texture);
    }, undefined, () => {});
  } catch {
    // Color and procedural roughness layers are the asset fallback.
  }
}

function makeSharedResources() {
  const micro = makeMicroTexture(0x714c);
  const paintColors = [0x245b8f, TRAFFIC_PAINT_LIGHTEST_COLOR, 0x202329, 0x8e1822, 0x546151, 0xc27a2c, 0x6d637e];
  const paints = paintColors.map((color, index) => new THREE.MeshPhysicalMaterial({
    name: `TrafficPaint${index}`,
    color,
    metalness: TRAFFIC_PAINT_METALNESS,
    roughness: TRAFFIC_PAINT_ROUGHNESS,
    bumpMap: micro,
    bumpScale: 0.035,
    clearcoat: TRAFFIC_PAINT_CLEARCOAT,
    clearcoatRoughness: TRAFFIC_PAINT_CLEARCOAT_ROUGHNESS,
    specularIntensity: TRAFFIC_PAINT_SPECULAR_INTENSITY,
  }));
  const dark = new THREE.MeshPhysicalMaterial({
    name: 'TrafficMicroDirtTrim',
    color: 0x101215,
    roughness: 0.74,
    roughnessMap: micro,
    metalness: 0.12,
    clearcoat: 0.12,
  });
  const resources = {
    micro,
    box: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(1, 12, 7),
    arch: new THREE.TorusGeometry(0.405, 0.052, 6, 13, Math.PI),
    tireGeometry: new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.24, 14, 1),
    rimGeometry: new THREE.CylinderGeometry(0.19, 0.19, 0.252, 10, 1),
    paints,
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x294252,
      metalness: 0.05,
      roughness: 0.12,
      transmission: 0.3,
      transparent: true,
      opacity: 0.82,
      clearcoat: 1,
    }),
    dark,
    tire: new THREE.MeshStandardMaterial({ color: 0x090a0c, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xa9afb2, roughness: 0.25, metalness: 0.92 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc3c9cc, roughness: 0.2, metalness: 0.96 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.88, metalness: 0.03 }),
    indicator: new THREE.MeshStandardMaterial({ color: 0xd86408, emissive: 0xff5a00, emissiveIntensity: 0.18, roughness: 0.26 }),
    headlight: new THREE.MeshStandardMaterial({
      color: ONCOMING_HEADLIGHT_BASE_COLOR,
      emissive: 0xffd69b,
      emissiveIntensity: ONCOMING_HEADLIGHT_EMISSIVE_INTENSITY,
      roughness: 0.15,
    }),
    taillight: new THREE.MeshStandardMaterial({
      color: 0xb30510,
      emissive: 0xff0718,
      emissiveIntensity: 1.9,
      roughness: 0.2,
    }),
  };
  loadTextureGracefully(PAINT_TEXTURE_URL, (texture) => {
    texture.repeat.set(1.4, 2.8);
    texture.colorSpace = THREE.NoColorSpace;
    for (const paint of paints) {
      // The source image is crimson, so using it as albedo would destroy the
      // blue/white/orange traffic palette. It contributes macro roughness only.
      paint.roughnessMap = texture;
      paint.needsUpdate = true;
    }
  });
  loadTextureGracefully(TRIM_TEXTURE_URL, (texture) => {
    texture.repeat.set(2.2, 4.5);
    dark.map = texture;
    dark.needsUpdate = true;
  });
  return resources;
}

function buildTrafficCar(index, resources) {
  const group = new THREE.Group();
  group.name = `OncomingCar${String(index + 1).padStart(2, '0')}`;
  group.rotation.order = 'YXZ';

  const family = TRAFFIC_VEHICLE_FAMILIES[index % TRAFFIC_VEHICLE_FAMILIES.length];
  const { length, width, roofHeight } = family;
  const paint = resources.paints[index % resources.paints.length];
  const wheels = [];
  const detailNames = [];
  const part = (material, position, scale, name) => {
    detailNames.push(name);
    return addBox(group, resources.box, material, position, scale, name);
  };
  const roundedPart = (material, position, scale, name) => {
    detailNames.push(name);
    return addSphere(group, resources.sphere, material, position, scale, name);
  };

  // Every family uses separate lower structure, belt, hood and rear volumes so
  // its sectioned silhouette survives fog, motion blur and the chase camera.
  part(resources.dark, [0, 0.2, 0], [width * 0.98, 0.18, length * 0.94], 'ChassisUndertray');
  part(paint, [0, 0.46, 0], [width, 0.48, length], 'MainBodyShell');
  part(paint, [0, 0.72, -length * 0.34], [width * 0.94, 0.2, length * 0.31], 'SculptedHood');
  part(paint, [0, 0.72, length * 0.39], [width * 0.95, 0.2, length * 0.18], 'RearDeck');
  part(resources.dark, [0, 0.26, -length * 0.505], [width * 0.74, 0.14, 0.095], 'FrontBumperLower');
  part(paint, [0, 0.49, -length * 0.512], [width * 0.94, 0.2, 0.055], 'FrontBumperPainted');
  part(resources.dark, [0, 0.27, length * 0.505], [width * 0.76, 0.15, 0.09], 'RearBumperLower');
  part(paint, [0, 0.5, length * 0.512], [width * 0.93, 0.18, 0.05], 'RearBumperPainted');
  for (const side of [-1, 1]) {
    part(resources.dark, [side * width * 0.49, 0.29, 0], [0.055, 0.16, length * 0.78], `RockerTrim${side}`);
    part(paint, [side * width * 0.505, 0.6, 0], [0.045, 0.22, length * 0.72], `BodyShoulder${side}`);
  }

  const cabinLength = length * family.cabinLength;
  const cabinZ = length * family.cabinZ;
  const cabinHeight = roofHeight - 0.68;
  roundedPart(resources.glass, [0, 0.98 + cabinHeight * 0.12, cabinZ], [width * 0.415, cabinHeight * 0.59, cabinLength * 0.58], 'ContinuousGlasshouse');
  part(paint, [0, roofHeight, cabinZ], [width * 0.7, 0.085, cabinLength * 0.94], 'RoofPanel');
  part(paint, [0, 1.02, cabinZ - cabinLength * 0.16], [width * 0.05, cabinHeight * 0.72, 0.1], 'CentralRoofBow');
  part(resources.interior, [0, 0.86, cabinZ - cabinLength * 0.08], [width * 0.67, 0.12, cabinLength * 0.45], 'DashboardAndSeats');
  for (const side of [-1, 1]) {
    part(paint, [side * width * 0.405, 1.04, cabinZ], [0.055, cabinHeight * 0.72, 0.12], `B-Pillar${side}`);
    part(resources.dark, [side * width * 0.407, 1.04, cabinZ - cabinLength * 0.36], [0.04, cabinHeight * 0.65, 0.055], `A-Pillar${side}`);
    part(resources.dark, [side * width * 0.407, 1.04, cabinZ + cabinLength * 0.36], [0.04, cabinHeight * 0.65, 0.055], `C-Pillar${side}`);
    roundedPart(paint, [side * width * 0.56, 1.0, cabinZ - cabinLength * 0.36], [0.145, 0.075, 0.19], `MirrorHousing${side}`);
    part(resources.glass, [side * width * 0.575, 1.005, cabinZ - cabinLength * 0.37], [0.018, 0.055, 0.12], `MirrorGlass${side}`);
    part(resources.dark, [side * width * 0.512, 0.82, cabinZ], [0.035, 0.045, cabinLength * 0.82], `WindowBeltTrim${side}`);
    part(resources.dark, [side * width * 0.515, 0.65, cabinZ + cabinLength * 0.16], [0.02, 0.055, 0.17], `DoorHandle${side}`);
  }

  // Recognizable family-specific architecture, not merely different scaling.
  if (family.id === 'sedan') {
    part(paint, [0, 0.88, length * 0.35], [width * 0.72, 0.09, length * 0.22], 'SedanSeparateTrunkLid');
    part(resources.chrome, [0, 0.85, length * 0.51], [width * 0.58, 0.035, 0.025], 'SedanRearChromeStrip');
  } else if (family.id === 'hatchback') {
    part(resources.glass, [0, 1.08, length * 0.48], [width * 0.69, 0.5, 0.035], 'HatchVerticalRearWindow');
    part(paint, [0, roofHeight + 0.03, length * 0.42], [width * 0.76, 0.055, 0.25], 'HatchRoofSpoiler');
  } else if (family.id === 'coupe') {
    part(paint, [0, roofHeight - 0.14, cabinZ + cabinLength * 0.46], [width * 0.67, 0.08, cabinLength * 0.42], 'CoupeFastbackSpine');
    part(resources.dark, [0, 0.23, -length * 0.41], [width * 0.82, 0.06, 0.28], 'CoupeFrontSplitter');
  } else if (family.id === 'suv') {
    for (const side of [-1, 1]) part(resources.chrome, [side * width * 0.32, roofHeight + 0.1, cabinZ], [0.035, 0.035, cabinLength * 0.92], `SUVRoofRail${side}`);
    part(resources.dark, [0, 0.4, -length * 0.525], [width * 0.62, 0.2, 0.06], 'SUVSkidPlate');
    part(resources.dark, [0, 0.4, length * 0.525], [width * 0.62, 0.2, 0.06], 'SUVRearSkidPlate');
  } else if (family.id === 'pickup') {
    part(resources.dark, [0, 0.7, length * 0.29], [width * 0.81, 0.08, length * 0.39], 'PickupOpenBedFloor');
    for (const side of [-1, 1]) part(paint, [side * width * 0.43, 0.91, length * 0.29], [0.14, 0.38, length * 0.4], `PickupBedWall${side}`);
    part(paint, [0, 0.9, length * 0.49], [width * 0.92, 0.42, 0.1], 'PickupTailgate');
    part(resources.chrome, [0, 0.68, cabinZ + cabinLength * 0.58], [width * 0.76, 0.045, 0.04], 'PickupCabGuard');
  } else if (family.id === 'van') {
    part(paint, [0, 1.22, length * 0.18], [width * 0.91, 1.0, length * 0.58], 'VanCargoBox');
    for (const side of [-1, 1]) {
      part(resources.dark, [side * width * 0.515, 1.05, length * 0.18], [0.025, 0.045, length * 0.34], `VanSlidingDoorTrack${side}`);
      part(paint, [side * width * 0.505, 1.2, length * 0.48], [0.04, 0.78, 0.045], `VanRearDoorHinge${side}`);
    }
    part(resources.glass, [0, 1.38, -length * 0.46], [width * 0.72, 0.48, 0.035], 'VanPanoramicWindshield');
  }

  part(resources.dark, [0, 0.38, -length * 0.52], [width * 0.66, 0.18, 0.04], 'DeepFrontGrille');
  for (let slat = -2; slat <= 2; slat += 1) {
    part(resources.chrome, [slat * width * 0.07, 0.38, -length * 0.545], [0.018, 0.13, 0.022], `GrilleSlat${slat + 2}`);
  }
  for (const side of [-1, 1]) {
    part(resources.headlight, [side * width * 0.3, 0.63, -length * 0.535], [width * 0.24, 0.14, 0.035], `Headlight${side}`);
    part(resources.indicator, [side * width * 0.43, 0.61, -length * 0.54], [width * 0.06, 0.09, 0.025], `FrontIndicator${side}`);
    part(resources.taillight, [side * width * 0.32, 0.64, length * 0.535], [width * 0.21, 0.14, 0.035], `Taillight${side}`);
    part(resources.indicator, [side * width * 0.43, 0.62, length * 0.54], [width * 0.055, 0.08, 0.025], `RearIndicator${side}`);
  }
  part(resources.chrome, [0, 0.5, length * 0.54], [0.22, 0.11, 0.02], 'RearLicensePlate');

  const axleZ = length * (family.id === 'pickup' ? 0.35 : 0.33);
  for (const z of [-axleZ, axleZ]) {
    for (const side of [-1, 1]) {
      const arch = new THREE.Mesh(resources.arch, paint);
      arch.name = `WheelArch${side}_${z < 0 ? 'Front' : 'Rear'}`;
      arch.position.set(side * width * 0.5, 0.015, z);
      arch.rotation.y = side * Math.PI / 2;
      arch.scale.setScalar(family.wheelScale);
      group.add(arch);
      detailNames.push(arch.name);
      const spin = new THREE.Group();
      spin.name = `WheelAssembly${side}_${z < 0 ? 'Front' : 'Rear'}`;
      spin.position.set(side * width * 0.53, 0, z);
      spin.scale.setScalar(family.wheelScale);
      const tireMesh = new THREE.Mesh(resources.tireGeometry, resources.tire);
      tireMesh.name = 'Tire';
      tireMesh.rotation.z = Math.PI / 2;
      spin.add(tireMesh);
      const rimMesh = new THREE.Mesh(resources.rimGeometry, resources.rim);
      rimMesh.name = 'AlloyRim';
      rimMesh.rotation.z = Math.PI / 2;
      spin.add(rimMesh);
      const hub = new THREE.Mesh(resources.rimGeometry, resources.dark);
      hub.name = 'WheelHub';
      hub.rotation.z = Math.PI / 2;
      hub.scale.set(0.5, 0.52, 0.5);
      spin.add(hub);
      for (let spoke = 0; spoke < 3; spoke += 1) {
        const spokeMesh = new THREE.Mesh(resources.box, resources.chrome);
        spokeMesh.name = `RimSpoke${spoke + 1}`;
        spokeMesh.scale.set(0.035, 0.255, 0.045);
        spokeMesh.rotation.x = spoke * Math.PI / 3;
        spin.add(spokeMesh);
      }
      group.add(spin);
      wheels.push(spin);
      detailNames.push(arch.name, spin.name, 'Tire', 'AlloyRim', 'WheelHub', 'RimSpoke1', 'RimSpoke2', 'RimSpoke3');
    }
  }

  group.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  group.visible = false;
  const meshCount = (() => {
    let count = 0;
    group.traverse((object) => { if (object.isMesh) count += 1; });
    return count;
  })();
  group.userData.trafficFamily = family.id;
  group.userData.trafficFamilyLabel = family.label;
  group.userData.meshCount = meshCount;
  group.userData.detailCount = detailNames.length;

  return {
    group,
    wheels,
    family: family.id,
    meshCount,
    detailCount: detailNames.length,
    active: false,
    routeZ: 0,
    speedMps: 0,
    speedBias: 0,
    lastLongitudinal: null,
    nearMissCounted: false,
    laneOffset: ONCOMING_LANE_OFFSET,
  };
}

export class TrafficSystem {
  constructor(scene, route) {
    this.scene = scene;
    this.route = route;
    this.group = new THREE.Group();
    this.group.name = 'ProceduralOncomingTraffic';
    scene?.add(this.group);

    this.resources = makeSharedResources();
    this.cars = [];
    for (let index = 0; index < TRAFFIC_POOL_SIZE; index += 1) {
      const car = buildTrafficCar(index, this.resources);
      this.cars.push(car);
      this.group.add(car.group);
    }
    this._orderedCars = [...this.cars];

    this.reset();
  }

  reset() {
    this.random = mulberry32(0x28ca75);
    this.spawnSerial = 0;
    this.nearMisses = 0;
    this.difficulty = 0;
    this.lastRhythmBeatKey = null;
    this.waveSerial = 0;
    this.waveHistory = [];
    this.laneSpawnCounts = [0, 0, 0];
    this.rhythmWaveCount = 0;
    this.rhythmCarCount = 0;
    this.skippedRhythmWaves = 0;
    for (const car of this.cars) {
      car.active = false;
      car.group.visible = false;
      car.speedMps = 0;
      car.lastLongitudinal = null;
      car.nearMissCounted = false;
      car.waveId = null;
      car.rhythmBeatKey = null;
    }
  }

  get rhythmStats() {
    return Object.freeze({
      waves: this.rhythmWaveCount,
      cars: this.rhythmCarCount,
      skippedWaves: this.skippedRhythmWaves,
      laneSpawnCounts: Object.freeze([...this.laneSpawnCounts]),
      recentWaves: Object.freeze(this.waveHistory.map((wave) => Object.freeze({
        ...wave,
        lanes: Object.freeze([...wave.lanes]),
        longitudinalOffsets: Object.freeze([...wave.longitudinalOffsets]),
      }))),
      poolSize: this.cars.length,
    });
  }

  _activeCount() {
    let count = 0;
    for (const car of this.cars) if (car.active) count += 1;
    return count;
  }

  _longitudinalAndLateral(car, playerPosition) {
    const heading = this.route.roadHeadingAt(car.routeZ);
    const dx = car.group.position.x - playerPosition.x;
    const dz = car.group.position.z - playerPosition.z;
    const alongX = -Math.sin(heading);
    const alongZ = -Math.cos(heading);
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);
    return {
      longitudinal: dx * alongX + dz * alongZ,
      lateral: dx * rightX + dz * rightZ,
    };
  }

  _placeCar(car) {
    const heading = this.route.roadHeadingAt(car.routeZ);
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);
    car.group.position.set(
      this.route.roadXAt(car.routeZ) + rightX * car.laneOffset,
      this.route.roadYAt(car.routeZ) + WHEEL_RADIUS + 0.035,
      car.routeZ + rightZ * car.laneOffset,
    );

    const sample = 1.6;
    const slope = Math.atan2(
      this.route.roadYAt(car.routeZ + sample) - this.route.roadYAt(car.routeZ - sample),
      sample * 2,
    );
    car.group.rotation.set(slope, heading + Math.PI, 0, 'YXZ');
  }

  _spawnOne(playerPosition, difficulty, options = {}) {
    const car = this.cars.find((candidate) => !candidate.active);
    if (!car) return false;

    const minimumSpacing = THREE.MathUtils.lerp(25, 11.5, difficulty);
    const laneOffset = Number.isFinite(options.laneOffset) ? options.laneOffset : null;
    let candidateZ = 0;
    let found = false;
    const laneHasSpace = (z) => this.cars.every((other) => (
      !other.active
      || laneOffset === null
      || Math.abs(other.laneOffset - laneOffset) > 0.1
      || Math.abs(other.routeZ - z) >= minimumSpacing
    ));
    if (Number.isFinite(options.distance)) {
      candidateZ = playerPosition.z - THREE.MathUtils.clamp(options.distance, SPAWN_NEAR, SPAWN_FAR);
      found = laneHasSpace(candidateZ);
    }
    for (let attempt = 0; attempt < 36; attempt += 1) {
      if (found) break;
      const distance = THREE.MathUtils.lerp(SPAWN_NEAR, SPAWN_FAR, this.random());
      candidateZ = playerPosition.z - distance;
      found = laneOffset === null
        ? this.cars.every((other) => !other.active || Math.abs(other.routeZ - candidateZ) >= minimumSpacing)
        : laneHasSpace(candidateZ);
      if (found) break;
    }

    if (!found) {
      // Deterministic fallback fills the longest available part of the spawn
      // corridor without ever stacking two cars into an impossible start.
      for (let distance = SPAWN_NEAR; distance <= SPAWN_FAR; distance += minimumSpacing) {
        candidateZ = playerPosition.z - distance;
        found = laneOffset === null
          ? this.cars.every((other) => !other.active || Math.abs(other.routeZ - candidateZ) >= minimumSpacing)
          : laneHasSpace(candidateZ);
        if (found) break;
      }
    }
    if (!found) return false;

    car.active = true;
    car.group.visible = true;
    car.routeZ = candidateZ;
    car.speedBias = this.random();
    this.spawnSerial += 1;
    if (laneOffset !== null) {
      car.laneOffset = laneOffset;
    } else {
      // Legacy no-radio simulations retain their original two-column hazard
      // cadence. Live gameplay supplies rhythmState and uses all three lanes.
      const hazardEvery = difficulty > 0.55 ? 2 : 3;
      car.laneOffset = this.spawnSerial % hazardEvery === 0 ? LEGACY_LANE_CENTERS[1] : LEGACY_LANE_CENTERS[0];
    }
    const minimumSpeed = 16 + difficulty * 3;
    const maximumSpeed = 20 + difficulty * 11;
    car.speedMps = THREE.MathUtils.lerp(minimumSpeed, maximumSpeed, car.speedBias);
    car.lastLongitudinal = null;
    car.nearMissCounted = false;
    car.waveId = options.waveId ?? null;
    car.rhythmBeatKey = options.rhythmBeatKey ?? null;
    this._placeCar(car);
    return true;
  }

  _spawnRhythmWave(playerPosition, rhythm) {
    const beatIndex = Math.floor(rhythm.sixteenthStep / 4);
    const patternBeat = beatIndex % rhythm.pattern.cycle;
    if (!rhythm.pattern.beats.includes(patternBeat)) return false;

    const desiredActive = Math.min(TRAFFIC_POOL_SIZE, Math.round(8 + this.difficulty * 13));
    if (this._activeCount() >= desiredActive) {
      this.skippedRhythmWaves += 1;
      return false;
    }

    const waveId = this.waveSerial;
    this.waveSerial += 1;
    const doubleWave = rhythm.pattern.doubles.includes(patternBeat) && desiredActive - this._activeCount() >= 2;
    const safeLaneIndex = (beatIndex + rhythm.pattern.laneShift + rhythm.transition) % RHYTHM_LANE_CENTERS.length;
    const availableLaneIndices = [0, 1, 2].filter((index) => index !== safeLaneIndex);
    if (!doubleWave && hashUnit(beatIndex, rhythm.pattern.laneShift + rhythm.transition * 17) > 0.5) {
      availableLaneIndices.reverse();
    }
    const laneIndices = availableLaneIndices.slice(0, doubleWave ? 2 : 1);
    const baseDistance = THREE.MathUtils.lerp(
      SPAWN_NEAR + 22,
      SPAWN_FAR - 18,
      hashUnit(beatIndex + rhythm.transition * 131, rhythm.pattern.laneShift * 97 + 11),
    );
    const longitudinalOffsets = [];
    const spawnedLanes = [];
    for (let index = 0; index < laneIndices.length; index += 1) {
      const laneIndex = laneIndices[index];
      // A small deterministic humanizing offset keeps the arrivals musical
      // without looking mechanically welded to an invisible grid.
      const jitter = (hashUnit(beatIndex * 7 + laneIndex, rhythm.pattern.laneShift * 37 + 5) - 0.5) * 4.8;
      const spawned = this._spawnOne(playerPosition, this.difficulty, {
        laneOffset: RHYTHM_LANE_CENTERS[laneIndex],
        distance: baseDistance + jitter,
        waveId,
        rhythmBeatKey: this.lastRhythmBeatKey,
      });
      if (!spawned) continue;
      longitudinalOffsets.push(Number(jitter.toFixed(3)));
      spawnedLanes.push(RHYTHM_LANE_CENTERS[laneIndex]);
      this.laneSpawnCounts[laneIndex] += 1;
      this.rhythmCarCount += 1;
    }
    if (spawnedLanes.length === 0) {
      this.skippedRhythmWaves += 1;
      return false;
    }

    this.rhythmWaveCount += 1;
    this.waveHistory.push({
      waveId,
      beatKey: this.lastRhythmBeatKey,
      songId: rhythm.songId,
      bpm: rhythm.bpm,
      beatIndex,
      schedulerTime: rhythm.schedulerTime,
      lanes: spawnedLanes,
      safeLane: RHYTHM_LANE_CENTERS[safeLaneIndex],
      longitudinalOffsets,
    });
    if (this.waveHistory.length > MAX_WAVE_HISTORY) this.waveHistory.shift();
    return true;
  }

  update(dt, playerVehicle, totalDistance = 0, rhythmSnapshot = null) {
    const playerPosition = playerVehicle?.group?.position;
    if (!playerPosition || !Number.isFinite(dt) || dt < 0) {
      return { collision: false, nearMisses: this.nearMisses, active: this._activeCount(), difficulty: this.difficulty };
    }
    dt = Math.min(dt, 0.05);
    this.difficulty = THREE.MathUtils.clamp((Number(totalDistance) || 0) / 1800, 0, 1);
    const rhythm = normalizeRhythmState(rhythmSnapshot);
    if (rhythm) {
      const beatIndex = Math.floor(rhythm.sixteenthStep / 4);
      const beatKey = `${rhythm.songId}:${rhythm.transition}:${beatIndex}`;
      if (beatKey !== this.lastRhythmBeatKey) {
        this.lastRhythmBeatKey = beatKey;
        this._spawnRhythmWave(playerPosition, rhythm);
      }
    } else {
      // Keep the earlier autonomous fill behavior for callers that do not own
      // a radio (tests, embeds, and future accessibility modes).
      const desiredActive = Math.min(14, Math.round(5 + this.difficulty * 9));
      while (this._activeCount() < desiredActive) {
        if (!this._spawnOne(playerPosition, this.difficulty)) break;
      }
    }

    let collision = false;
    this._orderedCars.sort((a, b) => b.routeZ - a.routeZ);
    const precedingRouteZByLane = new Map();
    for (const car of this._orderedCars) {
      if (!car.active) continue;

      const minimumSpeed = 16 + this.difficulty * 3;
      const maximumSpeed = 20 + this.difficulty * 11;
      const targetSpeed = THREE.MathUtils.lerp(minimumSpeed, maximumSpeed, car.speedBias);
      car.speedMps = THREE.MathUtils.damp(car.speedMps, targetSpeed, 0.8, dt);
      const previousRouteZ = car.routeZ;
      car.routeZ += car.speedMps * dt;
      const laneKey = car.laneOffset.toFixed(2);
      const precedingRouteZ = precedingRouteZByLane.get(laneKey);
      if (Number.isFinite(precedingRouteZ)) {
        car.routeZ = Math.min(car.routeZ, precedingRouteZ - MIN_TRAFFIC_GAP);
        if (dt > 0) car.speedMps = Math.max(0, (car.routeZ - previousRouteZ) / dt);
      }
      precedingRouteZByLane.set(laneKey, car.routeZ);
      this._placeCar(car);
      const wheelStep = -car.speedMps * dt / WHEEL_RADIUS;
      for (const wheel of car.wheels) wheel.rotation.x += wheelStep;

      const separation = this._longitudinalAndLateral(car, playerPosition);
      const absLongitudinal = Math.abs(separation.longitudinal);
      const absLateral = Math.abs(separation.lateral);
      const verticalGap = Math.abs(car.group.position.y - playerPosition.y);

      if (absLongitudinal < COLLISION_HALF_LENGTH && absLateral < COLLISION_HALF_WIDTH && verticalGap < 1.35) {
        collision = true;
        car.active = false;
        car.group.visible = false;
        continue;
      }

      const justPassed = car.lastLongitudinal !== null
        && car.lastLongitudinal > 0
        && separation.longitudinal <= 0;
      if (
        justPassed
        && !car.nearMissCounted
        && absLateral >= COLLISION_HALF_WIDTH
        && absLateral < NEAR_MISS_WIDTH
        && verticalGap < 1.5
      ) {
        car.nearMissCounted = true;
        this.nearMisses += 1;
      }
      car.lastLongitudinal = separation.longitudinal;

      if (separation.longitudinal < -DESPAWN_BEHIND) {
        car.active = false;
        car.group.visible = false;
      }
    }

    return {
      collision,
      nearMisses: this.nearMisses,
      active: this._activeCount(),
      difficulty: this.difficulty,
      rhythm: rhythm ? this.rhythmStats : null,
    };
  }

  handleRouteRecycle(deltaZ) {
    if (!Number.isFinite(deltaZ) || deltaZ === 0) return;
    for (const car of this.cars) {
      if (!car.active) continue;
      car.routeZ += deltaZ;
      car.group.position.z += deltaZ;
      car.lastLongitudinal = null;
    }
  }

  dispose() {
    this.scene?.remove?.(this.group);
    this.group.clear();
    const disposedTextures = new Set();
    const disposedMaterials = new Set();
    const disposeMaterial = (material) => {
      if (!material || disposedMaterials.has(material)) return;
      disposedMaterials.add(material);
      for (const key of ['map', 'bumpMap', 'roughnessMap', 'normalMap', 'metalnessMap']) {
        const texture = material[key];
        if (texture && !disposedTextures.has(texture)) {
          disposedTextures.add(texture);
          texture.dispose?.();
        }
      }
      material.dispose?.();
    };
    for (const value of Object.values(this.resources)) {
      if (Array.isArray(value)) value.forEach(disposeMaterial);
      else if (value?.isMaterial) disposeMaterial(value);
      else if (value?.isTexture && !disposedTextures.has(value)) {
        disposedTextures.add(value);
        value.dispose?.();
      } else if (value?.isBufferGeometry) value.dispose();
    }
    this.cars.length = 0;
    this._orderedCars.length = 0;
    this.waveHistory.length = 0;
  }
}
