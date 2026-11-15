/**
 * Image scopes, the monitoring tools of a camera's display, on the rendered image:
 *
 * - waveform: luma per image column (left to right as in the picture, black at the bottom), so
 *   exposure reads by position: where the image clips, where it is flat;
 * - vectorscope: hue as the angle and saturation as the distance from the centre, so a colour
 *   cast is a cloud pulled off centre;
 * - zebra: stripes over the clipped highlights, drawn over the canvas.
 *
 * All read the shared 256×144 copy of the canvas (see image.ts): the displayed image, after tone
 * mapping and encoding. Scopes are density plots, so their box has a dark screen behind the points.
 */

import type { Panel } from './custom.js';
import { el, setLabel, setText, stack } from './dom.js';
import { formatPercent } from './format.js';
import type { GraphColors } from './graphs.js';
import { IMAGE_HEIGHT, IMAGE_WIDTH, SCOPE_SIZE, WAVE_COLUMNS, WAVE_LEVELS, type ImageSampler } from './image.js';
import { setTip } from './tooltip.js';
import type { TipContent } from './types.js';

const CONTOUR = 'rgb(0 0 0 / 0.85)';
const SCREEN = 'rgb(0 0 0 / 0.8)';
/** Luma at or above this is clipped: 250 of 255, as camera zebras set at 98%. */
export const ZEBRA_LEVEL = 250;

/** '#rrggbb' or '#rgb' to [r, g, b]; anything else is the overlay ink. */
export function parseHex(color: string): [number, number, number] {
  const hex = color.trim().replace('#', '');
  const full = hex.length === 3 ? hex.replace(/./g, '$&$&') : hex;
  const value = /^[0-9a-f]{6}$/i.test(full) ? parseInt(full, 16) : 0xf4f4f1;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** A density plot in a 1px ink box with the dark contour: `width` × `height` data cells, shown at `scale` px each. */
class ScopeScreen {
  public readonly element: HTMLCanvasElement;
  public readonly image: ImageData | null;
  private readonly _ctx: CanvasRenderingContext2D | null;
  private readonly _buffer: HTMLCanvasElement;
  private readonly _bufferCtx: CanvasRenderingContext2D | null;
  private _dpr = 0;

  constructor(private readonly _width: number, private readonly _height: number, private readonly _scale: number) {
    this.element = document.createElement('canvas');
    this.element.className = 'tez-hist';
    // Box = data + 1px border; the canvas adds 1px of contour on each side, hidden by a negative margin.
    this.element.style.width = `${this.boxWidth + 2}px`;
    this.element.style.height = `${this.boxHeight + 2}px`;
    this.element.style.margin = '-1px';
    this.element.setAttribute('role', 'img');
    this._ctx = this.element.getContext('2d');
    this._buffer = document.createElement('canvas');
    this._buffer.width = _width;
    this._buffer.height = _height;
    this._bufferCtx = this._buffer.getContext('2d');
    this.image = this._bufferCtx?.createImageData(_width, _height) ?? null;
  }

  public get boxWidth(): number { return this._width * this._scale + 2; }
  public get boxHeight(): number { return this._height * this._scale + 2; }

  /** Paints the box, the screen and the current `image`; `marks` draws on top, in box coordinates. */
  public draw(colors: GraphColors, marks?: (ctx: CanvasRenderingContext2D) => void): void {
    const ctx = this._ctx;
    if (ctx === null || this.image === null || this._bufferCtx === null) return;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio));
    if (dpr !== this._dpr) {
      this._dpr = dpr;
      this.element.width = (this.boxWidth + 2) * dpr;
      this.element.height = (this.boxHeight + 2) * dpr;
    }

    const w = this.boxWidth;
    const h = this.boxHeight;
    ctx.setTransform(dpr, 0, 0, dpr, dpr, dpr);
    ctx.clearRect(-1, -1, w + 2, h + 2);
    ctx.fillStyle = CONTOUR;
    ctx.fillRect(-1, -1, w + 2, h + 2);
    ctx.clearRect(1, 1, w - 2, h - 2);
    ctx.fillStyle = colors.ink;
    ctx.fillRect(0, 0, w, 1);
    ctx.fillRect(0, h - 1, w, 1);
    ctx.fillRect(0, 0, 1, h);
    ctx.fillRect(w - 1, 0, 1, h);
    ctx.fillStyle = SCREEN;
    ctx.fillRect(1, 1, w - 2, h - 2);
    this._bufferCtx.putImageData(this.image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._buffer, 1, 1, w - 2, h - 2);
    marks?.(ctx);
  }
}

function panel(label: readonly [string, string], screen: ScopeScreen, tip: TipContent, asideTip: string): { element: HTMLElement; top: HTMLSpanElement; bottom: HTMLSpanElement } {
  const element = el('div', 'tez-panel tez-scope');
  const plot = setTip(el('div', 'tez-panel-plot'), tip);
  plot.append(screen.element);
  const top = el('span', '', '—');
  const bottom = el('span', '', '');
  const aside = el('span', 'tez-stack tez-aside');
  aside.dataset['tip'] = asideTip;
  aside.classList.add('tez-hit');
  aside.append(top, bottom);
  element.append(stack(label[0], label[1]), plot, aside);
  return { element, top, bottom };
}

/** Alpha (0–255) of a density cell: a square-root curve, so sparse cells stay visible. */
function alpha(count: number, full: number): number {
  return count <= 0 ? 0 : Math.min(255, Math.round(70 + 185 * Math.sqrt(Math.min(1, count / full))));
}

/** Waveform monitor: luma per image column. */
export function waveformPanel(sampler: ImageSampler, capture: () => boolean): Panel {
  const screen = new ScopeScreen(WAVE_COLUMNS, WAVE_LEVELS, 1);
  const text = 'Brightness of each image column, left to right as in the picture: black at the bottom, white at the top.';
  const parts = panel(['WAVE', 'LUMA'], screen, {
    title: 'Waveform',
    text,
    legend: [
      { mark: 'ink', text: 'Where the pixels of that column sit, brighter = more of them' },
      { mark: 'alert', text: 'Top row: clipped highlights in that part of the image' }
    ],
    values: () => (sampler.valid ? [['Darkest', String(sampler.lumaMin)], ['Brightest', String(sampler.lumaMax)]] : [['Canvas', 'not readable']]),
    advice: 'A trace squeezed into a narrow band is a flat image: raise contrast with lighting, not only with tone mapping.'
  }, 'Brightest and darkest luma in the image, 0 to 255.');
  // Pixels per image column in the 256×144 copy.
  const perColumn = (IMAGE_WIDTH / WAVE_COLUMNS) * IMAGE_HEIGHT;
  return {
    element: parts.element,
    timing: 'refresh',
    sample: () => {
      capture();
    },
    draw: (colors) => {
      const image = screen.image;
      if (image === null) return;
      const ink = parseHex(colors.ink);
      const alert = parseHex(colors.alert);
      const data = image.data;
      data.fill(0);
      if (sampler.valid) {
        for (let column = 0; column < WAVE_COLUMNS; column++) {
          for (let level = 0; level < WAVE_LEVELS; level++) {
            const a = alpha(sampler.wave[column * WAVE_LEVELS + level], perColumn * 0.25);
            if (a === 0) continue;
            const color = level === WAVE_LEVELS - 1 ? alert : ink;
            const at = ((WAVE_LEVELS - 1 - level) * WAVE_COLUMNS + column) * 4;
            data[at] = color[0];
            data[at + 1] = color[1];
            data[at + 2] = color[2];
            data[at + 3] = a;
          }
        }
      }

      screen.draw(colors);
    },
    describe: () => {
      const valid = sampler.valid;
      setText(parts.top, valid ? `HI ${sampler.lumaMax}` : '—');
      setText(parts.bottom, valid ? `LO ${sampler.lumaMin}` : '');
      setLabel(screen.element, valid ? `${text} Now: luma from ${sampler.lumaMin} to ${sampler.lumaMax}.` : `${text} Unavailable: the canvas could not be read.`);
    }
  };
}

/** Position of a colour on the vectorscope, 0–1 on each axis (x = Cb, y = Cr upwards). */
export function chromaPosition(r: number, g: number, b: number): [number, number] {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [(b - luma) / 1.8556 / 255 + 0.5, (r - luma) / 1.5748 / 255 + 0.5];
}

/** The six 75% colour bar targets of a broadcast vectorscope: R, Yl, G, Cy, B, Mg. */
const TARGETS: readonly [number, number, number][] = [[191, 0, 0], [191, 191, 0], [0, 191, 0], [0, 191, 191], [0, 0, 191], [191, 0, 191]];

/** Vectorscope: hue as the angle, saturation as the distance from the centre. */
export function vectorscopePanel(sampler: ImageSampler, capture: () => boolean): Panel {
  const screen = new ScopeScreen(SCOPE_SIZE, SCOPE_SIZE, 1);
  const text = 'Colours of the image: hue is the direction from the centre, saturation the distance. Greys sit in the middle.';
  const parts = panel(['VEC', 'CHROMA'], screen, {
    title: 'Vectorscope',
    text,
    legend: [
      { mark: 'ink', text: 'Each dot is a colour in the image, in its own hue' },
      { mark: 'r', text: 'Corner marks: where pure red, yellow, green, cyan, blue and magenta fall' }
    ],
    values: () => (sampler.valid ? [['Mean saturation', formatPercent(sampler.saturation * 100)]] : [['Canvas', 'not readable']]),
    advice: 'A cloud pulled off centre in a scene meant to be neutral is a colour cast: check light colours and the environment map.'
  }, 'Mean saturation of the image: 0% is greyscale.');
  const total = IMAGE_WIDTH * IMAGE_HEIGHT;
  return {
    element: parts.element,
    timing: 'refresh',
    sample: () => {
      capture();
    },
    draw: (colors) => {
      const image = screen.image;
      if (image === null) return;
      const data = image.data;
      data.fill(0);
      if (sampler.valid) {
        for (let y = 0; y < SCOPE_SIZE; y++) {
          for (let x = 0; x < SCOPE_SIZE; x++) {
            const a = alpha(sampler.scope[y * SCOPE_SIZE + x], total * 0.02);
            if (a === 0) continue;
            // The colour this bin stands for, at a mid luma, so every hue stays readable.
            const cb = ((x + 0.5) / SCOPE_SIZE - 0.5) * 255;
            const cr = (0.5 - (y + 0.5) / SCOPE_SIZE) * 255;
            const luma = 150;
            const r = luma + cr * 1.5748;
            const b = luma + cb * 1.8556;
            const g = (luma - 0.2126 * r - 0.0722 * b) / 0.7152;
            const at = (y * SCOPE_SIZE + x) * 4;
            data[at] = r;
            data[at + 1] = g;
            data[at + 2] = b;
            data[at + 3] = a;
          }
        }
      }

      screen.draw(colors, (ctx) => {
        // Centre mark and the six colour targets.
        ctx.fillStyle = colors.ink;
        const centre = 1 + SCOPE_SIZE / 2;
        ctx.fillRect(centre - 2, centre, 5, 1);
        ctx.fillRect(centre, centre - 2, 1, 5);
        for (let i = 0, l = TARGETS.length; i < l; i++) {
          const [u, v] = chromaPosition(TARGETS[i][0], TARGETS[i][1], TARGETS[i][2]);
          ctx.fillStyle = `rgb(${TARGETS[i][0] + 64} ${TARGETS[i][1] + 64} ${TARGETS[i][2] + 64})`;
          ctx.fillRect(Math.round(u * SCOPE_SIZE), Math.round((1 - v) * SCOPE_SIZE), 2, 2);
        }
      });
    },
    describe: () => {
      const valid = sampler.valid;
      setText(parts.top, valid ? formatPercent(sampler.saturation * 100) : '—');
      setText(parts.bottom, 'SAT');
      setLabel(screen.element, valid ? `${text} Now: mean saturation ${formatPercent(sampler.saturation * 100)}.` : `${text} Unavailable: the canvas could not be read.`);
    }
  };
}

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
