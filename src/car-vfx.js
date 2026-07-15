import * as THREE from 'three';

const POOL_LIMITS = Object.freeze({
  smoke: 72,
  dust: 72,
  exhaust: 36,
  backfire: 20,
  sparks: 64,
  skids: 96,
});

const HIDDEN_Y = -10000;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const vectorIsFinite = (vector) => Number.isFinite(vector?.x)
  && Number.isFinite(vector?.y)
  && Number.isFinite(vector?.z);

function createRadialParticleTexture(size = 32) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const alpha = clamp01(1 - radius);
      const softened = alpha * alpha * (3 - 2 * alpha);
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(softened * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'SharedProceduralParticleRadialAlpha';
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function readSignal(source, keys, fallback = 0) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

class ParticlePool {
  constructor(parent, capacity, options) {
    this.capacity = capacity;
    this.cursor = 0;
    this.active = new Uint8Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.velocity = new Float32Array(capacity * 3);
    this.baseColor = new Float32Array(capacity * 3);
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.gravity = options.gravity ?? 0;
    this.drag = options.drag ?? 0;

    for (let index = 0; index < capacity; index += 1) this.positions[index * 3 + 1] = HIDDEN_Y;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    // WebGPURenderer requests a UV stream for mapped point materials even
    // though the soft particle shape is sampled in point coordinates.
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(capacity * 2), 2));
    this.material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: options.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: options.opacity,
      depthWrite: false,
      vertexColors: true,
      map: options.texture,
      alphaTest: 0.012,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = options.name;
    this.points.frustumCulled = false;
    this.points.renderOrder = options.additive ? 5 : 3;
    parent.add(this.points);
  }

  emit(position, velocity, life, color) {
    if (!vectorIsFinite(position) || !vectorIsFinite(velocity) || !Number.isFinite(life) || life <= 0) return;
    const index = this.cursor;
    const offset = index * 3;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.active[index] = 1;
    this.life[index] = life;
    this.maxLife[index] = life;
    this.positions[offset] = position.x;
    this.positions[offset + 1] = position.y;
    this.positions[offset + 2] = position.z;
    this.velocity[offset] = velocity.x;
    this.velocity[offset + 1] = velocity.y;
    this.velocity[offset + 2] = velocity.z;
    this.baseColor[offset] = color.r;
    this.baseColor[offset + 1] = color.g;
    this.baseColor[offset + 2] = color.b;
    this.colors[offset] = color.r;
    this.colors[offset + 1] = color.g;
    this.colors[offset + 2] = color.b;
  }

  update(dt) {
    const drag = Math.exp(-this.drag * dt);
    for (let index = 0; index < this.capacity; index += 1) {
      if (!this.active[index]) continue;
      const offset = index * 3;
      this.life[index] -= dt;
      if (this.life[index] <= 0) {
        this.active[index] = 0;
        this.positions[offset] = 0;
        this.positions[offset + 1] = HIDDEN_Y;
        this.positions[offset + 2] = 0;
        continue;
      }

      this.velocity[offset] *= drag;
      this.velocity[offset + 1] = this.velocity[offset + 1] * drag + this.gravity * dt;
      this.velocity[offset + 2] *= drag;
      this.positions[offset] += this.velocity[offset] * dt;
      this.positions[offset + 1] += this.velocity[offset + 1] * dt;
      this.positions[offset + 2] += this.velocity[offset + 2] * dt;
      const fade = clamp01(this.life[index] / this.maxLife[index]);
      this.colors[offset] = this.baseColor[offset] * fade;
      this.colors[offset + 1] = this.baseColor[offset + 1] * fade;
      this.colors[offset + 2] = this.baseColor[offset + 2] * fade;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  reset() {
    this.active.fill(0);
    this.life.fill(0);
    for (let index = 0; index < this.capacity; index += 1) {
      const offset = index * 3;
      this.positions[offset] = 0;
      this.positions[offset + 1] = HIDDEN_Y;
      this.positions[offset + 2] = 0;
      this.colors[offset] = 0;
      this.colors[offset + 1] = 0;
      this.colors[offset + 2] = 0;
    }
    this.cursor = 0;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

class SkidMarkPool {
  constructor(parent, capacity) {
    this.capacity = capacity;
    this.cursor = 0;
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({
      color: 0x141716,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.name = 'BoundedSkidMarks';
    this.mesh.frustumCulled = false;
    this.matrix = new THREE.Matrix4();
    this.right = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 0.012, 0);
    this.midpoint = new THREE.Vector3();
    parent.add(this.mesh);
    this.reset();
  }

  add(start, end) {
    if (!vectorIsFinite(start) || !vectorIsFinite(end)) return;
    this.forward.subVectors(end, start);
    this.forward.y = 0;
    const length = this.forward.length();
    if (length < 0.18 || length > 2.8) return;
    this.forward.multiplyScalar(1 / length).multiplyScalar(length);
    this.right.set(this.forward.z / length, 0, -this.forward.x / length).multiplyScalar(0.16);
    this.midpoint.addVectors(start, end).multiplyScalar(0.5);
    this.midpoint.y = Math.min(start.y, end.y) + 0.018;
    this.matrix.makeBasis(this.right, this.forward, this.up);
    this.matrix.setPosition(this.midpoint);
    this.mesh.setMatrixAt(this.cursor, this.matrix);
    this.cursor = (this.cursor + 1) % this.capacity;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  reset() {
    this.matrix.makeScale(0, 0, 0);
    this.matrix.setPosition(0, HIDDEN_Y, 0);
    for (let index = 0; index < this.capacity; index += 1) this.mesh.setMatrixAt(index, this.matrix);
    this.cursor = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class CarVfxSystem {
  constructor(scene, vehicle) {
    this.scene = scene ?? null;
    this.vehicle = vehicle ?? null;
    this.vehicleObject = vehicle?.group?.isObject3D ? vehicle.group : (vehicle?.isObject3D ? vehicle : null);
    this.root = new THREE.Group();
    this.root.name = 'CarVfxSystem';
    this.scene?.add?.(this.root);
    this.reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.motionScale = this.reducedMotion ? 0.3 : 1;
    this.disposed = false;
    this.emitRemainders = Object.create(null);
    this.lastRear = [null, null];
    this.previousThrottle = 0;
    this.backfireCooldown = 0;
    this.impactCooldown = 0;
    this.worldQuaternion = new THREE.Quaternion();
    this.tempPosition = new THREE.Vector3();
    this.tempVelocity = new THREE.Vector3();
    this.rearDirection = new THREE.Vector3();
    this.particleTexture = createRadialParticleTexture();
    this.brakeGlows = [];

    this.smoke = new ParticlePool(this.root, POOL_LIMITS.smoke, {
      name: 'RearTireSmokePool', size: 0.72, opacity: 0.34, gravity: 0.5, drag: 1.2,
      texture: this.particleTexture,
    });
    this.dust = new ParticlePool(this.root, POOL_LIMITS.dust, {
      name: 'GravelDustPool', size: 0.24, opacity: 0.72, gravity: -1.8, drag: 0.65,
      texture: this.particleTexture,
    });
    this.exhaust = new ParticlePool(this.root, POOL_LIMITS.exhaust, {
      name: 'ExhaustPool', size: 0.34, opacity: 0.3, gravity: 0.22, drag: 1.8,
      texture: this.particleTexture,
    });
    this.backfire = new ParticlePool(this.root, POOL_LIMITS.backfire, {
      name: 'BackfirePool', size: 0.22, opacity: 0.9, gravity: 0, drag: 4.5, additive: true,
      texture: this.particleTexture,
    });
    this.sparks = new ParticlePool(this.root, POOL_LIMITS.sparks, {
      name: 'SparkPool', size: 0.12, opacity: 0.95, gravity: -8.5, drag: 0.12, additive: true,
      texture: this.particleTexture,
    });
    this.skids = new SkidMarkPool(this.root, POOL_LIMITS.skids);
    this.#createBrakeGlows();
  }

  update(dt, elapsed, telemetry = {}) {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    this.smoke.update(dt);
    this.dust.update(dt);
    this.exhaust.update(dt);
    this.backfire.update(dt);
    this.sparks.update(dt);
    this.backfireCooldown = Math.max(0, this.backfireCooldown - dt);
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    if (!this.vehicleObject || !vectorIsFinite(this.vehicleObject.position)) return;

    this.vehicleObject.updateWorldMatrix(true, false);
    this.vehicleObject.getWorldQuaternion(this.worldQuaternion);
    const speed = Math.abs(readSignal(telemetry, ['speedMps', 'speed'], this.vehicle?.speedMps ?? 0));
    const slip = clamp01(Math.abs(readSignal(telemetry, ['slip', 'slipRatio', 'lateralSlip'], 0)));
    const drift = clamp01(Math.abs(readSignal(telemetry, ['drift', 'driftAmount'], 0)));
    const brake = clamp01(Math.max(
      readSignal(telemetry, ['brake', 'brakeAmount', 'braking'], 0),
      readSignal(telemetry, ['handbrake'], 0),
    ));
    const isMotorbike = this.vehicle?.getSelection?.().vehicleType === 'motorbike';
    this.#updateBrakeGlows(dt, brake, isMotorbike);
    const terrainOffRoad = /gravel|dirt|grass/i.test(String(telemetry.surface ?? '')) ? 1 : 0;
    const offRoad = clamp01(Math.max(
      readSignal(telemetry, ['offRoad', 'offroad', 'isOffRoad', 'onGrass'], 0),
      terrainOffRoad,
    ));
    const throttle = clamp01(readSignal(telemetry, ['throttle', 'accelerator'], 0));
    const boost = clamp01(readSignal(telemetry, ['boost', 'boosting'], 0));
    const wheelContacts = this.vehicle?.getWheelWorldPositions?.() ?? [];
    const rear = wheelContacts.length >= 2
      ? wheelContacts.slice(0, 2)
      : [
          this.#worldPoint(isMotorbike ? -0.12 : -0.83, isMotorbike ? -0.46 : -0.34, isMotorbike ? 1.1 : 1.42),
          this.#worldPoint(isMotorbike ? 0.12 : 0.83, isMotorbike ? -0.46 : -0.34, isMotorbike ? 1.1 : 1.42),
        ];
    this.rearDirection.set(0, 0, 1).applyQuaternion(this.worldQuaternion).normalize();

    const smokeSignal = clamp01((slip + drift * 0.9 + brake * clamp01(speed / 14)) - 0.25);
    rear.forEach((position, side) => {
      if (!position) return;
      this.#emitRate(`smoke${side}`, smokeSignal * (12 + speed * 0.55) * this.motionScale, dt, () => {
        this.tempVelocity.copy(this.rearDirection).multiplyScalar(speed * 0.07);
        this.tempVelocity.x += (Math.random() - 0.5) * 0.8;
        this.tempVelocity.y = 0.45 + Math.random() * 0.65;
        this.tempVelocity.z += (Math.random() - 0.5) * 0.8;
        this.smoke.emit(position, this.tempVelocity, 0.7 + Math.random() * 0.65, new THREE.Color(0.58, 0.61, 0.59));
      });
      this.#emitRate(`dust${side}`, offRoad * clamp01(speed / 4) * (15 + speed * 0.7) * this.motionScale, dt, () => {
        this.tempVelocity.copy(this.rearDirection).multiplyScalar(1.2 + speed * 0.09);
        this.tempVelocity.x += (Math.random() - 0.5) * 1.7;
        this.tempVelocity.y = 0.8 + Math.random() * 1.5;
        this.tempVelocity.z += (Math.random() - 0.5) * 1.7;
        this.dust.emit(position, this.tempVelocity, 0.5 + Math.random() * 0.55, new THREE.Color(0.46, 0.35, 0.22));
      });
    });

    const skidActive = speed > 3 && offRoad < 0.72 && (brake > 0.28 || slip > 0.32 || drift > 0.34);
    this.#updateSkids(rear, skidActive);
    const exhaustHalfWidth = isMotorbike ? 0.31 : 0.56;
    const exhaustHeight = isMotorbike ? 0.26 : 0.05;
    const exhaustRear = isMotorbike ? 1.37 : 2.4;
    const exhaustPositions = [
      this.#worldPoint(-exhaustHalfWidth, exhaustHeight, exhaustRear),
      ...(boost > 0.5 && !isMotorbike ? [this.#worldPoint(exhaustHalfWidth, exhaustHeight, exhaustRear)] : []),
    ].filter(Boolean);
    if (exhaustPositions.length) {
      const exhaustRate = (2.3 + clamp01(speed / 20) * 4.5 + boost * 14) * this.motionScale;
      exhaustPositions.forEach((exhaustPosition, exhaustIndex) => {
        this.#emitRate(`exhaust${exhaustIndex}`, exhaustRate / exhaustPositions.length, dt, () => {
          this.tempVelocity.copy(this.rearDirection).multiplyScalar(0.65 + speed * 0.035 + boost * 2.2);
          this.tempVelocity.y = 0.18 + Math.random() * 0.22;
          const exhaustColor = boost ? new THREE.Color(0.18, 0.7, 1) : new THREE.Color(0.42, 0.45, 0.44);
          this.exhaust.emit(exhaustPosition, this.tempVelocity, 0.55 + Math.random() * 0.35, exhaustColor);
        });
      });
      const requestedBackfire = readSignal(telemetry, ['backfire'], 0) > 0
        || (this.previousThrottle - throttle > 0.48 && speed > 7)
        || (boost > 0.5 && speed > 10);
      if (requestedBackfire && this.backfireCooldown <= 0) {
        for (const exhaustPosition of exhaustPositions) this.#emitBackfire(exhaustPosition);
        this.backfireCooldown = 0.22;
      }
    }

    const impact = Math.abs(readSignal(telemetry, ['impact', 'collision', 'crashImpact', 'scrape'], 0));
    if (impact > 0.42 && this.impactCooldown <= 0) {
      this.burstCrash(this.#worldPoint(0, -0.2, 0));
      this.impactCooldown = 0.45;
    }
    this.previousThrottle = throttle;
    void elapsed;
  }

  burstCrash(position) {
    if (this.disposed) return;
    const origin = vectorIsFinite(position)
      ? this.tempPosition.copy(position)
      : this.#worldPoint(0, 0, 0);
    if (!origin) return;
    const sparkCount = this.reducedMotion ? 7 : 22;
    for (let index = 0; index < sparkCount; index += 1) {
      this.tempVelocity.set(
        (Math.random() - 0.5) * 10,
        1.5 + Math.random() * 7,
        (Math.random() - 0.5) * 10,
      );
      const color = Math.random() > 0.35 ? new THREE.Color(1, 0.43, 0.08) : new THREE.Color(1, 0.88, 0.38);
      this.sparks.emit(origin, this.tempVelocity, 0.24 + Math.random() * 0.48, color);
    }
    for (let index = 0; index < (this.reducedMotion ? 2 : 7); index += 1) {
      this.tempVelocity.set((Math.random() - 0.5) * 3, 0.8 + Math.random() * 2, (Math.random() - 0.5) * 3);
      this.dust.emit(origin, this.tempVelocity, 0.45 + Math.random() * 0.5, new THREE.Color(0.38, 0.31, 0.23));
    }
  }

  reset() {
    if (this.disposed) return;
    this.smoke.reset();
    this.dust.reset();
    this.exhaust.reset();
    this.backfire.reset();
    this.sparks.reset();
    this.skids.reset();
    this.emitRemainders = Object.create(null);
    this.lastRear = [null, null];
    this.previousThrottle = 0;
    this.backfireCooldown = 0;
    this.impactCooldown = 0;
    for (const glow of this.brakeGlows) glow.material.opacity = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.smoke.dispose();
    this.dust.dispose();
    this.exhaust.dispose();
    this.backfire.dispose();
    this.sparks.dispose();
    this.skids.dispose();
    for (const glow of this.brakeGlows) {
      glow.removeFromParent();
      glow.material.dispose();
    }
    this.brakeGlows.length = 0;
    this.particleTexture.dispose();
    this.root.removeFromParent();
    this.scene = null;
    this.vehicle = null;
    this.vehicleObject = null;
  }

  #worldPoint(x, y, z) {
    this.tempPosition.set(x, y, z);
    this.vehicleObject.localToWorld(this.tempPosition);
    return vectorIsFinite(this.tempPosition) ? this.tempPosition.clone() : null;
  }

  #createBrakeGlows() {
    if (!this.vehicleObject) return;
    for (const side of [-1, 1]) {
      const material = new THREE.SpriteMaterial({
        color: 0xff172f,
        map: this.particleTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const glow = new THREE.Sprite(material);
      glow.name = side < 0 ? 'RearBrakeGlowLeft' : 'RearBrakeGlowRight';
      glow.position.set(side * 0.65, 0.72, 2.29);
      glow.scale.set(0.72, 0.34, 1);
      glow.renderOrder = 6;
      this.vehicleObject.add(glow);
      this.brakeGlows.push(glow);
    }
  }

  #updateBrakeGlows(dt, brake, isMotorbike = false) {
    const target = clamp01(brake) * 0.92;
    for (const [index, glow] of this.brakeGlows.entries()) {
      const side = index === 0 ? -1 : 1;
      glow.position.set(
        side * (isMotorbike ? 0.08 : 0.65),
        isMotorbike ? 0.79 : 0.72,
        isMotorbike ? 1.42 : 2.29,
      );
      glow.scale.set(isMotorbike ? 0.3 : 0.72, isMotorbike ? 0.22 : 0.34, 1);
      glow.material.opacity = THREE.MathUtils.damp(glow.material.opacity, target, 18, dt);
    }
  }

  #emitRate(key, rate, dt, emit) {
    const amount = finite(this.emitRemainders[key]) + Math.max(0, finite(rate)) * dt;
    const count = Math.min(5, Math.floor(amount));
    this.emitRemainders[key] = Math.min(1, amount - count);
    for (let index = 0; index < count; index += 1) emit();
  }

  #updateSkids(rear, active) {
    if (!active || rear.some((position) => !position)) {
      this.lastRear = [null, null];
      return;
    }
    rear.forEach((position, index) => {
      const previous = this.lastRear[index];
      if (!previous) {
        this.lastRear[index] = position.clone();
        return;
      }
      const distance = previous.distanceTo(position);
      if (distance >= 0.34 && distance <= 2.8) {
        this.skids.add(previous, position);
        previous.copy(position);
      } else if (distance > 2.8) previous.copy(position);
    });
  }

  #emitBackfire(position) {
    const count = this.reducedMotion ? 2 : 6;
    for (let index = 0; index < count; index += 1) {
      this.tempVelocity.copy(this.rearDirection).multiplyScalar(2.2 + Math.random() * 2.8);
      this.tempVelocity.x += (Math.random() - 0.5) * 0.5;
      this.tempVelocity.y += (Math.random() - 0.5) * 0.35;
      const color = index % 2 ? new THREE.Color(1, 0.18, 0.02) : new THREE.Color(1, 0.74, 0.18);
      this.backfire.emit(position, this.tempVelocity, 0.08 + Math.random() * 0.13, color);
    }
  }
}
