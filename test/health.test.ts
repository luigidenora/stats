import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthMonitor, Trend } from '../src/health.js';
import { must } from './helpers.js';

let now = 0;

function fakeCanvas(): HTMLCanvasElement & { lose: () => void } {
  const listeners = new Set<() => void>();
  return {
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    lose: () => {
      for (const listener of listeners) listener();
    }
  } as unknown as HTMLCanvasElement & { lose: () => void };
}

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Trend', () => {
  it('needs more samples than the span before it answers', () => {
    const trend = new Trend();
    for (let i = 0; i < 30; i++) trend.push(i);
    expect(trend.steadyGrowth(30)).toBeNull();
    trend.push(30);
    expect(trend.steadyGrowth(30)).toBe(30);
  });

  it('reports no growth when the value ever went down', () => {
    const trend = new Trend();
    for (let i = 0; i < 40; i++) trend.push(i === 35 ? 0 : i);
    expect(trend.steadyGrowth(30)).toBe(0);
  });

  it('keeps one minute of samples', () => {
    const trend = new Trend();
    for (let i = 0; i < 100; i++) trend.push(i);
    expect(trend.steadyGrowth(59)).toBe(59);
    expect(trend.steadyGrowth(60)).toBeNull();
  });

  it('counts drops larger than a share per second', () => {
    const trend = new Trend();
    // A saw tooth: grows, then drops by half every 4 samples.
    for (let i = 0; i < 20; i++) trend.push(i % 4 === 3 ? 50 : 100);
    expect(trend.dropRate(8, 0.1)).toBe(2 / 8);
    expect(trend.dropRate(30, 0.1)).toBeNull();
  });
});

describe('HealthMonitor', () => {
  it('counts context losses and stops listening on dispose', () => {
    const canvas = fakeCanvas();
    const health = new HealthMonitor(canvas);
    canvas.lose();
    canvas.lose();
    expect(health.contextLost).toBe(2);
    health.dispose();
    canvas.lose();
    expect(health.contextLost).toBe(2);
  });

  it('ignores shader compiles during the first 5 s and forgets them after 10 s', () => {
    const health = new HealthMonitor(fakeCanvas());
    now += 4000;
    health.compiled();
    expect(health.recentPrograms).toBe(0);
    now += 2000;
    health.compiled();
    health.compiled();
    expect(health.recentPrograms).toBe(2);
    now += 10_001;
    expect(health.recentPrograms).toBe(0);
  });

  it('reports uptime in seconds', () => {
    const health = new HealthMonitor(fakeCanvas());
    now += 2500;
    expect(health.uptime).toBeCloseTo(2.5);
  });

  it('turns a steady geometry and texture climb into growth over 30 s', () => {
    const health = new HealthMonitor(fakeCanvas());
    for (let i = 0; i <= 30; i++) health.sample(100 + i, 10 + i, null);
    expect(health.geometryGrowth).toBe(30);
    expect(health.textureGrowth).toBe(30);
    expect(health.gcRate).toBeNull();
  });

  it('reads heap saw teeth as garbage collections per second', () => {
    const health = new HealthMonitor(fakeCanvas());
    for (let i = 0; i < 12; i++) health.sample(0, 0, i % 2 === 0 ? 80 : 40);
    expect(health.gcRate).toBe(0.5);
  });

  it('has no blocking value where the browser has no long animation frames', () => {
    const health = new HealthMonitor(fakeCanvas());
    health.sample(0, 0, null);
    expect(health.blocking).toBeNull();
  });

  it('survives a PerformanceObserver without supportedEntryTypes (older Safari)', () => {
    const original = globalThis.PerformanceObserver;
    class Bare {
      public observe(): void {}
      public disconnect(): void {}
    }

    globalThis.PerformanceObserver = Bare as unknown as typeof PerformanceObserver;
    try {
      expect(() => new HealthMonitor(fakeCanvas())).not.toThrow();
    } finally {
      globalThis.PerformanceObserver = original;
    }
  });

  it('sums long animation frame blocking time per second', () => {
    const original = globalThis.PerformanceObserver;
    type Deliver = (list: { getEntries: () => unknown[] }) => void;
    const observers: Deliver[] = [];
    class Loaf {
      public static supportedEntryTypes = ['long-animation-frame'];
      constructor(callback: Deliver) {
        observers.push(callback);
      }

      public observe(): void {}
      public disconnect(): void {}
    }

    globalThis.PerformanceObserver = Loaf as unknown as typeof PerformanceObserver;
    try {
      const health = new HealthMonitor(fakeCanvas());
      expect(health.blocking).toBe(0);
      must(observers[0], 'an observer')({ getEntries: () => [{ blockingDuration: 120 }, { blockingDuration: 80 }, {}] });
      now += 2000;
      health.sample(0, 0, null);
      expect(health.blocking).toBe(100);
      now += 1000;
      health.sample(0, 0, null);
      expect(health.blocking).toBe(0);
    } finally {
      globalThis.PerformanceObserver = original;
    }
  });
});
