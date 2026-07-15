import * as THREE from 'three';
import { ArcadeVehicle, normalizeVehicleSelection } from './vehicle.js';

const TURN_RATE = THREE.MathUtils.degToRad(12);
const MAX_PIXEL_RATIO = 1.5;

function finiteVector(vector) {
  return vector.toArray().every(Number.isFinite);
}

function defaultRendererFactory(canvas) {
  return new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
}

function resolveCanvas(host, canvas) {
  if (canvas) return canvas;
  const existing = host?.querySelector?.('canvas');
  if (existing) return existing;
  if (typeof document === 'undefined') return null;
  const created = document.createElement('canvas');
  host?.append?.(created);
  return created;
}

/** Isolated WebGL turntable; preview failure cannot invalidate the game renderer. */
export class VehiclePreview {
  constructor({
    host = null,
    canvas = null,
    fallback = null,
    selection = {},
    rendererFactory = defaultRendererFactory,
    autoStart = true,
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  } = {}) {
    this.host = host;
    this.canvas = resolveCanvas(host, canvas);
    this.fallback = fallback ?? host?.querySelector?.('[data-preview-fallback]') ?? null;
    this.selection = normalizeVehicleSelection(selection);
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 16 / 6, 0.05, 60);
    this.turntable = new THREE.Group();
    this.turntable.name = 'GarageVehicleTurntable';
    this.scene.add(this.turntable);
    this.vehicle = null;
    this.renderer = null;
    this.available = false;
    this.disposed = false;
    this.running = false;
    this.frameHandle = null;
    this.lastTime = null;
    this.resizeObserver = null;
    this.visibilityObserver = null;
    this.bounds = new THREE.Box3();
    this._ownedResources = [];
    this._onFrame = this._onFrame.bind(this);
    this._onContextLost = this._onContextLost.bind(this);

    this.#buildStudio();
    try {
      if (!this.canvas) throw new Error('Garage preview canvas is unavailable.');
      this.renderer = rendererFactory(this.canvas);
      if (!this.renderer?.render || !this.renderer?.setSize) throw new Error('Garage preview renderer is incomplete.');
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.18;
      if (this.renderer.shadowMap) {
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
      this.canvas.addEventListener?.('webglcontextlost', this._onContextLost, false);
      this.vehicle = new ArcadeVehicle(this.turntable, this.selection);
      this.#fitVehicle();
      this.available = true;
      this.#setFallback(false);
      this.resize();
      this.render();
      if (typeof ResizeObserver !== 'undefined' && this.host) {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.host);
      }
      if (autoStart && typeof IntersectionObserver !== 'undefined' && this.host) {
        this.visibilityObserver = new IntersectionObserver((entries) => {
          const visible = entries.some((entry) => entry.isIntersecting);
          if (visible) this.start();
          else this.stop();
        });
        this.visibilityObserver.observe(this.host);
      } else if (autoStart) {
        this.start();
      }
    } catch (error) {
      this.#fail(error);
    }
  }

  #buildStudio() {
    const hemi = new THREE.HemisphereLight(0xdcecff, 0x182018, 1.65);
    const key = new THREE.DirectionalLight(0xffe2b5, 4.2);
    key.position.set(4.5, 7, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    const rim = new THREE.DirectionalLight(0x79a9ff, 2.6);
    rim.position.set(-5, 3.5, -4);
    const fill = new THREE.PointLight(0xff8d5b, 1.5, 12, 2);
    fill.position.set(3, 1.4, -3.5);
    this.scene.add(hemi, key, rim, fill);

    const geometry = new THREE.CircleGeometry(4.2, 48);
    const material = new THREE.MeshStandardMaterial({
      color: 0x182019,
      roughness: 0.8,
      metalness: 0.08,
      transparent: true,
      opacity: 0.72,
    });
    const ground = new THREE.Mesh(geometry, material);
    ground.name = 'GaragePreviewGround';
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this._ownedResources.push(geometry, material);
  }

  #fitVehicle() {
    if (!this.vehicle?._modelRoot) return;
    this.vehicle.group.position.set(0, 0, 0);
    this.vehicle.group.rotation.set(0, 0, 0);
    this.turntable.rotation.set(0, -0.58, 0);
    this.turntable.updateMatrixWorld(true);
    const rawBounds = new THREE.Box3().setFromObject(this.vehicle._modelRoot);
    const center = rawBounds.getCenter(new THREE.Vector3());
    this.vehicle.group.position.set(-center.x, 0.08 - rawBounds.min.y, -center.z);
    this.turntable.updateMatrixWorld(true);
    this.bounds.setFromObject(this.vehicle._modelRoot);
    const size = this.bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z, 2.8);
    const distance = THREE.MathUtils.clamp(radius * 1.75, 5.2, 7.4);
    const targetY = THREE.MathUtils.clamp(size.y * 0.47, 0.65, 1.05);
    this.camera.position.set(distance * 0.7, Math.max(2.6, size.y * 1.45), distance);
    this.camera.lookAt(0, targetY, 0);
    this.camera.updateMatrixWorld(true);
  }

  #setFallback(show, message = '') {
    this.host?.classList?.toggle('is-preview-unavailable', show);
    if (!this.fallback) return;
    this.fallback.hidden = !show;
    if (message) this.fallback.textContent = message;
  }

  #fail(error) {
    this.available = false;
    this.stop();
    this.resizeObserver?.disconnect?.();
    this.visibilityObserver?.disconnect?.();
    this.resizeObserver = null;
    this.visibilityObserver = null;
    this.#setFallback(true, '3D preview unavailable — your selected vehicle will still load in the drive.');
    if (typeof console !== 'undefined') console.warn('Garage vehicle preview disabled:', error?.message ?? error);
  }

  _onContextLost(event) {
    event?.preventDefault?.();
    this.#fail(new Error('WebGL preview context lost.'));
  }

  _onFrame(time) {
    if (!this.running || this.disposed) return;
    const seconds = Number.isFinite(time) ? time * 0.001 : 0;
    const dt = this.lastTime == null ? 0 : THREE.MathUtils.clamp(seconds - this.lastTime, 0, 0.05);
    this.lastTime = seconds;
    this.update(dt);
    this.frameHandle = this.requestFrame?.(this._onFrame) ?? null;
  }

  setSelection(selection = {}) {
    this.selection = normalizeVehicleSelection({ ...this.selection, ...selection });
    if (!this.vehicle || this.disposed) return { ...this.selection };
    try {
      this.vehicle.applySelection(this.selection);
      this.#fitVehicle();
      this.render();
    } catch (error) {
      this.#fail(error);
    }
    return { ...this.selection };
  }

  resize(width = this.host?.clientWidth, height = this.host?.clientHeight) {
    if (!this.renderer || this.disposed) return false;
    const safeWidth = Math.max(1, Math.floor(Number(width) || this.canvas?.clientWidth || 640));
    const safeHeight = Math.max(1, Math.floor(Number(height) || this.canvas?.clientHeight || 240));
    const pixelRatio = Math.min(MAX_PIXEL_RATIO, Math.max(1, Number(globalThis.devicePixelRatio) || 1));
    this.renderer.setPixelRatio?.(pixelRatio);
    this.renderer.setSize(safeWidth, safeHeight, false);
    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
    return true;
  }

  update(dt = 0) {
    if (!this.available || this.disposed) return false;
    const safeDt = THREE.MathUtils.clamp(Number(dt) || 0, 0, 0.05);
    this.turntable.rotation.y = (this.turntable.rotation.y + TURN_RATE * safeDt) % (Math.PI * 2);
    if (!finiteVector(this.camera.position) || !finiteVector(this.turntable.position)) this.#fitVehicle();
    return this.render();
  }

  render() {
    if (!this.available || this.disposed || !this.renderer) return false;
    try {
      this.renderer.render(this.scene, this.camera);
      return true;
    } catch (error) {
      this.#fail(error);
      return false;
    }
  }

  start() {
    if (!this.available || this.running || this.disposed || !this.requestFrame) return false;
    this.running = true;
    this.lastTime = null;
    this.frameHandle = this.requestFrame(this._onFrame);
    return true;
  }

  stop() {
    this.running = false;
    if (this.frameHandle != null) this.cancelFrame?.(this.frameHandle);
    this.frameHandle = null;
    this.lastTime = null;
  }

  getStats() {
    let meshCount = 0;
    this.vehicle?._modelRoot?.traverse((object) => { if (object.isMesh) meshCount += 1; });
    const size = this.bounds.getSize(new THREE.Vector3());
    return {
      available: this.available,
      disposed: this.disposed,
      loadedVehicleCount: this.vehicle ? 1 : 0,
      rendererCount: this.renderer ? 1 : 0,
      meshCount,
      selection: { ...this.selection },
      boundsSize: size.toArray(),
      cameraPosition: this.camera.position.toArray(),
      turntableRotation: [this.turntable.rotation.x, this.turntable.rotation.y, this.turntable.rotation.z],
    };
  }

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.canvas?.removeEventListener?.('webglcontextlost', this._onContextLost, false);
    this.vehicle?._clearModel?.();
    this.vehicle?.group?.removeFromParent?.();
    this.vehicle = null;
    for (const resource of this._ownedResources) resource.dispose?.();
    this._ownedResources.length = 0;
    try { this.renderer?.dispose?.(); } catch { /* Best effort. */ }
    this.renderer = null;
    this.available = false;
    this.disposed = true;
  }
}

export function createVehiclePreview(options) {
  return new VehiclePreview(options);
}
