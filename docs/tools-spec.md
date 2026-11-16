# Tools spec

What `@three.ez/stats` is, what it ships and what it leaves to plugins.

## Position

A statistics overlay that stays open while people work: it measures the renderer and the frame
and shows the numbers in three levels of detail. It is not an inspector or a frame debugger, and
it does not advise: the three.js devtools, Spector.js and the browser's Performance panel cover
those.

Rules every feature follows:

- **Real values only.** Estimates are labelled "est."; what a backend cannot measure is "—".
- **Read-only.** The overlay never changes the scene, the renderer or the canvas, and adds no
  global. The only change to the renderer (`renderer.info.autoReset`) is opt-in
  (`countAllPasses`) and undone on dispose; GPU timing runs only when the app's own timer query is
  not active, and turns off with `gpuTimer: false`. A test renders a real scene through every mode
  and checks it is unchanged.
- **Opinionated interface, simple API.** A feature is plain data or one call; the overlay decides
  layout, formatting, colours, animation and failure behaviour.
- **Never break a frame.** User callbacks are guarded; a failing one is switched off with one
  console warning.

## Modes

Cumulative: each built-in mode adds to the previous one.

| Mode | Code | Shows |
| --- | --- | --- |
| Simple | `STD` | Frame rate, CPU time, GPU time |
| Performance | `PERF` | Simple, plus the JS heap and the counters bottom-left (draw calls, triangles, points, lines, geometries, textures, programs, and objects with a `scene`) |
| Graph | `GRPH` | Performance, plus the frame / CPU / GPU graphs |
| Off | `OFF` | The mode plate only |

Custom modes keep the Performance readouts and add their own graphs, rows, histogram,
distribution and toggles. Image and LOD are custom modes in `examples/`, not part of the package.

## Shipped

| Feature | Entry |
| --- | --- |
| Readouts, counters, time graphs, frame pacing rows | core |
| Objects counter (with `scene`) | core |
| Timeline events (`stats.event()`) | core |
| Session recording and report (`startRecording()`) | core |
| Pressure signal for adaptive quality (`onPressure`) | core |
| Snapshot as JSON and the global hook | core |
| Custom modes, metrics, graphs, histograms, distributions, toggles | core |
| Production no-op | `@three.ez/stats/dev` |
| Agent tools and WebMCP registration | `@three.ez/stats/agent` |

### Responsive behaviour

- Custom content packs into one column top-left, wrapping into a second column on short screens.
- The time graphs go inline, then stacked under the readouts, then compact (three in one row,
  short names, no scale) as the overlay narrows. They never merge.
- Tooltips are atomic: a title and half a line. The built-in graphs have none.
- Overlays under 480 px tall use the small type.
- Edges follow the safe area (`env(safe-area-inset-*)`, with `viewport-fit=cover`).
- On touch screens every plate takes taps from a 32 px area.
- Toggles that do not fit beside the mode plate fold into its menu.

## Removed

Decided after the owner's review: the overlay measures and shows, it does not advise or inspect.

- Diagnostics: the TIP plate, the rules, the health monitor, `addRule`.
- The probe add-on (pick and move objects).
- The Info mode: technical pages, the canvas thumbnail, the camera page.
- The Mesh and Memory modes and their graphs.
- The built-in Image mode (now an example) and its waveform and vectorscope.
- The top-right rows (P95, PEAK, DROP, `mark()` segments) and the REC plate: pacing and
  segments are in the snapshot, recording is an API.
- The merged RGB graph and its lane.

## Planned

- User Timing: `mark()` segments as `performance.measure`, opt-in.
- Report comparison: `compareReports(before, after)`.
- Refresh rate detection for the default budget.
- An LOD add-on, if the example proves useful as a package.
