// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Stats, type InfoScene, type StatsOptions } from '../src/stats.js';
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

describe('Stats lifecycle', () => {
  it('mounts one overlay over the canvas, leaves the renderer as it is, and leaves no trace on dispose', () => {
    const { stats, renderer } = setup();
    run(stats, 1);
    expect(document.querySelectorAll('.tez-stats')).toHaveLength(1);
    expect(document.getElementById('tez-stats-style')).not.toBeNull();
    expect(renderer.info.autoReset).toBe(true);
    expect(renderer.info.resets).toBe(0);
    must(open.pop()).dispose();
    expect(document.querySelectorAll('.tez-stats')).toHaveLength(0);
    expect(document.getElementById('tez-stats-style')).toBeNull();
    expect(renderer.info.autoReset).toBe(true);
    expect(stats.element.isConnected).toBe(false);
  });

  it('keeps the stylesheet while another overlay lives', () => {
    const first = setup().stats;
    setup();
    must(open.splice(open.indexOf(first), 1)[0]).dispose();
    expect(document.getElementById('tez-stats-style')).not.toBeNull();
  });

  it('starts in the requested mode, and in simple for an unknown one', () => {
    expect(setup({ mode: 'performance' }).stats.mode).toBe('performance');
    expect(setup({ mode: 'nope' as never }).stats.mode).toBe('simple');
  });

  it('remembers a mode picked with the plate, not one set from code', () => {
    const { stats } = setup();
    stats.mode = 'graph';
    expect(localStorage.getItem('tez-stats-mode')).toBeNull();
    const plate = must(stats.element.querySelector<HTMLButtonElement>('.tez-disp-button'));
    plate.click();
    const picked = stats.mode;
    expect(picked).not.toBe('graph');
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
    localStorage.setItem('tez-stats-mode', 'graph');
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
    const fps = must(stats.element.querySelector<HTMLElement>('[data-tip^="FPS"]'));
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
    const fps = must(stats.element.querySelector<HTMLElement>('[data-tip^="FPS"]'));
    expect(fps.textContent).toContain('60');
  });

  it('leaves out excluded built-in metrics', () => {
    const { stats } = setup({ exclude: ['calls', 'p95'] });
    expect(stats.element.querySelector('[data-tip^="Draw calls"]')).toBeNull();
    expect(stats.element.querySelector('[data-tip^="P95"]')).toBeNull();
    expect(stats.element.querySelector('[data-tip^="Triangles"]')).not.toBeNull();
  });
});

describe('Stats budgets and the scene', () => {
  it('resolves the profile and the overrides', () => {
    const { stats } = setup({ profile: 'mobile', budgets: { calls: 100 } });
    expect(stats.profile).toBe('mobile');
    expect(stats.budgets.calls).toBe(100);
    expect(stats.budgets.triangles).toBe(750_000);
  });

  it('turns the draw call counter yellow above the profile budget', () => {
    const { stats, renderer } = setup({ budgets: { calls: 5 }, mode: 'performance' });
    run(stats, 0.5, () => {
      renderer.info.render.calls = 50;
    });
    const calls = must(stats.element.querySelector<HTMLElement>('[data-tip^="Draw calls"]'));
    expect(calls.querySelector('.tez-alert') ?? (calls.classList.contains('tez-alert') ? calls : null)).not.toBeNull();
  });

  it('counts the scene objects bottom-left, only with a scene, at most once a second', () => {
    let walks = 0;
    let size = 25;
    const scene: InfoScene = { traverse: (callback) => {
      walks++;
      for (let i = 0; i < size; i++) callback({ type: 'Object3D' });
    } };
    expect(setup({ mode: 'performance' }).stats.element.querySelector('[data-tip^="Objects in the scene"]')).toBeNull();
    const { stats } = setup({ scene, mode: 'performance' });
    run(stats, 1);
    const counter = must(stats.element.querySelector<HTMLElement>('.tez-c-counters [data-tip^="Objects in the scene"]'));
    expect(counter.textContent).toContain('25');
    expect(walks).toBeLessThanOrEqual(2);
    size = 40;
    run(stats, 1.1);
    expect(counter.textContent).toContain('40');
    stats.scene = null;
    expect(stats.element.querySelector('[data-tip^="Objects in the scene"]')).toBeNull();
    stats.scene = scene;
    run(stats, 0.5);
    expect(must(stats.element.querySelector('[data-tip^="Objects in the scene"]')).textContent).toContain('40');
    expect(setup({ scene, exclude: ['objects'] }).stats.element.querySelector('[data-tip^="Objects in the scene"]')).toBeNull();
  });

  it('never lets a broken scene break the frame', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scene: InfoScene = { traverse: () => {
      throw new Error('scene in the middle of a teardown');
    } };
    const { stats } = setup({ scene, mode: 'performance' });
    expect(() => {
      run(stats, 3);
    }).not.toThrow();
    expect(must(stats.element.querySelector('[data-tip^="Objects in the scene"]')).textContent).toContain('—');
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
