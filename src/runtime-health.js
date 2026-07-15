import * as THREE from 'three';

const DEFAULT_EXPOSURE = 1.08;

export function isFiniteObject3D(object) {
  if (!object) return false;
  const values = [
    ...object.position.toArray(),
    ...object.quaternion.toArray(),
    ...object.scale.toArray(),
  ];
  return values.every(Number.isFinite) && object.quaternion.lengthSq() > 0.000001;
}

export function sanitizeRendererExposure(renderer, fallback = DEFAULT_EXPOSURE) {
  if (!renderer) return fallback;
  const current = Number(renderer.toneMappingExposure);
  const safe = Number.isFinite(current) ? THREE.MathUtils.clamp(current, 0.34, 1.8) : fallback;
  renderer.toneMappingExposure = safe;
  return safe;
}

/**
 * Small state machine for the one-owner game loop. It deliberately knows
 * nothing about Three renderers, which keeps lifecycle recovery deterministic
 * in the CLI smoke test and lets MountainDriveApp own the actual repair.
 */
export class RuntimeHealth {
  constructor({ recoveryBudget = 1, stableFramesToReset = 180 } = {}) {
    this.recoveryBudget = Math.max(0, recoveryBudget);
    this.stableFramesToReset = Math.max(1, stableFramesToReset);
    this.frameActive = false;
    this.contextLost = false;
    this.recoveries = 0;
    this.failureCount = 0;
    this.stableFrames = 0;
    this.lastError = null;
    this.lastSuccessfulFrame = -1;
    this.frameNumber = 0;
  }

  beginFrame() {
    if (this.frameActive || this.contextLost) return false;
    this.frameActive = true;
    this.frameNumber += 1;
    return true;
  }

  succeedFrame() {
    this.frameActive = false;
    this.failureCount = 0;
    this.stableFrames += 1;
    this.lastSuccessfulFrame = this.frameNumber;
    if (this.stableFrames >= this.stableFramesToReset) {
      this.recoveries = 0;
      this.stableFrames = 0;
    }
  }

  failFrame(error) {
    this.frameActive = false;
    this.failureCount += 1;
    this.stableFrames = 0;
    this.lastError = error instanceof Error ? error : new Error(String(error));
    if (this.recoveries < this.recoveryBudget) {
      this.recoveries += 1;
      return 'recover';
    }
    return 'fatal';
  }

  loseContext() {
    this.contextLost = true;
    this.frameActive = false;
  }

  restoreContext() {
    this.contextLost = false;
    this.failureCount = 0;
    this.stableFrames = 0;
  }

  snapshot() {
    return {
      frameActive: this.frameActive,
      contextLost: this.contextLost,
      recoveries: this.recoveries,
      failureCount: this.failureCount,
      stableFrames: this.stableFrames,
      lastSuccessfulFrame: this.lastSuccessfulFrame,
      frameNumber: this.frameNumber,
      lastError: this.lastError?.message ?? '',
    };
  }
}
