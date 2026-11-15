/**
 * One traversal of the scene that the INFO pages and the scene diagnostics share: what is in it,
 * how heavy it is and what could be cheaper. Built on demand (at most every few seconds), never
 * per frame.
 *
 * Byte sizes are estimates, labelled as such wherever they are shown: textures as width × height
 * × bytes per texel × 4/3 with mipmaps (compressed formats are counted, not sized), geometries as
 * the byte length of their attribute and index arrays. The GPU may pad, compress or drop data.
 */

/** The subset of a three.js scene the survey reads. */
export interface InfoScene {
  // Method syntax on purpose: a THREE.Scene (whose callback takes Object3D) must be assignable.
  traverse(callback: (object: SurveyObject) => void): void;
}

export interface SurveyTexture {
  uuid: string;
  name?: string | undefined;
  isTexture?: boolean | undefined;
  isCompressedTexture?: boolean | undefined;
  isCubeTexture?: boolean | undefined;
  isDataArrayTexture?: boolean | undefined;
  isData3DTexture?: boolean | undefined;
  image?: unknown;
  type?: number | undefined;
  generateMipmaps?: boolean | undefined;
  mipmaps?: readonly unknown[] | undefined;
  minFilter?: number | undefined;
}

interface SurveyAttribute {
  count: number;
  array?: { byteLength: number } | undefined;
}

interface SurveyGeometry {
  uuid: string;
  name?: string | undefined;
  index?: SurveyAttribute | null | undefined;
  attributes?: Record<string, SurveyAttribute | undefined> | undefined;
}

interface SurveyMaterial {
  type: string;
  uuid: string;
  [key: string]: unknown;
}

interface SurveyShadow {
  mapSize?: { x: number; y: number } | undefined;
}

export interface SurveyObject {
  type: string;
  name?: string | undefined;
  isMesh?: boolean | undefined;
  isInstancedMesh?: boolean | undefined;
  isBatchedMesh?: boolean | undefined;
  isSkinnedMesh?: boolean | undefined;
  isLight?: boolean | undefined;
  isPointLight?: boolean | undefined;
  isLOD?: boolean | undefined;
  castShadow?: boolean | undefined;
  frustumCulled?: boolean | undefined;
  matrixAutoUpdate?: boolean | undefined;
  count?: number | undefined;
  instanceCount?: number | undefined;
  maxInstanceCount?: number | undefined;
  /** BatchedMesh: geometry of an instance (throws for a deleted one) and its draw range. */
  getGeometryIdAt?: ((instanceId: number) => number) | undefined;
  getGeometryRangeAt?: ((geometryId: number) => { count: number } | null) | undefined;
  geometry?: SurveyGeometry | null | undefined;
  material?: SurveyMaterial | readonly (SurveyMaterial | null)[] | null | undefined;
  skeleton?: { bones: readonly unknown[] } | undefined;
  morphTargetInfluences?: readonly number[] | undefined;
  shadow?: SurveyShadow | undefined;
  /** Read for `isLOD` only (typed loosely so a THREE.Object3D parent is assignable). */
  parent?: object | null | undefined;
}

export interface NamedSize {
  name: string;
  bytes: number;
  detail: string;
}

export interface SceneSurvey {
  objects: number;
  meshes: number;
  instancedMeshes: number;
  instances: number;
  batchedMeshes: number;
  /** Lowest instanceCount / maxInstanceCount over the BatchedMeshes, or null without any. */
  batchedFill: number | null;
  lods: number;
  /** Triangles of every mesh as submitted (instances included), before culling. */
  triangles: number;
  vertices: number;
  /** Triangles of each mesh (instances included), for the triangles-per-draw histogram. */
  trianglesPerMesh: number[];
  geometries: number;
  nonIndexedGeometries: number;
  geometryBytes: number;
  topGeometries: NamedSize[];
  textures: number;
  /** Textures that could be sized (not compressed). */
  textureBytes: number;
  compressedTextures: number;
  /** Uncompressed textures of 2048 px or more on a side. */
  largeUncompressed: number;
  /** Textures that sample mipmaps they never get. */
  missingMips: number;
  /** Longest side of each texture, for the size histogram. */
  textureSides: number[];
  topTextures: NamedSize[];
  lightsByType: Map<string, number>;
  /** Lights shaded per fragment: every light but ambient, hemisphere and probes. */
  lights: number;
  shadowLights: number;
  pointShadows: number;
  largestShadowMap: number;
  shadowBytes: number;
  materialsByType: Map<string, number>;
  materials: number;
  transparent: number;
  transparentDepthWrite: number;
  doubleSided: number;
  /** Groups of 10+ plain meshes sharing geometry and material: InstancedMesh candidates. */
  instancingGroups: number;
  largestInstancingGroup: number;
  frustumCulledOff: number;
  matrixAutoUpdate: number;
  maxBones: number;
  morphMeshes: number;
}

const FLOAT_TYPE = 1015;
const HALF_FLOAT_TYPE = 1016;
const NEAREST_FILTER = 1003;
const LINEAR_FILTER = 1006;
const DOUBLE_SIDE = 2;
const TOP = 5;
const AMBIENT_LIGHTS = new Set(['AmbientLight', 'HemisphereLight', 'LightProbe']);

function texelBytes(type: number | undefined): number {
  if (type === FLOAT_TYPE) return 16;
  return type === HALF_FLOAT_TYPE ? 8 : 4;
}

interface ImageSize { width: number; height: number; layers: number }

function imageSize(texture: SurveyTexture): ImageSize | null {
  const image = texture.image as { width?: number; height?: number; depth?: number } | readonly { width?: number; height?: number }[] | null | undefined;
  if (image === null || image === undefined) return null;
  if (Array.isArray(image)) {
    const face = (image as readonly { width?: number; height?: number }[])[0] as { width?: number; height?: number } | undefined;
    return face?.width === undefined || face.height === undefined ? null : { width: face.width, height: face.height, layers: image.length };
  }

  const single = image as { width?: number; height?: number; depth?: number };
  if (typeof single.width !== 'number' || typeof single.height !== 'number') return null;
  return { width: single.width, height: single.height, layers: texture.isCubeTexture === true ? 6 : (single.depth ?? 1) };
}

/** Estimated bytes of an uncompressed texture, or null when it cannot be sized (compressed, no image yet). */
export function textureBytes(texture: SurveyTexture): number | null {
  if (texture.isCompressedTexture === true) return null;
  const size = imageSize(texture);
  if (size === null) return null;
  const mips = texture.generateMipmaps !== false || (texture.mipmaps?.length ?? 0) > 1 ? 4 / 3 : 1;
  return Math.round(size.width * size.height * size.layers * texelBytes(texture.type) * mips);
}

/** Estimated bytes of a geometry: its attribute and index arrays. */
export function geometryBytes(geometry: SurveyGeometry): number {
  let bytes = geometry.index?.array?.byteLength ?? 0;
  const attributes = geometry.attributes ?? {};
  const keys = Object.keys(attributes);
  for (let i = 0, l = keys.length; i < l; i++) bytes += attributes[keys[i]]?.array?.byteLength ?? 0;
  return bytes;
}

function trianglesOf(geometry: SurveyGeometry | null | undefined): number {
  if (geometry === undefined || geometry === null) return 0;
  const count = geometry.index?.count ?? geometry.attributes?.['position']?.count ?? 0;
  return Math.floor(count / 3);
}

/**
 * Triangles a BatchedMesh draws: its live instances times their geometry's range. Its geometry is a
 * shared buffer sized for the reserved capacity, so counting that would overstate it.
 */
function batchedTriangles(object: SurveyObject): number {
  const { getGeometryIdAt, getGeometryRangeAt } = object;
  if (getGeometryIdAt === undefined || getGeometryRangeAt === undefined) return 0;
  const live = object.instanceCount ?? 0;
  const max = object.maxInstanceCount ?? 0;
  const perGeometry = new Map<number, number>();
  let triangles = 0;
  for (let id = 0, found = 0; id < max && found < live; id++) {
    let geometryId: number;
    try {
      geometryId = getGeometryIdAt.call(object, id);
    } catch {
      continue; // Deleted instance.
    }

    found++;
    let count = perGeometry.get(geometryId);
    if (count === undefined) {
      try {
        count = Math.floor((getGeometryRangeAt.call(object, geometryId)?.count ?? 0) / 3);
      } catch {
        count = 0; // Deleted geometry.
      }

      perGeometry.set(geometryId, count);
    }

    triangles += count;
  }

  return triangles;
}

function pushTop(list: NamedSize[], item: NamedSize): void {
  list.push(item);
  list.sort((a, b) => b.bytes - a.bytes);
  if (list.length > TOP) list.length = TOP;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** The object's materials, skipping holes left by disposal code (`material = null`). */
function materialList(object: SurveyObject): SurveyMaterial[] {
  const material = object.material;
  if (material === undefined || material === null) return [];
  if (!Array.isArray(material)) return [material as SurveyMaterial];
  const list: SurveyMaterial[] = [];
  for (let i = 0, l = material.length; i < l; i++) {
    const entry = (material as readonly (SurveyMaterial | null | undefined)[])[i];
    if (entry !== null && entry !== undefined) list.push(entry);
  }

  return list;
}

/** Walks the scene once and returns everything the INFO pages and scene rules read. */
export function surveyScene(scene: InfoScene): SceneSurvey {
  const survey: SceneSurvey = {
    objects: 0, meshes: 0, instancedMeshes: 0, instances: 0, batchedMeshes: 0, batchedFill: null, lods: 0,
    triangles: 0, vertices: 0, trianglesPerMesh: [], geometries: 0, nonIndexedGeometries: 0, geometryBytes: 0, topGeometries: [],
    textures: 0, textureBytes: 0, compressedTextures: 0, largeUncompressed: 0, missingMips: 0, textureSides: [], topTextures: [],
    lightsByType: new Map(), lights: 0, shadowLights: 0, pointShadows: 0, largestShadowMap: 0, shadowBytes: 0,
    materialsByType: new Map(), materials: 0, transparent: 0, transparentDepthWrite: 0, doubleSided: 0,
    instancingGroups: 0, largestInstancingGroup: 0, frustumCulledOff: 0, matrixAutoUpdate: 0, maxBones: 0, morphMeshes: 0
  };
  const geometries = new Set<string>();
  const materials = new Set<string>();
  const textures = new Set<string>();
  const pairs = new Map<string, number>();

  const visitTexture = (texture: SurveyTexture): void => {
    if (textures.has(texture.uuid)) return;
    textures.add(texture.uuid);
    survey.textures++;
    const size = imageSize(texture);
    if (size !== null) survey.textureSides.push(Math.max(size.width, size.height));
    const wantsMips = texture.minFilter !== undefined && texture.minFilter !== NEAREST_FILTER && texture.minFilter !== LINEAR_FILTER;
    if (wantsMips && texture.generateMipmaps === false && (texture.mipmaps?.length ?? 0) <= 1) survey.missingMips++;
    if (texture.isCompressedTexture === true) {
      survey.compressedTextures++;
      return;
    }

    const bytes = textureBytes(texture);
    if (bytes === null || size === null) return;
    survey.textureBytes += bytes;
    if (Math.max(size.width, size.height) >= 2048) survey.largeUncompressed++;
    pushTop(survey.topTextures, { name: texture.name !== undefined && texture.name !== '' ? texture.name : texture.uuid.slice(0, 8), bytes, detail: `${size.width}×${size.height}` });
  };

  const visitMaterial = (material: SurveyMaterial): void => {
    if (materials.has(material.uuid)) return;
    materials.add(material.uuid);
    survey.materials++;
    increment(survey.materialsByType, material.type);
    if (material['transparent'] === true) {
      survey.transparent++;
      if (material['depthWrite'] === true) survey.transparentDepthWrite++;
    }

    if (material['side'] === DOUBLE_SIDE) survey.doubleSided++;
    const keys = Object.keys(material);
    for (let i = 0, l = keys.length; i < l; i++) {
      const value = material[keys[i]] as SurveyTexture | null | undefined;
      if (value !== null && typeof value === 'object' && value.isTexture === true) visitTexture(value);
    }
  };

  scene.traverse((object) => {
    survey.objects++;
    if (object.frustumCulled === false && object.isMesh === true) survey.frustumCulledOff++;
    if (object.matrixAutoUpdate !== false) survey.matrixAutoUpdate++;
    if (object.isLOD === true) survey.lods++;
    if (object.isLight === true) {
      // Ambient, hemisphere and probe light is one uniform term, not a per-fragment light loop.
      if (!AMBIENT_LIGHTS.has(object.type)) survey.lights++;
      increment(survey.lightsByType, object.type);
      if (object.castShadow === true && object.shadow !== undefined) {
        survey.shadowLights++;
        const faces = object.isPointLight === true ? 6 : 1;
        if (faces === 6) survey.pointShadows++;
        const side = Math.max(object.shadow.mapSize?.x ?? 512, object.shadow.mapSize?.y ?? 512);
        survey.largestShadowMap = Math.max(survey.largestShadowMap, side);
        // Depth (or VSM) maps: about 4 bytes per texel.
        survey.shadowBytes += side * side * 4 * faces;
      }
    }

    if (object.isMesh !== true) return;
    survey.meshes++;
    const geometry = object.geometry;
    let copies = 1;
    if (object.isInstancedMesh === true) {
      survey.instancedMeshes++;
      copies = object.count ?? 1;
      survey.instances += copies;
    } else if (object.isBatchedMesh === true) {
      survey.batchedMeshes++;
      const max = object.maxInstanceCount ?? 0;
      if (max > 0) survey.batchedFill = Math.min(survey.batchedFill ?? 1, (object.instanceCount ?? 0) / max);
    }

    const triangles = object.isBatchedMesh === true ? batchedTriangles(object) : trianglesOf(geometry) * copies;
    survey.triangles += triangles;
    survey.trianglesPerMesh.push(triangles);
    if (object.skeleton !== undefined) survey.maxBones = Math.max(survey.maxBones, object.skeleton.bones.length);
    if ((object.morphTargetInfluences?.length ?? 0) > 0) survey.morphMeshes++;

    const list = materialList(object);
    for (let i = 0, l = list.length; i < l; i++) visitMaterial(list[i]);
    if (geometry !== undefined && geometry !== null) {
      // LOD levels share geometry by design and switch per object: not plain copies to instance.
      if (object.isInstancedMesh !== true && object.isBatchedMesh !== true && object.isSkinnedMesh !== true && (object.parent as { isLOD?: boolean } | null | undefined)?.isLOD !== true && list.length === 1) {
        const key = `${geometry.uuid}|${list[0].uuid}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }

      if (!geometries.has(geometry.uuid)) {
        geometries.add(geometry.uuid);
        survey.geometries++;
        survey.vertices += geometry.attributes?.['position']?.count ?? 0;
        if (geometry.index === null || geometry.index === undefined) survey.nonIndexedGeometries++;
        const bytes = geometryBytes(geometry);
        survey.geometryBytes += bytes;
        pushTop(survey.topGeometries, { name: geometry.name !== undefined && geometry.name !== '' ? geometry.name : geometry.uuid.slice(0, 8), bytes, detail: `${geometry.attributes?.['position']?.count ?? 0} v` });
      }
    }
  });

  const groups = Array.from(pairs.values());
  for (let i = 0, l = groups.length; i < l; i++) {
    if (groups[i] >= 10) survey.instancingGroups++;
    survey.largestInstancingGroup = Math.max(survey.largestInstancingGroup, groups[i]);
  }

  return survey;
}
