/**
 * Vector glyphs for renderer statistics, drawn on a 16-unit grid.
 *
 * Straight horizontal and vertical edges sit on whole or half units, so at 16px (and at
 * any multiple) they land exactly on device pixels and render sharp; curves and diagonals
 * are anti-aliased as normal vectors. Render glyphs at 16px or a multiple of it.
 *
 * The container encodes the category, so the shape tells you what kind of number follows:
 * - per-frame work (calls, triangles, points, lines): free silhouette, no container;
 * - resident memory (geometries, textures, programs): plate with a 1px white border and a
 *   flat grey interior, symbol in white;
 * - time (CPU, GPU): a dial whose filled sector is the share of the frame budget used.
 *
 * Ink is `currentColor`. Plate greys come from `--tez-plate` and `--tez-plate-level`.
 * Free silhouettes and dials can carry a dark contour drawn as geometry (`outline`); plates never do.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIZE = 16;

/** A path primitive. `stroke` is the line width in grid units; omit it for a filled shape. */
export interface Shape {
  d: string;
  stroke?: number;
}

export interface GlyphSpec {
  category: 'frame' | 'memory';
  /** Accessible name and tooltip, e.g. "Draw calls". Glyphs without one are decorative. */
  label?: string;
  /** Shapes drawn in ink. */
  base: readonly Shape[];
  /** Shapes removed from the base (negative space), merged in a mask. */
  cuts?: readonly Shape[];
}

const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;

const rect = (x0: number, y0: number, x1: number, y1: number): string =>
  `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;

/** Square vertex marker: 3×3 outline with a 1×1 hole, centred on a half-unit point. */
const vertex = (cx: number, cy: number): string => rect(cx - 1.5, cy - 1.5, cx + 1.5, cy + 1.5);
const vertexHole = (cx: number, cy: number): string => rect(cx - 0.5, cy - 0.5, cx + 0.5, cy + 0.5);

const LINE_VERTICES: readonly (readonly [number, number])[] = [[2.5, 12.5], [6.5, 5.5], [9.5, 10.5], [13.5, 3.5]];

/** Joins one path fragment per line vertex. */
function perVertex(build: (x: number, y: number) => string): string {
  let d = '';
  for (let i = 0, l = LINE_VERTICES.length; i < l; i++) d += build(LINE_VERTICES[i][0], LINE_VERTICES[i][1]);
  return d;
}

/** 4×4 checker of 2-unit squares inside the plate. */
function checker(): string {
  let d = '';
  for (let i = 0; i < 4; i++) {
    for (let j = i % 2; j < 4; j += 2) d += rect(4 + i * 2, 4 + j * 2, 6 + i * 2, 6 + j * 2);
  }

  return d;
}

export const GLYPHS = {
  /** Draw calls: a stack of frames, each one a draw of geometry; the front frame shows the triangle being drawn. */
  calls: {
    category: 'frame',
    label: 'Draw calls',
    base: [
      // Front frame, 1px, 11×7 (about 3:2), with the drawn triangle inside.
      { d: `${rect(0, 2, 11, 9)}${rect(1, 3, 10, 8)}` },
      { d: 'M5.5 4L8 7H3Z' },
      // Queued frames behind, 1px: only the right and bottom edges show.
      // The two edges must not overlap: with evenodd fill the shared corner would cancel out.
      { d: `${rect(12, 4, 13, 11)}${rect(2, 10, 12, 11)}` },
      { d: `${rect(14, 6, 15, 13)}${rect(4, 12, 14, 13)}` }
    ]
  },
  /** Triangles: a face subdivided once into a mesh. */
  triangles: {
    category: 'frame',
    label: 'Triangles',
    base: [{ d: 'M8 1.5L15 14H1Z' }],
    cuts: [{ d: 'M11.5 7.75L8 14L4.5 7.75Z', stroke: 1.2 }]
  },
  /** Points: a scattered point cloud. */
  points: {
    category: 'frame',
    label: 'Points',
    base: [{ d: `${circle(3.8, 4.2, 1.7)}${circle(11.8, 3.2, 1.2)}${circle(8, 8.4, 2.2)}${circle(3.2, 12.7, 1.2)}${circle(12.3, 12.3, 1.8)}` }]
  },
  /** Lines: a polyline through hollow vertex markers. */
  lines: {
    category: 'frame',
    label: 'Lines',
    base: [
      { d: `M${perVertex((x, y) => `${x} ${y}L`).slice(0, -1)}`, stroke: 1.2 },
      { d: perVertex(vertex) }
    ],
    cuts: [{ d: perVertex(vertexHole) }]
  },
  /** Geometries: an isometric wireframe cube. */
  geometries: {
    category: 'memory',
    label: 'Geometries in memory',
    base: [
      { d: 'M8 3.5L11.5 5.5V10.5L8 12.5L4.5 10.5V5.5Z', stroke: 1 },
      { d: 'M4.5 5.5L8 7.5L11.5 5.5M8 7.5V12.5', stroke: 1 }
    ]
  },
  /** Textures: a checker swatch. */
  textures: {
    category: 'memory',
    label: 'Textures in memory',
    base: [{ d: checker() }]
  },
  /**
   * Objects: the scene graph, a parent node with two children. On whole pixels only: a 4×3 root,
   * a 2px trunk, a 1px branch and two 4×3 children, symmetric about the plate centre.
   */
  objects: {
    category: 'memory',
    label: 'Objects in the scene',
    base: [{ d: `${rect(6, 3, 10, 6)}${rect(7, 6, 9, 8)}${rect(4, 8, 12, 9)}${rect(4, 9, 6, 10)}${rect(10, 9, 12, 10)}${rect(3, 10, 7, 13)}${rect(9, 10, 13, 13)}` }]
  },
  /** Programs: shader source. */
  programs: {
    category: 'memory',
    label: 'Shader programs',
    base: [
      { d: 'M5.8 5L3.5 8L5.8 11', stroke: 1.2 },
      { d: 'M10.2 5L12.5 8L10.2 11', stroke: 1.2 },
      { d: 'M9.1 3.8L6.9 12.2', stroke: 1.2 }
    ]
  }
} as const satisfies Record<string, GlyphSpec>;

export type GlyphName = keyof typeof GLYPHS;

export interface GlyphOptions {
  /** Overrides the glyph's accessible name and tooltip, e.g. to include the current value. */
  label?: string;
  /** Rendered size in CSS pixels. Keep it 16 or a multiple of 16 so edges stay sharp. Default 16. */
  size?: number;
  /**
   * Plates only: fill the interior from the bottom up to this fraction (0–1) with a lighter
   * flat grey. Turns the plate into a level gauge, e.g. for memory pressure.
   */
  level?: number;
  /** Adds a dark 1px contour around free silhouettes, as plain SVG geometry (plates never get one). Default false. */
  outline?: boolean;
}

let idCount = 0;

/** Contour ink: near-black, applied through group opacity so overlapping strokes do not stack darker. */
const CONTOUR = { style: 'opacity:0.85', fill: '#000', stroke: '#000' };

/** The same shapes again, 1px wider on every side, drawn under the ink. */
function outlineGroup(shapes: readonly Shape[]): SVGGElement {
  const group = svgElement('g', CONTOUR);
  for (let i = 0, l = shapes.length; i < l; i++) {
    const shape = shapes[i];
    group.appendChild(svgElement('path', shape.stroke !== undefined
      ? { d: shape.d, fill: 'none', 'stroke-width': shape.stroke + 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
      : { d: shape.d, 'fill-rule': 'evenodd', 'stroke-width': 2, 'stroke-linejoin': 'miter' }));
  }

  return group;
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  const keys = Object.keys(attrs);
  for (let i = 0, l = keys.length; i < l; i++) el.setAttribute(keys[i], String(attrs[keys[i]]));
  return el;
}

/**
 * Creates the root SVG. With a label it becomes an image with an accessible name and a
 * native tooltip (`<title>`); without one it is hidden from assistive technology.
 */
function createSvg(name: string, size: number, label?: string): SVGSVGElement {
  // Overflow stays visible so a contour on the edge of the grid is not clipped.
  const svg = svgElement('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, width: size, height: size, overflow: 'visible', 'data-glyph': name });
  if (label !== undefined && label !== '') {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  return svg;
}

function shapeAttrs(shape: Shape, color: string): Record<string, string | number> {
  return shape.stroke !== undefined
    ? { d: shape.d, fill: 'none', stroke: color, 'stroke-width': shape.stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
    : { d: shape.d, fill: color, 'fill-rule': 'evenodd' };
}

/** Appends the plate: 1px white border and a flat grey interior (12×12). */
function appendPlate(svg: SVGSVGElement, level?: number): void {
  svg.appendChild(svgElement('rect', { x: 2, y: 2, width: 12, height: 12, fill: 'var(--tez-plate, #222220)' }));

  if (level !== undefined) {
    // Level gauge: a lighter flat grey rising from the bottom, snapped to whole units so the edge stays sharp.
    const rows = Math.round(Math.min(1, Math.max(0, level)) * 12);
    if (rows > 0) svg.appendChild(svgElement('rect', { x: 2, y: 14 - rows, width: 12, height: rows, fill: 'var(--tez-plate-level, #55554f)' }));
  }

  svg.appendChild(svgElement('path', { d: `${rect(1, 1, 15, 15)}${rect(2, 2, 14, 14)}`, fill: 'currentColor', 'fill-rule': 'evenodd' }));
}

/** Builds a glyph as an inline SVG element. */
export function createGlyph(name: GlyphName, options: GlyphOptions = {}): SVGSVGElement {
  return createGlyphFromSpec(GLYPHS[name], options, name);
}

/**
 * Builds a glyph from a custom spec, so custom metrics can bring their own glyph
 * in the same language: ink shapes, negative cuts, and the plate for memory-like values.
 */
export function createGlyphFromSpec(spec: GlyphSpec, options: GlyphOptions = {}, name = 'custom'): SVGSVGElement {
  const svg = createSvg(name, options.size ?? SIZE, options.label ?? spec.label);
  if (spec.category === 'memory') appendPlate(svg, options.level);
  else if (options.outline === true) svg.appendChild(outlineGroup(spec.base));

  const group = svgElement('g', {});
  if (spec.cuts !== undefined) {
    const id = `tez-stats-cut-${idCount++}`;
    const mask = svgElement('mask', { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: SIZE, height: SIZE });
    mask.appendChild(svgElement('rect', { width: SIZE, height: SIZE, fill: '#fff' }));
    for (let i = 0, l = spec.cuts.length; i < l; i++) mask.appendChild(svgElement('path', shapeAttrs(spec.cuts[i], '#000')));
    svg.appendChild(mask);
    group.setAttribute('mask', `url(#${id})`);
  }

  for (let i = 0, l = spec.base.length; i < l; i++) group.appendChild(svgElement('path', shapeAttrs(spec.base[i], 'currentColor')));
  svg.appendChild(group);
  return svg;
}

/**
 * Time dial: a 1px ring with a filled sector showing `fraction` of the frame budget,
 * clockwise from 12. At or above 1 the inner disk is solid: the frame is over budget.
 * `null` means the timing is unavailable: the ring is dashed and empty, never a fake 0%.
 */
export function createDial(fraction: number | null, size = SIZE, label = 'Frame time', outline = false): SVGSVGElement {
  const detail = fraction === null ? 'unavailable' : `${Math.round(Math.max(0, fraction) * 100)}% of frame budget`;
  const svg = createSvg('dial', size, `${label}: ${detail}`);
  const dash = fraction === null ? { 'stroke-dasharray': `${(Math.PI * 14) / 24}` } : {};
  const sector = dialSector(fraction);
  if (outline) {
    const under = svgElement('g', CONTOUR);
    under.appendChild(svgElement('circle', { cx: 8, cy: 8, r: 7, fill: 'none', 'stroke-width': 3, ...dash }));
    if (sector !== '') under.appendChild(svgElement('path', { d: sector, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    svg.appendChild(under);
  }

  svg.appendChild(svgElement('circle', { cx: 8, cy: 8, r: 7, fill: 'none', stroke: 'currentColor', 'stroke-width': 1, ...dash }));
  if (sector !== '') svg.appendChild(svgElement('path', { d: sector, fill: 'currentColor' }));
  return svg;
}

/** Path of the filled sector (a full disk at or above the budget), or '' when there is none. */
function dialSector(fraction: number | null): string {
  if (fraction === null || fraction <= 0) return '';
  const r = 4.5;
  if (fraction >= 1) return `M${8 - r} 8a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
  const angle = fraction * Math.PI * 2;
  const x = 8 + r * Math.sin(angle);
  const y = 8 - r * Math.cos(angle);
  return `M8 8V${8 - r}A${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x.toFixed(3)} ${y.toFixed(3)}Z`;
}

/**
 * Load indicator: four ascending bars, `level` of them filled (0–4).
 * Unfilled bars keep a 1px outline so the scale stays readable.
 */
export function createSteps(level: number, size = SIZE, label = 'Load'): SVGSVGElement {
  const svg = createSvg('steps', size, `${label}: ${level} of 4`);
  const heights = [4, 7, 10, 13];
  for (let i = 0; i < 4; i++) {
    const h = heights[i];
    const x = i * 4;
    const y = 15 - h;
    svg.appendChild(i < level
      ? svgElement('rect', { x, y, width: 3, height: h, fill: 'currentColor' })
      : svgElement('rect', { x: x + 0.5, y: y + 0.5, width: 2, height: h - 1, fill: 'none', stroke: 'currentColor', 'stroke-width': 1 }));
  }

  return svg;
}

/**
 * Generic text plate, the same object as the memory glyphs' container:
 * 1px white border, flat dark grey, short white label ("GL2", "WGPU", "L").
 * `title` spells out short labels as a tooltip ("WGPU" → "WebGPU backend").
 * Styling lives in the `.tez-plate` rule of the overlay stylesheet.
 */
export function createPlate(label: string, title?: string): HTMLSpanElement {
  const el = document.createElement('span');
  const text = document.createElement('span');
  el.className = 'tez-plate';
  text.textContent = label;
  el.appendChild(text);
  // Tooltip text for the overlay's own instant tooltip, and the accessible name.
  if (title !== undefined) {
    el.dataset['tip'] = title;
    el.setAttribute('aria-label', `${label}: ${title}`);
  }
  return el;
}

/** Pixel art inside a plate: whole-pixel rects in ink, drawn at exactly one SVG unit per CSS pixel. */
function pixelIcon(className: string, width: number, height: number, d: string): SVGSVGElement {
  const svg = svgElement('svg', { class: className, viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true', 'shape-rendering': 'crispEdges' });
  svg.appendChild(svgElement('path', { d, fill: 'currentColor', 'fill-rule': 'evenodd' }));
  return svg;
}

/**
 * Display mode icon for the mode plate: a screen with readout bars in front of the screens behind
 * it, one per mode. Drawn twice, as tall as the plate capitals (10px, and 8px on narrow
 * overlays), so every edge stays on a whole pixel; the CSS shows the one that fits.
 */
export function createModeIcon(): SVGSVGElement[] {
  return [
    pixelIcon('tez-mode-icon tez-mode-icon-l', 10, 10, `${rect(0, 0, 8, 7)}${rect(1, 1, 7, 6)}${rect(2, 2, 5, 3)}${rect(2, 4, 4, 5)}${rect(9, 2, 10, 9)}${rect(2, 8, 9, 9)}`),
    pixelIcon('tez-mode-icon tez-mode-icon-s', 8, 8, `${rect(0, 0, 6, 5)}${rect(1, 1, 5, 4)}${rect(2, 2, 4, 3)}${rect(7, 2, 8, 7)}${rect(2, 6, 7, 7)}`)
  ];
}

/** A 5×3 caret pointing up: the mode list opens upwards from the bottom-right corner. */
export function createCaret(): SVGSVGElement {
  return pixelIcon('tez-caret', 5, 3, `${rect(2, 0, 3, 1)}${rect(1, 1, 4, 2)}${rect(0, 2, 5, 3)}`);
}
