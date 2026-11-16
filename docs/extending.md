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
stats.extendMode('graph', {
  graphs: [{ id: 'cpu.update', label: ['MS', 'UPD'], scale: 'budget', unit: 'ms', sample: 'frame', read: () => updateMs }]
});
```

## Shader compiles and events

A tick above the frame graph marks a frame that created a new shader program, a common cause of a single spike. It reads
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

With `binned: true`, `read` returns counts per bin instead of raw values: `examples/image.ts`
bins the rendered image itself and passes its R, G, B counts. Values outside `domain` land in the
edge bins, which turn yellow. Return a reused typed
array from `read` (it runs 4×/s). With a distribution bar in the same mode, its first three levels
take the channel colours.

## Built-in modes

The built-in modes build on each other; custom modes keep the Performance readouts and add their
own content, packed in one column top-left under the readouts.

| Mode | Shows |
|---|---|
| Simple | frame rate, CPU and GPU time |
| Performance | Simple plus the JS heap and the counters (and the objects counter with a `scene`) |
| Graph | Performance plus frame, CPU, GPU time graphs (compact, three in a row, on phones) |
| Off | only the mode plate |

`extendMode('graph', …)` adds to the graphs (at most four per mode, built-in ones included);
`extendMode('performance', …)` adds to Performance only.

## Add a toggle (next to the mode plate)

```ts
stats.addControl({ id: 'lod.color', label: 'COLOR', description: 'Colour objects by LOD level', onChange: (on) => field.setColored(on) });
```

Inside `defineMode` / `extendMode`, put it in `controls: [...]`: it then shows only in that mode.
The plate turns yellow while on. `label` is 1–5 characters. When the plate row has no room (a
phone), toggles move into the mode menu as checkable rows, with their `description` as the name.

## Add a counter with your own glyph

```ts
const LOD_GLYPH = { category: 'frame', base: [{ d: 'M1 11a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0Z' }] };
stats.addMetric({ id: 'lod.full', label: 'LOD objects at full detail', glyph: LOD_GLYPH, read: () => fullDetailCount });
```

Glyphs are SVG paths on a 16×16 grid, filled in white (`stroke: 1.2` for lines). `'frame'` draws a
free silhouette with a dark contour, `'memory'` puts it on a plate. Two-direction graphs use
`readBelow` (drawn below a middle zero line).

## Events

```ts
spawnWave();
stats.event(); // a flag above the frame graph: what was the app doing when a frame hitched?
```

## Controls from code, and helpers in the scene

- `stats.setControl(id, active)` sets a toggle plate as a click would; `stats.removeControl(id)`
  removes it.
- An object with `userData.statsIgnore = true` is left out of the scene survey, with its
  children. Flag gizmos and helpers your plugin adds to the scene.

## Plugins in production

Type a plugin against `@three.ez/stats/dev` when it should vanish with the overlay: in a
production build every call (`defineMode`, `addMetric`, `addControl`…) lands on a no-op. Keep heavy
plugin code behind a dynamic `import()` so it is not bundled either.

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
