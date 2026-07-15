const HOLD_CONTROLS = new Set(['left', 'right', 'boost', 'brake']);
const ACTION_CONTROLS = new Set(['camera', 'radio', 'menu']);

export class TouchControls {
  #buttons = [];

  #pointers = new Map();

  #cleanup = [];

  #onState;

  #onAction;

  constructor(root, { onState, onAction } = {}) {
    this.#onState = onState ?? (() => {});
    this.#onAction = onAction ?? (() => {});
    if (!root) return;

    this.#buttons = [...root.querySelectorAll('[data-touch-control]')];
    for (const button of this.#buttons) {
      const control = button.dataset.touchControl;
      if (!HOLD_CONTROLS.has(control) && !ACTION_CONTROLS.has(control)) continue;

      const onPointerDown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        if (ACTION_CONTROLS.has(control)) {
          this.#onAction(control);
          return;
        }
        this.#pointers.set(event.pointerId, control);
        this.#emitState();
      };
      const onPointerEnd = (event) => {
        if (!this.#pointers.delete(event.pointerId)) return;
        event.preventDefault();
        this.#emitState();
      };

      button.addEventListener('pointerdown', onPointerDown, { passive: false });
      button.addEventListener('pointerup', onPointerEnd, { passive: false });
      button.addEventListener('pointercancel', onPointerEnd, { passive: false });
      button.addEventListener('lostpointercapture', onPointerEnd, { passive: false });
      this.#cleanup.push(() => {
        button.removeEventListener('pointerdown', onPointerDown);
        button.removeEventListener('pointerup', onPointerEnd);
        button.removeEventListener('pointercancel', onPointerEnd);
        button.removeEventListener('lostpointercapture', onPointerEnd);
      });
    }
  }

  releaseAll() {
    if (this.#pointers.size === 0) return;
    this.#pointers.clear();
    this.#emitState();
  }

  dispose() {
    this.releaseAll();
    for (const cleanup of this.#cleanup) cleanup();
    this.#cleanup.length = 0;
    this.#buttons.length = 0;
  }

  #emitState() {
    const active = new Set(this.#pointers.values());
    this.#onState({
      left: active.has('left'),
      right: active.has('right'),
      boost: active.has('boost'),
      brake: active.has('brake'),
    });
  }
}

