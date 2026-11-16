---
name: three.ez stats
description: A read-only statistics overlay for three.js that reads like a camera display over a live image.
colors:
  signal-yellow: "#f2cc1d"
  clip-red: "#ff2a1f"
  frame-red: "#ff3b30"
  gpu-green: "#2ee84a"
  cpu-blue: "#4f7dff"
  ink: "#f4f4f1"
  contour: "rgb(0 0 0 / 0.85)"
  plate-grey: "#222220"
  plate-level: "#55554f"
  menu-ground: "#0c0c0b"
  menu-hover: "#262624"
  hairline: "#3a3a37"
typography:
  readout-value:
    fontFamily: "Barlow Condensed, Roboto Condensed, Arial Narrow, sans-serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "tnum"
  readout-row:
    fontFamily: "Barlow Condensed, Roboto Condensed, Arial Narrow, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1
    fontFeature: "tnum"
  unit:
    fontFamily: "Barlow Condensed, Roboto Condensed, Arial Narrow, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.03em"
  stacked-label:
    fontFamily: "Barlow Condensed, Roboto Condensed, Arial Narrow, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "0.04em"
  plate:
    fontFamily: "Barlow Condensed, Roboto Condensed, Arial Narrow, sans-serif"
    fontSize: "14.29px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
  info-key:
    fontFamily: "Barlow Condensed, Roboto Condensed, Arial Narrow, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
  tooltip:
    fontFamily: "Barlow Condensed, Roboto Condensed, Arial Narrow, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.01em"
rounded:
  none: "0px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "24px"
components:
  plate:
    backgroundColor: "{colors.plate-grey}"
    textColor: "{colors.ink}"
    typography: "{typography.plate}"
    rounded: "{rounded.none}"
    height: "18px"
    padding: "0 4px"
  plate-toggle-on:
    backgroundColor: "{colors.plate-grey}"
    textColor: "{colors.signal-yellow}"
    typography: "{typography.plate}"
    rounded: "{rounded.none}"
    height: "18px"
  menu:
    backgroundColor: "{colors.menu-ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    width: "200px"
  menu-item-hover:
    backgroundColor: "{colors.menu-hover}"
    textColor: "{colors.ink}"
  menu-item-checked:
    backgroundColor: "{colors.signal-yellow}"
    textColor: "{colors.menu-ground}"
  tooltip:
    backgroundColor: "{colors.plate-grey}"
    textColor: "{colors.ink}"
    typography: "{typography.tooltip}"
    rounded: "{rounded.none}"
    padding: "4px 8px"
    width: "280px"
  time-graph:
    textColor: "{colors.ink}"
    width: "132px"
    height: "32px"
  image-histogram:
    textColor: "{colors.ink}"
    width: "256px"
    height: "88px"
---

# Design System: three.ez stats

## Overview

**Creative North Star: "The Camera Display Over a Render Loop"**

The overlay reads the way a technical camera display reads over a live image. Indicators hug the edges of the frame and the centre always belongs to the scene. There are no panels and no cards: values are drawn straight onto the canvas in white condensed tabular numerals, each with a 1px dark contour so it stays legible on any image. Containers exist only where a camera display would use them: small dark plates with a 1px white border for state (backend, mode, toggles), the mode menu and the tooltip.

Density is high but disciplined. Detail is set by levels (display modes cycled with the mode plate), never all at once. Positions are fixed per mode, so numbers never jump between frames. Colour is almost absent: the readout is ink on image. Yellow is the only voice for "look here", red means a budget badly missed, and the three series colours (red, green, blue) appear only while the graph that uses them is on screen, where they add up like light.

Motion is mechanical and edge-bound. When a mode changes, elements that move glide to their new grid cell. Elements that leave slide out past the nearest edge of the overlay and never fade in place. Under reduced motion, changes are instant.

**Key Characteristics:**
- White condensed tabular numerals with a 1px dark contour, with no backing panel.
- Values sit beside their labels. Labels are short uppercase pairs stacked to one side of the number.
- Dark plates with a 1px white border are the only filled containers in the readout layer.
- Square corners everywhere. Every line is 1px and lands on whole pixels.
- Additive RGB graphs: channels meet in white, and one contour surrounds their union.
- Yellow for alert and current choice, red for out of range, everything else ink.
- A fixed corner grid with a free centre. Nothing animates except layout changes.

## Colors

The palette is ink on image, plus one signal colour and one series triad that only appears with its graph.

### Primary
- **Series colours:** frame blue, GPU green, CPU red (`--tez-frame`, `--tez-gpu`, `--tez-cpu`); the RGB histogram uses fixed light channels `--tez-ch-r/g/b`. In the merged time graph each series is scaled to its own recent min and max, so they always mix.
- **Signal Yellow** (signal-yellow): the single "look here" colour. Used for readouts that cross their threshold, the current mode code on the mode plate, toggles that are on, the checked row of the mode menu (as a fill, with menu-ground text), keyboard focus outlines, time-graph samples that missed one refresh (past 1.25× budget), and the clipping marks on the histogram edges.

### Secondary
- **Frame Red** (frame-red): the frame-time series and the first histogram channel.
- **GPU Green** (gpu-green): the GPU-time series and the second histogram channel.
- **CPU Blue** (cpu-blue): the CPU-time series and the third histogram channel.

The three channels are chosen to add up like light (yellow, cyan, magenta, white where they overlap). Each keeps at least 5.7:1 against the dark contour.

### Tertiary
- **Clip Red** (clip-red): the colour for a badly missed budget. In the shipped build it colours only time-graph samples past 2.25× budget (two or more refreshes missed).

### Neutral
- **Ink** (ink): every number, label, glyph, graph frame, plate border and hairline rule. Warm off-white, not pure white.
- **Contour** (contour): near-black at 85% opacity. Drawn under all ink as a 1px outline: text-stroke for text, extra geometry for glyphs and graphs.
- **Plate Grey** (plate-grey): the interior of plates, the tooltip, and the memory-glyph container.
- **Plate Level** (plate-level): the lighter grey that rises inside a memory plate when it works as a level gauge.
- **Menu Ground** (menu-ground, `--tez-ground`): the mode menu background, and the text colour on the yellow checked row.
- **Menu Hover** (menu-hover, `--tez-hover`): the background of a hovered or focused menu row.
- **Hairline** (hairline, `--tez-rule`): the dim separators between menu rows and info-page rows. The heading rule of an info page uses ink instead.

### Named Rules
**The Yellow Means Look Rule.** Yellow is reserved for alerts and for the current choice. It never decorates, never labels a series, and never fills an area except the checked menu row.

**The Colour Only With Its Graph Rule.** The CPU and GPU readout labels carry their series colours only while the Graph mode graphs are on screen. The FPS label stays ink, like the on-time frame columns. In every other mode they go back to ink. Glyphs and dials always stay ink, even inside an alert or a coloured label.

**The Alerts Change Colour Only Rule.** An alert changes the colour of a value and nothing else: no weight change, no size change, no badge. The layout never moves.

## Typography

**Display Font:** Barlow Condensed (with Roboto Condensed, Arial Narrow, sans-serif)
**Body Font:** the same family; one condensed face carries the whole overlay.

The library does not load the font. It declares the stack and exposes it as `--tez-stats-font`, and the host page loads Barlow Condensed (weights 500/600/700) as the demo does.

**Character:** A narrow, technical sans in two weights. Medium (500) is used for values and semibold (600) for labels and plates. Numerals are always tabular, so digits never shift.

### Hierarchy
- **Readout value** (500, 26px, line-height 1, tabular): the large numbers of the top-left band (FPS, CPU and GPU ms, heap MB).
- **Readout row** (500, 20px, line-height 1, tabular): counter grid values, right-edge rows, info-page values and headings (600, 0.04em).
- **Unit** (600, 15px, 0.03em): a single unit set right after a number.
- **Stacked label** (600, 11px, line-height 0.95, 0.04em, uppercase content): a two-line label pair such as MS over CPU, set beside its value and right-aligned towards it. It also sets histogram axis labels, graph asides and distribution level lists.
- **Plate** (600, cap height 10px, so the font size is 10/0.7, 0.04em, uppercase content): the text inside plates. The capitals are trimmed with `text-box` and centred on whole pixels.
- **Tooltip** (500, 13px, line-height 1.3, 0.01em): the only running text in the overlay, at most 280px wide.

On overlays narrower than 640px (container query), the scale steps down: value 22, row 17, stack 10, unit 13, plate 16/8.

### Named Rules
**The Beside Not Above Rule.** A label sits beside its value, never above it as a heading. Numbers hug their label: a number before a unit or plate is right-aligned, and a number after a stacked label is left-aligned. The reserved width (a minimum width in `ch`) stays on the far side.

**The Contour Rule.** All text on the canvas carries a 2px stroke in contour colour painted under the fill (`paint-order: stroke fill`), so exactly 1px of contour shows outside each glyph. Text inside plates, the menu and the tooltip has no stroke, because those already sit on a dark ground.

## Layout

The overlay is a fixed, full-viewport CSS grid of named areas, positioned over the canvas. It takes the pointer only on its interactive elements.

- **Default arrangement** (three columns `1fr auto 1fr`, three rows `auto 1fr auto`): readout band top-left, right-edge rows top-right, large histogram under the band, distribution mid-right, counter grid bottom-left, mode graphs bottom-centre, backend plate plus toggles plus the mode plate bottom-right. The centre cell is always empty.
- **Left column**: the readout band, then a custom mode's rows, histogram, graphs and distribution, packed with the row gap. Taller than the room above the bottom row, it wraps into a second column.
- **Stacked** (when the strip does not fit between the corners): the graphs move up under the readouts, and counters and plates share the bottom row. **Tight**: the plates move above the counters. **Compact**: when even the stacked row is too narrow, the three graphs share it, each with its name above and no scale column. They never merge.
- **Side distribution**: the vertical distribution bar sits on the right edge only when the overlay is at least 720px wide and 420px tall, and gets shorter to fit its row. Below 120px it joins the bottom strip horizontally.
- **Short overlays** (under 480px tall): the narrow type sizes, whatever the width.
- **Safe area**: the edge padding is the larger of the spacing token and `env(safe-area-inset-*)`.
- **Modes are cumulative**: Simple shows the readout band without the heap; Performance adds the heap and the counter grid; Graph adds the time graphs and the pacing rows.

Spacing uses a base-4 scale, and the layout maths reads the same custom properties back, so CSS and the arrangement code agree: space-1 inside a readout, space-2 between label and graph and between plates, space-3 between rows and as the overlay's vertical padding, space-4 for cell gaps and edge padding, space-5 between readouts in the band (16px on narrow overlays). Graph boxes are 132×32 (220×32 merged), the image histogram 256×88, and a strip holds at most four graphs.

**The Free Centre Rule.** Every element lives in an edge cell. A new component gets a grid area at an edge, takes its gaps from the spacing scale, exits past its nearest edge, and hides in Off.

## Elevation & Depth

The system is flat. Nothing is lifted with offset or blurred shadows. Depth comes from the contour, which separates ink from any image, and from the dark plate interiors. Two uses of `box-shadow` exist, and both are spread-only geometry, not elevation:

### Shadow Vocabulary
- **Distribution contour** (`box-shadow: 0 0 0 1px rgb(0 0 0 / 0.85)`): the 1px dark contour around the distribution bar, matching the text and graph contour.

**The Contour Not Shadow Rule.** Separation from the image is always a centred 1px dark contour: text-stroke for text, geometry 1px wider for glyphs and graphs, spread-only box-shadow for boxes. Plates never get a contour.

## Shapes

Corners are square throughout (0px): plates, menu, tooltip, graph boxes, distribution bar. Every rule is 1px. Horizontal and vertical edges are placed on whole or half pixels so they render sharp.

Glyphs are drawn on a 16-unit grid and rendered at 16px or a multiple of it. Their container tells you what kind of number follows:
- **Per-frame work** (draw calls, triangles, points, lines): a free silhouette with no container, optionally contoured.
- **Resident memory** (geometries, textures, programs): a 14-unit plate with a 1px ink border and a plate-grey interior, with the symbol in ink. The interior can fill from the bottom with plate-level as a gauge.
- **Time** (CPU, GPU): a dial, a 1px ring with a filled sector equal to the used share of the frame budget, clockwise from 12. The inner disk is solid at or over budget. The ring is dashed and empty when timing is unavailable, never a fake 0%.
- **Load**: four ascending bars, filled up to the level. Unfilled bars keep a 1px outline.

## Components

### Plate
The basic state object, borrowed from the memory-glyph container.
- **Shape:** square, 18px tall (16px narrow), 4px side padding, 1px ink border, plate-grey interior.
- **Content:** short uppercase codes (GL2, WGPU, the mode code, page toggles), with the capitals centred on whole pixels.
- **Tooltip:** a short code spells itself out on hover ("WGPU" → WebGPU backend).

### Mode Plate
A plate that is also a button: a pixel-exact display icon (a screen with readout bars in front of the screens behind it, 10px, or 8px on narrow overlays, matching the plate capitals) followed by the current mode code (STD, PERF, MESH, MEM, IMG, INFO, OFF) in signal yellow. A caret plate shares its right border: a plain click on it opens the mode menu, so touch screens reach the list without a right click. The caret turns signal yellow while the menu is open.
- **Click:** steps to the next mode. **Right click:** opens the menu. The choice is remembered.
- **Focus:** a 1px signal-yellow outline with a 2px offset.
- **Off:** every cell hides except the mode plate, which drops to 55% opacity.

### Toggle Plates
Toggles defined by the page share the plate. While on, the text turns signal yellow. They sit between the backend plate and the mode plate, and their focus treatment matches the mode plate.

### Mode Menu
A camera-style list that opens upwards from the mode plate, aligned to its right edge.
- **Container:** menu-ground, 1px ink border, at least 200px wide, square, no text stroke.
- **Rows:** mode name on the left, code on the right (semibold, 80% opacity), hairline separators. 15px medium (unit size), 8px 12px padding.
- **States:** a hovered or focused row takes menu-hover. The current choice is filled signal yellow with menu-ground text. Escape or a click outside closes the menu.
- **Folded toggles:** when the plate row has no room, the toggles of the mode follow the modes after a 2px ink rule, as checkable rows (description on the left, plate label on the right, yellow while on).
- **Touch:** on a coarse pointer every plate takes taps from an invisible area 8px above and below and 4px to each side (half the plate gap), so a 16px plate is a 32px target and neighbours never overlap.

### Tooltip
Instant, styled like a plate: plate-grey, 1px ink border, 4px 8px padding, at most 280px wide, tooltip type. It is hidden while the menu is open.

### Readouts
- **Band** (top-left, one row): FPS, CPU ms, GPU ms, heap MB. Each is a stacked label beside a 26px value, with 24px between readouts.
- **Counter grid** (bottom-left): four columns of glyph and value pairs at 20px.
- An unavailable value shows an em dash, never a fabricated zero.

### Time Graph
A scrolling graph with one 1px track per sample, inside a 1px ink box.
- Horizontal graphs run newest on the right with values growing up. Vertical graphs scroll upwards. Mirrored graphs grow both ways from a dotted zero line.
- The budget is marked by 3px ticks outside the box on both sides, so the plot stays clean.
- Events sit on the free top edge: a 1×3px ink tick above the column of a frame that created a new shader program (frame graph). Ink, not yellow: yellow already means a missed refresh in the same graph.
- An uncoloured series is coloured per sample: ink on time, signal yellow past 1.25× budget, clip red past 2.25×. Coloured series (CPU, GPU) composite additively.
- One 1px contour surrounds the union of all series, so overlaps blend with no dark seam. The axis auto-scales to round steps (1, 2, 2.5, 5 × 10ⁿ), capped at twice the budget.

### Histogram
A 256×88 additive histogram of up to three channels (red, green, blue), in the same box language; the Image example uses it for the rendered image. The x axis is the value and the y axis is a square-root count. Edge bins never set the scale. A non-empty edge (more than 1% of pixels clipped) lights a 2px signal-yellow mark on that edge, and its HI/LO summary turns yellow. Axis labels sit underneath, and channel names are labels coloured by channel.

### Event Marks
Above the frame graph, outside the box: a 1×3 tick for a shader compile, the same tick with a 2×2 flag for an event marked by the app. Ink only; they never change colour.

### Distribution Bar
One segment per level, 132×14 horizontal or 14px wide vertical, with a 1px ink border and contour, and segments separated by 2px of contour colour. The fills are monochrome patterns, in order: solid, hatched (135°), dotted, outline. With an RGB histogram on screen, the first three take the channel colours so bar and histogram read together.

### Motion
Layout changes use FLIP. Moved elements glide in 280ms (`cubic-bezier(0.22, 1, 0.36, 1)`). Elements that enter slide in from the nearest overlay edge. Elements that leave become a still copy that slides 8px past the nearest edge and fades out (`cubic-bezier(0.55, 0, 0.75, 0.2)`). With `prefers-reduced-motion: reduce`, changes are instant. Values never animate.

## Do's and Don'ts

### Do:
- **Do** draw every value straight onto the canvas in ink, with the 1px contour (2px stroke painted under the fill).
- **Do** take every gap from the spacing scale (4, 8, 12, 16, 24), and give every new element an edge grid cell.
- **Do** put labels beside values as short uppercase stacked pairs, and keep numerals tabular with a reserved width.
- **Do** use a plate (1px ink border, plate-grey, square) for any state code or control.
- **Do** signal an alert by changing colour to signal yellow only, and reserve clip red for a badly missed budget.
- **Do** show unavailable metrics as an em dash, a dashed dial, or an empty graph, never as zero.
- **Do** composite overlapping series additively and surround their union with one contour.
- **Do** make leaving elements exit past the nearest edge in 280ms, and respect reduced motion.
- **Do** render glyphs at 16px or a multiple of it, with ink in currentColor and the category shown by the container.

### Don't:
- **Don't** put a backing panel or card behind the readouts. The only filled containers are plates, the menu, the tooltip and the info pages.
- **Don't** round the corners of boxes, use offset or blurred shadows, or use gradients as shading. The only gradients are the hatched and dotted pattern fills of the distribution levels.
- **Don't** use yellow for decoration or series identity, or colour readout labels when their graph is not on screen.
- **Don't** change weight, size or position to signal an alert.
- **Don't** place anything in the centre of the overlay.
- **Don't** set a label above its value as a heading or eyebrow.
- **Don't** fade an element out in place. It leaves past the nearest edge.
- **Don't** name the camera that inspired the interface anywhere. Describe it only as a camera-like technical readout.
