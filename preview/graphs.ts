import { Samples, TimeGraph, type GraphColors } from '../src/graphs.js';
import { injectStyles } from '../src/styles.js';

injectStyles(document);
const budget = 1000 / 60;
const colors: GraphColors = { ink: '#f4f4f1', clip: '#ff2a1f', alert: '#f2cc1d', series: { cpu: '#4f7dff', gpu: '#2ee84a' } };
const normal = (m: number, s: number) => m + s * Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());

interface Scenario { name: string; frame: (t: number) => number; cpu: () => number; gpu: () => number }

const scenarios: Scenario[] = [
  { name: 'Smooth 60 fps, light load', frame: () => normal(16.7, 0.25), cpu: () => Math.abs(normal(1.2, 0.3)), gpu: () => Math.abs(normal(3.5, 0.6)) },
  { name: 'Occasional stutter (GC, shader compile)', frame: (t) => (t % 70 === 0 ? 48 : t % 23 === 0 ? 24 : normal(16.7, 0.4)), cpu: () => Math.abs(normal(5, 1.5)), gpu: () => Math.abs(normal(6, 1)) },
  { name: 'GPU-bound: GPU time near the budget', frame: () => Math.max(16.7, normal(19, 2)), cpu: () => Math.abs(normal(3, 0.6)), gpu: () => Math.abs(normal(15.5, 2)) }
];

const rows = document.getElementById('rows')!;
const graphs: { s: Scenario; frame: Samples; cpu: Samples; gpu: Samples; views: TimeGraph[] }[] = [];

for (const s of scenarios) {
  const row = document.createElement('div');
  row.className = 'row';
  const frame = new Samples(), cpu = new Samples(), gpu = new Samples();
  const views: TimeGraph[] = [];
  for (const bg of ['dark', 'bright']) {
    const scene = document.createElement('div');
    scene.className = `scene ${bg}`;
    scene.innerHTML = `<div class="name">${s.name}</div>`;
    const band = document.createElement('div');
    band.className = 'tez-stats';
    band.style.flexDirection = 'row';
    band.style.gap = '22px';
    const f = new TimeGraph(budget, [{ samples: frame }], { width: 240, height: 32, vertical: false, autoScale: false, label: 'frame' });
    const c = new TimeGraph(budget, [{ samples: cpu, color: 'cpu' }], { width: 160, height: 32, vertical: false, autoScale: true, scaleWith: [gpu], label: 'cpu' });
    const t = new TimeGraph(budget, [{ samples: gpu, color: 'gpu' }], { width: 160, height: 32, vertical: false, autoScale: true, scaleWith: [cpu], label: 'gpu' });
    band.append(c.element, f.element, t.element);
    scene.append(band);
    row.append(scene);
    views.push(c, f, t);
  }

  rows.append(row);
  graphs.push({ s, frame, cpu, gpu, views });
}

let tick = 0;
function loop() {
  tick++;
  for (const g of graphs) {
    g.frame.push(g.s.frame(tick));
    g.cpu.push(g.s.cpu());
    g.gpu.push(g.s.gpu());
    for (const v of g.views) v.draw(colors);
  }

  requestAnimationFrame(loop);
}

loop();
