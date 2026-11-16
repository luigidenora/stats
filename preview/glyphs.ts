import { createDial, createGlyph, createPlate, createSteps, GLYPHS, type GlyphName } from '../src/glyphs.js';

const SOURCES: Record<GlyphName, string> = {
  calls: 'info.render.calls',
  triangles: 'info.render.triangles',
  points: 'info.render.points',
  lines: 'info.render.lines',
  geometries: 'info.memory.geometries',
  textures: 'info.memory.textures',
  programs: 'info.programs.length',
  objects: 'scene.traverse()'
};

const BUDGET_MS = 1000 / 60;

const PLATE_TITLES: Record<string, string> = {
  GL2: 'WebGL 2 backend',
  WGPU: 'WebGPU backend',
  MEM: 'Memory used',
  GPU: 'GPU frame time',
  HEAP: 'JS heap',
  AUTO: 'Automatic',
  L: 'Level'
};

function cell(icons: SVGSVGElement[], name: string, source: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cell';
  const big = document.createElement('div');
  big.className = 'big';
  big.append(...icons);
  el.append(big);
  el.insertAdjacentHTML('beforeend', `<div class="name">${name}</div><code>${source}</code>`);
  return el;
}

const byId = (id: string): HTMLElement => document.getElementById(id)!;

for (const name of Object.keys(GLYPHS) as GlyphName[]) {
  byId(`sheet-${GLYPHS[name].category}`).appendChild(cell([createGlyph(name, { size: 64 }), createGlyph(name)], name, SOURCES[name]));
}

for (const level of [0.15, 0.5, 0.85, 1]) {
  const icons = (['geometries', 'textures', 'programs'] as const).map((name) => createGlyph(name, { size: 48, level }));
  const el = cell(icons, `${Math.round(level * 100)}%`, 'level');
  if (level >= 1) el.style.color = 'var(--alert)';
  byId('sheet-level').appendChild(el);
}

for (const ms of [4.1, 9.8, 13.9, 24.3]) {
  const el = cell([createDial(ms / BUDGET_MS, 64), createDial(ms / BUDGET_MS)], `${ms} ms`, `${Math.round((ms / BUDGET_MS) * 100)}% di 16.7 ms`);
  if (ms > BUDGET_MS) el.style.color = 'var(--alert)';
  byId('sheet-time').appendChild(el);
}
byId('sheet-time').appendChild(cell([createDial(null, 64), createDial(null)], 'n/a', 'timer not available'));

for (const label of Object.keys(PLATE_TITLES)) byId('plates').appendChild(createPlate(label, PLATE_TITLES[label]));
const solid = createPlate('GL2', PLATE_TITLES.GL2);
solid.classList.add('solid');
byId('plates').appendChild(solid);

const COUNTERS: [GlyphName, string][] = [
  ['calls', '128'],
  ['triangles', '1.24M'],
  ['points', '0'],
  ['lines', '4.3K'],
  ['geometries', '48'],
  ['textures', '12'],
  ['programs', '9']
];

function hud(alert: boolean, webgpu: boolean): string {
  const cpu = alert ? 24.3 : 9.8;
  const gpu = webgpu ? 4.1 : null;
  const pairs = COUNTERS.map(([name, value]) => {
    const shown = name === 'programs' && webgpu ? '—' : value;
    return `<span class="pair" data-g="${name}"></span><!--${shown}-->`;
  }).join('');
  return `
    <div class="hud">
      <div class="band top">
        <span data-plate="${webgpu ? 'WGPU' : 'GL2'}"></span>
        <div class="rows push">
          <span class="row">212<span class="unit">MB</span><span data-plate="MEM"></span></span>
          <span class="row"><span class="pair" data-dial="${gpu === null ? 'na' : gpu / BUDGET_MS}"></span>${gpu ?? '—'}<span class="unit">MS</span><span data-plate="GPU"></span></span>
        </div>
      </div>
      <div style="display:grid; gap:14px">
        <div class="grid">${pairs}</div>
        <div class="band">
          <span class="value ${alert ? 'alert' : ''}"><span class="stack"><span>FPS</span><span>AVG</span></span>${alert ? '41' : '60'}</span>
          <span class="value ${alert ? 'alert' : ''}"><span class="pair" data-dial="${cpu / BUDGET_MS}"></span><span class="stack"><span>MS</span><span>CPU</span></span>${cpu}</span>
          <span data-steps="${alert ? 4 : 2}"></span>
        </div>
      </div>
    </div>`;
}

const scenes = byId('scenes');
const variants: [string, boolean, boolean][] = [['dark', false, false], ['mid', true, true], ['bright', false, true]];
for (const [bg, alert, webgpu] of variants) {
  const scene = document.createElement('div');
  scene.className = `scene ${bg}`;
  scene.innerHTML = hud(alert, webgpu);
  scene.querySelectorAll<HTMLElement>('.pair[data-g]').forEach((pair) => {
    const value = (pair.nextSibling as Comment).data;
    pair.appendChild(createGlyph(pair.dataset.g as GlyphName));
    pair.append(value);
  });
  scene.querySelectorAll<HTMLElement>('[data-dial]').forEach((el) => el.appendChild(createDial(el.dataset.dial === 'na' ? null : Number(el.dataset.dial), 16, el.closest('.row') ? 'GPU frame time' : 'CPU frame time')));
  scene.querySelectorAll<HTMLElement>('[data-steps]').forEach((el) => el.appendChild(createSteps(Number(el.dataset.steps))));
  scene.querySelectorAll<HTMLElement>('[data-plate]').forEach((el) => el.replaceWith(createPlate(el.dataset.plate!, PLATE_TITLES[el.dataset.plate!])));
  scenes.appendChild(scene);
}
