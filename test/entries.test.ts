// @vitest-environment happy-dom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentTools, recordFor, registerAgentTools } from '../src/agent.js';
import { Stats as NoopStats } from '../src/noop.js';
import { addProbe, formatCoordinate, positionCode } from '../src/probe.js';
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

function frames(stats: Stats, count: number): void {
  for (let i = 0; i < count; i++) {
    stats.begin();
    stats.end();
  }
}

describe('production no-op', () => {
  it('answers every public member of the real class and touches nothing', () => {
    const renderer = fakeRenderer({ canvas: document.createElement('canvas') });
    const stats = new NoopStats(renderer);
    for (const name of Object.getOwnPropertyNames(Stats.prototype)) {
      const descriptor = must(Object.getOwnPropertyDescriptor(Stats.prototype, name));
      // Private methods compile to plain ones: the public ones are checked by the type in noop.ts.
      if (typeof descriptor.value !== 'function' || name === 'constructor') continue;
      if (['syncRect', 'moved', 'survey', 'diagnose', 'memory', 'guard', 'signalPressure', 'recControl'].includes(name)) continue;
      expect(typeof (stats as unknown as Record<string, unknown>)[name], name).toBe('function');
    }

    stats.begin();
    stats.mark('render').event('x').addMetric({ id: 'a', label: 'A', read: () => 1 }).defineMode({ id: 'm', name: 'M', code: 'M', description: '' });
    stats.end();
    expect(stats.startRecording().stopRecording()).toBeNull();
    expect(stats.findings).toEqual([]);
    expect(stats.snapshot().version).toBe(1);
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

    const snapshot = await tools[0].run({}) as { version: number; findings: unknown[] };
    expect(snapshot.version).toBe(1);
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
      expect((JSON.parse(result.content[0].text) as { version: number }).version).toBe(1);
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

describe('probe', () => {
  function world(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; box: THREE.Mesh } {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld();
    const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    box.name = 'crate';
    scene.add(box);
    scene.updateMatrixWorld();
    return { scene, camera, box };
  }

  function click(canvas: HTMLElement, x: number, y: number): void {
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
  }

  it('formats coordinates for code', () => {
    expect(formatCoordinate(1.50004)).toBe('1.5');
    expect(formatCoordinate(-0.0001)).toBe('0');
    expect(positionCode({ position: { x: 1, y: -2.3456, z: 0.1 } })).toBe('object.position.set(1, -2.346, 0.1);');
  });

  it('picks the object under a click while on, shows its rows, and clears on an empty click', () => {
    const { stats, canvas } = setup();
    const { scene, camera, box } = world();
    const onSelect = vi.fn();
    const probe = addProbe(stats, { scene, camera, renderer: { domElement: canvas }, onSelect });
    click(canvas, 100, 100);
    expect(probe.selected).toBeNull();

    must(Array.from(stats.element.querySelectorAll('button')).find((button) => button.textContent === 'PROBE')).click();
    expect(probe.active).toBe(true);
    click(canvas, 100, 100);
    expect(probe.selected).toBe(box);
    expect(onSelect).toHaveBeenLastCalledWith(box);
    box.position.set(1.5, 2, -3);
    for (let i = 0; i < 3; i++) {
      frames(stats, 1);
      vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 400);
    }

    expect(must(stats.element.querySelector('[data-tip^="Picked object"]')).textContent).toContain('crate');
    expect(must(stats.element.querySelector('[data-tip^="Local X"]')).textContent).toContain('1.50');
    expect(probe.copy()).toBe('object.position.set(1.5, 2, -3);');

    click(canvas, 5, 5);
    expect(probe.selected).toBeNull();
    expect(probe.copy()).toBeNull();
    // A point cloud in front does not steal the click from the mesh behind it.
    const cloud = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 2]), 3)));
    scene.add(cloud);
    box.position.set(0, 0, 0);
    scene.updateMatrixWorld();
    click(canvas, 100, 100);
    expect(probe.selected).toBe(box);
  });

  it('treats a drag as a camera move, selects a whole LOD, and cleans up', () => {
    const { stats, canvas } = setup();
    const { scene, camera, box } = world();
    const lod = new THREE.LOD();
    scene.remove(box);
    lod.addLevel(box, 0);
    scene.add(lod);
    scene.updateMatrixWorld();
    const controls = { enabled: true };
    const probe = addProbe(stats, { scene, camera, renderer: { domElement: canvas }, controls });
    probe.active = true;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 140, clientY: 100, bubbles: true }));
    expect(probe.selected).toBeNull();
    click(canvas, 100, 100);
    expect(probe.selected).toBe(lod);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(probe.selected).toBeNull();

    const children = scene.children.length;
    probe.dispose();
    expect(scene.children.length).toBe(children - 1);
    expect(stats.element.textContent).not.toContain('PROBE');
    expect(stats.element.querySelector('[data-tip^="Local X"]')).toBeNull();
    click(canvas, 100, 100);
    expect(probe.selected).toBeNull();
  });
});

describe('production no-op budgets', () => {
  it('match the desktop profile of the real overlay', async () => {
    const { PROFILE_BUDGETS } = await import('../src/budgets.js');
    expect(new NoopStats(fakeRenderer({ canvas: document.createElement('canvas') })).budgets).toEqual(PROFILE_BUDGETS.desktop);
  });
});
