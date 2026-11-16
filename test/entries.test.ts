// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Stats as NoopStats } from '../src/noop.js';
import { Stats } from '../src/stats.js';
import { fakeRenderer, must, stubCanvas2d } from './helpers.js';

let restoreCanvas: () => void;
const open: Stats[] = [];

beforeEach(() => {
  restoreCanvas = stubCanvas2d();
  localStorage.clear();
});

afterEach(() => {
  while (open.length > 0) must(open.pop()).dispose();
  restoreCanvas();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('production no-op', () => {
  it('answers every public member of the real class and touches nothing', () => {
    const renderer = fakeRenderer({ canvas: document.createElement('canvas') });
    const stats = new NoopStats(renderer);
    for (const name of Object.getOwnPropertyNames(Stats.prototype)) {
      const descriptor = must(Object.getOwnPropertyDescriptor(Stats.prototype, name));
      // Private methods compile to plain ones: the public ones are checked by the type in noop.ts.
      if (typeof descriptor.value !== 'function' || name === 'constructor') continue;
      if (['syncRect', 'moved', 'showObjects', 'objectCount'].includes(name)) continue;
      expect(typeof (stats as unknown as Record<string, unknown>)[name], name).toBe('function');
    }

    stats.begin();
    stats.event().addMetric({ id: 'a', label: 'A', read: () => 1 }).defineMode({ id: 'm', name: 'M', code: 'M', description: '' });
    stats.end();
    expect(stats.element.isConnected).toBe(false);
    expect(document.querySelector('.tez-stats')).toBeNull();
    expect(renderer.info.autoReset).toBe(true);
    stats.dispose();
  });
});

describe('production no-op budgets', () => {
  it('match the desktop profile of the real overlay', async () => {
    const { PROFILE_BUDGETS } = await import('../src/budgets.js');
    expect(new NoopStats(fakeRenderer({ canvas: document.createElement('canvas') })).budgets).toEqual(PROFILE_BUDGETS.desktop);
  });
});
