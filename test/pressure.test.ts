import { describe, expect, it } from 'vitest';
import { PressureMonitor } from '../src/pressure.js';
import { BUDGET } from './helpers.js';

function feed(monitor: PressureMonitor, seconds: number, cpu: number | null, gpu: number | null, fps: number | null): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < seconds; i++) out.push(monitor.update(cpu, gpu, fps, BUDGET));
  return out;
}

describe('PressureMonitor', () => {
  it('stays quiet while the frame has room', () => {
    const monitor = new PressureMonitor();
    expect(feed(monitor, 10, 8, 11, 60)).toEqual(Array(10).fill(null));
    expect(monitor.level).toBe('ok');
  });

  it('signals high after two seconds over, then repeats every two seconds', () => {
    const monitor = new PressureMonitor();
    expect(feed(monitor, 7, 4, 17, 55)).toEqual([null, 'high', null, 'high', null, 'high', null]);
  });

  it('reads a low frame rate as high even without a GPU timer', () => {
    const monitor = new PressureMonitor();
    expect(feed(monitor, 2, 3, null, 40)).toEqual([null, 'high']);
  });

  it('signals low after four calm seconds, and never while frames are late', () => {
    const monitor = new PressureMonitor();
    expect(feed(monitor, 6, 3, 5, 60)).toEqual([null, null, null, 'low', null, 'low']);
    expect(feed(new PressureMonitor(), 6, 3, 5, 50)).toEqual([null, 'high', null, 'high', null, 'high']);
  });

  it('goes back to ok at once, and does not flap on one noisy second', () => {
    const monitor = new PressureMonitor();
    feed(monitor, 2, 4, 17, 55);
    expect(monitor.update(4, 10, 60, BUDGET)).toBe('ok');
    expect(feed(monitor, 1, 4, 17, 55)).toEqual([null]);
    expect(monitor.update(4, 10, 60, BUDGET)).toBeNull();
    expect(monitor.level).toBe('ok');
  });

  it('says nothing without measurements, and forgets on reset', () => {
    const monitor = new PressureMonitor();
    expect(feed(monitor, 6, null, null, null)).toEqual(Array(6).fill(null));
    feed(monitor, 2, 4, 17, 55);
    monitor.reset();
    expect(monitor.level).toBe('ok');
    expect(monitor.update(4, 17, 55, BUDGET)).toBeNull();
  });
});
