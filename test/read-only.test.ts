// @vitest-environment happy-dom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Stats } from '../src/stats.js';
import { fakeRenderer, must, stubCanvas2d } from './helpers.js';

/** A small but varied real scene: meshes, instances, a LOD, lights with shadows, textures, a skeleton. */
function buildScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const map = new THREE.Texture({ width: 512, height: 512 });
  const material = new THREE.MeshStandardMaterial({ map, transparent: true });
  const box = new THREE.BoxGeometry();
  for (let i = 0; i < 12; i++) {
    const mesh = new THREE.Mesh(box, material);
    mesh.position.set(i, 0, 0);
    mesh.frustumCulled = i % 2 === 0;
    scene.add(mesh);
  }

  scene.add(new THREE.InstancedMesh(box, material, 20));
  const lod = new THREE.LOD();
  lod.addLevel(new THREE.Mesh(new THREE.SphereGeometry(), material), 0);
  scene.add(lod);
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  const hidden = new THREE.PointLight();
  hidden.visible = false;
  scene.add(sun, hidden, new THREE.AmbientLight());
  const skinned = new THREE.SkinnedMesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  skinned.bind(new THREE.Skeleton([new THREE.Bone()]));
  scene.add(skinned);
  scene.updateMatrixWorld();
  return scene;
}

/** Everything the scene serialises, plus what toJSON leaves out but a survey could still touch. */
function fingerprint(scene: THREE.Scene): string {
  const extra: unknown[] = [];
  scene.traverse((object) => {
    extra.push([object.uuid, object.visible, object.matrixAutoUpdate, object.frustumCulled, object.matrixWorld.elements, object.userData]);
  });
  return JSON.stringify([scene.toJSON(), extra]);
}

describe('the overlay never changes the scene', () => {
  let restoreCanvas: () => void;
  let now = 0;
  beforeEach(() => {
    restoreCanvas = stubCanvas2d();
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    restoreCanvas();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('a running overlay in every mode, counting the scene objects, leaves the scene as it was', () => {
    const scene = buildScene();
    const before = fingerprint(scene);
    const children = scene.children.length;
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const renderer = fakeRenderer({ canvas });
    const stats = new Stats(renderer, { scene, profile: 'desktop', remember: false });
    for (const mode of ['simple', 'performance', 'graph', 'off'] as const) {
      stats.mode = mode;
      for (let i = 0; i < 90; i++) {
        stats.begin();
        now += 16;
        stats.end();
      }

      stats.event();
    }

    stats.dispose();
    expect(scene.children).toHaveLength(children);
    expect(fingerprint(scene)).toBe(before);
    expect(renderer.info.autoReset).toBe(true);
    expect(must(document.body).querySelector('.tez-stats')).toBeNull();
  });
});
