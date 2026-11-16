# For agents

`@three.ez/stats` is built to be read by AI agents as well as by people. An agent asked to "make
this scene faster" needs what a screenshot cannot give: the numbers, where the cost sits, and a
way to check that a change helped. The overlay gives them as plain JSON. It does not judge them:
the agent does, from the budgets and the counters.

## The snapshot

```ts
const snapshot = stats.snapshot();
```

| Field | Meaning |
| --- | --- |
| `frame` | Averages of the last refresh: `fps`, `cpu` and `gpu` in ms per frame, `heap` in MB |
| `pacing` | Last 240 frames, in ms: `p95`, `worst`, `dropped` refreshes, `jitter` (standard deviation) |
| `counters` | `calls`, `triangles`, `points`, `lines` of the last frame; `geometries`, `textures`, `programs` alive |
| `budget`, `budgets`, `profile` | The frame budget in ms, and the draw call and triangle budgets of the device profile |
| `scene` | The scene survey (needs the `scene` option): meshes, instances, lights, shadows, materials, textures, estimated bytes, instancing candidates, the heaviest geometries and textures |
| `canvas` | Drawing buffer size, CSS size and pixel ratio |
| `pressure` | `high`, `low` or `ok`: whether the frame has room |
| `report` | The last finished recording |

Values a backend or browser cannot measure are `null` (GPU time without a timer, heap outside
Chromium). `version` changes when a field is renamed or removed.

## Reaching it

**From a browser automation tool.** With `expose: true`, every instance is listed in a global
array (the overlay adds no global otherwise):

```js
// Playwright: await page.evaluate(() => globalThis.__THREE_EZ_STATS__[0].snapshot())
// Chrome DevTools MCP: evaluate_script with the same expression
globalThis.__THREE_EZ_STATS__[0].snapshot();
```

**As tools, for any tool-calling bridge.**

```ts
import { agentTools } from '@three.ez/stats/agent';

for (const tool of agentTools(stats)) {
  // tool.name, tool.description, tool.inputSchema (JSON Schema), await tool.run(input)
}
```

| Tool | Input | Returns |
| --- | --- | --- |
| `three_stats_snapshot` | — | The snapshot |
| `three_stats_record` | `{ seconds?: 1–60 }` | A report of that many seconds |
| `three_stats_set_mode` | `{ mode }` | The mode now on screen |

**WebMCP.** `registerAgentTools(stats)` offers the same tools through `navigator.modelContext`
where the browser has it, and returns `{ registered, unregister }`. WebMCP is an early proposal:
registration is best effort, guarded, and has not been tested against a shipping implementation.

## A loop that works

1. Call `three_stats_snapshot`. If `pacing.dropped` is 0 and `pacing.p95` is within the budget, stop.
2. Find where the cost sits:
   - `frame.gpu` near or over `budget`: the GPU is the limit (pixels, shading, shadows, overdraw);
   - `frame.cpu` near or over `budget`: the CPU is (draw calls, objects, scripts; `mark()` segments
     in a report say which part);
   - `counters.calls` or `counters.triangles` over `budgets`: the scene is heavy to submit;
     `scene.instancingGroups` and `scene.largestInstancingGroup` point at copies to instance,
     `scene.topTextures` and `scene.topGeometries` at the heaviest resources.
3. Make one change.
4. Call `three_stats_record` for 5 to 10 seconds, on the same camera path.
5. Compare with the previous report: `fps.low1` and `frame.p95` first, then `dropped`,
   `calls.max` and `triangles.max`. Keep the change if they improved; otherwise revert.
6. Repeat from 1.

Guidance for the agent:

- Judge by `fps.low1`, `frame.p95` and `dropped`, not by the average frame rate.
- Renderer counters are deterministic and comparable between runs. Timings vary run to run, and
  are not meaningful in a headless browser without a GPU.
- `gpu` is `null` on browsers without a GPU timer: then a low frame rate with a low `cpu`
  suggests the GPU.
- The frame values average the last refresh and pacing covers the last 240 frames: wait a few
  seconds after a change before reading the snapshot, or record.
- Budgets are rules of thumb for a device class, not targets to hit exactly.

## Events and reports

`stats.event(name)` marks a moment; reports list events with their time, so "the hitch at
`level-load`" is a fact in the data, not a guess. `onReport` receives every finished report.
