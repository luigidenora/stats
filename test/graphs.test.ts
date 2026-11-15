// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Samples, TimeGraph } from '../src/graphs.js';
import { stubCanvas2d } from './helpers.js';

describe('Samples', () => {
  it('reads newest first', () => {
    const samples = new Samples();
    samples.push(1);
    samples.push(2);
    samples.push(3);
    expect(samples.count).toBe(3);
    expect(samples.recent(0)).toBe(3);
    expect(samples.recent(2)).toBe(1);
  });

  it('finds min and max over the latest n samples', () => {
    const samples = new Samples();
    const values = [5, 1, 9, 4];
    for (let i = 0; i < values.length; i++) samples.push(values[i]);
    expect(samples.max()).toBe(9);
    expect(samples.min()).toBe(1);
    expect(samples.max(1)).toBe(4);
    expect(samples.min(2)).toBe(4);
  });

  it('returns null when empty', () => {
    expect(new Samples().min()).toBeNull();
    expect(new Samples().max()).toBeNull();
  });

  it('wraps around its capacity', () => {
    const samples = new Samples();
    for (let i = 0; i < 600; i++) samples.push(i);
    expect(samples.count).toBe(512);
    expect(samples.recent(0)).toBe(599);
    expect(samples.min()).toBe(88);
  });
});

describe('TimeGraph scale', () => {
  it('stays finite for an auto-scaled counter graph with no positive samples (no budget)', () => {
    const restore = stubCanvas2d();
    try {
      const samples = new Samples();
      samples.push(0);
      const graph = new TimeGraph(Infinity, [{ samples, color: 'ink' }], { width: 132, height: 32, label: 'Draw calls', vertical: false, autoScale: true });
      graph.draw({ ink: '#fff', clip: '#f00', alert: '#ff0', series: { frame: '#00f', gpu: '#0f0', cpu: '#f00', ink: '#fff', r: '#f00', g: '#0f0', b: '#00f' } });
      expect(Number.isFinite(graph.scale)).toBe(true);
    } finally {
      restore();
    }
  });
});
