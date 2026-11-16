import { checkControl, Toggle } from './controls.js';
import { checkDistribution, checkGraph, checkHistogram, checkMetric, safeFormat, customGraphPanel, distributionPanel, finite, graphPanel, safeRead, warnOnce, type Panel } from './custom.js';
import { HISTOGRAM_WIDTH, histogramPanel, type HistogramPanel } from './histogram-panel.js';
import { el, graphColors, hit, num, stack, TimeReadout, write, type Writable } from './dom.js';
import { play, reducedMotion, snapshot, type Snapshot } from './flip.js';
import { formatCount, formatInt, formatMs, isAlert, type Threshold } from './format.js';
import { createGlyphFromSpec, createPlate, GLYPHS, type GlyphSpec } from './glyphs.js';
import { Samples, TimeGraph, type Series } from './graphs.js';
import { findMode, ModeControl, MODES, type MenuToggle, type ModeInfo } from './modes.js';
import type { BackendKind } from './sampler.js';
import { injectStyles, releaseStyles } from './styles.js';
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
  /** The large top-left histogram of a custom mode. */
  histogram: HistogramPanel | null;
}

type PanelName = 'frame' | 'cpu' | 'gpu';

/**
 * What each built-in mode adds; modes are cumulative. Simple: FPS and CPU / GPU time. Performance:
 * plus the heap and the counters. Graph: plus the time graphs and the pacing rows. Custom modes
 * keep the Performance readouts and add their own content.
 */
function shows(mode: StatsMode): { heap: boolean; counters: boolean; graphs: boolean } {
  if (mode === 'simple') return { heap: false, counters: false, graphs: false };
  return { heap: true, counters: true, graphs: mode === 'graph' };
}

const BACKEND_PLATES: Record<BackendKind, [string, string]> = {
  webgl: ['GL2', 'WebGLRenderer (WebGL 2)'],
  webgpu: ['WGPU', 'WebGPURenderer (WebGPU)'],
  'webgpu-webgl': ['GL2', 'WebGPURenderer (WebGL 2 fallback)']
};

/** Graph sizes: the bottom edge belongs to the graphs now, so they can be generous. */
const GRAPH = 132;
const HEIGHT = 32;
/** Compact graphs (a phone) never get narrower than this. */
const MIN_GRAPH = 48;

const ms = (value: number | null): string => (value === null ? '—' : formatMs(value));
const mb = (value: number | null): string => (value === null ? '—' : formatInt(value));

export class Overlay {
  public readonly root: HTMLDivElement;

  private readonly _backend = el('span', 'tez-backend');
  /** Backend plate and the mode plate, bottom-right. */
  private readonly _plates = el('div', 'tez-c tez-c-backend');
  private readonly _toggles: Toggle[] = [];
  /** Top-left column: the readouts, then a custom mode's rows, histogram, graphs and distribution, packed. */
  private readonly _left = el('div', 'tez-c tez-c-left');
  private readonly _rows = el('div', 'tez-rows');
  private readonly _counters = el('div', 'tez-c tez-c-counters');
  private readonly _grid = el('div', 'tez-grid');
  /** FPS, CPU, GPU and heap on one row, top-left. */
  private readonly _band = el('div', 'tez-c-band tez-band');
  private readonly _strip = el('div', 'tez-c tez-c-strip tez-strip');
  /** In the left column: the large histogram of a custom mode. */
  private readonly _hist = el('div', 'tez-c-hist');
  /** In the left column: a custom mode's graphs and distribution. */
  private readonly _custom = el('div', 'tez-c-custom');
  private readonly _slots: Slot[] = [];
  private readonly _fps: Writable;
  private readonly _heap: Writable;
  private readonly _cpu: TimeReadout;
  private readonly _gpu: TimeReadout;
  private readonly _samples = {
    frame: new Samples(), cpu: new Samples(), gpu: new Samples(),
    /** 1 for a column whose frames created a shader program, 2 for an event, 3 both; aligned with `frame`. */
    compiles: new Samples()
  };

  private readonly _panels: Record<PanelName, Panel>;
  private readonly _budget: number;
  private readonly _step: number;
  private readonly _control: ModeControl | null;
  private readonly _tooltip: Tooltip;
  /** Built-in modes plus custom ones, in mode order ('off' always last). */
  private readonly _modes: ModeInfo[] = [...MODES];
  private readonly _content = new Map<StatsMode, Content>();
  private _mode: StatsMode;
  /** The plate row has no room for the toggles: they move into the mode menu. */
  private _folded = false;
  /** Current arrangement; a change triggers the FLIP transition. */
  private _arrangement = '';
  /** Values of the last refresh, read by the live rows of the readout tooltips. */
  /** Ids of the custom graphs added so far, to refuse duplicates. */
  private readonly _graphIds = new Set<string>();
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

    // Atomic tooltips: what the number is, nothing more.
    this._fps = readout({ title: 'FPS', text: 'Frames per second.' }, stack('AVG', 'FPS'), 3);
    this._heap = readout({ title: 'JS heap', text: 'MB used by JavaScript.' }, stack('MB', 'HEAP'), 4);
    this._cpu = new TimeReadout(setTip(el('span', 'tez-value'), { title: 'CPU time', text: 'Per frame, in ms.' }), 'CPU frame time', 4);
    this._cpu.element.append(this._cpu.dial, stack('MS', 'CPU', 'tez-cpu'), this._cpu.value);
    this._gpu = new TimeReadout(setTip(el('span', 'tez-value'), { title: 'GPU time', text: 'Per frame, in ms.' }), 'GPU frame time', 4);
    this._gpu.element.append(this._gpu.dial, stack('MS', 'GPU', 'tez-gpu'), this._gpu.value);
    this._band.append(this._fps.element, this._cpu.element, this._gpu.element, this._heap.element);

    this._panels = this.buildPanels();
    this._control = interactive
      ? new ModeControl(this._mode, () => this._modes, (mode) => {
          this.setMode(mode);
          options.onModeChange?.(mode);
        }, () => this.menuToggles())
      : null;

    this._plates.append(this._backend);
    if (this._control !== null) this._plates.append(this._control.element);
    this._counters.append(this._grid);
    this._left.append(this._band, this._rows, this._hist, this._custom);
    this.root.append(this._left, this._counters, this._strip, this._plates);
    this._tooltip = new Tooltip(this.root);
    this.applyMode();
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
    const histogramProblem = definition.histogram === undefined ? null : checkHistogram(definition.histogram);
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

    if (content.histogram !== undefined) {
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

  /** Removes a toggle plate added with addControl(). */
  public removeControl(id: string): void {
    for (let i = 0, l = this._toggles.length; i < l; i++) {
      if (this._toggles[i].definition.id !== id) continue;
      this._toggles[i].dispose();
      this._toggles.splice(i, 1);
      if (this.root.isConnected) this.layout();
      return;
    }
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
   * Arranges the overlay for its size and mode, animating any change of arrangement. A custom
   * mode's content always packs into the top-left column under the readouts. The frame, CPU and
   * GPU graphs of Graph mode go:
   * - inline: bottom-centre, between the counters and the plates;
   * - stacked: on their own row under the readouts;
   * - compact: still all three in that row, each narrower, with a short label above and no scale.
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
  }

  public dispose(): void {
    this._control?.dispose();
    for (let i = 0, l = this._toggles.length; i < l; i++) this._toggles[i].dispose();
    this._tooltip.dispose();
    this.root.remove();
    releaseStyles(document);
  }

  private applyMode(): void {
    this.root.classList.toggle('tez-off', this._mode === 'off');
    this.root.dataset['mode'] = this._mode;
    const show = shows(this._mode);
    this._heap.element.hidden = !show.heap;
    this._counters.hidden = !show.counters;
    // A page histogram next to a distribution: the bar's levels take the histogram's channel colours.
    const content = this._content.get(this._mode);
    const rgb = content !== undefined && content.distribution !== null && content.histogram !== null;
    if (rgb) this.root.dataset['rgb'] = '';
    else this.root.removeAttribute('data-rgb');
    // Metrics scoped to some modes show only there.
    for (let i = 0, l = this._slots.length; i < l; i++) {
      const modes = this._slots[i].metric.modes;
      this._slots[i].element.hidden = modes !== undefined && !modes.includes(this._mode);
    }

    for (let i = 0, l = this._toggles.length; i < l; i++) {
      this._toggles[i].element.hidden = this._folded || !this.toggleShown(this._toggles[i]);
    }
  }

  private toggleShown(toggle: Toggle): boolean {
    const modes = toggle.definition.modes;
    return this._mode !== 'off' && (modes === undefined || modes.includes(this._mode));
  }

  /** The toggles of this mode as menu rows, while they are folded into the menu. */
  private menuToggles(): MenuToggle[] {
    const out: MenuToggle[] = [];
    if (!this._folded) return out;
    for (let i = 0, l = this._toggles.length; i < l; i++) {
      const toggle = this._toggles[i];
      if (!this.toggleShown(toggle)) continue;
      out.push({
        label: toggle.definition.label,
        description: toggle.definition.description,
        active: toggle.active,
        set: (active) => {
          toggle.active = active;
        }
      });
    }

    return out;
  }

  /** Folds the toggles into the mode menu, or brings them back next to the plate. */
  private setFolded(folded: boolean): void {
    if (folded === this._folded) return;
    this._folded = folded;
    this.root.classList.toggle('tez-folded', folded);
    this.applyMode();
    this._control?.refresh();
  }

  /**
   * Every element that can move, appear or leave: readouts, counters, plates, top rows and the
   * panels of every mode (built-in and custom), so a component added later animates like the rest.
   */
  private animated(): HTMLElement[] {
    const elements: HTMLElement[] = [this._band, this._heap.element, this._counters, this._backend, this._rows];
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
      if (content.histogram !== null) elements.push(content.histogram.element);
    }

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
    return shows(id).graphs ? 3 : 0;
  }

  /** The panels the current mode shows, in order: built-in graphs, custom graphs, distribution. */
  private visiblePanels(): Panel[] {
    const p = this._panels;
    let panels: Panel[] = [];
    if (this._mode === 'off') return panels;
    if (shows(this._mode).graphs) panels = [p.frame, p.cpu, p.gpu];
    const content = this._content.get(this._mode);
    if (content === undefined) return panels;
    panels = panels.concat(content.graphs);
    if (content.distribution !== null) panels.push(content.distribution);
    const histogram = this.histogram();
    if (histogram !== null) panels.push(histogram);
    return panels;
  }

  /**
   * Redraws the visible panels. Per graph column (`all` false) only the scrolling ones: refresh-timed
   * panels (histograms, distributions) change 4×/s and redraw in refresh().
   */
  private drawGraphs(all: boolean): void {
    if (this._mode === 'off') return;
    const colors = graphColors(this.root);
    const visible = this.visiblePanels();
    for (let i = 0, l = visible.length; i < l; i++) {
      if (all || visible[i].timing !== 'refresh') visible[i].draw(colors);
    }
  }

  /** Tries inline, then stacked, then compact; custom content always packs top-left. */
  private arrange(width: number): string {
    if (this._mode === 'off') return 'off';
    this.setFolded(false);
    this.resetLengths();
    this._strip.classList.remove('tez-compact');
    this.root.classList.remove('tez-stacked', 'tez-tight');
    this.placeHistogram(width);
    this.showPanels();
    const space = this.spacing();
    const room = width - space.edges;
    this.fitCustom(room);
    // The plate row must fit on its own: otherwise the toggles move into the mode menu.
    if (this._plates.offsetWidth > room) this.setFolded(true);
    // Counters and plates side by side, or the plates above the counters when they do not fit.
    const tight = this._grid.offsetWidth + space.column + this._plates.offsetWidth > room;
    const arrangement = this.arrangeStrip(room, space.column, tight);
    this.fitLeft();
    return arrangement;
  }

  private arrangeStrip(room: number, column: number, tight: boolean): string {
    if (this._strip.childElementCount === 0) {
      if (tight) this.root.classList.add('tez-stacked', 'tez-tight');
      return `${this._mode}-plain${tight ? '-tight' : ''}`;
    }

    // Inline: the strip is centred between two equal columns, as wide as the wider of the
    // counters (left) and the backend + mode plates (right), with a column gap on each side.
    const side = Math.max(this._grid.offsetWidth, this._plates.offsetWidth);
    if (this._strip.offsetWidth <= room - (side + column) * 2) return `${this._mode}-inline`;
    this.root.classList.add('tez-stacked');
    this.root.classList.toggle('tez-tight', tight);
    if (this._strip.offsetWidth <= room) return `${this._mode}-stacked`;
    // Compact: the three graphs keep sharing one row, narrower, labels above, no scale column.
    this._strip.classList.add('tez-compact');
    this.fitCompact(room);
    return `${this._mode}-compact`;
  }

  /**
   * The left column never pushes the bottom row off screen: taller than the room above it, it
   * wraps into a second column.
   */
  private fitLeft(): void {
    this._left.style.maxHeight = '';
    const style = getComputedStyle(this.root);
    const gap = px(style.rowGap);
    const stacked = this.root.classList.contains('tez-stacked');
    const counters = this._counters.hidden === true ? 0 : this._counters.offsetHeight;
    const bottom = this.root.classList.contains('tez-tight')
      ? counters + gap + this._plates.offsetHeight
      : Math.max(counters, this._plates.offsetHeight, stacked ? 0 : this._strip.offsetHeight);
    const strip = stacked && this._strip.childElementCount > 0 ? this._strip.offsetHeight + gap : 0;
    const room = this.root.clientHeight - px(style.paddingTop) - px(style.paddingBottom) - bottom - gap - strip;
    if (this._left.offsetHeight > room) this._left.style.maxHeight = `${Math.max(0, Math.floor(room))}px`;
  }

  /** Compact strip: every graph gets an equal share of the row. */
  private fitCompact(room: number): void {
    const visible = this.visiblePanels();
    const inStrip: Panel[] = [];
    for (let i = 0, l = visible.length; i < l; i++) if (visible[i].element.parentElement === this._strip) inStrip.push(visible[i]);
    const gap = px(getComputedStyle(this._strip).columnGap);
    const share = Math.floor((room - gap * (inStrip.length - 1)) / inStrip.length);
    for (let i = 0, l = inStrip.length; i < l; i++) {
      const item = inStrip[i];
      if (item.resize === undefined || item.length === undefined) continue;
      const extra = item.element.offsetWidth - item.length();
      item.resize(Math.max(MIN_GRAPH, share - extra));
    }
  }

  /** Custom graphs and the distribution never overflow the left column. */
  private fitCustom(room: number): void {
    const content = this._content.get(this._mode);
    if (content === undefined) return;
    const panels = content.distribution === null ? content.graphs : [...content.graphs, content.distribution];
    for (let i = 0, l = panels.length; i < l; i++) {
      const item = panels[i];
      if (item.element.offsetWidth <= room || item.length === undefined) continue;
      const extra = item.element.offsetWidth - item.length();
      if (item.resize !== undefined) item.resize(Math.max(MIN_GRAPH, room - extra));
      else item.orient?.(false, Math.max(MIN_GRAPH, room - extra));
    }
  }

  /** Edge padding (left + right) and the grid column gap, read from the CSS spacing scale. */
  private spacing(): { edges: number; column: number } {
    const style = getComputedStyle(this.root);
    return {
      edges: px(style.paddingLeft) + px(style.paddingRight),
      column: px(style.columnGap)
    };
  }

  /** Restores the default graph lengths before a new arrangement is measured. */
  private resetLengths(): void {
    const panels = Object.values(this._panels);
    for (let i = 0, l = panels.length; i < l; i++) panels[i].resize?.(GRAPH);
    const contents = Array.from(this._content.values());
    for (let c = 0, cl = contents.length; c < cl; c++) {
      for (let i = 0, l = contents[c].graphs.length; i < l; i++) contents[c].graphs[i].resize?.(GRAPH);
      contents[c].distribution?.orient?.(false, GRAPH);
    }
  }

  /** Built-in graphs into the strip; a custom mode's graphs and distribution into the left column. */
  private showPanels(): void {
    const builtin = shows(this._mode).graphs ? [this._panels.frame, this._panels.cpu, this._panels.gpu] : [];
    const strip: HTMLElement[] = [];
    for (let i = 0, l = builtin.length; i < l; i++) strip.push(builtin[i].element);
    const content = this._content.get(this._mode);
    const custom: HTMLElement[] = [];
    if (content !== undefined) {
      for (let i = 0, l = content.graphs.length; i < l; i++) custom.push(content.graphs[i].element);
      if (content.distribution !== null) custom.push(content.distribution.element);
    }

    // Extensions of the Graph mode join its strip; a custom mode's content packs top-left.
    if (shows(this._mode).graphs) {
      this._strip.replaceChildren(...strip, ...custom);
      this._custom.replaceChildren();
    } else {
      this._strip.replaceChildren();
      this._custom.replaceChildren(...custom);
    }
  }

  /** The current mode's large histogram, if any. */
  private histogram(): HistogramPanel | null {
    return this._content.get(this._mode)?.histogram ?? null;
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
    const room = width - this.spacing().edges;
    if (histogram.element.offsetWidth > room) histogram.setWidth(room - extra);
  }

  private buildPanels(): Record<PanelName, Panel> {
    const s = this._samples;
    const b = this._budget;
    // No tooltips on these graphs: the colours and the readouts above say it all.
    return {
      frame: panel(new TimeGraph(b, [{ samples: s.frame }], { width: GRAPH, height: HEIGHT, vertical: false, autoScale: false, events: s.compiles, label: '' }),
        graphLabel('FRM'), 'MS', ms, s.frame, 'Frame time per column, white on time, yellow and red when late.'),
      cpu: panel(graph([{ samples: s.cpu, color: 'cpu' }], b, true, [s.gpu]), graphLabel('CPU', 'tez-cpu'), 'MS', ms, s.cpu, 'CPU time per frame.'),
      gpu: panel(graph([{ samples: s.gpu, color: 'gpu' }], b, true, [s.cpu]), graphLabel('GPU', 'tez-gpu'), 'MS', ms, s.gpu, 'GPU time per frame.')
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

/** A computed length in px; 0 when the engine leaves it unresolved (e.g. a max() with env()). */
function px(value: string): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

/** Built-in graph panel: no tooltip, the description goes to assistive technology only. */
function panel(timeGraph: TimeGraph, label: HTMLElement, unit: string, format: (v: number | null) => string, data: Samples, description: string): Panel {
  return graphPanel(timeGraph, label, unit, format, data, description, undefined, false);
}

/** A graph label: the unit on top, the name under it (the only line kept in compact graphs). */
function graphLabel(name: string, color = ''): HTMLSpanElement {
  const node = el('span', 'tez-stack');
  node.append(el('span', 'tez-graph-unit', 'MS'), el('span', `tez-graph-name ${color}`.trim(), name));
  return node;
}
