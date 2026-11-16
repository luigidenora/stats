/**
 * The production stand-in for `Stats` (see dev.ts): the same public surface, nothing behind it.
 * It never touches the renderer, the DOM tree or the frame.
 */

import type { Budgets, DeviceProfile } from './budgets.js';
import type { Pressure } from './pressure.js';
import type { StatsReport } from './recorder.js';
import type { StatsSnapshot } from './snapshot.js';
import type { Stats as RealStats } from './stats.js';
import type { StatsMode } from './types.js';

/** The desktop profile, copied so this file shares no code with the overlay. */
const BUDGETS: Readonly<Budgets> = { calls: 1000, triangles: 3_000_000, pixelRatio: 2, textureMB: 512, lights: 8, shadowLights: 3, shadowMapSize: 4096 };

/** Every public member of the real class must exist here: a member added there fails this at compile time. */
type PublicKeys = Record<keyof RealStats, unknown>;

class NoopStats implements PublicKeys {
  public mode: StatsMode = 'off';
  public scene = null;
  private _element: HTMLElement | null = null;

  public get modes(): readonly { id: StatsMode; name: string; code: string; description: string }[] { return []; }
  public get profile(): DeviceProfile { return 'desktop'; }
  public get budgets(): Readonly<Budgets> { return BUDGETS; }
  public get pressure(): Pressure { return 'ok'; }
  public get recording(): boolean { return false; }
  public get report(): StatsReport | null { return null; }
  /** A detached element, so code that styles or places `stats.element` keeps working. */
  public get element(): HTMLElement {
    this._element ??= document.createElement('div');
    return this._element;
  }

  public begin(): void {}
  public end(): void {}
  public mark(): this { return this; }
  public event(): this { return this; }
  public defineMode(): this { return this; }
  public extendMode(): this { return this; }
  public addMetric(): this { return this; }
  public removeMetric(): this { return this; }
  public addControl(): this { return this; }
  public setControl(): this { return this; }
  public removeControl(): this { return this; }
  public startRecording(): this { return this; }
  public stopRecording(): StatsReport | null { return null; }
  public dispose(): void {}

  public snapshot(): StatsSnapshot {
    return {
      version: 2, mode: 'off', backend: 'webgl', profile: 'desktop', budget: 1000 / 60, budgets: { ...BUDGETS },
      frame: { fps: null, cpu: null, gpu: null, heap: null }, pacing: null, segments: {},
      counters: { calls: 0, triangles: 0, points: 0, lines: 0, geometries: 0, textures: 0, programs: null, passes: null },
      canvas: { width: 0, height: 0, cssWidth: 0, cssHeight: 0, pixelRatio: null },
      pressure: 'ok', scene: null, recording: false, report: null
    };
  }
}

export const Stats = NoopStats as unknown as typeof RealStats;
