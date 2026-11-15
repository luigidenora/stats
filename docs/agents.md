# For agents

`@three.ez/stats` is built to be read by AI agents as well as by people. An agent asked to "make
this scene faster" needs three things a screenshot cannot give: the numbers, a verdict on them,
and a way to check that a change helped. The overlay gives all three as plain JSON.

## The snapshot

```ts
const snapshot = stats.snapshot();
```

| Field | Meaning |
| --- | --- |
| `frame` | Averages of the last refresh: `fps`, `cpu` and `gpu` in ms per frame, `heap` in MB |
| `pacing` | Last 240 frames, in ms: `p95`, `worst`, `dropped` refreshes, `jitter` (standard deviation) |
| `counters` | `calls`, `triangles`, `points`, `lines` of the last frame; `geometries`, `textures`, `programs` alive |
| `budget`, `budgets`, `profile` | The frame budget in ms and the limits the checks compare against |
| `findings` | What is wrong now: `id`, `title`, `message` (with the numbers), `advice` (one practical fix) |
| `checks` | Every check with its `status`: `ok`, `warn` or `unchecked` |
| `scene` | The scene survey (needs the `scene` option): meshes, instances, lights, shadows, materials, textures, estimated bytes, instancing candidates, the heaviest geometries and textures |
| `camera` | Type, field of view, near, far, position (needs the `camera` option) |
| `canvas` | Drawing buffer size, CSS size and pixel ratio |
| `pressure` | `high`, `low` or `ok`: whether the frame has room |
| `report` | The last finished recording |

Values a backend or browser cannot measure are `null` (GPU time without a timer, heap outside
Chromium). `version` changes when a field is renamed or removed.

## Reaching it

**From a browser automation tool.** Every instance is listed in a global array:

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

1. Call `three_stats_snapshot`. If `findings` is empty and `pacing.dropped` is 0, stop.
2. Take the first finding. Its `advice` names the kind of fix; `scene` and `counters` say where
   (for `instancing`, the groups of meshes that share geometry and material; for `texture-memory`,
   `scene.topTextures`).
3. Make one change.
4. Call `three_stats_record` for 5 to 10 seconds, on the same camera path.
5. Compare with the previous report: `fps.low1` and `frame.p95` first, then `dropped`,
   `calls.max` and `triangles.max`. Keep the change if they improved; otherwise revert.
6. Repeat from 1.

Guidance for the agent:

- Judge by `fps.low1`, `frame.p95` and `dropped`, not by the average frame rate.
- Renderer counters are deterministic and comparable between runs. Timings vary run to run, and
  are not meaningful in a headless browser without a GPU.
- `gpu` is `null` on browsers without a GPU timer. Then `gpu-bound` cannot fire: a low frame rate
  with a low `cpu` suggests the GPU.
- A finding appears after two failing seconds and clears after three passing ones: wait a few
  seconds after a change before reading the snapshot.
- Budgets are rules of thumb for a device class, not targets to hit exactly.

## Events and reports

`stats.event(name)` marks a moment; reports list events with their time, so "the hitch at
`level-load`" is a fact in the data, not a guess. `onReport` receives every finished report.
