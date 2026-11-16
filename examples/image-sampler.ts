/**
 * Channel histogram of the rendered image, for the Image example mode (image.ts).
 *
 * The canvas is copied into a 256×144 2D canvas right after rendering (inside `stats.end()`, the
 * same task as `render()`, so no `preserveDrawingBuffer` is needed) and binned per channel. This is
 * the image as displayed: after tone mapping and sRGB encoding, 8 bits per channel. Cost: one small
 * drawImage and getImageData (37k pixels), a few times per second, only while the mode is on.
 */

export const IMAGE_WIDTH = 256;
export const IMAGE_HEIGHT = 144;
/** One bin per 8-bit value, so each draws as a 1px column. */
export const IMAGE_BINS = 256;
/** Captures closer than this are the same refresh: the three channel reads share one copy. */
const SAME_REFRESH_MS = 100;

export class ImageSampler {
  public readonly red = new Float32Array(IMAGE_BINS);
  public readonly green = new Float32Array(IMAGE_BINS);
  public readonly blue = new Float32Array(IMAGE_BINS);
  /** Share (0–1) of pixels with a channel at 255 (highlights clipped) and all channels at 0 (blacks crushed). */
  public clippedHigh = 0;
  public clippedLow = 0;
  public valid = false;
  /** RGBA of the last copy (IMAGE_WIDTH × IMAGE_HEIGHT), or null before the first capture. */
  public pixels: Uint8ClampedArray | null = null;
  private readonly _ctx: CanvasRenderingContext2D | null;
  private _capturedAt = -Infinity;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = IMAGE_WIDTH;
    canvas.height = IMAGE_HEIGHT;
    this._ctx = canvas.getContext('2d', { willReadFrequently: true });
  }

  /** Copies and bins the source canvas. Returns false when the browser refuses (e.g. tainted canvas). */
  public capture(source: HTMLCanvasElement): boolean {
    const ctx = this._ctx;
    if (ctx === null || source.width === 0 || source.height === 0) return false;
    const now = performance.now();
    if (now - this._capturedAt < SAME_REFRESH_MS) return this.valid;
    this._capturedAt = now;
    try {
      // drawImage composites: without a clear, transparent areas would keep earlier frames.
      ctx.clearRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
      ctx.drawImage(source, 0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
      const data = ctx.getImageData(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT).data;
      this.bin(data);
      this.pixels = data;
      this.valid = true;
    } catch {
      this.valid = false;
    }

    return this.valid;
  }

  private bin(data: Uint8ClampedArray): void {
    this.red.fill(0);
    this.green.fill(0);
    this.blue.fill(0);
    let high = 0;
    let low = 0;
    let pixels = 0;
    for (let i = 0, l = data.length; i < l; i += 4) {
      // Fully transparent pixels show the page behind the canvas, not the render: not part of the image.
      if (data[i + 3] === 0) continue;
      pixels++;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      this.red[r]++;
      this.green[g]++;
      this.blue[b]++;
      if (r === 255 || g === 255 || b === 255) high++;
      else if (r === 0 && g === 0 && b === 0) low++;
    }

    this.clippedHigh = pixels > 0 ? high / pixels : 0;
    this.clippedLow = pixels > 0 ? low / pixels : 0;
  }
}

/** Luma at or above this is clipped: 250 of 255, as camera zebras set at 98%. */
export const ZEBRA_LEVEL = 250;

/**
 * Fills `out` (RGBA, IMAGE_WIDTH × IMAGE_HEIGHT) with diagonal stripes over the pixels that have a
 * channel at or above ZEBRA_LEVEL; everything else is transparent. `phase` moves the stripes.
 * Returns the number of clipped pixels.
 */
export function zebraMask(pixels: Uint8ClampedArray, out: Uint8ClampedArray, phase: number): number {
  let clipped = 0;
  for (let i = 0, p = 0, l = pixels.length; i < l; i += 4, p++) {
    const hot = pixels[i + 3] > 0 && (pixels[i] >= ZEBRA_LEVEL || pixels[i + 1] >= ZEBRA_LEVEL || pixels[i + 2] >= ZEBRA_LEVEL);
    if (!hot) {
      out[i + 3] = 0;
      continue;
    }

    clipped++;
    const x = p % IMAGE_WIDTH;
    const y = (p - x) / IMAGE_WIDTH;
    const dark = ((x + y + phase) & 3) < 2;
    out[i] = dark ? 0 : 244;
    out[i + 1] = dark ? 0 : 244;
    out[i + 2] = dark ? 0 : 241;
    out[i + 3] = 215;
  }

  return clipped;
}
