import { checkControl, Toggle } from './controls.js';
import { checkDistribution, checkGraph, checkHistogram, checkMetric, safeFormat, customGraphPanel, distributionPanel, finite, graphPanel, safeRead, warnOnce, type Panel } from './custom.js';
import type { ActiveFinding } from './diagnostics.js';
import { HISTOGRAM_WIDTH, histogramPanel, imageHistogramPanel, type HistogramPanel } from './histogram-panel.js';
import { vectorscopePanel, waveformPanel, zebraMask } from './scopes.js';
import { IMAGE_HEIGHT, IMAGE_WIDTH, ImageSampler } from './image.js';
import type { InfoPage } from './info.js';
import { InfoPanel } from './info-panel.js';
import { el, graphColors, hit, num, stack, TimeReadout, write, type Writable } from './dom.js';
import { play, reducedMotion, snapshot, type Snapshot } from './flip.js';
import { formatCount, formatInt, formatMs, isAlert, type Threshold } from './format.js';
import { createGlyphFromSpec, createPlate, GLYPHS, type GlyphSpec } from './glyphs.js';
import { Samples, TimeGraph, type Series } from './graphs.js';
import { findMode, ModeControl, MODES, type ModeInfo } from './modes.js';
import type { BackendKind } from './sampler.js';
import { injectStyles } from './styles.js';
import { setTip, Tooltip } from './tooltip.js';
import type { ControlDefinition, ModeContent, ModeDefinition, StatsMetric, StatsMode, TipContent } from './types.js';

export type { StatsMetric } from './types.js';

/** Graphs a mode may show, built-in ones included: more would stop being discreet. */
const MAX_GRAPHS = 4;

export interface FrameThresholds {
  fps?: Threshold;
  cpu?: Threshold;
  gpu?: Threshold;
}

export interface FrameValues {
  fps: number | null;
  cpu: number | null;
  gpu: number | null;
  heap?: number | null;
}

export interface OverlayOptions {
  /** Overlay elements show their tooltip on hover and the mode plate is clickable. Default true. */
  interactive?: boolean;
  /** Frames per graph column; each column keeps the slowest of its frames. Default 3. */
  step?: number;
  /** Initial display mode. Default 'simple'. */
  mode?: StatsMode;
  /** Called when the mode plate changes the mode. */
  onModeChange?: (mode: StatsMode) => void;
  /** Called after every layout, e.g. to fit the canvas into the INFO thumbnail. */
  onLayout?: () => void;
}

interface Slot extends Writable {
  metric: StatsMetric;
  /** Failure-proof read of `metric.read`. */
  read: () => number | null;
}

/** Custom graphs and distribution of one mode. */
interface Content {
  graphs: Panel[];
  distribution: Panel | null;
  /** The large top-left histogram; 'image' uses the shared image histogram. */
  histogram: HistogramPanel | 'image' | null;
}

type PanelName = 'frame' | 'cpu' | 'gpu' | 'time' | 'calls' | 'triangles' | 'heap' | 'geometries' | 'textures';

const BACKEND_PLATES: Record<BackendKind, [string, string]> = {
  webgl: ['GL2', 'WebGLRenderer (WebGL 2)'],
  webgpu: ['WGPU', 'WebGPURenderer (WebGPU)'],
  'webgpu-webgl': ['GL2', 'WebGPURenderer (WebGL 2 fallback)']
};

/** Graph sizes: the bottom edge belongs to the graphs now, so they can be generous. */
const GRAPH = 132;
const MERGED = 220;
const HEIGHT = 32;
/** The merged graph's height on overlays narrower than 640px. */
const NARROW_HEIGHT = 40;

const ms = (value: number | null): string => (value === null ? '—' : formatMs(value));
const count = (value: number | null): string => (value === null ? '—' : formatCount(value));
const mb = (value: number | null): string => (value === null ? '—' : formatInt(value));

export class Overlay {
  public readonly root: HTMLDivElement;

  private readonly _backend = el('span', 'tez-backend');
  /** Backend plate and the mode plate, bottom-right. */
  private readonly _plates = el('div', 'tez-c tez-c-backend');
  private readonly _toggles: Toggle[] = [];
  private readonly _rows = el('div', 'tez-c tez-c-rows tez-rows');
  /** TIP plate, first of the top-right rows: shown only while diagnostics have findings. */
  private readonly _tips = el('span', 'tez-row tez-tips');
  private _findings = 0;
  private readonly _counters = el('div', 'tez-c tez-c-counters');
  private readonly _grid = el('div', 'tez-grid');
  /** FPS, CPU, GPU and heap on one row, top-left. */
  private readonly _band = el('div', 'tez-c tez-c-band tez-band');
  private readonly _strip = el('div', 'tez-c tez-c-strip tez-strip');
  /** Right edge, mid height: a mode's distribution sits here, vertical, when there is room. */
  private readonly _side = el('div', 'tez-c tez-c-side');
  /** Top-left, under the readouts: the large histogram of the current mode. */
  private readonly _hist = el('div', 'tez-c tez-c-hist');
  private readonly _imageSampler = new ImageSampler();
  private _imageSource: HTMLCanvasElement | null = null;
  private _imagePanel: HistogramPanel | null = null;
  /** Image mode aids drawn over the canvas: zebra stripes on clipped highlights, framing guides. */
  private readonly _zebra = el('canvas', 'tez-zebra');
  private readonly _guides = el('div', 'tez-guides');
  private _zebraOn = false;
  private _guidesOn = false;
  private _zebraPhase = 0;
  private _zebraImage: ImageData | null = null;
  /** Last pointer position in client px, for the pixel readout; null when it left the page. */
  private _pointer: { x: number; y: number } | null = null;
  private readonly onPointerMove = (event: PointerEvent): void => {
    this._pointer = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerLeave = (): void => {
    this._pointer = null;
  };

  /** INFO mode: the shrunk canvas shows through this cell; the page sits on the right. */
  private readonly _thumb = el('div', 'tez-c tez-c-thumb');
  private readonly _pages = el('div', 'tez-c tez-c-pages');
  private _info: InfoPanel | null = null;
  private readonly _onLayout: (() => void) | undefined;
  private _distributionOnSide = false;
  private readonly _slots: Slot[] = [];
  private readonly _fps: Writable;
  private readonly _heap: Writable;
  private readonly _cpu: TimeReadout;
  private readonly _gpu: TimeReadout;
  private readonly _samples = {
    frame: new Samples(), cpu: new Samples(), gpu: new Samples(),
    calls: new Samples(), triangles: new Samples(), geometries: new Samples(), textures: new Samples(),
    heap: new Samples(),
    /** 1 for a column whose frames created a shader program, 0 otherwise; aligned with `frame`. */
    compiles: new Samples()
  };

  private readonly _panels: Record<PanelName, Panel>;
  /** The merged frame / GPU / CPU graph: it grows to the row width and gets taller on narrow overlays. */
  private readonly _timeGraph: TimeGraph;
  private readonly _budget: number;
  private readonly _step: number;
  private readonly _control: ModeControl | null;
  private readonly _tooltip: Tooltip;
  /** Built-in modes plus custom ones, in mode order ('off' always last). */
  private readonly _modes: ModeInfo[] = [...MODES];
  private readonly _content = new Map<StatsMode, Content>();
  private _mode: StatsMode;
  private _merged = false;
  /** Current arrangement; a change triggers the FLIP transition. */
  private _arrangement = '';
  /** Values of the last refresh, read by the live rows of the readout tooltips. */
  /** Reads of the renderer counters behind the Mesh and Memory graphs. */
  private _counterReads: Record<'calls' | 'triangles' | 'geometries' | 'textures', () => number> | null = null;
  /** Ids of the custom graphs added so far, to refuse duplicates. */
  private readonly _graphIds = new Set<string>();
  private _last: { frame: FrameValues; thresholds: FrameThresholds } = { frame: { fps: null, cpu: null, gpu: null }, thresholds: {} };
  /** Running maximum of the frames in the column being built; -1 while empty. */
  private readonly _pending = { frames: 0, interval: -1, cpu: -1, gpu: -1, lastGpu: -1, compiled: false, event: false };

  constructor(budget: number, options: OverlayOptions = {}) {
    injectStyles(document);
    const interactive = options.interactive ?? true;
    this._budget = budget;
    this._step = Math.max(1, Math.round(options.step ?? 3));
    this._mode = options.mode ?? 'simple';
    this.root = el('div', interactive ? 'tez-stats tez-interactive' : 'tez-stats');
    // A labelled group, not a live region: values change several times a second and must not
    // be announced continuously. Screen reader users read them on demand.
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Renderer statistics');

    const last = (): { frame: FrameValues; thresholds: FrameThresholds } => this._last;
    this._fps = readout(fpsTip(budget, last), stack('AVG', 'FPS', 'tez-frame'), 3);
    this._heap = readout(heapTip(last), stack('MB', 'HEAP'), 4);
    this._cpu = new TimeReadout(setTip(el('span', 'tez-value'), timeTip('cpu', budget, last)), 'CPU frame time', 4);
    this._cpu.element.append(this._cpu.dial, stack('MS', 'CPU', 'tez-cpu'), this._cpu.value);
    this._gpu = new TimeReadout(setTip(el('span', 'tez-value'), timeTip('gpu', budget, last)), 'GPU frame time', 4);
    this._gpu.element.append(this._gpu.dial, stack('MS', 'GPU', 'tez-gpu'), this._gpu.value);
    this._band.append(this._fps.element, this._cpu.element, this._gpu.element, this._heap.element);

    const s = this._samples;
    this._timeGraph = new TimeGraph(budget, [{ samples: s.frame, color: 'frame' }, { samples: s.gpu, color: 'gpu' }, { samples: s.cpu, color: 'cpu' }], {
      width: MERGED, height: HEIGHT, vertical: false, autoScale: false, normalize: true, events: s.compiles, lane: s.frame, label: ''
    });
    this._panels = this.buildPanels();
    // Built-in Image mode: the shared histogram of the rendered image.
    const capture = (): boolean => this._imageSource !== null && this._imageSampler.capture(this._imageSource);
    this._content.set('image', { graphs: [waveformPanel(this._imageSampler, capture), vectorscopePanel(this._imageSampler, capture)], distribution: null, histogram: 'image' });
    this._content.set('info', { graphs: [], distribution: null, histogram: 'image' });
    this._onLayout = options.onLayout;
    this._control = interactive
      ? new ModeControl(this._mode, () => this._modes, (mode) => {
          this.setMode(mode);
          options.onModeChange?.(mode);
        })
      : null;

    this._tips.hidden = true;
    this._rows.append(this._tips);
    this._plates.append(this._backend);
    if (this._control !== null) this._plates.append(this._control.element);
    this._counters.append(this._grid);
    // The thumbnail comes first: its backdrop shadow must paint under every other cell.
    this._zebra.width = IMAGE_WIDTH;
    this._zebra.height = IMAGE_HEIGHT;
    this._zebra.setAttribute('aria-hidden', 'true');
    this._guides.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 5; i++) this._guides.append(el('span', `tez-guide tez-guide-${i}`));
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', this.onPointerLeave);
    // Under every cell: the aids belong to the picture, the readouts stay on top.
    this.root.append(this._zebra, this._guides, this._thumb, this._pages, this._band, this._rows, this._hist, this._side, this._counters, this._strip, this._plates);
    this._tooltip = new Tooltip(this.root);
    this.applyMode();
  }

  /** Image mode: stripes over clipped highlights (see scopes.ts). */
  public setZebra(on: boolean): void {
    this._zebraOn = on;
    this.applyMode();
    this.drawZebra();
  }

  /** Image mode: rule-of-thirds lines and a centre mark over the canvas. */
  public setGuides(on: boolean): void {
    this._guidesOn = on;
    this.applyMode();
  }

  /**
   * Colour of the rendered pixel under the pointer as 0xRRGGBB, from the image copy of the last
   * refresh; null outside Image mode, off the canvas or before the first copy.
   */
  public pixelAt(): number | null {
    const pixels = this._imageSampler.pixels;
    const pointer = this._pointer;
    if (this._mode !== 'image' || pixels === null || pointer === null || !this._imageSampler.valid) return null;
    const box = this.root.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    const u = (pointer.x - box.left) / box.width;
    const v = (pointer.y - box.top) / box.height;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    const at = (Math.floor(v * IMAGE_HEIGHT) * IMAGE_WIDTH + Math.floor(u * IMAGE_WIDTH)) * 4;
    return (pixels[at] << 16) | (pixels[at + 1] << 8) | pixels[at + 2];
  }

  public get mode(): StatsMode { return this._mode; }

  /** Known mode ids, in mode order. */
  public get modes(): readonly ModeInfo[] { return this._modes; }

  public setMode(mode: StatsMode): void {
    if (findMode(this._modes, mode) === null) {
      warnOnce(`unknown mode "${mode}"; define it with defineMode() first.`);
      return;
    }

    // Record the old layout before anything changes, so leaving elements can slide out.
    const before = this._arrangement !== '' && !reducedMotion() ? snapshot(this.animated()) : null;
    this._mode = mode;
    if (this._control !== null) this._control.mode = mode;
    this.applyMode();
    this.layout(before);
  }

  public setBackend(kind: BackendKind): void {
    const [label, title] = BACKEND_PLATES[kind];
    this._backend.replaceChildren(hit(createPlate(label, title), title));
  }

  public addMetric(metric: StatsMetric): boolean {
    const problem = checkMetric(metric);
    if (problem !== null) {
      warnOnce(problem);
      return false;
    }

    this.removeMetric(metric.id);
    const safe = metric.format === undefined ? metric : { ...metric, format: safeFormat(metric.id, metric.format) };
    this._slots.push(safe.place === 'top' ? this.topSlot(safe) : this.gridSlot(safe));
    this.applyMode();
    if (this.root.isConnected) this.layout();
    return true;
  }

  /** Adds a custom mode to the mode plate (before 'off'). Returns false, with a warning, when the definition is invalid. */
  public defineMode(definition: ModeDefinition): boolean {
    const id = definition.id;
    if (typeof id !== 'string' || id === '' || findMode(this._modes, id) !== null) {
      warnOnce(`mode "${id}" needs a new, non-empty id.`);
      return false;
    }

    if (typeof definition.code !== 'string' || definition.code.length > 4) {
      warnOnce(`mode "${id}": code must be at most 4 characters.`);
      return false;
    }

    // Check what could throw half-way before the mode joins the cycle.
    const histogramProblem = definition.histogram === undefined || definition.histogram === 'image' ? null : checkHistogram(definition.histogram);
    if (histogramProblem !== null) {
      warnOnce(`mode "${id}" was skipped: ${histogramProblem}`);
      return false;
    }

    this._modes.splice(this._modes.length - 1, 0, { id, name: definition.name, code: definition.code, description: definition.description });
    this._content.set(id, { graphs: [], distribution: null, histogram: null });
    this.extendMode(id, definition);
    this._control?.refresh();
    return true;
  }

  /**
   * Adds graphs, metrics or a distribution to an existing mode (built-in or custom). Invalid parts
   * and graphs beyond the per-mode limit are skipped with a warning; the rest is added.
   */
  public extendMode(id: StatsMode, content: ModeContent): void {
    if (findMode(this._modes, id) === null || id === 'off') {
      warnOnce(`cannot extend mode "${id}": it does not exist or is 'off'.`);
      return;
    }

    const target = this.contentOf(id);
    const graphs = content.graphs ?? [];
    for (let i = 0, l = graphs.length; i < l; i++) {
      const problem = checkGraph(graphs[i]);
      if (problem !== null) warnOnce(problem);
      else if (this._graphIds.has(graphs[i].id)) warnOnce(`graph "${graphs[i].id}" already exists and was skipped.`);
      else if (this.builtinCount(id) + target.graphs.length >= MAX_GRAPHS) warnOnce(`mode "${id}" already shows ${MAX_GRAPHS} graphs; "${graphs[i].id}" was skipped.`);
      else {
        this._graphIds.add(graphs[i].id);
        target.graphs.push(customGraphPanel(graphs[i], this._budget));
      }
    }

    const metrics = content.metrics ?? [];
    for (let i = 0, l = metrics.length; i < l; i++) {
      // addMetric() replaces by id on purpose; a mode's metric silently replacing another one would not be.
      if (this.hasMetric(metrics[i].id)) warnOnce(`metric "${metrics[i].id}" already exists; mode "${id}" skipped its copy.`);
      else this.addMetric({ ...metrics[i], modes: metrics[i].modes ?? [id] });
    }
    const controls = content.controls ?? [];
    for (let i = 0, l = controls.length; i < l; i++) this.addControl({ ...controls[i], modes: controls[i].modes ?? [id] });

    if (content.distribution !== undefined) {
      const problem = checkDistribution(content.distribution);
      if (problem !== null) warnOnce(problem);
      else target.distribution = distributionPanel(content.distribution);
    }

    if (content.histogram === 'image') target.histogram = 'image';
    else if (content.histogram !== undefined) {
      const problem = checkHistogram(content.histogram);
      if (problem !== null) warnOnce(problem);
      else target.histogram = histogramPanel(content.histogram, warnOnce) ?? target.histogram;
    }

    if (this._mode === id && this.root.isConnected) this.layout();
  }

  /** Adds a toggle plate next to the mode plate. Returns false, with a warning, when the definition is invalid. */
  public addControl(control: ControlDefinition): boolean {
    const problem = checkControl(control);
    if (problem !== null) {
      warnOnce(problem);
      return false;
    }

    for (let i = 0, l = this._toggles.length; i < l; i++) {
      if (this._toggles[i].definition.id === control.id) {
        warnOnce(`control "${control.id}" already exists.`);
        return false;
      }
    }

    const toggle = new Toggle(control);
    this._toggles.push(toggle);
    // Toggles sit between the backend plate and the mode plate.
    this._plates.insertBefore(toggle.element, this._control?.element ?? null);
    this.applyMode();
    if (this.root.isConnected) this.layout();
    return true;
  }

  /** Shows the TIP plate with the active diagnostics, or hides it when there are none. */
  public setFindings(findings: readonly ActiveFinding[]): void {
    const before = this._findings;
    this._findings = findings.length;
    if (findings.length > 0) {
      if (findings.length !== before) {
        const plate = createPlate(`TIP ${findings.length}`);
        plate.classList.add('tez-plate-alert');
        this._tips.replaceChildren(plate);
      }

      const sections: { title: string; text: string; advice: string }[] = [];
      for (let i = 0, l = findings.length; i < l; i++) sections.push({ title: findings[i].title, text: findings[i].message, advice: findings[i].advice });
      setTip(this._tips, {
        title: findings.length === 1 ? '1 thing to look at' : `${findings.length} things to look at`,
        sections,
        text: 'Checks on what the overlay measures, against the device profile budgets. INFO lists every check.'
      });
    }

    this.applyMode();
    if ((before > 0) !== (findings.length > 0) && this.root.isConnected) this.layout();
  }

  /** Feeds the Mesh and Memory graphs from the renderer, independently of the counter rows on screen. */
  public setCounters(counters: Record<'calls' | 'triangles' | 'geometries' | 'textures', () => number>): void {
    this._counterReads = counters;
  }

  public removeMetric(id: string): void {
    for (let i = 0, l = this._slots.length; i < l; i++) {
      if (this._slots[i].metric.id !== id) continue;
      this._slots[i].element.remove();
      this._slots.splice(i, 1);
      // One row fewer can change the arrangement, as one more does in addMetric().
      if (this.root.isConnected) this.layout();
      return;
    }
  }

  private hasMetric(id: string): boolean {
    for (let i = 0, l = this._slots.length; i < l; i++) if (this._slots[i].metric.id === id) return true;
    return false;
  }

  /** Refreshes every text value. Called a few times per second. */
  public refresh(frame: FrameValues, budget: number, thresholds: FrameThresholds): void {
    const heap = frame.heap ?? null;
    if (heap !== null) this._samples.heap.push(heap);
    this._last = { frame, thresholds };
    if (this._mode === 'off') return;
    this._tooltip.refresh();
    write(this._fps, frame.fps === null ? '—' : formatInt(frame.fps), isAlert(frame.fps, thresholds.fps));
    this._cpu.update(frame.cpu, budget, thresholds.cpu);
    this._gpu.update(frame.gpu, budget, thresholds.gpu);
    write(this._heap, mb(heap), false);

    for (let i = 0, l = this._slots.length; i < l; i++) {
      const slot = this._slots[i];
      if (slot.element.hidden === true) continue;
      const value = slot.read();
      const text = value === null ? '—' : (slot.metric.format ?? formatCount)(value);
      write(slot, text, isAlert(value, slot.metric.threshold));
    }

    const colors = graphColors(this.root);
    const visible = this.visiblePanels();
    for (let i = 0, l = visible.length; i < l; i++) {
      const shown = visible[i];
      if (shown.timing === 'refresh') {
        shown.sample?.();
        shown.draw(colors);
      }

      shown.describe();
    }

    if (this._mode === 'memory') this._panels.heap.draw(colors);
    this.drawZebra();
    if (this._mode === 'info') this._info?.update();
  }

  /**
   * Records one frame. Every `step` frames the slowest values of the group become one new column
   * and the visible graphs scroll by one; nothing is redrawn in between.
   */
  public pushFrame(interval: number, cpu: number, compiled = false): void {
    const p = this._pending;
    if (interval > 0) p.interval = Math.max(p.interval, interval);
    p.cpu = Math.max(p.cpu, cpu);
    p.compiled ||= compiled;
    if (++p.frames < this._step) return;

    const s = this._samples;
    if (p.interval > 0) {
      s.frame.push(p.interval);
      // 1: a shader compile (a tick), 2: a named event (a flag), 3: both.
      s.compiles.push((p.compiled ? 1 : 0) + (p.event ? 2 : 0));
    }

    s.cpu.push(p.cpu);
    // GPU results arrive late and irregularly: repeat the last one when a group has none.
    if (p.gpu >= 0) p.lastGpu = p.gpu;
    if (p.lastGpu >= 0) s.gpu.push(p.lastGpu);
    this.pushCounter(s.calls, 'calls');
    this.pushCounter(s.triangles, 'triangles');
    this.pushCounter(s.geometries, 'geometries');
    this.pushCounter(s.textures, 'textures');
    p.frames = 0;
    p.interval = -1;
    p.cpu = -1;
    p.gpu = -1;
    p.compiled = false;
    p.event = false;
    const custom = this._content.get(this._mode)?.graphs ?? [];
    for (let i = 0, l = custom.length; i < l; i++) {
      if (custom[i].timing === 'frame') custom[i].sample?.();
    }

    this.drawGraphs(false);
  }

  /** Flags the graph column being built with a named event (see `Stats.event()`). */
  public markEvent(): void {
    this._pending.event = true;
  }

  /** Sets a toggle plate from code; its onChange runs as on a click. */
  public setControl(id: string, active: boolean): void {
    for (let i = 0, l = this._toggles.length; i < l; i++) {
      if (this._toggles[i].definition.id === id) this._toggles[i].active = active;
    }
  }

  /** Records one GPU time sample; it joins the column being built. */
  public pushGpu(time: number): void {
    this._pending.gpu = Math.max(this._pending.gpu, time);
  }

  /**
   * Arranges the overlay for its size and mode, animating any change of arrangement:
   * - inline: counters and readouts bottom-left, the mode's graphs beside them;
   * - stacked: the graphs on their own row below the readouts;
   * - in Performance mode, when even the stacked row is too narrow, the frame, CPU and GPU graphs
   *   merge into one graph whose red, green and blue channels add up like light.
   * Call after the overlay is resized.
   */
  public layout(prior: Snapshot | null = null): void {
    const width = this.root.clientWidth;
    if (width === 0 || this.root.clientHeight === 0) return;
    const before = prior ?? (this._arrangement !== '' && !reducedMotion() ? snapshot(this.animated()) : null);
    const previous = this._arrangement;
    this._arrangement = this.arrange(width);
    if (before !== null && this._arrangement !== previous) play(before, this.root);
    this.drawGraphs(true);
    this._onLayout?.();
  }

  /**
   * Enables the INFO mode's pages: `build(index)` returns page `index` of `count`. The PAGE plate
   * joins the plates, visible only in INFO.
   */
  public setInfoSource(pages: number, build: (index: number) => InfoPage): void {
    this._info?.dispose();
    this._info = new InfoPanel(pages, build);
    this._pages.replaceChildren(this._info.element);
    this._plates.insertBefore(this._info.pager, this._control?.element ?? null);
    this.applyMode();
  }

  /** In INFO mode, the box the canvas should shrink into (overlay coordinates); otherwise null. */
  public thumbRect(): DOMRect | null {
    return this._mode === 'info' && this._thumb.offsetWidth > 0 ? this._thumb.getBoundingClientRect() : null;
  }

  public dispose(): void {
    this._info?.dispose();
    this._control?.dispose();
    for (let i = 0, l = this._toggles.length; i < l; i++) this._toggles[i].dispose();
    this._tooltip.dispose();
    window.removeEventListener('pointermove', this.onPointerMove);
    document.documentElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.root.remove();
  }

  private pushCounter(samples: Samples, id: 'calls' | 'triangles' | 'geometries' | 'textures'): void {
    const read = this._counterReads?.[id];
    if (read !== undefined) samples.push(read());
  }

  /** Repaints the zebra stripes from the last image copy; they crawl one step per refresh. */
  private drawZebra(): void {
    if (this._zebra.hidden === true) return;
    const pixels = this._imageSampler.pixels;
    const ctx = this._zebra.getContext('2d');
    if (ctx === null || pixels === null || !this._imageSampler.valid) return;
    this._zebraImage ??= ctx.createImageData(IMAGE_WIDTH, IMAGE_HEIGHT);
    zebraMask(pixels, this._zebraImage.data, this._zebraPhase++);
    ctx.putImageData(this._zebraImage, 0, 0);
  }

  private applyMode(): void {
    this.root.classList.toggle('tez-off', this._mode === 'off');
    this._zebra.hidden = !(this._zebraOn && this._mode === 'image');
    this._guides.hidden = !(this._guidesOn && this._mode === 'image');
    this._tips.hidden = this._mode === 'off' || this._findings === 0;
    this.root.classList.toggle('tez-info', this._mode === 'info');
    this.root.dataset['mode'] = this._mode;
    if (this._info !== null) {
      this._info.pager.hidden = this._mode !== 'info';
      if (this._mode === 'info') this._info.update(true);
    }
    // A page histogram next to a distribution: the bar's levels take the histogram's channel colours.
    const content = this._content.get(this._mode);
    const rgb = content !== undefined && content.distribution !== null && content.histogram !== null && content.histogram !== 'image';
    if (rgb) this.root.dataset['rgb'] = '';
    else this.root.removeAttribute('data-rgb');
    // Metrics scoped to some modes show only there.
    for (let i = 0, l = this._slots.length; i < l; i++) {
      const modes = this._slots[i].metric.modes;
      this._slots[i].element.hidden = modes !== undefined && !modes.includes(this._mode);
    }

    for (let i = 0, l = this._toggles.length; i < l; i++) {
      const modes = this._toggles[i].definition.modes;
      this._toggles[i].element.hidden = this._mode === 'off' || (modes !== undefined && !modes.includes(this._mode));
    }
  }

  /**
   * Every element that can move, appear or leave: readouts, counters, plates, top rows and the
   * panels of every mode (built-in and custom), so a component added later animates like the rest.
   */
  private animated(): HTMLElement[] {
    const elements: HTMLElement[] = [this._band, this._counters, this._backend, this._tips];
    for (let i = 0, l = this._toggles.length; i < l; i++) elements.push(this._toggles[i].element);
    for (let i = 0, l = this._slots.length; i < l; i++) {
      if (this._slots[i].metric.place === 'top') elements.push(this._slots[i].element);
    }

    const builtin = Object.values(this._panels);
    for (let i = 0, l = builtin.length; i < l; i++) elements.push(builtin[i].element);
    const contents = Array.from(this._content.values());
    for (let c = 0, cl = contents.length; c < cl; c++) {
      const content = contents[c];
      for (let i = 0, l = content.graphs.length; i < l; i++) elements.push(content.graphs[i].element);
      if (content.distribution !== null) elements.push(content.distribution.element);
      if (content.histogram !== null && content.histogram !== 'image') elements.push(content.histogram.element);
    }

    if (this._imagePanel !== null) elements.push(this._imagePanel.element);

    return elements;
  }

  private contentOf(id: StatsMode): Content {
    let content = this._content.get(id);
    if (content === undefined) {
      content = { graphs: [], distribution: null, histogram: null };
      this._content.set(id, content);
    }

    return content;
  }

  private builtinCount(id: StatsMode): number {
    if (id === 'performance' || id === 'memory') return 3;
    return id === 'mesh' ? 2 : 0;
  }

  /** The panels the current mode shows, in order: built-in graphs, custom graphs, distribution. */
  private visiblePanels(): Panel[] {
    const p = this._panels;
    let panels: Panel[] = [];
    if (this._mode === 'off') return panels;
    if (this._mode === 'performance') panels = this._merged ? [p.time] : [p.frame, p.cpu, p.gpu];
    else if (this._mode === 'mesh') panels = [p.calls, p.triangles];
    else if (this._mode === 'memory') panels = [p.heap, p.geometries, p.textures];
    const content = this._content.get(this._mode);
    if (content === undefined) return panels;
    panels = panels.concat(content.graphs);
    if (content.distribution !== null) panels.push(content.distribution);
    const histogram = this.histogram();
    if (histogram !== null) panels.push(histogram);
    return panels;
  }

  /** Draws the visible graphs; the heap graph only when asked (it scrolls per refresh, not per frame). */
  /**
   * Redraws the visible panels. Per graph column (`all` false) only the scrolling ones: refresh-timed
   * panels (histograms, distributions, the heap) change 4×/s and redraw in refresh().
   */
  private drawGraphs(all: boolean): void {
    if (this._mode === 'off') return;
    const colors = graphColors(this.root);
    const visible = this.visiblePanels();
    for (let i = 0, l = visible.length; i < l; i++) {
      if (all || (visible[i] !== this._panels.heap && visible[i].timing !== 'refresh')) visible[i].draw(colors);
    }
  }

  /** Tries inline, then stacked; Performance merges its graphs only when stacked does not fit. */
  private arrange(width: number): string {
    if (this._mode === 'off') return 'off';
    this._merged = false;
    this.placeThumb(width);
    this.resetLengths();
    this.placeDistribution(width);
    this.placeHistogram(width);
    this.showPanels();
    this._strip.classList.remove('tez-column');
    this.root.classList.remove('tez-stacked', 'tez-tight');
    const space = this.spacing();
    // Inline: the strip is centred between two equal columns, as wide as the wider of the
    // counters (left) and the backend + mode plates (right), with a column gap on each side.
    const side = Math.max(this._grid.offsetWidth, this._plates.offsetWidth);
    if (this._strip.offsetWidth <= width - space.edges - (side + space.column) * 2) return `${this._mode}-inline`;
    this.root.classList.add('tez-stacked');
    this.root.classList.toggle('tez-tight', this._grid.offsetWidth + space.column + this._plates.offsetWidth > width - space.edges);
    // Stacked: the strip has its own row at the top, under the readouts, edge to edge.
    const room = width - space.edges;
    if (this._strip.offsetWidth <= room) return `${this._mode}-stacked`;
    if (this._mode === 'performance') {
      // Merge only now: the three time graphs become one RGB graph, as wide as the row and taller
      // on narrow overlays, so every column and the lane under it read well on a phone.
      this._merged = true;
      this._timeGraph.setHeight(width < 640 ? NARROW_HEIGHT : HEIGHT);
      this.showPanels();
      const time = this._panels.time;
      const extra = time.element.offsetWidth - (time.length?.() ?? 0);
      time.resize?.(room - extra);
      if (this._strip.offsetWidth <= room) return `${this._mode}-merged`;
    }

    this._strip.classList.add('tez-column');
    this.fitColumn(room);
    return `${this._mode}-column`;
  }

  /** Edge padding (left + right) and the grid column gap, read from the CSS spacing scale. */
  private spacing(): { edges: number; column: number } {
    const style = getComputedStyle(this.root);
    return {
      edges: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
      column: parseFloat(style.columnGap)
    };
  }

  /** Restores the default graph lengths before a new arrangement is measured. */
  private resetLengths(): void {
    const panels = Object.values(this._panels);
    for (let i = 0, l = panels.length; i < l; i++) panels[i].resize?.(panels[i] === this._panels.time ? MERGED : GRAPH);
    const contents = Array.from(this._content.values());
    for (let c = 0, cl = contents.length; c < cl; c++) {
      for (let i = 0, l = contents[c].graphs.length; i < l; i++) contents[c].graphs[i].resize?.(GRAPH);
    }
  }

  /** Column: shrink graphs that are still wider than the room beside the plates (never below 96px). */
  private fitColumn(room: number): void {
    const visible = this.visiblePanels();
    for (let i = 0, l = visible.length; i < l; i++) {
      const item = visible[i];
      if (item.resize === undefined || item.length === undefined) continue;
      const extra = item.element.offsetWidth - item.length();
      if (item.element.offsetWidth > room) item.resize(Math.max(96, room - extra));
    }
  }

  private showPanels(): void {
    const visible = this.visiblePanels();
    const distribution = this._content.get(this._mode)?.distribution ?? null;
    const histogram = this.histogram();
    const elements: HTMLElement[] = [];
    for (let i = 0, l = visible.length; i < l; i++) {
      if (visible[i] === histogram) continue;
      if (!(this._distributionOnSide && visible[i] === distribution)) elements.push(visible[i].element);
    }

    this._strip.replaceChildren(...elements);
  }

  /**
   * Gives the canvas the image histogram reads; `stats.end()` passes the renderer's canvas.
   * The capture runs inside `refresh()`, i.e. in the same task as the render.
   */
  public setImageSource(canvas: HTMLCanvasElement): void {
    this._imageSource = canvas;
  }

  /** The current mode's large histogram, if any (the shared image one is created on first use). */
  private histogram(): HistogramPanel | null {
    const histogram = this._content.get(this._mode)?.histogram ?? null;
    if (histogram !== 'image') return histogram;
    this._imagePanel ??= imageHistogramPanel(this._imageSampler, () => this._imageSource !== null && this._imageSampler.capture(this._imageSource));
    return this._imagePanel;
  }

  /**
   * INFO mode: sizes the thumbnail cell to the canvas aspect, 46% of the overlay width on large
   * screens (at most 720px), edge to edge on narrow ones. Elsewhere the cell collapses.
   */
  private placeThumb(width: number): void {
    const source = this._imageSource;
    if (this._mode !== 'info' || source === null || source.height === 0) {
      this._thumb.style.width = '';
      this._thumb.style.height = '';
      return;
    }

    const edges = this.spacing().edges;
    const narrow = width < 720;
    const aspect = source.width / source.height;
    // At most 40% of the height, so a portrait canvas never fills a phone screen.
    const maxWidth = this.root.clientHeight * 0.4 * aspect;
    const w = Math.round(Math.min(maxWidth, narrow ? width - edges : Math.min(720, Math.max(240, width * 0.46))));
    this._thumb.style.width = `${w}px`;
    this._thumb.style.height = `${Math.round(w / aspect)}px`;
    this.root.classList.toggle('tez-info-narrow', narrow);
  }

  /** Puts the mode's histogram in its top-left cell, as wide as the overlay allows (at most 256px). */
  private placeHistogram(width: number): void {
    const histogram = this.histogram();
    if (histogram === null) {
      this._hist.replaceChildren();
      return;
    }

    histogram.setWidth(HISTOGRAM_WIDTH);
    this._hist.replaceChildren(histogram.element);
    const extra = histogram.element.offsetWidth - HISTOGRAM_WIDTH;
    // INFO: the histogram spans the thumbnail above it.
    if (this._mode === 'info' && this._thumb.offsetWidth > 0) histogram.setWidth(this._thumb.offsetWidth - extra);
    const room = width - this.spacing().edges;
    if (histogram.element.offsetWidth > room) histogram.setWidth(room - extra);
  }

  /**
   * A mode's distribution goes vertical on the right edge when the overlay is large enough
   * (bar at most 35% of the height, 260px); otherwise it joins the bottom strip, horizontal.
   */
  private placeDistribution(width: number): void {
    const distribution = this._content.get(this._mode)?.distribution ?? null;
    const height = this.root.clientHeight;
    this._distributionOnSide = distribution !== null && width >= 720 && height >= 420;
    if (distribution === null) {
      this._side.replaceChildren();
      return;
    }

    if (this._distributionOnSide) {
      distribution.orient?.(true, Math.round(Math.min(260, Math.max(120, height * 0.35))));
      this._side.replaceChildren(distribution.element);
    } else {
      distribution.orient?.(false, 132);
      this._side.replaceChildren();
    }
  }

  private buildPanels(): Record<PanelName, Panel> {
    const s = this._samples;
    const b = this._budget;
    const merged = el('span', 'tez-stack');
    merged.append(el('span', 'tez-frame', 'FRM'), el('span', 'tez-gpu', 'GPU'), el('span', 'tez-cpu', 'CPU'));
    return {
      frame: panel(new TimeGraph(b, [{ samples: s.frame }], { width: GRAPH, height: HEIGHT, vertical: false, autoScale: false, events: s.compiles, label: '' }),
        stack('FRM', 'MS'), 'MS', ms, s.frame,
        'Frame time, one column per frame, newest on the right: white on time, yellow when one refresh was missed, red when two or more were. '
        + 'The side ticks mark the budget; a tick above a column marks a frame that created a new shader program.', frameTip(b, s.frame)),
      cpu: panel(graph([{ samples: s.cpu, color: 'cpu' }], b, true, [s.gpu]), stack('MS', 'CPU', 'tez-cpu'), 'MS', ms, s.cpu,
        'CPU time per frame, newest on the right. CPU and GPU share one scale.', seriesTip('cpu', b, s.cpu)),
      gpu: panel(graph([{ samples: s.gpu, color: 'gpu' }], b, true, [s.cpu]), stack('MS', 'GPU', 'tez-gpu'), 'MS', ms, s.gpu,
        'GPU time per frame, newest on the right. CPU and GPU share one scale.', seriesTip('gpu', b, s.gpu)),
      time: panel(this._timeGraph, merged, 'MS', ms, s.frame, 'Frame (blue), GPU (green) and CPU (red) time in one graph, each scaled between its own recent min and max '
      + 'so the three always mix: overlaps add up to cyan, yellow, magenta and white. It shows when each one moves, not how big it is; '
      + 'the readouts above give the values. A tick above a column marks a frame that created a new shader program.', mergedTip(b, s)),
      calls: panel(graph([{ samples: s.calls, color: 'ink' }], Infinity, true), stack('DRAW', 'CALLS'), 'calls', count, s.calls,
        'Draw calls per frame over time.'),
      triangles: panel(graph([{ samples: s.triangles, color: 'ink' }], Infinity, true), stack('TRI', 'COUNT'), 'tris', count, s.triangles,
        'Triangles per frame over time.'),
      heap: panel(graph([{ samples: s.heap, color: 'ink' }], Infinity, true), stack('MB', 'HEAP'), 'MB', mb, s.heap,
        'Used JS heap over time, one column per refresh. A line that keeps climbing points to a leak.'),
      geometries: panel(graph([{ samples: s.geometries, color: 'ink' }], Infinity, true), stack('GEO', 'MEM'), 'geo', count, s.geometries,
        'Geometries in GPU memory over time. Steady growth means geometries are created and never disposed.'),
      textures: panel(graph([{ samples: s.textures, color: 'ink' }], Infinity, true), stack('TEX', 'MEM'), 'tex', count, s.textures,
        'Textures in GPU memory over time. Steady growth means textures are created and never disposed.')
    };
  }

  private gridSlot(metric: StatsMetric): Slot {
    const element = metric.tip === undefined ? hit(el('span', 'tez-pair'), metric.label) : setTip(el('span', 'tez-pair'), metric.tip);
    const value = num(metric.width ?? 4);
    const glyph = metric.glyph ?? 'calls';
    const spec: GlyphSpec = typeof glyph === 'string' ? GLYPHS[glyph] : glyph;
    // Free silhouettes get a dark contour; plates keep only their white border.
    const icon = createGlyphFromSpec(spec, { label: metric.label, outline: true }, typeof glyph === 'string' ? glyph : metric.id);
    element.append(icon, value);
    this._grid.append(element);
    return { metric, element, value, text: '', alert: false, read: safeRead(metric.id, metric.read, finite) };
  }

  private topSlot(metric: StatsMetric): Slot {
    const element = metric.tip === undefined ? hit(el('span', 'tez-row'), metric.label) : setTip(el('span', 'tez-row'), metric.tip);
    const value = num(metric.width ?? 4);
    element.append(value);
    if (metric.unit !== undefined) element.append(el('span', 'tez-unit', metric.unit));
    if (metric.plate !== undefined) element.append(createPlate(metric.plate, metric.label));
    this._rows.append(element);
    return { metric, element, value, text: '', alert: false, read: safeRead(metric.id, metric.read, finite) };
  }
}

function readout(tip: TipContent, label: HTMLElement, width: number): Writable {
  const element = setTip(el('span', 'tez-value'), tip);
  const value = num(width);
  element.append(label, value);
  return { element, value, text: '', alert: false };
}

function graph(series: readonly Series[], budget: number, autoScale: boolean, scaleWith: readonly Samples[] = [], length = GRAPH): TimeGraph {
  return new TimeGraph(budget, series, { width: length, height: HEIGHT, vertical: false, autoScale, scaleWith, label: '' });
}

/** Built-in graph panel: the shared panel shape, with the arguments in the order the table above reads. */
function panel(timeGraph: TimeGraph, label: HTMLElement, unit: string, format: (v: number | null) => string, data: Samples, tip: string, rich?: TipContent): Panel {
  return graphPanel(timeGraph, label, unit, format, data, tip, rich);
}

type LastValues = () => { frame: FrameValues; thresholds: FrameThresholds };
const orDash = (value: number | null | undefined, format: (v: number) => string): string => (value === null || value === undefined ? '—' : format(value));

function fpsTip(budget: number, last: LastValues): TipContent {
  return {
    title: 'Frames per second',
    text: 'Frames drawn per second, averaged over the last refresh (4 times a second). Averages hide stutter: read P95 and DROP in Performance.',
    legend: [{ mark: 'ink', text: 'At or near the target rate' }, { mark: 'alert', text: 'Below the alert bound (default 90% of the target)' }],
    values: () => {
      const { frame, thresholds } = last();
      return [['Now', orDash(frame.fps, formatInt)], ['Target', `${formatInt(1000 / budget)} fps`], ['Alert below', orDash(thresholds.fps?.below, formatInt)]];
    }
  };
}

function timeTip(kind: 'cpu' | 'gpu', budget: number, last: LastValues): TipContent {
  const cpu = kind === 'cpu';
  return {
    title: cpu ? 'CPU time per frame' : 'GPU time per frame',
    text: cpu
      ? 'JavaScript time from stats.begin() to stats.end(): scene updates, culling and command submission.'
      : 'Time the GPU spent on the frame, from timer queries. Results arrive a few frames late.',
    legend: [
      { mark: 'ink', text: 'Dial: share of the frame budget; a full disk is over budget' },
      ...(cpu ? [] : [{ mark: 'ink' as const, text: 'Dashed dial: this browser exposes no GPU timer (WebGPU needs trackTimestamp: true)' }]),
      { mark: 'alert', text: 'Above the alert bound (default: the budget)' }
    ],
    values: () => {
      const value = cpu ? last().frame.cpu : last().frame.gpu;
      return [['Now', orDash(value, (v) => `${formatMs(v)} ms`)], ['Budget', `${formatMs(budget)} ms`], ['Share', orDash(value, (v) => `${formatInt((v / budget) * 100)}%`)]];
    },
    advice: cpu
      ? 'Split the frame with stats.mark() to find the slow part; move heavy work out of the loop or into a worker.'
      : 'GPU-bound: lower the pixel ratio, shadow map sizes or overdraw (transparent layers) first.'
  };
}

/** Recent range of a series as tooltip rows. */
function rangeRows(samples: Samples, budget: number): (readonly [string, string])[] {
  const n = 128;
  return [['Recent max', orDash(samples.max(n), (v) => `${formatMs(v)} ms`)], ['Recent min', orDash(samples.min(n), (v) => `${formatMs(v)} ms`)], ['Budget', `${formatMs(budget)} ms`]];
}

function frameTip(budget: number, frame: Samples): TipContent {
  return {
    title: 'Frame time',
    text: 'Time between frames, newest on the right. Each column keeps the slowest of its frames, so no spike is hidden.',
    legend: [
      { mark: 'ink', text: 'On time' },
      { mark: 'alert', text: 'Missed one screen refresh (past 1.25× the budget)' },
      { mark: 'clip', text: 'Missed two or more: the stutter users see' },
      { mark: 'budget-tick', text: 'The frame budget' },
      { mark: 'event-tick', text: 'A new shader program was created in that frame' },
      { mark: 'flag-tick', text: 'An event the app marked with stats.event()' }
    ],
    values: () => rangeRows(frame, budget),
    advice: 'A red column under a top tick is a shader compile: warm up with renderer.compileAsync(scene, camera) before showing the scene.'
  };
}

function seriesTip(kind: 'cpu' | 'gpu', budget: number, samples: Samples): TipContent {
  const cpu = kind === 'cpu';
  return {
    title: cpu ? 'CPU time graph' : 'GPU time graph',
    text: 'One column per group of frames, newest on the right. CPU and GPU share one scale, so the taller one is the bottleneck.',
    legend: [{ mark: kind, text: cpu ? 'CPU time per frame' : 'GPU time per frame' }, { mark: 'budget-tick', text: 'The frame budget' }],
    values: () => rangeRows(samples, budget)
  };
}

function mergedTip(budget: number, s: { frame: Samples; cpu: Samples; gpu: Samples }): TipContent {
  return {
    title: 'Frame, GPU and CPU',
    text: 'The three times in one graph, each scaled to its own recent min and max: it shows when each one moves, not how big it is. The readouts give the values.',
    legend: [
      { mark: 'frame', text: 'Frame time' },
      { mark: 'gpu', text: 'GPU time' },
      { mark: 'cpu', text: 'CPU time' },
      { mark: 'ink', text: 'All three peak together (colours add like light)' },
      { mark: 'lane', text: 'Lane under the box: yellow missed one refresh, red two or more' },
      { mark: 'event-tick', text: 'A new shader program was created' },
      { mark: 'flag-tick', text: 'An event the app marked with stats.event()' }
    ],
    values: () => [
      ['Frame max', orDash(s.frame.max(128), (v) => `${formatMs(v)} ms`)],
      ['GPU max', orDash(s.gpu.max(128), (v) => `${formatMs(v)} ms`)],
      ['CPU max', orDash(s.cpu.max(128), (v) => `${formatMs(v)} ms`)],
      ['Budget', `${formatMs(budget)} ms`]
    ]
  };
}

function heapTip(last: LastValues): TipContent {
  return {
    title: 'JS heap',
    text: 'Memory used by JavaScript objects, in MB. Chromium only; — elsewhere. Not GPU memory.',
    legend: [{ mark: 'ink', text: 'A slow sawtooth is normal garbage collection' }],
    values: () => [['Now', orDash(last().frame.heap, (v) => `${formatInt(v)} MB`)]],
    advice: 'A line that keeps climbing points to a leak; a fast sawtooth means new objects every frame: reuse vectors and matrices.'
  };
}
