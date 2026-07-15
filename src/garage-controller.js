import { PAINT_COLORS, VEHICLE_TYPES, normalizeVehicleSelection } from './vehicle.js';

const STORAGE_KEY = 'ny-drive-garage-v1';

function getDefaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadGarageSelection(storage = getDefaultStorage()) {
  try {
    return normalizeVehicleSelection(JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return normalizeVehicleSelection();
  }
}

export class GarageController {
  constructor(root, { storage = getDefaultStorage(), onChange = null } = {}) {
    if (!root) throw new Error('GarageController requires a garage root element.');
    this.root = root;
    this.storage = storage;
    this.onChange = onChange;
    this.status = root.querySelector('#garage-status');
    this.selection = loadGarageSelection(storage);
    this.handleChange = this.handleChange.bind(this);
    this.root.addEventListener('change', this.handleChange);
    this.sync();
  }

  getSelection() {
    return { ...this.selection };
  }

  setOnChange(callback, { emit = false } = {}) {
    this.onChange = typeof callback === 'function' ? callback : null;
    if (emit) this.emit();
  }

  setSelection(selection, { persist = true, emit = true } = {}) {
    this.selection = normalizeVehicleSelection({ ...this.selection, ...selection });
    if (persist) {
      try {
        this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.selection));
      } catch {
        // Storage can be blocked in private browsing; current-session selection still works.
      }
    }
    this.sync();
    if (emit) this.emit();
    return this.getSelection();
  }

  handleChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'radio' || !input.checked) return;
    if (input.name === 'vehicle-type') this.setSelection({ vehicleType: input.value });
    if (input.name === 'paint-color') this.setSelection({ paintColor: input.value });
  }

  sync() {
    const vehicle = this.root.querySelector(`input[name="vehicle-type"][value="${this.selection.vehicleType}"]`);
    const paint = this.root.querySelector(`input[name="paint-color"][value="${this.selection.paintColor}"]`);
    if (vehicle) vehicle.checked = true;
    if (paint) paint.checked = true;
    if (this.status) {
      this.status.value = `${VEHICLE_TYPES[this.selection.vehicleType].label} · ${PAINT_COLORS[this.selection.paintColor].label}`;
      this.status.textContent = this.status.value;
    }
  }

  emit() {
    const selection = this.getSelection();
    this.onChange?.(selection);
    this.root.dispatchEvent(new CustomEvent('garagechange', { bubbles: true, detail: selection }));
  }

  dispose() {
    this.root.removeEventListener('change', this.handleChange);
    this.onChange = null;
  }
}
