import * as THREE from 'three';

const SKY_TOP = new THREE.Color(0x4f88c6);
const SKY_HORIZON = new THREE.Color(0xd6e6ee);

function makeSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: SKY_TOP },
      horizonColor: { value: SKY_HORIZON },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vWorldPosition = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = clamp( normalize( vWorldPosition ).y * 1.6, 0.0, 1.0 );
        gl_FragColor = vec4( mix( horizonColor, topColor, pow( h, 0.7 ) ), 1.0 );
      }
    `,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
  sky.frustumCulled = false;
  return sky;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

/** Sky, lawn and light rig. The house is added by the caller. */
export function createWorld(textures) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_HORIZON, 55, 190);
  scene.add(makeSky());

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ map: textures.grass, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const hemisphere = new THREE.HemisphereLight(0xbcd9f5, 0x5a7d49, 1.35);
  scene.add(hemisphere);

  // Fill from the shaded side. Without it the two walls facing away from the sun
  // are too dark to judge paint coverage against.
  const fill = new THREE.DirectionalLight(0xcfe0f0, 0.55);
  fill.position.set(-12, 8, -10);
  scene.add(fill);

  const sun = new THREE.DirectionalLight(0xfff2d8, 2.3);
  sun.position.set(13, 17, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 500);

  return { scene, camera, sun };
}
