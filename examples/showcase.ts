import type { StatsMode } from '../src/modes.js';
import { Overlay, type FrameThresholds } from '../src/overlay.js';

const gauss = (mean: number, sd: number) => mean + sd * Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
const pos = (v: number) => Math.max(0.05, v);

interface Frame { interval: number; cpu: number; gpu: number | null; compiled?: boolean }

interface Scenario {
  title: string;
  tag?: string;
  note: string;
  hz?: number;
  bright?: boolean;
  /** Restart the simulation every `restart` frames (to show the warm-up). */
  restart?: number;
  frame: (t: number, budget: number) => Frame;
  /** Display mode of the card. Default 'performance'. */
  mode?: StatsMode;
  /** JS heap in MB at frame `t`. Default: a normal garbage-collected sawtooth around 40 MB. */
  heap?: (t: number) => number;
}

const sawtooth = (t: number) => 38 + ((t % 600) / 600) * 14;

const scenarios: Scenario[] = [
  {
    title: 'Smooth 60 fps, light load',
    note: 'A flat white band at budget height: every frame arrives on time. CPU and GPU sit low, well under the budget.',
    frame: (_, b) => ({ interval: gauss(b, 0.25), cpu: pos(gauss(1.4, 0.3)), gpu: pos(gauss(3.2, 0.5)) })
  },
  {
    title: 'Normal vsync jitter',
    note: 'Frames wobble by a few tenths around 16.7 ms. Everything stays white: under 1.25× the budget is not late.',
    frame: (_, b) => ({ interval: gauss(b, 0.9), cpu: pos(gauss(2, 0.5)), gpu: pos(gauss(4, 0.8)) })
  },
  {
    title: 'Occasional hitches',
    note: 'Now and then a yellow column: one late frame (garbage collection, a texture upload). Overall smoothness holds.',
    frame: (t, b) => ({ interval: t % 37 === 0 ? b * 1.6 : gauss(b, 0.4), cpu: pos(t % 37 === 0 ? 14 : gauss(3, 0.6)), gpu: pos(gauss(5, 0.8)) })
  },
  {
    title: 'Dropped frames',
    note: 'Red columns: the frame missed two or more screen refreshes. This is the stutter users see.',
    frame: (t, b) => ({ interval: t % 29 === 0 ? b * 2.6 : gauss(b, 0.4), cpu: pos(t % 29 === 0 ? 38 : gauss(4, 0.7)), gpu: pos(gauss(6, 1)) })
  },
  {
    title: 'Off-scale spike',
    tag: 'clip',
    note: 'A single 120 ms frame from a shader compile: the column hits the top of the box and turns red, the tick above marks the new program, and the true value stays in the MAX beside it.',
    frame: (t, b) => ({ interval: t % 90 === 45 ? 120 : gauss(b, 0.3), cpu: pos(t % 90 === 45 ? 95 : gauss(2.5, 0.5)), gpu: pos(gauss(4, 0.7)), compiled: t % 90 === 45 })
  },
  {
    title: 'GPU-bound',
    note: 'The green graph (GPU) climbs to the budget tick and past it: frames arrive late (yellow). Cut triangles, shadows or resolution.',
    frame: (_, b) => {
      const gpu = pos(gauss(b * 1.05, 2));
      return { interval: Math.max(b, gpu + gauss(0.8, 0.3)), cpu: pos(gauss(3, 0.6)), gpu };
    }
  },
  {
    title: 'CPU-bound',
    note: 'Now the red graph (CPU) climbs to the budget tick: the JavaScript of each frame (logic, draw calls) is the bottleneck. The GPU waits.',
    frame: (_, b) => {
      const cpu = pos(gauss(b * 1.02, 2.2));
      return { interval: Math.max(b, cpu + gauss(0.5, 0.2)), cpu, gpu: pos(gauss(4, 0.7)) };
    }
  },
  {
    title: 'CPU and GPU both loaded',
    note: 'Red (CPU) and green (GPU) both come close to the budget ticks: little headroom on either side.',
    frame: (_, b) => ({ interval: gauss(b * 1.15, 2.5), cpu: pos(gauss(b * 0.8, 1.5)), gpu: pos(gauss(b * 0.85, 1.5)) })
  },
  {
    title: 'Minimal load',
    tag: 'auto scale',
    note: 'CPU and GPU under a millisecond: the scale tightens to a few ms (see MAX) to show their shape. The budget tick is hidden because it is off scale.',
    frame: (_, b) => ({ interval: gauss(b, 0.2), cpu: pos(gauss(0.35, 0.08)), gpu: pos(gauss(0.6, 0.12)) })
  },
  {
    title: 'GPU not measurable',
    tag: 'n/a',
    note: 'The browser exposes no GPU timer: the value is “—”, the dial is dashed and the GPU graph stays empty. No made-up data.',
    frame: (_, b) => ({ interval: gauss(b, 0.4), cpu: pos(gauss(4, 0.8)), gpu: null })
  },
  {
    title: 'Half rate (30 fps on a 60 Hz screen)',
    note: 'Every frame misses exactly one refresh: a solid yellow band, no red. The classic “runs at 30”, steady but slow.',
    frame: (_, b) => ({ interval: gauss(b * 2, 0.3), cpu: pos(gauss(6, 1)), gpu: pos(gauss(b * 1.7, 1.5)) })
  },
  {
    title: '120 Hz screen',
    tag: 'budget 8.3 ms',
    hz: 120,
    note: 'With budget: 1000 / 120 the budget ticks sit at 8.3 ms and the same loads as before come closer to the limit. The budget is an option, not detected.',
    frame: (t, b) => ({ interval: t % 41 === 0 ? b * 1.7 : gauss(b, 0.15), cpu: pos(gauss(2.5, 0.5)), gpu: pos(gauss(5.5, 0.8)) })
  },
  {
    title: 'Start-up',
    tag: 'warm-up',
    restart: 240,
    note: 'Just created, the overlay has no data yet: the graphs fill from the right and the values start at “—”. This card restarts every 4 seconds.',
    frame: (t, b) => ({ interval: t < 6 ? b * 3 : gauss(b, 0.3), cpu: pos(t < 6 ? 40 : gauss(2, 0.4)), gpu: pos(gauss(4, 0.6)) })
  },
  {
    title: 'Memory leak',
    tag: 'heap',
    mode: 'memory',
    note: 'The heap climbs and the garbage collector never brings it back down: the memory graph keeps rising. A sign of objects kept alive by mistake.',
    frame: (_, b) => ({ interval: gauss(b, 0.3), cpu: pos(gauss(2.5, 0.5)), gpu: pos(gauss(4, 0.7)) }),
    heap: (t) => 40 + t * 0.05 + ((t % 300) / 300) * 4
  },
  {
    title: 'Hitches on a bright scene',
    tag: 'contrast',
    bright: true,
    note: 'The hitches case again on an almost white background: the dark contour keeps columns, colours and numbers readable.',
    frame: (t, b) => ({ interval: t % 23 === 0 ? b * (t % 46 === 0 ? 2.5 : 1.5) : gauss(b, 0.4), cpu: pos(gauss(5, 1)), gpu: pos(gauss(8, 1.2)) })
  }
];

interface Card { scenario: Scenario; budget: number; overlay: Overlay; stage: HTMLElement; t: number; window: Frame[] }

const grid = document.getElementById('grid')!;
const cards: Card[] = [];

function mount(scenario: Scenario, stage: HTMLElement): Overlay {
  const budget = 1000 / (scenario.hz ?? 60);
  const overlay = new Overlay(budget, { mode: scenario.mode ?? 'performance' });
  overlay.setBackend('webgl');
  stage.replaceChildren(overlay.root);
  overlay.layout();
  return overlay;
}

for (const scenario of scenarios) {
  const article = document.createElement('article');
  const tag = scenario.tag === undefined ? '' : `<span class="tag">${scenario.tag}</span>`;
  article.innerHTML = `<h2>${scenario.title}${tag}</h2><p>${scenario.note}</p>`;
  const stage = document.createElement('div');
  stage.className = `stage ${scenario.bright === true ? 'bright' : 'dark'}`;
  article.append(stage);
  grid.append(article);
  const budget = 1000 / (scenario.hz ?? 60);
  cards.push({ scenario, budget, overlay: mount(scenario, stage), stage, t: 0, window: [] });
}

function thresholds(budget: number): FrameThresholds {
  return { fps: { below: (1000 / budget) * 0.9 }, cpu: { above: budget }, gpu: { above: budget } };
}

function refresh(card: Card): void {
  const w = card.window;
  if (w.length === 0) return;
  const avg = (values: number[]) => values.reduce((a, v) => a + v, 0) / values.length;
  const gpu = w.map((f) => f.gpu).filter((v): v is number => v !== null);
  card.overlay.refresh({
    fps: 1000 / avg(w.map((f) => f.interval)),
    cpu: avg(w.map((f) => f.cpu)),
    gpu: gpu.length > 0 ? avg(gpu) : null,
    heap: (card.scenario.heap ?? sawtooth)(card.t)
  }, card.budget, thresholds(card.budget));
  card.window = [];
  // Values change the band widths only, but the first refresh fills the bottom band: lay out again once.
  if (card.t === 15) card.overlay.layout();
}

function step(card: Card): void {
  if (card.scenario.restart !== undefined && card.t >= card.scenario.restart) {
    card.overlay.dispose();
    card.overlay = mount(card.scenario, card.stage);
    card.t = 0;
    card.window = [];
  }

  const frame = card.scenario.frame(card.t, card.budget);
  card.overlay.pushFrame(Math.max(0.1, frame.interval), frame.cpu, frame.compiled === true);
  if (frame.gpu !== null) card.overlay.pushGpu(frame.gpu);
  card.window.push(frame);
  card.t++;
  if (card.t % 15 === 0) refresh(card);
}

function loop(): void {
  for (const card of cards) step(card);
  requestAnimationFrame(loop);
}

loop();
