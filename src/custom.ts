/**
 * Custom graphs and distributions: validation, failure-proof reads and their panels.
 * Built-in and custom graphs end up as the same `Panel` shape, so the layout treats them alike.
 */

import { el, hit, setLabel, setText, stack } from './dom.js';
import { formatBytes, formatCount, formatMs, formatPercent } from './format.js';
import { Samples, TimeGraph, type GraphColors } from './graphs.js';
import { setTip } from './tooltip.js';
import { GLYPHS } from './glyphs.js';
import type { DistributionDefinition, GraphDefinition, HistogramDefinition, StatsMetric, TipContent } from './types.js';

/** A graph or bar with its two-line label on the left and its scale on the right. */
export interface Panel {
  element: HTMLElement;
  /** Redraws the visual (graph or bar). */
  draw: (colors: GraphColors) => void;
  /** Updates the scale label and the text alternative. */
  describe: () => void;
  /** For custom panels: reads one sample. Built-in panels are fed by the overlay. */
  sample?: () => void;
  /** 'frame' panels sample with each graph column, 'refresh' panels with each text refresh. */
  timing?: 'frame' | 'refresh';
  /** Graph panels: the graph box length, and a way to change it (to fit narrow overlays). */
  length?: () => number;
  resize?: (px: number) => void;
  /** Distribution panels only: vertical (on a side edge, with a per-level list) or horizontal, and the bar length. */
  orient?: (vertical: boolean, length: number) => void;
}

const MAX_FAILURES = 5;
const warned = new Set<string>();

/** Logs a problem once per message, prefixed so it is easy to find. */
export function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`@three.ez/stats: ${message}`);
}

/**
 * Wraps a user `read` so it can never break a frame: exceptions and non-finite numbers become
 * null ("—"), and after repeated exceptions the read is switched off with one warning.
 */
export function safeRead<T>(id: string, read: () => T | null, valid: (value: T) => boolean): () => T | null {
  let failures = 0;
  return () => {
    if (failures >= MAX_FAILURES) return null;
    try {
      const value = read();
      // undefined too: a read that forgot its return, or data not loaded yet, is "—", not a failure.
      return value !== null && value !== undefined && valid(value) ? value : null;
    } catch (error) {
      failures++;
      if (failures >= MAX_FAILURES) warnOnce(`"${id}" threw ${MAX_FAILURES} times and was switched off (${String(error)}).`);
      return null;
    }
  };
}

export const finite = (value: number): boolean => Number.isFinite(value);

/** Wraps a user `format` so it can never break a refresh: after one throw the default format takes over, with a warning. */
export function safeFormat(id: string, format: (value: number) => string): (value: number) => string {
  let failed = false;
  return (value) => {
    if (failed) return formatCount(value);
    try {
      // Plain JavaScript may return anything: the overlay writes text.
      const text: unknown = format(value);
      return typeof text === 'string' ? text : String(text);
    } catch (error) {
      failed = true;
      warnOnce(`"${id}": format threw and the default format is used instead (${String(error)}).`);
      return formatCount(value);
    }
  };
}

function checkLabel(id: string, label: unknown): string | null {
  if (!Array.isArray(label) || label.length !== 2 || typeof label[0] !== 'string' || typeof label[1] !== 'string') {
    return `"${id}": label must be two short strings, e.g. ['LOD', 'SW/S'].`;
  }

  return null;
}

/** Returns why a metric is invalid, or null. */
export function checkMetric(metric: StatsMetric): string | null {
  if (typeof metric.id !== 'string' || metric.id === '') return 'a metric needs a non-empty string id.';
  if (typeof metric.read !== 'function') return `metric "${metric.id}": read must be a function.`;
  if (metric.plate !== undefined && metric.plate.length > 4) return `metric "${metric.id}": plate "${metric.plate}" is longer than 4 characters.`;
  // Plain JavaScript can pass anything: check the runtime value, not the type.
  const place: unknown = metric.place;
  if (place !== undefined && place !== 'grid' && place !== 'top') return `metric "${metric.id}": place must be 'grid' or 'top'.`;
  const glyph: unknown = metric.glyph;
  if (typeof glyph === 'string' && !Object.hasOwn(GLYPHS, glyph)) return `metric "${metric.id}": unknown glyph "${glyph}"; use one of ${Object.keys(GLYPHS).join(', ')} or a GlyphSpec.`;
  if (glyph !== undefined && typeof glyph !== 'string' && (typeof glyph !== 'object' || glyph === null || !Array.isArray((glyph as { base?: unknown }).base))) {
    return `metric "${metric.id}": a custom glyph needs a base list of shapes.`;
  }

  return null;
}

/** Returns why a graph definition is invalid, or null. */
export function checkGraph(graph: GraphDefinition): string | null {
  if (typeof graph.id !== 'string' || graph.id === '') return 'a graph needs a non-empty string id.';
  if (typeof graph.read !== 'function') return `graph "${graph.id}": read must be a function.`;
  if (!['budget', 'auto', 'bytes', 'percent'].includes(graph.scale)) return `graph "${graph.id}": scale must be 'budget', 'auto', 'bytes' or 'percent'.`;
  if (typeof graph.unit !== 'string') return `graph "${graph.id}": unit must be a string.`;
  return checkLabel(graph.id, graph.label);
}

/** Returns why a distribution definition is invalid, or null. */
export function checkDistribution(distribution: DistributionDefinition): string | null {
  if (typeof distribution.id !== 'string' || distribution.id === '') return 'a distribution needs a non-empty string id.';
  if (typeof distribution.read !== 'function') return `distribution "${distribution.id}": read must be a function.`;
  return checkLabel(distribution.id, distribution.label);
}

/** Returns why a histogram definition is invalid, or null. */
export function checkHistogram(histogram: HistogramDefinition): string | null {
  const value: unknown = histogram;
  if (typeof value !== 'object' || value === null || typeof histogram.id !== 'string' || histogram.id === '') return 'a histogram needs a non-empty string id.';
  const id = histogram.id;
  if (typeof histogram.unit !== 'string') return `histogram "${id}": unit must be a string.`;
  const channels: unknown = histogram.channels;
  if (!Array.isArray(channels) || channels.length === 0) return `histogram "${id}" needs one to three channels.`;
  for (let i = 0, l = channels.length; i < l; i++) {
    const channel = channels[i] as { read?: unknown } | null;
    if (typeof channel !== 'object' || channel === null || typeof channel.read !== 'function') return `histogram "${id}": channel ${i} needs a read function.`;
  }

  const domain = histogram.domain as { min?: unknown; max?: unknown } | null | undefined;
  if (typeof domain !== 'object' || domain === null || typeof domain.min !== 'number' || typeof domain.max !== 'number' || !(domain.max > domain.min)) {
    return `histogram "${id}": domain needs finite numbers with min < max.`;
  }

  return checkLabel(id, histogram.label);
}

const GRAPH_LENGTH = 132;
const GRAPH_HEIGHT = 32;

function formatter(graph: GraphDefinition): (value: number | null) => string {
  const by: Record<GraphDefinition['scale'], (v: number) => string> = { budget: formatMs, auto: formatCount, bytes: formatBytes, percent: formatPercent };
  const format = by[graph.scale];
  return (value) => (value === null ? '—' : format(value));
}

/** Two-line label, graph and the value at the top of the graph ("MAX"). Shared by built-in and custom graphs. */
/**
 * A graph with its label and scale. With `tooltips` false (the built-in graphs) nothing in it
 * shows a tooltip: `tip` is only the text alternative for assistive technology.
 */
export function graphPanel(timeGraph: TimeGraph, label: HTMLElement, unit: string, format: (v: number | null) => string, data: Samples, tip: string, rich?: TipContent, tooltips = true): Panel {
  const scale = el('span', '', '—');
  const normalized = timeGraph.normalized;
  const aside = el('span', 'tez-stack tez-aside');
  if (tooltips) hit(aside, normalized ? `Slowest visible frame, in ${unit}` : `Top of the scale, in ${unit}`);
  aside.append(el('span', '', normalized ? 'PEAK' : 'MAX'), scale);
  const element = el('div', 'tez-panel');
  const plain = el('div', 'tez-panel-plot');
  const plot = !tooltips ? plain : rich === undefined ? hit(plain, tip) : setTip(plain, rich);
  plot.append(timeGraph.element);
  element.append(label, plot, aside);
  return {
    element,
    length: () => timeGraph.span + 2,
    resize: (px) => {
      timeGraph.setLength(px);
    },
    draw: (colors) => {
      timeGraph.draw(colors);
    },
    describe: () => {
      if (normalized) {
        // A normalised graph has no shared axis: the aside carries the real worst value instead.
        const peak = data.max(timeGraph.span);
        setText(scale, format(peak));
        const budget = timeGraph.budget;
        scale.classList.toggle('tez-alert', peak !== null && peak > budget * 1.25 && peak <= budget * 2.25);
        scale.classList.toggle('tez-clip', peak !== null && peak > budget * 2.25);
      } else {
        setText(scale, format(timeGraph.scale));
      }

      const n = timeGraph.span;
      const text = `${tip} Recent range: ${format(data.min(n))} to ${format(data.max(n))} ${unit}.`;
      if (tooltips) setLabel(timeGraph.element, text);
      else timeGraph.element.setAttribute('aria-label', text);
    }
  };
}

/** A panel for a custom graph definition. */
export function customGraphPanel(graph: GraphDefinition, budget: number): Panel {
  const samples = new Samples();
  const below = new Samples();
  const read = safeRead(graph.id, graph.read, finite);
  const readBelow = graph.readBelow === undefined ? null : safeRead(`${graph.id} (below)`, graph.readBelow, finite);
  const color = graph.color ?? 'ink';
  const series = readBelow === null ? [{ samples, color }] : [{ samples, color }, { samples: below, color }];
  const timeGraph = new TimeGraph(graph.scale === 'budget' ? budget : Infinity, series, {
    width: GRAPH_LENGTH,
    height: GRAPH_HEIGHT,
    vertical: false,
    autoScale: graph.scale !== 'percent',
    mirror: readBelow !== null,
    ...(graph.scale === 'percent' ? { fixedScale: 100 } : {}),
    label: graph.description ?? graph.id
  });
  const panel = graphPanel(timeGraph, stack(graph.label[0], graph.label[1]), graph.unit, formatter(graph), samples, graph.description ?? `${graph.label.join(' ')} over time.`, graph.tip);
  panel.timing = graph.sample ?? 'refresh';
  panel.sample = () => {
    const value = read();
    if (value !== null) samples.push(value);
    const value2 = readBelow?.() ?? null;
    if (value2 !== null) below.push(value2);
  };

  return panel;
}

/** A compact stacked bar: one segment per bucket, shaded from bright (L0) to dim (Ln). */
export function distributionPanel(distribution: DistributionDefinition): Panel {
  const read = safeRead<readonly number[]>(distribution.id, distribution.read, (counts) => Array.isArray(counts));
  const bar = el('div', 'tez-dist');
  const legend = el('span', 'tez-stack tez-aside');
  const top = el('span', '', '—');
  const bottom = el('span', '', '');
  legend.append(top, bottom);
  // Vertical only: one row per level ("L0 96"), next to the bar.
  const levels = el('div', 'tez-dist-levels');
  const element = el('div', 'tez-panel tez-dist-panel');
  const plain = distribution.description ?? `${distribution.label.join(' ')} per bucket.`;
  const plot = distribution.tip === undefined ? hit(el('div', 'tez-panel-plot'), plain) : setTip(el('div', 'tez-panel-plot'), distribution.tip);
  plot.append(levels, bar);
  element.append(stack(distribution.label[0], distribution.label[1]), plot, legend);
  let counts: readonly number[] | null = null;
  let vertical = false;
  let barLength = 132;

  const name = (i: number): string => distribution.names?.[i] ?? `L${i}`;
  return {
    element,
    timing: 'refresh',
    length: () => barLength,
    orient: (isVertical, length) => {
      vertical = isVertical;
      barLength = length;
      element.classList.toggle('tez-dist-vertical', isVertical);
      bar.style.width = isVertical ? '' : `${length}px`;
      bar.style.height = isVertical ? `${length}px` : '';
    },
    sample: () => {
      counts = read();
    },
    draw: () => {
      const values = counts ?? [];
      let total = 0;
      for (let i = 0, l = values.length; i < l; i++) total += Math.max(0, values[i]);
      while (bar.childElementCount > values.length) bar.lastElementChild?.remove();
      while (bar.childElementCount < values.length) bar.append(el('span', 'tez-dist-seg'));
      for (let i = 0, l = values.length; i < l; i++) {
        const segment = bar.children[i] as HTMLElement;
        segment.style.flexGrow = String(total > 0 ? Math.max(0, values[i]) : 0);
        // Each level gets its own fill (solid, hatched, dotted, outline) instead of a shade of white.
        segment.dataset['i'] = String(Math.min(i, 3));
      }
    },
    describe: () => {
      const values = counts ?? [];
      const parts: string[] = [];
      for (let i = 0, l = values.length; i < l; i++) parts.push(`${name(i)} ${formatCount(values[i])}`);
      let total = 0;
      for (let i = 0, l = values.length; i < l; i++) total += values[i];
      setText(top, values.length > 0 ? formatCount(total) : '—');
      setText(bottom, values.length > 0 ? `${values.length} LV` : '');
      if (vertical) {
        while (levels.childElementCount > values.length) levels.lastElementChild?.remove();
        while (levels.childElementCount < values.length) levels.append(el('span', 'tez-dist-level'));
        for (let i = 0, l = values.length; i < l; i++) {
          const row = levels.children[i] as HTMLElement;
          // Each row sits at the centre of its segment, so the list reads like the bar's axis.
          row.style.flexGrow = String(total > 0 ? Math.max(0, values[i]) : 1);
          setText(row, `${name(i)} ${formatCount(values[i])}`);
          row.dataset['i'] = String(Math.min(i, 3));
        }
      }
      setLabel(bar, `${distribution.description ?? distribution.label.join(' ')}: ${parts.length > 0 ? parts.join(', ') : 'no data'}.`);
    }
  };
}
