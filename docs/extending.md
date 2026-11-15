# Extending @three.ez/stats

Project-specific statistics (LOD, physics, streaming, networking…) are measured in your code and
described to the overlay as plain data. The overlay owns layout, formatting, tooltips and failure
handling, so a definition cannot break the UI.

## Add a mode

```ts
stats.defineMode({
  id: 'lod',                 // unique
  name: 'Level of detail',   // mode menu
  code: 'LOD',               // mode plate, ≤ 4 characters
  description: 'Objects per LOD level and switches per second.',
  graphs: [
    { id: 'lod.switches', label: ['LOD', 'SW/S'], scale: 'auto', unit: 'sw/s', read: () => switchesPerSecond }
  ],
  metrics: [
    { id: 'lod.saved', label: 'Triangles saved by LOD', place: 'top', plate: 'SAVE', unit: '%', read: () => savedPercent }
  ],
  distribution: { id: 'lod.levels', label: ['LOD', 'LVL'], read: () => objectsPerLevel } // number[] L0..Ln
});
```

Custom modes join the mode cycle after the built-in ones, before Off. A mode picked with the mode plate is
remembered across page loads, custom ones included (applied as soon as `defineMode` runs).

## Extend an existing mode

```ts
stats.extendMode('performance', {
  graphs: [{ id: 'cpu.update', label: ['MS', 'UPD'], scale: 'budget', unit: 'ms', sample: 'frame', read: () => updateMs }]
});
```

## Split CPU time with marks

```ts
stats.begin();
world.update();            // 'logic': begin() to the first mark
stats.mark('render');      // 'render': this mark to end()
renderer.render(scene, camera);
stats.end();
```

Each segment becomes a row in Performance mode (plate: the first 4 letters, upper case). At most 4
segments; marks outside `begin()` / `end()` are ignored with one warning. The CPU readout stays the
whole `begin()` → `end()` time, and the segments add up to it.

## Built-in pacing and shader events

Performance mode also shows P95 and PEAK (worst) frame time and DROP, the refreshes missed over the last 240
frames (ids `'p95'`, `'worst'`, `'dropped'`; turn them off with `exclude`). A tick above the frame
graph marks a frame that created a new shader program, a common cause of a single spike. It reads
the program count, so it fires on creation; with parallel or async compilation the stall can land
a few frames later.

## Add a large RGB histogram

One per mode, top-left under the readouts. Up to three channels, drawn red, green, blue on one
scale; they add up like light, so white means the channels agree.

```ts
stats.extendMode('lod', {
  histogram: {
    id: 'lod.px', label: ['LOD', 'PX'], unit: 'px', domain: { min: 2, max: 400, log: true },
    channels: [
      { name: 'L0', read: () => sizesAtL0 }, // raw values: the overlay bins them
      { name: 'L1', read: () => sizesAtL1 },
      { name: 'L2', read: () => sizesAtL2 }
    ]
  }
});
```

`histogram: 'image'` uses the built-in histogram of the rendered image (the Image and Info modes
show it). Values outside `domain` land in the edge bins, which turn yellow. Return a reused typed
array from `read` (it runs 4×/s). With a distribution bar in the same mode, its first three levels
take the channel colours.

## Built-in modes

| Mode | Shows |
|---|---|
| Simple | readouts only |
| Performance | frame, CPU, GPU time graphs (merged into one RGB graph when space runs out); P95, PEAK and DROP rows; `stats.mark()` segments |
| Mesh & instances | draw calls, triangles over time |
| Memory | heap, geometries, textures over time |
| Image | R, G, B histogram of the rendered image, clipping in yellow |
| Info | canvas shrunk to a thumbnail (CSS transform, buffer untouched); pages: renderer, limits, programs, scene (`new Stats(renderer, { scene })`), diagnostics |
| Off | only the mode plate |

## Add a toggle (next to the mode plate)

```ts
stats.addControl({ id: 'lod.color', label: 'COLOR', description: 'Colour objects by LOD level', onChange: (on) => field.setColored(on) });
```

Inside `defineMode` / `extendMode`, put it in `controls: [...]`: it then shows only in that mode.
The plate turns yellow while on. `label` is 1–5 characters.

## Add a counter with your own glyph

```ts
const LOD_GLYPH = { category: 'frame', base: [{ d: 'M1 11a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0Z' }] };
stats.addMetric({ id: 'lod.full', label: 'LOD objects at full detail', glyph: LOD_GLYPH, read: () => fullDetailCount });
```

Glyphs are SVG paths on a 16×16 grid, filled in white (`stroke: 1.2` for lines). `'frame'` draws a
free silhouette with a dark contour, `'memory'` puts it on a plate. Two-direction graphs use
`readBelow` (drawn below a middle zero line).

## Add a diagnostic rule

A rule returns a finding (`{ message, advice }`) when something is wrong and `null` when it is
fine. Frame rules run once a second; rules with `scope: 'scene'` run on the scene survey every
5 s, only with a `scene`. A finding shows on the TIP plate after two failing checks and goes after
three passing ones (scene findings switch at once). A rule with an existing id replaces it; a
rule that throws five times is switched off with one warning.

```ts
stats.addRule({
  id: 'bodies', title: 'Too many bodies',
  check: ({ profile }) => (world.bodies.length > (profile === 'mobile' ? 200 : 800)
    ? { message: `${world.bodies.length} bodies.`, advice: 'Let bodies at rest sleep.' }
    : null)
});
```

The context passed to `check` holds the frame values (`fps`, `cpu`, `gpu`, `p95`, `jitter`,
`calls`, `triangles`…), the device `profile` and its `budgets`, and the scene survey for scene
rules. Values a backend cannot measure are `null`. Turn built-in rules off with
`new Stats(renderer, { rules: ['small-draws'] })`, or all of them with `rules: false`.

## Rules the overlay enforces

| Rule | What happens otherwise |
|---|---|
| Unique, non-empty `id` | Skipped, one console warning |
| `read` is a function returning a finite number (or `null`) | Non-finite values show "—" |
| `read` must not throw | Shows "—"; switched off after 5 throws, one warning |
| `label` is two short strings, `plate` and `code` ≤ 4 characters | Skipped, one warning |
| At most 4 graphs per mode (built-in ones count) | Extra graphs skipped, one warning |
| One distribution per mode | The last one wins |

## Choosing a scale

| `scale` | For | Axis |
|---|---|---|
| `'budget'` | milliseconds | follows the data up to 2× the frame budget, budget ticks |
| `'auto'` | counts, rates | follows the largest recent value |
| `'bytes'` | memory sizes | like `'auto'`, formatted B / KB / MB / GB |
| `'percent'` | ratios | fixed 0–100 |

`sample: 'frame'` reads with every graph column (a few times per frame group): keep those reads
cheap. The default, `'refresh'`, reads 4 times per second: use it for anything that traverses the
scene or allocates.

Colours: graphs default to ink; `'cpu'`, `'gpu'` and `'frame'` reuse the series colours and should
only be used for values of that kind.

See `examples/lod.ts` for a complete, working LOD mode built on `THREE.LOD`.
