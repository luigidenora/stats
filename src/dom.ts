/** Small DOM helpers shared by the overlay parts. */

import { formatMs, isAlert, type Threshold } from './format.js';
import { createDial } from './glyphs.js';
import type { GraphColors } from './graphs.js';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Marks an element as a hover target with tooltip text (pointer events only in interactive mode). */
export function hit<T extends HTMLElement>(node: T, tip: string): T {
  node.classList.add('tez-hit');
  node.dataset['tip'] = tip;
  return node;
}

/** A number with a reserved width, so the layout never jumps as digits change. */
export function num(width: number): HTMLSpanElement {
  const node = el('span', 'tez-num', '—');
  node.style.setProperty('--tez-w', `${width}ch`);
  return node;
}

/** Two-line micro label; `bottomClass` colours the second line (e.g. a series colour). */
export function stack(top: string, bottom: string, bottomClass = ''): HTMLSpanElement {
  const node = el('span', 'tez-stack');
  node.append(el('span', '', top), el('span', bottomClass, bottom));
  return node;
}

export interface Writable {
  element: HTMLElement;
  value: HTMLElement;
  text: string;
  alert: boolean;
}

/** Writes text and alert state only when they change. */
export function write(slot: Writable, text: string, alert: boolean): void {
  if (slot.text !== text) {
    slot.value.textContent = text;
    slot.text = text;
  }

  if (slot.alert !== alert) {
    slot.element.classList.toggle('tez-alert', alert);
    slot.alert = alert;
  }
}

export function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** Accessible name and tooltip text of a graph. */
export function setLabel(element: HTMLElement, label: string): void {
  if (element.getAttribute('aria-label') === label) return;
  element.setAttribute('aria-label', label);
  element.dataset['tip'] = label;
}

/** A time value with a budget dial in front, used for CPU and GPU time. */
export class TimeReadout implements Writable {
  public readonly value: HTMLSpanElement;
  public text = '';
  public alert = false;
  private readonly _dialHolder = el('span', 'tez-icon');
  private _dialStep = -2;

  constructor(public readonly element: HTMLElement, private readonly _label: string, width: number) {
    this.value = num(width);
  }

  public get dial(): HTMLElement { return this._dialHolder; }

  public update(ms: number | null, budget: number, threshold: Threshold | undefined): void {
    write(this, ms === null ? '—' : formatMs(ms), isAlert(ms, threshold));
    // Redraw the dial only when its sector moves by a visible step (1/48 of a turn). Over budget
    // (the solid disk) is a step of its own, so "almost full" and "over" never share one.
    const ratio = ms === null ? -1 : ms / budget;
    const step = ms === null ? -1 : ratio >= 1 ? 49 : Math.min(48, Math.round(ratio * 48));
    if (step === this._dialStep) return;
    this._dialStep = step;
    this._dialHolder.replaceChildren(createDial(ms === null ? null : ms / budget, 16, this._label, true));
  }
}

/**
 * Reads the graph colours of a root, at most once a second: canvases cannot use CSS variables, and
 * a page that restyles `--tez-*` at runtime (e.g. for a bright scene) must see its graphs follow.
 */
const COLOR_TTL_MS = 1000;
const colorCache = new WeakMap<HTMLElement, { colors: GraphColors; at: number }>();

export function graphColors(root: HTMLElement): GraphColors {
  const now = performance.now();
  const cached = colorCache.get(root);
  let colors = cached !== undefined && now - cached.at < COLOR_TTL_MS ? cached.colors : undefined;
  if (colors === undefined) {
    const style = getComputedStyle(root);
    const read = (name: string, fallback: string): string => {
      const value = style.getPropertyValue(name).trim();
      return value === '' ? fallback : value;
    };

    const ink = read('--tez-ink', '#f4f4f1');
    colors = {
      ink,
      clip: read('--tez-clip', '#ff2a1f'),
      alert: read('--tez-alert', '#f2cc1d'),
      series: {
        frame: read('--tez-frame', '#4f7dff'), gpu: read('--tez-gpu', '#2ee84a'), cpu: read('--tez-cpu', '#ff3b30'), ink,
        r: read('--tez-ch-r', '#ff3b30'), g: read('--tez-ch-g', '#2ee84a'), b: read('--tez-ch-b', '#4f7dff')
      }
    };

    colorCache.set(root, { colors, at: now });
  }

  return colors;
}
