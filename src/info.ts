/**
 * Technical pages for the INFO mode: renderer settings, device limits, shader programs and a
 * scene summary. Everything comes from public renderer properties, the context and a scene
 * traversal; anything a backend does not expose is "—", never guessed.
 *
 * Pages are built when the mode opens or a page is turned, never per frame.
 */

import { PROFILE_BUDGETS, type Budgets } from './budgets.js';
import { focalLength35, type InfoCamera } from './camera.js';
import { formatBytes, formatCount } from './format.js';
import type { BackendKind, StatsRenderer } from './sampler.js';
import type { SceneSurvey } from './scene-survey.js';

export interface InfoRow {
  key: string;
  value: string;
  /** Suspicious value: shown in yellow. */
  warn?: boolean;
}

export interface InfoPage {
  title: string;
  rows: InfoRow[];
}

const TONE_MAPPING = ['None', 'Linear', 'Reinhard', 'Cineon', 'ACES Filmic', 'Custom', 'AgX', 'Neutral'];
const SHADOW_TYPES = ['Basic', 'PCF', 'PCF soft', 'VSM'];
const MAX_ROWS = 12;
const NONE = '—';

type Gl = WebGLRenderingContext & Partial<WebGL2RenderingContext>;

function gl(renderer: StatsRenderer): Gl | null {
  if (renderer.isWebGPURenderer === true) return null;
  const context = renderer.getContext?.() as Gl | undefined;
  return context?.getParameter === undefined ? null : context;
}

function param(context: Gl, name: number | undefined): string {
  if (name === undefined) return NONE;
  const value: unknown = context.getParameter(name);
  return typeof value === 'number' || typeof value === 'string' ? String(value) : NONE;
}

function gpuName(context: Gl | null): string {
  if (context === null) return NONE;
  const ext = context.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
  if (ext === null) return NONE;
  const raw = String(context.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  const match = /ANGLE \([^,]+,\s*([^,(]+)/.exec(raw);
  return (match?.[1] ?? raw).trim().slice(0, 36);
}

interface RendererSettings {
  outputColorSpace?: string;
  toneMapping?: number;
  toneMappingExposure?: number;
  shadowMap?: { enabled: boolean; type?: number };
  getPixelRatio?: () => number;
}

function rendererPage(renderer: StatsRenderer, backend: BackendKind, budgets: Budgets): InfoPage {
  const settings = renderer as StatsRenderer & RendererSettings;
  const context = gl(renderer);
  const canvas = renderer.domElement;
  const ratio = settings.getPixelRatio?.() ?? null;
  const space = settings.outputColorSpace ?? null;
  const attributes = context?.getContextAttributes() ?? null;
  const shadow = settings.shadowMap;
  return {
    title: 'Renderer',
    rows: [
      { key: 'Backend', value: backend === 'webgpu' ? 'WebGPU' : backend === 'webgl' ? 'WebGL 2' : 'WebGL 2 (WebGPU fallback)' },
      { key: 'GPU', value: gpuName(context) },
      { key: 'Buffer', value: `${canvas.width} × ${canvas.height}` },
      { key: 'CSS size', value: `${canvas.clientWidth} × ${canvas.clientHeight}` },
      { key: 'Pixel ratio', value: ratio === null ? NONE : ratio.toFixed(2), warn: ratio !== null && ratio > budgets.pixelRatio },
      { key: 'Colour space', value: space ?? NONE, warn: space !== null && space !== 'srgb' },
      { key: 'Tone mapping', value: settings.toneMapping === undefined ? NONE : (TONE_MAPPING[settings.toneMapping] ?? String(settings.toneMapping)) },
      { key: 'Exposure', value: settings.toneMappingExposure === undefined ? NONE : settings.toneMappingExposure.toFixed(2) },
      { key: 'Shadows', value: shadow === undefined ? NONE : shadow.enabled ? (SHADOW_TYPES[shadow.type ?? 1] ?? 'On') : 'Off' },
      { key: 'Antialias', value: attributes === null ? NONE : attributes.antialias === true ? 'On' : 'Off' }
    ]
  };
}

function limitsPage(renderer: StatsRenderer): InfoPage {
  const context = gl(renderer);
  if (context === null) {
    const device = (renderer.backend as { device?: { limits?: Record<string, number>; features?: { size: number } } } | undefined)?.device;
    const limits = device?.limits;
    const get = (name: string): string => (limits?.[name] === undefined ? NONE : String(limits[name]));
    return {
      title: 'Limits',
      rows: [
        { key: 'Texture 2D', value: get('maxTextureDimension2D') },
        { key: 'Bind groups', value: get('maxBindGroups') },
        { key: 'Storage buffers', value: get('maxStorageBuffersPerShaderStage') },
        { key: 'Workgroup size', value: get('maxComputeWorkgroupSizeX') },
        { key: 'Features', value: device?.features === undefined ? NONE : String(device.features.size) }
      ]
    };
  }

  const has = (name: string): string => (context.getExtension(name) === null ? 'No' : 'Yes');
  return {
    title: 'Limits',
    rows: [
      { key: 'Texture size', value: param(context, context.MAX_TEXTURE_SIZE) },
      { key: 'Texture units', value: param(context, context.MAX_TEXTURE_IMAGE_UNITS) },
      { key: 'Vertex attributes', value: param(context, context.MAX_VERTEX_ATTRIBS) },
      { key: 'MSAA samples', value: param(context, context.MAX_SAMPLES) },
      { key: 'Renderbuffer', value: param(context, context.MAX_RENDERBUFFER_SIZE) },
      { key: 'GPU timer', value: has('EXT_disjoint_timer_query_webgl2') },
      { key: 'Float buffers', value: has('EXT_color_buffer_float') },
      { key: 'Parallel compile', value: has('KHR_parallel_shader_compile') }
    ]
  };
}

function programsPage(renderer: StatsRenderer): InfoPage {
  const programs = renderer.info.programs as readonly { name?: string; usedTimes?: number }[] | null | undefined;
  if (programs === null || programs === undefined) {
    return { title: 'Programs', rows: [{ key: 'Programs', value: NONE }, { key: 'Note', value: 'Not exposed by this backend' }] };
  }

  const rows: InfoRow[] = [{ key: 'Programs', value: String(programs.length) }];
  for (let i = 0, l = Math.min(programs.length, MAX_ROWS - 2); i < l; i++) {
    rows.push({ key: (programs[i].name ?? `#${i}`).slice(0, 24), value: `${programs[i].usedTimes ?? 0}×` });
  }

  if (programs.length > MAX_ROWS - 2) rows.push({ key: '', value: `+${programs.length - (MAX_ROWS - 2)}` });
  return { title: 'Programs', rows };
}

function scenePage(survey: SceneSurvey | null | undefined, budgets: Budgets): InfoPage {
  if (survey === undefined) return { title: 'Scene', rows: [{ key: 'Scene', value: NONE }, { key: 'Note', value: 'Pass { scene } to Stats' }] };
  if (survey === null) return { title: 'Scene', rows: [{ key: 'Scene', value: NONE }, { key: 'Note', value: 'The scene could not be read' }] };
  return {
    title: 'Scene',
    rows: [
      { key: 'Objects', value: formatCount(survey.objects) },
      { key: 'Meshes', value: formatCount(survey.meshes) },
      { key: 'Instanced meshes', value: String(survey.instancedMeshes) },
      { key: 'Instances', value: formatCount(survey.instances) },
      { key: 'Triangles (est.)', value: formatCount(survey.triangles) },
      { key: 'Lights', value: String(survey.lights), warn: survey.lights > budgets.lights },
      { key: 'Shadow casters', value: String(survey.shadowLights), warn: survey.shadowLights > budgets.shadowLights },
      { key: 'Materials', value: String(survey.materials) },
      { key: 'Textures', value: String(survey.textures) },
      { key: 'Texture mem. (est.)', value: formatBytes(survey.textureBytes) },
      { key: 'Geometry mem. (est.)', value: formatBytes(survey.geometryBytes) }
    ]
  };
}

function cameraPage(camera: InfoCamera | null | undefined): InfoPage {
  if (camera === null || camera === undefined) return { title: 'Camera', rows: [{ key: 'Camera', value: NONE }, { key: 'Note', value: 'Pass { camera } to Stats' }] };
  const perspective = camera.isPerspectiveCamera === true;
  const ratio = camera.near > 0 ? camera.far / camera.near : null;
  const fixed = (value: number): string => (Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2));
  return {
    title: 'Camera',
    rows: [
      { key: 'Type', value: perspective ? 'Perspective' : camera.isOrthographicCamera === true ? 'Orthographic' : (camera.type ?? NONE) },
      { key: 'Field of view', value: perspective && camera.fov !== undefined ? `${camera.fov.toFixed(1)}°` : NONE },
      { key: 'Focal (35 mm eq.)', value: perspective && camera.fov !== undefined ? `${focalLength35(camera.fov).toFixed(0)} mm` : NONE },
      { key: 'Aspect', value: camera.aspect === undefined ? NONE : camera.aspect.toFixed(2) },
      { key: 'Zoom', value: camera.zoom === undefined ? NONE : camera.zoom.toFixed(2) },
      { key: 'Near', value: String(camera.near) },
      { key: 'Far', value: String(camera.far) },
      { key: 'Far / near', value: ratio === null ? NONE : formatCount(ratio), warn: perspective && ratio !== null && ratio > 100_000 },
      { key: 'Position', value: `${fixed(camera.position.x)}, ${fixed(camera.position.y)}, ${fixed(camera.position.z)}` }
    ]
  };
}

export const INFO_PAGES = 5;

/** What the pages read besides the renderer. */
export interface PageSources {
  /** The shared scene survey: undefined without a scene, null when the scene could not be read. */
  survey?: () => SceneSurvey | null | undefined;
  camera?: () => InfoCamera | null;
  /** Limits for the yellow rows; the desktop profile by default. */
  budgets?: Budgets;
}

/** Builds one page; cheap, the scene page reuses the shared survey. */
export function buildPage(index: number, renderer: StatsRenderer, backend: BackendKind, sources: PageSources = {}): InfoPage {
  const budgets = sources.budgets ?? PROFILE_BUDGETS.desktop;
  switch (index % INFO_PAGES) {
    case 0: return rendererPage(renderer, backend, budgets);
    case 1: return limitsPage(renderer);
    case 2: return programsPage(renderer);
    case 3: return scenePage(sources.survey?.(), budgets);
    default: return cameraPage(sources.camera?.());
  }
}
