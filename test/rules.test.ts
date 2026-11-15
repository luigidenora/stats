import { describe, expect, it } from 'vitest';
import type { DiagnosticContext, DiagnosticRule } from '../src/diagnostics.js';
import { FRAME_RULES, SCENE_RULES } from '../src/rules.js';
import type { SceneSurvey } from '../src/scene-survey.js';
import { BUDGET, makeContext, makeSurvey } from './helpers.js';

const ALL = [...FRAME_RULES, ...SCENE_RULES];

function rule(id: string): DiagnosticRule {
  const found = ALL.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no rule ${id}`);
  return found;
}

function fires(id: string, overrides: Partial<DiagnosticContext>): boolean {
  return rule(id).check(makeContext(overrides)) !== null;
}

function firesOnScene(id: string, survey: Partial<SceneSurvey>, overrides: Partial<DiagnosticContext> = {}): boolean {
  return rule(id).check(makeContext({ scene: makeSurvey(survey), ...overrides })) !== null;
}

describe('rule catalogue', () => {
  it('has unique ids, titles, the right scope and never fires on a healthy frame and an empty scene', () => {
    const ids = new Set(ALL.map((entry) => entry.id));
    expect(ids.size).toBe(ALL.length);
    for (const entry of FRAME_RULES) {
      expect(entry.scope ?? 'frame').toBe('frame');
      expect(entry.title).not.toBe('');
      expect(entry.check(makeContext()), entry.id).toBeNull();
    }

    for (const entry of SCENE_RULES) {
      expect(entry.scope).toBe('scene');
      expect(entry.check(makeContext({ scene: makeSurvey() })), entry.id).toBeNull();
      expect(entry.check(makeContext({ scene: null })), `${entry.id} without a scene`).toBeNull();
    }
  });

  it('never fires a frame rule on values a backend cannot measure', () => {
    const unknown = makeContext({ fps: null, cpu: null, gpu: null, p95: null, dropped: null, jitter: null, blocking: null, passes: null, programs: null, geometryGrowth: null, textureGrowth: null, gcRate: null, pixelRatio: null });
    for (const entry of FRAME_RULES) expect(entry.check(unknown), entry.id).toBeNull();
  });

  it('gives every finding a message and a piece of advice', () => {
    const finding = rule('draw-calls').check(makeContext({ calls: 5000 }));
    expect(finding?.message).toContain('5.0K');
    expect(finding?.advice.length).toBeGreaterThan(10);
  });
});

describe('frame rules', () => {
  it('gpu-bound: GPU past 90% of the budget and clearly slower than the CPU', () => {
    expect(fires('gpu-bound', { gpu: BUDGET * 0.89, cpu: 1 })).toBe(false);
    expect(fires('gpu-bound', { gpu: BUDGET * 0.95, cpu: 1 })).toBe(true);
    expect(fires('gpu-bound', { gpu: BUDGET * 0.95, cpu: null })).toBe(true);
    expect(fires('gpu-bound', { gpu: BUDGET * 0.95, cpu: BUDGET * 0.9 })).toBe(false);
  });

  it('cpu-bound mirrors gpu-bound', () => {
    expect(fires('cpu-bound', { cpu: BUDGET * 0.89, gpu: 1 })).toBe(false);
    expect(fires('cpu-bound', { cpu: BUDGET * 0.95, gpu: 1 })).toBe(true);
    expect(fires('cpu-bound', { cpu: BUDGET * 0.95, gpu: null })).toBe(true);
    expect(fires('cpu-bound', { cpu: BUDGET * 0.95, gpu: BUDGET * 0.9 })).toBe(false);
  });

  it('no-headroom: between 85% and 90% of the budget, where the bound rules take over', () => {
    expect(fires('no-headroom', { cpu: BUDGET * 0.84, gpu: 0 })).toBe(false);
    expect(fires('no-headroom', { cpu: BUDGET * 0.87, gpu: 0 })).toBe(true);
    expect(fires('no-headroom', { gpu: BUDGET * 0.87, cpu: null })).toBe(true);
    expect(fires('no-headroom', { cpu: BUDGET * 0.95, gpu: 0 })).toBe(false);
  });

  it('no-headroom also covers CPU and GPU both at or over the budget, where neither bound rule fires', () => {
    expect(fires('gpu-bound', { cpu: BUDGET * 0.93, gpu: BUDGET * 0.96 })).toBe(false);
    expect(fires('cpu-bound', { cpu: BUDGET * 0.93, gpu: BUDGET * 0.96 })).toBe(false);
    expect(fires('no-headroom', { cpu: BUDGET * 0.93, gpu: BUDGET * 0.96 })).toBe(true);
    expect(fires('no-headroom', { cpu: BUDGET * 1.5, gpu: BUDGET * 1.5 })).toBe(true);
    expect(rule('no-headroom').check(makeContext({ cpu: BUDGET * 1.5, gpu: BUDGET * 1.5 }))?.message).toMatch(/both/i);
  });

  it('refresh-rate: frames arrive clearly faster than the budget assumes', () => {
    expect(fires('refresh-rate', { fps: 62 })).toBe(false);
    expect(fires('refresh-rate', { fps: 118 })).toBe(true);
    expect(rule('refresh-rate').check(makeContext({ fps: 118 }))?.advice).toContain('1000 / 120');
  });

  it('stutter: P95 past 1.25× the budget', () => {
    expect(fires('stutter', { p95: BUDGET * 1.25 })).toBe(false);
    expect(fires('stutter', { p95: BUDGET * 1.3 })).toBe(true);
  });

  it('jitter: σ above 2 ms while P95 is fine (otherwise stutter says it)', () => {
    expect(fires('jitter', { jitter: 2 })).toBe(false);
    expect(fires('jitter', { jitter: 2.5 })).toBe(true);
    expect(fires('jitter', { jitter: 2.5, p95: BUDGET * 1.3 })).toBe(false);
  });

  it('long-tasks: more than 50 ms per second blocked', () => {
    expect(fires('long-tasks', { blocking: 50 })).toBe(false);
    expect(fires('long-tasks', { blocking: 51 })).toBe(true);
  });

  it('shader-compiles: any program created after warm-up, with a plural', () => {
    expect(fires('shader-compiles', { recentPrograms: 0 })).toBe(false);
    expect(rule('shader-compiles').check(makeContext({ recentPrograms: 1 }))?.message).toMatch(/1 new shader program in/);
    expect(rule('shader-compiles').check(makeContext({ recentPrograms: 3 }))?.message).toMatch(/3 new shader programs/);
  });

  it('gc-pressure: at least one collection every two seconds', () => {
    expect(fires('gc-pressure', { gcRate: 0.4 })).toBe(false);
    expect(fires('gc-pressure', { gcRate: 0.5 })).toBe(true);
  });

  it('geometry-leak and texture-leak: steady growth past 20 and 10', () => {
    expect(fires('geometry-leak', { geometryGrowth: 19 })).toBe(false);
    expect(fires('geometry-leak', { geometryGrowth: 20 })).toBe(true);
    expect(fires('texture-leak', { textureGrowth: 9 })).toBe(false);
    expect(fires('texture-leak', { textureGrowth: 10 })).toBe(true);
  });

  it('draw-calls and triangles: above the profile budget', () => {
    const budgets = makeContext().budgets;
    expect(fires('draw-calls', { calls: budgets.calls })).toBe(false);
    expect(fires('draw-calls', { calls: budgets.calls + 1 })).toBe(true);
    expect(fires('triangles', { triangles: budgets.triangles })).toBe(false);
    expect(fires('triangles', { triangles: budgets.triangles + 1 })).toBe(true);
    expect(rule('triangles').check(makeContext({ profile: 'mobile', triangles: 1e6, budgets: { ...budgets, triangles: 750_000 } }))?.message).toContain('mobile budget 750K');
  });

  it('small-draws: under 100 primitives per call, from 50 calls up', () => {
    expect(fires('small-draws', { calls: 60, triangles: 0, lines: 60 * 500 })).toBe(false);
    expect(fires('small-draws', { calls: 60, triangles: 0, points: 60 * 500 })).toBe(false);
    expect(fires('small-draws', { calls: 49, triangles: 49 })).toBe(false);
    expect(fires('small-draws', { calls: 50, triangles: 50 * 99 })).toBe(true);
    expect(fires('small-draws', { calls: 50, triangles: 50 * 100 })).toBe(false);
  });

  it('passes: more than 4 render passes', () => {
    expect(fires('passes', { passes: 4 })).toBe(false);
    expect(fires('passes', { passes: 5 })).toBe(true);
  });

  it('pixel-ratio: above the profile limit, or a buffer more than 10% larger than the display', () => {
    expect(fires('pixel-ratio', { pixelRatio: 2 })).toBe(false);
    expect(fires('pixel-ratio', { pixelRatio: 3 })).toBe(true);
    expect(fires('pixel-ratio', { bufferPixels: 1100, displayPixels: 1000 })).toBe(false);
    expect(fires('pixel-ratio', { bufferPixels: 1200, displayPixels: 1000 })).toBe(true);
    expect(fires('pixel-ratio', { bufferPixels: 1200, displayPixels: 0 })).toBe(false);
  });

  it('context-lost: any loss', () => {
    expect(fires('context-lost', { contextLost: 0 })).toBe(false);
    expect(fires('context-lost', { contextLost: 1 })).toBe(true);
  });
});

describe('scene rules', () => {
  const MB = 1048576;

  it('texture-memory: estimated bytes above the budget', () => {
    expect(firesOnScene('texture-memory', { textureBytes: 512 * MB })).toBe(false);
    expect(firesOnScene('texture-memory', { textureBytes: 513 * MB })).toBe(true);
  });

  it('large-textures and missing-mips: any', () => {
    expect(firesOnScene('large-textures', { largeUncompressed: 1 })).toBe(true);
    expect(firesOnScene('missing-mips', { missingMips: 2 })).toBe(true);
  });

  it('program-variants: more than 1.5 programs per material, and more than 8', () => {
    expect(firesOnScene('program-variants', { materials: 4 }, { programs: 7 })).toBe(false);
    expect(firesOnScene('program-variants', { materials: 4 }, { programs: 9 })).toBe(true);
    expect(firesOnScene('program-variants', { materials: 10 }, { programs: 15 })).toBe(false);
    expect(firesOnScene('program-variants', { materials: 10 }, { programs: 16 })).toBe(true);
    expect(firesOnScene('program-variants', { materials: 0 }, { programs: 16 })).toBe(false);
    expect(firesOnScene('program-variants', { materials: 4 }, { programs: null })).toBe(false);
  });

  it('lights: above the profile budget', () => {
    expect(firesOnScene('lights', { lights: 8 })).toBe(false);
    expect(firesOnScene('lights', { lights: 9 })).toBe(true);
  });

  it('shadows: silent when the renderer has shadow maps off', () => {
    expect(firesOnScene('shadows', { shadowLights: 9, pointShadows: 3 }, { shadowMapEnabled: false })).toBe(false);
    expect(firesOnScene('shadows', { shadowLights: 9 }, { shadowMapEnabled: null })).toBe(true);
  });

  it('shadows: too many casters, then point shadows, then oversized maps', () => {
    expect(firesOnScene('shadows', { shadowLights: 3, largestShadowMap: 4096 })).toBe(false);
    expect(rule('shadows').check(makeContext({ scene: makeSurvey({ shadowLights: 4, pointShadows: 1 }) }))?.message).toContain('4 shadow-casting');
    expect(rule('shadows').check(makeContext({ scene: makeSurvey({ shadowLights: 1, pointShadows: 1 }) }))?.message).toContain('6 renders');
    expect(firesOnScene('shadows', { shadowLights: 1, largestShadowMap: 8192 })).toBe(true);
  });

  it('overdraw: more than 50 transparent materials, or transparent ones writing depth', () => {
    expect(firesOnScene('overdraw', { transparent: 50 })).toBe(false);
    expect(firesOnScene('overdraw', { transparent: 51 })).toBe(true);
    expect(firesOnScene('overdraw', { transparent: 1, transparentDepthWrite: 1 })).toBe(true);
  });

  it('instancing, culling-off, static-matrices, batched-fill and bones', () => {
    expect(firesOnScene('instancing', { instancingGroups: 1, largestInstancingGroup: 12 })).toBe(true);
    expect(firesOnScene('culling-off', { frustumCulledOff: 20 })).toBe(false);
    expect(firesOnScene('culling-off', { frustumCulledOff: 21 })).toBe(true);
    expect(firesOnScene('static-matrices', { matrixAutoUpdate: 1000 })).toBe(false);
    expect(firesOnScene('static-matrices', { matrixAutoUpdate: 1001 })).toBe(true);
    expect(firesOnScene('batched-fill', { batchedFill: 0.5 })).toBe(false);
    expect(firesOnScene('batched-fill', { batchedFill: 0.2 })).toBe(true);
    expect(firesOnScene('bones', { maxBones: 100 })).toBe(false);
    expect(firesOnScene('bones', { maxBones: 100 }, { profile: 'mobile' })).toBe(true);
  });
});
