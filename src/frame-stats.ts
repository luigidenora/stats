/**
 * Frame pacing over a rolling window of raw frame intervals: the 95th percentile, the worst frame
 * and the refreshes missed. Averages hide stutter; these three show it.
 *
 * Missed refreshes use the frame graph's rule, so DROP agrees with its yellow and red columns:
 * an interval past 1.25× the budget missed one refresh (yellow), past 2.25× two (red), and every
 * further whole budget is one more. Intervals of a second or longer are gaps (a hidden tab, a breakpoint), not frames,
 * and are ignored.
 */

/** Frames kept: about four seconds at 60 Hz, enough for a stable 95th percentile. */
export const FRAME_WINDOW = 240;
/** Longer intervals are pauses, not frames. */
const GAP_MS = 1000;

export interface FramePacing {
  /** 95th percentile frame interval, in ms. */
  p95: number;
  /** Longest frame interval in the window, in ms. */
  worst: number;
  /** Refreshes missed in the window. */
  dropped: number;
  /** Standard deviation of the intervals, in ms: how uneven the frames are. */
  jitter: number;
}

/** Refreshes one interval missed: 0 up to 1.25× the budget, then one more at each further whole budget (2.25×, 3.25×…). */
export function missedRefreshes(interval: number, budget: number): number {
  if (interval <= budget * 1.25) return 0;
  return Math.max(1, Math.floor(interval / budget - 0.25));
}

export class FrameStats {
  private readonly _values: Float32Array;
  private readonly _sorted: Float32Array;
  private _head = 0;
  private _count = 0;

  constructor(size = FRAME_WINDOW) {
    this._values = new Float32Array(size);
    this._sorted = new Float32Array(size);
  }

  /** Adds one frame interval; zero, negative and gap intervals are ignored. */
  public push(interval: number): void {
    if (!(interval > 0) || interval >= GAP_MS) return;
    this._values[this._head] = interval;
    this._head = (this._head + 1) % this._values.length;
    this._count = Math.min(this._values.length, this._count + 1);
  }

  /** Forgets every frame, e.g. when the page comes back from a hidden tab. */
  public reset(): void {
    this._head = 0;
    this._count = 0;
  }

  /** Pacing of the frames in the window, or null before the first frame. Sorts a copy: call at refresh rate, not per frame. */
  public summary(budget: number): FramePacing | null {
    const count = this._count;
    if (count === 0) return null;
    const sorted = this._sorted.subarray(0, count);
    sorted.set(this._values.subarray(0, count));
    sorted.sort();
    let dropped = 0;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      dropped += missedRefreshes(sorted[i], budget);
      sum += sorted[i];
    }

    const mean = sum / count;
    let variance = 0;
    for (let i = 0; i < count; i++) variance += (sorted[i] - mean) ** 2;
    // Nearest-rank percentile.
    const rank = Math.max(0, Math.ceil(count * 0.95) - 1);
    return { p95: sorted[rank], worst: sorted[count - 1], dropped, jitter: Math.sqrt(variance / count) };
  }
}
