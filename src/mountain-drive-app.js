import * as THREE from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { int, mrt, output, pass, uniform, vec2, velocity } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { buildEnvironment } from './environment.js';
import { buildDetailedTrees } from './detailed-trees.js';
import { buildWorldDetail } from './world-detail.js';
import { ArcadeVehicle } from './vehicle.js';
import { TrafficSystem } from './traffic.js';
import { CarVfxSystem } from './car-vfx.js';
import { RoadRadio } from './radio.js';
import { AtmosphereSystem } from './atmosphere.js';
import { WeatherSystem } from './weather-system.js';
import { DayNightCycle } from './day-night-cycle.js';
import { InputController } from './input.js';
import { registerStreamedHouses } from './chunk-decorators.js';
import { CameraController } from './camera-controller.js';
import { CinematicCameraEffects } from './cinematic-camera-effects.js';
import { RuntimeHealth, isFiniteObject3D, sanitizeRendererExposure } from './runtime-health.js';
import { EDGE_BLOOM_RADIUS, EDGE_BLOOM_STRENGTH, EDGE_BLOOM_THRESHOLD } from './render-effects-config.js';

const SKY_COLOR = 0x9cb8c7;
const FOG_COLOR = 0xb7c3bd;

export class MountainDriveApp {
  constructor(canvas, ui, { environmentProfile = null } = {}) {
    this.canvas = canvas;
    this.ui = ui;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.00225);
    // The stream always owns at least 880 m ahead; keeping the far plane inside
    // that guarantee makes a generated edge mathematically impossible to see.
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 780);
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.started = false;
    this.hasDriven = false;
    this.crashed = false;
    this.distance = 0;
    try {
      this.bestDistance = Number.parseInt(localStorage.getItem('ny-drive-best-distance') ?? '0', 10) || 0;
    } catch {
      this.bestDistance = 0;
    }
    this.score = 0;
    this.environment = null;
    this.environmentProfile = environmentProfile;
    this.environmentRebuildPromise = null;
    this.route = null;
    this.detailedTrees = null;
    this.worldDetail = null;
    this.vehicle = null;
    this.traffic = null;
    this.carVfx = null;
    this.radio = null;
    this.atmosphere = null;
    this.weather = null;
    this.dayNight = null;
    this.lighting = null;
    this.input = null;
    this.cameraController = null;
    this.cinematicEffects = null;
    this.cinematicState = null;
    this.previousCinematicSpeed = 0;
    this.renderer = null;
    this.renderPipeline = null;
    this.rendererName = '';
    this.cameraTarget = new THREE.Vector3();
    this.desiredCameraPosition = new THREE.Vector3();
    this.desiredCameraTarget = new THREE.Vector3();
    this.cameraOffset = new THREE.Vector3(0, 3.8, 8.7);
    this.lookOffset = new THREE.Vector3(0, 1.1, -5.8);
    this.boostCameraOffset = new THREE.Vector3();
    this.boostKick = 0;
    this.lastBoosting = false;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.lastNearMisses = 0;
    this.lastVehicleDriftScore = 0;
    this.lastRunnerInput = null;
    this.postFailureReported = false;
    this.initializePromise = null;
    this.initialized = false;
    this.animationLoopInstalled = false;
    this.runtimeHealth = new RuntimeHealth({ recoveryBudget: 1, stableFramesToReset: 180 });
    this.resumeAfterContextRestore = false;
    this.contextRecoveryTimer = null;
    this.onResize = this.onResize.bind(this);
    this.animate = this.animate.bind(this);
    this.onContextLost = this.onContextLost.bind(this);
    this.onContextRestored = this.onContextRestored.bind(this);
  }

  initialize() {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeOnce().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }
    return this.initializePromise;
  }

  async initializeOnce() {
    this.ui.loadingStatus.textContent = 'Selecting the renderer…';
    await this.createRenderer();
    this.configureLighting();

    this.ui.loadingStatus.textContent = 'Growing mountains and forests…';
    this.environment = buildEnvironment(this.scene, { profile: this.environmentProfile });
    this.environmentProfile = this.environment.environmentProfile;
    this.scene.background.set(this.environmentProfile.props.hazeColor);
    this.scene.fog.color.set(this.environmentProfile.props.hazeColor);
    this.scene.fog.density = 0.00225 * this.environmentProfile.props.hazeDensityScale;
    this.route = this.environment;
    this.unregisterStreamedHouses = registerStreamedHouses(this.environment);

    this.ui.loadingStatus.textContent = 'Growing detailed wind-shaped trees…';
    this.detailedTrees = await buildDetailedTrees(this.scene, this.environment);

    this.ui.loadingStatus.textContent = 'Carving ridges and dressing the roadside…';
    this.worldDetail = buildWorldDetail(this.scene, this.environment);

    this.ui.loadingStatus.textContent = 'Populating the endless road…';
    this.vehicle = new ArcadeVehicle(this.scene);
    this.traffic = new TrafficSystem(this.scene, this.environment);
    this.carVfx = new CarVfxSystem(this.scene, this.vehicle);
    this.radio = new RoadRadio((status) => {
      this.ui.radioStatus.textContent = status;
    });
    this.atmosphere = new AtmosphereSystem(this.scene, this.renderer, document.documentElement);
    this.dayNight = new DayNightCycle(this.scene, this.renderer, {
      lighting: this.lighting,
      profile: this.environmentProfile,
      rootElement: document.documentElement,
      reducedMotion: this.reducedMotion,
    });
    this.weather = new WeatherSystem(this.scene, this.renderer, document.documentElement);
    this.input = new InputController(window);
    this.cameraController = new CameraController({
      camera: this.camera,
      vehicle: this.vehicle,
      reducedMotion: this.reducedMotion,
      rootElement: document.documentElement,
    });
    this.cinematicEffects = new CinematicCameraEffects();
    this.cinematicEffects.reset(this.cameraController.modeId);
    this.vehicle.reset(this.route);
    this.setupPostProcessing();
    this.resetCamera(true);

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    this.installAnimationLoop();

    this.ui.loadingStatus.textContent = 'The endless road is ready.';
    this.ui.rendererBadge.textContent = this.rendererName;
    this.ui.loading.hidden = true;
    this.ui.mainMenu.hidden = false;
    this.ui.start.hidden = false;
    this.ui.start.addEventListener('click', () => this.startDriving());
    this.ui.radioToggle.addEventListener('click', async () => {
      await this.radio.toggle();
      this.syncRadioUi();
    });
    this.ui.restart.addEventListener('click', () => this.resetRun(true));
    if (new URLSearchParams(window.location.search).has('autostart')) {
      this.startDriving(false);
    }
    this.initialized = true;
    return this;
  }

  installAnimationLoop() {
    if (this.animationLoopInstalled) return false;
    this.renderer.setAnimationLoop(this.animate);
    this.animationLoopInstalled = true;
    return true;
  }

  async createRenderer() {
    const forceWebGL = new URLSearchParams(window.location.search).has('force-webgl');
    if (!forceWebGL && 'gpu' in navigator) {
      try {
        const renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true, alpha: false });
        await renderer.init();
        this.renderer = renderer;
        this.rendererName = renderer.backend?.isWebGPUBackend === true ? 'WEBGPU' : 'WEBGL FALLBACK';
      } catch (error) {
        console.warn('WebGPU initialization failed; using WebGL fallback.', error);
      }
    }

    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
      this.rendererName = 'WEBGL FALLBACK';
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.observeGraphicsDeviceLoss();
  }

  observeGraphicsDeviceLoss() {
    const lost = this.renderer?.backend?.device?.lost;
    if (!lost || typeof lost.then !== 'function') return;
    lost.then((info) => {
      if (!this.initialized) return;
      this.runtimeHealth.loseContext();
      this.showRuntimeError(
        new Error(`WebGPU device lost: ${info?.reason ?? 'unknown'}`),
        'The WebGPU device stopped responding. Reload the page to continue; your selections are saved.',
      );
    }).catch((error) => {
      console.warn('Could not observe WebGPU device state.', error);
    });
  }

  setupPostProcessing() {
    if (!(this.renderer instanceof WebGPURenderer) || this.renderer.backend?.isWebGPUBackend !== true) return;
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, velocity }));
    const color = scenePass.getTextureNode('output');
    const velocityTexture = scenePass.getTextureNode('velocity');
    const depth = scenePass.getViewZNode('depth');
    this.focusDistance = uniform(16);
    this.aberrationStrength = uniform(0.22);
    this.motionBlurStrength = uniform(0);
    const speedBlur = motionBlur(color, velocityTexture.mul(this.motionBlurStrength), int(6));
    const aperture = dof(speedBlur, depth, this.focusDistance, 46, 0.45);
    const glow = bloom(aperture, EDGE_BLOOM_STRENGTH, EDGE_BLOOM_RADIUS, EDGE_BLOOM_THRESHOLD);
    const lens = chromaticAberration(aperture.add(glow), this.aberrationStrength, vec2(0.5, 0.5), 1.1);
    this.renderPipeline = new RenderPipeline(this.renderer, lens);
  }

  configureLighting() {
    const skyLight = new THREE.HemisphereLight(0xc8dce2, 0x40513a, 2.3);
    skyLight.name = 'DynamicSkyLight';
    this.scene.add(skyLight);

    const sun = new THREE.DirectionalLight(0xffd3a0, 4.4);
    sun.name = 'DynamicSunLight';
    sun.position.set(-85, 110, 65);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 280;
    sun.shadow.bias = -0.00035;
    this.scene.add(sun);

    const warmFill = new THREE.DirectionalLight(0xffa968, 0.65);
    warmFill.name = 'DynamicWarmFill';
    warmFill.position.set(90, 30, -100);
    this.scene.add(warmFill);
    this.scene.add(sun.target);
    this.lighting = Object.freeze({ skyLight, sun, warmFill });
    return this.lighting;
  }

  async startDriving(withAudio = true) {
    if (this.crashed) this.resetRun(false);
    this.started = true;
    this.hasDriven = true;
    this.ui.loading.hidden = true;
    this.ui.mainMenu.hidden = true;
    this.ui.hud.hidden = false;
    this.ui.controls.hidden = false;
    this.ui.radio.hidden = false;
    this.ui.crash.hidden = true;
    this.cameraController.setGameplayActive(true);
    this.canvas.focus?.();
    if (withAudio) {
      await this.radio.start();
      this.syncRadioUi();
    }
  }

  async setEnvironmentProfile(profile) {
    if (!profile?.id || profile.id === this.environmentProfile?.id) return this.environmentProfile;
    if (this.environmentRebuildPromise) return this.environmentRebuildPromise;
    const rebuild = async () => {
      const nextEnvironment = buildEnvironment(this.scene, { profile });
      const unregisterNextHouses = registerStreamedHouses(nextEnvironment);
      let nextDetailedTrees = null;
      let nextWorldDetail = null;
      try {
        nextDetailedTrees = await buildDetailedTrees(this.scene, nextEnvironment);
        nextWorldDetail = buildWorldDetail(this.scene, nextEnvironment);
      } catch (error) {
        unregisterNextHouses();
        nextDetailedTrees?.dispose?.();
        nextWorldDetail?.dispose?.();
        nextEnvironment.dispose();
        throw error;
      }

      this.cameraController?.restoreVehicleVisibility();
      this.unregisterStreamedHouses?.();
      this.detailedTrees?.dispose?.();
      this.worldDetail?.dispose?.();
      this.weather?.dispose?.();
      this.environment?.dispose?.();

      this.environment = nextEnvironment;
      this.route = nextEnvironment;
      this.environmentProfile = nextEnvironment.environmentProfile;
      this.unregisterStreamedHouses = unregisterNextHouses;
      this.detailedTrees = nextDetailedTrees;
      this.worldDetail = nextWorldDetail;
      this.traffic.route = nextEnvironment;
      this.traffic.reset();
      this.weather = new WeatherSystem(this.scene, this.renderer, document.documentElement);
      this.dayNight?.setEnvironmentProfile(this.environmentProfile);
      this.scene.background.set(this.environmentProfile.props.hazeColor);
      this.scene.fog.color.set(this.environmentProfile.props.hazeColor);
      this.scene.fog.density = 0.00225 * this.environmentProfile.props.hazeDensityScale;
      this.resetRun(false);
      this.started = false;
      this.hasDriven = false;
      this.openMenu();
      if (this.ui.locationName) this.ui.locationName.textContent = this.environmentProfile.label.toUpperCase();
      return this.environmentProfile;
    };
    this.environmentRebuildPromise = rebuild().finally(() => {
      this.environmentRebuildPromise = null;
    });
    return this.environmentRebuildPromise;
  }

  resetRun(startImmediately = false) {
    this.vehicle.reset(this.route);
    this.environment.update(0, this.vehicle.group.position);
    this.traffic.reset();
    this.distance = 0;
    this.score = 0;
    this.lastNearMisses = 0;
    this.lastVehicleDriftScore = 0;
    this.crashed = false;
    this.started = startImmediately || this.started;
    this.cameraController.setGameplayActive(this.started && !this.crashed);
    this.ui.crash.hidden = true;
    this.carVfx.reset();
    this.previousCinematicSpeed = 0;
    this.cinematicEffects?.reset(this.cameraController?.modeId ?? 'chase');
    if (startImmediately) {
      this.hasDriven = true;
      this.ui.mainMenu.hidden = true;
      this.ui.hud.hidden = false;
      this.ui.controls.hidden = false;
      this.ui.radio.hidden = false;
    }
    this.resetCamera(true);
  }

  openMenu() {
    if (this.crashed) return;
    this.started = false;
    this.cameraController.setGameplayActive(false);
    this.ui.mainMenu.hidden = false;
    this.ui.start.textContent = this.hasDriven ? 'Continue the drive' : 'Start the drive';
    this.ui.controls.hidden = true;
    this.canvas.blur?.();
    this.ui.start.focus?.();
  }

  crash() {
    this.crashed = true;
    this.started = false;
    this.cameraController.setGameplayActive(false);
    this.vehicle.speedMps = 0;
    this.vehicle.velocity?.set(0, 0, 0);
    this.carVfx.burstCrash(this.vehicle.group.position);
    if (this.distance > this.bestDistance) {
      this.bestDistance = Math.floor(this.distance);
      try {
        localStorage.setItem('ny-drive-best-distance', String(this.bestDistance));
      } catch {
        // Private browsing can reject storage; the run remains fully playable.
      }
    }
    this.ui.crash.hidden = false;
    this.ui.crashScore.textContent = Math.floor(this.score).toLocaleString();
    this.ui.crashDistance.textContent = `${Math.floor(this.distance)} m`;
    this.ui.transition.classList.remove('impact');
    requestAnimationFrame(() => this.ui.transition.classList.add('impact'));
  }

  animate(timestamp) {
    if (!this.runtimeHealth.beginFrame()) return;
    try {
      this.animateFrame(timestamp);
      this.runtimeHealth.succeedFrame();
    } catch (error) {
      const action = this.runtimeHealth.failFrame(error);
      if (action === 'recover') this.recoverRuntime(error);
      else this.showRuntimeError(error);
    }
  }

  animateFrame(timestamp) {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const elapsed = this.timer.getElapsed();

    this.input.update();
    if (this.input.consumeReset()) this.resetRun(true);
    if (this.input.consumeMenu()) {
      if (this.started) this.openMenu();
      else if (!this.crashed && this.hasDriven) this.startDriving(false);
    }
    if (this.input.consumeMute()) {
      this.radio.muted = !this.radio.muted;
      this.syncRadioUi();
    }
    if (this.input.consumeCamera() && this.started && !this.crashed) {
      this.cameraController.cycle();
      this.resetCamera(false);
    }

    let nearMissDelta = 0;
    if (this.started) {
      const runnerInput = {
        forward: !this.input.back,
        back: false,
        left: this.input.left,
        right: this.input.right,
        handbrake: this.input.handbrake,
        boost: this.input.boost,
      };
      this.lastRunnerInput = runnerInput;
      this.applyRouteAssist(dt);
      this.vehicle.update(dt, runnerInput, this.route);
      if (!this.reducedMotion && this.vehicle.boosting && !this.lastBoosting) this.boostKick = 1;
      this.lastBoosting = this.vehicle.boosting;
      this.distance += Math.max(0, this.vehicle.speedMps) * dt;
      const trafficState = this.traffic.update(dt, this.vehicle, this.distance, this.radio.rhythmState);
      if (trafficState.nearMisses > this.lastNearMisses) {
        nearMissDelta = trafficState.nearMisses - this.lastNearMisses;
        this.score += nearMissDelta * 350;
        this.lastNearMisses = trafficState.nearMisses;
        this.ui.nearMiss.classList.remove('pulse');
        requestAnimationFrame(() => this.ui.nearMiss.classList.add('pulse'));
      }
      this.score += Math.max(0, this.vehicle.speedMps) * dt * (1 + trafficState.difficulty * 0.6);
      const driftDelta = Math.max(0, this.vehicle.driftScore - this.lastVehicleDriftScore);
      this.score += driftDelta;
      this.lastVehicleDriftScore = this.vehicle.driftScore;
      if (trafficState.collision) this.crash();
    }

    this.environment.update(elapsed, this.vehicle.group.position);
    const windStrength = 0.75 + Math.min(Math.abs(this.vehicle.speedMps) / 36, 1) * 1.25;
    this.detailedTrees.update(elapsed, windStrength);
    this.worldDetail.update(elapsed, this.vehicle.group.position);
    this.radio.update(this.distance, elapsed);
    this.atmosphere.update(dt, elapsed, this.distance, this.vehicle.speedMps, this.vehicle, this.camera);
    this.dayNight.update(dt, elapsed, this.vehicle.group.position, this.vehicle);
    this.weather.update(
      dt,
      elapsed,
      this.distance,
      this.vehicle.speedMps,
      this.vehicle.group.position,
      this.camera,
      this.environment.materials?.road,
    );
    const weatherLightScale = Number.isFinite(this.weather.lightScale) ? this.weather.lightScale : 1;
    this.renderer.toneMappingExposure *= THREE.MathUtils.clamp(weatherLightScale, 0.45, 1.1);
    const lateralDistance = Math.abs(
      this.vehicle.group.position.x - this.environment.roadXAt(this.vehicle.group.position.z),
    );
    const offRoad = THREE.MathUtils.clamp((lateralDistance - this.environment.roadHalfWidth * 0.9) / 7.5, 0, 1);
    this.carVfx.update(dt, elapsed, {
      speedMps: this.vehicle.speedMps,
      slip: Math.abs(this.vehicle.slipAngle) / 0.42,
      driftAmount: this.vehicle.driftAmount,
      handbrake: this.lastRunnerInput?.handbrake ? 1 : 0,
      brake: this.input.back ? 1 : 0,
      throttle: this.started ? 1 : 0,
      boost: this.vehicle.boosting ? 1 : 0,
      offRoad,
    });
    const speed = Math.abs(this.vehicle.speedMps);
    const acceleration = dt > 0 ? (speed - this.previousCinematicSpeed) / dt : 0;
    this.previousCinematicSpeed = speed;
    this.cinematicState = this.cinematicEffects.update({
      dt,
      elapsed,
      speed,
      acceleration,
      steer: this.vehicle.steer,
      offRoad,
      nearMissDelta,
      crash: this.crashed,
      weather: this.scene.userData.weather ?? this.weather,
      boost: this.vehicle.boosting,
      reducedMotion: this.reducedMotion,
      cameraMode: this.cameraController.modeId,
    });
    const lens = this.cinematicState.lens;
    document.documentElement.style.setProperty('--cinematic-droplets', lens.droplets.toFixed(3));
    document.documentElement.style.setProperty('--cinematic-anamorphic', lens.anamorphic.toFixed(3));
    document.documentElement.style.setProperty('--cinematic-vignette', lens.vignette.toFixed(3));
    document.documentElement.style.setProperty('--cinematic-transition', this.cinematicState.transitionFactor.toFixed(3));
    const exposurePulse = Number.isFinite(lens.exposurePulse) ? lens.exposurePulse : 0;
    this.renderer.toneMappingExposure *= THREE.MathUtils.clamp(1 + exposurePulse, 0.72, 1.28);
    sanitizeRendererExposure(this.renderer);
    this.updateCamera(dt, elapsed, this.cinematicState);
    this.ensureFiniteRuntimeState();
    this.updateHud();
    this.renderFrame();
  }

  renderFrame() {
    if (this.renderPipeline) {
      try {
        const speedRatio = Math.min(Math.abs(this.vehicle.speedMps) / 50, 1);
        const blurRamp = THREE.MathUtils.smoothstep(speedRatio, 0.36, 1);
        const cinematicBlurScale = this.cinematicState?.blurScale ?? this.cameraController.blurScale;
        const cinematicExtraBlur = this.cinematicState?.blurExtraStrength ?? 0;
        this.motionBlurStrength.value = this.reducedMotion
          ? 0
          : Math.min(0.42, (blurRamp * 0.28 + (this.vehicle.boosting ? 0.07 : 0)) * cinematicBlurScale + cinematicExtraBlur);
        const cinematicAberration = this.cinematicState?.lens?.chromaticAberrationPx ?? 0;
        this.aberrationStrength.value = Math.min(0.86, 0.16 + speedRatio * 0.42 + cinematicAberration * 0.12);
        this.focusDistance.value = 14 + speedRatio * 8;
        this.renderPipeline.render();
        return;
      } catch (error) {
        this.renderPipeline.dispose();
        this.renderPipeline = null;
        if (!this.postFailureReported) {
          console.warn('WebGPU lens pipeline unavailable; continuing with CSS lens effects.', error);
          this.postFailureReported = true;
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  ensureFiniteRuntimeState() {
    const finiteCamera = isFiniteObject3D(this.camera)
      && Number.isFinite(this.camera.fov)
      && this.camera.fov >= 20
      && this.camera.fov <= 120;
    const finiteVehicle = isFiniteObject3D(this.vehicle?.group)
      && Number.isFinite(this.vehicle?.speedMps)
      && Number.isFinite(this.vehicle?.heading);
    if (!finiteVehicle) {
      throw new Error('Non-finite vehicle transform detected.');
    }
    if (!finiteCamera) {
      throw new Error('Non-finite camera transform detected.');
    }
  }

  recoverRuntime(error) {
    console.warn('Drive runtime recovered after a frame failure.', error);
    try {
      this.renderPipeline?.dispose?.();
    } catch {
      // A failed pipeline may already have released its targets.
    }
    this.renderPipeline = null;
    this.postFailureReported = true;
    this.renderer?.resetState?.();
    sanitizeRendererExposure(this.renderer);

    if (!isFiniteObject3D(this.vehicle?.group)
      || !Number.isFinite(this.vehicle?.speedMps)
      || !Number.isFinite(this.vehicle?.heading)) {
      this.vehicle?.reset?.(this.route);
      this.traffic?.reset?.();
      this.carVfx?.reset?.();
    }
    if (!isFiniteObject3D(this.camera) || !Number.isFinite(this.camera.fov)) this.resetCamera(true);
    this.ui.rendererBadge.textContent = `${this.rendererName} · SAFE LENS`;
    this.ui.error.hidden = true;
  }

  showRuntimeError(error, message = '') {
    console.error('Drive runtime could not recover.', error);
    this.started = false;
    this.cameraController?.setGameplayActive(false);
    this.ui.controls.hidden = true;
    this.ui.mainMenu.hidden = false;
    this.ui.start.textContent = 'Try the drive again';
    this.ui.error.hidden = false;
    this.ui.error.textContent = message
      || 'The graphics renderer stopped responding. The menu is still available; try the drive again or reload the page.';
  }

  onContextLost(event) {
    event?.preventDefault?.();
    if (this.runtimeHealth.contextLost) return;
    this.resumeAfterContextRestore = this.started;
    this.runtimeHealth.loseContext();
    this.started = false;
    this.cameraController?.setGameplayActive(false);
    this.ui.controls.hidden = true;
    this.ui.mainMenu.hidden = false;
    this.ui.error.hidden = false;
    this.ui.error.textContent = 'Graphics context paused. Restoring the road…';
    clearTimeout(this.contextRecoveryTimer);
    this.contextRecoveryTimer = setTimeout(() => {
      if (this.runtimeHealth.contextLost) {
        this.showRuntimeError(
          new Error('Graphics context restoration timed out.'),
          'The graphics context could not be restored. Reload the page to continue; your selections are saved.',
        );
      }
    }, 8000);
  }

  onContextRestored() {
    clearTimeout(this.contextRecoveryTimer);
    this.contextRecoveryTimer = null;
    try {
      this.renderer?.resetState?.();
      this.renderPipeline?.dispose?.();
      this.renderPipeline = null;
      this.setupPostProcessing();
      sanitizeRendererExposure(this.renderer);
      this.resetCamera(true);
      this.runtimeHealth.restoreContext();
      this.ui.error.hidden = true;
      this.ui.rendererBadge.textContent = this.rendererName;
      if (this.resumeAfterContextRestore) this.startDriving(false);
    } catch (error) {
      this.runtimeHealth.restoreContext();
      this.showRuntimeError(error, 'Graphics returned, but the road could not be rebuilt. Reload the page to continue.');
    } finally {
      this.resumeAfterContextRestore = false;
    }
  }

  applyRouteAssist(dt) {
    const position = this.vehicle.group.position;
    const lookAheadZ = position.z - 18;
    const roadHeading = this.environment.roadHeadingAt(lookAheadZ);
    const targetX = this.environment.roadXAt(lookAheadZ) + Math.cos(roadHeading) * 2.3;
    const deltaX = targetX - position.x;
    const deltaZ = lookAheadZ - position.z;
    const desiredHeading = Math.atan2(-deltaX, -deltaZ);
    const playerDodging = this.input.left || this.input.right;
    const strength = playerDodging ? 0.42 : 2.8;
    this.vehicle.setRouteAssistHeading(desiredHeading, strength, dt);
  }

  updateCamera(dt, elapsed, effects = null) {
    this.cameraController.update(dt, elapsed, {
      speedMps: this.vehicle.speedMps,
      boosting: this.vehicle.boosting,
      steer: this.vehicle.steer,
      effects,
    });
  }

  resetCamera(immediate = false) {
    this.cameraController?.reset(immediate);
  }

  updateHud() {
    const mph = Math.round(Math.abs(this.vehicle.speedMps) * 2.23694);
    this.ui.speed.innerHTML = `${mph} <span>MPH</span>`;
    this.ui.distance.textContent = `${Math.floor(this.distance)} m`;
    this.ui.bestDistance.textContent = `BEST ${this.bestDistance} m`;
    this.ui.score.textContent = Math.floor(this.score).toLocaleString();
    const boostPercent = Math.round(this.vehicle.boostAmount * 100);
    this.ui.boostPercent.textContent = `${boostPercent}%`;
    this.ui.boostFill.style.width = `${boostPercent}%`;
    this.ui.boostReadout.classList.toggle('is-boosting', this.vehicle.boosting);
    this.ui.nearMiss.textContent = `${this.lastNearMisses} NEAR MISS${this.lastNearMisses === 1 ? '' : 'ES'}`;
    this.ui.skyPhase.textContent = `${this.dayNight.phaseName} · ${this.weather.name}`;
    this.ui.cameraMode.textContent = this.cameraController.modeLabel.toUpperCase();
    const driftDegrees = Math.abs(THREE.MathUtils.radToDeg(this.vehicle.slipAngle));
    this.ui.driftLabel.textContent = this.vehicle.isDrifting ? 'DRIFT' : 'GRIP';
    this.ui.driftAngle.textContent = `${Math.round(driftDegrees)}°`;
    this.ui.driftFill.style.width = `${Math.round(this.vehicle.driftAmount * 100)}%`;
    this.ui.driftScore.textContent = `${Math.floor(this.vehicle.driftScore).toLocaleString()} × ${this.vehicle.driftMultiplier.toFixed(1)}`;
    this.ui.driftReadout.classList.toggle('is-drifting', this.vehicle.isDrifting);
  }

  syncRadioUi() {
    const active = this.radio.enabled && !this.radio.muted;
    this.ui.radioToggle.textContent = active ? 'Mute radio' : 'Play radio';
    this.ui.radioToggle.setAttribute('aria-pressed', String(active));
  }

  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
