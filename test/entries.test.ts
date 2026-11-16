// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentTools, recordFor, registerAgentTools } from '../src/agent.js';
import { Stats as NoopStats } from '../src/noop.js';
import { Stats } from '../src/stats.js';
import { fakeRenderer, must, stubCanvas2d } from './helpers.js';

let restoreCanvas: () => void;
const open: Stats[] = [];

beforeEach(() => {
  restoreCanvas = stubCanvas2d();
  localStorage.clear();
});

afterEach(() => {
  while (open.length > 0) must(open.pop()).dispose();
  restoreCanvas();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function setup(): { stats: Stats; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 200, 200);
  document.body.append(canvas);
  const stats = new Stats(fakeRenderer({ canvas }), { profile: 'desktop', remember: false });
  open.push(stats);
  return { stats, canvas };
}

describe('production no-op', () => {
  it('answers every public member of the real class and touches nothing', () => {
    const renderer = fakeRenderer({ canvas: document.createElement('canvas') });
    const stats = new NoopStats(renderer);
    for (const name of Object.getOwnPropertyNames(Stats.prototype)) {
      const descriptor = must(Object.getOwnPropertyDescriptor(Stats.prototype, name));
      // Private methods compile to plain ones: the public ones are checked by the type in noop.ts.
      if (typeof descriptor.value !== 'function' || name === 'constructor') continue;
      if (['syncRect', 'moved', 'survey', 'memory', 'guard', 'signalPressure', 'recControl'].includes(name)) continue;
      expect(typeof (stats as unknown as Record<string, unknown>)[name], name).toBe('function');
    }

    stats.begin();
    stats.mark('render').event('x').addMetric({ id: 'a', label: 'A', read: () => 1 }).defineMode({ id: 'm', name: 'M', code: 'M', description: '' });
    stats.end();
    expect(stats.startRecording().stopRecording()).toBeNull();
    expect(stats.snapshot().counters.calls).toBe(0);
    expect(stats.snapshot().version).toBe(2);
    expect(JSON.parse(JSON.stringify(stats.snapshot()))).toEqual(stats.snapshot());
    expect(stats.element.isConnected).toBe(false);
    expect(document.querySelector('.tez-stats')).toBeNull();
    expect(renderer.info.autoReset).toBe(true);
    stats.dispose();
  });
});

describe('agent tools', () => {
  it('describes three tools with a JSON schema and runs them', async () => {
    const { stats } = setup();
    const tools = agentTools(stats);
    expect(tools.map((tool) => tool.name)).toEqual(['three_stats_snapshot', 'three_stats_record', 'three_stats_set_mode']);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe('object');
    }

    const snapshot = await tools[0].run({}) as { version: number };
    expect(snapshot.version).toBe(2);
    expect(await tools[2].run({ mode: 'performance' })).toEqual({ mode: 'performance' });
    expect(await tools[2].run({ mode: 'nope' })).toEqual({ mode: 'performance' });
  });

  it('records for the asked time, clamped to 1–60 s', async () => {
    vi.useFakeTimers();
    const { stats } = setup();
    const pending = recordFor(stats, 0.01);
    expect(stats.recording).toBe(true);
    await vi.advanceTimersByTimeAsync(900);
    expect(stats.recording).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toBeNull();
    expect(stats.recording).toBe(false);
  });

  it('registers with WebMCP where the browser has it, and is quiet where it does not', async () => {
    const { stats } = setup();
    expect(registerAgentTools(stats).registered).toBe(false);
    const registered = new Map<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }>();
    const modelContext = {
      registerTool: (tool: { name: string; execute: (input: Record<string, unknown>) => Promise<unknown> }) => registered.set(tool.name, tool),
      unregisterTool: (name: string) => registered.delete(name)
    };
    Object.defineProperty(navigator, 'modelContext', { configurable: true, value: modelContext });
    try {
      const handle = registerAgentTools(stats);
      expect(handle.registered).toBe(true);
      expect(registered.size).toBe(3);
      const result = await must(registered.get('three_stats_snapshot')).execute({}) as { content: { type: string; text: string }[] };
      expect((JSON.parse(result.content[0].text) as { version: number }).version).toBe(2);
      handle.unregister();
      expect(registered.size).toBe(0);
      modelContext.registerTool = () => {
        throw new Error('changed');
      };
      expect(registerAgentTools(stats).registered).toBe(false);
    } finally {
      Reflect.deleteProperty(navigator, 'modelContext');
    }
  });
});

describe('production no-op budgets', () => {
  it('match the desktop profile of the real overlay', async () => {
    const { PROFILE_BUDGETS } = await import('../src/budgets.js');
    expect(new NoopStats(fakeRenderer({ canvas: document.createElement('canvas') })).budgets).toEqual(PROFILE_BUDGETS.desktop);
  });
});
