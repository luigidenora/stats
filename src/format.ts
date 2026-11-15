/** Compact number: 128, 4.3K, 128K, 1.24M, 12.4M, 128M; small fractions keep two digits (0.4, 12.3); negatives keep their sign. */
export function formatCount(value: number): string {
  if (value < 0) return `-${formatCount(-value)}`;
  const v = value;
  // Bounds sit where rounding would carry into the next magnitude (999.6 is "1.0K", not "1000").
  if (v < 999.5) {
    // Counts are whole; a custom metric or an axis end may not be (0.4, 2.5, 12.3).
    if (Number.isInteger(v) || v >= 99.95) return String(Math.round(v));
    return v >= 10 ? v.toFixed(1) : String(Number(v.toPrecision(2)));
  }

  if (v < 9_950) return `${(v / 1e3).toFixed(1)}K`;
  if (v < 999_500) return `${Math.round(v / 1e3)}K`;
  if (v < 9_995_000) return `${(v / 1e6).toFixed(2)}M`;
  if (v < 99_950_000) return `${(v / 1e6).toFixed(1)}M`;
  return `${Math.round(v / 1e6)}M`;
}

/** Milliseconds with one decimal below 100 ms. */
export function formatMs(value: number): string {
  return value < 99.95 ? value.toFixed(1) : String(Math.round(value));
}

/** Whole number. */
export function formatInt(value: number): string {
  return String(Math.round(value));
}

/** Upper or lower bound that turns a value into an alert. */
export interface Threshold {
  /** Alert when the value is greater than this. */
  above?: number;
  /** Alert when the value is less than this. */
  below?: number;
}

export function isAlert(value: number | null, threshold: Threshold | undefined): boolean {
  if (value === null || threshold === undefined) return false;
  if (threshold.above !== undefined && value > threshold.above) return true;
  return threshold.below !== undefined && value < threshold.below;
}

/** Bytes with a binary prefix: 512 B, 4.0 KB, 128 MB, 1.25 GB. */
export function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, value);
  let unit = 0;
  // 1023.9 KB would print as "1024 KB": step up when the rounded value reaches the next unit.
  while (unit < units.length - 1 && (v >= 1024 || (unit > 0 && Math.round(v) >= 1024) || (unit === 0 && v >= 1023.5))) {
    v /= 1024;
    unit++;
  }

  const digits = unit === 0 || v >= 99.5 ? 0 : v >= 9.995 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[unit]}`;
}

/** Whole percent: 42%. */
export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}
