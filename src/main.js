import './styles.css';
import { MountainDriveApp } from './mountain-drive-app.js';
import { ArcadeVehicle } from './vehicle.js';
import { GarageController } from './garage-controller.js';
import { PROCEDURAL_SONGS } from './radio.js';
import { VehiclePreview } from './vehicle-preview.js';
import { EnvironmentChoiceController } from './environment-profiles.js';

const canvas = document.querySelector('#scene');
const ui = {
  loading: document.querySelector('#loading'),
  loadingStatus: document.querySelector('#loading-status'),
  mainMenu: document.querySelector('#main-menu'),
  hud: document.querySelector('#hud'),
  controls: document.querySelector('#controls'),
  speed: document.querySelector('#speed'),
  distance: document.querySelector('#distance'),
  bestDistance: document.querySelector('#best-distance'),
  score: document.querySelector('#score'),
  boostReadout: document.querySelector('#boost-readout'),
  boostPercent: document.querySelector('#boost-percent'),
  boostFill: document.querySelector('#boost-fill'),
  driftReadout: document.querySelector('#drift-readout'),
  driftLabel: document.querySelector('#drift-label'),
  driftAngle: document.querySelector('#drift-angle'),
  driftFill: document.querySelector('#drift-fill'),
  driftScore: document.querySelector('#drift-score'),
  nearMiss: document.querySelector('#near-miss'),
  locationName: document.querySelector('#location-name'),
  skyPhase: document.querySelector('#sky-phase'),
  cameraMode: document.querySelector('#camera-mode'),
  rendererBadge: document.querySelector('#renderer-badge'),
  radio: document.querySelector('#radio'),
  radioStatus: document.querySelector('#radio-status'),
  radioToggle: document.querySelector('#radio-toggle'),
  crash: document.querySelector('#crash'),
  crashScore: document.querySelector('#crash-score'),
  crashDistance: document.querySelector('#crash-distance'),
  restart: document.querySelector('#restart'),
  transition: document.querySelector('#transition'),
  start: document.querySelector('#start'),
  error: document.querySelector('#error'),
};

const garage = new GarageController(document.querySelector('#garage'));
ArcadeVehicle.setDefaultSelection(garage.getSelection());
const vehiclePreview = new VehiclePreview({
  host: document.querySelector('#vehicle-preview'),
  canvas: document.querySelector('#vehicle-preview-canvas'),
  selection: garage.getSelection(),
});
const environmentChoice = new EnvironmentChoiceController(document.querySelector('#environment-picker'));

const app = new MountainDriveApp(canvas, ui, { environmentProfile: environmentChoice.getProfile() });
let environmentChangeQueue = Promise.resolve();
environmentChoice.setOnChange(({ profile }) => {
  environmentChangeQueue = environmentChangeQueue
    .then(() => app.setEnvironmentProfile(profile))
    .catch((error) => {
      console.error('Environment change failed.', error);
      ui.error.hidden = false;
      ui.error.textContent = `Could not change environment: ${error.message}`;
    });
});
garage.setOnChange((selection) => {
  vehiclePreview.setSelection(selection);
  app.vehicle?.applySelection(selection);
});

const songSelect = document.querySelector('#radio-song');
const songDescription = document.querySelector('#radio-song-description');
const songStorageKey = 'ny-drive-radio-song-v1';
for (const song of PROCEDURAL_SONGS) {
  const option = document.createElement('option');
  option.value = song.id;
  option.textContent = `${song.title} — ${song.artist} · ${song.bpm} BPM`;
  songSelect.append(option);
}
try {
  const storedSong = localStorage.getItem(songStorageKey);
  if (PROCEDURAL_SONGS.some((song) => song.id === storedSong)) songSelect.value = storedSong;
} catch {
  // Private browsing can reject persistence; menu selection still works.
}
const syncSongDescription = () => {
  const song = PROCEDURAL_SONGS.find((entry) => entry.id === songSelect.value) ?? PROCEDURAL_SONGS[0];
  songDescription.textContent = `${song.genre} · ${song.description}`;
};
songSelect.addEventListener('change', () => {
  app.radio?.setSong(songSelect.value);
  syncSongDescription();
  try { localStorage.setItem(songStorageKey, songSelect.value); } catch { /* Session-only selection. */ }
});
syncSongDescription();

// Small public seam for browser tests and future menu integrations.
window.nyMountainDrive = { app, garage, vehiclePreview, environmentChoice };

app.initialize()
  .then(() => app.radio.setSong(songSelect.value))
  .catch((error) => {
    console.error(error);
    ui.loading.hidden = true;
    ui.error.hidden = false;
    ui.error.textContent = `Scene failed to start: ${error.message}`;
  });
