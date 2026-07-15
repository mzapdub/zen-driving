import { readStandardGamepad } from './gamepad-input.js';
import { TouchControls } from './touch-controls.js';

const CONTROL_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'KeyR',
  'KeyM',
  'KeyC',
  'Escape',
]);

function isInteractiveElement(target) {
  return typeof Element !== 'undefined'
    && target instanceof Element
    && (target.matches('input, textarea, select, button, [contenteditable="true"]')
      || target.closest('[contenteditable="true"]'));
}

export class InputController {
  forward = false;

  back = false;

  left = false;

  right = false;

  handbrake = false;

  boost = false;

  #resetRequested = false;

  #muteRequested = false;

  #menuRequested = false;

  #cameraRequested = false;

  #target;

  #window;

  #navigator;

  #keyboard = { forward: false, back: false, left: false, right: false, handbrake: false, boost: false };

  #gamepad = { left: false, right: false, handbrake: false, boost: false };

  #touch = { left: false, right: false, boost: false, brake: false };

  #activeGamepadIndex = null;

  #gamepadButtons = [];

  #touchControls;

  #onKeyDown;

  #onKeyUp;

  #onBlur;

  #onFocus;

  #onGamepadDisconnected;

  #focused = true;

  constructor(
    target = window,
    {
      windowRef = window,
      navigatorRef = navigator,
      touchRoot = document.querySelector('#touch-controls'),
    } = {},
  ) {
    this.#target = target;
    this.#window = windowRef;
    this.#navigator = navigatorRef;
    this.#onKeyDown = (event) => this.#handleKey(event, true);
    this.#onKeyUp = (event) => this.#handleKey(event, false);
    this.#onBlur = () => {
      this.#focused = false;
      this.#releaseControls();
    };
    this.#onFocus = () => {
      this.#focused = true;
      this.#gamepadButtons = [];
    };
    this.#onGamepadDisconnected = (event) => {
      if (event.gamepad?.index === this.#activeGamepadIndex) this.#clearGamepad();
    };
    this.#touchControls = new TouchControls(touchRoot, {
      onState: (state) => {
        this.#touch = state;
        this.#syncControls();
      },
      onAction: (action) => this.#requestAction(action),
    });

    this.#target.addEventListener('keydown', this.#onKeyDown, { passive: false });
    this.#target.addEventListener('keyup', this.#onKeyUp, { passive: false });
    this.#window.addEventListener('blur', this.#onBlur);
    this.#window.addEventListener('focus', this.#onFocus);
    this.#window.addEventListener('gamepaddisconnected', this.#onGamepadDisconnected);
  }

  update() {
    if (!this.#focused) {
      this.#clearGamepad();
      return;
    }
    let pads = [];
    try {
      pads = [...(this.#navigator.getGamepads?.() ?? [])];
    } catch {
      pads = [];
    }
    const gamepad = pads.find((pad) => pad?.connected !== false && pad?.mapping === 'standard');
    if (!gamepad) {
      this.#clearGamepad();
      return;
    }
    if (gamepad.index !== this.#activeGamepadIndex) this.#gamepadButtons = [];
    this.#activeGamepadIndex = gamepad.index;
    const reading = readStandardGamepad(gamepad, this.#gamepadButtons);
    this.#gamepad = reading.state;
    this.#gamepadButtons = reading.buttonStates;
    if (reading.actions.camera) this.#cameraRequested = true;
    if (reading.actions.radio) this.#muteRequested = true;
    if (reading.actions.menu) this.#menuRequested = true;
    this.#syncControls();
  }

  consumeReset() {
    const requested = this.#resetRequested;
    this.#resetRequested = false;
    return requested;
  }

  consumeMute() {
    const requested = this.#muteRequested;
    this.#muteRequested = false;
    return requested;
  }

  consumeMenu() {
    const requested = this.#menuRequested;
    this.#menuRequested = false;
    return requested;
  }

  consumeCamera() {
    const requested = this.#cameraRequested;
    this.#cameraRequested = false;
    return requested;
  }

  dispose() {
    this.#target.removeEventListener('keydown', this.#onKeyDown);
    this.#target.removeEventListener('keyup', this.#onKeyUp);
    this.#window.removeEventListener('blur', this.#onBlur);
    this.#window.removeEventListener('focus', this.#onFocus);
    this.#window.removeEventListener('gamepaddisconnected', this.#onGamepadDisconnected);
    this.#touchControls.dispose();
    this.#releaseControls();
    this.#resetRequested = false;
    this.#muteRequested = false;
    this.#menuRequested = false;
    this.#cameraRequested = false;
  }

  #handleKey(event, pressed) {
    if (!CONTROL_KEYS.has(event.code) || isInteractiveElement(event.target)) {
      return;
    }

    event.preventDefault();

    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.#keyboard.forward = pressed;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.#keyboard.back = pressed;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.#keyboard.left = pressed;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.#keyboard.right = pressed;
        break;
      case 'Space':
        this.#keyboard.handbrake = pressed;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.#keyboard.boost = pressed;
        break;
      case 'KeyR':
        if (pressed && !event.repeat) {
          this.#resetRequested = true;
        }
        break;
      case 'KeyM':
        if (pressed && !event.repeat) {
          this.#muteRequested = true;
        }
        break;
      case 'KeyC':
        if (pressed && !event.repeat) {
          this.#cameraRequested = true;
        }
        break;
      case 'Escape':
        if (pressed && !event.repeat) {
          this.#menuRequested = true;
        }
        break;
      default:
        break;
    }
    this.#syncControls();
  }

  #releaseControls() {
    this.#keyboard = { forward: false, back: false, left: false, right: false, handbrake: false, boost: false };
    this.#touchControls.releaseAll();
    this.#touch = { left: false, right: false, boost: false, brake: false };
    this.#clearGamepad();
    this.#syncControls();
  }

  #clearGamepad() {
    this.#activeGamepadIndex = null;
    this.#gamepadButtons = [];
    this.#gamepad = { left: false, right: false, handbrake: false, boost: false };
    this.#syncControls();
  }

  #requestAction(action) {
    if (action === 'camera') this.#cameraRequested = true;
    if (action === 'radio') this.#muteRequested = true;
    if (action === 'menu') this.#menuRequested = true;
  }

  #syncControls() {
    this.forward = this.#keyboard.forward;
    this.back = this.#keyboard.back || this.#touch.brake;
    this.left = this.#keyboard.left || this.#gamepad.left || this.#touch.left;
    this.right = this.#keyboard.right || this.#gamepad.right || this.#touch.right;
    this.handbrake = this.#keyboard.handbrake || this.#gamepad.handbrake;
    this.boost = this.#keyboard.boost || this.#gamepad.boost || this.#touch.boost;
  }
}
