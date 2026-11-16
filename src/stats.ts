import { resolveBudgets, type Budgets, type DeviceProfile } from './budgets.js';
import { warnOnce } from './custom.js';
import type { Threshold } from './format.js';
import { findMode, MODES } from './modes.js';
import { Overlay, type FrameThresholds } from './overlay.js';
import type { ControlDefinition, ModeContent, ModeDefinition, StatsMetric, StatsMode } from './types.js';
import { FrameSampler, type StatsRenderer } from './sampler.js';

const STORAGE_KEY = 'tez-stats-mode';
/** The object counter walks the scene at most once a second. */
const COUNT_MS = 1000;
/** A count waits at least this many times its own duration: at most 0.4% of the time, however large the scene. */
const COUNT_COST_FACTOR = 250;

/** The subset of a three.js scene the objects counter reads. */
export interface InfoScene {
  // Method syntax on purpose: a THREE.Scene (whose callback takes Object3D) must be assignable.
  traverse(callback: (object: unknown) => void): void;
}

export interface StatsOptions {
  /** Scene for the objects counter. Optional. */
  scene?: InfoScene;
  /**
   * Display mode, cumulative: 'simple' (frame rate, CPU and GPU time), 'performance' (plus the heap
   * and the counters), 'graph' (plus the time graphs), 'off', or a custom mode.
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
   * 'textures', 'programs', 'objects'.
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
   * Sum every render() of a frame (post-processing, several views): switches
   * `renderer.info.autoReset` off while the overlay lives and resets it in begin(); restored on
   * dispose. Off by default, so `renderer.info` behaves as the app expects and the counters show
   * its last render() of the frame.
   */
  countAllPasses?: boolean;
  /**
   * Measure GPU time. On WebGL it runs a timer query on the app's context each frame (skipped
   * while the app runs its own); on WebGPU it resolves the timestamps the app enabled with
   * `trackTimestamp`. False when the app reads those itself. Default true.
   */
  gpuTimer?: boolean;
}

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
  private readonly _profile: DeviceProfile;
  private readonly _budgets: Budgets;
  /** The canvas box as the page lays it out. */
  private _rect = new DOMRect();
  private _scene: InfoScene | null;
  /** A remembered custom mode that is not defined yet: applied as soon as defineMode() adds it. */
  private _pendingMode: string | null = null;
  /** A custom `mode` option not defined yet: applied when defined, unless the remembered one already was. */
  private _wantedMode: string | null = null;
  /** After a hidden tab: wait one interval before refreshing, so the readouts have frames to average. */
  private _holdRefresh = false;
  /** Objects in the scene at the last count, when it was taken and how long it took. */
  private _objects: number | null = null;
  private _countedAt = -Infinity;
  private _countCost = 0;
  private readonly _excluded: readonly string[];
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
    this._holdRefresh = true;
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
    this._sampler = new FrameSampler(renderer, { countAllPasses: options.countAllPasses === true, gpuTimer: options.gpuTimer !== false });
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
    };

    const exclude = options.exclude ?? [];
    this._excluded = exclude;
    const builtins = builtinMetrics(this._sampler, this._budgets);
    for (let i = 0, l = builtins.length; i < l; i++) {
      if (!exclude.includes(builtins[i].id)) this._overlay.addMetric(builtins[i]);
    }

    if (this._scene !== null) this.showObjects();
    const extra = options.metrics ?? [];
    for (let i = 0, l = extra.length; i < l; i++) this._overlay.addMetric(extra[i]);

    document.body.appendChild(this._overlay.root);
    this._resizeObserver = new ResizeObserver(this._onLayout);
    this._resizeObserver.observe(renderer.domElement);
    window.addEventListener('resize', this._onLayout, { passive: true });
    window.addEventListener('scroll', this._onLayout, { passive: true, capture: true });
    document.addEventListener('visibilitychange', this._onVisibility);
    this.syncRect();
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

  /**
   * Marks this moment on the frame graph with a flag: the way to tell what the app was doing
   * when a frame hitched.
   *
   * ```ts
   * loadLevel();
   * stats.event();
   * ```
   */
  public event(): this {
    this._overlay.markEvent();
    return this;
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
    this._overlay.pushFrame(this._sampler.lastInterval, this._sampler.lastCpu, this._sampler.compiled);

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
        this._overlay.refresh({ ...this._sampler.take(), heap: this._sampler.heap }, this._budget, this._thresholds);
      }
    } catch (error) {
      warnOnce(`a refresh failed and was skipped (${String(error)}).`);
    }
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

  /** Scene for the objects counter. */
  public set scene(scene: InfoScene | null) {
    this._scene = scene;
    this._objects = null;
    this._countedAt = -Infinity;
    if (scene === null) this._overlay.removeMetric('objects');
    else this.showObjects();
  }

  /** Removes the overlay, its stylesheet (with the last overlay) and its listeners; restores autoReset with `countAllPasses`. */
  public dispose(): void {
    this._resizeObserver.disconnect();
    window.removeEventListener('resize', this._onLayout);
    window.removeEventListener('scroll', this._onLayout, { capture: true });
    document.removeEventListener('visibilitychange', this._onVisibility);
    this._sampler.dispose();
    this._overlay.dispose();
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
    if (now - this._countedAt < Math.max(COUNT_MS, this._countCost * COUNT_COST_FACTOR)) return this._objects;
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

function builtinMetrics(sampler: FrameSampler, budgets: Budgets): StatsMetric[] {
  return [
    {
      id: 'calls', label: 'Draw calls', glyph: 'calls',
      threshold: { above: budgets.calls }, read: () => sampler.calls,
      tip: { title: 'Draw calls', text: 'Per frame.' }
    },
    {
      id: 'triangles', label: 'Triangles', glyph: 'triangles',
      threshold: { above: budgets.triangles }, read: () => sampler.triangles, width: 5,
      tip: { title: 'Triangles', text: 'Per frame.' }
    },
    { id: 'points', label: 'Points', glyph: 'points', read: () => sampler.points },
    { id: 'lines', label: 'Lines', glyph: 'lines', read: () => sampler.lines },
    { id: 'geometries', label: 'Geometries', glyph: 'geometries', read: () => sampler.geometries },
    { id: 'textures', label: 'Textures', glyph: 'textures', read: () => sampler.textures },
    { id: 'programs', label: 'Shader programs', glyph: 'programs', read: () => sampler.programs }
  ];
}
