import * as THREE from 'three';

export const CAMERA_MODES = Object.freeze([
  Object.freeze({
    id: 'chase',
    label: 'Chase',
    position: Object.freeze([0, 3.8, 8.7]),
    target: Object.freeze([0, 1.1, -5.8]),
    blurScale: 1,
    baseFov: 58,
  }),
  Object.freeze({
    id: 'high_third_person',
    label: 'High third-person',
    position: Object.freeze([0, 7.8, 11.5]),
    target: Object.freeze([0, 0.8, -8.5]),
    blurScale: 1.35,
    baseFov: 59.5,
  }),
  Object.freeze({
    id: 'cockpit',
    label: 'Cockpit',
    position: Object.freeze([0, 1.15, -0.35]),
    target: Object.freeze([0, 1.05, -18]),
    blurScale: 0.38,
    baseFov: 62,
  }),
]);

const MODE_BY_ID = new Map(CAMERA_MODES.map((mode) => [mode.id, mode]));
const STORAGE_KEY = 'ny-drive-camera-mode-v1';

const finiteVector = (vector) => vector.toArray().every(Number.isFinite);

function safeStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/**
 * Owns the three gameplay camera rigs and the reversible cockpit visibility
 * mask. CinematicCameraEffects output can be supplied to update() without
 * coupling this controller to the effect implementation.
 */
export class CameraController {
  constructor({ camera, vehicle, reducedMotion = false, rootElement = null, storage = null } = {}) {
    if (!camera?.isPerspectiveCamera || !vehicle?.group) {
      throw new TypeError('CameraController requires a PerspectiveCamera and ArcadeVehicle.');
    }
    this.camera = camera;
    this.vehicle = vehicle;
    this.reducedMotion = Boolean(reducedMotion);
    this.rootElement = rootElement;
    this.storage = safeStorage(storage);
    this.cameraTarget = new THREE.Vector3();
    this.desiredPosition = new THREE.Vector3();
    this.desiredTarget = new THREE.Vector3();
    this.localPosition = new THREE.Vector3();
    this.localTarget = new THREE.Vector3();
    this.localEffect = new THREE.Vector3();
    this.worldEffect = new THREE.Vector3();
    this.ray = new THREE.Ray();
    this.rayDirection = new THREE.Vector3();
    this.rayHit = new THREE.Vector3();
    this.meshBounds = new THREE.Box3();
    this.hiddenCockpitMeshes = new Map();
    this.gameplayActive = false;
    this.cockpitModelRoot = null;
    this.transition = 1;
    this.lastOutput = {
      id: 'chase', label: 'Chase', blurScale: 1, fov: camera.fov, hiddenMeshCount: 0,
    };

    let initialMode = 'chase';
    try {
      const stored = this.storage?.getItem?.(STORAGE_KEY);
      if (MODE_BY_ID.has(stored)) initialMode = stored;
    } catch {
      // Storage can be unavailable in private browsing; camera cycling still works.
    }
    this.modeIndex = CAMERA_MODES.findIndex((mode) => mode.id === initialMode);
    this.#syncOutput();
    this.reset(true);
  }

  get mode() { return CAMERA_MODES[this.modeIndex]; }

  get modeId() { return this.mode.id; }

  get modeLabel() { return this.mode.label; }

  get blurScale() { return this.reducedMotion ? 0 : this.mode.blurScale; }

  setMode(id, { immediate = false, persist = true } = {}) {
    const index = CAMERA_MODES.findIndex((mode) => mode.id === id);
    if (index < 0) return this.modeId;
    const changed = index !== this.modeIndex;
    if (changed) this.#restoreCockpitMeshes();
    this.modeIndex = index;
    this.transition = this.reducedMotion || immediate ? 1 : 0;
    if (persist) {
      try { this.storage?.setItem?.(STORAGE_KEY, this.modeId); } catch { /* Session-only mode. */ }
    }
    this.#syncCockpitVisibility();
    this.#syncOutput();
    if (immediate) this.reset(true);
    return this.modeId;
  }

  cycle(options = {}) {
    const next = CAMERA_MODES[(this.modeIndex + 1) % CAMERA_MODES.length];
    return this.setMode(next.id, options);
  }

  setGameplayActive(active) {
    this.gameplayActive = Boolean(active);
    this.#syncCockpitVisibility();
  }

  update(dt, elapsed, telemetry = {}) {
    const safeDt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0;
    this.#syncCockpitVisibility();
    this.#computeDesired(telemetry.effects);

    const speed = Math.abs(Number.isFinite(telemetry.speedMps) ? telemetry.speedMps : 0);
    const speedRatio = THREE.MathUtils.clamp(speed / 50, 0, 1);
    if (!this.reducedMotion && this.modeId !== 'cockpit') {
      this.desiredPosition.y += Math.sin(safeElapsed * 13) * 0.012 * speedRatio;
      this.desiredPosition.x += Math.sin(safeElapsed * 9.3) * 0.018 * speedRatio;
    }

    const modeResponse = this.modeId === 'cockpit' ? 22 : this.modeId === 'high_third_person' ? 6.2 : 7.5;
    const response = this.reducedMotion ? 20 : modeResponse;
    const blend = 1 - Math.exp(-response * safeDt);
    this.camera.position.lerp(this.desiredPosition, blend);
    this.cameraTarget.lerp(this.desiredTarget, blend);
    this.camera.lookAt(this.cameraTarget);

    const effects = telemetry.effects;
    if (!this.reducedMotion && effects?.rotationOffset) {
      const rotation = effects.rotationOffset;
      this.camera.rotateX(Number.isFinite(rotation.pitch) ? rotation.pitch : 0);
      this.camera.rotateY(Number.isFinite(rotation.yaw) ? rotation.yaw : 0);
      this.camera.rotateZ(Number.isFinite(rotation.roll) ? rotation.roll : 0);
    } else if (!this.reducedMotion && this.modeId !== 'cockpit') {
      const steer = THREE.MathUtils.clamp(Number.isFinite(telemetry.steer) ? telemetry.steer : 0, -1, 1);
      this.camera.rotateZ(-steer * speedRatio * 0.012);
    }

    const desiredFov = Number.isFinite(effects?.fovDegrees)
      ? effects.fovDegrees
      : this.mode.baseFov + speedRatio * 7.2 + (telemetry.boosting ? 1.8 : 0);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, THREE.MathUtils.clamp(desiredFov, 55, 69), 5.2, safeDt);
    this.camera.updateProjectionMatrix();
    this.transition = this.reducedMotion ? 1 : THREE.MathUtils.damp(this.transition, 1, 5.8, safeDt);

    if (!finiteVector(this.camera.position) || !Number.isFinite(this.camera.fov)) this.reset(true);
    this.#syncOutput(effects);
    return this.lastOutput;
  }

  reset(immediate = true) {
    this.#computeDesired();
    if (immediate || !finiteVector(this.camera.position)) {
      this.camera.position.copy(this.desiredPosition);
      this.cameraTarget.copy(this.desiredTarget);
      this.camera.lookAt(this.cameraTarget);
      this.camera.fov = this.mode.baseFov;
      this.camera.updateProjectionMatrix();
    }
    this.#syncCockpitVisibility();
    this.#syncOutput();
    return this.lastOutput;
  }

  restoreVehicleVisibility() {
    this.#restoreCockpitMeshes();
  }

  dispose() {
    this.gameplayActive = false;
    this.#restoreCockpitMeshes();
  }

  #cockpitOffsets() {
    if (this.vehicle.getSelection?.().vehicleType === 'motorbike') {
      // Put the lens at a rider's eye line, behind and above the controls. The
      // previous tank-level mount made the mirrors and headlight fill the view.
      return { position: [0, 1.72, 0.22], target: [0, 1.18, -18] };
    }
    return { position: this.mode.position, target: this.mode.target };
  }

  #computeDesired(effects = null) {
    const car = this.vehicle.group;
    const offsets = this.modeId === 'cockpit' ? this.#cockpitOffsets() : this.mode;
    this.localPosition.fromArray(offsets.position);
    this.localTarget.fromArray(offsets.target);
    if (effects?.positionOffset && !this.reducedMotion) {
      this.localEffect.set(
        Number.isFinite(effects.positionOffset.x) ? effects.positionOffset.x : 0,
        Number.isFinite(effects.positionOffset.y) ? effects.positionOffset.y : 0,
        Number.isFinite(effects.positionOffset.z) ? effects.positionOffset.z : 0,
      );
      this.localPosition.add(this.localEffect);
    }
    this.desiredPosition.copy(this.localPosition).applyQuaternion(car.quaternion).add(car.position);
    this.desiredTarget.copy(this.localTarget).applyQuaternion(car.quaternion).add(car.position);
  }

  #syncCockpitVisibility() {
    const shouldHide = this.gameplayActive && this.modeId === 'cockpit';
    const modelRoot = this.vehicle._modelRoot;
    if (!shouldHide) {
      this.#restoreCockpitMeshes();
      return;
    }
    if (this.cockpitModelRoot !== modelRoot) {
      this.#restoreCockpitMeshes();
      this.#hideCockpitObstructions();
    }
  }

  #hideCockpitObstructions() {
    const modelRoot = this.vehicle._modelRoot;
    if (!modelRoot) return;
    this.vehicle.group.updateWorldMatrix(true, true);
    const offsets = this.#cockpitOffsets();
    const origin = new THREE.Vector3().fromArray(offsets.position).applyQuaternion(this.vehicle.group.quaternion).add(this.vehicle.group.position);
    const target = new THREE.Vector3().fromArray(offsets.target).applyQuaternion(this.vehicle.group.quaternion).add(this.vehicle.group.position);
    this.rayDirection.copy(target).sub(origin).normalize();
    this.ray.set(origin, this.rayDirection);
    modelRoot.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.visible) return;
      this.meshBounds.setFromObject(mesh);
      const surroundsCamera = this.meshBounds.distanceToPoint(origin) <= 0.16;
      const hit = this.ray.intersectBox(this.meshBounds, this.rayHit);
      const blocksCenterView = hit && hit.distanceTo(origin) <= 2.35;
      if (surroundsCamera || blocksCenterView) {
        this.hiddenCockpitMeshes.set(mesh, mesh.visible);
        mesh.visible = false;
      }
    });
    this.cockpitModelRoot = modelRoot;
  }

  #restoreCockpitMeshes() {
    for (const [mesh, wasVisible] of this.hiddenCockpitMeshes) mesh.visible = wasVisible;
    this.hiddenCockpitMeshes.clear();
    this.cockpitModelRoot = null;
  }

  #syncOutput(effects = null) {
    this.lastOutput.id = this.mode.id;
    this.lastOutput.label = this.mode.label;
    this.lastOutput.blurScale = this.reducedMotion ? 0 : (Number.isFinite(effects?.blurScale) ? effects.blurScale : this.mode.blurScale);
    this.lastOutput.fov = this.camera.fov;
    this.lastOutput.hiddenMeshCount = this.hiddenCockpitMeshes.size;
    this.lastOutput.transition = this.transition;
    this.rootElement?.style?.setProperty('--camera-blur-scale', this.lastOutput.blurScale.toFixed(2));
  }
}
