import * as THREE from 'three';

// The old unoccluded additive sprite used 0.66 opacity. A native WebGPU check
// proved it could still smear across the road after the first reduction, so it
// now retains one percent of the original and obeys scene depth.
export const SUN_GLOW_PREVIOUS_OPACITY = 0.66;
export const SUN_SCREEN_GLOW_MULTIPLIER = 0.01;
export const SUN_GLOW_OPACITY = SUN_GLOW_PREVIOUS_OPACITY * SUN_SCREEN_GLOW_MULTIPLIER;

const SKY_PHASES = [
  { name: 'LATE AFTERNOON', sky: 0x8fb8cd, fog: 0xb7c2b5, sun: 0xffc477, exposure: 1.08 },
  { name: 'GOLDEN HOUR', sky: 0xd68d64, fog: 0xc6a07c, sun: 0xffa94f, exposure: 1.16 },
  { name: 'MAGENTA DUSK', sky: 0x6f4f78, fog: 0x8d7182, sun: 0xff7c72, exposure: 1.02 },
  { name: 'DEEP BLUE NIGHT', sky: 0x101b39, fog: 0x29334b, sun: 0x9cb8ff, exposure: 0.76 },
  { name: 'MISTY DAWN', sky: 0x7e9ba5, fog: 0xa9b9b5, sun: 0xffd4a2, exposure: 0.94 },
];

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

function makeSoftTexture(colorStops) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [stop, color] of colorStops) gradient.addColorStop(stop, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMist(scene, random) {
  const count = 105;
  const positions = new Float32Array(count * 3);
  const seeds = [];
  for (let index = 0; index < count; index += 1) {
    seeds.push({
      x: (random() - 0.5) * 120,
      y: 1.5 + random() * 16,
      z: (random() - 0.5) * 210,
      speed: 0.15 + random() * 0.5,
      phase: random() * Math.PI * 2,
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  const texture = makeSoftTexture([
    [0, 'rgba(244,250,242,0.42)'],
    [0.38, 'rgba(224,235,228,0.16)'],
    [1, 'rgba(210,226,218,0)'],
  ]);
  const material = new THREE.PointsMaterial({
    map: texture,
    size: 18,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'RoadMistParticles';
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);
  return { points, positions, seeds, texture, geometry, material };
}

function createWind(scene, random) {
  const count = 72;
  const positions = new Float32Array(count * 6);
  const streaks = [];
  for (let index = 0; index < count; index += 1) {
    streaks.push({
      x: (random() - 0.5) * 25,
      y: 0.4 + random() * 12,
      z: -95 + random() * 130,
      length: 0.6 + random() * 2.1,
      speed: 0.8 + random() * 1.8,
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xeef8ec,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'WindSpeedStreaks';
  lines.frustumCulled = false;
  scene.add(lines);
  return { lines, positions, streaks, geometry, material };
}

function createSunGlow(scene) {
  const texture = makeSoftTexture([
    [0, 'rgba(255,247,199,1)'],
    [0.12, 'rgba(255,190,98,0.85)'],
    [0.46, 'rgba(255,130,74,0.16)'],
    [1, 'rgba(255,90,45,0)'],
  ]);
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    opacity: SUN_GLOW_OPACITY,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = 'ProceduralSunGlow';
  sprite.position.set(-145, 108, -309);
  sprite.scale.set(74, 74, 1);
  sprite.renderOrder = -1;
  scene.add(sprite);
  return { sprite, texture, material };
}

export class AtmosphereSystem {
  constructor(scene, renderer, appElement = document.documentElement) {
    this.scene = scene;
    this.renderer = renderer;
    this.appElement = appElement;
    this.skyColor = new THREE.Color();
    this.fogColor = new THREE.Color();
    this.sunColor = new THREE.Color();
    this.phaseName = SKY_PHASES[0].name;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.random = seededRandom(0x4d495354);
    this.mist = createMist(scene, this.random);
    this.wind = createWind(scene, this.random);
    this.glow = createSunGlow(scene);
  }

  update(dt, elapsed, distance, speedMps, vehicle, camera) {
    const cycle = ((distance % 6000) + 6000) % 6000 / 6000;
    const scaledPhase = cycle * SKY_PHASES.length;
    const index = Math.floor(scaledPhase) % SKY_PHASES.length;
    const nextIndex = (index + 1) % SKY_PHASES.length;
    const blend = THREE.MathUtils.smoothstep(scaledPhase - Math.floor(scaledPhase), 0, 1);
    const current = SKY_PHASES[index];
    const next = SKY_PHASES[nextIndex];

    this.skyColor.setHex(current.sky).lerp(new THREE.Color(next.sky), blend);
    this.fogColor.setHex(current.fog).lerp(new THREE.Color(next.fog), blend);
    this.sunColor.setHex(current.sun).lerp(new THREE.Color(next.sun), blend);
    this.scene.background.copy(this.skyColor);
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.density = THREE.MathUtils.lerp(0.0022, index === 4 ? 0.0042 : 0.00265, blend);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(current.exposure, next.exposure, blend);
    this.glow.material.color.copy(this.sunColor);
    this.phaseName = blend < 0.5 ? current.name : next.name;

    const player = vehicle.group.position;
    const mistPositions = this.mist.positions;
    for (let indexMist = 0; indexMist < this.mist.seeds.length; indexMist += 1) {
      const particle = this.mist.seeds[indexMist];
      const offset = indexMist * 3;
      mistPositions[offset] = player.x + particle.x + Math.sin(elapsed * particle.speed + particle.phase) * 6;
      mistPositions[offset + 1] = player.y + particle.y + Math.sin(elapsed * 0.22 + particle.phase) * 0.8;
      mistPositions[offset + 2] = player.z + particle.z;
    }
    this.mist.geometry.attributes.position.needsUpdate = true;
    const dawnMist = index === 4 ? 1 : 0;
    this.mist.material.opacity = 0.14 + dawnMist * 0.16 + Math.min(Math.abs(speedMps) / 36, 1) * 0.04;

    const speedRatio = THREE.MathUtils.clamp(Math.abs(speedMps) / 50, 0, 1);
    const boost = vehicle.boosting ? 1 : 0;
    const windPositions = this.wind.positions;
    for (let indexWind = 0; indexWind < this.wind.streaks.length; indexWind += 1) {
      const streak = this.wind.streaks[indexWind];
      streak.z += Math.abs(speedMps) * dt * streak.speed;
      if (streak.z > 35) streak.z -= 135;
      const offset = indexWind * 6;
      windPositions[offset] = player.x + streak.x;
      windPositions[offset + 1] = player.y + streak.y;
      windPositions[offset + 2] = player.z + streak.z;
      windPositions[offset + 3] = player.x + streak.x;
      windPositions[offset + 4] = player.y + streak.y + 0.06;
      windPositions[offset + 5] = player.z + streak.z + streak.length * (0.8 + speedRatio * 2.8 + boost * 2.4);
    }
    this.wind.geometry.attributes.position.needsUpdate = true;
    this.wind.material.opacity = Math.max(0, speedRatio - 0.3) * 0.42 + boost * 0.16;

    const targetFov = THREE.MathUtils.lerp(55, 69, speedRatio) + boost * 2;
    camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 3.6, dt);
    camera.updateProjectionMatrix();
    this.appElement.style.setProperty('--speed-fx', speedRatio.toFixed(3));
    const motionBlur = this.reducedMotion
      ? 0
      : THREE.MathUtils.smoothstep(speedRatio, 0.34, 1) * 0.72 + boost * 0.18;
    this.appElement.style.setProperty('--motion-blur', motionBlur.toFixed(3));
    this.appElement.style.setProperty('--boost-fx', boost.toFixed(3));
    this.appElement.style.setProperty('--aberration', `${(0.35 + speedRatio * 1.85).toFixed(2)}px`);
  }

  dispose() {
    this.scene.remove(this.mist.points, this.wind.lines, this.glow.sprite);
    this.mist.geometry.dispose();
    this.mist.material.dispose();
    this.mist.texture.dispose();
    this.wind.geometry.dispose();
    this.wind.material.dispose();
    this.glow.material.dispose();
    this.glow.texture.dispose();
  }
}
