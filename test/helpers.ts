/** Shared fixtures for the tests: a fake renderer, a Canvas 2D stub and small assertions. */

import type { StatsRenderer } from '../src/sampler.js';

export const BUDGET = 1000 / 60;

export interface FakeRenderer extends StatsRenderer {
  info: StatsRenderer['info'] & { resets: number };
}

/** A renderer with the shape the overlay reads and no GPU: WebGL by default, WebGPU with `webgpu`. */
export function fakeRenderer(options: { webgpu?: boolean; canvas?: HTMLCanvasElement; programs?: unknown[] } = {}): FakeRenderer {
  const info = {
    autoReset: true,
    resets: 0,
    render: { calls: 0, drawCalls: 0, frameCalls: 0, triangles: 0, points: 0, lines: 0 },
    memory: { geometries: 0, textures: 0 },
    programs: options.webgpu === true ? undefined : (options.programs ?? []),
    reset: (): void => {
      info.resets++;
      info.render.calls = 0;
      info.render.drawCalls = 0;
      info.render.frameCalls = 0;
      info.render.triangles = 0;
    }
  };
  const canvas = options.canvas ?? ({ width: 300, height: 150, clientWidth: 300, clientHeight: 150 } as unknown as HTMLCanvasElement);
  return {
    domElement: canvas,
    info,
    isWebGPURenderer: options.webgpu === true ? true : undefined,
    backend: options.webgpu === true ? { isWebGPUBackend: true } : undefined,
    getPixelRatio: () => 1
  } as FakeRenderer;
}

/**
 * happy-dom has no Canvas 2D: a context whose every method is a no-op is enough for the overlay's
 * graphs (their drawing is covered by the pure column and rect tests). Returns the restore function.
 */
export function stubCanvas2d(): () => void {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- restored onto the same prototype.
  const original = HTMLCanvasElement.prototype.getContext;
  const contexts = new WeakMap<HTMLCanvasElement, unknown>();
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, type: string): unknown {
    if (type !== '2d') return null;
    let context = contexts.get(this);
    if (context === undefined) {
      const state: Record<string | symbol, unknown> = { canvas: this };
      context = new Proxy(state, {
        get: (target, key) => {
          if (key in target) return target[key];
          if (key === 'measureText') return () => ({ width: 0 });
          if (key === 'createImageData') return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
          if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
          return () => undefined;
        },
        set: (target, key, value) => {
          target[key] = value;
          return true;
        }
      });
      contexts.set(this, context);
    }

    return context;
  } as typeof original;
  return () => {
    HTMLCanvasElement.prototype.getContext = original;
  };
}

/** The value, or a test failure naming what was missing (instead of a non-null assertion). */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}
