import * as THREE from 'three';

const ORBIT_SPEED = 0.0055;
const KEY_ORBIT_SPEED = 1.6;
const MIN_PHI = 0.22;
const MAX_PHI = Math.PI / 2 - 0.04;
const MIN_RADIUS = 7;
const MAX_RADIUS = 30;

/**
 * Camera orbit plus the raycast that turns a pointer into paint.
 *
 * Left button (or a single touch) paints; right button (or two touches) orbits.
 * Drags are interpolated in UV space so a fast sweep leaves a stroke rather than
 * a dotted line.
 */
export class Painter {
  constructor({ camera, domElement, target = new THREE.Vector3(0, 2.2, 0) }) {
    this.camera = camera;
    this.domElement = domElement;
    this.target = target;

    this.spherical = new THREE.Spherical(17, 1.15, 0.72);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.paintTargets = [];
    this.brushRadius = 0.45;
    this.color = '#d8452f';
    this.enabled = false;

    this.painting = false;
    this.orbiting = false;
    this.activePointers = new Map();
    this.lastOrbit = { x: 0, y: 0 };
    this.lastHit = null;
    this.keys = new Set();

    this.onStroke = () => {};

    this.#bind();
    this.updateCamera();
  }

  setTargets(meshes) {
    this.paintTargets = meshes;
  }

  #bind() {
    const element = this.domElement;
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    element.addEventListener('pointerdown', this.#onPointerDown);
    element.addEventListener('pointermove', this.#onPointerMove);
    element.addEventListener('pointerup', this.#onPointerUp);
    element.addEventListener('pointercancel', this.#onPointerUp);
    element.addEventListener('pointerleave', this.#onPointerUp);
    element.addEventListener('wheel', this.#onWheel, { passive: false });
    window.addEventListener('keydown', this.#onKeyDown);
    window.addEventListener('keyup', this.#onKeyUp);
  }

  #onPointerDown = (event) => {
    if (!this.enabled) return;
    this.domElement.setPointerCapture?.(event.pointerId);
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.lastOrbit = { x: event.clientX, y: event.clientY };

    const wantsOrbit = event.button === 2 || event.button === 1 || this.activePointers.size > 1;
    if (wantsOrbit) {
      this.orbiting = true;
      this.painting = false;
      this.lastHit = null;
      return;
    }

    this.painting = true;
    this.lastHit = null;
    this.#paintAt(event);
  };

  #onPointerMove = (event) => {
    if (!this.enabled) return;
    if (this.activePointers.has(event.pointerId)) {
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (this.orbiting) {
      const dx = event.clientX - this.lastOrbit.x;
      const dy = event.clientY - this.lastOrbit.y;
      this.lastOrbit = { x: event.clientX, y: event.clientY };
      this.spherical.theta -= dx * ORBIT_SPEED;
      this.spherical.phi = THREE.MathUtils.clamp(
        this.spherical.phi - dy * ORBIT_SPEED,
        MIN_PHI,
        MAX_PHI,
      );
      this.updateCamera();
      return;
    }

    if (this.painting) this.#paintAt(event);
  };

  #onPointerUp = (event) => {
    this.activePointers.delete(event.pointerId);
    if (this.activePointers.size === 0) {
      this.painting = false;
      this.orbiting = false;
      this.lastHit = null;
    }
  };

  #onWheel = (event) => {
    if (!this.enabled) return;
    event.preventDefault();
    this.spherical.radius = THREE.MathUtils.clamp(
      this.spherical.radius + Math.sign(event.deltaY) * 1.1,
      MIN_RADIUS,
      MAX_RADIUS,
    );
    this.updateCamera();
  };

  #onKeyDown = (event) => {
    this.keys.add(event.code);
  };

  #onKeyUp = (event) => {
    this.keys.delete(event.code);
  };

  #paintAt(event) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const [hit] = this.raycaster.intersectObjects(this.paintTargets, false);
    if (!hit?.uv) {
      this.lastHit = null;
      return;
    }

    const surface = hit.object.userData.surface;
    if (!surface) return;

    // Fill in the gap since the previous sample so fast drags stay continuous.
    if (this.lastHit && this.lastHit.mesh === hit.object) {
      const from = this.lastHit.uv;
      const gap = Math.hypot(
        (hit.uv.x - from.x) * surface.width,
        (hit.uv.y - from.y) * surface.height,
      );
      const steps = Math.min(24, Math.ceil(gap / (this.brushRadius * 0.45)));
      for (let step = 1; step < steps; step += 1) {
        const t = step / steps;
        surface.paint(
          new THREE.Vector2(
            THREE.MathUtils.lerp(from.x, hit.uv.x, t),
            THREE.MathUtils.lerp(from.y, hit.uv.y, t),
          ),
          this.color,
          this.brushRadius,
        );
      }
    }

    surface.paint(hit.uv, this.color, this.brushRadius);
    this.lastHit = { mesh: hit.object, uv: hit.uv.clone() };
    this.onStroke(hit);
  }

  update(delta) {
    if (!this.enabled) return;
    let changed = false;

    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) {
      this.spherical.theta += KEY_ORBIT_SPEED * delta;
      changed = true;
    }
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) {
      this.spherical.theta -= KEY_ORBIT_SPEED * delta;
      changed = true;
    }
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) {
      this.spherical.phi = THREE.MathUtils.clamp(
        this.spherical.phi - KEY_ORBIT_SPEED * delta * 0.6,
        MIN_PHI,
        MAX_PHI,
      );
      changed = true;
    }
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) {
      this.spherical.phi = THREE.MathUtils.clamp(
        this.spherical.phi + KEY_ORBIT_SPEED * delta * 0.6,
        MIN_PHI,
        MAX_PHI,
      );
      changed = true;
    }
    if (this.keys.has('KeyQ')) {
      this.spherical.radius = THREE.MathUtils.clamp(
        this.spherical.radius - 8 * delta,
        MIN_RADIUS,
        MAX_RADIUS,
      );
      changed = true;
    }
    if (this.keys.has('KeyE')) {
      this.spherical.radius = THREE.MathUtils.clamp(
        this.spherical.radius + 8 * delta,
        MIN_RADIUS,
        MAX_RADIUS,
      );
      changed = true;
    }

    if (changed) this.updateCamera();
  }

  updateCamera() {
    this.camera.position.setFromSpherical(this.spherical).add(this.target);
    this.camera.lookAt(this.target);
  }

  reset() {
    this.spherical.set(17, 1.15, 0.72);
    this.updateCamera();
  }
}
