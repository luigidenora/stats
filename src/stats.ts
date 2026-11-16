import { resolveBudgets, type Budgets, type DeviceProfile } from './budgets.js';
import { warnOnce } from './custom.js';
import { formatCount, formatInt, formatMs, type Threshold } from './format.js';
import { FrameStats, type FramePacing } from './frame-stats.js';
import { surveyScene, type InfoScene, type SceneSurvey } from './scene-survey.js';
import { findMode, MODES } from './modes.js';
import { PressureMonitor, type Pressure } from './pressure.js';
import { Recorder, type MemoryCounters, type StatsReport } from './recorder.js';
import { summariseScene, type StatsSnapshot } from './snapshot.js';
import { Overlay, type FrameThresholds } from './overlay.js';
import type { ControlDefinition, ModeContent, ModeDefinition, StatsMetric, StatsMode } from './types.js';
import { FIRST_SEGMENT, FrameSampler, type StatsRenderer } from './sampler.js';

const STORAGE_KEY = 'tez-stats-mode';
/** The pressure signal is sampled once a second. */
const PRESSURE_MS = 1000;
/** A cached scene survey is reused for this long. */
const SURVEY_FRESH_MS = 2000;
/** The object counter walks the scene at most once a second. */
const COUNT_MS = 1000;
/** A survey waits at least this many times its own duration: at most 0.4% of the time, however large the scene. */
const SURVEY_COST_FACTOR = 250;

export interface StatsOptions {
  /** Scene for the object counter and the snapshot's scene survey. Optional. */
  scene?: InfoScene;
  /**
   * Display mode, cumulative: 'simple' (frame rate, CPU and GPU time), 'performance' (plus the heap
   * and the counters), 'graph' (plus the time graphs and the pacing rows), 'off', or a custom mode.
   * Default 'simple'. A mode picked with the mode plate is remembered across page loads and wins
   * over this option, unless `remember` is false.
   */
  mode?: StatsMode;
  /** Remember the mode picked with the mode plate across page loads (localStorage). Default true. */
  remember?: boolean;
  /** Frame budget in ms, used by the dials, the graph scales and default thresholds. Default 1000 / 60. */
  budget?: number;
  /** How often text values refresh, in ms. The graphs scroll every few frames. Default 250. */
  interval?: number;
  /** Frames per graph column: each column keeps the slowest of its frames, so the graphs scroll slower without hiding spikes. Default 3. */
  graphStep?: number;
  /** Overlay elements show a tooltip on hover and the mode plate is clickable (the canvas keeps its events elsewhere). False makes the overlay fully passive. Default true. */
  interactive?: boolean;
  /** Alert bounds for frame timing. Defaults: fps below 90% of the target rate, cpu and gpu above the budget. */
  thresholds?: FrameThresholds;
  /**
   * Turn off built-ins by id: the counters 'calls', 'triangles', 'points', 'lines', 'geometries',
   * 'textures', 'programs', 'objects', the Graph rows 'p95', 'worst', 'dropped', and the 'rec' plate.
   */
  exclude?: readonly string[];
  /** Extra metrics, added after the built-in ones. */
  metrics?: readonly StatsMetric[];
  /**
   * Device profile for the budgets (draw calls, triangles, textures, lights, shadows): 'mobile',
   * 'desktop' or 'auto' (a finger on a small screen, or a mobile browser, is 'mobile'). Default 'auto'.
   */
  profile?: 'auto' | DeviceProfile;
  /** Overrides single budgets of the profile, e.g. `{ calls: 500 }`. */
  budgets?: Partial<Budgets>;
  /**
   * Called when the frame runs out of room ('high') or has plenty ('low'), and again every 2 s
   * while it stays so: the hook for adaptive quality. See `pressure`.
   *
   * ```ts
   * onPressure: (pressure) => {
   *   if (pressure === 'high') renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.25));
   * }
   * ```
   */
  onPressure?: (pressure: Pressure) => void;
  /** Called with the report of every finished recording (the REC plate or `stopRecording()`). */
  onReport?: (report: StatsReport) => void;
  /**
   * Lists this instance in `globalThis.__THREE_EZ_STATS__`, so tools and agents driving the page
   * can call `__THREE_EZ_STATS__[0].snapshot()`. Default true.
   */
  expose?: boolean;
}

/** Name of the global array of live instances. */
export const GLOBAL_HOOK = '__THREE_EZ_STATS__';

/**
 * Statistics overlay for a three.js renderer.
 *
 * ```ts
 * const stats = new Stats(renderer);
 * renderer.setAnimationLoop(() => {
 *   stats.begin();
 *   renderer.render(scene, camera);
 *   stats.end();
 * });
 * ```
 */
export class Stats {
  private readonly _renderer: StatsRenderer;
  private readonly _sampler: FrameSampler;
  private readonly _overlay: Overlay;
  private readonly _budget: number;
  private readonly _interval: number;
  private readonly _thresholds: FrameThresholds;
  private readonly _remember: boolean;
  private readonly _pacing = new FrameStats();
  private readonly _profile: DeviceProfile;
  private readonly _budgets: Budgets;
  private _lastPressure = 0;
  /** When the cached survey was taken; -Infinity when there is none. */
  private _surveyedAt = -Infinity;
  private _survey: SceneSurvey | null = null;
  /** Values of the last refresh, read by the pressure signal and the snapshot. */
  private _lastFrame: { fps: number | null; cpu: number | null; gpu: number | null; heap: number | null } = { fps: null, cpu: null, gpu: null, heap: null };
  /** Pacing of the last refresh, read by the p95 / worst / dropped rows. */
  private _pacingSummary: FramePacing | null = null;
  /** The canvas box as the page lays it out. */
  private _rect = new DOMRect();
  private _scene: InfoScene | null;
  /** A remembered custom mode that is not defined yet: applied as soon as defineMode() adds it. */
  private _pendingMode: string | null = null;
  /** A custom `mode` option not defined yet: applied when defined, unless the remembered one already was. */
  private _wantedMode: string | null = null;
  /** After a hidden tab: wait one interval before refreshing, so the readouts have frames to average. */
  private _holdRefresh = false;
  /** Duration of the last scene survey, in ms. */
  private _surveyCost = 0;
  /** Objects in the scene at the last count, when it was taken and how long it took. */
  private _objects: number | null = null;
  private _countedAt = -Infinity;
  private _countCost = 0;
  private readonly _excluded: readonly string[];
  private readonly _pressure = new PressureMonitor();
  private readonly _onPressure: ((pressure: Pressure) => void) | null;
  private readonly _onReport: ((report: StatsReport) => void) | null;
  private _recorder: Recorder | null = null;
  private _report: StatsReport | null = null;
  private readonly _exposed: boolean;
  private _lastRefresh = 0;
  private _rectDirty = true;
  private readonly _onLayout = (): void => {
    this._rectDirty = true;
  };

  private readonly _resizeObserver: ResizeObserver;
  /** rAF stops in a hidden tab: the gap must not count as a frame, a drop or a spike. */
  private readonly _onVisibility = (): void => {
    if (document.visibilityState !== 'hidden') return;
    this._sampler.pause();
    this._pacing.reset();
    this._holdRefresh = true;
    this._pressure.reset();
  };

  constructor(renderer: StatsRenderer, options: StatsOptions = {}) {
    this._renderer = renderer;
    this._budget = options.budget ?? 1000 / 60;
    this._interval = options.interval ?? 250;
    this._thresholds = { ...defaultThresholds(this._budget), ...options.thresholds };
    const interactive = options.interactive ?? true;
    // Without the plate nobody can pick a mode here: a choice remembered elsewhere must not override the option.
    this._remember = (options.remember ?? true) && interactive;
    const resolved = resolveBudgets(options.profile ?? 'auto', options.budgets);
    this._profile = resolved.profile;
    this._budgets = resolved.budgets;
    const stored = this._remember ? storedMode() : null;
    const builtin = stored !== null && findMode(MODES, stored) !== null;
    // A custom mode (remembered, or asked for in the options) applies as soon as defineMode() adds it.
    if (stored !== null && !builtin) this._pendingMode = stored;
    // Kept even with a remembered custom mode: that one may belong to another page of this origin and never be defined.
    if (!builtin && options.mode !== undefined && findMode(MODES, options.mode) === null) this._wantedMode = options.mode;
    this._sampler = new FrameSampler(renderer);
    this._overlay = new Overlay(this._budget, {
      interactive,
      step: options.graphStep ?? 3,
      mode: builtin ? stored : (options.mode !== undefined && findMode(MODES, options.mode) !== null ? options.mode : 'simple'),
      onModeChange: (mode) => {
        this._pendingMode = null;
        this._wantedMode = null;
        if (this._remember) storeMode(mode);
      }
    });
    this._overlay.setBackend(this._sampler.backend);
    this._scene = options.scene ?? null;
    this._sampler.onGpuSample = (ms): void => {
      this._overlay.pushGpu(ms);
      this._recorder?.gpu(ms);
    };

    this._onPressure = options.onPressure ?? null;
    this._onReport = options.onReport ?? null;

    this._sampler.onSegment = (name): void => {
      this._overlay.addMetric(segmentMetric(name, () => this._sampler.segment(name)));
    };

    const exclude = options.exclude ?? [];
    this._excluded = exclude;
    const builtins = builtinMetrics(this._sampler, this._budgets, this._profile).concat(pacingMetrics(this._budget, () => this._pacingSummary));
    for (let i = 0, l = builtins.length; i < l; i++) {
      if (!exclude.includes(builtins[i].id)) this._overlay.addMetric(builtins[i]);
    }

    if (this._scene !== null) this.showObjects();
    const extra = options.metrics ?? [];
    for (let i = 0, l = extra.length; i < l; i++) this._overlay.addMetric(extra[i]);
    if (!exclude.includes('rec')) this._overlay.addControl(this.recControl());

    document.body.appendChild(this._overlay.root);
    this._resizeObserver = new ResizeObserver(this._onLayout);
    this._resizeObserver.observe(renderer.domElement);
    window.addEventListener('resize', this._onLayout, { passive: true });
    window.addEventListener('scroll', this._onLayout, { passive: true, capture: true });
    document.addEventListener('visibilitychange', this._onVisibility);
    this.syncRect();
    this._exposed = options.expose ?? true;
    if (this._exposed) liveInstances().push(this);
  }

  /** Current display mode. Setting it from code does not change the remembered choice. */
  public get mode(): StatsMode { return this._overlay.mode; }

  public set mode(mode: StatsMode) {
    // An explicit choice wins over a remembered custom mode that is not defined yet.
    this._pendingMode = null;
    this._wantedMode = null;
    this._overlay.setMode(mode);
  }

  /** Every mode mode cycles through, built-in and custom, in order. */
  public get modes(): readonly { id: StatsMode; name: string; code: string; description: string }[] {
    return this._overlay.modes;
  }

  /**
   * Adds a display mode to the mode plate (after the built-in ones, before 'off'): graphs, mode-only metrics
   * and an optional distribution bar. Invalid definitions are skipped with a console warning.
   *
   * ```ts
   * stats.defineMode({
   *   id: 'lod', name: 'Level of detail', code: 'LOD', description: 'Objects per LOD level and switches per second.',
   *   graphs: [{ id: 'lod.switches', label: ['LOD', 'SW/S'], scale: 'auto', unit: 'sw/s', read: () => lodSwitchesPerSecond }],
   *   metrics: [{ id: 'lod.saved', label: 'Triangles saved by LOD', place: 'top', plate: 'SAVE', unit: '%', read: () => savedPercent }],
   *   distribution: { id: 'lod.levels', label: ['LOD', 'LVL'], read: () => objectsPerLevel }
   * });
   * ```
   */
  public defineMode(definition: ModeDefinition): this {
    if (!this._overlay.defineMode(definition)) return this;
    if (this._pendingMode === definition.id) {
      this._pendingMode = null;
      this._wantedMode = null;
      this._overlay.setMode(definition.id);
    } else if (this._wantedMode === definition.id) {
      this._wantedMode = null;
      this._overlay.setMode(definition.id);
    }

    return this;
  }

  /** Adds graphs, metrics or a distribution to an existing mode, e.g. `stats.extendMode('performance', { graphs: [...] })`. */
  public extendMode(id: StatsMode, content: ModeContent): this {
    this._overlay.extendMode(id, content);
    return this;
  }

  /** Device profile the budgets come from. */
  public get profile(): DeviceProfile { return this._profile; }

  /** Budgets in use: the profile's, with the `budgets` option applied. */
  public get budgets(): Readonly<Budgets> { return this._budgets; }

  /** Current pressure on the frame: 'high' (no room left), 'low' (plenty) or 'ok'. See the `onPressure` option. */
  public get pressure(): Pressure { return this._pressure.level; }

  /** True between `startRecording()` and `stopRecording()`. */
  public get recording(): boolean { return this._recorder !== null; }

  /** The report of the last finished recording, or null. */
  public get report(): StatsReport | null { return this._report; }

  /**
   * Starts recording every frame for a report: averages, percentiles, the 1% low frame rate,
   * dropped refreshes, counters, memory and events. The REC plate
   * (Graph mode) does the same.
   */
  public startRecording(): this {
    if (this._recorder !== null) return this;
    this._recorder = new Recorder(this.memory());
    this._overlay.setControl('rec', true);
    return this;
  }

  /** Stops the recording and returns its report, or null when nothing was recorded. */
  public stopRecording(): StatsReport | null {
    const recorder = this._recorder;
    if (recorder === null) return null;
    this._recorder = null;
    this._overlay.setControl('rec', false);
    const report = recorder.finish(this.memory(), { budget: this._budget, profile: this._profile, backend: this._sampler.backend });
    if (report === null) return null;
    this._report = report;
    if (this._onReport !== null) this.guard('onReport', () => this._onReport?.(report));
    return report;
  }

  /**
   * Marks this moment on the graphs with a flag, and in the recording by name: the way to tell
   * what the app was doing when a frame hitched.
   *
   * ```ts
   * stats.event('level-load');
   * ```
   */
  public event(name: string): this {
    this._overlay.markEvent();
    const text: unknown = name;
    this._recorder?.event(typeof text === 'string' ? text : String(text));
    return this;
  }

  /**
   * Everything the overlay knows right now as plain JSON: frame values, pacing, counters, the
   * scene survey and the last report. Made for
   * agents, tests and bug reports; cheap, but it may survey the scene, so call it on demand, not
   * per frame.
   */
  public snapshot(): StatsSnapshot {
    const sampler = this._sampler;
    const canvas = this._renderer.domElement;
    const survey = this._scene === null ? null : this.survey(performance.now(), SURVEY_FRESH_MS);
    return {
      version: 2,
      mode: this._overlay.mode,
      backend: sampler.backend,
      profile: this._profile,
      budget: this._budget,
      budgets: { ...this._budgets },
      frame: { ...this._lastFrame },
      pacing: this._pacingSummary === null ? null : { ...this._pacingSummary },
      counters: {
        calls: sampler.calls, triangles: sampler.triangles, points: sampler.points, lines: sampler.lines,
        geometries: sampler.geometries, textures: sampler.textures, programs: sampler.programs, passes: sampler.passes
      },
      canvas: { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, pixelRatio: this._renderer.getPixelRatio?.() ?? null },
      pressure: this._pressure.level,
      scene: survey === null ? null : summariseScene(survey),
      recording: this.recording,
      report: this._report
    };
  }

  /** The overlay element, for custom placement or styling. */
  public get element(): HTMLElement { return this._overlay.root; }

  /** Call right before rendering a frame. */
  public begin(): void {
    this._sampler.begin();
  }

  /** Call right after rendering a frame. */
  public end(): void {
    this._sampler.end();
    this._pacing.push(this._sampler.lastInterval);
    this._overlay.pushFrame(this._sampler.lastInterval, this._sampler.lastCpu, this._sampler.compiled);
    const recorder = this._recorder;
    if (recorder !== null) {
      recorder.frame(this._sampler.lastInterval, this._sampler.lastCpu, this._sampler.calls, this._sampler.triangles);
      if (recorder.full) this.stopRecording();
    }

    const now = performance.now();
    if (this._holdRefresh) {
      this._holdRefresh = false;
      this._lastRefresh = now;
    }

    // Reads and scenes are guarded one by one; this net is for whatever they miss. The
    // overlay must never throw into the app's frame callback.
    try {
      if (now - this._lastRefresh >= this._interval) {
        this._lastRefresh = now;
        if (this._rectDirty || this.moved()) this.syncRect();
        this._pacingSummary = this._pacing.summary(this._budget);
        this._lastFrame = { ...this._sampler.take(), heap: this._sampler.heap };
        this._overlay.refresh(this._lastFrame, this._budget, this._thresholds);
      }

      // Once a second whatever the refresh interval: the pressure streaks count samples as seconds.
      if (now - this._lastPressure >= PRESSURE_MS) {
        this._lastPressure = now;
        this.signalPressure();
      }
    } catch (error) {
      warnOnce(`a refresh failed and was skipped (${String(error)}).`);
    }
  }

  /**
   * Splits the CPU time of a frame into named segments, shown as rows in Graph mode. The time
   * from begin() to the first mark is 'logic'; each mark closes the previous segment and the last
   * one ends at end(). Names show on a plate as their first 4 letters; at most 4 segments.
   *
   * ```ts
   * stats.begin();
   * world.update();
   * stats.mark('render');
   * renderer.render(scene, camera);
   * stats.end();
   * ```
   */
  public mark(name: string): this {
    this._sampler.mark(name);
    return this;
  }

  public addMetric(metric: StatsMetric): this {
    this._overlay.addMetric(metric);
    return this;
  }

  /**
   * Adds a toggle plate next to the mode plate.
   *
   * ```ts
   * stats.addControl({ id: 'lod.color', label: 'COLOR', description: 'Colour objects by LOD level', onChange: (on) => field.setColored(on) });
   * ```
   */
  public addControl(control: ControlDefinition): this {
    this._overlay.addControl(control);
    return this;
  }

  /** Sets a toggle plate from code; its onChange runs as on a click. */
  public setControl(id: string, active: boolean): this {
    this._overlay.setControl(id, active);
    return this;
  }

  /** Removes a toggle plate added with addControl(). */
  public removeControl(id: string): this {
    this._overlay.removeControl(id);
    return this;
  }

  public removeMetric(id: string): this {
    this._overlay.removeMetric(id);
    return this;
  }

  /** Scene for the object counter and the snapshot. */
  public set scene(scene: InfoScene | null) {
    this._scene = scene;
    this._survey = null;
    this._surveyedAt = -Infinity;
    this._objects = null;
    this._countedAt = -Infinity;
    if (scene === null) this._overlay.removeMetric('objects');
    else this.showObjects();
  }

  /** Removes the overlay and restores the renderer's info settings. */
  public dispose(): void {
    this._resizeObserver.disconnect();
    window.removeEventListener('resize', this._onLayout);
    window.removeEventListener('scroll', this._onLayout, { capture: true });
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._sampler.dispose();
    this._overlay.dispose();
    if (this._exposed) {
      const live = liveInstances();
      const index = live.indexOf(this);
      if (index >= 0) live.splice(index, 1);
    }
  }

  /** The OBJ counter, bottom-left, while there is a scene. */
  private showObjects(): void {
    if (this._excluded.includes('objects')) return;
    this._overlay.addMetric({
      id: 'objects', label: 'Objects in the scene', glyph: 'objects',
      read: () => this.objectCount(performance.now())
    });
  }

  /**
   * Objects in the scene, recounted at most once a second and never more often than 250 times its
   * own cost, so a huge scene is never walked every refresh. Null while the scene cannot be walked.
   */
  private objectCount(now: number): number | null {
    const scene = this._scene;
    if (scene === null) return null;
    if (now - this._countedAt < Math.max(COUNT_MS, this._countCost * SURVEY_COST_FACTOR)) return this._objects;
    this._countedAt = now;
    const started = performance.now();
    let count = 0;
    try {
      scene.traverse(() => {
        count++;
      });
      this._objects = count;
    } catch {
      this._objects = null;
    }

    this._countCost = performance.now() - started;
    return this._objects;
  }

  private memory(): MemoryCounters {
    const sampler = this._sampler;
    return { geometries: sampler.geometries, textures: sampler.textures, programs: sampler.programs, heap: sampler.heap };
  }

  /** Runs a user callback; a throw is reported once and never reaches the frame. */
  private guard(name: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      warnOnce(`${name} threw (${String(error)}).`);
    }
  }

  private signalPressure(): void {
    const frame = this._lastFrame;
    const signal = this._pressure.update(frame.cpu, frame.gpu, frame.fps, this._budget);
    if (signal !== null && this._onPressure !== null) this.guard('onPressure', () => this._onPressure?.(signal));
  }

  /** The REC plate: a click starts a recording, the next one stops it; its tooltip shows the last report. */
  private recControl(): ControlDefinition {
    const row = (key: string, value: string): readonly [string, string] => [key, value];
    return {
      id: 'rec',
      label: 'REC',
      description: 'Record a session',
      modes: ['graph'],
      onChange: (active) => {
        if (active) this.startRecording();
        else this.stopRecording();
      },
      tip: {
        title: 'Record',
        text: 'Click to start, again to stop. Read it from stats.report.',
        values: () => {
          const report = this._report;
          if (this.recording) return [row('State', 'Recording…')];
          if (report === null) return [];
          return [
            row('Duration', `${report.duration.toFixed(1)} s`),
            row('FPS / 1% low', `${formatInt(report.fps.average)} / ${formatInt(report.fps.low1)}`),
            row('P95 / P99', `${formatMs(report.frame.p95)} / ${formatMs(report.frame.p99)} ms`),
            row('Dropped', formatInt(report.dropped))
          ];
        }
      }
    };
  }

  /**
   * The shared scene survey, retaken when older than `maxAge`. Null without a scene or when the
   * scene cannot be traversed right now (e.g. mid-teardown): a survey must never break a frame.
   */
  private survey(now: number, maxAge: number): SceneSurvey | null {
    if (this._scene === null) return null;
    // A large scene takes long to walk: space the surveys out so they never become the stutter they look for.
    if (now - this._surveyedAt < Math.max(maxAge, this._surveyCost * SURVEY_COST_FACTOR)) return this._survey;
    this._surveyedAt = now;
    const started = performance.now();
    try {
      this._survey = surveyScene(this._scene);
    } catch (error) {
      warnOnce(`the scene could not be surveyed (${String(error)}); the next try comes later.`);
      this._survey = null;
    }

    this._surveyCost = performance.now() - started;

    return this._survey;
  }

  /**
   * The canvas moved or changed size without a resize or scroll event (a layout shift above it).
   * Checked at each refresh.
   */
  private moved(): boolean {
    const rect = this._renderer.domElement.getBoundingClientRect();
    const last = this._rect;
    return rect.left !== last.left || rect.top !== last.top || rect.width !== last.width || rect.height !== last.height;
  }

  /** Lays the overlay exactly over the canvas. */
  private syncRect(): void {
    const rect = this._renderer.domElement.getBoundingClientRect();
    this._rect = rect;
    const style = this._overlay.root.style;
    style.left = `${rect.left}px`;
    style.top = `${rect.top}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
    this._overlay.layout();
    this._rectDirty = false;
  }
}

/** The global array of live instances (created on first use). */
function liveInstances(): Stats[] {
  const scope = globalThis as unknown as Record<string, Stats[] | undefined>;
  scope[GLOBAL_HOOK] ??= [];
  return scope[GLOBAL_HOOK];
}

/** The mode remembered from an earlier visit, if storage is available. */
function storedMode(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeMode(mode: StatsMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage blocked (private window, sandbox): the choice lasts for this page only.
  }
}

function defaultThresholds(budget: number): FrameThresholds {
  const over: Threshold = { above: budget };
  return { fps: { below: (1000 / budget) * 0.9 }, cpu: over, gpu: over };
}

function builtinMetrics(sampler: FrameSampler, budgets: Budgets, profile: DeviceProfile): StatsMetric[] {
  return [
    {
      id: 'calls', label: 'Draw calls', glyph: 'calls',
      threshold: { above: budgets.calls }, read: () => sampler.calls,
      tip: {
        title: 'Draw calls',
        text: 'Per frame.',
        legend: [{ mark: 'alert', text: `Over the ${profile} budget, ${formatCount(budgets.calls)}` }]
      }
    },
    {
      id: 'triangles', label: 'Triangles', glyph: 'triangles',
      threshold: { above: budgets.triangles }, read: () => sampler.triangles, width: 5,
      tip: {
        title: 'Triangles',
        text: 'Per frame, every pass included.',
        legend: [{ mark: 'alert', text: `Over the ${profile} budget, ${formatCount(budgets.triangles)}` }]
      }
    },
    { id: 'points', label: 'Points', glyph: 'points', read: () => sampler.points },
    { id: 'lines', label: 'Lines', glyph: 'lines', read: () => sampler.lines },
    { id: 'geometries', label: 'Geometries', glyph: 'geometries', read: () => sampler.geometries },
    { id: 'textures', label: 'Textures', glyph: 'textures', read: () => sampler.textures },
    { id: 'programs', label: 'Shader programs', glyph: 'programs', read: () => sampler.programs }
  ];
}

/** Frame pacing rows, beside the graphs: stutter that the FPS average hides. */
function pacingMetrics(budget: number, pacing: () => FramePacing | null): StatsMetric[] {
  const modes = ['graph'];
  return [
    {
      id: 'p95', label: 'P95 frame time',
      place: 'top', plate: 'P95', unit: 'MS', format: formatMs, width: 4, modes,
      threshold: { above: budget * 1.25 }, read: () => pacing()?.p95 ?? null,
      tip: {
        title: 'P95 frame time',
        text: '95% of the last 240 frames were faster.',
        legend: [{ mark: 'alert', text: 'Over 1.25× the budget' }]
      }
    },
    {
      id: 'worst', label: 'Peak frame time',
      place: 'top', plate: 'PEAK', unit: 'MS', format: formatMs, width: 4, modes,
      threshold: { above: budget * 2.25 }, read: () => pacing()?.worst ?? null,
      tip: {
        title: 'Peak frame time',
        text: 'Slowest of the last 240 frames.',
        legend: [{ mark: 'alert', text: 'Missed two or more refreshes' }]
      }
    },
    {
      id: 'dropped', label: 'Dropped refreshes',
      place: 'top', plate: 'DROP', format: formatInt, width: 3, modes,
      threshold: { above: 0 }, read: () => pacing()?.dropped ?? null,
      tip: {
        title: 'Dropped refreshes',
        text: 'Screen refreshes missed in the last 240 frames.',
        legend: [{ mark: 'alert', text: 'Any' }]
      }
    }
  ];
}

/** A row for one stats.mark() segment. */
function segmentMetric(name: string, read: () => number | null): StatsMetric {
  const first = name === FIRST_SEGMENT;
  return {
    id: `segment.${name}`,
    label: first ? 'CPU ms before the first mark()' : `CPU ms in mark('${name}')`,
    place: 'top', plate: name.slice(0, 4).toUpperCase(), unit: 'MS', format: formatMs, width: 4, modes: ['graph'], read
  };
}
