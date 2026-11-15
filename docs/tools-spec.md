# Tools spec

What `@three.ez/stats` adds on top of counters and graphs, for the three kinds of people who keep
it open: developers, environment and lighting designers, and game developers.

## Position

The overlay is the instrument that is always on: it measures, records and explains. It does not
try to be an inspector or a frame debugger, because good ones exist (the three.js devtools
extension, Spector.js, the browser's Performance panel).

Rules every tool follows:

- **Real values only.** Anything estimated is labelled "est."; anything a backend cannot measure
  is "—".
- **Read-only core.** The main entry never changes the scene or the render. Tools that do (moving
  an object, debug views) live in add-ons with their own import.
- **Opinionated interface, simple API.** A tool is plain data or one call; the overlay decides
  layout, formatting, colours, animation and failure behaviour.
- **Never break a frame.** User callbacks are guarded; a failing one is switched off with one
  console warning.

## Status

| Tool | Entry | Status |
| --- | --- | --- |
| Timeline events | core | shipped |
| Session recording and report | core | shipped |
| Pressure signal | core | shipped |
| Camera readout and depth precision check | core | shipped |
| Image scopes: waveform, vectorscope, zebra, framing guides, pixel readout | core | shipped |
| Production no-op build | `@three.ez/stats/dev` | shipped |
| Probe: pick an object, move it, read its coordinates | `@three.ez/stats/probe` | shipped |
| User Timing and long-task attribution | core | planned |
| Report comparison (A/B) | core | planned |
| Snapshot diff of scene and memory | core | planned |
| Shader compile attribution | core | planned |
| Asset loading timeline | core | planned |
| Long-session drift | core | planned |
| Input latency | core | planned |
| Lazy loader | `@three.ez/stats/lazy` | planned |
| Debug views (overdraw, mip level, texel density) | `@three.ez/stats/views` | planned |
| LOD mode | `@three.ez/stats/lod` | planned |

## Shipped

### Timeline events

*Question it answers: what was the app doing when the frame hitched?*

```ts
stats.event('level-load');
```

- Marks the graph column being built with a flag tick above the frame graph (shader compiles keep
  their plain tick). The name is kept for the session report.
- Callable at any time, inside or outside `begin()` / `end()`.

### Session recording and report

*Questions: how did this run perform, and did my change make it better?*

```ts
stats.startRecording();
// … play …
const report = stats.stopRecording();
```

- `StatsReport`: duration, frames, average FPS, **1% low** FPS (the mean of the slowest 1% of
  frames), frame time P50 / P95 / P99 / worst, dropped refreshes, CPU and GPU averages and
  worst, draw call and triangle average and maximum, memory counters at start and end, the named
  events with their time, the diagnostics that fired, budget, profile and backend.
- UI: a `REC` plate in Performance mode. Its tooltip shows the last report. `onReport` receives
  every finished report; `stats.report` keeps the last one.
- A hidden tab pauses the recording; the gap is not a frame.
- Counters are deterministic, so a report works as a CI assertion (Playwright:
  `expect(report.calls.max).toBeLessThan(300)`). Timings in headless browsers are not reliable.
- Limit: 10 minutes at 240 Hz; a longer recording stops by itself.

### Pressure signal

*Question: when should my app lower or raise its quality?*

```ts
new Stats(renderer, {
  onPressure: (pressure) => {
    if (pressure === 'high') renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.25));
    if (pressure === 'low') renderer.setPixelRatio(Math.min(devicePixelRatio, renderer.getPixelRatio() + 0.25));
  }
});
```

- `'high'`: the busiest side (CPU or GPU) is past 95% of the budget, or P95 is past 1.25×, for
  2 seconds. `'low'`: under 60% with a clean P95 for 4 seconds. Otherwise `'ok'`.
- Called when the level changes, and again every 2 seconds while it stays high or low, so a
  controller can keep stepping. `stats.pressure` reads the current level.
- The overlay only signals. What to change is the app's decision.

### Camera readout and depth precision

*Questions: what lens is this, and why is there z-fighting?*

```ts
new Stats(renderer, { scene, camera });
```

- INFO gets a Camera page: type, field of view, 35 mm equivalent focal length, aspect, near, far,
  far / near ratio, position.
- A `depth-precision` check: a far / near ratio past 100 000 without a logarithmic or reversed
  depth buffer raises a tip.

### Image scopes

*Questions: is the image exposed well, is anything clipped, is there a colour cast, is the shot
framed?* The tools of a camera's display, on the rendered image.

- **RGB histogram** (existing), **waveform** (luma per image column) and **vectorscope** (hue and
  saturation) in Image mode.
- **ZEBRA** plate: stripes over clipped highlights, on the canvas.
- **GRID** plate: rule-of-thirds lines and a centre mark.
- **PIX** row: colour of the pixel under the pointer, as hex, with R, G, B and luma in its
  tooltip.
- All read one 256×144 copy of the canvas, four times a second, only while Image mode is on.
- Limit: values are the displayed image, after tone mapping and encoding, 8 bits per channel.

### Production no-op build

*Question: how do I ship without the overlay in my bundle?*

```ts
import { Stats } from '@three.ez/stats/dev';
```

- Same class and types. Under the `production` export condition (set by Vite and webpack from
  the build mode) it resolves to a no-op of a few hundred bytes: `begin()`, `end()`, `mark()` and
  every other method do nothing, getters return empty values.
- The main entry `@three.ez/stats` is always the real overlay, for apps that keep it in
  production behind a flag. Those can load it on demand:
  `const { Stats } = await import('@three.ez/stats')`.

### Probe (add-on)

*Question: where exactly is this object, and where should it go?*

```ts
import { addProbe } from '@three.ez/stats/probe';

addProbe(stats, { scene, camera, controls });
```

- A `PROBE` plate. While on, a click on the canvas picks the object under the pointer and shows
  a translate gizmo. Rows show its name, X, Y, Z (local position), triangles and distance from
  the camera, live while dragging.
- `C` copies `object.position.set(x, y, z)` to the clipboard. `Escape` deselects.
- `controls` (anything with `enabled`, e.g. OrbitControls) is disabled while dragging.
- It imports `three` and its `TransformControls`, and it changes the scene: that is why it is an
  add-on and not part of the read-only core.

## Planned

### User Timing and long-task attribution

- Opt-in `userTiming: true`: each `mark()` segment is also a `performance.measure`, so segments
  show in the browser's Performance panel.
- On Chromium the long animation frame entries name the script that blocked: the `long-tasks` tip
  would name it.

### Report comparison

- `compareReports(before, after)`: per-metric change with a verdict (better, worse, same within
  noise). UI: the REC tooltip shows the change against the previous report.

### Snapshot diff

- `stats.snapshot()` keeps the scene survey and memory counters; a later one shows what grew:
  geometries, textures, materials, by name where they have one.

### Shader compile attribution

- WebGL: name the material whose program was created on a compile tick, and count variants per
  material.

### Asset loading timeline

- Sizes and durations of loaded assets (Resource Timing, `LoadingManager`), time to first frame.

### Long-session drift

- A tip when the frame time rises steadily over minutes at the same load (thermal throttling on
  phones).

### Input latency

- Time from a pointer or key event to the end of the frame that handled it, as a row and a tip.

### Lazy loader

- `lazyStats(renderer, options, enabled)`: a stub that loads the overlay in its own chunk only
  when enabled, and replays the calls made in the meantime.

### Debug views (add-on)

- Overdraw heat map, wireframe, mip level by colour, texel density, UV checker. They override
  materials, so they are an add-on with a clear on / off and a restore.

### LOD mode (add-on)

- The LOD example as a supported add-on: objects per level, switches per second, share near a
  threshold, triangles saved, with its checks.

## Out of scope

- Per-object inspection trees and material editors (the three.js devtools extension).
- GPU command capture (Spector.js, WebGPU Inspector).
- Immersive XR: the DOM overlay is not visible there; it would need an in-scene panel.
