import './styles.css';
import { LePainterrGame } from './game.js';

const canvas = document.querySelector('#scene');

const elements = {
  loading: document.querySelector('#loading'),
  loadingStatus: document.querySelector('#loading-status'),
  mainMenu: document.querySelector('#main-menu'),
  hud: document.querySelector('#hud'),
  finished: document.querySelector('#finished'),
  coverage: document.querySelector('#coverage'),
  coverageFill: document.querySelector('#coverage-fill'),
  timer: document.querySelector('#timer'),
  rendererBadge: document.querySelector('#renderer-badge'),
  palette: document.querySelector('#palette'),
  finishedCoverage: document.querySelector('#finished-coverage'),
  finishedTime: document.querySelector('#finished-time'),
  brandMarks: document.querySelectorAll('.brand-mark'),
};

const game = new LePainterrGame({ canvas, elements });

document.querySelector('#start').addEventListener('click', () => game.start());
document.querySelector('#restart').addEventListener('click', () => game.restart());

// Dev-only handle for poking at the game from the console or a browser test.
// Stripped from production builds by the `import.meta.env.DEV` constant.
if (import.meta.env.DEV) {
  window.lePainterr = game;
}

game.load().catch((error) => {
  console.error(error);
  elements.loading.hidden = false;
  elements.loadingStatus.textContent =
    'This browser could not start the 3D renderer. Try a recent desktop browser with WebGL enabled.';
});
