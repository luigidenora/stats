/**
 * `@three.ez/stats/agent`: the overlay as tools for AI agents.
 *
 * An agent improving a scene needs numbers and advice, not pixels. `agentTools()` returns three
 * tools (a snapshot, a recorded run, a mode switch) as plain objects with a JSON schema, ready
 * for any tool-calling bridge. `registerAgentTools()` also offers them to in-browser agents
 * through WebMCP (`navigator.modelContext`) where the browser has it.
 *
 * WebMCP is an early proposal and its API may change: registration is best effort and never
 * throws. Without it, an agent driving the page can still call
 * `globalThis.__THREE_EZ_STATS__[0].snapshot()`.
 */

import type { StatsReport } from './recorder.js';
import type { StatsSnapshot } from './snapshot.js';
import type { Stats } from './stats.js';

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema of the input object. */
  inputSchema: { type: 'object'; properties: Record<string, object>; required?: string[] };
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

const MAX_SECONDS = 60;

/** Records for `seconds` (1 to 60) and resolves with the report, or null when no frame ran. */
export async function recordFor(stats: Stats, seconds: number): Promise<StatsReport | null> {
  const duration = Math.min(MAX_SECONDS, Math.max(1, Number.isFinite(seconds) ? seconds : 5));
  stats.startRecording();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, duration * 1000);
  });
  return stats.stopRecording();
}

/** The overlay's tools: what they do, what they take, and how to run them. */
export function agentTools(stats: Stats): AgentTool[] {
  return [
    {
      name: 'three_stats_snapshot',
      description: 'Current performance of the three.js scene as JSON: frame rate, CPU and GPU ms per frame, frame pacing (P95, dropped refreshes), '
        + 'draw calls, triangles, memory counters, the scene survey (lights, shadows, textures, instancing candidates) and `findings`: what is wrong '
        + 'right now, each with its numbers and one practical fix. Call it first, fix the top finding, then call it again.',
      inputSchema: { type: 'object', properties: {} },
      run: async (): Promise<StatsSnapshot> => Promise.resolve(stats.snapshot())
    },
    {
      name: 'three_stats_record',
      description: 'Records the running scene for a number of seconds and returns a report: average frame rate, 1% low frame rate, frame time '
        + 'percentiles, dropped refreshes, CPU and GPU time, draw call and triangle maxima, memory at start and end. Use it before and after a '
        + 'change to measure the difference; compare the 1% low and P95, not only the average.',
      inputSchema: { type: 'object', properties: { seconds: { type: 'number', minimum: 1, maximum: MAX_SECONDS, description: 'How long to record. Default 5.' } } },
      run: async (input): Promise<StatsReport | null> => recordFor(stats, typeof input['seconds'] === 'number' ? input['seconds'] : 5)
    },
    {
      name: 'three_stats_set_mode',
      description: 'Switches what the overlay shows on screen: "simple", "performance", "mesh", "memory", "image", "info" or "off". '
        + 'Returns the mode in use. It does not change what is measured.',
      inputSchema: { type: 'object', properties: { mode: { type: 'string', description: 'The mode id.' } }, required: ['mode'] },
      run: async (input): Promise<{ mode: string }> => {
        if (typeof input['mode'] === 'string') stats.mode = input['mode'];
        return Promise.resolve({ mode: stats.mode });
      }
    }
  ];
}

interface ModelContext {
  registerTool?: (tool: { name: string; description: string; inputSchema: object; execute: (input: Record<string, unknown>) => Promise<unknown> }) => unknown;
  unregisterTool?: (name: string) => unknown;
}

/**
 * Offers the tools to in-browser agents through WebMCP, where available. Returns a function that
 * removes them, and whether anything was registered.
 */
export function registerAgentTools(stats: Stats): { registered: boolean; unregister: () => void } {
  const context = (globalThis.navigator as (Navigator & { modelContext?: ModelContext }) | undefined)?.modelContext;
  const tools = agentTools(stats);
  const names: string[] = [];
  if (context?.registerTool !== undefined) {
    for (let i = 0, l = tools.length; i < l; i++) {
      const tool = tools[i];
      try {
        context.registerTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: async (input) => {
            // An agent may call a tool without arguments, whatever the type says.
            const given: unknown = input;
            const args = typeof given === 'object' && given !== null ? given as Record<string, unknown> : {};
            return { content: [{ type: 'text', text: JSON.stringify(await tool.run(args)) }] };
          }
        });
        names.push(tool.name);
      } catch {
        // A tool of this name exists already, or the proposal changed shape: the global hook still works.
      }
    }
  }

  return {
    registered: names.length > 0,
    unregister: () => {
      for (let i = 0, l = names.length; i < l; i++) {
        try {
          context?.unregisterTool?.(names[i]);
        } catch {
          // Already gone.
        }
      }

      names.length = 0;
    }
  };
}
