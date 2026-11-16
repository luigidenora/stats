import { describe, expect, it } from 'vitest';
import { MAX_RECORDED_FRAMES, Recorder, type MemoryCounters } from '../src/recorder.js';
import { BUDGET } from './helpers.js';

const MEMORY: MemoryCounters = { geometries: 10, textures: 4, programs: 3, heap: 40 };
const CONTEXT = { budget: BUDGET, profile: 'desktop', backend: 'webgl' } as const;

describe('Recorder', () => {
  it('has no report without frames', () => {
    expect(new Recorder(MEMORY).finish(MEMORY, CONTEXT)).toBeNull();
  });

  it('summarises a steady run', () => {
    const recorder = new Recorder(MEMORY);
    for (let i = 0; i < 600; i++) recorder.frame(1000 / 60, 4, 100, 50_000);
    const report = recorder.finish({ ...MEMORY, geometries: 12 }, CONTEXT);
    expect(report?.frames).toBe(600);
    expect(report?.duration).toBeCloseTo(10);
    expect(report?.fps.average).toBeCloseTo(60);
    expect(report?.fps.low1).toBeCloseTo(60);
    expect(report?.dropped).toBe(0);
    expect(report?.cpu.average).toBeCloseTo(4);
    expect(report?.calls).toEqual({ average: 100, max: 100 });
    expect(report?.memory.start.geometries).toBe(10);
    expect(report?.memory.end.geometries).toBe(12);
    expect(report?.gpu).toBeNull();
    expect(report).toMatchObject(CONTEXT);
  });

  it('shows stutter in the 1% low, the percentiles and the drops, not in the average', () => {
    const recorder = new Recorder(MEMORY);
    // One 100 ms hitch every 50 frames: 2% of the frames.
    for (let i = 0; i < 1000; i++) recorder.frame(i % 50 === 49 ? 100 : 16, i % 50 === 49 ? 90 : 3, 100, 1000);
    const report = recorder.finish(MEMORY, CONTEXT);
    expect(report?.fps.average).toBeGreaterThan(55);
    expect(report?.fps.low1).toBeCloseTo(10);
    expect(report?.frame.p50).toBe(16);
    expect(report?.frame.p95).toBe(16);
    expect(report?.frame.p99).toBe(100);
    expect(report?.frame.worst).toBe(100);
    expect(report?.cpu.worst).toBe(90);
    // A 100 ms frame on a 16.7 ms budget misses 5 refreshes.
    expect(report?.dropped).toBe(20 * 5);
  });

  it('skips gaps and invalid intervals', () => {
    const recorder = new Recorder(MEMORY);
    recorder.frame(0, 1, 1, 1);
    recorder.frame(Number.NaN, 1, 1, 1);
    recorder.frame(5000, 1, 1, 1);
    recorder.frame(16, 1, 1, 1);
    expect(recorder.finish(MEMORY, CONTEXT)?.frames).toBe(1);
  });

  it('averages GPU samples and keeps the worst', () => {
    const recorder = new Recorder(MEMORY);
    recorder.frame(16, 1, 1, 1);
    recorder.gpu(4);
    recorder.gpu(8);
    recorder.gpu(Number.NaN);
    expect(recorder.finish(MEMORY, CONTEXT)?.gpu).toEqual({ average: 6, worst: 8 });
  });

  it('timestamps events in recorded seconds', () => {
    const recorder = new Recorder(MEMORY);
    recorder.event('start');
    for (let i = 0; i < 100; i++) recorder.frame(10, 1, 1, 1);
    recorder.event('boss');
    const report = recorder.finish(MEMORY, CONTEXT);
    expect(report?.events).toEqual([{ name: 'start', at: 0 }, { name: 'boss', at: 1 }]);
  });

  it('grows past its first buffer and reports full at the cap', () => {
    const recorder = new Recorder(MEMORY);
    for (let i = 0; i < MAX_RECORDED_FRAMES + 10; i++) recorder.frame(4, 1, 1, 1);
    expect(recorder.full).toBe(true);
    expect(recorder.finish(MEMORY, CONTEXT)?.frames).toBe(MAX_RECORDED_FRAMES);
  });
});
