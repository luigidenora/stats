const STYLE_ID = 'tez-stats-style';
/**
 * Overlay stylesheet. Every colour and the font are custom properties on `.tez-stats`,
 * so a page can restyle the overlay without touching this file.
 * Text gets a 1px dark contour from `-webkit-text-stroke` painted under the fill (`paint-order`);
 * glyphs, dials and graphs draw their own contour as geometry. Plates (dark box, white border,
 * white text) are the only element without one.
 */
const CSS = `
.tez-stats {
  --tez-ink: #f4f4f1;
  --tez-alert: #f2cc1d;
  --tez-clip: #ff2a1f;
  /* RGB channels of the time graph: blue = frame, green = GPU, red = CPU. They add up like light
     (yellow, cyan, magenta, white). Each keeps at least 5.7:1 against the dark contour (WCAG AA). */
  --tez-frame: #4f7dff;
  --tez-gpu: #2ee84a;
  --tez-cpu: #ff3b30;
  /* Fixed light channels for the RGB histogram (red, green, blue), independent of what each series means. */
  --tez-ch-r: #ff3b30;
  --tez-ch-g: #2ee84a;
  --tez-ch-b: #4f7dff;
  --tez-plate: #222220;
  --tez-plate-level: #55554f;
  --tez-outline: rgb(0 0 0 / 0.85);
  /* Neutrals for surfaces the overlay owns: menu ground and hover, hairline rules, INFO backdrop. */
  --tez-ground: #0c0c0b;
  --tez-hover: #262624;
  --tez-rule: #3a3a37;
  --tez-backdrop: #050505;
  /* Spacing scale, base 4. Every gap in the overlay is one of these; layout() reads the same
     values back from computed styles, so CSS and the arrangement maths never drift apart.
     1: inside a readout · 2: label to graph, plates · 3: rows · 4: cells, edges · 5: between readouts */
  --tez-space-1: 4px;
  --tez-space-2: 8px;
  --tez-space-3: 12px;
  --tez-space-4: 16px;
  --tez-space-5: 24px;
  /* Type sizes; the container query at the end scales them down on narrow overlays. */
  --tez-size-value: 26px;
  --tez-size-row: 20px;
  --tez-size-stack: 11px;
  --tez-size-unit: 15px;
  /* Plate: total height and capital height, kept so the caps sit on whole pixels. */
  --tez-plate-h: 18px;
  --tez-plate-cap: 10px;
  container: tez-stats / size;
  position: fixed;
  z-index: 10000;
  box-sizing: border-box;
  /* Named grid areas; layout() picks the arrangement, flip.ts animates the change. */
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'band     .     rows'
    'hist     .     side'
    'counters strip backend';
  gap: var(--tez-space-3) var(--tez-space-4);
  /* Safe area: under a notch or a home indicator the edges move in (env() is 0 elsewhere; pages
     opt in with viewport-fit=cover). layout() reads the computed padding, so the maths follow. */
  padding:
    max(var(--tez-space-3), env(safe-area-inset-top, 0px))
    max(var(--tez-space-4), env(safe-area-inset-right, 0px))
    max(var(--tez-space-3), env(safe-area-inset-bottom, 0px))
    max(var(--tez-space-4), env(safe-area-inset-left, 0px));
  color: var(--tez-ink);
  font-family: var(--tez-stats-font, 'Barlow Condensed', 'Roboto Condensed', 'Arial Narrow', sans-serif);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  /* 2px stroke centred on the glyph edge, painted under the fill: 1px of contour shows outside. */
  -webkit-text-stroke: 2px var(--tez-outline);
  paint-order: stroke fill;
  pointer-events: none;
  user-select: none;
  contain: layout style;
}
.tez-stats[hidden] { display: none; }
/* Anything hidden by mode scoping stays hidden whatever its display rule. */
.tez-stats [hidden] { display: none !important; }
.tez-stats * { box-sizing: border-box; }
.tez-stats svg, .tez-stats canvas { display: block; flex: none; }
.tez-rows { display: grid; justify-items: end; gap: var(--tez-space-1); }
.tez-row { display: flex; align-items: center; gap: var(--tez-space-2); height: var(--tez-size-row); font-size: var(--tez-size-row); }
.tez-interactive .tez-hit {
  pointer-events: auto;
  /* Touch: a long press explains instead of selecting text or opening the system callout. */
  -webkit-touch-callout: none;
  user-select: none;
  touch-action: manipulation;
}
/* Instant tooltip, styled like a plate. */
/* Surfaces (tooltip, menu, plates) are 96% opaque on purpose: a fully opaque box over a WebGL
   canvas lets some compositors skip repainting the canvas under it, so a box that moves away
   leaves a black hole behind. 4% of the image through is invisible on a dark plate. */
.tez-tip {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  max-width: 280px;
  padding: var(--tez-space-1) var(--tez-space-2);
  border: 1px solid var(--tez-ink);
  background: color-mix(in srgb, var(--tez-plate) 96%, transparent);
  color: var(--tez-ink);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  letter-spacing: 0.01em;
  -webkit-text-stroke: 0;
  pointer-events: none;
}
.tez-tip[hidden] { display: none; }
/* Rich tooltip: title, text, legend of colours and graph symbols, live values, one tip. */
.tez-tip-rich { display: grid; gap: var(--tez-space-1); width: max-content; max-width: min(280px, calc(100% - 8px)); padding: var(--tez-space-2); }
.tez-tip-title { font-size: var(--tez-size-unit); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.tez-tip-legend, .tez-tip-values { display: grid; gap: var(--tez-space-1); }
.tez-tip-values { padding-top: var(--tez-space-1); border-top: 1px solid var(--tez-rule); }
.tez-tip-values:empty { display: none; }
.tez-tip-row { display: flex; align-items: center; gap: var(--tez-space-2); }
.tez-tip-pair { display: flex; justify-content: space-between; gap: var(--tez-space-4); }
.tez-tip-key { font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; font-size: var(--tez-size-stack); align-self: center; }
.tez-tip-value { font-variant-numeric: tabular-nums; }
.tez-tip-advice { display: flex; gap: var(--tez-space-2); padding-top: var(--tez-space-1); border-top: 1px solid var(--tez-rule); color: var(--tez-alert); }
.tez-tip-advice-key { font-weight: 600; letter-spacing: 0.04em; }
.tez-tip-section { display: grid; gap: 2px; padding-top: var(--tez-space-1); border-top: 1px solid var(--tez-rule); }
.tez-tip-section-title { color: var(--tez-alert); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; font-size: var(--tez-size-stack); }
.tez-tip-section-advice { opacity: 0.8; }
/* Legend marks, 12×8, drawn on whole pixels: a colour swatch or a graph symbol. */
.tez-tip-mark { position: relative; flex: none; width: 12px; height: 8px; }
.tez-tip-mark[data-mark='ink'] { background: var(--tez-ink); }
.tez-tip-mark[data-mark='alert'] { background: var(--tez-alert); }
.tez-tip-mark[data-mark='clip'] { background: var(--tez-clip); }
.tez-tip-mark[data-mark='frame'] { background: var(--tez-frame); }
.tez-tip-mark[data-mark='gpu'] { background: var(--tez-gpu); }
.tez-tip-mark[data-mark='cpu'] { background: var(--tez-cpu); }
.tez-tip-mark[data-mark='r'] { background: var(--tez-ch-r); }
.tez-tip-mark[data-mark='g'] { background: var(--tez-ch-g); }
.tez-tip-mark[data-mark='b'] { background: var(--tez-ch-b); }
/* Budget tick: a 3px tick outside the box edge, as on the graphs. */
.tez-tip-mark[data-mark='budget-tick'] { background: linear-gradient(var(--tez-ink), var(--tez-ink)) 8px 0 / 1px 8px no-repeat, linear-gradient(var(--tez-ink), var(--tez-ink)) 4px 4px / 3px 1px no-repeat; }
/* Event tick: 1×3 above the top edge. */
.tez-tip-mark[data-mark='event-tick'] { background: linear-gradient(var(--tez-ink), var(--tez-ink)) 0 5px / 12px 1px no-repeat, linear-gradient(var(--tez-ink), var(--tez-ink)) 6px 1px / 1px 3px no-repeat; }
.tez-tip-mark[data-mark='flag-tick'] { background: linear-gradient(var(--tez-ink), var(--tez-ink)) 0 5px / 12px 1px no-repeat, linear-gradient(var(--tez-ink), var(--tez-ink)) 5px 1px / 1px 3px no-repeat, linear-gradient(var(--tez-ink), var(--tez-ink)) 6px 1px / 2px 2px no-repeat; }
/* Criticality lane: the box bottom edge with yellow and red segments under it. */
.tez-tip-mark[data-mark='lane'] { background: linear-gradient(var(--tez-ink), var(--tez-ink)) 0 2px / 12px 1px no-repeat, linear-gradient(var(--tez-alert), var(--tez-alert)) 2px 4px / 4px 2px no-repeat, linear-gradient(var(--tez-clip), var(--tez-clip)) 7px 4px / 3px 2px no-repeat; }
/* The mode menu replaces the tooltip while it is open. */
.tez-stats:has(.tez-menu:not([hidden])) .tez-tip { display: none; }
.tez-c { min-width: 0; }
.tez-c-band { grid-area: band; justify-self: start; align-self: start; }
.tez-c-side { grid-area: side; justify-self: end; align-self: center; }
.tez-c-hist { grid-area: hist; justify-self: start; align-self: start; }
.tez-c-hist:empty { display: none; }
/* Large histogram: label left, plot with its axis row underneath, summary right. */
.tez-histogram { align-items: start; }
.tez-axis-row {
  display: flex;
  justify-content: space-between;
  margin-top: var(--tez-space-2);
  font-size: var(--tez-size-stack);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.tez-legend { display: flex; gap: var(--tez-space-2); }
.tez-c-side:empty { display: none; }
.tez-c-backend { grid-area: backend; justify-self: end; align-self: end; }
.tez-c-rows { grid-area: rows; justify-self: end; align-self: start; }
.tez-c-counters { grid-area: counters; justify-self: start; align-self: end; }
.tez-c-strip { grid-area: strip; justify-self: center; align-self: end; }
.tez-c-counters { display: grid; gap: var(--tez-space-3); justify-items: start; }
/* FPS, CPU, GPU and heap readouts on one row, top-left. */
.tez-band { display: flex; flex-wrap: nowrap; align-items: center; gap: var(--tez-space-5); }
.tez-c-backend { display: flex; align-items: center; gap: var(--tez-space-2); }
/* The backend plate's wrapper is a flex box too, so no line box adds height around the plate. */
.tez-backend { display: flex; }
/* The mode's graphs: compact panels side by side. */
.tez-strip { display: grid; grid-auto-flow: column; gap: var(--tez-space-3) var(--tez-space-5); align-items: center; }
.tez-strip:empty { display: none; }
.tez-panel { display: grid; grid-template-columns: auto auto auto; align-items: center; gap: var(--tez-space-2); }
.tez-aside { text-align: left; min-width: 4ch; }
/* Distribution bar (e.g. objects per LOD level): one segment per bucket, bright L0 to dim Ln. */
.tez-dist {
  display: flex;
  width: 132px;
  height: 14px;
  border: 1px solid var(--tez-ink);
  box-shadow: 0 0 0 1px var(--tez-outline);
}
/* Level fills, monochrome: solid, hatched, dotted, outline. With an RGB histogram on screen the
   first three take its channel colours, so bar and histogram read together. */
.tez-dist-seg { --tez-seg: var(--tez-ink); min-width: 0; background: var(--tez-seg); }
.tez-dist-seg[data-i='1'] { background: repeating-linear-gradient(135deg, var(--tez-seg) 0 1.5px, transparent 1.5px 4px); }
.tez-dist-seg[data-i='2'] { background: radial-gradient(var(--tez-seg) 0.9px, transparent 1.1px) 0 0 / 4px 4px; }
.tez-dist-seg[data-i='3'] { background: none; box-shadow: inset 0 0 0 1px var(--tez-seg); }
.tez-stats[data-rgb] .tez-dist-seg[data-i='0'] { --tez-seg: var(--tez-ch-r); }
.tez-stats[data-rgb] .tez-dist-seg[data-i='1'] { --tez-seg: var(--tez-ch-g); background: var(--tez-seg); }
.tez-stats[data-rgb] .tez-dist-seg[data-i='2'] { --tez-seg: var(--tez-ch-b); background: var(--tez-seg); }
.tez-stats[data-rgb] .tez-dist-level[data-i='0'] { color: var(--tez-ch-r); }
.tez-stats[data-rgb] .tez-dist-level[data-i='1'] { color: var(--tez-ch-g); }
.tez-stats[data-rgb] .tez-dist-level[data-i='2'] { color: var(--tez-ch-b); }
.tez-dist-seg + .tez-dist-seg { border-left: 2px solid var(--tez-outline); }
.tez-dist-levels { display: none; }
/* Vertical distribution on the right edge: label on top, the level list beside the bar, totals below. */
.tez-dist-vertical { grid-template-columns: auto; justify-items: end; gap: var(--tez-space-2); }
.tez-dist-vertical .tez-stack { text-align: right; }
.tez-dist-vertical .tez-panel-plot { display: flex; gap: var(--tez-space-2); }
.tez-dist-vertical .tez-dist { flex-direction: column; width: 14px; }
.tez-dist-vertical .tez-dist-seg + .tez-dist-seg { border-left: 0; border-top: 2px solid var(--tez-outline); }
.tez-dist-vertical .tez-dist-levels {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: var(--tez-size-stack);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-align: right;
}
.tez-dist-level { display: flex; align-items: center; justify-content: flex-end; min-height: 1.1em; }
/* Mode plate: a display icon and the mode code, then a caret plate sharing its border. Click
   steps through the modes; the caret or a right click opens the menu. */
.tez-disp { position: relative; display: inline-flex; }
.tez-disp-button, .tez-disp-more {
  margin: 0;
  font-family: inherit;
  cursor: pointer;
  pointer-events: auto;
}
.tez-disp-button { gap: var(--tez-space-1); }
.tez-disp-more { margin-left: -1px; padding: 0 3px; }
.tez-disp-button:focus-visible, .tez-disp-more:focus-visible { outline: 1px solid var(--tez-alert); outline-offset: 2px; position: relative; }
.tez-disp-more[aria-expanded='true'] { color: var(--tez-alert); }
.tez-stats .tez-mode-icon-s { display: none; }
.tez-disp-code { color: var(--tez-alert); }
/* Page-defined toggles: same plate as the mode control, yellow text while on. */
.tez-toggle { margin: 0; font-family: inherit; cursor: pointer; pointer-events: auto; }
.tez-toggle[hidden] { display: none; }
.tez-toggle[aria-pressed='true'] { color: var(--tez-alert); }
.tez-toggle:focus-visible { outline: 1px solid var(--tez-alert); outline-offset: 2px; }
.tez-menu {
  position: absolute;
  /* The mode plate sits bottom-right: the menu opens upwards, aligned to its right edge. */
  bottom: calc(100% + var(--tez-space-2));
  right: 0;
  z-index: 2;
  display: grid;
  min-width: 200px;
  border: 1px solid var(--tez-ink);
  background: color-mix(in srgb, var(--tez-ground) 96%, transparent);
  -webkit-text-stroke: 0;
  pointer-events: auto;
}
.tez-menu[hidden] { display: none; }
/* Folded toggles: below the modes, after a thicker rule; checked ones in yellow, like the plate. */
.tez-menu-first { border-top: 2px solid var(--tez-ink); }
.tez-menu-toggle[aria-checked='true'] .tez-menu-code { color: var(--tez-alert); }
/* Rows like a camera menu: hairline separators, the current choice filled in yellow. */
.tez-menu-item {
  display: flex;
  justify-content: space-between;
  gap: var(--tez-space-4);
  padding: var(--tez-space-2) var(--tez-space-3);
  border: 0;
  border-bottom: 1px solid var(--tez-rule);
  background: transparent;
  color: var(--tez-ink);
  font-family: inherit;
  font-size: var(--tez-size-unit);
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.02em;
  text-align: left;
  cursor: pointer;
}
.tez-menu-item:last-child { border-bottom: 0; }
.tez-menu-item:hover, .tez-menu-item:focus-visible { background: var(--tez-hover); outline: none; }
.tez-menu-item[aria-checked='true'] { background: var(--tez-alert); color: var(--tez-ground); }
.tez-menu-code { font-weight: 600; opacity: 0.8; }
/* Off: only the mode plate stays, dimmed. */
/* Off: every grid cell hides except the mode plate. Generic on purpose, so new cells follow the rule. */
.tez-off .tez-c:not(.tez-c-backend), .tez-off .tez-c-backend > :not(.tez-disp) { visibility: hidden; }
/* Leaving elements: a still copy that slides out; never interactive. */
.tez-ghost, .tez-ghost * { pointer-events: none !important; }
.tez-disp-off { opacity: 0.55; }
.tez-stacked {
  grid-template-columns: minmax(0, 1fr) auto;
  /* Narrow: the graphs move up, right under the readouts; counters and plates share the bottom row. */
  grid-template-rows: auto auto auto minmax(0, 1fr) auto auto;
  grid-template-areas: 'band band' 'strip strip' 'hist hist' '. .' '. rows' 'counters backend';
}
.tez-stacked .tez-c-strip { justify-self: start; align-self: start; }
.tez-stacked .tez-c-rows { align-self: end; }
/* Very narrow: the plates move above the counters instead of overlapping them. */
.tez-stacked.tez-tight { grid-template-rows: auto auto auto minmax(0, 1fr) auto auto auto; grid-template-areas: 'band band' 'strip strip' 'hist hist' '. .' '. rows' '. backend' 'counters counters'; }
.tez-strip.tez-column { grid-auto-flow: row; justify-items: start; }
.tez-grid { display: grid; grid-template-columns: repeat(4, max-content); gap: var(--tez-space-2) var(--tez-space-5); font-size: var(--tez-size-row); }
.tez-grid:empty { display: none; }
.tez-pair { display: flex; align-items: center; gap: var(--tez-space-1); }
.tez-num { display: inline-block; min-width: var(--tez-w, 3ch); }
/* Numbers hug their label: right-aligned before a unit or plate, left-aligned after a stacked label. The reserved width stays on the far side. */
.tez-row .tez-num { text-align: right; }
.tez-value .tez-num { text-align: left; }
.tez-value { display: flex; align-items: center; gap: var(--tez-space-1); font-size: var(--tez-size-value); }
.tez-stack { display: grid; font-size: var(--tez-size-stack); font-weight: 600; line-height: 0.95; letter-spacing: 0.04em; text-align: right; }
.tez-unit { font-size: var(--tez-size-unit); font-weight: 600; letter-spacing: 0.03em; }
/* Alerts change colour only: no weight or size change, so the layout never moves. */
.tez-alert { color: var(--tez-alert); }
/* Badly late (two or more refreshes missed): the clip red, as in the graphs. */
.tez-clip { color: var(--tez-clip); }
/* Icons (glyphs, dials) always stay in ink, even inside an alert or a coloured label. */
.tez-icon, .tez-stats svg { color: var(--tez-ink); }
.tez-frame { color: var(--tez-frame); }
.tez-ch-r { color: var(--tez-ch-r); }
.tez-ch-g { color: var(--tez-ch-g); }
.tez-ch-b { color: var(--tez-ch-b); }
.tez-cpu { color: var(--tez-cpu); }
.tez-gpu { color: var(--tez-gpu); }
/* The readout labels carry the series colour only while the graphs that use it are on screen. */
.tez-stats:not([data-mode='graph']) .tez-c-band .tez-frame,
.tez-stats:not([data-mode='graph']) .tez-c-band .tez-cpu,
.tez-stats:not([data-mode='graph']) .tez-c-band .tez-gpu { color: inherit; }
.tez-plate {
  /* Pixel-exact centring: the font size makes the capitals exactly --tez-plate-cap tall (Barlow's
     cap height is 0.7 em) and text-box trims the line to the caps, so with a 1px border the
     remaining space splits evenly on whole pixels (18/10 and 16/8 both leave 3px each side). */
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: var(--tez-plate-h);
  padding: 0 4px;
  border: 1px solid var(--tez-ink);
  background: color-mix(in srgb, var(--tez-plate) 96%, transparent);
  color: var(--tez-ink);
  font-size: calc(var(--tez-plate-cap) / 0.7);
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.04em;
  -webkit-text-stroke: 0;
}
.tez-plate > span { display: block; text-box: trim-both cap alphabetic; }
/* Touch: a finger needs about 32px. The plates keep their look; an invisible area around each
   one takes the tap. Sideways it grows by half the 8px gap only, so neighbours never overlap;
   the mode plate and its caret touch, so each grows away from the other. */
@media (pointer: coarse) {
  .tez-interactive button.tez-plate { position: relative; }
  .tez-interactive button.tez-plate::after { content: ''; position: absolute; inset: -8px -4px; }
  .tez-interactive .tez-disp-button::after { inset: -8px 0 -8px -4px; }
  .tez-interactive .tez-disp-more { padding: 0 6px; }
  .tez-interactive .tez-disp-more::after { inset: -8px -4px -8px 0; }
}
/* Short overlays (a phone on its side): the small type and tighter rows, whatever the width,
   so the readouts never eat a third of the height. */
@container tez-stats (max-height: 480px) {
  .tez-stats > * {
    --tez-size-value: 22px;
    --tez-size-row: 17px;
    --tez-size-stack: 10px;
    --tez-size-unit: 13px;
    --tez-plate-h: 16px;
    --tez-plate-cap: 8px;
    --tez-space-5: 16px;
  }

  .tez-stats .tez-mode-icon-l { display: none; }
  .tez-stats .tez-mode-icon-s { display: block; }
}
@container tez-stats (max-width: 640px) {
  .tez-stats > * {
    --tez-size-value: 22px;
    --tez-size-row: 17px;
    --tez-size-stack: 10px;
    --tez-size-unit: 13px;
    --tez-plate-h: 16px;
    --tez-plate-cap: 8px;
  }

  /* The 8px icon matches the 8px capitals, pixel for pixel. */
  .tez-stats .tez-mode-icon-l { display: none; }
  .tez-stats .tez-mode-icon-s { display: block; }

  .tez-stats > * { --tez-space-5: 16px; }
}
`;

/** Overlays alive per document: the stylesheet leaves with the last one. */
const users = new WeakMap<Document, number>();

export function injectStyles(doc: Document): void {
  users.set(doc, (users.get(doc) ?? 0) + 1);
  if (doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

/** Removes the stylesheet when the last overlay of the document is disposed. */
export function releaseStyles(doc: Document): void {
  const count = (users.get(doc) ?? 1) - 1;
  users.set(doc, count);
  if (count <= 0) doc.getElementById(STYLE_ID)?.remove();
}
