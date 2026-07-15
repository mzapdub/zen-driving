export const DEFAULT_ENVIRONMENT_ID = 'catskills_scenic';
export const ENVIRONMENT_STORAGE_KEY = 'ny-drive-environment-v1';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const profiles = [
  {
    id: 'catskills_scenic',
    label: 'Catskill Scenic Byway',
    shortLabel: 'Catskills',
    description: 'Late-summer mixed forest, warm rural fields and layered blue-green ridges.',
    seedSalt: 0x43a75111,
    cssColors: ['#b9a45f', '#557249', '#344c42', '#8ba5a3'],
    materials: {
      terrain: {
        macro: { low: '#777542', high: '#33553b', frequency: 0.0048 },
        midscale: { grass: '#788c4a', soil: '#65513a', frequency: 0.075 },
        fine: { roughness: 0.93, speckle: '#b1aa68', frequency: 1.75 },
      },
      foliage: {
        macro: { canopy: ['#24452f', '#41623a', '#657744'], seasonalMix: 0.12 },
        midscale: { crownBreakup: 0.46, clusterScale: 1 },
        fine: { leafEdge: '#9aa95f', roughness: 0.88, translucency: 0.1 },
      },
      rock: {
        macro: { base: '#626960', strata: '#85877a' },
        midscale: { lichen: '#747a55', cellularBreakup: 0.32 },
        fine: { grain: '#a29d8d', roughness: 0.91 },
      },
    },
    props: {
      hardwoodWeight: 0.64,
      coniferWeight: 0.36,
      exposedRockScale: 0.72,
      settlementScale: 1,
      lakeChance: 0,
      waterColor: '#486e73',
      waterRoughness: 0.3,
      hazeColor: '#90a8a2',
      hazeDensityScale: 1,
      terrainReliefScale: 1,
      ridgeScale: 1,
      mountainWidthScale: 1,
      surfaceMode: 'meadow_forest',
      vegetationMode: 'mixed_forest',
      waterMode: 'none',
      propSet: 'rural_farm',
    },
  },
  {
    id: 'adirondack_autumn',
    label: 'Adirondack Autumn Lakes',
    shortLabel: 'Adirondacks',
    description: 'Red-orange hardwoods, dark conifers, exposed granite, cold lakes and cool haze.',
    seedSalt: 0x1ad10dac,
    cssColors: ['#b74a24', '#db832f', '#163a34', '#6d7e89'],
    materials: {
      terrain: {
        macro: { low: '#6e3d27', high: '#263d35', frequency: 0.0043 },
        midscale: { grass: '#657142', soil: '#492f27', frequency: 0.082 },
        fine: { roughness: 0.96, speckle: '#cc7a34', frequency: 1.9 },
      },
      foliage: {
        macro: { canopy: ['#9c2f22', '#d25c25', '#e39b37', '#153d33'], seasonalMix: 0.78 },
        midscale: { crownBreakup: 0.58, clusterScale: 0.94 },
        fine: { leafEdge: '#eead45', roughness: 0.91, translucency: 0.08 },
      },
      rock: {
        macro: { base: '#72777a', strata: '#a3a4a0' },
        midscale: { lichen: '#65715c', cellularBreakup: 0.51 },
        fine: { grain: '#c1beb4', roughness: 0.84 },
      },
    },
    props: {
      hardwoodWeight: 0.7,
      coniferWeight: 0.3,
      exposedRockScale: 1.42,
      settlementScale: 0.68,
      lakeChance: 0.34,
      waterColor: '#294f5c',
      waterRoughness: 0.2,
      hazeColor: '#8da3ad',
      hazeDensityScale: 1.18,
      terrainReliefScale: 1.18,
      ridgeScale: 1.14,
      mountainWidthScale: 1.08,
      surfaceMode: 'forest_floor',
      vegetationMode: 'autumn_forest',
      waterMode: 'cold_lake',
      propSet: 'granite_lake',
    },
  },
  {
    id: 'hokkaido_snow',
    label: 'Hokkaido Snow Pass',
    shortLabel: 'Hokkaido',
    description: 'Wind-crusted snow, icy rock cuts, spruce and birch, frozen water and lantern hamlets.',
    seedSalt: 0x48d0a11d,
    cssColors: ['#eef6f8', '#9fc7d4', '#244958', '#cadce7'],
    materials: {
      terrain: {
        macro: { low: '#dceaf0', high: '#f4f8f7', frequency: 0.0036 },
        midscale: { grass: '#bdd2d7', soil: '#53636a', frequency: 0.068 },
        fine: { roughness: 0.82, speckle: '#ffffff', frequency: 2.2 },
      },
      foliage: {
        macro: { canopy: ['#d8e3df', '#7fa0a0', '#234852', '#173a43'], seasonalMix: 0.34 },
        midscale: { crownBreakup: 0.7, clusterScale: 0.88 },
        fine: { leafEdge: '#edf5f3', roughness: 0.93, translucency: 0.06 },
      },
      rock: {
        macro: { base: '#58666e', strata: '#87979d' },
        midscale: { lichen: '#b9ced0', cellularBreakup: 0.62 },
        fine: { grain: '#d6e2e3', roughness: 0.78 },
      },
    },
    props: {
      hardwoodWeight: 0.22,
      coniferWeight: 0.78,
      exposedRockScale: 1.16,
      settlementScale: 0.54,
      lakeChance: 0.42,
      waterColor: '#b7d9e7',
      waterRoughness: 0.13,
      hazeColor: '#b9d0db',
      hazeDensityScale: 1.42,
      terrainReliefScale: 1.3,
      ridgeScale: 1.32,
      mountainWidthScale: 0.9,
      surfaceMode: 'snow_ice',
      vegetationMode: 'spruce_birch',
      waterMode: 'frozen_water',
      propSet: 'snowbank_lantern',
    },
  },
  {
    id: 'arizona_desert',
    label: 'Arizona Desert Canyons',
    shortLabel: 'Arizona',
    description: 'Red sandstone mesas, sandy washes, saguaro, agave, dry scrub and shimmering desert air.',
    seedSalt: 0x2a21d0e5,
    cssColors: ['#db8a43', '#a94628', '#692d27', '#e7b36c'],
    materials: {
      terrain: {
        macro: { low: '#b86435', high: '#7d3529', frequency: 0.0032 },
        midscale: { grass: '#a7733d', soil: '#c7864c', frequency: 0.052 },
        fine: { roughness: 0.98, speckle: '#e0ae68', frequency: 2.35 },
      },
      foliage: {
        macro: { canopy: ['#6e7439', '#89904b', '#44643d', '#315341'], seasonalMix: 0.06 },
        midscale: { crownBreakup: 0.78, clusterScale: 0.62 },
        fine: { leafEdge: '#a9a45b', roughness: 0.96, translucency: 0.03 },
      },
      rock: {
        macro: { base: '#9b412a', strata: '#d17b45' },
        midscale: { lichen: '#b85b31', cellularBreakup: 0.74 },
        fine: { grain: '#e7a45c', roughness: 0.99 },
      },
    },
    props: {
      hardwoodWeight: 0.08,
      coniferWeight: 0.12,
      exposedRockScale: 1.86,
      settlementScale: 0.24,
      lakeChance: 0.08,
      waterColor: '#7ca6a2',
      waterRoughness: 0.46,
      hazeColor: '#d59a6d',
      hazeDensityScale: 0.72,
      terrainReliefScale: 1.58,
      ridgeScale: 1.7,
      mountainWidthScale: 1.42,
      surfaceMode: 'sandstone_dust',
      vegetationMode: 'cactus_scrub',
      waterMode: 'ephemeral_wash',
      propSet: 'cactus_agave',
    },
  },
];

export const ENVIRONMENT_PROFILES = deepFreeze(profiles);

const profileById = new Map(ENVIRONMENT_PROFILES.map((profile) => [profile.id, profile]));

export function normalizeEnvironmentId(id) {
  return profileById.has(id) ? id : DEFAULT_ENVIRONMENT_ID;
}

export function getEnvironmentProfile(id = DEFAULT_ENVIRONMENT_ID) {
  return profileById.get(normalizeEnvironmentId(id));
}

function readableStorage(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
}

export function getEnvironmentStorageCandidates(scope = globalThis) {
  const stores = [];
  for (const key of ['localStorage', 'sessionStorage']) {
    try {
      const storage = scope?.[key];
      if (readableStorage(storage)) stores.push(storage);
    } catch {
      // Browsers may expose storage while denying access to it.
    }
  }
  return stores;
}

export function loadEnvironmentId(storages = getEnvironmentStorageCandidates()) {
  for (const storage of storages) {
    try {
      const value = storage.getItem(ENVIRONMENT_STORAGE_KEY);
      if (profileById.has(value)) return value;
    } catch {
      // Continue to session storage or the deterministic default.
    }
  }
  return DEFAULT_ENVIRONMENT_ID;
}

export function persistEnvironmentId(id, storages = getEnvironmentStorageCandidates()) {
  const normalized = normalizeEnvironmentId(id);
  for (const storage of storages) {
    try {
      storage.setItem(ENVIRONMENT_STORAGE_KEY, normalized);
      return { environmentId: normalized, persisted: true };
    } catch {
      // Continue to the session fallback.
    }
  }
  return { environmentId: normalized, persisted: false };
}

export class EnvironmentChoiceController {
  constructor(root, { storages = getEnvironmentStorageCandidates(), onChange = null } = {}) {
    if (!root) throw new Error('EnvironmentChoiceController requires a root element.');
    this.root = root;
    this.storages = storages;
    this.onChange = typeof onChange === 'function' ? onChange : null;
    this.environmentId = loadEnvironmentId(storages);
    this.status = root.querySelector?.('[data-environment-status]') ?? null;
    this.description = root.querySelector?.('[data-environment-description]') ?? null;
    this.handleChange = this.handleChange.bind(this);
    this.root.addEventListener('change', this.handleChange);
    this.sync();
  }

  getEnvironmentId() {
    return this.environmentId;
  }

  getProfile() {
    return getEnvironmentProfile(this.environmentId);
  }

  setOnChange(callback, { emit = false } = {}) {
    this.onChange = typeof callback === 'function' ? callback : null;
    if (emit) this.emit();
  }

  setEnvironment(id, { persist = true, emit = true } = {}) {
    const nextId = normalizeEnvironmentId(id);
    const changed = nextId !== this.environmentId;
    this.environmentId = nextId;
    if (persist) persistEnvironmentId(nextId, this.storages);
    this.sync();
    if (emit && changed) this.emit();
    return this.getProfile();
  }

  handleChange(event) {
    const input = event.target;
    if (input?.name !== 'environment-id' || input?.type !== 'radio' || !input.checked) return;
    this.setEnvironment(input.value);
  }

  sync() {
    const profile = this.getProfile();
    const input = this.root.querySelector?.(`input[name="environment-id"][value="${profile.id}"]`);
    if (input) input.checked = true;
    if (this.status) {
      this.status.value = profile.label;
      this.status.textContent = profile.label;
    }
    if (this.description) this.description.textContent = profile.description;
  }

  emit() {
    const detail = Object.freeze({ environmentId: this.environmentId, profile: this.getProfile() });
    this.onChange?.(detail);
    const EventCtor = globalThis.CustomEvent;
    if (typeof EventCtor === 'function') {
      this.root.dispatchEvent(new EventCtor('environmentchange', { bubbles: true, detail }));
    }
  }

  dispose() {
    this.root.removeEventListener('change', this.handleChange);
    this.onChange = null;
  }
}
