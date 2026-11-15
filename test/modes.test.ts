// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODES } from '../src/modes.js';
import { Stats, type StatsOptions } from '../src/stats.js';
import { fakeRenderer, must, stubCanvas2d } from './helpers.js';

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

function setup(options: StatsOptions = {}): Stats {
  const renderer = fakeRenderer({ canvas: document.createElement('canvas') });
  document.body.append(renderer.domElement);
  const stats = new Stats(renderer, { profile: 'desktop', remember: false, ...options });
  open.push(stats);
  return stats;
}

function run(stats: Stats, seconds: number): void {
  for (let i = 0, l = Math.round(seconds * 60); i < l; i++) {
    stats.begin();
    now += 2;
    stats.end();
    now += 1000 / 60 - 2;
  }
}

function q(stats: Stats, selector: string): HTMLElement {
  return must(stats.element.querySelector<HTMLElement>(selector), selector);
}

describe('mode plate', () => {
  it('cycles through every built-in mode in order, back to the first', () => {
    const stats = setup();
    const seen = [stats.mode];
    for (let i = 0; i < MODES.length; i++) {
      q(stats, '.tez-disp-button').click();
      seen.push(stats.mode);
    }

    expect(seen).toEqual([...MODES.map((mode) => mode.id), 'simple']);
  });

  it('shows the mode code and describes the mode in its tooltip', () => {
    const stats = setup({ mode: 'performance' });
    expect(q(stats, '.tez-disp-code').textContent).toBe('PERF');
    expect(q(stats, '.tez-disp-button').dataset['tip']).toContain('Display mode: Performance');
  });

  it('opens the menu from the caret, picks a mode, and closes on Escape or a press outside', () => {
    const stats = setup();
    const caret = q(stats, '.tez-disp-more');
    const menu = q(stats, '.tez-menu');
    caret.click();
    expect(menu.hidden).toBe(false);
    expect(caret.getAttribute('aria-expanded')).toBe('true');
    const items = menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    expect(items).toHaveLength(MODES.length);
    expect(menu.querySelector('[aria-checked="true"]')?.getAttribute('data-mode')).toBe('simple');
    must(menu.querySelector<HTMLButtonElement>('[data-mode="memory"]')).click();
    expect(stats.mode).toBe('memory');
    expect(menu.hidden).toBe(true);

    caret.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(menu.hidden).toBe(true);
    caret.click();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(menu.hidden).toBe(true);
  });

  it('opens the menu on a right click, and a click on the plate then only closes it', () => {
    const stats = setup();
    const plate = q(stats, '.tez-disp-button');
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    plate.dispatchEvent(menuEvent);
    expect(menuEvent.defaultPrevented).toBe(true);
    expect(q(stats, '.tez-menu').hidden).toBe(false);
    plate.click();
    expect(q(stats, '.tez-menu').hidden).toBe(true);
    expect(stats.mode).toBe('simple');
  });
});

describe('modes', () => {
  it('marks Off and Info on the root', () => {
    const stats = setup();
    stats.mode = 'off';
    expect(stats.element.classList.contains('tez-off')).toBe(true);
    expect(stats.element.dataset['mode']).toBe('off');
    stats.mode = 'info';
    expect(stats.element.classList.contains('tez-info')).toBe(true);
  });

  it('turns INFO pages with the PAGE plate', () => {
    const stats = setup({ mode: 'info' });
    run(stats, 0.5);
    const title = q(stats, '.tez-info-title');
    expect(title.textContent).toBe('RENDERER');
    expect(q(stats, '.tez-info-count').textContent).toBe('1/6');
    q(stats, '.tez-pager').click();
    expect(title.textContent).toBe('LIMITS');
    expect(q(stats, '.tez-info-count').textContent).toBe('2/6');
  });

  it('adds a custom mode to the cycle before Off, with its graphs, metrics, distribution and controls', () => {
    const stats = setup();
    const onChange = vi.fn();
    stats.defineMode({
      id: 'lod', name: 'Level of detail', code: 'LOD', description: 'Objects per LOD level.',
      graphs: [{ id: 'lod.switches', label: ['LOD', 'SW/S'], scale: 'auto', unit: 'sw/s', read: () => 3 }],
      metrics: [{ id: 'lod.saved', label: 'Triangles saved', place: 'top', plate: 'SAVE', unit: '%', read: () => 42 }],
      distribution: { id: 'lod.levels', label: ['LOD', 'LVL'], read: () => [5, 3, 1], names: ['L0', 'L1', 'L2'] },
      controls: [{ id: 'lod.color', label: 'COLOR', description: 'Colour by level', onChange }]
    });
    expect(stats.modes.map((mode) => mode.id).slice(-2)).toEqual(['lod', 'off']);
    stats.mode = 'lod';
    run(stats, 0.5);
    expect(stats.element.querySelector('[data-tip="Triangles saved"]')?.textContent).toContain('42');
    const color = must(Array.from(stats.element.querySelectorAll('button')).find((button) => button.textContent === 'COLOR'));
    expect(color.hidden).toBe(false);
    stats.mode = 'simple';
    expect(color.hidden).toBe(true);
  });

  it('skips invalid custom modes with a warning, and duplicate ids', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stats = setup();
    const count = stats.modes.length;
    stats.defineMode({ id: 'x', name: 'X', code: 'TOOLONG', description: 'x' });
    stats.defineMode({ id: 'simple', name: 'Again', code: 'STD', description: 'x' });
    expect(stats.modes).toHaveLength(count);
    expect(warn).toHaveBeenCalled();
  });

  it('skips a mode whose histogram is malformed instead of throwing half-way', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stats = setup();
    const count = stats.modes.length;
    expect(() => stats.defineMode({
      id: 'bad', name: 'Bad', code: 'BAD', description: 'x',
      histogram: { id: 'h', label: ['A', 'B'], unit: 'u', domain: undefined as never, channels: [] }
    })).not.toThrow();
    expect(stats.modes).toHaveLength(count);
    expect(warn).toHaveBeenCalled();
  });

  it('keeps a histogram channel that returns undefined until its data loads', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stats = setup();
    let ready = false;
    stats.defineMode({
      id: 'px', name: 'Screen size', code: 'PX', description: 'x',
      histogram: { id: 'px', label: ['OBJ', 'PX'], unit: 'px', domain: { min: 0, max: 10 }, channels: [{ name: 'L0', read: () => (ready ? [1, 2] : undefined as never) }] }
    });
    stats.mode = 'px';
    run(stats, 3);
    ready = true;
    run(stats, 0.5);
    expect(warn.mock.calls.some((call) => String(call[0]).includes('threw'))).toBe(false);
  });

  it('warns about a duplicate graph id instead of adding the panel twice', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stats = setup();
    const graph = { id: 'lod.switches', label: ['LOD', 'SW/S'] as const, scale: 'auto' as const, unit: 'sw/s', read: () => 1 };
    stats.extendMode('mesh', { graphs: [graph] });
    stats.extendMode('mesh', { graphs: [graph] });
    expect(warn.mock.calls.some((call) => String(call[0]).includes('lod.switches'))).toBe(true);
  });

  it('skips a histogram with a null domain, and survives ticks that throw', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stats = setup();
    const histogram = { id: 'h', label: ['A', 'B'] as const, unit: 'u', channels: [{ name: 'L0', read: () => [1, 2] }] };
    expect(() => stats.defineMode({ id: 'nul', name: 'Null', code: 'NUL', description: 'x', histogram: { ...histogram, domain: null as never } })).not.toThrow();
    expect(stats.modes.some((mode) => mode.id === 'nul')).toBe(false);
    stats.defineMode({ id: 'tick', name: 'Ticks', code: 'TICK', description: 'x', histogram: { ...histogram, id: 'h2', domain: { min: 0, max: 10 }, ticks: () => {
      throw new Error('boom');
    } } });
    stats.mode = 'tick';
    expect(() => {
      run(stats, 1);
    }).not.toThrow();
  });

  it('extends a built-in mode', () => {
    const stats = setup({ mode: 'performance' });
    stats.extendMode('performance', { metrics: [{ id: 'bodies', label: 'Bodies', place: 'top', plate: 'BODY', read: () => 7 }] });
    run(stats, 0.5);
    expect(stats.element.querySelector('[data-tip="Bodies"]')?.textContent).toContain('7');
  });

  it('shows a page histogram in its mode', () => {
    const stats = setup();
    const values = new Float32Array([1, 2, 2, 3, 9]);
    stats.defineMode({
      id: 'px', name: 'Screen size', code: 'PX', description: 'Pixels per object.',
      histogram: { id: 'px', label: ['OBJ', 'PX'], unit: 'px', domain: { min: 0, max: 10 }, bins: 10, channels: [{ name: 'L0', read: () => values }] }
    });
    stats.mode = 'px';
    expect(() => {
      run(stats, 0.5);
    }).not.toThrow();
  });
});

describe('layout smoke test', () => {
  // happy-dom has no layout: give every element a box so arrange() runs its real branches.
  let width = 1440;
  const restore: (() => void)[] = [];
  beforeEach(() => {
    for (const [key, read] of [['clientWidth', () => width], ['clientHeight', () => 800], ['offsetWidth', () => 40], ['offsetHeight', () => 20]] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key) ?? Object.getOwnPropertyDescriptor(Element.prototype, key);
      Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: read });
      restore.push(() => {
        if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, key);
        else Object.defineProperty(HTMLElement.prototype, key, descriptor);
      });
    }
  });

  afterEach(() => {
    while (restore.length > 0) must(restore.pop())();
  });

  it.each([1440, 420, 375])('lays out every mode at %ipx without throwing', (size) => {
    width = size;
    const stats = setup();
    stats.defineMode({
      id: 'px', name: 'Screen size', code: 'PX', description: 'Pixels per object.',
      graphs: [{ id: 'g', label: ['G', 'X'], scale: 'auto', unit: 'u', read: () => 1 }],
      distribution: { id: 'd', label: ['D', 'X'], read: () => [1, 2] },
      histogram: { id: 'px', label: ['OBJ', 'PX'], unit: 'px', domain: { min: 0, max: 10 }, channels: [{ name: 'L0', read: () => [1, 2, 3] }] }
    });
    for (const mode of stats.modes) {
      stats.mode = mode.id;
      window.dispatchEvent(new Event('resize'));
      expect(() => {
        run(stats, 0.3);
      }, mode.id).not.toThrow();
      expect(stats.element.dataset['mode']).toBe(mode.id);
    }

    stats.mode = 'px';
    expect(stats.element.querySelector('.tez-c-hist canvas')).not.toBeNull();
  });
});
