/**
 * Public types for metrics, graphs and display modes.
 *
 * Everything a page (or an LLM) needs to add its own statistics is declarative: describe the
 * value, where it goes and how it scales; the overlay handles layout, formatting, tooltips,
 * validation and failure. A definition that is invalid is skipped with one console warning;
 * a `read` that throws or returns a non-finite number shows "—" and is switched off after
 * repeated failures. Nothing in a definition can break the layout.
 */

import type { Threshold } from './format.js';
import type { GlyphName, GlyphSpec } from './glyphs.js';

/**
 * Mark drawn before a legend row of a rich tooltip: a series or state colour, or one of the
 * graph symbols (the budget tick on the sides, the event tick on top, the criticality lane below).
 */
export type TipMark = 'ink' | 'alert' | 'clip' | 'frame' | 'gpu' | 'cpu' | 'r' | 'g' | 'b' | 'budget-tick' | 'event-tick' | 'flag-tick' | 'lane';

/**
 * Rich tooltip content: a title, a short text, a legend that explains colours and symbols, live
 * key/value rows (read while the tooltip is open) and one practical piece of advice.
 */
export interface TipContent {
  title: string;
  text?: string;
  legend?: readonly { mark: TipMark; text: string }[];
  /** Live rows, e.g. [['Target', '60 fps'], ['P95', '18.2 ms']]. Called on open and at each refresh. */
  values?: () => readonly (readonly [string, string])[];
  /** Shown in yellow after "TIP". */
  advice?: string;
  /** Separate items, each with a title, a line of text and optional advice (e.g. the list of active tips). */
  sections?: readonly { title: string; text: string; advice?: string }[];
}

/** Built-in display modes. Custom modes add their own string ids. */
export type BuiltinMode = 'simple' | 'performance' | 'mesh' | 'memory' | 'image' | 'info' | 'off';
// `string & {}` keeps editor completion for the built-in names while accepting custom ids.

export type StatsMode = BuiltinMode | (string & {});

/** A single value: a counter in the bottom-left grid or a row (value + plate) in the top-right corner. */
export interface StatsMetric {
  /** Unique id. */
  id: string;
  /** Accessible name and tooltip, e.g. "Physics bodies". */
  label: string;
  /** Current value, or null when unavailable (shown as —). Called at each refresh (4×/s). */
  read: () => number | null;
  /** 'grid' (glyph + value, bottom-left) or 'top' (value + plate, top-right). Default 'grid'. */
  place?: 'grid' | 'top';
  /** Glyph for the grid: a built-in name or a custom spec. */
  glyph?: GlyphName | GlyphSpec;
  /** Short plate text for the top rows, at most 4 characters, e.g. "PHYS". */
  plate?: string;
  /** Unit after the value, e.g. "MB" or "%". */
  unit?: string;
  /** Formats the value. Default: compact count (1.24M). */
  format?: (value: number) => string;
  /** Turns the value yellow outside these bounds. */
  threshold?: Threshold;
  /** Rich tooltip, in place of the plain `label` text. */
  tip?: TipContent;
  /** Characters reserved for the value, so the layout never jumps. Default 4. */
  width?: number;
  /** Modes that show this metric. Default: every mode except 'off'. */
  modes?: readonly StatsMode[];
}

/**
 * How a graph scales its values:
 * - 'budget': milliseconds; axis follows the data up to twice the frame budget, with budget ticks;
 * - 'auto': counts; axis follows the largest recent value;
 * - 'bytes': like 'auto', formatted as B / KB / MB / GB;
 * - 'percent': fixed 0–100 axis.
 */
export type GraphScale = 'budget' | 'auto' | 'bytes' | 'percent';

/** Ink colours a custom graph may use; series colours keep their meaning across the overlay. */
export type GraphColor = 'ink' | 'cpu' | 'gpu' | 'frame';

/** A scrolling time graph inside a mode. */
export interface GraphDefinition {
  /** Unique id. */
  id: string;
  /** Two-line label left of the graph, each line at most 5 characters, e.g. ['LOD', 'SW/S']. */
  label: readonly [string, string];
  scale: GraphScale;
  /** Unit for the tooltip and the "MAX" label, e.g. 'ms', 'sw/s', 'MB'. */
  unit: string;
  /** Current value, or null when unavailable. */
  read: () => number | null;
  /**
   * Optional second value, drawn downwards from a middle zero line on the same scale; `read` is
   * then drawn upwards. For two directions of one quantity (e.g. LOD switches to coarser above,
   * to finer below). Both must share the unit.
   */
  readBelow?: () => number | null;
  /**
   * When to read: 'frame' adds a column every few frames (only for cheap reads), 'refresh' adds one
   * per text refresh (4×/s). Default 'refresh'.
   */
  sample?: 'frame' | 'refresh';
  /** Default 'ink'. */
  color?: GraphColor;
  /** Tooltip text: what the graph shows and how to read it. */
  description?: string;
  /** Rich tooltip, in place of `description`. */
  tip?: TipContent;
}

/** A compact stacked bar: how many items sit in each bucket (e.g. objects per LOD level). */
export interface DistributionDefinition {
  id: string;
  /** Two-line label left of the bar. */
  label: readonly [string, string];
  /** Count per bucket, in order (L0..Ln), or null when unavailable. Read at each refresh. */
  read: () => readonly number[] | null;
  /** Bucket names for the tooltip. Default 'L0', 'L1'… */
  names?: readonly string[];
  description?: string;
  /** Rich tooltip, in place of `description`. */
  tip?: TipContent;
}

/**
 * A toggle plate next to the mode plate (bottom-right), e.g. "colour the LOD levels". Click flips it;
 * the plate turns yellow while it is on.
 */
export interface ControlDefinition {
  /** Unique id. */
  id: string;
  /** Plate text, at most 5 characters, e.g. 'COLOR'. */
  label: string;
  /** Tooltip: what the toggle does. */
  description: string;
  /** Rich tooltip, in place of `description`. */
  tip?: TipContent;
  /** Called with the new state on every click (and never on its own). */
  onChange: (active: boolean) => void;
  /** Initial state. Default false. */
  active?: boolean;
  /** Modes that show the control. Default: every mode except 'off'. Inside a mode definition: that mode. */
  modes?: readonly StatsMode[];
}

/** One channel of a histogram: raw samples (the overlay bins them) or counts already binned. */
export interface HistogramChannel {
  /** Name for the legend and tooltip, e.g. 'L0'. */
  name: string;
  /** Raw values, or counts per bin when the histogram is `binned`. Null when unavailable. Reuse one array: it is read 4×/s. */
  read: () => ArrayLike<number> | null;
}

/**
 * A large histogram, top-left under the readouts: up to three channels drawn in red, green and
 * blue that add up like light — white where all three agree. Channels share one scale.
 */
export interface HistogramDefinition {
  id: string;
  /** Two-line label, e.g. ['LOD', 'PX']. */
  label: readonly [string, string];
  /** Unit of the x axis, for the tooltip and the axis ends. */
  unit: string;
  /** One to three channels, drawn as red, green, blue in this order. */
  channels: readonly HistogramChannel[];
  /** X axis range; values outside fall into the edge bins, which then turn yellow. `log` for wide ranges. */
  domain: { min: number; max: number; log?: boolean };
  /** Number of bins. Default 64. */
  bins?: number;
  /** `read` returns counts per bin (length = bins) instead of raw values. Default false. */
  binned?: boolean;
  /** Reference marks under the axis, e.g. LOD thresholds. */
  ticks?: () => readonly { at: number; label?: string }[];
  description?: string;
  /** Rich tooltip, in place of `description`. */
  tip?: TipContent;
}

/** What a mode adds on top of the always-visible readouts. */
export interface ModeContent {
  /** The large top-left histogram of this mode; 'image' is the built-in histogram of the rendered image. */
  histogram?: HistogramDefinition | 'image';
  /** Toggle plates shown next to the mode plate while this mode is on. */
  controls?: readonly ControlDefinition[];
  /** Graphs, at most 4 per mode including the built-in ones. */
  graphs?: readonly GraphDefinition[];
  /** Metrics shown only in this mode. */
  metrics?: readonly StatsMetric[];
  /** One distribution bar per mode. */
  distribution?: DistributionDefinition;
}

export interface ModeDefinition extends ModeContent {
  /** Unique id, e.g. 'lod'. */
  id: string;
  /** Name in the mode menu, e.g. 'Level of detail'. */
  name: string;
  /** Code on the mode plate, at most 4 characters, e.g. 'LOD'. */
  code: string;
  /** One sentence for the menu tooltip. */
  description: string;
}
