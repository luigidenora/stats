/**
 * Slow signals for the diagnostics: long animation frames, context losses, shader compiles over
 * time and the trends of memory counters. Sampled once a second, from values the overlay already
 * has; the observers are passive.
 */

/** A value sampled once a second over the last minute. */
export class Trend {
  private readonly _values: number[] = [];

  public push(value: number): void {
    this._values.push(value);
    if (this._values.length > 60) this._values.shift();
  }

  /** Growth over the last `seconds`, only when it never went down in between; null while too short. */
  public steadyGrowth(seconds: number): number | null {
    const values = this._values;
    if (values.length <= seconds) return null;
    const start = values.length - 1 - seconds;
    for (let i = start + 1, l = values.length; i < l; i++) {
      if (values[i] < values[i - 1]) return 0;
    }

    return values[values.length - 1] - values[start];
  }

  /** Drops of more than `share` between consecutive samples per second, over the last `seconds`. */
  public dropRate(seconds: number, share: number): number | null {
    const values = this._values;
    if (values.length <= seconds) return null;
    let drops = 0;
    for (let i = values.length - seconds, l = values.length; i < l; i++) {
      if (values[i] < values[i - 1] * (1 - share)) drops++;
    }

    return drops / seconds;
  }
}

interface LoafEntry { blockingDuration?: number }

export class HealthMonitor {
  public contextLost = 0;
  private readonly _geometries = new Trend();
  private readonly _textures = new Trend();
  private readonly _heap = new Trend();
  private readonly _compiles: number[] = [];
  private readonly _observer: PerformanceObserver | null = null;
  private _blocked = 0;
  private _blockedWindowStart = performance.now();
  private _blocking: number | null = null;
  private readonly _started = performance.now();

  private readonly onLost = (): void => {
    this.contextLost++;
  };

  constructor(private readonly _canvas: HTMLCanvasElement) {
    _canvas.addEventListener('webglcontextlost', this.onLost);
    // supportedEntryTypes is missing in older Safari; observe() throws on unknown types in some engines.
    const types = typeof PerformanceObserver === 'undefined' ? undefined : (PerformanceObserver.supportedEntryTypes as readonly string[] | undefined);
    if (types?.includes('long-animation-frame') === true) {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries() as (PerformanceEntry & LoafEntry)[];
          for (let i = 0, l = entries.length; i < l; i++) this._blocked += entries[i].blockingDuration ?? 0;
        });
        observer.observe({ type: 'long-animation-frame', buffered: false });
        this._observer = observer;
        this._blocking = 0;
      } catch {
        this._observer = null;
      }
    }
  }

  /** Seconds since the overlay started. */
  public get uptime(): number { return (performance.now() - this._started) / 1000; }

  /** Long animation frame blocking time per second, in ms; null where the browser has no LoAF. */
  public get blocking(): number | null { return this._blocking; }

  /** Records a frame that created a shader program (ignored during the first 5 s of warm-up). */
  public compiled(): void {
    if (this.uptime > 5) this._compiles.push(performance.now());
  }

  /** Shader programs created in the last 10 s. */
  public get recentPrograms(): number {
    const since = performance.now() - 10_000;
    while (this._compiles.length > 0 && this._compiles[0] < since) this._compiles.shift();
    return this._compiles.length;
  }

  /** Once a second: memory counters and the LoAF window. */
  public sample(geometries: number, textures: number, heap: number | null): void {
    this._geometries.push(geometries);
    this._textures.push(textures);
    if (heap !== null) this._heap.push(heap);
    const now = performance.now();
    if (this._observer !== null) {
      this._blocking = this._blocked / Math.max(1, (now - this._blockedWindowStart) / 1000);
      this._blocked = 0;
      this._blockedWindowStart = now;
    }
  }

  public get geometryGrowth(): number | null { return this._geometries.steadyGrowth(30); }
  public get textureGrowth(): number | null { return this._textures.steadyGrowth(30); }
  /** Heap drops above 10% per second over the last 10 s: garbage collections. */
  public get gcRate(): number | null { return this._heap.dropRate(10, 0.1); }

  public dispose(): void {
    this._canvas.removeEventListener('webglcontextlost', this.onLost);
    this._observer?.disconnect();
  }
}
