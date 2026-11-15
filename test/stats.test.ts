// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Stats, type StatsOptions } from '../src/stats.js';
import type { InfoScene } from '../src/scene-survey.js';
import { fakeRenderer, must, stubCanvas2d, type FakeRenderer } from './helpers.js';

let now = 0;
let restoreCanvas: () => void;
const open: Stats[] = [];

beforeEach(() => {
  now = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  restoreCanvas = stubCanvas2d();
  localStorage.clear();
});

afterEach(() => {
  while (open.length > 0) must(open.pop()).dispose();
  restoreCanvas();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function setup(options: StatsOptions = {}, renderer: FakeRenderer = fakeRenderer({ canvas: document.createElement('canvas') })): { stats: Stats; renderer: FakeRenderer } {
  document.body.append(renderer.domElement);
  const stats = new Stats(renderer, { profile: 'desktop', ...options });
  open.push(stats);
  return { stats, renderer };
}

/** Runs `seconds` of 60 Hz frames; `draw` sets the renderer counters inside each frame. */
function run(stats: Stats, seconds: number, draw?: () => void): void {
  for (let i = 0, l = Math.round(seconds * 60); i < l; i++) {
    stats.begin();
    draw?.();
    now += 2;
    stats.end();
    now += 1000 / 60 - 2;
  }
}

function tipPlate(stats: Stats): HTMLElement {
  return must(stats.element.querySelector<HTMLElement>('.tez-tips'));
}

describe('Stats lifecycle', () => {
  it('mounts one overlay over the canvas and removes it, restoring the renderer, on dispose', () => {
    const { stats, renderer } = setup();
    expect(document.querySelectorAll('.tez-stats')).toHaveLength(1);
    expect(renderer.info.autoReset).toBe(false);
    must(open.pop()).dispose();
    expect(document.querySelectorAll('.tez-stats')).toHaveLength(0);
    expect(renderer.info.autoReset).toBe(true);
    expect(stats.element.isConnected).toBe(false);
  });

  it('starts in the requested mode, and in simple for an unknown one', () => {
    expect(setup({ mode: 'performance' }).stats.mode).toBe('performance');
    expect(setup({ mode: 'nope' as never }).stats.mode).toBe('simple');
  });

  it('remembers a mode picked with the plate, not one set from code', () => {
    const { stats } = setup();
    stats.mode = 'memory';
    expect(localStorage.getItem('tez-stats-mode')).toBeNull();
    const plate = must(stats.element.querySelector<HTMLButtonElement>('.tez-disp-button'));
    plate.click();
    const picked = stats.mode;
    expect(picked).not.toBe('memory');
    expect(localStorage.getItem('tez-stats-mode')).toBe(picked);
    expect(setup().stats.mode).toBe(picked);
    expect(setup({ remember: false, mode: 'simple' }).stats.mode).toBe('simple');
  });

  it('applies a custom mode passed as an option once defineMode adds it', () => {
    const { stats } = setup({ mode: 'lod', remember: false });
    expect(stats.mode).toBe('simple');
    stats.defineMode({ id: 'lod', name: 'Level of detail', code: 'LOD', description: 'LOD levels.' });
    expect(stats.mode).toBe('lod');
  });

  it('lets a mode set from code win over a remembered custom mode defined later', () => {
    localStorage.setItem('tez-stats-mode', 'lod');
    const { stats } = setup();
    stats.mode = 'performance';
    stats.defineMode({ id: 'lod', name: 'Level of detail', code: 'LOD', description: 'LOD levels.' });
    expect(stats.mode).toBe('performance');
  });

  it('applies a custom mode from the options even when a stale custom mode is remembered', () => {
    localStorage.setItem('tez-stats-mode', 'mode-of-another-app');
    const { stats } = setup({ mode: 'lod' });
    stats.defineMode({ id: 'lod', name: 'Level of detail', code: 'LOD', description: 'LOD levels.' });
    expect(stats.mode).toBe('lod');
  });

  it('ignores the remembered mode when the overlay is not interactive (no plate to change it)', () => {
    localStorage.setItem('tez-stats-mode', 'memory');
    expect(setup({ interactive: false, mode: 'performance' }).stats.mode).toBe('performance');
  });

  it('follows a canvas that moves without resizing (a banner opening above it)', () => {
    const renderer = fakeRenderer({ canvas: document.createElement('canvas') });
    let top = 0;
    renderer.domElement.getBoundingClientRect = () => new DOMRect(0, top, 300, 150);
    const { stats } = setup({}, renderer);
    run(stats, 0.5);
    expect(stats.element.style.top).toBe('0px');
    top = 40;
    run(stats, 0.5);
    expect(stats.element.style.top).toBe('40px');
  });

  it('does not show a bogus frame rate on the first refresh after a hidden tab', () => {
    const { stats } = setup();
    run(stats, 1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    now += 5000;
    run(stats, 0.03);
    const fps = must(stats.element.querySelector<HTMLElement>('[data-tip^="Frames per second"]'));
    expect(fps.textContent).toContain('60');
    run(stats, 1);
    expect(fps.textContent).toContain('60');
  });

  it('waits for a remembered custom mode until defineMode adds it', () => {
    localStorage.setItem('tez-stats-mode', 'lod');
    const { stats } = setup();
    expect(stats.mode).toBe('simple');
    stats.defineMode({ id: 'lod', name: 'Level of detail', code: 'LOD', description: 'LOD levels.', graphs: [] });
    expect(stats.mode).toBe('lod');
  });

  it('writes the FPS readout at the refresh interval', () => {
    const { stats } = setup();
    run(stats, 1);
    const fps = must(stats.element.querySelector<HTMLElement>('[data-tip^="Frames per second"]'));
    expect(fps.textContent).toContain('60');
  });

  it('leaves out excluded built-in metrics', () => {
    const { stats } = setup({ exclude: ['calls', 'p95'] });
    expect(stats.element.querySelector('[data-tip^="Draw calls"]')).toBeNull();
    expect(stats.element.querySelector('[data-tip^="P95"]')).toBeNull();
    expect(stats.element.querySelector('[data-tip^="Triangles"]')).not.toBeNull();
  });
});

describe('Stats budgets and diagnostics', () => {
  it('resolves the profile and the overrides', () => {
    const { stats } = setup({ profile: 'mobile', budgets: { calls: 100 } });
    expect(stats.profile).toBe('mobile');
    expect(stats.budgets.calls).toBe(100);
    expect(stats.budgets.triangles).toBe(750_000);
  });

  it('shows no TIP plate while everything is fine', () => {
    const { stats } = setup();
    run(stats, 3);
    expect(stats.findings).toEqual([]);
    expect(tipPlate(stats).hidden).toBe(true);
  });

  it('shows a TIP plate when a budget is exceeded for two seconds, and hides it after three good ones', () => {
    const { stats, renderer } = setup({ budgets: { calls: 5 } });
    let calls = 50;
    const draw = (): void => {
      renderer.info.render.calls = calls;
      renderer.info.render.triangles = calls * 1000;
    };
    // Checks run on the first frame and then once a second: one failing check is not enough.
    run(stats, 0.5, draw);
    expect(stats.findings).toEqual([]);
    run(stats, 0.6, draw);
    expect(stats.findings.map((finding) => finding.id)).toEqual(['draw-calls']);
    expect(tipPlate(stats).hidden).toBe(false);
    expect(tipPlate(stats).textContent).toBe('TIP 1');
    expect(tipPlate(stats).dataset['tip']).toContain('50 draw calls');

    calls = 1;
    run(stats, 3.3, draw);
    expect(stats.findings).toEqual([]);
    expect(tipPlate(stats).hidden).toBe(true);
  });

  it('turns the draw call counter yellow above the profile budget', () => {
    const { stats, renderer } = setup({ budgets: { calls: 5 }, mode: 'mesh' });
    run(stats, 0.5, () => {
      renderer.info.render.calls = 50;
    });
    const calls = must(stats.element.querySelector<HTMLElement>('[data-tip^="Draw calls"]'));
    expect(calls.querySelector('.tez-alert') ?? (calls.classList.contains('tez-alert') ? calls : null)).not.toBeNull();
  });

  it('hides the TIP plate in Off', () => {
    const { stats, renderer } = setup({ budgets: { calls: 5 } });
    run(stats, 2.5, () => {
      renderer.info.render.calls = 50;
    });
    stats.mode = 'off';
    expect(tipPlate(stats).hidden).toBe(true);
  });

  it('switches single rules off by id, or all of them', () => {
    const exceed = (renderer: FakeRenderer) => (): void => {
      renderer.info.render.calls = 50;
      renderer.info.render.triangles = 50_000;
    };
    const one = setup({ budgets: { calls: 5 }, rules: ['draw-calls'] });
    run(one.stats, 3, exceed(one.renderer));
    expect(one.stats.findings).toEqual([]);

    const all = setup({ budgets: { calls: 5 }, rules: false });
    all.stats.addRule({ id: 'always', title: 'Always', check: () => ({ message: 'x', advice: 'y' }) });
    run(all.stats, 3, exceed(all.renderer));
    expect(all.stats.findings).toEqual([]);
  });

  it('runs rules added with addRule', () => {
    const { stats } = setup();
    let bodies = 900;
    stats.addRule({ id: 'bodies', title: 'Too many bodies', check: () => (bodies > 500 ? { message: `${bodies} bodies.`, advice: 'Sleep bodies at rest.' } : null) });
    run(stats, 2.5);
    expect(stats.findings).toEqual([{ id: 'bodies', title: 'Too many bodies', message: '900 bodies.', advice: 'Sleep bodies at rest.' }]);
    bodies = 950;
    run(stats, 1.1);
    expect(stats.findings[0].message).toBe('950 bodies.');
    expect(tipPlate(stats).dataset['tip']).toContain('950 bodies.');
  });

  it('updates the TIP plate when addRule replaces an active rule', () => {
    const { stats } = setup();
    stats.addRule({ id: 'mine', title: 'Mine', check: () => ({ message: 'x', advice: 'y' }) });
    run(stats, 2.5);
    expect(tipPlate(stats).hidden).toBe(false);
    stats.addRule({ id: 'mine', title: 'Mine', check: () => null });
    expect(stats.findings).toEqual([]);
    expect(tipPlate(stats).hidden).toBe(true);
  });

  it('checks once a second whatever the refresh interval', () => {
    const { stats } = setup({ interval: 2000 });
    const check = vi.fn(() => null);
    stats.addRule({ id: 'count', title: 'Count', check });
    run(stats, 4.05);
    expect(check.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('surveys a slow scene less often, so the overlay is not the hitch it reports', () => {
    let surveys = 0;
    const scene: InfoScene = { traverse: () => {
      surveys++;
      now += 100;
    } };
    const { stats } = setup({ scene });
    run(stats, 20);
    expect(surveys).toBeLessThanOrEqual(2);
  });

  it('never lets a broken scene break the frame', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scene: InfoScene = { traverse: () => {
      throw new Error('scene in the middle of a teardown');
    } };
    const { stats } = setup({ scene, mode: 'info' });
    expect(() => {
      run(stats, 12);
    }).not.toThrow();
    for (let i = 0; i < 5; i++) must(stats.element.querySelector<HTMLButtonElement>('.tez-pager')).click();
  });

  it('runs scene rules on the scene survey and clears them when the scene goes', () => {
    const lights: { type: string; isLight: boolean }[] = [];
    for (let i = 0; i < 12; i++) lights.push({ type: 'PointLight', isLight: true });
    const scene: InfoScene = { traverse: (callback) => {
      for (const light of lights) callback(light);
    } };
    const { stats } = setup({ scene });
    run(stats, 1.1);
    expect(stats.findings.map((finding) => finding.id)).toEqual(['lights']);
    stats.scene = null;
    run(stats, 1.1);
    expect(stats.findings).toEqual([]);
  });

  it('keeps a hidden-tab gap out of the pacing rows', () => {
    const { stats } = setup({ mode: 'performance' });
    run(stats, 1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    now += 900;
    run(stats, 1);
    const peak = must(stats.element.querySelector<HTMLElement>('[data-tip^="Peak frame time"]'));
    expect(peak.textContent).toContain('16.7');
  });
});

describe('Stats custom content', () => {
  it('adds and removes metrics, and warns about invalid ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { stats } = setup();
    stats.addMetric({ id: 'bodies', label: 'Physics bodies', place: 'top', plate: 'BODY', read: () => 12 });
    run(stats, 0.5);
    const row = must(stats.element.querySelector<HTMLElement>('[data-tip="Physics bodies"]'));
    expect(row.textContent).toContain('12');
    stats.removeMetric('bodies');
    expect(stats.element.querySelector('[data-tip="Physics bodies"]')).toBeNull();
    stats.addMetric({ id: '', label: 'x', read: () => 1 });
    expect(warn).toHaveBeenCalled();
  });

  it('skips a metric with an unknown glyph or a malformed custom glyph, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => setup({ metrics: [{ id: 'm', label: 'M', glyph: 'cube' as never, read: () => 1 }] })).not.toThrow();
    expect(() => setup({ metrics: [{ id: 'n', label: 'N', glyph: { category: 'frame' } as never, read: () => 1 }] })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('adds a toggle control that reports its state', () => {
    const { stats } = setup();
    const onChange = vi.fn();
    stats.addControl({ id: 'wire', label: 'WIRE', description: 'Wireframe', onChange });
    const toggle = must(Array.from(stats.element.querySelectorAll('button')).find((button) => button.textContent === 'WIRE'));
    toggle.click();
    expect(onChange).toHaveBeenLastCalledWith(true);
    toggle.click();
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps going when a metric format throws, and falls back to the default format', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { stats } = setup({ metrics: [{ id: 'fmt', label: 'Formatted', place: 'top', plate: 'FMT', read: () => 7, format: () => {
      throw new Error('boom');
    } }] });
    expect(() => {
      run(stats, 1);
    }).not.toThrow();
    expect(must(stats.element.querySelector('[data-tip="Formatted"]')).textContent).toContain('7');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps going when a page metric throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { stats } = setup({ metrics: [{ id: 'bad', label: 'Bad', place: 'top', plate: 'BAD', read: () => {
      throw new Error('boom');
    } }] });
    expect(() => {
      run(stats, 2);
    }).not.toThrow();
  });
});
