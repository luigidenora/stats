import { registerAgentTools } from '../src/agent.js';
import { Stats } from '../src/index.js';
import { addImageMode } from './image.js';
import { addLodMode, LodField } from './lod.js';

type Three = typeof import('three');

const params = new URLSearchParams(location.search);
const useWebGPU = params.has('webgpu');
const instanceCount = Number(params.get('count') ?? (params.has('heavy') ? 60000 : 6000));

async function createRenderer(THREE: Three) {
  if (useWebGPU) {
    const { WebGPURenderer } = await import('three/webgpu');
    const renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true });
    await renderer.init();
    return renderer;
  }

  return new THREE.WebGLRenderer({ antialias: true });
}

function checkerTexture(THREE: Three) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const on = ((i % size) >> 3) % 2 === ((Math.floor(i / size) >> 3) % 2);
    data.set(on ? [210, 214, 205, 255] : [60, 66, 70, 255], i * 4);
  }

  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

function buildScene(THREE: Three) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f12);
  scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x1a1d20, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(4, 8, 6);
  scene.add(sun);

  // Instanced field: one draw call, many triangles.
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.05, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), instanceCount);
  const matrix = new THREE.Matrix4();
  // A small, deliberate palette: the scene gets colour without fighting the white overlay.
  const palette = [0xff6b4a, 0xffc145, 0x4cc9f0, 0x7b6cff, 0x5ee6a8].map((hex) => new THREE.Color(hex));
  for (let i = 0; i < instanceCount; i++) {
    const r = 2 + Math.random() * 6;
    const a = Math.random() * Math.PI * 2;
    matrix.makeTranslation(Math.cos(a) * r, (Math.random() - 0.5) * 3, Math.sin(a) * r);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, palette[i % palette.length]);
  }

  scene.add(mesh);

  // A few separate meshes: several draw calls.
  const material = new THREE.MeshStandardMaterial({ map: checkerTexture(THREE), roughness: 0.8 });
  for (let i = 0; i < 12; i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), material);
    box.name = `crate ${i + 1}`;
    box.position.set(Math.cos(i / 2) * 1.2, Math.sin(i * 1.3) * 0.8, Math.sin(i / 2) * 1.2);
    scene.add(box);
  }

  // Points and lines, so every counter has a real value.
  const positions = new Float32Array(3000 * 3).map(() => (Math.random() - 0.5) * 18);
  const pointsGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
  scene.add(new THREE.Points(pointsGeometry, new THREE.PointsMaterial({ color: 0x9fb0b8, size: 0.03 })));
  scene.add(new THREE.GridHelper(20, 40, 0x56636a, 0x2a3236));

  return { scene, mesh };
}

async function main() {
  const THREE = useWebGPU ? (await import('three/webgpu')) as unknown as Three : await import('three');
  const renderer = await createRenderer(THREE);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  const { scene, mesh } = buildScene(THREE);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 3.2, 9);
  camera.lookAt(0, 0, 0);

  const lodField = new LodField(THREE);
  scene.add(lodField.group);
  lodField.camera = camera;
  lodField.viewportHeight = innerHeight;

  const stats = new Stats(renderer, {
    scene,
    // Every finished recording (the REC plate in Performance mode) lands here.
    onReport: (report) => {
      console.table({ 'FPS average': report.fps.average, 'FPS 1% low': report.fps.low1, 'Frame P95 (ms)': report.frame.p95, 'Frame P99 (ms)': report.frame.p99, Dropped: report.dropped });
    },
    // A custom row uses the same mechanism as the built-in ones.
    metrics: [{ id: 'instances', label: 'Instances drawn by the InstancedMesh', place: 'top', plate: 'INST', modes: ['performance', 'graph'], read: () => mesh.count }]
  });
  // A project-specific mode, defined outside the library (see lod.ts).
  addLodMode(stats, lodField);
  // Another custom mode: the rendered image as a camera display reads it (see image.ts).
  addImageMode(stats, renderer.domElement);
  // Offers the overlay to in-browser agents (WebMCP) where the browser supports it.
  registerAgentTools(stats);
  let wasNear = false;
  let motion = 0;
  let last = 0;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    lodField.viewportHeight = innerHeight;
  });

  void renderer.setAnimationLoop((time: number) => {
    stats.begin();
    motion += time - last;
    last = time;
    mesh.rotation.y = motion * 0.00008;
    scene.rotation.y = Math.sin(motion * 0.0002) * 0.3;
    // Dolly in and out so LOD levels change.
    const swing = Math.sin(motion * 0.0004);
    camera.position.setLength(6 + swing * 4);
    camera.lookAt(0, 0, 0);
    // A flag on the graphs each time the camera comes closest: was that the hitch?
    const near = swing < -0.98;
    if (near && !wasNear) stats.event('closest');
    wasNear = near;
    // Splits CPU time into 'logic' (above) and 'render' rows in Performance mode.
    stats.mark('render');
    renderer.render(scene, camera);
    stats.end();
    lodField.afterRender();
  });
}

void main();
