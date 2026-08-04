import * as THREE from 'three';
import { PaintableSurface, patchMaterial } from './paintable-surface.js';

export const HOUSE = {
  width: 9,
  depth: 7,
  wallHeight: 4.2,
  ridgeHeight: 2.6,
  overhang: 0.45,
};

/** Siding tiles per metre — shared by every wall so texel density is uniform. */
const SIDING_TILES_PER_METRE = 0.33;

const WALLS = [
  {
    id: 'front',
    span: 'width',
    position: [0, HOUSE.wallHeight / 2, HOUSE.depth / 2],
    rotationY: 0,
    fittings: [
      { type: 'door', u: 0.5, v: 0.26, w: 0.13, h: 0.52 },
      { type: 'window', u: 0.19, v: 0.55, w: 0.15, h: 0.34 },
      { type: 'window', u: 0.81, v: 0.55, w: 0.15, h: 0.34 },
    ],
  },
  {
    id: 'back',
    span: 'width',
    position: [0, HOUSE.wallHeight / 2, -HOUSE.depth / 2],
    rotationY: Math.PI,
    fittings: [
      { type: 'window', u: 0.28, v: 0.55, w: 0.15, h: 0.34 },
      { type: 'window', u: 0.72, v: 0.55, w: 0.15, h: 0.34 },
    ],
  },
  {
    id: 'right',
    span: 'depth',
    position: [HOUSE.width / 2, HOUSE.wallHeight / 2, 0],
    rotationY: Math.PI / 2,
    fittings: [{ type: 'window', u: 0.5, v: 0.55, w: 0.18, h: 0.34 }],
  },
  {
    id: 'left',
    span: 'depth',
    position: [-HOUSE.width / 2, HOUSE.wallHeight / 2, 0],
    rotationY: -Math.PI / 2,
    fittings: [{ type: 'window', u: 0.5, v: 0.55, w: 0.18, h: 0.34 }],
  },
];

/** Triangle that fills the space between the wall top and the roof ridge. */
function gableGeometry(width, height) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-width / 2, 0, 0, width / 2, 0, 0, 0, height, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  return geometry;
}

const insideGable = (u, v) => v <= 1 - Math.abs(2 * u - 1);

function makeWindow(width, height) {
  const group = new THREE.Group();

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x33404d, roughness: 0.6, metalness: 0.05 }),
  );
  frame.castShadow = true;
  group.add(frame);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.86, height * 0.86),
    new THREE.MeshStandardMaterial({
      color: 0x9fc6dd,
      roughness: 0.08,
      metalness: 0.35,
      envMapIntensity: 1.4,
    }),
  );
  glass.position.z = 0.08;
  group.add(glass);

  const mullionMaterial = new THREE.MeshStandardMaterial({ color: 0x2b3742, roughness: 0.55 });
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.05, height * 0.86, 0.06), mullionMaterial);
  vertical.position.z = 0.1;
  const horizontal = new THREE.Mesh(new THREE.BoxGeometry(width * 0.86, 0.05, 0.06), mullionMaterial);
  horizontal.position.z = 0.1;
  group.add(vertical, horizontal);

  return group;
}

function makeDoor(width, height) {
  const group = new THREE.Group();

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x6d4630, roughness: 0.5 }),
  );
  panel.castShadow = true;
  group.add(panel);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xd9b45c, roughness: 0.25, metalness: 0.85 }),
  );
  knob.position.set(width * 0.32, 0, 0.12);
  group.add(knob);

  return group;
}

function makeRoof(textures) {
  const group = new THREE.Group();
  const halfWidth = HOUSE.width / 2 + HOUSE.overhang;
  const slopeLength = Math.hypot(halfWidth, HOUSE.ridgeHeight);
  const length = HOUSE.depth + HOUSE.overhang * 2;

  const material = new THREE.MeshStandardMaterial({
    map: textures.roof,
    roughness: 0.92,
    metalness: 0,
  });

  const pitchAngle = Math.atan2(HOUSE.ridgeHeight, halfWidth);

  for (const side of [1, -1]) {
    // A pivot on the ridge line does the tipping, so the slope mesh itself only
    // has to lie flat — much easier to reason about than a composed Euler.
    const pivot = new THREE.Group();
    pivot.position.set(0, HOUSE.wallHeight + HOUSE.ridgeHeight, 0);
    pivot.rotation.z = -side * pitchAngle;

    const slope = new THREE.Mesh(new THREE.PlaneGeometry(slopeLength, length), material);
    slope.rotation.x = -Math.PI / 2;
    slope.position.x = (side * slopeLength) / 2;
    slope.castShadow = true;
    slope.receiveShadow = true;

    pivot.add(slope);
    group.add(pivot);
  }

  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.18, length),
    new THREE.MeshStandardMaterial({ color: 0x3a4049, roughness: 0.85 }),
  );
  ridge.position.y = HOUSE.wallHeight + HOUSE.ridgeHeight + 0.02;
  ridge.castShadow = true;
  group.add(ridge);

  return group;
}

/** Crossed alpha-cutout quads — the cheapest foliage that still reads as a hedge. */
function makeHedges(textures) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    map: textures.hedge,
    // Cutout sampling: this is why hedge-leaves.webp is encoded at alphaQuality 100.
    alphaTest: 0.5,
    transparent: false,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
  });

  const positions = [
    [-3.4, HOUSE.depth / 2 + 1.5],
    [-1.7, HOUSE.depth / 2 + 1.5],
    [2.6, HOUSE.depth / 2 + 1.5],
    [4.3, HOUSE.depth / 2 + 1.5],
    [-HOUSE.width / 2 - 1.6, 1.2],
    [-HOUSE.width / 2 - 1.6, -1.2],
    [HOUSE.width / 2 + 1.6, -0.4],
  ];

  const geometry = new THREE.PlaneGeometry(1.9, 1.3);
  for (const [x, z] of positions) {
    const bush = new THREE.Group();
    for (let i = 0; i < 3; i += 1) {
      const quad = new THREE.Mesh(geometry, material);
      quad.rotation.y = (i / 3) * Math.PI;
      quad.castShadow = true;
      bush.add(quad);
    }
    bush.position.set(x, 0.62, z);
    group.add(bush);
  }

  return group;
}

/**
 * Builds the house and returns its paintable surfaces.
 * @returns {{group: THREE.Group, surfaces: PaintableSurface[], paintTargets: THREE.Mesh[]}}
 */
export function buildHouse(textures, stamp) {
  const group = new THREE.Group();
  const surfaces = [];
  const paintTargets = [];

  const makePaintable = ({ id, width, height, geometry, holes, mask }) => {
    const material = new THREE.MeshStandardMaterial({
      map: textures.siding,
      roughnessMap: textures.sidingRoughness,
      roughness: 1,
      metalness: 0,
      color: 0xffffff,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `paintable-${id}`;

    const surface = new PaintableSurface({ mesh, width, height, stamp, holes, mask });
    patchMaterial(
      material,
      surface,
      new THREE.Vector2(width * SIDING_TILES_PER_METRE, height * SIDING_TILES_PER_METRE),
    );

    mesh.userData.surface = surface;
    surfaces.push(surface);
    paintTargets.push(mesh);
    return mesh;
  };

  // Walls, each with its window and door cut-outs excluded from coverage.
  for (const wall of WALLS) {
    const width = wall.span === 'width' ? HOUSE.width : HOUSE.depth;
    const height = HOUSE.wallHeight;

    const anchor = new THREE.Group();
    anchor.position.fromArray(wall.position);
    anchor.rotation.y = wall.rotationY;
    group.add(anchor);

    const holes = wall.fittings.map(({ u, v, w, h }) => ({ u, v, w: w * 1.08, h: h * 1.08 }));
    anchor.add(
      makePaintable({
        id: wall.id,
        width,
        height,
        geometry: new THREE.PlaneGeometry(width, height),
        holes,
      }),
    );

    for (const fitting of wall.fittings) {
      const fittingWidth = fitting.w * width;
      const fittingHeight = fitting.h * height;
      const node =
        fitting.type === 'door'
          ? makeDoor(fittingWidth, fittingHeight)
          : makeWindow(fittingWidth, fittingHeight);
      node.position.set((fitting.u - 0.5) * width, (fitting.v - 0.5) * height, 0.06);
      anchor.add(node);
    }
  }

  // Gables close the ends of the pitched roof and are paintable too.
  for (const side of [1, -1]) {
    const anchor = new THREE.Group();
    anchor.position.set(0, HOUSE.wallHeight, (side * HOUSE.depth) / 2);
    anchor.rotation.y = side === 1 ? 0 : Math.PI;
    group.add(anchor);
    anchor.add(
      makePaintable({
        id: side === 1 ? 'gable-front' : 'gable-back',
        width: HOUSE.width,
        height: HOUSE.ridgeHeight,
        geometry: gableGeometry(HOUSE.width, HOUSE.ridgeHeight),
        holes: [],
        mask: insideGable,
      }),
    );
  }

  // Foundation skirt, so the walls do not float on the lawn.
  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(HOUSE.width + 0.4, 0.45, HOUSE.depth + 0.4),
    new THREE.MeshStandardMaterial({ color: 0x6b6660, roughness: 0.95 }),
  );
  skirt.position.y = 0.22;
  skirt.castShadow = true;
  skirt.receiveShadow = true;
  group.add(skirt);

  group.add(makeRoof(textures), makeHedges(textures));

  return { group, surfaces, paintTargets };
}
