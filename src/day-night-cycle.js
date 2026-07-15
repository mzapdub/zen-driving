import * as THREE from 'three';
import { getEnvironmentProfile } from './environment-profiles.js';

export const DAY_NIGHT_CYCLE_SECONDS = 480;
export const STAR_COUNT = 260;

const PHASES = Object.freeze([
  Object.freeze({ id: 'dawn', name: 'MISTY DAWN', start: 0 }),
  Object.freeze({ id: 'day', name: 'HIGH DAY', start: 0.11 }),
  Object.freeze({ id: 'golden_hour', name: 'GOLDEN HOUR', start: 0.39 }),
  Object.freeze({ id: 'dusk', name: 'MAGENTA DUSK', start: 0.5 }),
  Object.freeze({ id: 'night', name: 'DEEP BLUE NIGHT', start: 0.61 }),
  Object.freeze({ id: 'predawn', name: 'PRE-DAWN', start: 0.91 }),
]);

const SKY_KEYS = Object.freeze([
  Object.freeze({ t: 0, sky: 0x708d99, fog: 0xa5b6b5 }),
  Object.freeze({ t: 0.11, sky: 0x92bdd2, fog: 0xb8c5bc }),
  Object.freeze({ t: 0.39, sky: 0xd58a5f, fog: 0xc49a76 }),
  Object.freeze({ t: 0.5, sky: 0x704f76, fog: 0x8d7182 }),
  Object.freeze({ t: 0.61, sky: 0x111b37, fog: 0x29344a }),
  Object.freeze({ t: 0.91, sky: 0x253451, fog: 0x536173 }),
  Object.freeze({ t: 1, sky: 0x708d99, fog: 0xa5b6b5 }),
]);

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function smooth01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function phaseFor(progress) {
  let phase = PHASES[0];
  for (const candidate of PHASES) {
    if (progress >= candidate.start) phase = candidate;
    else break;
  }
  return phase;
}

function sampleSky(progress) {
  let current = SKY_KEYS[0];
  let next = SKY_KEYS[SKY_KEYS.length - 1];
  for (let index = 0; index < SKY_KEYS.length - 1; index += 1) {
    if (progress >= SKY_KEYS[index].t && progress <= SKY_KEYS[index + 1].t) {
      current = SKY_KEYS[index];
      next = SKY_KEYS[index + 1];
      break;
    }
  }
  const span = Math.max(0.0001, next.t - current.t);
  const blend = smooth01((progress - current.t) / span);
  return {
    sky: new THREE.Color(current.sky).lerp(new THREE.Color(next.sky), blend),
    fog: new THREE.Color(current.fog).lerp(new THREE.Color(next.fog), blend),
  };
}

export function sampleDayNightState(elapsedSeconds = 0) {
  const safeElapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  const cycleTime = positiveModulo(safeElapsed, DAY_NIGHT_CYCLE_SECONDS);
  const progress = cycleTime / DAY_NIGHT_CYCLE_SECONDS;
  const angle = progress * Math.PI * 2;
  const sunElevation = Math.sin(angle);
  const daylight = smooth01((sunElevation + 0.14) / 0.38);
  const night = 1 - daylight;
  const twilight = smooth01(1 - Math.min(1, Math.abs(sunElevation) / 0.34)) * (1 - night * 0.45);
  const phase = phaseFor(progress);
  const colors = sampleSky(progress);
  const exposure = THREE.MathUtils.lerp(0.64, 1.08, daylight) + twilight * 0.06;
  const fogDensityScale = 1 + night * 0.24 + twilight * 0.12;
  return Object.freeze({
    cycleTime,
    progress,
    angle,
    sunElevation,
    moonElevation: -sunElevation,
    daylight,
    night,
    twilight,
    phaseId: phase.id,
    phaseName: phase.name,
    exposure,
    fogDensityScale,
    skyHex: colors.sky.getHex(),
    fogHex: colors.fog.getHex(),
  });
}

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function createStars(scene) {
  const random = makeRandom(0x53544152);
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const azimuth = random() * Math.PI * 2;
    const elevation = THREE.MathUtils.lerp(0.16, 1.25, Math.pow(random(), 0.72));
    const radius = THREE.MathUtils.lerp(370, 470, random());
    const offset = index * 3;
    positions[offset] = Math.cos(azimuth) * Math.cos(elevation) * radius;
    positions[offset + 1] = Math.sin(elevation) * radius;
    positions[offset + 2] = Math.sin(azimuth) * Math.cos(elevation) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xdfeaff,
    size: 1.35,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'PlayerRelativeStarField';
  points.frustumCulled = false;
  scene.add(points);
  return { points, geometry, material };
}

function createCelestialBody(scene, name, radius, color) {
  const geometry = new THREE.SphereGeometry(radius, 20, 12);
  const material = new THREE.MeshBasicMaterial({ color, fog: false, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, geometry, material };
}

function reducedMotionPreference(rootElement) {
  const view = rootElement?.ownerDocument?.defaultView
    ?? (typeof window !== 'undefined' ? window : null);
  return view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export class DayNightCycle {
  constructor(scene, renderer, {
    lighting = null,
    profile = null,
    rootElement = null,
    reducedMotion = null,
  } = {}) {
    if (!scene) throw new TypeError('DayNightCycle requires a scene.');
    this.scene = scene;
    this.renderer = renderer;
    this.profile = getEnvironmentProfile(profile?.id ?? profile);
    this.lighting = lighting ?? {};
    this.reducedMotion = reducedMotion ?? reducedMotionPreference(rootElement);
    this.sun = createCelestialBody(scene, 'DayNightSun', 7.5, 0xffca79);
    this.moon = createCelestialBody(scene, 'DayNightMoon', 5.2, 0xc9d9f2);
    this.stars = createStars(scene);
    this.moonLight = new THREE.DirectionalLight(0xb5caff, 0);
    this.moonLight.name = 'DynamicMoonLight';
    this.moonLight.castShadow = false;
    scene.add(this.moonLight, this.moonLight.target);

    this.headlightTargets = [];
    this.headlights = [-1, 1].map((side) => {
      const light = new THREE.SpotLight(0xffe2ae, 0, 105, 0.38, 0.62, 1.4);
      light.name = side < 0 ? 'PlayerNightHeadlightLeft' : 'PlayerNightHeadlightRight';
      light.castShadow = false;
      const target = new THREE.Object3D();
      target.name = `${light.name}Target`;
      light.target = target;
      scene.add(light, target);
      this.headlightTargets.push(target);
      return light;
    });
    this.state = sampleDayNightState(0);
    this.phaseName = this.state.phaseName;
    this.disposed = false;
    this._sky = new THREE.Color();
    this._fog = new THREE.Color();
    this._profileHaze = new THREE.Color(this.profile.props.hazeColor);
    this.update(0, 0, new THREE.Vector3(), null);
  }

  setEnvironmentProfile(profile) {
    this.profile = getEnvironmentProfile(profile?.id ?? profile);
    this._profileHaze.set(this.profile.props.hazeColor);
    return this.profile;
  }

  _updateVehicleHeadlights(vehicle, night) {
    const group = vehicle?.group;
    const selection = vehicle?.getSelection?.();
    const halfWidth = selection?.vehicleType === 'motorbike' ? 0.13 : 0.62;
    if (!group?.localToWorld) {
      for (const light of this.headlights) light.intensity = 0;
      return;
    }
    group.updateMatrixWorld?.(true);
    for (let index = 0; index < this.headlights.length; index += 1) {
      const side = index === 0 ? -1 : 1;
      const origin = group.localToWorld(new THREE.Vector3(side * halfWidth, 0.72, -2.05));
      const target = group.localToWorld(new THREE.Vector3(side * halfWidth * 0.35, 0.3, -42));
      this.headlights[index].position.copy(origin);
      this.headlightTargets[index].position.copy(target);
      this.headlights[index].intensity = night * 78;
    }
  }

  update(_dt = 0, elapsedSeconds = 0, playerPosition = null, vehicle = null) {
    if (this.disposed) return this.state;
    const state = sampleDayNightState(elapsedSeconds);
    this.state = state;
    this.phaseName = state.phaseName;
    const player = playerPosition && [playerPosition.x, playerPosition.y, playerPosition.z].every(Number.isFinite)
      ? playerPosition
      : { x: 0, y: 0, z: 0 };
    const orbitRadius = 315;
    const arcHeight = Math.sin(state.angle) * 175;
    const arcX = Math.cos(state.angle) * orbitRadius;
    this.sun.mesh.position.set(player.x + arcX, player.y + arcHeight, player.z - 292);
    this.moon.mesh.position.set(player.x - arcX, player.y - arcHeight, player.z - 292);
    this.sun.mesh.visible = state.sunElevation > -0.18;
    this.moon.mesh.visible = state.moonElevation > -0.18;
    this.stars.points.position.set(player.x, player.y, player.z);
    const legacyGlow = this.scene.getObjectByName('ProceduralSunGlow');
    if (legacyGlow) {
      legacyGlow.position.copy(this.sun.mesh.position);
      legacyGlow.visible = this.sun.mesh.visible;
    }
    const twinkle = this.reducedMotion ? 1 : 0.94 + Math.sin(elapsedSeconds * 0.73) * 0.06;
    this.stars.material.opacity = THREE.MathUtils.clamp((state.night - 0.22) / 0.78, 0, 1) * 0.82 * twinkle;

    const sky = new THREE.Color(state.skyHex).lerp(this._profileHaze, this.profile.id === 'arizona_desert' ? 0.16 : 0.1);
    const fog = new THREE.Color(state.fogHex).lerp(this._profileHaze, 0.34);
    if (this.scene.background?.isColor) this.scene.background.copy(sky);
    if (this.scene.fog?.color) {
      this.scene.fog.color.copy(fog);
      this.scene.fog.density = 0.00225 * this.profile.props.hazeDensityScale * state.fogDensityScale;
    }
    if (this.renderer) this.renderer.toneMappingExposure = state.exposure;

    const skyLight = this.lighting.skyLight ?? this.scene.getObjectByName('DynamicSkyLight');
    const sunLight = this.lighting.sun ?? this.scene.getObjectByName('DynamicSunLight');
    const warmFill = this.lighting.warmFill ?? this.scene.getObjectByName('DynamicWarmFill');
    if (skyLight) {
      skyLight.intensity = THREE.MathUtils.lerp(0.58, 2.3, state.daylight);
      skyLight.color.set(state.night > 0.5 ? 0x7690b6 : 0xc8dce2);
      skyLight.groundColor.set(this.profile.id === 'arizona_desert' ? 0x6e3525 : 0x35483d);
    }
    if (sunLight) {
      sunLight.intensity = 4.4 * state.daylight + state.twilight * 0.45;
      sunLight.color.set(state.twilight > 0.38 ? 0xffa060 : 0xffd3a0);
      sunLight.position.copy(this.sun.mesh.position);
      sunLight.target.position.set(player.x, player.y, player.z - 35);
    }
    if (warmFill) warmFill.intensity = 0.16 + state.twilight * 1.05;
    this.moonLight.intensity = state.night * 0.48;
    this.moonLight.position.copy(this.moon.mesh.position);
    this.moonLight.target.position.set(player.x, player.y, player.z - 24);
    this._updateVehicleHeadlights(vehicle, state.night);

    this.scene.userData.dayNight = Object.freeze({
      ...state,
      environmentId: this.profile.id,
      starOpacity: this.stars.material.opacity,
      headlightIntensity: this.headlights[0].intensity,
    });
    return this.scene.userData.dayNight;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(
      this.sun.mesh,
      this.moon.mesh,
      this.stars.points,
      this.moonLight,
      this.moonLight.target,
      ...this.headlights,
      ...this.headlightTargets,
    );
    this.sun.geometry.dispose();
    this.sun.material.dispose();
    this.moon.geometry.dispose();
    this.moon.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    delete this.scene.userData.dayNight;
  }
}
