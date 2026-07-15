import * as THREE from 'three';

export const WEATHER_PHASE_LENGTH = 1100;
export const MAX_RAIN_STREAKS = 520;

export const WEATHER_PHASES = Object.freeze([
  Object.freeze({ id: 'clear', name: 'CLEAR', rain: 0, wetness: 0, fog: 0, wind: 0.08, light: 1 }),
  Object.freeze({ id: 'light_rain', name: 'LIGHT RAIN', rain: 0.46, wetness: 0.55, fog: 0.0012, wind: 0.42, light: 0.83 }),
  Object.freeze({ id: 'storm', name: 'STORM', rain: 1, wetness: 1, fog: 0.0034, wind: 1, light: 0.58 }),
  Object.freeze({ id: 'road_fog', name: 'ROAD FOG', rain: 0.08, wetness: 0.42, fog: 0.0095, wind: 0.16, light: 0.76 }),
]);

const RAIN_BOUNDS = Object.freeze({ x: 34, yMin: 1.5, yMax: 29, zBack: 70, zFront: 24 });

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function blendPhase(a, b, amount) {
  return {
    rain: THREE.MathUtils.lerp(a.rain, b.rain, amount),
    wetness: THREE.MathUtils.lerp(a.wetness, b.wetness, amount),
    fog: THREE.MathUtils.lerp(a.fog, b.fog, amount),
    wind: THREE.MathUtils.lerp(a.wind, b.wind, amount),
    light: THREE.MathUtils.lerp(a.light, b.light, amount),
  };
}

function flattenMaterials(value, target = []) {
  if (!value) return target;
  if (Array.isArray(value)) {
    for (const entry of value) flattenMaterials(entry, target);
  } else if (value.isMaterial) {
    target.push(value);
  } else if (typeof value === 'object') {
    for (const entry of Object.values(value)) flattenMaterials(entry, target);
  }
  return target;
}

function makeRainField(scene, random) {
  const positions = new Float32Array(MAX_RAIN_STREAKS * 6);
  const drops = [];
  for (let index = 0; index < MAX_RAIN_STREAKS; index += 1) {
    drops.push({
      x: (random() - 0.5) * RAIN_BOUNDS.x * 2,
      y: RAIN_BOUNDS.yMin + random() * (RAIN_BOUNDS.yMax - RAIN_BOUNDS.yMin),
      z: -RAIN_BOUNDS.zBack + random() * (RAIN_BOUNDS.zBack + RAIN_BOUNDS.zFront),
      fallSpeed: 22 + random() * 19,
      length: 0.75 + random() * 1.55,
      phase: random() * Math.PI * 2,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({
    color: 0xbcd8e8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'BoundedWeatherRain';
  lines.frustumCulled = false;
  lines.renderOrder = 7;
  scene.add(lines);
  return { lines, geometry, material, positions, drops };
}

function reducedMotionFrom(rootElement) {
  const view = rootElement?.ownerDocument?.defaultView
    ?? (typeof window !== 'undefined' ? window : null);
  return view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Camera-local, deterministic weather. Call after the base AtmosphereSystem so
 * this layer can add fog without replacing sky progression.
 */
export class WeatherSystem {
  constructor(scene, renderer, rootElement = null) {
    this.scene = scene;
    this.renderer = renderer;
    this.rootElement = rootElement;
    this.reducedMotion = reducedMotionFrom(rootElement);
    this.random = seededRandom(0x57454154);
    this.rain = makeRainField(scene, this.random);
    this.maxRainCount = MAX_RAIN_STREAKS;
    this.rainCount = 0;
    this.state = WEATHER_PHASES[0].id;
    this.name = WEATHER_PHASES[0].name;
    this.wetness = 0;
    this.wind = 0;
    this.lightScale = 1;
    this.lightning = 0;
    this.disposed = false;
    this._lastFogContribution = 0;
    this._fogObject = null;
    this._roadMaterials = [];
    this._materialBase = new Map();
    this._cameraRight = new THREE.Vector3();
    this._cameraForward = new THREE.Vector3();
    this._worldUp = new THREE.Vector3(0, 1, 0);

    this.lightningLight = new THREE.PointLight(0xc9dcff, 0, 190, 2);
    this.lightningLight.name = 'BoundedWeatherLightning';
    this.lightningLight.position.set(0, 32, -26);
    this.lightningLight.castShadow = false;
    scene.add(this.lightningLight);
  }

  _registerRoadMaterials(roadMaterials) {
    if (!roadMaterials) return;
    for (const material of flattenMaterials(roadMaterials)) {
      if (this._materialBase.has(material)) continue;
      this._materialBase.set(material, {
        roughness: material.roughness,
        metalness: material.metalness,
        envMapIntensity: material.envMapIntensity,
      });
      this._roadMaterials.push(material);
    }
  }

  _applyRoadWetness() {
    for (const material of this._roadMaterials) {
      const base = this._materialBase.get(material);
      if (!base) continue;
      if (Number.isFinite(base.roughness)) {
        material.roughness = THREE.MathUtils.lerp(base.roughness, Math.min(base.roughness, 0.24), this.wetness);
      }
      if (Number.isFinite(base.metalness)) {
        material.metalness = THREE.MathUtils.lerp(base.metalness, Math.max(base.metalness, 0.08), this.wetness);
      }
      if (Number.isFinite(base.envMapIntensity)) {
        material.envMapIntensity = THREE.MathUtils.lerp(base.envMapIntensity, Math.max(base.envMapIntensity, 1.25), this.wetness);
      }
      material.userData.weatherWetness = this.wetness;
      material.needsUpdate = true;
    }
  }

  _applyFog(fogContribution) {
    const fog = this.scene.fog;
    if (!fog || !('density' in fog)) return;
    if (this._fogObject !== fog) {
      this._fogObject = fog;
      this._lastFogContribution = 0;
    }
    const baseDensity = Math.max(0, fog.density - this._lastFogContribution);
    fog.density = baseDensity + fogContribution;
    this._lastFogContribution = fogContribution;
  }

  _lightningPulse(elapsed, stormStrength) {
    if (stormStrength < 0.35) return 0;
    const cycleLength = 17.3;
    const cycle = Math.floor(elapsed / cycleLength);
    const local = positiveModulo(elapsed, cycleLength);
    const onset = 5.2 + seededRandom(0x4c495447 ^ cycle)() * 7.4;
    const first = Math.max(0, 1 - Math.abs(local - onset) / 0.075);
    const echo = Math.max(0, 1 - Math.abs(local - onset - 0.19) / 0.11) * 0.48;
    return Math.max(first, echo) * stormStrength;
  }

  _updateRain(dt, elapsed, speedMps, playerPosition, camera, rainStrength, windStrength) {
    const countLimit = this.reducedMotion ? 160 : MAX_RAIN_STREAKS;
    const targetCount = Math.round(countLimit * rainStrength);
    this.rainCount = THREE.MathUtils.clamp(targetCount, 0, countLimit);
    this.rain.geometry.setDrawRange(0, this.rainCount * 2);
    this.rain.material.opacity = this.rainCount > 0 ? 0.2 + rainStrength * 0.36 : 0;

    this._cameraForward.set(0, 0, -1).applyQuaternion(camera?.quaternion ?? this.rain.lines.quaternion);
    this._cameraForward.y = 0;
    if (this._cameraForward.lengthSq() < 0.001) this._cameraForward.set(0, 0, -1);
    this._cameraForward.normalize();
    this._cameraRight.crossVectors(this._cameraForward, this._worldUp).normalize();

    const anchor = playerPosition ?? camera?.position ?? this.rain.lines.position;
    const positions = this.rain.positions;
    const travel = Math.abs(speedMps) * dt;
    const windX = windStrength * 7.5;
    const tailForward = 0.34 + Math.min(Math.abs(speedMps) / 50, 1) * 1.05;
    for (let index = 0; index < this.rain.drops.length; index += 1) {
      const drop = this.rain.drops[index];
      drop.y -= drop.fallSpeed * dt;
      drop.z += travel * (0.38 + (index % 7) * 0.025);
      drop.x += windStrength * dt * (1.8 + (index % 5) * 0.13);
      if (drop.y < RAIN_BOUNDS.yMin) drop.y += RAIN_BOUNDS.yMax - RAIN_BOUNDS.yMin;
      if (drop.z > RAIN_BOUNDS.zFront) drop.z -= RAIN_BOUNDS.zBack + RAIN_BOUNDS.zFront;
      if (drop.x > RAIN_BOUNDS.x) drop.x -= RAIN_BOUNDS.x * 2;

      const sway = Math.sin(elapsed * 1.7 + drop.phase) * windStrength * 0.35;
      const worldX = anchor.x + this._cameraRight.x * (drop.x + sway) + this._cameraForward.x * drop.z;
      const worldZ = anchor.z + this._cameraRight.z * (drop.x + sway) + this._cameraForward.z * drop.z;
      const offset = index * 6;
      positions[offset] = worldX;
      positions[offset + 1] = anchor.y + drop.y;
      positions[offset + 2] = worldZ;
      positions[offset + 3] = worldX - this._cameraRight.x * windX * 0.08 - this._cameraForward.x * tailForward;
      positions[offset + 4] = anchor.y + drop.y + drop.length;
      positions[offset + 5] = worldZ - this._cameraRight.z * windX * 0.08 - this._cameraForward.z * tailForward;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  update(dt, elapsed, distance, speedMps, playerPosition, camera, roadMaterials = null) {
    if (this.disposed) return;
    const safeDt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0;
    const safeDistance = Number.isFinite(distance) ? distance : 0;
    const safeSpeed = Number.isFinite(speedMps) ? speedMps : 0;
    this._registerRoadMaterials(roadMaterials);

    const scaledPhase = positiveModulo(safeDistance, WEATHER_PHASE_LENGTH * WEATHER_PHASES.length) / WEATHER_PHASE_LENGTH;
    const phaseIndex = Math.floor(scaledPhase) % WEATHER_PHASES.length;
    const nextIndex = (phaseIndex + 1) % WEATHER_PHASES.length;
    const phaseProgress = scaledPhase - Math.floor(scaledPhase);
    const phaseBlend = THREE.MathUtils.smoothstep(phaseProgress, 0.72, 1);
    const current = WEATHER_PHASES[phaseIndex];
    const next = WEATHER_PHASES[nextIndex];
    const values = blendPhase(current, next, phaseBlend);
    const dominant = phaseBlend < 0.5 ? current : next;

    this.state = dominant.id;
    this.name = dominant.name;
    this.wetness = THREE.MathUtils.damp(this.wetness, values.wetness, 1.25, safeDt);
    this.wind = THREE.MathUtils.damp(this.wind, values.wind, 1.8, safeDt);
    this.lightScale = THREE.MathUtils.damp(this.lightScale, values.light, 2, safeDt);
    const stormStrength = current.id === 'storm'
      ? 1 - phaseBlend
      : next.id === 'storm'
        ? phaseBlend
        : 0;
    this.lightning = this._lightningPulse(safeElapsed, stormStrength);

    this._updateRain(safeDt, safeElapsed, safeSpeed, playerPosition, camera, values.rain, this.wind);
    this._applyRoadWetness();
    this._applyFog(values.fog);

    const anchor = playerPosition ?? camera?.position;
    if (anchor) this.lightningLight.position.set(anchor.x - 18, anchor.y + 36, anchor.z - 42);
    this.lightningLight.intensity = Math.min(42, this.lightning * 42);
    this.scene.userData.weather = {
      state: this.state,
      name: this.name,
      wetness: this.wetness,
      wind: this.wind,
      lightScale: this.lightScale,
      lightning: this.lightning,
      fogContribution: values.fog,
      rainCount: this.rainCount,
    };

    const style = this.rootElement?.style;
    style?.setProperty?.('--weather-rain', values.rain.toFixed(3));
    style?.setProperty?.('--weather-storm', stormStrength.toFixed(3));
    style?.setProperty?.('--weather-fog', Math.min(values.fog / 0.0095, 1).toFixed(3));
    style?.setProperty?.('--weather-wind', this.wind.toFixed(3));
    style?.setProperty?.('--weather-lightning', this.lightning.toFixed(3));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this._fogObject && 'density' in this._fogObject) {
      this._fogObject.density = Math.max(0, this._fogObject.density - this._lastFogContribution);
    }
    for (const material of this._roadMaterials) {
      const base = this._materialBase.get(material);
      if (!base) continue;
      if (Number.isFinite(base.roughness)) material.roughness = base.roughness;
      if (Number.isFinite(base.metalness)) material.metalness = base.metalness;
      if (Number.isFinite(base.envMapIntensity)) material.envMapIntensity = base.envMapIntensity;
      delete material.userData.weatherWetness;
      material.needsUpdate = true;
    }
    this.scene.remove(this.rain.lines, this.lightningLight);
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this._materialBase.clear();
    this._roadMaterials.length = 0;
    delete this.scene.userData.weather;
    const style = this.rootElement?.style;
    for (const property of ['--weather-rain', '--weather-storm', '--weather-fog', '--weather-wind', '--weather-lightning']) {
      style?.removeProperty?.(property);
    }
  }
}
