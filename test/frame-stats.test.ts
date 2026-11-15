import { describe, expect, it } from 'vitest';
import { FrameStats, missedRefreshes } from '../src/frame-stats.js';

const BUDGET = 1000 / 60;

describe('missedRefreshes', () => {
  it('counts nothing for frames on time or with jitter', () => {
    expect(missedRefreshes(BUDGET, BUDGET)).toBe(0);
    expect(missedRefreshes(BUDGET * 1.2, BUDGET)).toBe(0);
  });

  it('uses the frame graph rule: one past 1.25×, one more per whole budget', () => {
    expect(missedRefreshes(BUDGET * 1.3, BUDGET)).toBe(1);
    expect(missedRefreshes(BUDGET * 2, BUDGET)).toBe(1);
    expect(missedRefreshes(BUDGET * 3, BUDGET)).toBe(2);
    expect(missedRefreshes(BUDGET * 5, BUDGET)).toBe(4);
  });

  it('agrees with the red column threshold: past 2.25× is two or more', () => {
    expect(missedRefreshes(BUDGET * 2.2, BUDGET)).toBe(1);
    expect(missedRefreshes(BUDGET * 2.34, BUDGET)).toBe(2);
    expect(missedRefreshes(BUDGET * 3.3, BUDGET)).toBe(3);
  });
});

describe('FrameStats', () => {
  it('returns null before any frame', () => {
    expect(new FrameStats().summary(BUDGET)).toBeNull();
  });

  it('computes p95, worst and dropped over the window', () => {
    const stats = new FrameStats(100);
    for (let i = 0; i < 94; i++) stats.push(16);
    for (let i = 0; i < 5; i++) stats.push(33);
    stats.push(50);
    const pacing = stats.summary(BUDGET);
    expect(pacing?.p95).toBeCloseTo(33);
    expect(pacing?.worst).toBe(50);
    expect(pacing?.dropped).toBe(5 + 2);
  });

  it('keeps only the latest frames', () => {
    const stats = new FrameStats(4);
    stats.push(100);
    for (let i = 0; i < 4; i++) stats.push(16);
    expect(stats.summary(BUDGET)?.worst).toBe(16);
  });

  it('ignores pauses and invalid intervals', () => {
    const stats = new FrameStats();
    stats.push(0);
    stats.push(-5);
    stats.push(Number.NaN);
    stats.push(4000);
    expect(stats.summary(BUDGET)).toBeNull();
    stats.push(16);
    expect(stats.summary(BUDGET)?.worst).toBe(16);
  });

  it('forgets everything on reset', () => {
    const stats = new FrameStats();
    stats.push(16);
    stats.reset();
    expect(stats.summary(BUDGET)).toBeNull();
  });

  it('measures jitter as the standard deviation of the intervals', () => {
    const steady = new FrameStats();
    for (let i = 0; i < 60; i++) steady.push(16);
    expect(steady.summary(BUDGET)?.jitter).toBe(0);
    const uneven = new FrameStats();
    for (let i = 0; i < 60; i++) uneven.push(i % 2 === 0 ? 12 : 20);
    expect(uneven.summary(BUDGET)?.jitter).toBeCloseTo(4);
  });

  it('does not reorder the stored window when it summarises', () => {
    const stats = new FrameStats(3);
    stats.push(30);
    stats.push(10);
    stats.push(20);
    stats.summary(BUDGET);
    // The oldest (30) must be the one replaced, not the largest after a sort.
    stats.push(15);
    expect(stats.summary(BUDGET)?.worst).toBe(20);
  });
});
