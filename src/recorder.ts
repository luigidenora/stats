/**
 * Session recording: every frame between start and stop, summarised into a report that can be
 * compared with another run or asserted in a test. Averages hide stutter, so the report leads with
 * percentiles and the "1% low" frame rate (the mean of the slowest 1% of frames).
 */

import type { DeviceProfile } from './budgets.js';
import { missedRefreshes } from './frame-stats.js';
import type { BackendKind } from './sampler.js';

/** Frames kept: 10 minutes at 240 Hz. A longer recording stops by itself. */
export const MAX_RECORDED_FRAMES = 144_000;
const GAP_MS = 1000;

export interface MemoryCounters {
  geometries: number;
  textures: number;
  programs: number | null;
  /** JS heap in MB, where the browser exposes it. */
  heap: number | null;
}

export interface StatsReport {
  /** Seconds of frames recorded; pauses (a hidden tab) are not counted. */
  duration: number;
  frames: number;
  fps: {
    average: number;
    /** Frame rate of the slowest 1% of frames: what stutter feels like. */
    low1: number;
  };
  /** Frame time, in ms. */
  frame: { average: number; p50: number; p95: number; p99: number; worst: number };
  /** Screen refreshes missed, by the frame graph's rule. */
  dropped: number;
  /** CPU time per frame, in ms. */
  cpu: { average: number; p95: number; worst: number };
  /** GPU time per frame, in ms, or null without a GPU timer. */
  gpu: { average: number; worst: number } | null;
  calls: { average: number; max: number };
  triangles: { average: number; max: number };
  memory: { start: MemoryCounters; end: MemoryCounters };
  /** Named events (see `stats.event()`), with their time in seconds from the start. */
  events: { name: string; at: number }[];
  /** Ids of the diagnostics that were active at some point. */
  findings: string[];
  /** Frame budget in ms, device profile and backend the numbers belong to. */
  budget: number;
  profile: DeviceProfile;
  backend: BackendKind;
}

export interface ReportContext {
  budget: number;
  profile: DeviceProfile;
  backend: BackendKind;
}

function percentile(sorted: Float32Array, share: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)];
}

export class Recorder {
  private _intervals = new Float32Array(4096);
  private _cpu = new Float32Array(4096);
  private _frames = 0;
  private _elapsed = 0;
  private _gpuSum = 0;
  private _gpuCount = 0;
  private _gpuWorst = 0;
  private _callsSum = 0;
  private _callsMax = 0;
  private _trianglesSum = 0;
  private _trianglesMax = 0;
  private readonly _events: { name: string; at: number }[] = [];
  private readonly _findings = new Set<string>();

  constructor(private readonly _start: MemoryCounters) {}

  /** True when no more frames fit: the recording should stop. */
  public get full(): boolean { return this._frames >= MAX_RECORDED_FRAMES; }

  /** Adds one frame. Gaps (the first frame, a hidden tab) and invalid intervals are skipped. */
  public frame(interval: number, cpu: number, calls: number, triangles: number): void {
    if (!(interval > 0) || interval >= GAP_MS || this.full) return;
    if (this._frames === this._intervals.length) {
      this._intervals = grow(this._intervals);
      this._cpu = grow(this._cpu);
    }

    this._intervals[this._frames] = interval;
    this._cpu[this._frames] = cpu;
    this._frames++;
    this._elapsed += interval;
    this._callsSum += calls;
    this._callsMax = Math.max(this._callsMax, calls);
    this._trianglesSum += triangles;
    this._trianglesMax = Math.max(this._trianglesMax, triangles);
  }

  /** Adds one resolved GPU time, in ms. */
  public gpu(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this._gpuSum += ms;
    this._gpuCount++;
    this._gpuWorst = Math.max(this._gpuWorst, ms);
  }

  public event(name: string): void {
    if (this._events.length < 1000) this._events.push({ name, at: this._elapsed / 1000 });
  }

  public findings(ids: readonly string[]): void {
    for (let i = 0, l = ids.length; i < l; i++) this._findings.add(ids[i]);
  }

  /** The report of what was recorded, or null when no frame was. */
  public finish(end: MemoryCounters, context: ReportContext): StatsReport | null {
    const frames = this._frames;
    if (frames === 0) return null;
    const intervals = this._intervals.slice(0, frames).sort();
    const cpu = this._cpu.slice(0, frames).sort();
    let dropped = 0;
    let cpuSum = 0;
    for (let i = 0; i < frames; i++) {
      dropped += missedRefreshes(intervals[i], context.budget);
      cpuSum += cpu[i];
    }

    // The slowest 1% of frames, at least one.
    const slow = Math.max(1, Math.round(frames * 0.01));
    let slowSum = 0;
    for (let i = frames - slow; i < frames; i++) slowSum += intervals[i];
    const average = this._elapsed / frames;
    return {
      duration: this._elapsed / 1000,
      frames,
      fps: { average: 1000 / average, low1: 1000 / (slowSum / slow) },
      frame: { average, p50: percentile(intervals, 0.5), p95: percentile(intervals, 0.95), p99: percentile(intervals, 0.99), worst: intervals[frames - 1] },
      dropped,
      cpu: { average: cpuSum / frames, p95: percentile(cpu, 0.95), worst: cpu[frames - 1] },
      gpu: this._gpuCount > 0 ? { average: this._gpuSum / this._gpuCount, worst: this._gpuWorst } : null,
      calls: { average: this._callsSum / frames, max: this._callsMax },
      triangles: { average: this._trianglesSum / frames, max: this._trianglesMax },
      memory: { start: this._start, end },
      events: this._events.slice(),
      findings: Array.from(this._findings),
      budget: context.budget,
      profile: context.profile,
      backend: context.backend
    };
  }
}

function grow(values: Float32Array): Float32Array<ArrayBuffer> {
  const next = new Float32Array(Math.min(MAX_RECORDED_FRAMES, values.length * 2));
  next.set(values);
  return next;
}
