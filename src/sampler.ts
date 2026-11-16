/**
 * Frame sampling: CPU time, frame interval, GPU time and renderer counters.
 *
 * Works with `WebGLRenderer` and `WebGPURenderer` through a structural type, so the
 * package never imports a renderer at runtime.
 *
 * Read-only by default: it reads `renderer.info` as the app leaves it and never changes the
 * renderer, the scene or `info.autoReset`. Two things are opt-in or opt-out, and documented:
 * `countAllPasses` (switches autoReset off to sum every render() of a frame) and `gpuTimer`
 * (timer queries on the app's WebGL context, or WebGPU timestamp resolves).
 */

import { warnOnce } from './custom.js';

/** Name of the CPU segment from begin() to the first mark(). */
export const FIRST_SEGMENT = 'logic';
/** Named CPU segments a frame may have, the first one included: each takes a row on screen. */
export const MAX_SEGMENTS = 4;

interface InfoLike {
  autoReset: boolean;
  reset: () => void;
  render: { calls?: number; drawCalls?: number; frameCalls?: number; triangles: number; points: number; lines: number };
  memory: { geometries: number; textures: number; programs?: number };
  programs?: readonly unknown[] | null;
}

/** The subset of a three.js renderer the overlay reads. */
export interface StatsRenderer {
  domElement: HTMLCanvasElement;
  info: InfoLike;
  isWebGPURenderer?: boolean;
  /** WebGPURenderer backend; read through `BackendFlags`. */
  backend?: object;
  getContext?: () => unknown;
  getPixelRatio?: () => number;
  outputColorSpace?: string;
  toneMapping?: number;
  shadowMap?: { enabled: boolean };
  resolveTimestampsAsync?: (type?: 'render' | 'compute') => Promise<number | undefined>;
}

/** Flags read from a WebGPURenderer backend. */
interface BackendFlags {
  isWebGPUBackend?: boolean;
  trackTimestamp?: boolean;
}

function backendFlags(renderer: StatsRenderer): BackendFlags {
  return (renderer.backend ?? {});
}

export type BackendKind = 'webgl' | 'webgpu' | 'webgpu-webgl';

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

const TIMER_EXTENSION = 'EXT_disjoint_timer_query_webgl2';

/** WebGL 2 GPU timer through EXT_disjoint_timer_query_webgl2. Results arrive a few frames late. */
class WebGLTimer {
  private readonly _pending: WebGLQuery[] = [];
  private _active: WebGLQuery | null = null;
  private _sum = 0;
  private _count = 0;

  /** Called with each resolved GPU time, in ms. */
  public onSample: ((ms: number) => void) | null = null;

  /** The context was lost: its extensions must be asked for again once it is back. */
  private _lost = false;

  private constructor(private readonly _gl: WebGL2RenderingContext, private _ext: TimerExt | null) {}

  public static create(renderer: StatsRenderer): WebGLTimer | null {
    const gl = renderer.getContext?.() as Partial<WebGL2RenderingContext> | undefined;
    if (gl?.createQuery === undefined || gl.getExtension === undefined || gl.isContextLost === undefined) return null;
    const ext = gl.getExtension(TIMER_EXTENSION) as TimerExt | null;
    return ext === null ? null : new WebGLTimer(gl as WebGL2RenderingContext, ext);
  }

  public begin(): void {
    // A lost context invalidates every query: drop them and wait for the restore.
    if (this._gl.isContextLost()) {
      this._pending.length = 0;
      this._active = null;
      this._lost = true;
      return;
    }

    // A restored context starts without extensions: ask again (null leaves the timer off).
    if (this._lost) {
      this._lost = false;
      this._ext = this._gl.getExtension(TIMER_EXTENSION) as TimerExt | null;
    }

    if (this._ext === null || this._active !== null || this._pending.length > 8) return;
    // The app's own timer query is running: one of this kind may be active at a time, so this
    // frame goes unmeasured rather than breaking the app's query.
    if (this._gl.getQuery(this._ext.TIME_ELAPSED_EXT, this._gl.CURRENT_QUERY) !== null) return;
    // Typed non-null, but some engines return null while the context is lost.
    const query = this._gl.createQuery() as WebGLQuery | null;
    if (query === null) return;
    this._active = query;
    this._gl.beginQuery(this._ext.TIME_ELAPSED_EXT, query);
  }

  public end(): void {
    if (this._ext === null || this._gl.isContextLost()) return;
    if (this._active !== null) {
      this._gl.endQuery(this._ext.TIME_ELAPSED_EXT);
      this._pending.push(this._active);
      this._active = null;
    }

    this.poll();
  }

  /** Averages the GPU time of the queries resolved since the last call. */
  public take(): number | null {
    const value = this._count > 0 ? this._sum / this._count : null;
    this._sum = 0;
    this._count = 0;
    return value;
  }

  public dispose(): void {
    if (this._ext === null || this._gl.isContextLost()) {
      this._pending.length = 0;
      this._active = null;
      return;
    }

    if (this._active !== null) {
      this._gl.endQuery(this._ext.TIME_ELAPSED_EXT);
      this._gl.deleteQuery(this._active);
      this._active = null;
    }

    for (let i = 0, l = this._pending.length; i < l; i++) this._gl.deleteQuery(this._pending[i]);
    this._pending.length = 0;
  }

  private poll(): void {
    const gl = this._gl;
    if (this._ext === null) return;
    const disjoint = gl.getParameter(this._ext.GPU_DISJOINT_EXT) as boolean;

    while (this._pending.length > 0) {
      const query = this._pending[0];
      if (!(gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean)) break;
      if (!disjoint) {
        const ms = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6;
        this._sum += ms;
        this._count++;
        this.onSample?.(ms);
      }

      gl.deleteQuery(query);
      this._pending.shift();
    }
  }
}

export interface FrameWindow {
  fps: number | null;
  cpu: number | null;
  gpu: number | null;
}

export interface SamplerOptions {
  /**
   * Sum every render() of a frame (post-processing, several views) by switching
   * `renderer.info.autoReset` off and resetting it in begin(); restored on dispose. Off by default:
   * the counters then show what `renderer.info` shows, the last render() of the frame.
   */
  countAllPasses?: boolean;
  /** Measure GPU time (WebGL timer queries, WebGPU timestamp resolves). Default true. */
  gpuTimer?: boolean;
}

export class FrameSampler {
  public readonly backend: BackendKind;
  /** Interval between the last two frames, in ms. */
  public lastInterval = 0;
  /** CPU time of the last frame, in ms. */
  public lastCpu = 0;

  private readonly _renderer: StatsRenderer;
  private readonly _infoAutoReset: boolean;
  private readonly _timer: WebGLTimer | null;
  private _frameStart = 0;
  private _lastBegin = 0;
  private _windowStart = performance.now();
  private _frames = 0;
  private _cpuSum = 0;
  private _gpuLatest: number | null = null;
  private _resolving = false;
  private _onGpuSample: ((ms: number) => void) | null = null;
  private _inFrame = false;
  /** Open CPU segment of the current frame, or null before the first mark(). */
  private _segment: string | null = null;
  private _segmentStart = 0;
  /** CPU time per segment summed over the window, and the averages of the last closed window. */
  private readonly _segmentSums = new Map<string, number>();
  private readonly _segmentAverages = new Map<string, number>();
  private _programs: number | null = null;
  /**
   * The next frame only opens the averaging window (at its end): the first frame, and the first
   * after pause(). Frames are then counted end to end, so neither the wait before the first frame
   * nor a hidden-tab gap is averaged into the frame rate.
   */
  private _resume = true;

  /** Called once per segment name, the first time it has a measured duration. */
  public onSegment: ((name: string) => void) | null = null;
  /** The last frame created at least one new shader program. */
  public compiled = false;

  private readonly _countAllPasses: boolean;
  private readonly _gpuTimer: boolean;

  constructor(renderer: StatsRenderer, options: SamplerOptions = {}) {
    this._renderer = renderer;
    this.backend = detectBackend(renderer);
    this._countAllPasses = options.countAllPasses === true;
    this._gpuTimer = options.gpuTimer !== false;
    this._timer = !this._gpuTimer || renderer.isWebGPURenderer === true ? null : WebGLTimer.create(renderer);
    this._infoAutoReset = renderer.info.autoReset;
    // Opt-in only: the one change to the renderer the overlay can make, undone on dispose.
    if (this._countAllPasses) renderer.info.autoReset = false;
  }

  /** Receives every GPU time sample as it resolves (per frame on WebGL, per refresh on WebGPU). */
  public set onGpuSample(callback: ((ms: number) => void) | null) {
    this._onGpuSample = callback;
    if (this._timer !== null) this._timer.onSample = callback;
  }

  /** GPU time is measurable on this renderer and browser. */
  public get hasGpuTimer(): boolean {
    return this._timer !== null || (this._gpuTimer && backendFlags(this._renderer).trackTimestamp === true);
  }

  public begin(): void {
    const now = performance.now();
    // After a pause (see pause()) the first interval is unknown, not seconds long.
    this.lastInterval = this._lastBegin > 0 ? now - this._lastBegin : 0;
    this._lastBegin = now;
    this._frameStart = now;
    this._inFrame = true;
    this._segment = null;
    if (this._countAllPasses) this._renderer.info.reset();
    this._timer?.begin();
  }

  /**
   * Closes the current CPU segment and opens `name`. The time from begin() to the first mark is
   * the 'logic' segment; the last segment ends at end(). Total CPU time stays begin() to end().
   */
  public mark(name: string): void {
    if (!this._inFrame) {
      warnOnce(`mark("${name}") was called outside begin() / end() and is ignored.`);
      return;
    }

    if (typeof name !== 'string' || name === '' || name === FIRST_SEGMENT) {
      warnOnce(`mark() needs a non-empty name other than "${FIRST_SEGMENT}" (that is the segment before the first mark).`);
      return;
    }

    const now = performance.now();
    this.closeSegment(this._segment ?? FIRST_SEGMENT, this._segment === null ? this._frameStart : this._segmentStart, now);
    this._segment = name;
    this._segmentStart = now;
  }

  public end(): void {
    this._timer?.end();
    const now = performance.now();
    this.lastCpu = now - this._frameStart;
    if (this._segment !== null) this.closeSegment(this._segment, this._segmentStart, now);
    this._inFrame = false;
    this._cpuSum += this.lastCpu;
    this._frames++;
    if (this._resume) {
      this._resume = false;
      this.resetWindow(now);
    }

    const programs = this.programs;
    this.compiled = programs !== null && this._programs !== null && programs > this._programs;
    this._programs = programs;
  }

  /** Forgets the last frame time, e.g. while the tab is hidden and frames stop. */
  public pause(): void {
    this._lastBegin = 0;
    this._resume = true;
  }

  /** Average CPU time of segment `name` over the last refresh window, in ms, or null when unknown. */
  public segment(name: string): number | null {
    return this._segmentAverages.get(name) ?? null;
  }

  /** Closes the current sampling window and returns its averages. */
  public take(): FrameWindow {
    const now = performance.now();
    const elapsed = now - this._windowStart;
    const frames = this._frames;
    const result: FrameWindow = {
      fps: frames > 0 && elapsed > 0 ? (frames * 1000) / elapsed : null,
      cpu: frames > 0 ? this._cpuSum / frames : null,
      gpu: this.takeGpu()
    };

    // Segments average over every frame of the window, so they add up to the CPU readout.
    const names = Array.from(this._segmentSums.keys());
    for (let i = 0, l = names.length; i < l; i++) {
      this._segmentAverages.set(names[i], frames > 0 ? (this._segmentSums.get(names[i]) ?? 0) / frames : 0);
    }

    this.resetWindow(now);
    return result;
  }

  private resetWindow(now: number): void {
    this._windowStart = now;
    this._frames = 0;
    this._cpuSum = 0;
    const names = Array.from(this._segmentSums.keys());
    for (let i = 0, l = names.length; i < l; i++) this._segmentSums.set(names[i], 0);
  }

  public get calls(): number {
    const render = this._renderer.info.render;
    return (this._renderer.isWebGPURenderer === true ? render.drawCalls : render.calls) ?? 0;
  }

  public get triangles(): number { return this._renderer.info.render.triangles; }
  /** Render passes in the last frame (WebGPU only: `render()` calls between resets). */
  public get passes(): number | null {
    return this._renderer.isWebGPURenderer === true ? (this._renderer.info.render.frameCalls ?? null) : null;
  }

  public get points(): number { return this._renderer.info.render.points; }
  public get lines(): number { return this._renderer.info.render.lines; }
  public get geometries(): number { return this._renderer.info.memory.geometries; }
  public get textures(): number { return this._renderer.info.memory.textures; }

  public get programs(): number | null {
    const info = this._renderer.info;
    if (info.programs !== undefined && info.programs !== null) return info.programs.length;
    return info.memory.programs ?? null;
  }

  /** Used JS heap in MB, where the browser exposes it (Chromium). */
  public get heap(): number | null {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return memory === undefined ? null : memory.usedJSHeapSize / 1048576;
  }

  public dispose(): void {
    this._timer?.dispose();
    if (this._countAllPasses) this._renderer.info.autoReset = this._infoAutoReset;
  }

  private closeSegment(name: string, start: number, now: number): void {
    const sum = this._segmentSums.get(name);
    if (sum !== undefined) {
      this._segmentSums.set(name, sum + now - start);
      return;
    }

    // A mark right after begin() leaves an empty first segment: it gets no row until it has time.
    if (name === FIRST_SEGMENT && now - start <= 0) return;
    if (this._segmentSums.size >= MAX_SEGMENTS) {
      warnOnce(`at most ${MAX_SEGMENTS} CPU segments are shown; "${name}" is ignored.`);
      return;
    }

    this._segmentSums.set(name, now - start);
    this.onSegment?.(name);
  }

  private takeGpu(): number | null {
    if (this._timer !== null) return this._timer.take();
    const renderer = this._renderer;
    if (!this._gpuTimer || backendFlags(renderer).trackTimestamp !== true || renderer.resolveTimestampsAsync === undefined) return null;

    // WebGPU timestamps resolve asynchronously: show the latest value, request the next one.
    if (!this._resolving) {
      this._resolving = true;
      renderer.resolveTimestampsAsync('render').then((ms) => {
        this._gpuLatest = ms ?? null;
        if (ms !== undefined) this._onGpuSample?.(ms);
      }).catch(() => {
        this._gpuLatest = null;
      }).finally(() => {
        this._resolving = false;
      });
    }

    return this._gpuLatest;
  }
}

function detectBackend(renderer: StatsRenderer): BackendKind {
  if (renderer.isWebGPURenderer !== true) return 'webgl';
  return backendFlags(renderer).isWebGPUBackend === true ? 'webgpu' : 'webgpu-webgl';
}
