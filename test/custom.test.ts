import { describe, expect, it, vi } from 'vitest';
import { checkGraph, checkMetric, finite, safeRead } from '../src/custom.js';
import type { GraphDefinition } from '../src/types.js';

describe('definition checks', () => {
  it('accepts a valid metric and rejects bad ones', () => {
    expect(checkMetric({ id: 'bodies', label: 'Bodies', read: () => 1 })).toBeNull();
    expect(checkMetric({ id: '', label: 'x', read: () => 1 })).not.toBeNull();
    expect(checkMetric({ id: 'x', label: 'x', read: () => 1, plate: 'TOOLONG' })).not.toBeNull();
  });

  it('rejects graphs with a bad scale or label', () => {
    const graph: GraphDefinition = { id: 'g', label: ['A', 'B'], scale: 'auto', unit: 'u', read: () => 1 };
    expect(checkGraph(graph)).toBeNull();
    expect(checkGraph({ ...graph, scale: 'huge' as GraphDefinition['scale'] })).not.toBeNull();
    expect(checkGraph({ ...graph, label: ['A'] as unknown as GraphDefinition['label'] })).not.toBeNull();
  });
});

describe('safeRead', () => {
  it('turns non-finite values into null', () => {
    expect(safeRead('a', () => Number.NaN, finite)()).toBeNull();
    expect(safeRead('a', () => 3, finite)()).toBe(3);
  });

  it('switches a throwing read off after repeated failures, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let calls = 0;
    const read = safeRead('broken', () => {
      calls++;
      throw new Error('boom');
    }, finite);
    for (let i = 0; i < 10; i++) expect(read()).toBeNull();
    expect(calls).toBe(5);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
