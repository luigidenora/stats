# @three.ez/stats

A statistics overlay for three.js, for `WebGLRenderer` and `WebGPURenderer`. It reads like a
camera's shooting display: minimal technical readouts on the edges of the canvas, so attention
stays on the scene.

- Frame rate, CPU and GPU time per frame (GPU where the browser exposes a timer), JS heap.
- Draw calls, triangles, points, lines, geometries, textures and shader programs.
- Display modes picked with the mode plate: time graphs, frame pacing, mesh counters, memory, an
  RGB histogram of the rendered image and technical info pages.
- A declarative API for your own modes, metrics, graphs, histograms and toggles.

## Install

```sh
npm install @three.ez/stats
```

`three` is a peer dependency. Developed and tested against r186.

## Use

```ts
import { Stats } from '@three.ez/stats';

const stats = new Stats(renderer, { scene });

renderer.setAnimationLoop(() => {
  stats.begin();
  update();
  stats.mark('render');       // optional: splits CPU time into 'logic' and 'render'
  renderer.render(scene, camera);
  stats.end();
});
```

For GPU time on WebGPU, create the renderer with `trackTimestamp: true`.

## Modes

Click the mode plate (bottom-right: a screen icon and the mode code) for the next mode; click its arrow, or right click, to choose one from the list. The choice is remembered
across page loads.

| Mode | Shows |
|---|---|
| Simple | readouts and counters |
| Performance | frame, CPU and GPU time graphs; P95, worst frame and missed refreshes; `mark()` segments |
| Mesh & instances | draw calls and triangles over time |
| Memory | heap, geometries and textures over time |
| Image | R, G, B histogram of the rendered image, with clipping |
| Info | the canvas as a thumbnail beside renderer, limits, programs, scene and diagnostics pages |
| Off | only the mode plate |

## Options

| Option | Default | |
|---|---|---|
| `mode` | `'simple'` | Initial mode (a remembered choice wins unless `remember: false`) |
| `remember` | `true` | Store the mode picked with the mode plate in localStorage |
| `budget` | `1000 / 60` | Frame budget in ms: dials, graph scales, default thresholds |
| `interval` | `250` | Text refresh period in ms |
| `graphStep` | `3` | Frames per graph column; each column keeps its slowest frame |
| `interactive` | `true` | Tooltips and a clickable mode plate; `false` makes the overlay passive |
| `thresholds` | budget based | Alert bounds for `fps`, `cpu`, `gpu` |
| `exclude` | `[]` | Built-in metric ids to hide, e.g. `['points', 'lines']` |
| `metrics` | `[]` | Extra metrics |
| `scene` | — | Scene for the Info mode's scene summary and the scene checks |
| `profile` | `'auto'` | Device profile for the budgets: `'mobile'`, `'desktop'` or `'auto'` |
| `budgets` | profile | Override single budgets, e.g. `{ calls: 500, shadowLights: 0 }` |
| `rules` | all on | `false` turns the checks off; a list turns off those rule ids |

## Tips when something is wrong

Once a second the overlay checks what it measures against the device profile: GPU- or CPU-bound
frames, stutter, shaders compiled while running, allocations every frame, geometries or textures
that keep growing, draw calls and triangles over budget, a pixel ratio too high. With a `scene`,
every few seconds it also looks for heavy or unmipped textures, too many lights or shadows,
instancing candidates and more. Problems show as a yellow `TIP n` plate; its tooltip says what is
wrong, with the numbers, and what to do. The Info mode lists every check.

| Profile | Draw calls | Triangles | Pixel ratio | Textures (est.) | Lights | Shadow lights | Shadow map |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mobile | 250 | 750K | 2 | 256 MB | 4 | 1 | 2048 |
| desktop | 1000 | 3M | 2 | 512 MB | 8 | 3 | 4096 |

These are rules of thumb, not specifications. Add your own checks:

```ts
stats.addRule({
  id: 'bodies', title: 'Too many bodies',
  check: () => (world.bodies.length > 500 ? { message: `${world.bodies.length} bodies.`, advice: 'Let bodies at rest sleep.' } : null)
});
```

## Extend

```ts
stats.defineMode({
  id: 'physics', name: 'Physics', code: 'PHYS', description: 'Bodies and solver time.',
  graphs: [{ id: 'physics.ms', label: ['MS', 'PHYS'], scale: 'budget', unit: 'ms', read: () => solverMs }],
  metrics: [{ id: 'physics.bodies', label: 'Active bodies', place: 'top', plate: 'BODY', read: () => world.bodies.length }]
});
```

Definitions are plain data and validated: an invalid one is skipped with one console warning, and a
`read` that throws is switched off. See [docs/extending.md](docs/extending.md) for modes, graphs,
histograms, toggles, glyphs and the rules the overlay enforces.

## Develop

```sh
npm start            # demo at /examples/index.html, showcase at /examples/showcase.html
npm run check        # build, lint, type-check, unit tests, package check
npm run test:coverage # unit tests with coverage floors
```

## License

MIT
