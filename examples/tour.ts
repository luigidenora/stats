/**
 * A guided tour of the overlay, for the demo (`?tour`, or `?tour=manual` to step by hand).
 *
 * A focus frame, four yellow corners like a camera's autofocus box, moves onto each part of the
 * overlay while a caption in plate style says what it is. The events it shows are real: a
 * deliberate hitch, a shader compile, a recording. Not part of the package.
 *
 * Keys: → or Space next, ← back, Esc leaves the tour.
 */

import type { Stats } from '../src/index.js';

export interface TourContext {
  stats: Stats;
  /** Makes the scene compile a new shader program (e.g. a material variant). */
  compileShader: () => void;
}

interface Step {
  mode?: string;
  /** The box to frame, or null for a caption alone. Read every frame: layouts move. */
  target?: () => DOMRect | null;
  title: string;
  text: string;
  /** A live line in the code face, refreshed four times a second. */
  code?: () => string;
  enter?: () => void;
  leave?: () => void;
  /** Seconds on screen with autoplay. Default 4.2. */
  seconds?: number;
}

const FLIP_MS = 300;
const PAD = 6;

/** The union of the visible boxes of everything matching the selectors, inside the overlay. */
function boxOf(root: HTMLElement, ...selectors: string[]): () => DOMRect | null {
  return () => {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const selector of selectors) {
      for (const element of root.querySelectorAll<HTMLElement>(selector)) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        left = Math.min(left, box.left);
        top = Math.min(top, box.top);
        right = Math.max(right, box.right);
        bottom = Math.max(bottom, box.bottom);
      }
    }

    return left === Infinity ? null : new DOMRect(left, top, right - left, bottom - top);
  };
}

/** A button of the overlay by its plate text. */
function plate(root: HTMLElement, label: string): () => DOMRect | null {
  return () => {
    const button = Array.from(root.querySelectorAll('button')).find((entry) => entry.textContent === label && entry.offsetParent !== null);
    return button === undefined ? null : button.getBoundingClientRect();
  };
}

/** Blocks the main thread for `ms` inside the next animation frame: one late frame, on purpose. */
function hitch(ms: number): void {
  requestAnimationFrame(() => {
    const until = performance.now() + ms;
    while (performance.now() < until) {
      // Busy on purpose.
    }
  });
}

const STYLE = `
.tour { position: fixed; inset: 0; z-index: 10001; pointer-events: none; font-family: 'Barlow Condensed', 'Roboto Condensed', 'Arial Narrow', sans-serif; color: var(--tez-ink); }
.tour-frame { position: fixed; transition: left 280ms cubic-bezier(0.22, 1, 0.36, 1), top 280ms cubic-bezier(0.22, 1, 0.36, 1), width 280ms cubic-bezier(0.22, 1, 0.36, 1), height 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms; }
.tour-corner { position: absolute; width: 12px; height: 12px; }
.tour-corner::before, .tour-corner::after { content: ''; position: absolute; background: var(--tez-alert); box-shadow: 0 0 0 1px var(--tez-outline); }
.tour-corner::before { width: 12px; height: 2px; }
.tour-corner::after { width: 2px; height: 12px; }
.tour-corner[data-c='tl'] { left: 0; top: 0; }
.tour-corner[data-c='tr'] { right: 0; top: 0; transform: scaleX(-1); }
.tour-corner[data-c='bl'] { left: 0; bottom: 0; transform: scaleY(-1); }
.tour-corner[data-c='br'] { right: 0; bottom: 0; transform: scale(-1); }
.tour-caption {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(360px, calc(100vw - 32px)); box-sizing: border-box;
  display: grid; gap: 8px; padding: 12px 16px 0;
  border: 1px solid var(--tez-ink); background: var(--tez-ground);
  pointer-events: auto; cursor: pointer; user-select: none;
  transition: opacity 200ms;
}
.tour-head { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.tour-count { color: var(--tez-alert); font-variant-numeric: tabular-nums; }
.tour-keys { opacity: 0.6; }
.tour-title { font-size: 22px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; line-height: 1; }
.tour-text { font-size: 15px; font-weight: 500; line-height: 1.3; }
.tour-code { font-size: 15px; font-weight: 600; letter-spacing: 0.02em; color: var(--tez-alert); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.tour-code:empty { display: none; }
.tour-timer { height: 1px; margin: 4px -16px 0; background: var(--tez-rule); }
.tour-timer > span { display: block; height: 1px; width: 0; background: var(--tez-ink); }
@media (prefers-reduced-motion: reduce) { .tour-frame, .tour-caption { transition: none; } }
`;

/** Starts the tour; returns a function that ends it. */
export function startTour(context: TourContext, options: { autoplay: boolean }): () => void {
  const { stats } = context;
  const root = stats.element;
  const startMode = stats.mode;
  let timer = 0;
  let codeTimer = 0;
  let frame = 0;
  let index = -1;
  let since = 0;

  const report = (): string => {
    const r = stats.report;
    if (r === null) return '';
    return `FPS ${Math.round(r.fps.average)} · 1% low ${Math.round(r.fps.low1)} · P99 ${r.frame.p99.toFixed(1)} ms · dropped ${r.dropped}`;
  };

  const snapshot = (): string => {
    const s = stats.snapshot();
    const fps = s.frame.fps === null ? '—' : s.frame.fps.toFixed(1);
    const p95 = s.pacing === null ? '—' : s.pacing.p95.toFixed(1);
    return `{ fps: ${fps}, p95: ${p95}, calls: ${s.counters.calls}, triangles: ${s.counters.triangles}, … }`;
  };

  const steps: Step[] = [
    { title: 'three.ez stats', text: 'A stats overlay for three.js that reads like a camera display.', code: () => 'WebGL · WebGPU', seconds: 3.6 },
    { mode: 'simple', target: boxOf(root, '.tez-c-band'), title: 'Simple', text: 'Frame rate, CPU and GPU time. Each dial is the share of the frame budget.' },
    { target: boxOf(root, '.tez-disp'), title: 'One plate', text: 'Four levels of detail. Click for the next, the arrow opens the list.' },
    { mode: 'performance', target: boxOf(root, '.tez-c-counters'), title: 'Performance', text: 'Plus the JS heap and the renderer counters. Yellow past the device budget.' },
    { target: boxOf(root, '.tez-c-counters [data-tip^="Objects in the scene"]'), title: 'Objects', text: 'With a scene: every node in it, counted once a second.', seconds: 3.4 },
    { mode: 'graph', target: boxOf(root, '.tez-c-strip'), title: 'Graph', text: 'Frame, CPU and GPU over time. Each column keeps its slowest frame.' },
    {
      target: boxOf(root, '.tez-c-strip .tez-panel:first-child'), title: 'Late frames',
      text: 'A 45 ms hitch, on purpose: yellow missed one refresh, red two or more. The flag is stats.event().',
      enter: () => {
        setTimeout(() => {
          stats.event('hitch');
          hitch(45);
        }, 700);
      },
      seconds: 5
    },
    {
      target: boxOf(root, '.tez-c-strip .tez-panel:first-child'), title: 'Shader compiles', text: 'A new material compiles a program: a tick marks that frame.',
      enter: () => {
        setTimeout(context.compileShader, 600);
      }
    },
    { target: boxOf(root, '[data-tip^="P95"]', '[data-tip^="Peak"]', '[data-tip^="Dropped"]'), title: 'What averages hide', text: 'P95, the worst frame and the refreshes missed, over the last 240 frames.' },
    {
      target: plate(root, 'REC'), title: 'Record', text: 'Start a run, stop it, get a report.',
      code: () => `Recording… ${((performance.now() - since) / 1000).toFixed(1)} s`,
      enter: () => {
        since = performance.now();
        stats.startRecording();
      },
      seconds: 4
    },
    {
      target: plate(root, 'REC'), title: 'Report', text: 'Compare before and after, or assert it in CI.', code: report,
      enter: () => {
        stats.stopRecording();
      },
      seconds: 4.6
    },
    { mode: 'lod', target: boxOf(root, '.tez-c-hist', '.tez-c-strip', '.tez-c-side'), title: 'Your own modes', text: 'Plain data in, this interface out. This LOD mode is an example in the repo.' },
    {
      mode: 'image', target: boxOf(root, '.tez-c-hist'), title: 'Image', text: 'Another example: an RGB histogram of the render, zebra on clipped highlights.',
      enter: () => {
        stats.setControl('image.zebra', true);
      },
      leave: () => {
        stats.setControl('image.zebra', false);
      }
    },
    { mode: 'graph', title: 'For agents', text: 'Everything on screen, as JSON: agents read numbers, not pixels.', code: () => `stats.snapshot() → ${snapshot()}`, seconds: 4.6 },
    { title: 'Ship without it', text: 'The same API, a no-op of 0.6 kB in production builds.', code: () => 'import { Stats } from \'@three.ez/stats/dev\'' },
    { title: 'three.ez stats', text: 'github.com/luigidenora/stats', code: () => 'npm i @three.ez/stats', seconds: 6 }
  ];

  // The overlay's colour tokens live on its root: copy them so the tour speaks the same colours.
  const tokens = getComputedStyle(root);
  const layer = document.createElement('div');
  layer.className = 'tour';
  for (const name of ['--tez-ink', '--tez-alert', '--tez-ground', '--tez-outline', '--tez-rule']) layer.style.setProperty(name, tokens.getPropertyValue(name));
  const style = document.createElement('style');
  style.textContent = STYLE;
  const focus = document.createElement('div');
  focus.className = 'tour-frame';
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const span = document.createElement('span');
    span.className = 'tour-corner';
    span.dataset['c'] = corner;
    focus.append(span);
  }

  const caption = document.createElement('div');
  caption.className = 'tour-caption';
  caption.setAttribute('role', 'status');
  caption.innerHTML = '<div class="tour-head"><span class="tour-count"></span><span class="tour-keys">← → · Esc</span></div>'
    + '<div class="tour-title"></div><div class="tour-text"></div><div class="tour-code"></div><div class="tour-timer"><span></span></div>';
  const count = caption.querySelector<HTMLElement>('.tour-count');
  const title = caption.querySelector<HTMLElement>('.tour-title');
  const text = caption.querySelector<HTMLElement>('.tour-text');
  const code = caption.querySelector<HTMLElement>('.tour-code');
  const bar = caption.querySelector<HTMLElement>('.tour-timer > span');
  layer.append(style, focus, caption);
  document.body.append(layer);
  document.body.classList.add('tour-on');

  let shownAt = 0;
  const follow = (): void => {
    const step = steps[index] as Step | undefined;
    // Wait for the mode change to finish its 280ms glide before measuring.
    const box = step?.target !== undefined && performance.now() - shownAt > FLIP_MS ? step.target() : null;
    if (box === null) {
      focus.style.opacity = step?.target === undefined ? '0' : focus.style.opacity;
    } else {
      focus.style.opacity = '1';
      focus.style.left = `${Math.round(box.left - PAD)}px`;
      focus.style.top = `${Math.round(box.top - PAD)}px`;
      focus.style.width = `${Math.round(box.width + PAD * 2)}px`;
      focus.style.height = `${Math.round(box.height + PAD * 2)}px`;
    }

    frame = requestAnimationFrame(follow);
  };

  const show = (next: number): void => {
    if (next < 0 || next >= steps.length) return;
    steps[index]?.leave?.();
    index = next;
    const step = steps[index];
    shownAt = performance.now();
    if (step.mode !== undefined && stats.mode !== step.mode) stats.mode = step.mode;
    if (count !== null) count.textContent = `${String(index + 1).padStart(2, '0')}/${steps.length}`;
    if (title !== null) title.textContent = step.title;
    if (text !== null) text.textContent = step.text;
    step.enter?.();
    const writeCode = (): void => {
      if (code !== null) code.textContent = step.code?.() ?? '';
    };

    writeCode();
    clearInterval(codeTimer);
    codeTimer = window.setInterval(writeCode, 250);
    clearTimeout(timer);
    const seconds = step.seconds ?? 4.2;
    if (bar !== null) {
      bar.style.transition = 'none';
      bar.style.width = '0';
      if (options.autoplay) {
        // Next frame: let the reset paint before the timed fill starts.
        requestAnimationFrame(() => {
          bar.style.transition = `width ${seconds}s linear`;
          bar.style.width = '100%';
        });
      }
    }

    if (options.autoplay && index < steps.length - 1) timer = window.setTimeout(() => {
      show(index + 1);
    }, seconds * 1000);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowRight' || event.key === ' ') {
      event.preventDefault();
      show(index + 1);
    } else if (event.key === 'ArrowLeft') {
      show(index - 1);
    } else if (event.key === 'Escape') {
      end();
    }
  };

  function end(): void {
    steps[index]?.leave?.();
    clearTimeout(timer);
    clearInterval(codeTimer);
    cancelAnimationFrame(frame);
    if (stats.recording) stats.stopRecording();
    window.removeEventListener('keydown', onKey);
    layer.remove();
    document.body.classList.remove('tour-on');
    stats.mode = startMode;
  }

  caption.addEventListener('click', () => {
    show(index + 1);
  });
  window.addEventListener('keydown', onKey);
  frame = requestAnimationFrame(follow);
  show(0);
  return end;
}
