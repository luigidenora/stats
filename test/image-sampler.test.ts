// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageSampler } from '../examples/image-sampler.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A 2D context whose getImageData returns `pixels` (RGBA, repeated to fill the frame). */
function mockContext(pixels: number[]): { clearRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> } {
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i++) data[i] = pixels[i % pixels.length];
      return { data };
    }
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
  return context;
}

function source(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 50;
  return canvas;
}

describe('ImageSampler', () => {
  it('bins every channel and measures clipping', () => {
    // Half white, half black.
    mockContext([255, 255, 255, 255, 0, 0, 0, 255]);
    const sampler = new ImageSampler();
    expect(sampler.capture(source())).toBe(true);
    expect(sampler.red[255]).toBe(sampler.red[0]);
    expect(sampler.clippedHigh).toBeCloseTo(0.5);
    expect(sampler.clippedLow).toBeCloseTo(0.5);
    expect(sampler.luma[255] + sampler.luma[0]).toBe(256 * 144);
  });

  it('ignores fully transparent pixels instead of counting them as crushed blacks', () => {
    // A transparent canvas over the page: three transparent pixels for one mid grey.
    mockContext([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 128, 128, 255]);
    const sampler = new ImageSampler();
    sampler.capture(source());
    expect(sampler.clippedLow).toBe(0);
    expect(sampler.red[0]).toBe(0);
    expect(sampler.red[128]).toBe(256 * 144 / 4);
  });

  it('clears the previous capture so transparent areas do not keep old frames', () => {
    const context = mockContext([10, 20, 30, 255]);
    const sampler = new ImageSampler();
    sampler.capture(source());
    expect(context.clearRect).toHaveBeenCalled();
    expect(context.clearRect.mock.invocationCallOrder[0]).toBeLessThan(context.drawImage.mock.invocationCallOrder[0]);
  });

  it('refuses empty sources and tainted canvases', () => {
    const context = mockContext([0, 0, 0, 255]);
    const sampler = new ImageSampler();
    const empty = document.createElement('canvas');
    empty.width = 0;
    expect(sampler.capture(empty)).toBe(false);
    context.drawImage.mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(sampler.capture(source())).toBe(false);
    expect(sampler.valid).toBe(false);
  });
});
