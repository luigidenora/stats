import { describe, expect, it } from 'vitest';
import { binValues, columnHeights, position } from '../src/histogram.js';

describe('binValues', () => {
  it('bins on a linear domain and clamps outliers to the edge bins', () => {
    const out = new Float32Array(4);
    binValues([0, 0.3, 0.6, 0.99, -5, 7, Number.NaN], { min: 0, max: 1, log: false }, out);
    expect(Array.from(out)).toEqual([2, 1, 1, 2]);
  });

  it('bins on a log domain', () => {
    const out = new Float32Array(3);
    binValues([1, 10, 100, 999], { min: 1, max: 1000, log: true }, out);
    expect(Array.from(out)).toEqual([1, 1, 2]);
  });

  it('clears the output first', () => {
    const out = new Float32Array([9, 9]);
    binValues([], { min: 0, max: 1, log: false }, out);
    expect(Array.from(out)).toEqual([0, 0]);
  });
});

describe('position', () => {
  it('maps linear and log scales to 0..1', () => {
    expect(position(5, { min: 0, max: 10, log: false })).toBe(0.5);
    expect(position(10, { min: 1, max: 100, log: true })).toBeCloseTo(0.5);
  });
});

describe('columnHeights', () => {
  it('gives each bin one column when the widths match', () => {
    expect(Array.from(columnHeights([1, 5, 2, 0], new Uint16Array(4)))).toEqual([1, 5, 2, 0]);
  });

  it('keeps the tallest bin when narrower, so no peak is lost', () => {
    expect(Array.from(columnHeights([1, 9, 2, 3, 0, 4], new Uint16Array(3)))).toEqual([9, 3, 4]);
  });

  it('repeats bins when wider', () => {
    expect(Array.from(columnHeights([2, 7], new Uint16Array(4)))).toEqual([2, 2, 7, 7]);
  });
});
