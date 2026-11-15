import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { geometryBytes, surveyScene, textureBytes } from '../src/scene-survey.js';

function sizedTexture(width: number, height: number, options: Partial<THREE.Texture> = {}): THREE.Texture {
  const texture = new THREE.Texture({ width, height });
  Object.assign(texture, options);
  return texture;
}

describe('textureBytes', () => {
  it('sizes an RGBA8 texture with a full mip chain as 4/3 of its base level', () => {
    expect(textureBytes(sizedTexture(256, 256))).toBe(Math.round(256 * 256 * 4 * 4 / 3));
  });

  it('drops the mip share without mipmaps and scales with the texel type', () => {
    expect(textureBytes(sizedTexture(256, 256, { generateMipmaps: false }))).toBe(256 * 256 * 4);
    expect(textureBytes(sizedTexture(64, 64, { generateMipmaps: false, type: THREE.HalfFloatType }))).toBe(64 * 64 * 8);
    expect(textureBytes(sizedTexture(64, 64, { generateMipmaps: false, type: THREE.FloatType }))).toBe(64 * 64 * 16);
  });

  it('counts six faces for a cube texture and the depth of array textures', () => {
    const face = { width: 32, height: 32 };
    const cube = new THREE.CubeTexture([face, face, face, face, face, face]);
    cube.generateMipmaps = false;
    expect(textureBytes(cube)).toBe(32 * 32 * 4 * 6);
    const array = new THREE.DataArrayTexture(new Uint8Array(16 * 16 * 4 * 3), 16, 16, 3);
    expect(textureBytes(array)).toBe(16 * 16 * 4 * 3);
  });

  it('cannot size compressed textures or textures without an image', () => {
    expect(textureBytes(new THREE.CompressedTexture([], 512, 512))).toBeNull();
    expect(textureBytes(new THREE.Texture())).toBeNull();
  });
});

describe('geometryBytes', () => {
  it('adds the index and every attribute array', () => {
    const box = new THREE.BoxGeometry();
    let expected = box.index?.array.byteLength ?? 0;
    for (const name of Object.keys(box.attributes)) expected += box.attributes[name].array.byteLength;
    expect(geometryBytes(box)).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });
});

describe('surveyScene on real three.js objects', () => {
  it('counts objects, meshes, instances, triangles and shared resources once', () => {
    const scene = new THREE.Scene();
    const box = new THREE.BoxGeometry();
    const map = sizedTexture(1024, 1024);
    const material = new THREE.MeshStandardMaterial({ map });
    scene.add(new THREE.Mesh(box, material), new THREE.Mesh(box, material));
    const instanced = new THREE.InstancedMesh(box, material, 50);
    instanced.count = 40;
    scene.add(instanced);

    const survey = surveyScene(scene);
    expect(survey.objects).toBe(4);
    expect(survey.meshes).toBe(3);
    expect(survey.instancedMeshes).toBe(1);
    expect(survey.instances).toBe(40);
    // 12 triangles per box: two meshes plus 40 drawn instances.
    expect(survey.triangles).toBe(12 * 42);
    expect(survey.trianglesPerMesh).toEqual([12, 12, 480]);
    expect(survey.geometries).toBe(1);
    expect(survey.materials).toBe(1);
    expect(survey.textures).toBe(1);
    expect(survey.textureBytes).toBe(textureBytes(map));
    expect(survey.topTextures[0].detail).toBe('1024×1024');
    expect(survey.materialsByType.get('MeshStandardMaterial')).toBe(1);
  });

  it('finds instancing candidates among plain meshes, but not inside a LOD', () => {
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    for (let i = 0; i < 12; i++) scene.add(new THREE.Mesh(geometry, material));
    const lodGeometry = new THREE.SphereGeometry();
    for (let i = 0; i < 12; i++) {
      const lod = new THREE.LOD();
      lod.addLevel(new THREE.Mesh(lodGeometry, material), 0);
      scene.add(lod);
    }

    const survey = surveyScene(scene);
    expect(survey.lods).toBe(12);
    expect(survey.instancingGroups).toBe(1);
    expect(survey.largestInstancingGroup).toBe(12);
  });

  it('counts ambient and hemisphere lights by type but not as per-fragment dynamic lights', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(), new THREE.HemisphereLight(), new THREE.DirectionalLight(), new THREE.PointLight());
    const survey = surveyScene(scene);
    expect(survey.lights).toBe(2);
    expect(survey.lightsByType.get('AmbientLight')).toBe(1);
    expect(survey.lightsByType.get('HemisphereLight')).toBe(1);
  });

  it('survives meshes whose material or geometry was nulled by disposal code', () => {
    const scene = new THREE.Scene();
    const noMaterial = new THREE.Mesh(new THREE.BoxGeometry());
    (noMaterial as unknown as { material: null }).material = null;
    const noGeometry = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial());
    (noGeometry as unknown as { geometry: null }).geometry = null;
    const holes = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshBasicMaterial(), null as unknown as THREE.Material]);
    scene.add(noMaterial, noGeometry, holes);
    const survey = surveyScene(scene);
    expect(survey.meshes).toBe(3);
    expect(survey.materials).toBe(2);
  });

  it('does not count hidden lights and meshes (or anything under a hidden parent) as rendered', () => {
    const scene = new THREE.Scene();
    const pool = new THREE.Group();
    pool.visible = false;
    for (let i = 0; i < 5; i++) {
      const light = new THREE.PointLight();
      light.castShadow = true;
      pool.add(light);
    }

    const off = new THREE.SpotLight();
    off.visible = false;
    const hiddenMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    hiddenMesh.visible = false;
    scene.add(pool, off, hiddenMesh, new THREE.DirectionalLight(), new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    const survey = surveyScene(scene);
    expect(survey.lights).toBe(1);
    expect(survey.shadowLights).toBe(0);
    expect(survey.pointShadows).toBe(0);
    expect(survey.triangles).toBe(12);
    // Still in memory: both geometries and materials count.
    expect(survey.geometries).toBe(2);
    expect(survey.materials).toBe(2);
  });

  it('estimates a huge BatchedMesh from a bounded sample instead of probing every id', () => {
    const scene = new THREE.Scene();
    const batched = new THREE.BatchedMesh(6000, 100, 300, new THREE.MeshBasicMaterial());
    const box = batched.addGeometry(new THREE.BoxGeometry());
    for (let i = 0; i < 6000; i++) batched.addInstance(box);
    for (let i = 0; i < 6000; i += 2) batched.deleteInstance(i);
    scene.add(batched);
    const probe = vi.spyOn(batched, 'getGeometryIdAt');
    const survey = surveyScene(scene);
    expect(probe.mock.calls.length).toBeLessThanOrEqual(2048);
    expect(survey.triangles).toBe(3000 * 12);
  });

  it('reads lights, shadows and point shadows', () => {
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight();
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const bulb = new THREE.PointLight();
    bulb.castShadow = true;
    scene.add(sun, bulb, new THREE.AmbientLight());

    const survey = surveyScene(scene);
    expect(survey.lights).toBe(2);
    expect(survey.lightsByType.get('DirectionalLight')).toBe(1);
    expect(survey.shadowLights).toBe(2);
    expect(survey.pointShadows).toBe(1);
    expect(survey.largestShadowMap).toBe(4096);
    expect(survey.shadowBytes).toBe(4096 * 4096 * 4 + 512 * 512 * 4 * 6);
  });

  it('flags transparency, double sides, culling, bones, morphs and missing mips', () => {
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry();
    const noMips = sizedTexture(2048, 2048, { generateMipmaps: false, minFilter: THREE.LinearMipmapLinearFilter });
    const glass = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, map: noMips });
    const mesh = new THREE.Mesh(geometry, glass);
    mesh.frustumCulled = false;
    mesh.morphTargetInfluences = [0, 1];
    scene.add(mesh);
    const bones = [new THREE.Bone(), new THREE.Bone()];
    const skinned = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    skinned.bind(new THREE.Skeleton(bones));
    scene.add(skinned);

    const survey = surveyScene(scene);
    expect(survey.transparent).toBe(1);
    expect(survey.transparentDepthWrite).toBe(1);
    expect(survey.doubleSided).toBe(1);
    expect(survey.frustumCulledOff).toBe(1);
    expect(survey.morphMeshes).toBe(1);
    expect(survey.maxBones).toBe(2);
    expect(survey.missingMips).toBe(1);
    expect(survey.largeUncompressed).toBe(1);
  });

  it('measures how full a BatchedMesh is', () => {
    const scene = new THREE.Scene();
    const batched = new THREE.BatchedMesh(10, 1000, 3000, new THREE.MeshBasicMaterial());
    const id = batched.addGeometry(new THREE.BoxGeometry());
    batched.addInstance(id);
    batched.addInstance(id);
    scene.add(batched);
    const survey = surveyScene(scene);
    expect(survey.batchedMeshes).toBe(1);
    expect(survey.batchedFill).toBeCloseTo(0.2);
    // Two boxes of 12 triangles: the instances drawn, not the 1000 reserved triangles of the shared buffer.
    expect(survey.triangles).toBe(24);
    expect(survey.trianglesPerMesh).toEqual([24]);
  });

  it('skips deleted BatchedMesh instances', () => {
    const scene = new THREE.Scene();
    const batched = new THREE.BatchedMesh(10, 1000, 3000, new THREE.MeshBasicMaterial());
    const box = batched.addGeometry(new THREE.BoxGeometry());
    const plane = batched.addGeometry(new THREE.PlaneGeometry());
    batched.addInstance(box);
    const removed = batched.addInstance(box);
    batched.addInstance(plane);
    batched.deleteInstance(removed);
    scene.add(batched);
    expect(surveyScene(scene).triangles).toBe(12 + 2);
  });

  it('counts a compressed texture without sizing it', () => {
    const scene = new THREE.Scene();
    const compressed = new THREE.CompressedTexture([], 2048, 2048);
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: compressed })));
    const survey = surveyScene(scene);
    expect(survey.textures).toBe(1);
    expect(survey.compressedTextures).toBe(1);
    expect(survey.textureBytes).toBe(0);
    expect(survey.largeUncompressed).toBe(0);
  });
});
