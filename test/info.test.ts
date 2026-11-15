import { describe, expect, it } from 'vitest';
import { Diagnostics } from '../src/diagnostics.js';
import { buildPage, INFO_PAGES, type InfoPage } from '../src/info.js';
import type { StatsRenderer } from '../src/sampler.js';
import { surveyScene } from '../src/scene-survey.js';
import { fakeRenderer, makeContext } from './helpers.js';

function value(page: InfoPage, key: string): string | undefined {
  return page.rows.find((row) => row.key === key)?.value;
}

/** A WebGL 2 context that answers the parameters the pages ask for. */
function glRenderer(): StatsRenderer {
  const renderer = fakeRenderer({ programs: [{ name: 'MeshStandardMaterial', usedTimes: 3 }, { usedTimes: 1 }] });
  const gl = {
    MAX_TEXTURE_SIZE: 1, MAX_TEXTURE_IMAGE_UNITS: 2, MAX_VERTEX_ATTRIBS: 3, MAX_SAMPLES: 4, MAX_RENDERBUFFER_SIZE: 5,
    getParameter: (name: number): unknown => ({ 1: 16384, 2: 16, 3: 16, 4: 8, 5: 16384, 99: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x2786) Direct3D11)' } as Record<number, unknown>)[name] ?? null,
    getExtension: (name: string): unknown => (name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 99 } : name === 'KHR_parallel_shader_compile' ? {} : null),
    getContextAttributes: () => ({ antialias: true })
  };
  return Object.assign(renderer, {
    getContext: () => gl, getPixelRatio: () => 3, outputColorSpace: 'srgb-linear', toneMapping: 4, toneMappingExposure: 1.2,
    shadowMap: { enabled: true, type: 2 }
  });
}

describe('INFO pages', () => {
  it('has a page for each index, wrapping around', () => {
    const renderer = glRenderer();
    const titles = [];
    for (let i = 0; i < INFO_PAGES + 1; i++) titles.push(buildPage(i, renderer, 'webgl').title);
    expect(titles).toEqual(['Renderer', 'Limits', 'Programs', 'Scene', 'Camera', 'Diagnostics', 'Renderer']);
  });

  it('describes the WebGL renderer and flags suspicious settings', () => {
    const page = buildPage(0, glRenderer(), 'webgl');
    expect(value(page, 'Backend')).toBe('WebGL 2');
    expect(value(page, 'GPU')).toBe('NVIDIA GeForce RTX 4070');
    expect(value(page, 'Tone mapping')).toBe('ACES Filmic');
    expect(value(page, 'Shadows')).toBe('PCF soft');
    expect(value(page, 'Antialias')).toBe('On');
    expect(page.rows.find((row) => row.key === 'Pixel ratio')?.warn).toBe(true);
    expect(page.rows.find((row) => row.key === 'Colour space')?.warn).toBe(true);
  });

  it('shows a dash for what a backend does not expose', () => {
    const page = buildPage(0, fakeRenderer({ webgpu: true }), 'webgpu');
    expect(value(page, 'Backend')).toBe('WebGPU');
    expect(value(page, 'GPU')).toBe('—');
    expect(value(page, 'Antialias')).toBe('—');
    expect(buildPage(0, fakeRenderer({ webgpu: true }), 'webgpu-webgl').rows[0].value).toContain('fallback');
  });

  it('lists WebGL limits and extensions, and WebGPU device limits', () => {
    const gl = buildPage(1, glRenderer(), 'webgl');
    expect(value(gl, 'Texture size')).toBe('16384');
    expect(value(gl, 'GPU timer')).toBe('No');
    expect(value(gl, 'Parallel compile')).toBe('Yes');

    const gpu = fakeRenderer({ webgpu: true });
    gpu.backend = { device: { limits: { maxTextureDimension2D: 8192, maxBindGroups: 4 }, features: { size: 7 } } };
    const page = buildPage(1, gpu, 'webgpu');
    expect(value(page, 'Texture 2D')).toBe('8192');
    expect(value(page, 'Features')).toBe('7');
    expect(value(page, 'Storage buffers')).toBe('—');
  });

  it('lists shader programs, or says the backend does not expose them', () => {
    const page = buildPage(2, glRenderer(), 'webgl');
    expect(page.rows.map((row) => [row.key, row.value])).toEqual([['Programs', '2'], ['MeshStandardMaterial', '3×'], ['#1', '1×']]);
    expect(value(buildPage(2, fakeRenderer({ webgpu: true }), 'webgpu'), 'Programs')).toBe('—');
  });

  it('caps a long program list with a "+n" row', () => {
    const programs = Array.from({ length: 30 }, (_, i) => ({ name: `P${i}`, usedTimes: 1 }));
    const page = buildPage(2, fakeRenderer({ programs }), 'webgl');
    expect(page.rows.at(-1)).toEqual({ key: '', value: '+20' });
  });

  it('summarises the scene, or asks for one', () => {
    expect(value(buildPage(3, glRenderer(), 'webgl'), 'Note')).toBe('Pass { scene } to Stats');
    const scene = { traverse: (callback: (object: { type: string; isLight?: boolean; castShadow?: boolean; shadow?: object }) => void) => {
      for (let i = 0; i < 5; i++) callback({ type: 'SpotLight', isLight: true, castShadow: true, shadow: {} });
    } };
    const page = buildPage(3, glRenderer(), 'webgl', { survey: () => surveyScene(scene) });
    expect(value(page, 'Lights')).toBe('5');
    expect(page.rows.find((row) => row.key === 'Shadow casters')?.warn).toBe(true);
    expect(value(buildPage(3, glRenderer(), 'webgl', { survey: () => null }), 'Note')).toBe('The scene could not be read');
  });

  it('flags rows against the profile budgets', () => {
    const mobile = { calls: 250, triangles: 750_000, pixelRatio: 1.5, textureMB: 256, lights: 4, shadowLights: 1, shadowMapSize: 2048 };
    const renderer = Object.assign(glRenderer(), { getPixelRatio: () => 2 });
    expect(buildPage(0, renderer, 'webgl').rows.find((row) => row.key === 'Pixel ratio')?.warn).toBe(false);
    expect(buildPage(0, renderer, 'webgl', { budgets: mobile }).rows.find((row) => row.key === 'Pixel ratio')?.warn).toBe(true);
  });

  it('describes the camera as a lens, and flags a depth range that will z-fight', () => {
    expect(value(buildPage(4, glRenderer(), 'webgl'), 'Note')).toBe('Pass { camera } to Stats');
    const camera = { isPerspectiveCamera: true, fov: 39.6, aspect: 1.5, zoom: 1, near: 0.001, far: 5000, position: { x: 0, y: 1.5, z: 250 } };
    const page = buildPage(4, glRenderer(), 'webgl', { camera: () => camera });
    expect(value(page, 'Type')).toBe('Perspective');
    expect(value(page, 'Focal (35 mm eq.)')).toBe('33 mm');
    expect(value(page, 'Position')).toBe('0.00, 1.50, 250');
    expect(page.rows.find((row) => row.key === 'Far / near')?.warn).toBe(true);
  });

  it('lists the diagnostics, warnings first', () => {
    expect(value(buildPage(5, glRenderer(), 'webgl'), 'Checks')).toBe('Off');
    const diagnostics = new Diagnostics([
      { id: 'fine', title: 'Fine', check: () => null },
      { id: 'bad', title: 'Bad', check: () => ({ message: 'x', advice: 'y' }) },
      { id: 'later', title: 'Later', scope: 'scene', check: () => null }
    ]);
    diagnostics.evaluate(makeContext(), 'frame');
    diagnostics.evaluate(makeContext(), 'frame');
    const page = buildPage(5, glRenderer(), 'webgl', { diagnostics });
    expect(page.rows.map((row) => [row.key, row.value, row.warn])).toEqual([
      ['Checks', '3, 1 to look at', true], ['Bad', 'Look', true], ['Fine', 'OK', false], ['Later', '—', false]
    ]);
  });
});
