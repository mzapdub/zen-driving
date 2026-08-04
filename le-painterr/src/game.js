import * as THREE from 'three';
import { createRenderer, createWorld } from './world.js';
import { buildHouse } from './house.js';
import { loadGameTextures } from './textures.js';
import { Painter } from './painter.js';
import { Hud, PAINTS } from './hud.js';

const COMPLETION_THRESHOLD = 0.985;

export class LePainterrGame {
  constructor({ canvas, elements }) {
    this.canvas = canvas;
    this.hud = new Hud(elements);
    this.clock = new THREE.Clock();
    this.state = 'loading';
    this.elapsed = 0;
    this.surfaces = [];
  }

  async load() {
    this.hud.showScreen('loading');
    this.renderer = createRenderer(this.canvas);

    this.hud.setLoadingStatus('Loading textures…');
    const textures = await loadGameTextures(this.renderer, (loaded, total) => {
      this.hud.setLoadingStatus(`Loading textures… ${loaded}/${total}`);
    });

    this.hud.setLoadingStatus('Raising the walls…');
    const { scene, camera, sun } = createWorld(textures);
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;

    const house = buildHouse(textures, textures.brushStamp);
    this.surfaces = house.surfaces;
    scene.add(house.group);

    this.painter = new Painter({ camera, domElement: this.canvas });
    this.painter.setTargets(house.paintTargets);
    this.painter.color = PAINTS[0].hex;

    this.hud.buildPalette((index) => this.selectPaint(index));
    this.hud.setRendererLabel(
      this.renderer.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL 1',
    );
    this.hud.setCoverage(0);
    this.hud.setTime(0);

    window.addEventListener('keydown', this.#onKeyDown);
    window.addEventListener('resize', this.#onResize);
    this.#onResize();

    this.state = 'menu';
    this.hud.showScreen('menu');
    this.renderer.setAnimationLoop(this.#frame);
  }

  selectPaint(index) {
    const paint = PAINTS[index];
    if (!paint) return;
    this.painter.color = paint.hex;
    this.hud.selectPaint(index);
  }

  start() {
    this.elapsed = 0;
    this.state = 'playing';
    this.painter.enabled = true;
    this.hud.setTime(0);
    this.hud.showScreen('playing');
  }

  restart() {
    for (const surface of this.surfaces) surface.reset();
    this.painter.reset();
    this.hud.setCoverage(0);
    this.start();
  }

  get coverage() {
    let painted = 0;
    let paintable = 0;
    for (const surface of this.surfaces) {
      painted += surface.paintedCells;
      paintable += surface.paintableCells;
    }
    return paintable === 0 ? 0 : painted / paintable;
  }

  #onKeyDown = (event) => {
    if (this.state !== 'playing') return;
    const index = Number.parseInt(event.key, 10) - 1;
    if (Number.isInteger(index) && index >= 0 && index < PAINTS.length) {
      this.selectPaint(index);
    }
  };

  #onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  #frame = () => {
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.painter.update(delta);

    if (this.state === 'playing') {
      this.elapsed += delta;
      this.hud.setTime(this.elapsed);
      const coverage = this.coverage;
      this.hud.setCoverage(coverage);

      if (coverage >= COMPLETION_THRESHOLD) {
        this.state = 'finished';
        this.painter.enabled = false;
        this.hud.showFinished(coverage, this.elapsed);
      }
    }

    this.renderer.render(this.scene, this.camera);
  };
}
