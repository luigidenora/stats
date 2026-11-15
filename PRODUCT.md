# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Developers building three.js scenes, mostly inside the three.ez ecosystem (`@three.ez/main`, `@three.ez/instanced-mesh`, …). They attach the plugin while developing, profiling or demoing a scene. While it runs, their attention belongs to the canvas: they glance at the readout to check performance and then look back at the scene.

## Product Purpose
A three.js plugin for reading runtime statistics in a new way. It is a read-only overlay that reports frame timing, renderer counters, memory and GPU time without competing with the scene it measures. It succeeds when developers get the number they need at a glance, and the overlay is otherwise easy to forget.

## Positioning
Existing readouts (stats.js, ad-hoc `renderer.info` dumps, tweakpane monitors) are either too sparse or too noisy. This plugin takes its reading model from the embedded interface of a premium compact camera: dense but disciplined information laid over a live image, organised in levels of detail, with values set beside their labels. It also covers WebGL and WebGPU equally, and lets developers extend it with their own metrics.

## Operating Context
- Runs as an overlay on top of a live three.js canvas, often fullscreen, at any frame rate.
- Used during development, profiling sessions, demos and screen recordings.
- Configured from code: what to show and at which level of detail. At runtime, hovering an overlay element shows what it measures.

## Capabilities and Constraints
- **Metrics (v1):** all of the standard sources:
  - frame: FPS and ms, with recent history;
  - renderer: draw calls, triangles, points, lines;
  - memory: geometries, textures, and the JS heap where the browser exposes it;
  - GPU time: WebGL disjoint timer query or WebGPU timestamps, where available.
- **Extensible:** developers can customise the built-in set and register custom metrics and information.
- **Renderers:** `WebGLRenderer` and `WebGPURenderer`. Metrics a backend or browser cannot provide must be shown as unavailable, never faked.
- **Read-mostly:** the overlay shows a title on hover for each of its elements; only those elements take the pointer, so empty areas leave canvas events untouched. `interactive: false` makes it fully passive. No keyboard input.
- **Performance:** measuring must not noticeably affect the frame it measures.
- **Stack:** existing Vite + TypeScript library setup, with `three` as a peer dependency.
- **Package:** `@three.ez/stats`, ES module plus types, `three` as a peer dependency. `npm run check` builds, lints, type-checks, runs the unit tests and checks the packed tarball.

## Brand Commitments
- Part of the three.ez family, so it should follow that ecosystem's conventions for API, naming and docs.
- The camera that inspired the interface must **never be named**: not in code, comments, docs, package metadata, demos or marketing copy. Describe the style only in generic terms (minimal, technical, camera-like readout).
- The style is minimal, technical, simple and well structured. It exists to keep attention on the main canvas.

## Evidence on Hand
- Internal UI analysis of the reference camera interface (text only, 5 pages, kept outside the repo). It covers information architecture, information levels, component patterns and the interaction model. It contains no icons, colours, fonts or measurements, and its own guidance says not to assume them.
- No icon set, screenshots, benchmarks or users yet. None of these may be fabricated.

## Product Principles
1. **The canvas comes first.** Every element must justify the attention it takes from the scene.
2. **Read at a glance.** Values sit beside their labels, with a stable layout and positions that never jump between frames.
3. **Levels, not clutter.** Detail is organised in levels (full, reduced, none) chosen from code, never all shown at once by default.
4. **Report the truth.** Unavailable metrics are shown as unavailable, and the overlay's own cost stays negligible.
5. **Open by design.** Built-in metrics and custom metrics use the same mechanism.
