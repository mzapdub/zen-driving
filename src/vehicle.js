import * as THREE from 'three';

const WHEEL_RADIUS = 0.39;
const WHEELBASE = 2.81;
const FRONT_AXLE = 1.42;
const REAR_AXLE = WHEELBASE - FRONT_AXLE;
const SPAWN_Z = 285;
const PAINT_TEXTURE_URL = new URL('../assets/vehicle-paint-ai.png', import.meta.url).href;
const TRIM_TEXTURE_URL = new URL('../assets/vehicle-trim-ai.png', import.meta.url).href;

export const VEHICLE_TYPES = Object.freeze({
  sports_wagon: { label: 'Sports wagon', description: 'Stable and fast' },
  rally_coupe: { label: 'Rally coupe', description: 'Low and aggressive' },
  motorbike: { label: 'Motorbike', description: 'Narrow and exposed' },
});

export const PAINT_COLORS = Object.freeze({
  crimson: { label: 'Crimson', value: 0xb30b18 },
  electric_blue: { label: 'Electric blue', value: 0x176bd1 },
  forest_green: { label: 'Forest green', value: 0x1d6b42 },
  sunset_orange: { label: 'Sunset orange', value: 0xe56622 },
  pearl_white: { label: 'Pearl white', value: 0xe8e5dc },
  midnight_black: { label: 'Midnight black', value: 0x11151b },
});

export function normalizeVehicleSelection(selection = {}) {
  const vehicleType = Object.hasOwn(VEHICLE_TYPES, selection.vehicleType)
    ? selection.vehicleType
    : 'sports_wagon';
  const paintColor = Object.hasOwn(PAINT_COLORS, selection.paintColor)
    ? selection.paintColor
    : 'crimson';
  return { vehicleType, paintColor };
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function approach(value, target, amount) {
  if (value < target) return Math.min(value + amount, target);
  return Math.max(value - amount, target);
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function makeMicroTexture(seed = 1, repeat = [8, 14], contrast = 1, base = 128) {
  const size = 48;
  const data = new Uint8Array(size * size * 4);
  let state = seed >>> 0;
  for (let index = 0; index < size * size; index += 1) {
    state = Math.imul(state ^ state >>> 15, 1 | state);
    state ^= state + Math.imul(state ^ state >>> 7, 61 | state);
    const raw = 105 + ((state ^ state >>> 14) & 63);
    const grain = THREE.MathUtils.clamp(Math.round(base + (raw - 128) * contrast), 0, 255);
    const offset = index * 4;
    data[offset] = grain;
    data[offset + 1] = grain;
    data[offset + 2] = grain;
    data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.needsUpdate = true;
  return texture;
}

function labelLayeredMaterial(material, surface, macro, mid, fine) {
  material.userData.surface = surface;
  material.userData.layerStack = Object.freeze({
    macro: macro || 'base color',
    mid: mid || 'roughness and wear breakup',
    fine: fine || 'micro bump detail',
  });
  return material;
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
    // Procedural color/micro layers remain valid if a browser blocks the image.
  }
}

function addQuad(indices, a, b, c, d) {
  indices.push(a, b, d, b, c, d);
}

function makeSectionHull(sections) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    const v = sectionIndex / Math.max(1, sections.length - 1);
    positions.push(
      -section.bottomHalf, section.bottomY, section.z,
      section.bottomHalf, section.bottomY, section.z,
      section.topHalf, section.topY, section.z,
      -section.topHalf, section.topY, section.z,
    );
    uvs.push(0, v, 1, v, 1, v, 0, v);
  }
  for (let index = 0; index < sections.length - 1; index += 1) {
    const a = index * 4;
    const b = a + 4;
    addQuad(indices, a, a + 1, b + 1, b);
    addQuad(indices, a + 3, b + 3, b + 2, a + 2);
    addQuad(indices, a, b, b + 3, a + 3);
    addQuad(indices, a + 1, a + 2, b + 2, b + 1);
  }
  addQuad(indices, 0, 3, 2, 1);
  const end = (sections.length - 1) * 4;
  addQuad(indices, end, end + 1, end + 2, end + 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function box(parent, geometry, material, position, scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function ellipsoid(parent, geometry, material, position, scale = [1, 1, 1]) {
  return box(parent, geometry, material, position, scale);
}

function tubeBetween(parent, material, start, end, radius = 0.05, radialSegments = 10) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const direction = b.clone().sub(a);
  const length = direction.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  parent.add(mesh);
  return mesh;
}

export class ArcadeVehicle {
  static defaultSelection = normalizeVehicleSelection();

  static setDefaultSelection(selection) {
    ArcadeVehicle.defaultSelection = normalizeVehicleSelection(selection);
    return { ...ArcadeVehicle.defaultSelection };
  }

  constructor(scene, selection = ArcadeVehicle.defaultSelection) {
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';

    this.velocity = new THREE.Vector3();
    this.speedMps = 0;
    this.lateralSpeed = 0;
    this.heading = 0;
    this.steer = 0;
    this.yawVelocity = 0;
    this.slipAngle = 0;
    this.driftAmount = 0;
    this.isDrifting = false;
    this.driftScore = 0;
    this.driftMultiplier = 1;
    this.boostAmount = 1;
    this.boosting = false;
    this._boostRechargeDelay = 0;

    this._pitch = 0;
    this._roll = 0;
    this._wheelSpin = [];
    this._frontSteer = [];
    this._rearWheelPivots = [];
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._modelRoot = null;
    this._paintMaterials = [];
    this._buildRevision = 0;
    this.selection = normalizeVehicleSelection(selection);

    this._buildSelectedVehicle();
    scene?.add(this.group);
  }

  getSelection() {
    return { ...this.selection };
  }

  applySelection(selection = {}) {
    const next = normalizeVehicleSelection({ ...this.selection, ...selection });
    if (next.vehicleType === this.selection.vehicleType && next.paintColor === this.selection.paintColor) {
      return this.getSelection();
    }
    const typeChanged = next.vehicleType !== this.selection.vehicleType;
    this.selection = next;
    if (typeChanged) this._buildSelectedVehicle();
    else this._applyPaintColor();
    return this.getSelection();
  }

  _buildSelectedVehicle() {
    this._buildRevision += 1;
    this._clearModel();
    this._modelRoot = new THREE.Group();
    this._modelRoot.name = `VehicleModel_${this.selection.vehicleType}`;
    this.group.add(this._modelRoot);
    this._wheelSpin = [];
    this._frontSteer = [];
    this._rearWheelPivots = [];
    const materials = this._createMaterials(this._buildRevision);
    if (this.selection.vehicleType === 'rally_coupe') this._buildRallyCoupe(materials);
    else if (this.selection.vehicleType === 'motorbike') this._buildMotorbike(materials);
    else this._buildSportsWagon(materials);
    this.group.name = `ProceduralPlayer_${this.selection.vehicleType}_${this.selection.paintColor}`;
    this._modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
  }

  _clearModel() {
    if (!this._modelRoot) return;
    this._modelRoot.removeFromParent();
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    this._modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      if (object.geometry) geometries.add(object.geometry);
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) {
        if (!material) continue;
        materials.add(material);
        for (const key of ['map', 'roughnessMap', 'bumpMap', 'normalMap']) {
          if (material[key]?.isTexture) textures.add(material[key]);
        }
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    this._modelRoot = null;
    this._paintMaterials = [];
  }

  _createMaterials(revision) {
    const macro = makeMicroTexture(0x41a7, [0.65, 1.2], 0.18, 235);
    macro.colorSpace = THREE.SRGBColorSpace;
    macro.name = 'VehicleMacroAlbedo';
    const mid = makeMicroTexture(0x7351, [3.5, 6.5], 0.62);
    mid.name = 'VehicleMidscaleWearRoughness';
    const fine = makeMicroTexture(0xc921, [24, 38], 0.34);
    fine.name = 'VehicleFineSurfaceBump';
    const rubberFine = makeMicroTexture(0x9d13, [18, 30], 0.9);
    rubberFine.name = 'VehicleRubberFineBump';

    const paint = labelLayeredMaterial(new THREE.MeshPhysicalMaterial({
      name: 'ThreeLayerPaintBase',
      color: PAINT_COLORS[this.selection.paintColor].value,
      map: macro,
      metalness: 0.46,
      roughness: 0.24,
      roughnessMap: mid,
      bumpMap: fine,
      bumpScale: 0.018,
      clearcoat: 1,
      clearcoatRoughness: 0.075,
      sheen: 0.12,
      sheenColor: new THREE.Color(PAINT_COLORS[this.selection.paintColor].value).offsetHSL(0, 0.05, 0.16),
    }), 'automotive paint', 'paint color and broad panel tonality', 'orange peel, road film and wear', 'microflake and clearcoat texture');
    const paintHighlight = paint.clone();
    paintHighlight.name = 'ThreeLayerPaintHighlight';
    paintHighlight.roughness = 0.2;
    const paintDark = paint.clone();
    paintDark.name = 'ThreeLayerPaintShadow';
    paintDark.roughness = 0.34;
    this._paintMaterials = [paint, paintHighlight, paintDark];
    this._applyPaintColor();
    const dirtTrim = labelLayeredMaterial(new THREE.MeshPhysicalMaterial({
      name: 'MicroGrainDirtTrim',
      color: 0x15171a,
      roughness: 0.72,
      map: macro,
      roughnessMap: mid,
      bumpMap: fine,
      bumpScale: 0.04,
      metalness: 0.09,
      clearcoat: 0.16,
    }), 'exterior polymer trim', 'charcoal polymer tone', 'road dirt and scuff roughness', 'molded grain bump');
    loadTextureGracefully(PAINT_TEXTURE_URL, (texture) => {
      if (revision !== this._buildRevision || !this._modelRoot) {
        texture.dispose();
        return;
      }
      texture.repeat.set(1.6, 3.4);
      for (const material of this._paintMaterials) {
        material.bumpMap = texture;
        material.needsUpdate = true;
      }
    });
    loadTextureGracefully(TRIM_TEXTURE_URL, (texture) => {
      if (revision !== this._buildRevision || !this._modelRoot) {
        texture.dispose();
        return;
      }
      texture.repeat.set(2.5, 5);
      dirtTrim.map = texture;
      dirtTrim.bumpMap = texture;
      dirtTrim.needsUpdate = true;
    });

    const glass = labelLayeredMaterial(new THREE.MeshPhysicalMaterial({
      name: 'LayeredAutomotiveGlass',
      color: 0x183746,
      roughness: 0.08,
      roughnessMap: mid,
      bumpMap: fine,
      bumpScale: 0.002,
      metalness: 0.05,
      transmission: 0.58,
      thickness: 0.1,
      ior: 1.5,
      transparent: true,
      opacity: 0.72,
      clearcoat: 1,
      clearcoatRoughness: 0.035,
    }), 'laminated glass', 'smoked blue-green tint', 'wiper haze and smudge roughness', 'fine glass waviness');
    const tire = labelLayeredMaterial(new THREE.MeshStandardMaterial({
      name: 'LayeredTireRubber', color: 0x090a0c, roughness: 0.94,
      roughnessMap: mid, bumpMap: rubberFine, bumpScale: 0.085,
    }), 'tire rubber', 'carbon-black base', 'shoulder wear roughness', 'tread and molded rubber grain');
    const rim = labelLayeredMaterial(new THREE.MeshPhysicalMaterial({
      name: 'LayeredForgedAlloy', color: 0xb2b9be, metalness: 0.96, roughness: 0.18,
      roughnessMap: mid, bumpMap: fine, bumpScale: 0.008, clearcoat: 0.42, clearcoatRoughness: 0.12,
    }), 'forged wheel alloy', 'machined aluminum tone', 'brake-dust roughness', 'fine machining bump');
    const interior = labelLayeredMaterial(new THREE.MeshStandardMaterial({
      name: 'LayeredCabinPolymer', color: 0x171416, roughness: 0.78,
      map: macro, roughnessMap: mid, bumpMap: fine, bumpScale: 0.045,
    }), 'cabin polymer', 'dark molded panels', 'touch wear roughness', 'fine molded grain');
    const lampWhite = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd897, emissiveIntensity: 3.2, roughness: 0.18 });
    const lampRed = new THREE.MeshStandardMaterial({ color: 0xb4000c, emissive: 0xff0818, emissiveIntensity: 2.6, roughness: 0.2 });
    const indicator = new THREE.MeshStandardMaterial({ color: 0xff8a16, emissive: 0xff5b00, emissiveIntensity: 1.6 });
    const chrome = labelLayeredMaterial(new THREE.MeshPhysicalMaterial({
      name: 'LayeredBrushedMetal', color: 0xcbd1d4, metalness: 1, roughness: 0.12,
      roughnessMap: mid, bumpMap: fine, bumpScale: 0.006, clearcoat: 0.6, clearcoatRoughness: 0.08,
    }), 'brushed metal', 'bright metal tone', 'machining and oxidation roughness', 'hairline brushing bump');
    const leather = labelLayeredMaterial(new THREE.MeshStandardMaterial({
      name: 'LayeredCabinLeather', color: 0x211b19, roughness: 0.86,
      map: macro, roughnessMap: mid, bumpMap: fine, bumpScale: 0.055,
    }), 'upholstery leather', 'dyed hide variation', 'contact wear roughness', 'fine hide grain');
    const brake = labelLayeredMaterial(new THREE.MeshPhysicalMaterial({
      name: 'LayeredBrakeSteel', color: 0x787d80, metalness: 0.94, roughness: 0.32,
      roughnessMap: mid, bumpMap: fine, bumpScale: 0.012,
    }), 'brake steel', 'heat-darkened metal', 'pad track wear', 'cross-hatched disc grain');
    const caliper = labelLayeredMaterial(new THREE.MeshPhysicalMaterial({
      name: 'LayeredCaliperPaint', color: 0xb30b18, metalness: 0.52, roughness: 0.3,
      roughnessMap: mid, bumpMap: fine, bumpScale: 0.012, clearcoat: 0.65,
    }), 'brake caliper', 'red heat-resistant coating', 'brake dust roughness', 'cast metal fine bump');
    const sharedBox = new THREE.BoxGeometry(1, 1, 1);
    const sharedSphere = new THREE.SphereGeometry(1, 14, 8);

    return {
      paint, paintHighlight, paintDark, dirtTrim, glass, tire, rim, interior,
      lampWhite, lampRed, indicator, chrome, leather, brake, caliper, sharedBox, sharedSphere,
    };
  }

  _applyPaintColor() {
    if (!this._paintMaterials.length) return;
    const base = new THREE.Color(PAINT_COLORS[this.selection.paintColor].value);
    this._paintMaterials[0].color.copy(base);
    this._paintMaterials[0].sheenColor.copy(base).offsetHSL(0, 0.08, 0.18);
    this._paintMaterials[1].color.copy(base).offsetHSL(0, 0.03, 0.105);
    this._paintMaterials[1].sheenColor.copy(base).offsetHSL(0, 0.05, 0.22);
    this._paintMaterials[2].color.copy(base).offsetHSL(0, 0.02, -0.09);
    this._paintMaterials[2].sheenColor.copy(base).offsetHSL(0, 0.04, 0.08);
    for (const material of this._paintMaterials) material.needsUpdate = true;
    this.group.name = `ProceduralPlayer_${this.selection.vehicleType}_${this.selection.paintColor}`;
  }

  _buildSportsWagon(materials) {
    const {
      paint, paintHighlight, dirtTrim, glass, rim, interior, chrome, leather,
      lampWhite, lampRed, indicator, sharedBox, sharedSphere,
    } = materials;

    const bodyGeometry = makeSectionHull([
      { z: -2.3, bottomY: 0.06, topY: 0.5, bottomHalf: 0.68, topHalf: 0.75 },
      { z: -2.0, bottomY: 0.02, topY: 0.72, bottomHalf: 0.9, topHalf: 0.9 },
      { z: -0.74, bottomY: 0, topY: 0.83, bottomHalf: 0.99, topHalf: 0.95 },
      { z: 1.23, bottomY: 0, topY: 0.87, bottomHalf: 0.99, topHalf: 0.95 },
      { z: 2.08, bottomY: 0.04, topY: 0.74, bottomHalf: 0.89, topHalf: 0.91 },
      { z: 2.24, bottomY: 0.13, topY: 0.59, bottomHalf: 0.74, topHalf: 0.78 },
    ]);
    this._modelRoot.add(new THREE.Mesh(bodyGeometry, paint));
    box(this._modelRoot, sharedBox, dirtTrim, [0, 0.16, 0.04], [1.96, 0.22, 4.27]);
    box(this._modelRoot, sharedBox, paintHighlight, [0, 0.82, -1.31], [1.78, 0.09, 1.36]);
    box(this._modelRoot, sharedBox, paintHighlight, [0, 0.87, 1.58], [1.82, 0.1, 0.92]);

    const cabinGeometry = makeSectionHull([
      { z: -0.9, bottomY: 0.79, topY: 1.18, bottomHalf: 0.82, topHalf: 0.64 },
      { z: -0.5, bottomY: 0.81, topY: 1.5, bottomHalf: 0.84, topHalf: 0.68 },
      { z: 0.85, bottomY: 0.84, topY: 1.48, bottomHalf: 0.85, topHalf: 0.7 },
      { z: 1.43, bottomY: 0.83, topY: 1.25, bottomHalf: 0.84, topHalf: 0.7 },
    ]);
    this._modelRoot.add(new THREE.Mesh(cabinGeometry, glass));
    box(this._modelRoot, sharedBox, paint, [0, 1.51, 0.2], [1.42, 0.09, 1.46]);
    for (const side of [-1, 1]) {
      box(this._modelRoot, sharedBox, paint, [side * 0.74, 1.18, 0.28], [0.075, 0.69, 0.09]);
      box(this._modelRoot, sharedBox, paint, [side * 0.78, 1.13, 1.13], [0.075, 0.54, 0.09]);
      const mirror = box(this._modelRoot, sharedSphere, paint, [side * 1.04, 1.04, -0.48], [0.19, 0.1, 0.25]);
      mirror.rotation.z = side * -0.08;
      box(this._modelRoot, sharedBox, glass, [side * 1.045, 1.075, -0.51], [0.22, 0.07, 0.14]);
    }

    // Visible cabin furniture reads through the glass instead of leaving a
    // hollow blue shell.
    box(this._modelRoot, sharedBox, interior, [0, 0.93, -0.58], [1.5, 0.17, 0.34]);
    for (const side of [-1, 1]) {
      box(this._modelRoot, sharedBox, interior, [side * 0.39, 0.91, 0.18], [0.46, 0.5, 0.5]);
      box(this._modelRoot, sharedSphere, interior, [side * 0.39, 1.27, 0.25], [0.2, 0.22, 0.15]);
      const seatBolster = box(this._modelRoot, sharedBox, leather, [side * 0.39, 1.01, 0.18], [0.39, 0.08, 0.52]);
      seatBolster.name = 'LeatherSeatBolster';
      const doorCard = box(this._modelRoot, sharedBox, interior, [side * 0.77, 1.03, 0.22], [0.035, 0.3, 1.05]);
      doorCard.name = 'LayeredDoorCard';
    }
    const dashboard = box(this._modelRoot, sharedBox, interior, [0, 1.08, -0.69], [1.44, 0.18, 0.27]);
    dashboard.name = 'SculptedDashboard';
    const consoleBridge = box(this._modelRoot, sharedBox, leather, [0, 0.92, 0.18], [0.24, 0.18, 0.96]);
    consoleBridge.name = 'CenterConsole';
    const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 20), leather);
    steeringWheel.name = 'SteeringWheel';
    steeringWheel.position.set(-0.39, 1.19, -0.54);
    steeringWheel.rotation.x = Math.PI * 0.44;
    this._modelRoot.add(steeringWheel);
    for (const gaugeX of [-0.48, -0.3]) {
      const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.018, 16), chrome);
      gauge.name = 'InstrumentGauge';
      gauge.position.set(gaugeX, 1.18, -0.83);
      gauge.rotation.x = Math.PI / 2;
      this._modelRoot.add(gauge);
    }

    // Fascia, grille slats, lamps, splitter, diffuser, exhaust and spoiler.
    box(this._modelRoot, sharedBox, dirtTrim, [0, 0.28, -2.29], [1.64, 0.25, 0.16]);
    box(this._modelRoot, sharedBox, dirtTrim, [0, 0.28, 2.24], [1.68, 0.27, 0.15]);
    box(this._modelRoot, sharedBox, dirtTrim, [0, 0.49, -2.38], [0.82, 0.2, 0.025]);
    for (let slat = -2; slat <= 2; slat += 1) box(this._modelRoot, sharedBox, rim, [slat * 0.13, 0.49, -2.4], [0.025, 0.17, 0.025]);
    for (const side of [-1, 1]) {
      box(this._modelRoot, sharedBox, lampWhite, [side * 0.58, 0.65, -2.31], [0.47, 0.18, 0.06]);
      box(this._modelRoot, sharedBox, indicator, [side * 0.85, 0.57, -2.26], [0.12, 0.12, 0.07]);
      box(this._modelRoot, sharedBox, lampRed, [side * 0.65, 0.72, 2.23], [0.43, 0.2, 0.06]);
      box(this._modelRoot, new THREE.CylinderGeometry(0.09, 0.09, 0.13, 10), dirtTrim, [side * 0.49, 0.24, 2.36]).rotation.x = Math.PI / 2;
    }
    box(this._modelRoot, sharedBox, paint, [0, 1.25, 1.55], [1.55, 0.08, 0.42]);
    for (const side of [-1, 1]) {
      const rail = tubeBetween(this._modelRoot, chrome, [side * 0.58, 1.55, -0.6], [side * 0.58, 1.56, 1.2], 0.025, 8);
      rail.name = 'RoofRail';
      for (const z of [-0.82, 0.78]) {
        const doorSeam = box(this._modelRoot, sharedBox, dirtTrim, [side * 0.992, 0.82, z], [0.012, 0.48, 0.018]);
        doorSeam.name = 'DoorShutLine';
      }
      for (const z of [-0.38, 0.72]) {
        const handle = box(this._modelRoot, sharedBox, chrome, [side * 1.01, 0.92, z], [0.025, 0.035, 0.2]);
        handle.name = 'DoorHandle';
      }
    }
    for (const x of [-0.43, 0.43]) {
      const wiper = box(this._modelRoot, sharedBox, dirtTrim, [x, 1.16, -0.94], [0.025, 0.025, 0.64]);
      wiper.name = 'WindshieldWiper';
      wiper.rotation.x = -0.58;
      wiper.rotation.z = x * 0.22;
    }
    const antenna = tubeBetween(this._modelRoot, dirtTrim, [0.42, 1.56, 1.05], [0.42, 1.81, 1.2], 0.012, 6);
    antenna.name = 'RoofAntenna';

    const archGeometry = new THREE.TorusGeometry(0.48, 0.075, 7, 18, Math.PI);
    for (const side of [-1, 1]) {
      for (const z of [-FRONT_AXLE, REAR_AXLE]) {
        const arch = new THREE.Mesh(archGeometry, paintHighlight);
        arch.position.set(side * 0.985, 0.02, z);
        arch.rotation.y = side * Math.PI / 2;
        this._modelRoot.add(arch);
      }
    }
    this._addCarWheels(materials, 0.97, FRONT_AXLE, REAR_AXLE, WHEEL_RADIUS);
  }

  _buildRallyCoupe(materials) {
    const { paint, paintHighlight, paintDark, dirtTrim, glass, rim, interior, chrome, leather, lampWhite, lampRed, indicator, sharedBox, sharedSphere } = materials;
    const root = this._modelRoot;
    const body = makeSectionHull([
      { z: -2.27, bottomY: 0.05, topY: 0.45, bottomHalf: 0.62, topHalf: 0.7 },
      { z: -1.82, bottomY: 0, topY: 0.66, bottomHalf: 0.98, topHalf: 0.94 },
      { z: -0.55, bottomY: -0.01, topY: 0.74, bottomHalf: 1.02, topHalf: 0.93 },
      { z: 1.25, bottomY: 0, topY: 0.71, bottomHalf: 1.03, topHalf: 0.95 },
      { z: 2.1, bottomY: 0.08, topY: 0.56, bottomHalf: 0.91, topHalf: 0.82 },
    ]);
    root.add(new THREE.Mesh(body, paint));
    box(root, sharedBox, dirtTrim, [0, 0.14, 0.02], [2.02, 0.19, 4.18]);
    box(root, sharedBox, paintHighlight, [0, 0.7, -1.25], [1.75, 0.08, 1.45]);
    const cabin = makeSectionHull([
      { z: -0.78, bottomY: 0.69, topY: 0.96, bottomHalf: 0.81, topHalf: 0.57 },
      { z: -0.38, bottomY: 0.71, topY: 1.35, bottomHalf: 0.82, topHalf: 0.61 },
      { z: 0.66, bottomY: 0.72, topY: 1.31, bottomHalf: 0.83, topHalf: 0.6 },
      { z: 1.15, bottomY: 0.7, topY: 0.91, bottomHalf: 0.81, topHalf: 0.61 },
    ]);
    root.add(new THREE.Mesh(cabin, glass));
    box(root, sharedBox, paint, [0, 1.34, 0.15], [1.25, 0.07, 1.1]);
    box(root, sharedBox, interior, [0, 0.84, 0.23], [1.35, 0.22, 0.72]);
    for (const side of [-1, 1]) {
      const bucket = box(root, sharedBox, leather, [side * 0.39, 0.93, 0.23], [0.42, 0.5, 0.49]);
      bucket.name = 'RallyBucketSeat';
      const headrest = box(root, sharedBox, leather, [side * 0.39, 1.23, 0.35], [0.3, 0.24, 0.18]);
      headrest.name = 'IntegratedHeadrest';
      for (const harnessX of [-0.07, 0.07]) {
        const harness = box(root, sharedBox, indicator, [side * 0.39 + harnessX, 1.08, 0.02], [0.035, 0.3, 0.025]);
        harness.name = 'RallyHarness';
        harness.rotation.x = 0.16;
      }
    }
    // The cage is deliberately modeled as a complete triangulated assembly,
    // visible through the lower coupe greenhouse.
    for (const side of [-0.66, 0.66]) {
      tubeBetween(root, chrome, [side, 0.72, -0.62], [side, 1.3, -0.38], 0.025, 8).name = 'RollCageA-Pillar';
      tubeBetween(root, chrome, [side, 1.3, -0.38], [side, 1.28, 0.72], 0.025, 8).name = 'RollCageRoofRail';
      tubeBetween(root, chrome, [side, 1.28, 0.72], [side, 0.72, 1.05], 0.025, 8).name = 'RollCageRearStay';
      tubeBetween(root, chrome, [side, 0.78, -0.26], [-side, 1.18, 0.72], 0.022, 8).name = 'RollCageCrossBrace';
    }
    const rallyDash = box(root, sharedBox, interior, [0, 0.99, -0.62], [1.34, 0.18, 0.26]);
    rallyDash.name = 'RallyDashboard';
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.027, 8, 20), leather);
    wheel.name = 'RallySteeringWheel';
    wheel.position.set(-0.38, 1.12, -0.48);
    wheel.rotation.x = Math.PI * 0.45;
    root.add(wheel);
    for (const side of [-1, 1]) {
      // Boxed rally flares, mud guards, mirrors and hood pins make the coupe
      // read differently from the smoother wagon at chase-camera distance.
      for (const z of [-FRONT_AXLE, REAR_AXLE]) {
        const flare = new THREE.Mesh(new THREE.TorusGeometry(0.51, 0.095, 8, 20, Math.PI), paintHighlight);
        flare.position.set(side * 1.02, 0.02, z);
        flare.rotation.y = side * Math.PI / 2;
        root.add(flare);
        box(root, sharedBox, dirtTrim, [side * 1.035, -0.14, z + 0.34], [0.06, 0.52, 0.12]);
      }
      ellipsoid(root, sharedSphere, paint, [side * 1.04, 0.91, -0.48], [0.2, 0.11, 0.23]);
      box(root, sharedBox, lampWhite, [side * 0.6, 0.55, -2.25], [0.4, 0.16, 0.06]);
      box(root, sharedBox, indicator, [side * 0.87, 0.47, -2.17], [0.1, 0.1, 0.07]);
      box(root, sharedBox, lampRed, [side * 0.61, 0.58, 2.08], [0.4, 0.16, 0.06]);
      box(root, new THREE.CylinderGeometry(0.08, 0.08, 0.09, 12), rim, [side * 0.55, 0.77, -1.62]).rotation.x = Math.PI / 2;
    }
    box(root, sharedBox, dirtTrim, [0, 0.29, -2.28], [1.55, 0.22, 0.13]);
    for (let slat = -3; slat <= 3; slat += 1) box(root, sharedBox, rim, [slat * 0.13, 0.39, -2.36], [0.02, 0.2, 0.02]);
    for (const x of [-0.38, 0.38]) box(root, sharedBox, paintDark, [x, 0.76, -1.05], [0.42, 0.025, 0.58]).rotation.x = -0.06;
    for (const x of [-0.62, -0.21, 0.21, 0.62]) {
      const vent = box(root, sharedBox, dirtTrim, [x, 0.79, -1.12], [0.13, 0.025, 0.48]);
      vent.name = 'FunctionalHoodVent';
      vent.rotation.x = -0.08;
    }
    for (const x of [-0.48, -0.16, 0.16, 0.48]) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.075, 18), lampWhite);
      lamp.name = 'RallyAuxiliaryLamp';
      lamp.position.set(x, 0.42, -2.43);
      lamp.rotation.x = Math.PI / 2;
      root.add(lamp);
    }
    for (const side of [-1, 1]) {
      box(root, sharedBox, dirtTrim, [side * 1.05, 0.06, 0.05], [0.09, 0.12, 3.45]).name = 'RallySideSkirt';
      tubeBetween(root, indicator, [side * 0.48, 0.18, -2.28], [side * 0.48, 0.1, -2.46], 0.035, 8).name = 'TowHook';
    }
    const sumpGuard = box(root, sharedBox, chrome, [0, -0.1, -0.62], [1.24, 0.035, 1.24]);
    sumpGuard.name = 'AluminumSumpGuard';
    // Full rally wing with uprights, endplates and lower diffuser.
    for (const x of [-0.59, 0.59]) {
      box(root, sharedBox, dirtTrim, [x, 1.02, 1.63], [0.07, 0.48, 0.1]);
      box(root, sharedBox, paintDark, [x * 1.35, 1.3, 1.62], [0.07, 0.26, 0.34]);
    }
    const wing = box(root, sharedBox, paintDark, [0, 1.44, 1.59], [1.78, 0.1, 0.42]);
    wing.rotation.x = -0.08;
    box(root, sharedBox, dirtTrim, [0, 0.2, 2.13], [1.62, 0.22, 0.17]);
    for (const x of [-0.58, 0, 0.58]) box(root, sharedBox, dirtTrim, [x, 0.08, 2.25], [0.05, 0.26, 0.28]).rotation.x = -0.16;
    this._addCarWheels(materials, 1.01, FRONT_AXLE, REAR_AXLE, 0.405);
  }

  _buildMotorbike(materials) {
    const { paint, paintHighlight, paintDark, dirtTrim, glass, tire, rim, interior, lampWhite, lampRed, indicator, chrome, leather, brake, caliper, sharedBox, sharedSphere } = materials;
    const root = this._modelRoot;
    root.position.y = 0.08;
    const frontZ = -1.16;
    const rearZ = 1.13;
    const bikeRadius = 0.47;

    const addBikeWheel = (z, isFront) => {
      const pivot = new THREE.Group();
      pivot.name = isFront ? 'BikeFrontSteerPivot' : 'BikeRearWheelPivot';
      pivot.position.set(0, 0, z);
      root.add(pivot);
      const spin = new THREE.Group();
      pivot.add(spin);
      this._wheelSpin.push(spin);
      if (isFront) this._frontSteer.push(pivot);
      const tireMesh = new THREE.Mesh(new THREE.TorusGeometry(bikeRadius, 0.095, 10, 28), tire);
      tireMesh.rotation.y = Math.PI / 2;
      spin.add(tireMesh);
      const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.032, 8, 20), rim);
      wheelRim.rotation.y = Math.PI / 2;
      spin.add(wheelRim);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.22, 16), chrome);
      hub.name = 'MotorcycleWheelHub';
      hub.rotation.z = Math.PI / 2;
      spin.add(hub);
      for (let spoke = 0; spoke < 8; spoke += 1) {
        const angle = spoke / 8 * Math.PI * 2;
        tubeBetween(spin, chrome, [0, 0, 0], [0, Math.sin(angle) * 0.31, Math.cos(angle) * 0.31], 0.014, 6);
      }
      for (const side of [-1, 1]) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.018, 24), brake);
        disc.name = 'MotorcycleBrakeRotor';
        disc.position.x = side * 0.075;
        disc.rotation.z = Math.PI / 2;
        spin.add(disc);
        const brakeCaliper = box(pivot, sharedBox, caliper, [side * 0.105, 0.04, -0.2], [0.065, 0.17, 0.1]);
        brakeCaliper.name = 'MotorcycleBrakeCaliper';
      }
      return pivot;
    };
    const frontWheel = addBikeWheel(frontZ, true);
    addBikeWheel(rearZ, false);
    // Twin virtual rear contacts preserve the car VFX/public wheel API.
    for (const x of [-0.12, 0.12]) {
      const contact = new THREE.Group();
      contact.position.set(x, -bikeRadius, rearZ);
      root.add(contact);
      this._rearWheelPivots.push(contact);
    }

    // Trellis frame, swingarm and steering fork form a readable mechanical skeleton.
    for (const side of [-0.14, 0.14]) {
      tubeBetween(root, paintDark, [side, 0.25, 0.88], [side, 0.88, -0.12], 0.045);
      tubeBetween(root, paintDark, [side, 0.88, -0.12], [side, 0.28, -0.52], 0.045);
      tubeBetween(root, paintDark, [side, 0.28, -0.52], [side, 0.25, 0.88], 0.045);
      tubeBetween(root, chrome, [side, 0.28, 0.03], [side, 0.06, 1.1], 0.035);
      tubeBetween(frontWheel, chrome, [side, 0.05, 0], [side, 0.98, 0.18], 0.045);
    }
    const rearShock = tubeBetween(root, caliper, [0, 0.24, 0.72], [0, 0.76, 0.18], 0.055, 10);
    rearShock.name = 'RearMonoshock';
    for (let coil = 0; coil < 5; coil += 1) {
      const spring = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.013, 6, 14), chrome);
      spring.name = 'RearShockCoil';
      spring.position.set(0, 0.37 + coil * 0.075, 0.58 - coil * 0.075);
      spring.rotation.x = 0.78;
      root.add(spring);
    }
    // Sculpted tank and side fairings.
    ellipsoid(root, sharedSphere, paint, [0, 0.88, -0.22], [0.42, 0.38, 0.67]);
    ellipsoid(root, sharedSphere, paintHighlight, [0, 0.92, -0.5], [0.37, 0.28, 0.35]);
    for (const side of [-1, 1]) {
      const fairing = box(root, sharedBox, paintHighlight, [side * 0.23, 0.54, -0.33], [0.08, 0.42, 0.8]);
      fairing.rotation.x = -0.14;
      box(root, sharedBox, paintDark, [side * 0.275, 0.54, -0.35], [0.018, 0.19, 0.42]);
      const radiator = box(root, sharedBox, dirtTrim, [side * 0.25, 0.47, -0.52], [0.045, 0.38, 0.48]);
      radiator.name = 'RadiatorSideCore';
      for (let vane = -2; vane <= 2; vane += 1) {
        box(root, sharedBox, chrome, [side * 0.285, 0.47 + vane * 0.06, -0.52], [0.018, 0.012, 0.4]).name = 'RadiatorFin';
      }
    }
    // Engine block, fins, cylinders, chain cover and exhaust headers.
    box(root, sharedBox, interior, [0, 0.34, 0.12], [0.52, 0.5, 0.58]);
    for (let fin = -2; fin <= 2; fin += 1) box(root, sharedBox, chrome, [0, 0.34 + fin * 0.075, 0.1], [0.58, 0.025, 0.48]);
    for (const side of [-1, 1]) {
      const cylinder = box(root, new THREE.CylinderGeometry(0.16, 0.18, 0.32, 12), dirtTrim, [side * 0.31, 0.36, 0.12]);
      cylinder.rotation.z = Math.PI / 2;
    }
    tubeBetween(root, chrome, [0.2, 0.35, -0.1], [0.29, 0.18, 0.72], 0.045);
    tubeBetween(root, chrome, [0.29, 0.18, 0.72], [0.34, 0.26, 1.36], 0.065);
    const rearSprocket = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.025, 20), brake);
    rearSprocket.name = 'RearDriveSprocket';
    rearSprocket.position.set(-0.15, 0, rearZ);
    rearSprocket.rotation.z = Math.PI / 2;
    root.add(rearSprocket);
    const chainTop = tubeBetween(root, brake, [-0.16, 0.13, 0.18], [-0.16, 0.14, 1.13], 0.018, 6);
    chainTop.name = 'DriveChainUpperRun';
    const chainBottom = tubeBetween(root, brake, [-0.16, -0.12, 0.18], [-0.16, -0.14, 1.13], 0.018, 6);
    chainBottom.name = 'DriveChainLowerRun';
    for (const side of [-1, 1]) {
      tubeBetween(root, chrome, [side * 0.18, 0.32, 0.3], [side * 0.45, 0.23, 0.36], 0.025, 8).name = 'FootpegBracket';
      box(root, sharedBox, dirtTrim, [side * 0.48, 0.23, 0.36], [0.18, 0.045, 0.09]).name = 'KnurledFootpeg';
    }
    // Seat, tail cowl, plate, lights and fenders.
    const seat = box(root, sharedBox, leather, [0, 0.82, 0.59], [0.42, 0.14, 0.78]);
    seat.rotation.x = 0.1;
    ellipsoid(root, sharedSphere, paint, [0, 0.76, 1.03], [0.34, 0.2, 0.45]);
    box(root, sharedBox, lampRed, [0, 0.79, 1.39], [0.26, 0.13, 0.07]);
    box(root, sharedBox, dirtTrim, [0, 0.53, 1.46], [0.28, 0.34, 0.04]).rotation.x = -0.18;
    for (const [z, material] of [[frontZ, paintHighlight], [rearZ, paint]]) {
      const fender = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.045, 6, 22, Math.PI * 0.78), material);
      fender.position.set(0, 0, z);
      fender.rotation.y = Math.PI / 2;
      fender.rotation.z = z === frontZ ? -0.34 : 0.34;
      root.add(fender);
    }
    // Handlebar, grips, mirrors, dash and headlight.
    tubeBetween(frontWheel, chrome, [-0.44, 1.06, 0.16], [0.44, 1.06, 0.16], 0.025, 8);
    for (const side of [-1, 1]) {
      tubeBetween(frontWheel, dirtTrim, [side * 0.38, 1.06, 0.16], [side * 0.55, 1.06, 0.16], 0.045, 8);
      tubeBetween(frontWheel, chrome, [side * 0.34, 1.08, 0.16], [side * 0.49, 1.34, 0.1], 0.018, 6);
      ellipsoid(frontWheel, sharedSphere, chrome, [side * 0.5, 1.38, 0.08], [0.12, 0.08, 0.16]);
      tubeBetween(frontWheel, chrome, [side * 0.32, 1.08, 0.13], [side * 0.49, 1.02, -0.04], 0.012, 6).name = 'ControlLever';
      ellipsoid(frontWheel, sharedSphere, indicator, [side * 0.34, 0.91, -0.19], [0.075, 0.065, 0.055]).name = 'FrontIndicator';
    }
    ellipsoid(frontWheel, sharedSphere, lampWhite, [0, 0.94, -0.12], [0.24, 0.24, 0.18]);
    box(frontWheel, sharedBox, interior, [0, 1.07, 0.04], [0.32, 0.12, 0.2]);
    const windscreen = ellipsoid(frontWheel, sharedSphere, glass, [0, 1.2, -0.18], [0.3, 0.35, 0.07]);
    windscreen.name = 'MotorcycleWindscreen';
  }

  _addCarWheels(materials, track, frontZ, rearZ, radius) {
    const { tire, rim, brake, caliper, chrome, dirtTrim, sharedBox } = materials;
    const tireGeometry = new THREE.CylinderGeometry(radius, radius, 0.28, 24, 1);
    const rimGeometry = new THREE.CylinderGeometry(radius * 0.6, radius * 0.6, 0.292, 12, 1);
    const discGeometry = new THREE.CylinderGeometry(radius * 0.43, radius * 0.43, 0.035, 24, 1);
    const hubGeometry = new THREE.CylinderGeometry(radius * 0.12, radius * 0.12, 0.32, 16, 1);
    const wheelLocations = [
      [-track, -frontZ, true], [track, -frontZ, true],
      [-track, rearZ, false], [track, rearZ, false],
    ];
    for (const [x, z, isFront] of wheelLocations) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, z);
      this._modelRoot.add(pivot);
      const spin = new THREE.Group();
      pivot.add(spin);
      this._wheelSpin.push(spin);
      if (isFront) this._frontSteer.push(pivot);
      else this._rearWheelPivots.push(pivot);
      for (const [geometry, material] of [[tireGeometry, tire], [rimGeometry, rim]]) {
        const part = new THREE.Mesh(geometry, material);
        part.name = material === tire ? 'TreadedTire' : 'ForgedRimBarrel';
        part.rotation.z = Math.PI / 2;
        spin.add(part);
      }
      const disc = new THREE.Mesh(discGeometry, brake);
      disc.name = 'VentilatedBrakeDisc';
      disc.rotation.z = Math.PI / 2;
      spin.add(disc);
      const hub = new THREE.Mesh(hubGeometry, chrome);
      hub.name = 'WheelHubAndAxle';
      hub.rotation.z = Math.PI / 2;
      spin.add(hub);
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const angle = spoke / 6 * Math.PI * 2;
        const spokeMesh = box(spin, sharedBox, rim, [0, Math.sin(angle) * radius * 0.36, Math.cos(angle) * radius * 0.36], [0.31, 0.035, radius * 0.42]);
        spokeMesh.name = 'ForgedWheelSpoke';
        spokeMesh.rotation.x = angle;
      }
      const brakeCaliper = box(pivot, sharedBox, caliper, [x < 0 ? -0.19 : 0.19, radius * 0.05, radius * 0.28], [0.1, radius * 0.29, radius * 0.16]);
      brakeCaliper.name = 'FixedBrakeCaliper';
      const strutTopX = x * -0.3;
      const strut = tubeBetween(pivot, chrome, [0, radius * 0.18, 0], [strutTopX, radius * 1.38, isFront ? 0.12 : -0.1], 0.035, 10);
      strut.name = 'SuspensionDamper';
      for (let coil = 0; coil < 3; coil += 1) {
        const spring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.014, 6, 12), dirtTrim);
        spring.name = 'SuspensionCoil';
        spring.position.set(strutTopX * (0.34 + coil * 0.18), radius * (0.68 + coil * 0.17), 0);
        spring.rotation.y = Math.PI / 2;
        pivot.add(spring);
      }
    }
  }

  getWheelWorldPositions() {
    this.group.updateWorldMatrix(true, true);
    return this._rearWheelPivots.map((wheel) => wheel.getWorldPosition(new THREE.Vector3()));
  }

  setRouteAssistHeading(targetHeading, strength = 1, dt = 1 / 60) {
    if (!Number.isFinite(targetHeading) || !Number.isFinite(dt) || dt <= 0) return;
    const delta = Math.atan2(Math.sin(targetHeading - this.heading), Math.cos(targetHeading - this.heading));
    const response = 1 - Math.exp(-Math.max(0, strength) * Math.min(dt, 0.05));
    this.heading += THREE.MathUtils.clamp(delta, -0.35, 0.35) * response;
    this.yawVelocity = THREE.MathUtils.clamp(
      this.yawVelocity + delta * response * 0.22,
      -1.25,
      1.25,
    );
  }

  reset(route) {
    this.velocity.set(0, 0, 0);
    this.speedMps = 0;
    this.lateralSpeed = 0;
    this.steer = 0;
    this.yawVelocity = 0;
    this.slipAngle = 0;
    this.driftAmount = 0;
    this.isDrifting = false;
    this.driftScore = 0;
    this.driftMultiplier = 1;
    this.boostAmount = 1;
    this.boosting = false;
    this._boostRechargeDelay = 0;
    const routeHeading = route?.roadHeadingAt?.(SPAWN_Z);
    this.heading = Number.isFinite(routeHeading) ? routeHeading : 0;
    const laneCenters = route?.laneCenters ?? route?.routeMetadata?.laneCenters;
    const configuredPlayerLane = Array.isArray(laneCenters) || ArrayBuffer.isView(laneCenters)
      ? laneCenters[laneCenters.length - 1]
      : Number.NaN;
    const laneOffset = Number.isFinite(configuredPlayerLane)
      ? configuredPlayerLane
      : Math.min((route?.roadHalfWidth ?? 5.5) * 0.42, 2.3);
    const x = (route?.roadXAt?.(SPAWN_Z) ?? 0) + Math.cos(this.heading) * laneOffset;
    const z = SPAWN_Z - Math.sin(this.heading) * laneOffset;
    const roadY = route?.roadYAt?.(SPAWN_Z) ?? 0;
    this.group.position.set(x, roadY + WHEEL_RADIUS + 0.035, z);
    this.group.rotation.set(0, this.heading, 0, 'YXZ');
    for (const pivot of this._frontSteer) pivot.rotation.y = 0;
    for (const wheel of this._wheelSpin) wheel.rotation.x = 0;
  }

  update(dt, input, route) {
    if (!route || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    input ??= {};

    const roadHalfWidth = Math.max(1, route.roadHalfWidth ?? 5.5);
    const roadCenter = route.roadXAt(this.group.position.z);
    const lateralDistance = Math.abs(this.group.position.x - roadCenter);
    const offRoad = smoothstep(roadHalfWidth * 0.92, roadHalfWidth + 7.5, lateralDistance);

    const wantsBoost = Boolean(input.boost && input.forward && !input.handbrake && this.speedMps > 7);
    this.boosting = wantsBoost && this.boostAmount > 0.005;
    if (this.boosting) {
      this.boostAmount = Math.max(0, this.boostAmount - dt * 0.27);
      this._boostRechargeDelay = 0.9;
      if (this.boostAmount <= 0.005) this.boosting = false;
    } else if (wantsBoost) {
      this.boostAmount = 0;
      this._boostRechargeDelay = 0.9;
    } else if (this._boostRechargeDelay > 0) {
      this._boostRechargeDelay = Math.max(0, this._boostRechargeDelay - dt);
    } else {
      this.boostAmount = Math.min(1, this.boostAmount + dt * 0.16);
    }

    const roadForwardMax = this.boosting ? 50 : 36;
    const forwardMax = THREE.MathUtils.lerp(roadForwardMax, 14, offRoad);
    const reverseMax = THREE.MathUtils.lerp(10, 6, offRoad);
    const acceleration = THREE.MathUtils.lerp(this.boosting ? 23 : 13.5, 6, offRoad);
    const brakeForce = 25;
    if (input.forward) {
      if (this.speedMps < -0.2) this.speedMps = approach(this.speedMps, 0, brakeForce * dt);
      else this.speedMps = approach(this.speedMps, forwardMax, acceleration * dt);
    } else if (input.back) {
      if (this.speedMps > 0.2) this.speedMps = approach(this.speedMps, 0, brakeForce * dt);
      else this.speedMps = approach(this.speedMps, -reverseMax, acceleration * 0.72 * dt);
    }

    let drag = 0.42 + offRoad * 2.7;
    if (!input.forward && !input.back) drag += 0.72;
    if (input.handbrake) drag += 5.8;
    if (this.boosting) drag *= 0.55;
    this.speedMps *= Math.exp(-drag * dt);
    if (Math.abs(this.speedMps) < 0.015) this.speedMps = 0;

    const requestedSteer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const steerResponse = input.handbrake ? 8.5 : 6.5;
    this.steer = THREE.MathUtils.damp(this.steer, requestedSteer, steerResponse, dt);
    const speedRatio = clamp01(Math.abs(this.speedMps) / 25);
    const steerRate = THREE.MathUtils.lerp(1.42, 0.62, speedRatio) * (input.handbrake ? 1.35 : 1);
    const movementSign = this.speedMps >= 0 ? 1 : -1;
    const oldHeading = this.heading;
    if (Math.abs(this.speedMps) > 0.08) this.heading += this.steer * steerRate * movementSign * dt;
    this.yawVelocity = THREE.MathUtils.damp(
      this.yawVelocity,
      (this.heading - oldHeading) / Math.max(dt, 0.0001),
      10,
      dt,
    );

    this._forward.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    this._right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    this.group.position.addScaledVector(this._forward, this.speedMps * dt);
    this.velocity.copy(this._forward).multiplyScalar(this.speedMps);
    this.lateralSpeed = 0;

    const minZ = Number.isFinite(route.minZ) ? route.minZ : (Number.isFinite(route.zMin) ? route.zMin : -900);
    const maxZ = Number.isFinite(route.maxZ) ? route.maxZ : (Number.isFinite(route.zMax) ? route.zMax : 310);
    const clampedZ = THREE.MathUtils.clamp(this.group.position.z, minZ, maxZ);
    if (clampedZ !== this.group.position.z) {
      this.group.position.z = clampedZ;
      this.speedMps *= 0.18;
    }
    const currentRoadX = route.roadXAt(this.group.position.z);
    const lateralLimit = roadHalfWidth + 52;
    const clampedX = THREE.MathUtils.clamp(this.group.position.x, currentRoadX - lateralLimit, currentRoadX + lateralLimit);
    if (clampedX !== this.group.position.x) {
      this.group.position.x = clampedX;
      this.speedMps *= 0.22;
    }

    const groundAt = (x, z) => {
      const center = route.roadXAt(z);
      const terrainBlend = smoothstep(roadHalfWidth - 0.35, roadHalfWidth + 1.2, Math.abs(x - center));
      return THREE.MathUtils.lerp(route.roadYAt(z), route.terrainHeightAt(x, z), terrainBlend);
    };
    const groundY = groundAt(this.group.position.x, this.group.position.z);
    this.group.position.y = THREE.MathUtils.damp(this.group.position.y, groundY + WHEEL_RADIUS + 0.035, 13, dt);

    const handbrakeStyle = input.handbrake ? Math.abs(this.steer) * smoothstep(6, 22, Math.abs(this.speedMps)) : 0;
    this.driftAmount = THREE.MathUtils.damp(this.driftAmount, handbrakeStyle, 10, dt);
    this.slipAngle = THREE.MathUtils.damp(this.slipAngle, this.steer * handbrakeStyle * 0.24, 9, dt);
    this.isDrifting = this.driftAmount > 0.18;
    if (this.isDrifting && offRoad < 0.7) {
      this.driftMultiplier = Math.min(3, this.driftMultiplier + dt * 0.35);
      this.driftScore += Math.abs(this.speedMps) * this.driftAmount * this.driftMultiplier * dt;
    } else {
      this.driftMultiplier = Math.max(1, this.driftMultiplier - dt * 2);
    }

    const sampleLength = 1.65;
    const aheadY = groundAt(this.group.position.x + this._forward.x * sampleLength, this.group.position.z + this._forward.z * sampleLength);
    const behindY = groundAt(this.group.position.x - this._forward.x * sampleLength, this.group.position.z - this._forward.z * sampleLength);
    const leftY = groundAt(this.group.position.x - this._right.x * 0.82, this.group.position.z - this._right.z * 0.82);
    const rightY = groundAt(this.group.position.x + this._right.x * 0.82, this.group.position.z + this._right.z * 0.82);
    const targetPitch = THREE.MathUtils.clamp(Math.atan2(aheadY - behindY, sampleLength * 2), -0.28, 0.28);
    const targetRoll = THREE.MathUtils.clamp(Math.atan2(rightY - leftY, 1.64) - this.yawVelocity * speedRatio * 0.035, -0.22, 0.22);
    this._pitch = THREE.MathUtils.damp(this._pitch, targetPitch, 8, dt);
    this._roll = THREE.MathUtils.damp(this._roll, targetRoll, 8, dt);
    this.group.rotation.set(this._pitch, this.heading, this._roll, 'YXZ');

    const steerAngle = this.steer * THREE.MathUtils.lerp(0.54, 0.205, speedRatio);
    const wheelAngle = -this.speedMps * dt / WHEEL_RADIUS;
    for (const wheel of this._wheelSpin) wheel.rotation.x += wheelAngle;
    for (const pivot of this._frontSteer) pivot.rotation.y = steerAngle;
  }

  _updateSlipModel(dt, input, route) {
    if (!route || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.04);
    input ??= {};

    this._forward.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    this._right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    let forwardSpeed = this.velocity.dot(this._forward);
    let lateralSpeed = this.velocity.dot(this._right);
    const planarSpeed = Math.hypot(forwardSpeed, lateralSpeed);

    const roadHalfWidth = Math.max(1, route.roadHalfWidth ?? 5.5);
    const roadCenter = route.roadXAt(this.group.position.z);
    const offRoad = smoothstep(roadHalfWidth * 0.94, roadHalfWidth + 6.5, Math.abs(this.group.position.x - roadCenter));
    const requestedSteer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    this.steer = THREE.MathUtils.damp(this.steer, requestedSteer, input.handbrake ? 9 : 6.8, dt);

    const steerLimit = THREE.MathUtils.lerp(0.54, 0.205, clamp01(planarSpeed / 34));
    const steerAngle = this.steer * steerLimit;
    const direction = forwardSpeed < -0.5 ? -1 : 1;
    const referenceSpeed = Math.max(Math.abs(forwardSpeed), 2.4);
    const frontSlip = Math.atan2(lateralSpeed + this.yawVelocity * FRONT_AXLE, referenceSpeed) + steerAngle * direction;
    const rearSlip = Math.atan2(lateralSpeed - this.yawVelocity * REAR_AXLE, referenceSpeed);
    const provisionalSlip = Math.atan2(lateralSpeed, Math.max(Math.abs(forwardSpeed), 0.5));
    const counterSteering = provisionalSlip * this.steer < -0.018;

    const frontGrip = THREE.MathUtils.lerp(10.5, 7.2, offRoad);
    let rearGrip = input.handbrake ? 3.2 : THREE.MathUtils.lerp(12.2, 6.5, offRoad);
    if (counterSteering && !input.handbrake) rearGrip += 3.4;
    const rollingGrip = smoothstep(0.5, 4.5, planarSpeed);
    const frontAcceleration = -Math.tanh(frontSlip * 2.15) * frontGrip * rollingGrip;
    const rearAcceleration = -Math.tanh(rearSlip * 2.05) * rearGrip * rollingGrip;
    const lateralAcceleration = frontAcceleration + rearAcceleration;

    let yawAcceleration = (-frontAcceleration * FRONT_AXLE + rearAcceleration * REAR_AXLE) / WHEELBASE * 0.72;
    const lowSpeedYawDamping = THREE.MathUtils.lerp(5.5, 0, clamp01(planarSpeed / 7));
    const yawDamping = (input.handbrake ? 0.75 : (counterSteering ? 3.4 : 1.55)) + lowSpeedYawDamping;
    yawAcceleration -= this.yawVelocity * yawDamping;
    if (input.handbrake && planarSpeed > 7) yawAcceleration += this.steer * Math.min(planarSpeed, 28) * 0.035;
    if (!input.left && !input.right && !input.handbrake) yawAcceleration -= provisionalSlip * 1.8;
    this.yawVelocity = THREE.MathUtils.clamp(this.yawVelocity + yawAcceleration * dt, -1.25, 1.25);
    this.heading += this.yawVelocity * dt;

    let longitudinalAcceleration = 0;
    const forwardLimit = THREE.MathUtils.lerp(37, 16, offRoad);
    if (input.forward) {
      longitudinalAcceleration = forwardSpeed < -0.2 ? 24 : 13.8 * clamp01(1 - Math.max(0, forwardSpeed) / forwardLimit);
    } else if (input.back) {
      longitudinalAcceleration = forwardSpeed > 0.2 ? -25 : -8.5 * clamp01(1 - Math.abs(Math.min(0, forwardSpeed)) / 10);
    }
    if (input.handbrake) longitudinalAcceleration -= Math.sign(forwardSpeed || 1) * Math.min(8, Math.abs(forwardSpeed) * 0.48);

    this.velocity.addScaledVector(this._forward, longitudinalAcceleration * dt);
    this.velocity.addScaledVector(this._right, lateralAcceleration * dt);
    const drag = 0.022 + planarSpeed * 0.0012 + offRoad * 1.45 + (!input.forward && !input.back ? 0.05 : 0);
    this.velocity.multiplyScalar(Math.exp(-drag * dt));
    if (this.velocity.lengthSq() < 0.0004) this.velocity.set(0, 0, 0);
    this.group.position.addScaledVector(this.velocity, dt);

    const minZ = Number.isFinite(route.minZ) ? route.minZ : (Number.isFinite(route.zMin) ? route.zMin : -900);
    const maxZ = Number.isFinite(route.maxZ) ? route.maxZ : (Number.isFinite(route.zMax) ? route.zMax : 310);
    const clampedZ = THREE.MathUtils.clamp(this.group.position.z, minZ, maxZ);
    if (clampedZ !== this.group.position.z) {
      this.group.position.z = clampedZ;
      this.velocity.multiplyScalar(0.18);
    }
    const currentRoadX = route.roadXAt(this.group.position.z);
    const lateralLimit = roadHalfWidth + 52;
    const clampedX = THREE.MathUtils.clamp(this.group.position.x, currentRoadX - lateralLimit, currentRoadX + lateralLimit);
    if (clampedX !== this.group.position.x) {
      this.group.position.x = clampedX;
      this.velocity.multiplyScalar(0.22);
    }

    const groundAt = (x, z) => {
      const center = route.roadXAt(z);
      const terrainBlend = smoothstep(roadHalfWidth - 0.35, roadHalfWidth + 1.2, Math.abs(x - center));
      return THREE.MathUtils.lerp(route.roadYAt(z), route.terrainHeightAt(x, z), terrainBlend);
    };
    const groundY = groundAt(this.group.position.x, this.group.position.z);
    this.group.position.y = THREE.MathUtils.damp(this.group.position.y, groundY + WHEEL_RADIUS + 0.035, 13, dt);

    this._forward.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    this._right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    forwardSpeed = this.velocity.dot(this._forward);
    lateralSpeed = this.velocity.dot(this._right);
    this.speedMps = forwardSpeed;
    this.lateralSpeed = lateralSpeed;
    this.slipAngle = Math.atan2(lateralSpeed, Math.max(Math.abs(forwardSpeed), 0.5));
    const slipDrift = smoothstep(0.055, 0.36, Math.abs(this.slipAngle));
    const yawDrift = smoothstep(0.18, 0.92, Math.abs(this.yawVelocity));
    const speedDrift = smoothstep(6.5, 18, Math.hypot(forwardSpeed, lateralSpeed));
    this.driftAmount = clamp01((slipDrift * 0.72 + yawDrift * 0.28) * speedDrift);
    this.isDrifting = this.driftAmount > 0.2;
    if (this.isDrifting && offRoad < 0.7) {
      this.driftMultiplier = Math.min(5, this.driftMultiplier + dt * (0.32 + this.driftAmount * 0.7));
      this.driftScore += Math.abs(forwardSpeed) * this.driftAmount * this.driftMultiplier * dt * 1.7;
    } else {
      this.driftMultiplier = Math.max(1, this.driftMultiplier - dt * 1.8);
    }

    const sampleLength = 1.65;
    const aheadY = groundAt(this.group.position.x + this._forward.x * sampleLength, this.group.position.z + this._forward.z * sampleLength);
    const behindY = groundAt(this.group.position.x - this._forward.x * sampleLength, this.group.position.z - this._forward.z * sampleLength);
    const leftY = groundAt(this.group.position.x - this._right.x * 0.82, this.group.position.z - this._right.z * 0.82);
    const rightY = groundAt(this.group.position.x + this._right.x * 0.82, this.group.position.z + this._right.z * 0.82);
    const targetPitch = THREE.MathUtils.clamp(Math.atan2(aheadY - behindY, sampleLength * 2), -0.28, 0.28);
    const targetRoll = THREE.MathUtils.clamp(Math.atan2(rightY - leftY, 1.64) - this.yawVelocity * clamp01(planarSpeed / 24) * 0.035, -0.22, 0.22);
    this._pitch = THREE.MathUtils.damp(this._pitch, targetPitch, 8, dt);
    this._roll = THREE.MathUtils.damp(this._roll, targetRoll, 8, dt);
    this.group.rotation.set(this._pitch, this.heading, this._roll, 'YXZ');

    const wheelAngle = -forwardSpeed * dt / WHEEL_RADIUS;
    for (const wheel of this._wheelSpin) wheel.rotation.x += wheelAngle;
    for (const pivot of this._frontSteer) pivot.rotation.y = steerAngle;
  }
}
