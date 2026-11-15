/**
 * The large additive histogram: up to three channels in red, green and blue on one shared
 * scale, composited with 'lighter' so they add up like light (white where all three agree).
 *
 * - x: the value, linear or logarithmic over a fixed domain; out-of-domain values land in the
 *   edge bins, and a non-empty edge bin lights a yellow mark on that edge (clipping);
 * - y: how many, on a square-root scale so small populations stay visible next to big ones;
 * - one dark contour around the union of all channels, so overlaps never get a seam.
 */

import type { GraphColors } from './graphs.js';

const PAD = 5;
const CONTOUR = 'rgb(0 0 0 / 0.85)';
/** Series colour keys, in channel order: red, green, blue. */
const CHANNEL_KEYS = ['r', 'g', 'b'] as const;

export interface HistogramScale {
  min: number;
  max: number;
  log: boolean;
}

/** Bins raw values into `out` (cleared first); values outside the domain clamp to the edge bins. */
export function binValues(values: ArrayLike<number>, scale: HistogramScale, out: Float32Array): void {
  out.fill(0);
  const bins = out.length;
  const lo = scale.log ? Math.log(Math.max(1e-9, scale.min)) : scale.min;
  const hi = scale.log ? Math.log(Math.max(1e-9, scale.max)) : scale.max;
  const span = hi - lo || 1;
  for (let i = 0, l = values.length; i < l; i++) {
    const raw = values[i];
    if (!Number.isFinite(raw)) continue;
    const v = scale.log ? Math.log(Math.max(1e-9, raw)) : raw;
    const bin = Math.floor(((v - lo) / span) * bins);
    out[bin < 0 ? 0 : bin >= bins ? bins - 1 : bin]++;
  }
}

/** Horizontal position (0..1) of a value on the scale. */
export function position(value: number, scale: HistogramScale): number {
  if (!scale.log) return (value - scale.min) / (scale.max - scale.min || 1);
  const lo = Math.log(Math.max(1e-9, scale.min));
  const hi = Math.log(Math.max(1e-9, scale.max));
  return (Math.log(Math.max(1e-9, value)) - lo) / (hi - lo || 1);
}

/**
 * Resamples bar heights per bin into one height per pixel column (`out.length` columns): each
 * column takes the tallest bin it covers, so with as many columns as bins every bin is exactly
 * 1px wide, and with fewer no peak is lost.
 */
export function columnHeights(heights: ArrayLike<number>, out: Uint16Array): Uint16Array {
  const bins = heights.length;
  const columns = out.length;
  for (let x = 0; x < columns; x++) {
    const start = Math.floor((x * bins) / columns);
    const end = Math.max(start + 1, Math.floor(((x + 1) * bins) / columns));
    let v = 0;
    for (let i = start; i < end && i < bins; i++) v = Math.max(v, heights[i]);
    out[x] = v;
  }

  return out;
}

/** An edge counts as clipped when its bin holds anything (values outside the domain land there). */
function edgeClip(channels: readonly Float32Array[]): { low: boolean; high: boolean } {
  let low = false;
  let high = false;
  for (let c = 0, cl = channels.length; c < cl; c++) {
    const bins = channels[c].length;
    if (bins === 0) continue;
    low ||= channels[c][0] > 0;
    high ||= channels[c][bins - 1] > 0;
  }

  return { low, high };
}

export class HistogramGraph {
  public readonly element: HTMLCanvasElement;
  private readonly _ctx: CanvasRenderingContext2D;
  private _width: number;
  private readonly _height: number;
  private _dpr = 0;
  private _columns = new Uint16Array(0);
  private readonly _heights: Uint16Array[] = [];

  constructor(width: number, height: number, label: string) {
    this._width = width;
    this._height = height;
    this.element = document.createElement('canvas');
    this.element.className = 'tez-hist';
    this.element.style.margin = `-${PAD}px`;
    this.element.setAttribute('role', 'img');
    this.element.setAttribute('aria-label', label);
    this.element.dataset['tip'] = label;
    this._ctx = this.element.getContext('2d') as CanvasRenderingContext2D;
    this.applySize();
  }

  public get width(): number { return this._width; }

  public setWidth(width: number): void {
    this._width = Math.max(96, Math.round(width));
    this.applySize();
  }

  /**
   * Draws the channels (counts per bin, all the same length) and tick positions (0..1).
   * `clip` lights the yellow edge marks; by default an edge is marked when its bin is not empty.
   */
  public draw(channels: readonly Float32Array[], ticks: readonly number[], colors: GraphColors, clip?: { low: boolean; high: boolean }): void {
    this.fitPixelRatio();
    const ctx = this._ctx;
    const w = this._width;
    const h = this._height;
    ctx.clearRect(0, 0, w + PAD * 2, h + PAD * 2);

    let max = 0;
    for (let c = 0, cl = channels.length; c < cl; c++) {
      for (let i = 1, l = channels[c].length - 1; i < l; i++) max = Math.max(max, channels[c][i]);
    }

    // Edge bins hold the clipped values: they never set the scale, so one spike cannot flatten the rest.
    const bins = channels.length > 0 ? channels[0].length : 0;
    const inner = h - 2;
    const heights = this.heights(channels, Math.sqrt(Math.max(1, max)), inner);
    const union = new Uint16Array(bins);
    for (let c = 0, cl = heights.length; c < cl; c++) {
      for (let i = 0; i < bins; i++) union[i] = Math.max(union[i], heights[c][i]);
    }

    ctx.fillStyle = CONTOUR;
    this.frame(1);
    this.columns(union, 1);
    this.tickMarks(ticks, 1);

    ctx.fillStyle = colors.ink;
    this.frame(0);
    this.tickMarks(ticks, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (let c = 0, cl = heights.length; c < cl; c++) {
      ctx.fillStyle = cl === 1 ? colors.ink : (colors.series[CHANNEL_KEYS[c]] ?? colors.ink);
      this.columns(heights[c], 0);
    }

    ctx.globalCompositeOperation = 'source-over';
    this.clipMarks(clip ?? edgeClip(channels), colors.alert);
  }

  private heights(channels: readonly Float32Array[], top: number, inner: number): Uint16Array[] {
    // Reused across draws: the image histogram redraws 4×/s.
    const result = this._heights;
    result.length = channels.length;
    for (let c = 0, cl = channels.length; c < cl; c++) {
      let out = result[c] as Uint16Array | undefined;
      if (out?.length !== channels[c].length) {
        out = new Uint16Array(channels[c].length);
        result[c] = out;
      }

      for (let i = 0, l = channels[c].length; i < l; i++) {
        const v = channels[c][i];
        out[i] = v > 0 ? Math.max(1, Math.min(inner, Math.round((Math.sqrt(v) / top) * inner))) : 0;
      }
    }

    return result;
  }

  /** One 1px column per pixel of the inner width (bins resampled); `grow` px larger for the contour pass. */
  private columns(heights: Uint16Array, grow: number): void {
    const inner = this._width - 2;
    if (this._columns.length !== inner) this._columns = new Uint16Array(inner);
    const columns = columnHeights(heights, this._columns);
    for (let x = 0; x < inner; x++) {
      const v = columns[x];
      if (v === 0) continue;
      this._ctx.fillRect(PAD + 1 + x - grow, PAD + this._height - 1 - v - grow, 1 + grow * 2, v + grow * 2);
    }
  }

  private frame(grow: number): void {
    const w = this._width;
    const h = this._height;
    const rects = [PAD, PAD, w, 1, PAD, PAD + h - 1, w, 1, PAD, PAD, 1, h, PAD + w - 1, PAD, 1, h];
    for (let i = 0, l = rects.length; i < l; i += 4) {
      this._ctx.fillRect(rects[i] - grow, rects[i + 1] - grow, rects[i + 2] + grow * 2, rects[i + 3] + grow * 2);
    }
  }

  /** Reference marks just below the box. */
  private tickMarks(ticks: readonly number[], grow: number): void {
    for (let i = 0, l = ticks.length; i < l; i++) {
      if (ticks[i] <= 0 || ticks[i] >= 1) continue;
      const x = PAD + 1 + Math.round(ticks[i] * (this._width - 2));
      this._ctx.fillRect(x - grow, PAD + this._height + 1 - grow, 1 + grow * 2, 3 + grow * 2);
    }
  }

  /** Yellow marks on the clipped edges. */
  private clipMarks(clip: { low: boolean; high: boolean }, alert: string): void {
    this._ctx.fillStyle = alert;
    if (clip.low) this._ctx.fillRect(PAD, PAD, 2, this._height);
    if (clip.high) this._ctx.fillRect(PAD + this._width - 2, PAD, 2, this._height);
  }

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
