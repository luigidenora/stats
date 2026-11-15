import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameSampler, MAX_SEGMENTS, type StatsRenderer } from '../src/sampler.js';
import { fakeRenderer } from './helpers.js';

let now = 0;

beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** One frame: `cpu` ms of work, then the rest of `interval` idle. */
function frame(sampler: FrameSampler, cpu: number, interval: number, work?: () => void): void {
  sampler.begin();
  work?.();
  now += cpu;
  sampler.end();
  now += interval - cpu;
}

/** Runs `count` frames and closes the window at the end of the last one, as Stats.end() does. */
function runWindow(sampler: FrameSampler, count: number, cpu: (i: number) => number, interval: number): ReturnType<FrameSampler['take']> {
  let result: ReturnType<FrameSampler['take']> = { fps: null, cpu: null, gpu: null };
  for (let i = 0; i < count; i++) {
    sampler.begin();
    now += cpu(i);
    sampler.end();
    if (i === count - 1) result = sampler.take();
    now += interval - cpu(i);
  }

  return result;
}

describe('FrameSampler', () => {
  it('takes over info.autoReset so every pass of a frame counts, and gives it back', () => {
    const renderer = fakeRenderer();
    const sampler = new FrameSampler(renderer);
    expect(renderer.info.autoReset).toBe(false);
    frame(sampler, 2, 16);
    expect(renderer.info.resets).toBe(1);
    sampler.dispose();
    expect(renderer.info.autoReset).toBe(true);
  });

  it('measures intervals between frames, unknown for the first one and after a pause', () => {
    const sampler = new FrameSampler(fakeRenderer());
    frame(sampler, 2, 16);
    expect(sampler.lastInterval).toBe(0);
    frame(sampler, 2, 20);
    expect(sampler.lastInterval).toBe(16);
    expect(sampler.lastCpu).toBe(2);
    sampler.pause();
    now += 5000;
    frame(sampler, 2, 16);
    expect(sampler.lastInterval).toBe(0);
  });

  it('averages fps and cpu over the window and starts a new one on take()', () => {
    const sampler = new FrameSampler(fakeRenderer());
    expect(sampler.take()).toEqual({ fps: null, cpu: null, gpu: null });
    const averages = runWindow(sampler, 10, (i) => (i % 2 === 0 ? 2 : 4), 20);
    // The first frame only opens the window: frames 2 to 10 are averaged, end to end.
    expect(averages.fps).toBeCloseTo(9000 / (9 * 20 + 2));
    expect(averages.cpu).toBeCloseTo(28 / 9);
    expect(sampler.take().cpu).toBeNull();
  });

  it('does not count the wait before the first frame, or a pause, in the frame rate', () => {
    const sampler = new FrameSampler(fakeRenderer());
    now += 500;
    expect(runWindow(sampler, 16, () => 2, 1000 / 60).fps).toBeCloseTo(60, 5);
    sampler.pause();
    now += 5000;
    // One frame after the pause is not a rate yet.
    expect(runWindow(sampler, 1, () => 2, 1000 / 60).fps).toBeNull();
    expect(runWindow(sampler, 15, () => 2, 1000 / 60).fps).toBeCloseTo(60, 5);
  });

  it('splits the CPU time into segments that add up to the frame', () => {
    const sampler = new FrameSampler(fakeRenderer());
    const seen: string[] = [];
    sampler.onSegment = (name) => seen.push(name);
    for (let i = 0; i < 4; i++) {
      frame(sampler, 0, 16, () => {
        now += 1;
        sampler.mark('physics');
        now += 2;
        sampler.mark('render');
        now += 3;
      });
    }

    const window = sampler.take();
    expect(seen).toEqual(['logic', 'physics', 'render']);
    expect(sampler.segment('logic')).toBeCloseTo(1);
    expect(sampler.segment('physics')).toBeCloseTo(2);
    expect(sampler.segment('render')).toBeCloseTo(3);
    expect(window.cpu).toBeCloseTo(6);
    expect(sampler.segment('missing')).toBeNull();
  });

  it('gives no row to an empty first segment', () => {
    const sampler = new FrameSampler(fakeRenderer());
    const seen: string[] = [];
    sampler.onSegment = (name) => seen.push(name);
    frame(sampler, 0, 16, () => {
      sampler.mark('render');
      now += 3;
    });
    expect(seen).toEqual(['render']);
  });

  it('warns and ignores marks outside a frame, reserved names and segments past the limit', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sampler = new FrameSampler(fakeRenderer());
    const seen: string[] = [];
    sampler.onSegment = (name) => seen.push(name);
    sampler.mark('outside');
    frame(sampler, 0, 16, () => {
      now += 1;
      sampler.mark('logic');
      sampler.mark('');
      for (let i = 0; i < MAX_SEGMENTS + 2; i++) {
        sampler.mark(`s${i}`);
        now += 1;
      }
    });
    expect(seen).toHaveLength(MAX_SEGMENTS);
    expect(warn).toHaveBeenCalled();
  });

  it('flags the frames that created a shader program', () => {
    const programs: unknown[] = [{}];
    const sampler = new FrameSampler(fakeRenderer({ programs }));
    frame(sampler, 1, 16);
    expect(sampler.compiled).toBe(false);
    frame(sampler, 1, 16, () => programs.push({}));
    expect(sampler.compiled).toBe(true);
    frame(sampler, 1, 16);
    expect(sampler.compiled).toBe(false);
    expect(sampler.programs).toBe(2);
  });

  it('reads WebGL and WebGPU counters from their own fields', () => {
    const gl = fakeRenderer();
    const glSampler = new FrameSampler(gl);
    gl.info.render.calls = 12;
    gl.info.render.drawCalls = 99;
    expect(glSampler.backend).toBe('webgl');
    expect(glSampler.calls).toBe(12);
    expect(glSampler.passes).toBeNull();

    const gpu = fakeRenderer({ webgpu: true });
    const gpuSampler = new FrameSampler(gpu);
    gpu.info.render.drawCalls = 7;
    gpu.info.render.frameCalls = 3;
    expect(gpuSampler.backend).toBe('webgpu');
    expect(gpuSampler.calls).toBe(7);
    expect(gpuSampler.passes).toBe(3);
    expect(gpuSampler.programs).toBeNull();
    (gpu.info.memory as { programs?: number }).programs = 5;
    expect(gpuSampler.programs).toBe(5);
  });

  it('tells a WebGPURenderer on its WebGL fallback apart', () => {
    const renderer = fakeRenderer({ webgpu: true });
    renderer.backend = {};
    expect(new FrameSampler(renderer).backend).toBe('webgpu-webgl');
  });

  it('shows the latest resolved WebGPU timestamp and asks for one at a time', async () => {
    const renderer = fakeRenderer({ webgpu: true });
    renderer.backend = { isWebGPUBackend: true, trackTimestamp: true };
    let resolve: (ms: number | undefined) => void = () => undefined;
    const resolveTimestampsAsync = vi.fn(async () => new Promise<number | undefined>((done) => {
      resolve = done;
    }));
    renderer.resolveTimestampsAsync = resolveTimestampsAsync;
    const sampler = new FrameSampler(renderer);
    const samples: number[] = [];
    sampler.onGpuSample = (ms) => samples.push(ms);
    expect(sampler.hasGpuTimer).toBe(true);
    expect(sampler.take().gpu).toBeNull();
    expect(sampler.take().gpu).toBeNull();
    expect(resolveTimestampsAsync).toHaveBeenCalledTimes(1);
    resolve(4.5);
    await new Promise((done) => setTimeout(done, 0));
    expect(samples).toEqual([4.5]);
    expect(sampler.take().gpu).toBe(4.5);
    expect(resolveTimestampsAsync).toHaveBeenCalledTimes(2);
  });

  it('has no GPU time without a timer', () => {
    const sampler = new FrameSampler(fakeRenderer());
    expect(sampler.hasGpuTimer).toBe(false);
    frame(sampler, 1, 16);
    expect(sampler.take().gpu).toBeNull();
  });
});

describe('WebGL GPU timer', () => {
  interface Query { available: boolean; result: number; deleted: boolean }

  function timerRenderer(): { renderer: StatsRenderer; queries: Query[]; gl: { disjoint: boolean; lost: boolean; extensions: number; noExtension: boolean } } {
    const queries: Query[] = [];
    const gl = {
      disjoint: false,
      lost: false,
      isContextLost: (): boolean => gl.lost,
      QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
      createQuery: (): Query | null => {
        if (gl.lost) return null;
        const query = { available: false, result: 0, deleted: false };
        queries.push(query);
        return query;
      },
      beginQuery: (): void => undefined,
      endQuery: (): void => undefined,
      deleteQuery: (query: Query): void => {
        query.deleted = true;
      },
      getQueryParameter: (query: Query, name: number): unknown => (gl.lost ? null : name === 1 ? query.available : query.result),
      getParameter: (): boolean => gl.disjoint,
      extensions: 0,
      noExtension: false,
      getExtension: (name: string): unknown => {
        if (name !== 'EXT_disjoint_timer_query_webgl2' || gl.noExtension) return null;
        gl.extensions++;
        return { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 };
      }
    };
    const renderer = fakeRenderer();
    renderer.getContext = () => gl;
    return { renderer, queries, gl };
  }

  it('averages resolved queries and reports each one as it lands', () => {
    const { renderer, queries } = timerRenderer();
    const sampler = new FrameSampler(renderer);
    const samples: number[] = [];
    sampler.onGpuSample = (ms) => samples.push(ms);
    expect(sampler.hasGpuTimer).toBe(true);
    frame(sampler, 1, 16);
    frame(sampler, 1, 16);
    queries[0].available = true;
    queries[0].result = 2e6;
    queries[1].available = true;
    queries[1].result = 4e6;
    frame(sampler, 1, 16);
    expect(samples).toEqual([2, 4]);
    expect(sampler.take().gpu).toBe(3);
    expect(queries[0].deleted && queries[1].deleted).toBe(true);
    expect(sampler.take().gpu).toBeNull();
  });

  it('drops results measured across a disjoint event', () => {
    const { renderer, queries, gl } = timerRenderer();
    const sampler = new FrameSampler(renderer);
    frame(sampler, 1, 16);
    queries[0].available = true;
    queries[0].result = 9e6;
    gl.disjoint = true;
    frame(sampler, 1, 16);
    expect(sampler.take().gpu).toBeNull();
    expect(queries[0].deleted).toBe(true);
  });

  it('stops opening queries while too many are pending', () => {
    const { renderer, queries } = timerRenderer();
    const sampler = new FrameSampler(renderer);
    for (let i = 0; i < 20; i++) frame(sampler, 1, 16);
    expect(queries.length).toBeLessThanOrEqual(10);
  });

  it('deletes every query on dispose, the open one included', () => {
    const { renderer, queries } = timerRenderer();
    const sampler = new FrameSampler(renderer);
    frame(sampler, 1, 16);
    sampler.begin();
    sampler.dispose();
    expect(queries.every((query) => query.deleted)).toBe(true);
  });

  it('restarts the averaging window when frames resume after a pause', () => {
    const sampler = new FrameSampler(fakeRenderer());
    for (let i = 0; i < 5; i++) frame(sampler, 2, 1000 / 60);
    sampler.pause();
    now += 10_000;
    expect(runWindow(sampler, 30, () => 2, 1000 / 60).fps).toBeCloseTo(60, 5);
  });

  it('survives a context loss and measures again once it is restored', () => {
    const { renderer, queries, gl } = timerRenderer();
    const sampler = new FrameSampler(renderer);
    for (let i = 0; i < 5; i++) frame(sampler, 1, 16);
    gl.lost = true;
    expect(() => {
      for (let i = 0; i < 20; i++) frame(sampler, 1, 16);
    }).not.toThrow();
    gl.lost = false;
    const before = queries.length;
    frame(sampler, 1, 16);
    const fresh = queries[before];
    fresh.available = true;
    fresh.result = 5e6;
    frame(sampler, 1, 16);
    expect(sampler.take().gpu).toBe(5);
  });

  it('asks for the timer extension again after a context restore, and stays quiet if it is gone', () => {
    const { renderer, gl } = timerRenderer();
    const sampler = new FrameSampler(renderer);
    frame(sampler, 1, 16);
    expect(gl.extensions).toBe(1);
    gl.lost = true;
    frame(sampler, 1, 16);
    gl.lost = false;
    frame(sampler, 1, 16);
    expect(gl.extensions).toBe(2);
    gl.lost = true;
    frame(sampler, 1, 16);
    gl.lost = false;
    gl.noExtension = true;
    expect(() => {
      for (let i = 0; i < 5; i++) frame(sampler, 1, 16);
    }).not.toThrow();
    expect(sampler.take().gpu).toBeNull();
  });
});
