const FOV_MIN = 55;
const FOV_MAX = 69;

export const CINEMATIC_EFFECT_LIMITS = Object.freeze({
  positionMeters: Object.freeze({ x: 0.42, y: 0.32, z: 0.85 }),
  rotationRadians: Object.freeze({ pitch: 0.045, yaw: 0.035, roll: 0.06 }),
  fovDegrees: Object.freeze([FOV_MIN, FOV_MAX]),
  blurScale: Object.freeze([0.25, 1.6]),
  blurExtraStrength: Object.freeze([0, 0.16]),
  chromaticAberrationPx: Object.freeze([0, 2.2]),
  lensUnitInterval: Object.freeze([0, 1]),
});

const MODE_PROFILE = Object.freeze({
  chase: Object.freeze({ baseFov: 58, blurScale: 1, motionScale: 1 }),
  high_third_person: Object.freeze({ baseFov: 59.5, blurScale: 1.35, motionScale: 1.1 }),
  cockpit: Object.freeze({ baseFov: 62, blurScale: 0.38, motionScale: 0.62 }),
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function smoothstep(value, edge0, edge1) {
  const ratio = clamp((value - edge0) / Math.max(edge1 - edge0, 1e-6), 0, 1);
  return ratio * ratio * (3 - 2 * ratio);
}

function stepSpring(axis, target, dt, frequency = 4.4) {
  if (dt <= 0) return;
  const angular = Math.PI * 2 * frequency;
  const displacement = axis.value - target;
  const coefficient = axis.velocity + angular * displacement;
  const decay = Math.exp(-angular * dt);
  axis.value = finite(target + (displacement + coefficient * dt) * decay);
  axis.velocity = finite((axis.velocity - angular * coefficient * dt) * decay);
}

function weatherStateOf(weather) {
  const raw = typeof weather === 'string'
    ? weather
    : weather?.state ?? weather?.id ?? weather?.name ?? 'clear';
  return String(raw).toLowerCase().replaceAll(' ', '_');
}

function weatherWetness(weather, state) {
  if (weather && typeof weather === 'object') {
    const supplied = finite(weather.wetness, Number.NaN);
    if (Number.isFinite(supplied)) return clamp(supplied, 0, 1);
  }
  if (state.includes('storm')) return 0.96;
  if (state.includes('rain')) return 0.52;
  if (state.includes('fog') || state.includes('mist')) return 0.18;
  return 0;
}

function weatherLightImpulse(weather, state) {
  if (weather && typeof weather === 'object') {
    return clamp(finite(weather.lightning ?? weather.flash ?? weather.lightImpulse, 0), 0, 1);
  }
  return state.includes('storm') ? 0.08 : 0;
}

/**
 * Stateful, allocation-bounded cinematic telemetry filter.
 *
 * `update()` returns local camera offsets and post-process scalars. It never
 * mutates a Three.js camera and deliberately owns no DOM or Three.js objects.
 * The same output object is reused on every frame.
 */
export class CinematicCameraEffects {
  constructor() {
    this.spring = {
      x: { value: 0, velocity: 0 },
      y: { value: 0, velocity: 0 },
      z: { value: 0, velocity: 0 },
    };
    this.pitch = 0;
    this.roll = 0;
    this.nearMissImpulse = 0;
    this.nearMissSign = 1;
    this.crashImpulse = 0;
    this.boostImpulse = 0;
    this.wetLens = 0;
    this.anamorphic = 0;
    this.transitionFactor = 1;
    this.previousCameraMode = null;
    this.previousCrash = false;
    this.previousBoost = false;
    this.previousSpeed = 0;

    this.output = {
      positionOffset: { x: 0, y: 0, z: 0 },
      rotationOffset: { pitch: 0, yaw: 0, roll: 0 },
      fovDegrees: 58,
      fovOffsetDegrees: 0,
      blurScale: 1,
      blurExtraStrength: 0,
      transitionFactor: 1,
      vibrationStrength: 0,
      shakeStrength: 0,
      impulses: { nearMiss: 0, crash: 0, boost: 0 },
      lens: {
        droplets: 0,
        anamorphic: 0,
        chromaticAberrationPx: 0,
        vignette: 0.12,
        exposurePulse: 0,
      },
    };
  }

  reset(cameraMode = 'chase') {
    for (const axis of Object.values(this.spring)) {
      axis.value = 0;
      axis.velocity = 0;
    }
    this.pitch = 0;
    this.roll = 0;
    this.nearMissImpulse = 0;
    this.crashImpulse = 0;
    this.boostImpulse = 0;
    this.wetLens = 0;
    this.anamorphic = 0;
    this.transitionFactor = 1;
    this.previousCameraMode = MODE_PROFILE[cameraMode] ? cameraMode : 'chase';
    this.previousCrash = false;
    this.previousBoost = false;
    this.previousSpeed = 0;
    return this.output;
  }

  update({
    dt = 0,
    elapsed = 0,
    speed = 0,
    acceleration,
    steer = 0,
    offRoad = 0,
    nearMissDelta = 0,
    crash = false,
    weather = 'clear',
    boost = 0,
    reducedMotion = false,
    cameraMode = 'chase',
  } = {}) {
    const safeDt = clamp(finite(dt, 0), 0, 0.05);
    const safeElapsed = finite(elapsed, 0);
    const safeSpeed = clamp(Math.abs(finite(speed, 0)), 0, 90);
    const inferredAcceleration = safeDt > 1e-5 ? (safeSpeed - this.previousSpeed) / safeDt : 0;
    const safeAcceleration = clamp(finite(acceleration, inferredAcceleration), -30, 30);
    const safeSteer = clamp(finite(steer, 0), -1, 1);
    const safeOffRoad = clamp(finite(offRoad, 0), 0, 1);
    const safeBoost = clamp(typeof boost === 'boolean' ? Number(boost) : finite(boost, 0), 0, 1);
    const speedRatio = smoothstep(safeSpeed, 2, 50);
    const accelerationRatio = clamp(safeAcceleration / 18, -1, 1);
    const mode = MODE_PROFILE[cameraMode] ? cameraMode : 'chase';
    const profile = MODE_PROFILE[mode];
    const crashActive = typeof crash === 'number' ? crash > 0 : Boolean(crash);

    if (this.previousCameraMode === null) {
      this.previousCameraMode = mode;
    } else if (mode !== this.previousCameraMode) {
      this.transitionFactor = reducedMotion ? 1 : 0;
      this.previousCameraMode = mode;
    }

    const missCount = clamp(Math.floor(finite(nearMissDelta, 0)), 0, 4);
    if (!reducedMotion && missCount > 0) {
      this.nearMissSign *= -1;
      this.nearMissImpulse = clamp(this.nearMissImpulse + missCount * 0.48, 0, 1);
    }
    if (!reducedMotion && crashActive && !this.previousCrash) this.crashImpulse = 1;
    if (!reducedMotion && safeBoost > 0.05 && !this.previousBoost) this.boostImpulse = 1;

    this.previousCrash = crashActive;
    this.previousBoost = safeBoost > 0.05;
    this.previousSpeed = safeSpeed;

    this.nearMissImpulse *= Math.exp(-5.6 * safeDt);
    this.crashImpulse *= Math.exp(-3.8 * safeDt);
    this.boostImpulse *= Math.exp(-4.8 * safeDt);
    if (reducedMotion) {
      this.nearMissImpulse = 0;
      this.crashImpulse = 0;
      this.boostImpulse = 0;
      this.transitionFactor = 1;
    } else {
      this.transitionFactor = damp(this.transitionFactor, 1, 5.8, safeDt);
    }

    const motionScale = reducedMotion ? 0.34 : profile.motionScale;
    const lagTargets = {
      x: -safeSteer * speedRatio * 0.19 * motionScale,
      y: -Math.max(accelerationRatio, 0) * 0.045 * motionScale,
      z: accelerationRatio * 0.34 * motionScale + this.boostImpulse * 0.22,
    };
    stepSpring(this.spring.x, lagTargets.x, safeDt);
    stepSpring(this.spring.y, lagTargets.y, safeDt);
    stepSpring(this.spring.z, lagTargets.z, safeDt);

    const pitchTarget = -accelerationRatio * 0.024 * motionScale;
    const rollTarget = -safeSteer * speedRatio * 0.036 * motionScale;
    this.pitch = damp(this.pitch, pitchTarget, 8.5, safeDt);
    this.roll = damp(this.roll, rollTarget, 7.2, safeDt);

    const vibrationStrength = reducedMotion ? 0 : clamp((speedRatio * 0.3 + safeOffRoad * 0.7) * profile.motionScale, 0, 1);
    const shakeStrength = reducedMotion ? 0 : clamp(this.crashImpulse + this.nearMissImpulse * 0.34, 0, 1);
    const vibrationX = Math.sin(safeElapsed * 31.7) * 0.012 * vibrationStrength;
    const vibrationY = Math.sin(safeElapsed * 43.1 + 0.7) * 0.014 * vibrationStrength;
    const vibrationPitch = Math.sin(safeElapsed * 37.3) * 0.0028 * vibrationStrength;
    const crashWaveA = Math.sin(safeElapsed * 71.3 + 0.2);
    const crashWaveB = Math.sin(safeElapsed * 53.9 + 1.4);
    const missX = this.nearMissSign * this.nearMissImpulse * 0.21;

    const position = this.output.positionOffset;
    position.x = clamp(this.spring.x.value + vibrationX + missX + crashWaveA * 0.22 * this.crashImpulse, -0.42, 0.42);
    position.y = clamp(this.spring.y.value + vibrationY + crashWaveB * 0.12 * this.crashImpulse, -0.32, 0.32);
    position.z = clamp(this.spring.z.value + Math.sin(safeElapsed * 47.7) * 0.16 * this.crashImpulse, -0.85, 0.85);

    const rotation = this.output.rotationOffset;
    rotation.pitch = clamp(this.pitch + vibrationPitch + crashWaveB * 0.018 * this.crashImpulse, -0.045, 0.045);
    rotation.yaw = clamp(this.nearMissSign * this.nearMissImpulse * 0.018 + crashWaveA * 0.014 * this.crashImpulse, -0.035, 0.035);
    rotation.roll = clamp(this.roll + crashWaveA * 0.022 * this.crashImpulse, -0.06, 0.06);

    const state = weatherStateOf(weather);
    const wetnessTarget = weatherWetness(weather, state);
    const lightImpulse = weatherLightImpulse(weather, state);
    this.wetLens = damp(this.wetLens, wetnessTarget, wetnessTarget > this.wetLens ? 2.2 : 0.5, safeDt);
    const anamorphicTarget = clamp(speedRatio * 0.2 + safeBoost * 0.45 + lightImpulse * 0.7, 0, 1);
    this.anamorphic = damp(this.anamorphic, anamorphicTarget, 6.5, safeDt);

    const speedFov = smoothstep(speedRatio, 0.18, 1) * 7.2;
    const boostFov = safeBoost * 1.8 + this.boostImpulse * 0.55;
    const fovDegrees = clamp(profile.baseFov + speedFov + boostFov, FOV_MIN, FOV_MAX);
    const blurExtra = reducedMotion
      ? 0
      : clamp(speedRatio * 0.075 + safeOffRoad * 0.035 + this.nearMissImpulse * 0.025 + this.crashImpulse * 0.04, 0, 0.16);

    this.output.fovDegrees = fovDegrees;
    this.output.fovOffsetDegrees = fovDegrees - profile.baseFov;
    this.output.blurScale = clamp(profile.blurScale, 0.25, 1.6);
    this.output.blurExtraStrength = blurExtra;
    this.output.transitionFactor = clamp(this.transitionFactor, 0, 1);
    this.output.vibrationStrength = vibrationStrength;
    this.output.shakeStrength = shakeStrength;
    this.output.impulses.nearMiss = clamp(this.nearMissImpulse, 0, 1);
    this.output.impulses.crash = clamp(this.crashImpulse, 0, 1);
    this.output.impulses.boost = clamp(this.boostImpulse, 0, 1);

    const lens = this.output.lens;
    lens.droplets = reducedMotion ? damp(lens.droplets, this.wetLens * 0.45, 2, safeDt) : this.wetLens;
    lens.anamorphic = clamp(this.anamorphic, 0, 1);
    lens.chromaticAberrationPx = reducedMotion
      ? 0
      : clamp(0.18 + speedRatio * 0.72 + this.nearMissImpulse * 0.36 + this.crashImpulse * 0.48, 0, 2.2);
    lens.vignette = clamp(0.12 + speedRatio * 0.1 + safeOffRoad * 0.05 + this.crashImpulse * 0.08, 0, 0.35);
    lens.exposurePulse = clamp(lightImpulse * 0.16 + this.nearMissImpulse * 0.035 + this.crashImpulse * 0.06, 0, 0.18);

    return this.output;
  }
}
