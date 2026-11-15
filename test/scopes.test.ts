// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_HEIGHT, IMAGE_WIDTH, ImageSampler, SCOPE_SIZE } from '../src/image.js';
import { chromaPosition, parseHex, zebraMask, ZEBRA_LEVEL } from '../src/scopes.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function sampler(pixels: number[]): ImageSampler {
  const context = {
    clearRect: () => undefined,
    drawImage: () => undefined,
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i++) data[i] = pixels[i % pixels.length];
      return { data };
    }
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
  const source = document.createElement('canvas');
  source.width = 64;
  source.height = 64;
  const result = new ImageSampler();
  result.capture(source);
  return result;
}

describe('parseHex', () => {
  it('reads long and short hex colours, and falls back to the ink', () => {
    expect(parseHex('#ff8000')).toEqual([255, 128, 0]);
    expect(parseHex(' #0f0 ')).toEqual([0, 255, 0]);
    expect(parseHex('rebeccapurple')).toEqual([0xf4, 0xf4, 0xf1]);
  });
});

describe('vectorscope data', () => {
  it('puts greys in the centre and primaries on their own side', () => {
    expect(chromaPosition(128, 128, 128)).toEqual([0.5, 0.5]);
    const [redX, redY] = chromaPosition(255, 0, 0);
    const [blueX, blueY] = chromaPosition(0, 0, 255);
    expect(redY).toBeCloseTo(1);
    expect(redX).toBeLessThan(0.5);
    expect(blueX).toBeCloseTo(1);
    expect(blueY).toBeLessThan(0.5);
  });

  it('bins a grey image in the middle with no saturation', () => {
    const grey = sampler([120, 120, 120, 255]);
    const centre = (SCOPE_SIZE / 2) * SCOPE_SIZE + SCOPE_SIZE / 2;
    expect(grey.scope[centre]).toBe(IMAGE_WIDTH * IMAGE_HEIGHT);
    expect(grey.saturation).toBe(0);
    expect(grey.lumaMin).toBe(120);
    expect(grey.lumaMax).toBe(120);
  });

  it('measures saturation and the luma range of a coloured image', () => {
    const mixed = sampler([255, 0, 0, 255, 20, 20, 20, 255]);
    expect(mixed.saturation).toBeGreaterThan(0.2);
    expect(mixed.lumaMin).toBe(20);
    expect(mixed.lumaMax).toBe(54);
    // Pure red: top row (Cr at its maximum).
    let top = 0;
    for (let x = 0; x < SCOPE_SIZE; x++) top += mixed.scope[x];
    expect(top).toBe(IMAGE_WIDTH * IMAGE_HEIGHT / 2);
  });

  it('shares one copy between the panels of a refresh', () => {
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: () => undefined, drawImage: draw, getImageData: () => ({ data: new Uint8ClampedArray(IMAGE_WIDTH * IMAGE_HEIGHT * 4) }) } as never);
    const source = document.createElement('canvas');
    source.width = 8;
    source.height = 8;
    const shared = new ImageSampler();
    shared.capture(source);
    shared.capture(source);
    shared.capture(source);
    expect(draw).toHaveBeenCalledTimes(1);
  });
});

describe('zebraMask', () => {
  it('stripes only the clipped, opaque pixels and counts them', () => {
    const pixels = new Uint8ClampedArray(IMAGE_WIDTH * IMAGE_HEIGHT * 4);
    // First row: clipped white. Second row: just under the level. Third: clipped but transparent.
    for (let x = 0; x < IMAGE_WIDTH; x++) {
      pixels.set([255, 255, 255, 255], x * 4);
      pixels.set([ZEBRA_LEVEL - 1, 10, 10, 255], (IMAGE_WIDTH + x) * 4);
      pixels.set([255, 255, 255, 0], (IMAGE_WIDTH * 2 + x) * 4);
    }

    const out = new Uint8ClampedArray(pixels.length).fill(9);
    expect(zebraMask(pixels, out, 0)).toBe(IMAGE_WIDTH);
    // Stripes: two dark, two light.
    expect([out[0], out[4], out[8], out[12]]).toEqual([0, 0, 244, 244]);
    expect(out[3]).toBeGreaterThan(0);
    expect(out[IMAGE_WIDTH * 4 + 3]).toBe(0);
    expect(out[IMAGE_WIDTH * 2 * 4 + 3]).toBe(0);
    // The stripes move with the phase.
    zebraMask(pixels, out, 2);
    expect(out[0]).toBe(244);
  });
});
