/**
 * Panels for the large top-left histogram: a page-defined one (three channels of raw values or
 * bins) and the built-in channel histogram of the rendered image. Both are `Panel`s, so the
 * overlay lays them out, animates and hides them like everything else.
 */

import { finite, safeRead, type Panel } from './custom.js';
import { el, hit, setLabel, setText, stack } from './dom.js';
import { formatCount, formatPercent } from './format.js';
import { binValues, HistogramGraph, position, type HistogramScale } from './histogram.js';
import { IMAGE_BINS, type ImageSampler } from './image.js';
import { setTip } from './tooltip.js';
import type { HistogramDefinition, TipContent } from './types.js';

/** 256 inner pixels plus the 1px border: one column per 8-bit value of the image histogram. */
export const HISTOGRAM_WIDTH = 258;
const HISTOGRAM_HEIGHT = 88;
/** Channel colour classes, red, green, blue: the legend names take their channel's colour. */
const CHANNEL_CLASSES = ['tez-ch-r', 'tez-ch-g', 'tez-ch-b'];

export interface HistogramPanel extends Panel {
  setWidth: (px: number) => void;
}

/** Label left, histogram, axis row underneath (min · legend · max), a two-line summary on the right. */
function frame(label: readonly [string, string], graph: HistogramGraph, legend: readonly string[], tip: string, rich?: TipContent): {
  element: HTMLElement; axisMin: HTMLElement; axisMax: HTMLElement; top: HTMLElement; bottom: HTMLElement; summary: HTMLElement;
} {
  const element = el('div', 'tez-panel tez-histogram');
  const plot = rich === undefined ? hit(el('div', 'tez-panel-plot'), tip) : setTip(el('div', 'tez-panel-plot'), rich);
  const axis = el('div', 'tez-axis-row');
  const axisMin = el('span', '', '');
  const axisMax = el('span', '', '');
  const names = el('span', 'tez-legend');
  for (let i = 0, l = legend.length; i < l; i++) names.append(el('span', legend.length > 1 ? CHANNEL_CLASSES[i] : '', legend[i]));
  axis.append(axisMin, names, axisMax);
  plot.append(graph.element, axis);
  const top = el('span', '', '—');
  const bottom = el('span', '', '');
  const summary = el('span', 'tez-stack tez-aside');
  summary.append(top, bottom);
  element.append(stack(label[0], label[1]), plot, summary);
  return { element, axisMin, axisMax, top, bottom, summary };
}

/** A page-defined histogram of up to three channels. */
export function histogramPanel(definition: HistogramDefinition, budgetWarn: (message: string) => void): HistogramPanel | null {
  const channels = definition.channels.slice(0, 3);
  if (channels.length === 0) {
    budgetWarn(`histogram "${definition.id}" needs one to three channels.`);
    return null;
  }

  if (definition.channels.length > 3) budgetWarn(`histogram "${definition.id}": only the first three channels are drawn.`);
  const bins = Math.max(8, Math.min(256, Math.round(definition.bins ?? 64)));
  const scale: HistogramScale = { min: definition.domain.min, max: definition.domain.max, log: definition.domain.log === true };
  const count = channels.length;
  const counts: Float32Array[] = [];
  const reads: (() => ArrayLike<number> | null)[] = [];
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    counts.push(new Float32Array(bins));
    reads.push(safeRead<ArrayLike<number>>(`${definition.id}.${i}`, channels[i].read, (v) => typeof v === 'object' && typeof v.length === 'number'));
    names.push(channels[i].name);
  }

  const tip = definition.description ?? `${definition.label.join(' ')}: how many per ${definition.unit}.`;
  const graph = new HistogramGraph(HISTOGRAM_WIDTH, HISTOGRAM_HEIGHT, tip);
  const parts = frame(definition.label, graph, names, tip, definition.tip);
  setText(parts.axisMin, formatCount(scale.min));
  setText(parts.axisMax, `${formatCount(scale.max)} ${definition.unit}`);
  let ticks: number[] = [];

  const readChannel = (i: number): void => {
    const values = reads[i]();
    if (values === null) {
      counts[i].fill(0);
    } else if (definition.binned === true) {
      for (let b = 0; b < bins; b++) {
        const v = b < values.length ? values[b] : 0;
        counts[i][b] = finite(v) ? Math.max(0, v) : 0;
      }
    } else {
      binValues(values, scale, counts[i]);
    }
  };

  return {
    element: parts.element,
    timing: 'refresh',
    setWidth: (px) => {
      graph.setWidth(px);
    },
    sample: () => {
      for (let i = 0; i < count; i++) readChannel(i);
      const marks = definition.ticks?.() ?? [];
      ticks = [];
      for (let i = 0, l = marks.length; i < l; i++) ticks.push(position(marks[i].at, scale));
    },
    draw: (colors) => {
      graph.draw(counts, ticks, colors);
    },
    describe: () => {
      let top = 0;
      const detail: string[] = [];
      for (let i = 0; i < count; i++) {
        let sum = 0;
        for (let b = 0; b < bins; b++) sum += counts[i][b];
        top = Math.max(top, sum);
        detail.push(`${names[i]} ${formatCount(sum)}`);
      }

      setText(parts.top, formatCount(top));
      setText(parts.bottom, `${count} CH`);
      setLabel(graph.element, `${tip} ${formatCount(scale.min)} to ${formatCount(scale.max)} ${definition.unit}: ${detail.join(', ')}.`);
    }
  };
}

/** The built-in histogram of the rendered image: R, G and B channels, clipping on the right. */
export function imageHistogramPanel(sampler: ImageSampler, capture: () => boolean): HistogramPanel {
  const tip = 'Channels of the rendered image after tone mapping, 0 to 255. White where R, G and B agree (neutral tones), '
    + 'coloured fringes for casts. Yellow edges: highlights clipped (right) or blacks crushed (left) on more than 1% of pixels.';
  const graph = new HistogramGraph(HISTOGRAM_WIDTH, HISTOGRAM_HEIGHT, tip);
  const parts = frame(['RGB', 'IMG'], graph, ['R', 'G', 'B'], tip, {
    title: 'Image histogram',
    text: 'Red, green and blue of the rendered image after tone mapping, 0 (black) to 255 (white); height is the pixel count, square-root scale.',
    legend: [
      { mark: 'r', text: 'Red channel' },
      { mark: 'g', text: 'Green channel' },
      { mark: 'b', text: 'Blue channel' },
      { mark: 'ink', text: 'All three agree: neutral greys' },
      { mark: 'alert', text: 'Edge mark: over 1% of pixels clipped (right) or crushed (left)' }
    ],
    values: () => (sampler.valid
      ? [['Highlights clipped', formatPercent(sampler.clippedHigh * 100)], ['Blacks crushed', formatPercent(sampler.clippedLow * 100)]]
      : [['Canvas', 'not readable']]),
    advice: 'Clipped highlights: lower toneMappingExposure or the light intensity; a colour cast: check light colours and the environment map.'
  });
  setText(parts.axisMin, '0');
  setText(parts.axisMax, '255');
  const channels = [sampler.red, sampler.green, sampler.blue];
  const empty = [new Float32Array(IMAGE_BINS)];
  return {
    element: parts.element,
    timing: 'refresh',
    setWidth: (px) => {
      graph.setWidth(px);
    },
    sample: () => {
      capture();
    },
    draw: (colors) => {
      graph.draw(sampler.valid ? channels : empty, [], colors, { low: sampler.clippedLow > 0.01, high: sampler.clippedHigh > 0.01 });
    },
    describe: () => {
      const valid = sampler.valid;
      setText(parts.top, valid ? `HI ${formatPercent(sampler.clippedHigh * 100)}` : '—');
      setText(parts.bottom, valid ? `LO ${formatPercent(sampler.clippedLow * 100)}` : '');
      parts.top.classList.toggle('tez-alert', valid && sampler.clippedHigh > 0.01);
      parts.bottom.classList.toggle('tez-alert', valid && sampler.clippedLow > 0.01);
      setLabel(graph.element, valid
        ? `${tip} Now: ${formatPercent(sampler.clippedHigh * 100)} clipped highlights, ${formatPercent(sampler.clippedLow * 100)} crushed blacks.`
        : `${tip} Unavailable: the canvas could not be read.`);
    }
  };
}
