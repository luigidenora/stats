/**
 * Pressure signal for adaptive quality: tells the app when the frame has no room left ('high') or
 * plenty of it ('low'), so it can lower or raise resolution, shadows or detail. The overlay only
 * signals; what to change is the app's decision.
 *
 * Sampled once a second. 'high' needs two seconds in a row and 'low' four, so one noisy second
 * never moves the quality. While the level stays high or low the signal repeats every two
 * seconds, so a controller can keep stepping.
 *
 * Without a GPU timer the load is CPU time only: 'low' is then a guess from CPU time and frame
 * rate, and an app raising quality on it should expect a 'high' to follow when the GPU was full.
 */

export type Pressure = 'low' | 'ok' | 'high';

const HIGH_AFTER = 2;
const LOW_AFTER = 4;
const REPEAT_EVERY = 2;

export class PressureMonitor {
  public level: Pressure = 'ok';
  private _high = 0;
  private _low = 0;
  private _sinceSignal = 0;

  /**
   * One sample: `cpu` and `gpu` in ms (null when unknown), `fps` of the last refresh, `budget` in
   * ms. Returns the level to signal now, or null when there is nothing new to say.
   */
  public update(cpu: number | null, gpu: number | null, fps: number | null, budget: number): Pressure | null {
    const target = 1000 / budget;
    const load = cpu === null && gpu === null ? null : Math.max(cpu ?? 0, gpu ?? 0) / budget;
    const slow = fps !== null && fps < target * 0.85;
    const high = slow || (load !== null && load > 0.95);
    const low = !high && load !== null && load < 0.6 && fps !== null && fps >= target * 0.95;
    this._high = high ? this._high + 1 : 0;
    this._low = low ? this._low + 1 : 0;
    const level: Pressure = this._high >= HIGH_AFTER ? 'high' : this._low >= LOW_AFTER ? 'low' : 'ok';
    if (level !== this.level) {
      this.level = level;
      this._sinceSignal = 0;
      return level;
    }

    if (level === 'ok') return null;
    this._sinceSignal++;
    if (this._sinceSignal < REPEAT_EVERY) return null;
    this._sinceSignal = 0;
    return level;
  }

  public reset(): void {
    this.level = 'ok';
    this._high = 0;
    this._low = 0;
    this._sinceSignal = 0;
  }
}
