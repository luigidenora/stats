/**
 * A plain-JSON picture of everything the overlay knows right now: what an agent, a test or a bug
 * report needs to reason about performance without reading pixels. Stable field names; values a
 * backend cannot measure are null.
 */

import type { Budgets, DeviceProfile } from './budgets.js';
import type { FramePacing } from './frame-stats.js';
import type { Pressure } from './pressure.js';
import type { StatsReport } from './recorder.js';
import type { BackendKind } from './sampler.js';
import type { NamedSize, SceneSurvey } from './scene-survey.js';

export interface SceneSummary extends Omit<SceneSurvey, 'lightsByType' | 'materialsByType' | 'trianglesPerMesh' | 'textureSides' | 'topGeometries' | 'topTextures'> {
  lightsByType: Record<string, number>;
  materialsByType: Record<string, number>;
  /** The heaviest geometries and textures, by estimated bytes. */
  topGeometries: NamedSize[];
  topTextures: NamedSize[];
}

export interface StatsSnapshot {
  /** Schema version of this object. */
  version: 2;
  mode: string;
  backend: BackendKind;
  profile: DeviceProfile;
  /** Frame budget, in ms. */
  budget: number;
  budgets: Budgets;
  /** Averages of the last refresh: frames per second, CPU and GPU ms per frame, JS heap in MB. */
  frame: { fps: number | null; cpu: number | null; gpu: number | null; heap: number | null };
  /** Pacing of the last 240 frames, in ms: stutter the average hides. */
  pacing: FramePacing | null;
  /** Renderer counters of the last frame; memory counters are live objects on the GPU. */
  counters: { calls: number; triangles: number; points: number; lines: number; geometries: number; textures: number; programs: number | null; passes: number | null };
  canvas: { width: number; height: number; cssWidth: number; cssHeight: number; pixelRatio: number | null };
  pressure: Pressure;
  /** Scene survey (needs `scene`); byte sizes are estimates. */
  scene: SceneSummary | null;
  recording: boolean;
  /** The last finished recording. */
  report: StatsReport | null;
}

function record(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  const keys = Array.from(map.keys());
  for (let i = 0, l = keys.length; i < l; i++) out[keys[i]] = map.get(keys[i]) ?? 0;
  return out;
}

/** The survey without its per-mesh arrays, with Maps as plain objects. */
export function summariseScene(survey: SceneSurvey): SceneSummary {
  const summary: SceneSummary & { trianglesPerMesh?: number[] | undefined; textureSides?: number[] | undefined } = {
    ...survey, lightsByType: record(survey.lightsByType), materialsByType: record(survey.materialsByType)
  };
  // Per-mesh and per-texture arrays are for the histograms, too long for a summary (undefined is left out of JSON).
  summary.trianglesPerMesh = undefined;
  summary.textureSides = undefined;
  return summary;
}
