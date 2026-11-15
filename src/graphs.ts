/**
 * Scrolling time graphs: one 1px track per sample.
 *
 * - Horizontal: time runs left to right (newest on the right), values grow upwards.
 * - Vertical: time scrolls upwards (newest at the bottom); values grow from the zero edge
 *   (`zero: 'left'` grows rightwards, `zero: 'right'` grows leftwards).
 *
 * The budget is marked by short ticks outside the box, on both sides of the value axis, so the
 * plot area stays clean. Uncoloured series colour each sample by the budget: ink on time, alert
 * yellow when one refresh was missed, red when two or more were. Coloured series (CPU, GPU) add
 * up like light where they overlap.
 *
 * The criticality lane is a 2px strip under the box: yellow under a column that missed one
 * refresh, red under one that missed two or more, empty when on time. It keeps a normalised graph
 * honest about the budget, which its own scale cannot show.
 *
 * Events (a new shader program) are short ink ticks above the box, over the column they happened
 * in; the top edge is free because the budget ticks sit on the sides.
 *
 * Every shape gets a centred 1px dark contour, drawn in the canvas before the ink: one contour
 * around the union of all series, so overlaps blend into a new colour with no dark seam.
 */

/** Room around the box for the budget ticks and the contour. */
const PAD = 5;
const TICK = 3;
const CONTOUR = 'rgb(0 0 0 / 0.85)';
/** Samples kept per series, enough for the longest track. */
const CAPACITY = 512;
/** Round axis ends for the auto scale, per decade. */
const NICE_STEPS = [1, 2, 2.5, 5, 10];

export interface GraphColors {
  ink: string;
  clip: string;
  alert: string;
  /** Series colours by key, e.g. { cpu: '#…', gpu: '#…' }. */
  series: Readonly<Record<string, string>>;
}

/** Ring buffer of the latest samples. */
export class Samples {
  private readonly _values = new Float32Array(CAPACITY);
  private _head = 0;
  private _count = 0;

  public push(ms: number): void {
    this._values[this._head] = ms;
    this._head = (this._head + 1) % CAPACITY;
    this._count = Math.min(CAPACITY, this._count + 1);
  }

  public get count(): number { return this._count; }

  /** The `i`-th most recent sample (0 = newest). */
  public recent(i: number): number {
    return this._values[(this._head - 1 - i + CAPACITY * 2) % CAPACITY];
  }

  /** Smallest of the `n` most recent samples, or null when there are none. */
  public min(n = CAPACITY): number | null {
    const count = Math.min(n, this._count);
    if (count === 0) return null;
    let min = Infinity;
    for (let i = 0; i < count; i++) min = Math.min(min, this.recent(i));
    return min;
  }

  /** Largest of the `n` most recent samples, or null when there are none. */
  public max(n = CAPACITY): number | null {
    const count = Math.min(n, this._count);
    if (count === 0) return null;
    let max = 0;
    for (let i = 0; i < count; i++) max = Math.max(max, this.recent(i));
    return max;
  }
}

/** Smallest round value (1, 2, 2.5, 5 × 10ⁿ) at or above `value`. */
function niceCeil(value: number): number {
  const decade = 10 ** Math.floor(Math.log10(value));
  for (let i = 0, l = NICE_STEPS.length; i < l; i++) {
    if (NICE_STEPS[i] * decade >= value) return NICE_STEPS[i] * decade;
  }

  return 10 * decade;
}

export interface Series {
  samples: Samples;
  /** Key into `GraphColors.series`. Omit to colour each sample by the budget (ink, alert, clip). */
  color?: string;
}

export interface TimeGraphOptions {
  /** Box size in CSS pixels, border included. */
  width: number;
  height: number;
  vertical: boolean;
  /** Axis follows the largest recent sample (capped at 2× budget) instead of a fixed 0..2× budget. */
  autoScale: boolean;
  /** Vertical only: the edge where zero sits. Default 'left'. */
  zero?: 'left' | 'right';
  /** Extra samples the auto scale takes into account, so separate graphs can share one scale. */
  scaleWith?: readonly Samples[];
  /** Fixed axis end (e.g. 100 for percentages); overrides the budget and auto scales. */
  fixedScale?: number;
  /**
   * Each series spans the full height between its own recent min and max, so overlaid series
   * always mix instead of one squashing the others. Shows shape and timing, not magnitude; the
   * budget ticks are dropped because there is no shared axis.
   */
  normalize?: boolean;
  /**
   * Horizontal only: zero on a middle line, the first series grows up, the second down, on one
   * scale. For two directions of one quantity, e.g. LOD switches towards coarser / finer levels.
   */
  mirror?: boolean;
  /**
   * Horizontal only: one sample per column, pushed together with the series; a value above 0
   * draws a tick above that column (e.g. a frame that created a shader program).
   */
  events?: Samples;
  /** Horizontal only: frame times per column (aligned with the series) for the criticality lane under the box. */
  lane?: Samples;
  label: string;
}

export class TimeGraph {
  public readonly element: HTMLCanvasElement;
  /** Axis end of the last draw, in ms. */
  public scale = 0;
  /** Samples visible in the box. */
  public span: number;

  private readonly _ctx: CanvasRenderingContext2D;
  private _depth: number;
  private _width: number;
  private _height: number;
  private readonly _fromRight: boolean;
  private _dpr = 0;
  /**
   * Draw buffers, reused across draws (a graph redraws ~20×/s; allocating here would be the
   * per-frame garbage the diagnostics warn about). Resized only when the span changes.
   */
  private _unions: [Uint16Array, Uint16Array] = [new Uint16Array(0), new Uint16Array(0)];
  private _tracks: Uint16Array[] = [];
  private readonly _rects: number[] = [];
  private readonly _lane: number[] = [];

  constructor(private readonly _budget: number, private readonly _series: readonly Series[], private readonly _options: TimeGraphOptions) {
    const { width, height, vertical, label } = _options;
    this._width = width;
    this._height = height;
    this.span = (vertical ? height : width) - 2;
    this._fromRight = vertical && _options.zero === 'right';
    // Mirrored: each half keeps (height - 3) / 2 px, the 1px middle line sits between them.
    this._depth = _options.mirror === true && !vertical ? Math.floor((height - 3) / 2) : (vertical ? width : height) - 2;
    this.element = document.createElement('canvas');
    this.element.className = 'tez-hist';
    // The canvas is larger than the box by PAD on each side (ticks, contour); a negative margin
    // keeps the box itself aligned with the layout.
    this.element.style.margin = `-${PAD}px`;
    this.applySize();
    this.element.dataset['tip'] = label;
    this.element.setAttribute('role', 'img');
    this.element.setAttribute('aria-label', label);
    this._ctx = this.element.getContext('2d') as CanvasRenderingContext2D;
  }

  /**
   * Changes the length of the time axis (height for vertical graphs, width for horizontal ones),
   * so a graph can fill the space the layout gives it. Capped by the samples kept per series.
   */
  public setLength(px: number): void {
    const length = Math.max(24, Math.min(CAPACITY + 2, Math.round(px)));
    if (this._options.vertical) this._height = length;
    else this._width = length;
    this.span = length - 2;
    this.applySize();
  }

  /** Changes the box height of a horizontal graph (the value axis), e.g. taller on narrow screens. */
  public setHeight(px: number): void {
    if (this._options.vertical || Math.round(px) === this._height) return;
    this._height = Math.max(12, Math.round(px));
    this._depth = this._options.mirror === true ? Math.floor((this._height - 3) / 2) : this._height - 2;
    this.applySize();
  }

  /** Frame budget the colours and ticks refer to, in ms. */
  public get budget(): number { return this._budget; }

  /** True when each series is scaled to its own min and max (no shared axis). */
  public get normalized(): boolean {
    return this._options.normalize === true;
  }

  public draw(colors: GraphColors): void {
    this.fitPixelRatio();
    this.scale = this.computeScale();
    const ctx = this._ctx;
    // One union per side (a mirrored graph has two), for one contour around each silhouette.
    const { unions, tracks } = this.buffers();
    for (let i = 0, l = this._series.length; i < l; i++) this.trackLengths(this._series[i].samples, unions[this.side(i)], tracks[i]);
    const budget = this._options.normalize !== true && this._budget < this.scale ? Math.round((this._budget / this.scale) * this._depth) : -1;
    const frame = this.frameRects(budget);

    ctx.clearRect(0, 0, this._width + PAD * 2, this._height + PAD * 2);
    ctx.fillStyle = CONTOUR;
    this.fill(frame, 1);
    for (let side = 0; side < 2; side++) {
      for (let t = 0; t < this.span; t++) {
        if (unions[side][t] > 0) this.bar(t, unions[side][t], 1, side);
      }
    }

    const lane = this.laneColumns(colors);
    for (let i = 0, l = lane.length; i < l; i += 2) ctx.fillRect(lane[i] - 1, PAD + this._height, 3, 4);

    ctx.fillStyle = colors.ink;
    this.fill(frame);
    this.paintSeries(tracks, colors);
    for (let i = 0, l = lane.length; i < l; i += 2) {
      ctx.fillStyle = lane[i + 1] === 2 ? colors.clip : colors.alert;
      ctx.fillRect(lane[i], PAD + this._height + 1, 1, 2);
    }
  }

  /** The reusable buffers, sized to the span and cleared. */
  private buffers(): { unions: [Uint16Array, Uint16Array]; tracks: Uint16Array[] } {
    const span = this.span;
    if (this._unions[0].length !== span) {
      this._unions = [new Uint16Array(span), new Uint16Array(span)];
      this._tracks = [];
    }

    while (this._tracks.length < this._series.length) this._tracks.push(new Uint16Array(span));
    this._unions[0].fill(0);
    this._unions[1].fill(0);
    return { unions: this._unions, tracks: this._tracks };
  }

  /** Lane columns as [x, level] pairs: level 1 missed one refresh, 2 missed two or more. */
  private laneColumns(colors: GraphColors): number[] {
    const lane = this._options.lane;
    const out = this._lane;
    out.length = 0;
    if (lane === undefined || this._options.vertical) return out;
    for (let i = 0, l = Math.min(this.span, lane.count); i < l; i++) {
      const color = this.budgetColor(lane.recent(i), colors);
      if (color !== colors.ink) out.push(PAD + this.span - i, color === colors.clip ? 2 : 1);
    }

    return out;
  }

  private computeScale(): number {
    if (this._options.fixedScale !== undefined) return this._options.fixedScale;
    const cap = this._budget * 2;
    if (!this._options.autoScale) return cap;
    let max = 0;
    for (let i = 0, l = this._series.length; i < l; i++) max = Math.max(max, this._series[i].samples.max(this.span) ?? 0);
    const extra = this._options.scaleWith ?? [];
    for (let i = 0, l = extra.length; i < l; i++) max = Math.max(max, extra[i].max(this.span) ?? 0);
    // A counter graph has no budget (cap = Infinity): with nothing positive yet, any finite scale will do.
    if (max <= 0) return Number.isFinite(cap) ? cap : 1;
    return Math.min(cap, niceCeil(Math.max(0.5, max * 1.1)));
  }

  /** Bar length per track position (0 = oldest visible, length - 1 = newest). */
  private trackLengths(samples: Samples, union: Uint16Array, lengths: Uint16Array): Uint16Array {
    lengths.fill(0);
    const visible = Math.min(this.span, samples.count);
    const normalize = this._options.normalize === true;
    const low = normalize ? (samples.min(visible) ?? 0) : 0;
    const range = normalize ? Math.max(1e-6, (samples.max(visible) ?? 0) - low) : this.scale;
    for (let i = 0; i < visible; i++) {
      const ms = samples.recent(i);
      const t = this.span - 1 - i;
      // Normalised: the stream minimum sits at the bottom (1px), its maximum at the top.
      const share = normalize ? (ms - low) / range : ms / this.scale;
      const v = ms > 0 ? Math.max(1, Math.round(Math.min(1, share) * this._depth)) : 0;
      lengths[t] = v;
      union[t] = Math.max(union[t], v);
    }

    return lengths;
  }

  /** Coloured series add up where they overlap; an uncoloured series is coloured per sample by the budget. */
  private paintSeries(tracks: readonly Uint16Array[], colors: GraphColors): void {
    const ctx = this._ctx;
    // Overlapping series add up like light; mirrored series never overlap.
    const count = this._series.length;
    ctx.globalCompositeOperation = count > 1 && this._options.mirror !== true ? 'lighter' : 'source-over';
    for (let s = 0; s < count; s++) {
      const key = this._series[s].color;
      const fixed = key === undefined ? null : (colors.series[key] ?? colors.ink);
      for (let t = 0; t < this.span; t++) {
        const v = tracks[s][t];
        if (v === 0) continue;
        ctx.fillStyle = fixed ?? this.budgetColor(this._series[s].samples.recent(this.span - 1 - t), colors);
        this.bar(t, v, 0, this.side(s));
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Frame intervals jitter around whole multiples of the refresh period, so each limit carries a
   * quarter-period tolerance: late (yellow) past 1.25× the budget, i.e. one refresh missed;
   * badly late (red) past 2.25×, i.e. two or more missed. A steady 30 fps on a 60 Hz screen
   * stays a clean yellow instead of flickering between yellow and red.
   */
  private budgetColor(ms: number, colors: GraphColors): string {
    if (ms > this._budget * 2.25) return colors.clip;
    return ms > this._budget * 1.25 ? colors.alert : colors.ink;
  }

  /** 1 for the second series of a mirrored graph (drawn downwards), 0 otherwise. */
  private side(series: number): number {
    return this._options.mirror === true && series > 0 ? 1 : 0;
  }

  /** One sample's bar: track position `t` (0 = oldest), length `v`, grown by `grow` px for the contour. */
  private bar(t: number, v: number, grow = 0, side = 0): void {
    const ctx = this._ctx;
    const width = this._width;
    const height = this._height;
    if (this._options.mirror === true && !this._options.vertical) {
      // Middle line at PAD + 1 + depth: up for side 0, down for side 1.
      const middle = PAD + 1 + this._depth;
      const y = side === 0 ? middle - v : middle + 1;
      ctx.fillRect(PAD + 1 + t - grow, y - grow, 1 + grow * 2, v + grow * 2);
      return;
    }

    if (!this._options.vertical) {
      // Newest on the right, values grow upwards.
      ctx.fillRect(PAD + 1 + t - grow, PAD + height - 1 - v - grow, 1 + grow * 2, v + grow * 2);
      return;
    }

    // Newest at the bottom, so the graph scrolls upwards; bars grow away from the zero edge.
    const x = this._fromRight ? PAD + width - 1 - v : PAD + 1;
    ctx.fillRect(x - grow, PAD + 1 + t - grow, v + grow * 2, 1 + grow * 2);
  }

  /** Box border plus the budget ticks outside it, on both sides of the value axis. */
  private frameRects(budget: number): number[] {
    const w = this._width;
    const h = this._height;
    const vertical = this._options.vertical;
    const rects = this._rects;
    rects.length = 0;
    rects.push(PAD, PAD, w, 1, PAD, PAD + h - 1, w, 1, PAD, PAD, 1, h, PAD + w - 1, PAD, 1, h);
    // Mirrored: the zero line in the middle, dotted so it reads as an axis, not a bar.
    if (this._options.mirror === true && !vertical) {
      for (let x = PAD + 2; x < PAD + w - 2; x += 3) rects.push(x, PAD + 1 + this._depth, 1, 1);
    }

    const events = this._options.events;
    if (events !== undefined && !vertical) {
      for (let i = 0, l = Math.min(this.span, events.count); i < l; i++) {
        const kind = events.recent(i);
        if (kind <= 0) continue;
        const x = PAD + this.span - i;
        rects.push(x, PAD - TICK - 1, 1, TICK);
        // 2 or more: a named event (stats.event()), drawn as a flag on the tick.
        if (kind >= 2) rects.push(x + 1, PAD - TICK - 1, 2, 2);
      }
    }

    if (budget < 0) return rects;
    if (vertical) {
      const x = this._fromRight ? PAD + w - 2 - budget : PAD + 1 + budget;
      rects.push(x, PAD - TICK - 1, 1, TICK, x, PAD + h + 1, 1, TICK);
    } else {
      const y = PAD + h - 1 - budget;
      rects.push(PAD - TICK - 1, y, TICK, 1, PAD + w + 1, y, TICK, 1);
    }

    return rects;
  }

  private fill(rects: readonly number[], grow = 0): void {
    for (let i = 0, l = rects.length; i < l; i += 4) {
      this._ctx.fillRect(rects[i] - grow, rects[i + 1] - grow, rects[i + 2] + grow * 2, rects[i + 3] + grow * 2);
    }
  }

  /** CSS size of the canvas (box plus PAD on each side); the backing store follows on the next draw. */
  private applySize(): void {
    this.element.style.width = `${this._width + PAD * 2}px`;
    this.element.style.height = `${this._height + PAD * 2}px`;
    this._dpr = 0;
  }

  private fitPixelRatio(): void {
    const dpr = Math.max(1, Math.round(window.devicePixelRatio));
    if (dpr === this._dpr) return;
    this._dpr = dpr;
    this.element.width = (this._width + PAD * 2) * dpr;
    this.element.height = (this._height + PAD * 2) * dpr;
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
