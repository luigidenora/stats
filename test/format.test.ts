import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount, formatMs, formatPercent, isAlert } from '../src/format.js';

describe('formatters', () => {
  it('formats counts compactly', () => {
    expect(formatCount(128)).toBe('128');
    expect(formatCount(4321)).toBe('4.3K');
    expect(formatCount(128_400)).toBe('128K');
    expect(formatCount(1_240_000)).toBe('1.24M');
    expect(formatCount(-3)).toBe('0');
  });

  it('formats milliseconds and percentages', () => {
    expect(formatMs(16.666)).toBe('16.7');
    expect(formatMs(123.4)).toBe('123');
    expect(formatPercent(41.6)).toBe('42%');
  });

  it('formats bytes with binary prefixes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4096)).toBe('4.00 KB');
    expect(formatBytes(128 * 1048576)).toBe('128 MB');
  });

  it('checks thresholds', () => {
    expect(isAlert(null, { above: 1 })).toBe(false);
    expect(isAlert(2, undefined)).toBe(false);
    expect(isAlert(2, { above: 1 })).toBe(true);
    expect(isAlert(0.5, { below: 1 })).toBe(true);
    expect(isAlert(1, { above: 1, below: 1 })).toBe(false);
  });
});

describe('formatters at unit boundaries', () => {
  it('never rounds up into a longer string of the same unit', () => {
    expect(formatCount(999.6)).toBe('1.0K');
    expect(formatCount(9_960)).toBe('10K');
    expect(formatCount(999_999)).toBe('1.00M');
    expect(formatCount(9_999_999)).toBe('10.0M');
    expect(formatCount(99_960_000)).toBe('100M');
    expect(formatMs(99.97)).toBe('100');
    expect(formatBytes(1023.9 * 1024)).toBe('1.00 MB');
  });
});
