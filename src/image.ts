/**
 * Channel histogram of the rendered image.
 *
 * The canvas is copied into a 256×144 2D canvas right after rendering (inside `stats.end()`, the
 * same task as `render()`, so no `preserveDrawingBuffer` is needed) and binned per channel.
 * This is the image as displayed: after tone mapping and sRGB encoding, 8 bits per channel.
 * Cost: one small drawImage and getImageData (37k pixels), a few times per second, only while visible.
 *
 * Besides the R, G, B histograms (one bin per 8-bit value, so each draws as a 1px column) it keeps
 * the luma histogram (Rec. 709 weights on the encoded values) and a waveform: luma per image
 * column, like a video waveform monitor, for the INFO image page.
 */

export const IMAGE_WIDTH = 256;
export const IMAGE_HEIGHT = 144;
const WIDTH = IMAGE_WIDTH;
const HEIGHT = IMAGE_HEIGHT;
/** Vectorscope size: chroma bins per side (Cb on x, Cr on y). */
export const SCOPE_SIZE = 64;
/** Captures closer than this are the same refresh: several panels share one copy. */
const SAME_REFRESH_MS = 100;
export const IMAGE_BINS = 256;
/** Waveform size: image columns (x) × luma levels (y). */
export const WAVE_COLUMNS = 128;
export const WAVE_LEVELS = 64;

export class ImageSampler {
  public readonly red = new Float32Array(IMAGE_BINS);
  public readonly green = new Float32Array(IMAGE_BINS);
  public readonly blue = new Float32Array(IMAGE_BINS);
  public readonly luma = new Float32Array(IMAGE_BINS);
  /** Pixel count per [column, level], column-major: index = column * WAVE_LEVELS + level (level 0 = black). */
  public readonly wave = new Float32Array(WAVE_COLUMNS * WAVE_LEVELS);
  /** Share (0–1) of pixels with a channel at 255 (highlights clipped) and all channels at 0 (blacks crushed). */
  public clippedHigh = 0;
  public clippedLow = 0;
  public valid = false;
  /** Pixel count per chroma bin, row-major: index = y * SCOPE_SIZE + x; Cb grows right, Cr grows up. */
  public readonly scope = new Float32Array(SCOPE_SIZE * SCOPE_SIZE);
  /** Mean saturation (chroma distance from grey), 0–1. */
  public saturation = 0;
  /** Lowest and highest luma present, 0–255. */
  public lumaMin = 0;
  public lumaMax = 0;
  /** RGBA of the last copy (IMAGE_WIDTH × IMAGE_HEIGHT), or null before the first capture. */
  public pixels: Uint8ClampedArray | null = null;
  private _capturedAt = -Infinity;

  private readonly _canvas: HTMLCanvasElement;
  private readonly _ctx: CanvasRenderingContext2D | null;

  constructor() {
    this._canvas = document.createElement('canvas');
    this._canvas.width = WIDTH;
    this._canvas.height = HEIGHT;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
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
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.drawImage(source, 0, 0, WIDTH, HEIGHT);
      const data = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
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
    this.luma.fill(0);
    this.wave.fill(0);
    this.scope.fill(0);
    let chroma = 0;
    let lumaMin = 255;
    let lumaMax = 0;
    let high = 0;
    let low = 0;
    const shift = Math.log2(256 / IMAGE_BINS);
    const waveX = WIDTH / WAVE_COLUMNS;
    const waveShift = Math.log2(256 / WAVE_LEVELS);
    let pixels = 0;
    for (let i = 0, l = data.length; i < l; i += 4) {
      // Fully transparent pixels show the page behind the canvas, not the render: not part of the image.
      if (data[i + 3] === 0) continue;
      pixels++;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      this.red[r >> shift]++;
      this.green[g >> shift]++;
      this.blue[b >> shift]++;
      const y = Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
      this.luma[y >> shift]++;
      const column = Math.floor(((i >> 2) % WIDTH) / waveX);
      this.wave[column * WAVE_LEVELS + (y >> waveShift)]++;
      if (y < lumaMin) lumaMin = y;
      if (y > lumaMax) lumaMax = y;
      // Rec. 709 colour difference, each within ±127.5.
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const cb = (b - luma) / 1.8556;
      const cr = (r - luma) / 1.5748;
      chroma += Math.sqrt(cb * cb + cr * cr);
      const sx = Math.min(SCOPE_SIZE - 1, Math.max(0, Math.floor((cb / 255 + 0.5) * SCOPE_SIZE)));
      const sy = Math.min(SCOPE_SIZE - 1, Math.max(0, Math.floor((0.5 - cr / 255) * SCOPE_SIZE)));
      this.scope[sy * SCOPE_SIZE + sx]++;
      if (r === 255 || g === 255 || b === 255) high++;
      else if (r === 0 && g === 0 && b === 0) low++;
    }

    this.saturation = pixels > 0 ? chroma / pixels / 127.5 : 0;
    this.lumaMin = pixels > 0 ? lumaMin : 0;
    this.lumaMax = lumaMax;
    this.clippedHigh = pixels > 0 ? high / pixels : 0;
    this.clippedLow = pixels > 0 ? low / pixels : 0;
  }
}
