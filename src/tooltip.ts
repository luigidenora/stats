/**
 * The overlay's own tooltip, in its plate style.
 *
 * Content: a plain string from the hovered element's `data-tip`, or rich content registered with
 * `setTip()` (title, text, a legend of colours and graph symbols, live values, one piece of advice).
 *
 * Input:
 * - mouse and pen: instant on hover, gone on leave;
 * - touch: a short tap on a readout or graph opens it, a long press (450 ms) opens it on anything,
 *   buttons included, and swallows the click and context menu that would follow, so a long press
 *   on the mode plate explains it instead of changing the mode. A touch tooltip stays until the
 *   next tap elsewhere, a scroll, or 6 s.
 */

import type { TipContent, TipMark } from './types.js';

const GAP = 6;
const LONG_PRESS_MS = 450;
const TOUCH_HOLD_MS = 6000;
/** A touch that moves farther than this is a drag or a scroll, not a press. */
const SLOP = 10;

const rich = new WeakMap<HTMLElement, TipContent>();

/** Plain-text form of rich content, for `data-tip` and assistive technology. */
export function tipText(content: TipContent): string {
  const parts = [content.title];
  if (content.text !== undefined) parts.push(content.text);
  const legend = content.legend ?? [];
  for (let i = 0, l = legend.length; i < l; i++) parts.push(legend[i].text);
  const sections = content.sections ?? [];
  for (let i = 0, l = sections.length; i < l; i++) parts.push(`${sections[i].title}: ${sections[i].text}`);
  if (content.advice !== undefined) parts.push(`Tip: ${content.advice}`);
  return parts.join('. ').replace(/\.\./g, '.');
}

/** Registers rich tooltip content for an element and marks it as a hover target. */
export function setTip<T extends HTMLElement>(element: T, content: TipContent): T {
  rich.set(element, content);
  element.classList.add('tez-hit');
  element.dataset['tip'] = tipText(content);
  return element;
}

function span(className: string, text?: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function markNode(mark: TipMark): HTMLSpanElement {
  const node = span('tez-tip-mark');
  node.dataset['mark'] = mark;
  return node;
}

export class Tooltip {
  private readonly _element: HTMLDivElement;
  private _target: HTMLElement | null = null;
  private _values: HTMLDivElement | null = null;
  /** Rich content on screen, to rebuild when the target's content is replaced while open. */
  private _shown: TipContent | null = null;
  private _press: { target: HTMLElement; x: number; y: number; timer: number } | null = null;
  private _holdTimer = 0;
  /** A long press opened the tooltip: the click and context menu it would cause are swallowed. */
  private _swallow = false;

  constructor(private readonly _root: HTMLElement) {
    this._element = document.createElement('div');
    this._element.className = 'tez-tip';
    this._element.id = `tez-tip-${Math.random().toString(36).slice(2, 8)}`;
    this._element.setAttribute('role', 'tooltip');
    this._element.hidden = true;
    _root.append(this._element);
    // Pointer events bubble from the hover targets even though the root itself ignores the pointer.
    _root.addEventListener('pointerover', this.onOver);
    _root.addEventListener('pointerout', this.onOut);
    _root.addEventListener('pointerdown', this.onDown);
    _root.addEventListener('pointermove', this.onMove);
    _root.addEventListener('pointerup', this.onUp);
    _root.addEventListener('pointercancel', this.cancelPress);
    _root.addEventListener('click', this.onClick, true);
    _root.addEventListener('contextmenu', this.onContextMenu, true);
  }

  /** Refreshes the live values of the open tooltip (called at each overlay refresh). */
  public refresh(): void {
    if (this._target === null) return;
    const content = rich.get(this._target);
    if (content === undefined) return;
    if (content !== this._shown) {
      this.build(content);
      this.place(this._target);
    } else if (content.values !== undefined) {
      this.fillValues(content);
    }
  }

  public dispose(): void {
    this._root.removeEventListener('pointerover', this.onOver);
    this._root.removeEventListener('pointerout', this.onOut);
    this._root.removeEventListener('pointerdown', this.onDown);
    this._root.removeEventListener('pointermove', this.onMove);
    this._root.removeEventListener('pointerup', this.onUp);
    this._root.removeEventListener('pointercancel', this.cancelPress);
    this._root.removeEventListener('click', this.onClick, true);
    this._root.removeEventListener('contextmenu', this.onContextMenu, true);
    this.cancelPress();
    this.hide();
    this._element.remove();
  }

  /** The nearest element with rich content wins over a plain `data-tip` inside it (e.g. a graph canvas in its panel). */
  private targetOf(event: Event): HTMLElement | null {
    let node = event.target as Element | null;
    while (node !== null && node !== this._root) {
      if (rich.has(node as HTMLElement)) return node as HTMLElement;
      node = node.parentElement;
    }

    const target = (event.target as Element).closest<HTMLElement>('[data-tip]');
    return target !== null && this._root.contains(target) ? target : null;
  }

  private readonly onOver = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    const target = this.targetOf(event);
    if (target === null || target === this._target) return;
    this.show(target);
  };

  private readonly onOut = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    const next = event.relatedTarget as Element | null;
    if (this._target !== null && next !== null && this._target.contains(next)) return;
    this.hide();
  };

  private readonly onDown = (event: PointerEvent): void => {
    // Any new press (a mouse on a hybrid device too) ends what the last long press swallowed.
    this._swallow = false;
    if (event.pointerType !== 'touch') return;
    const target = this.targetOf(event);
    if (target === null) return;
    const timer = window.setTimeout(() => {
      this._press = null;
      this._swallow = true;
      this.showForTouch(target);
    }, LONG_PRESS_MS);
    this._press = { target, x: event.clientX, y: event.clientY, timer };
  };

  private readonly onMove = (event: PointerEvent): void => {
    const press = this._press;
    if (press !== null && Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP) this.cancelPress();
  };

  private readonly onUp = (event: PointerEvent): void => {
    const press = this._press;
    if (event.pointerType !== 'touch' || press === null) return;
    this.cancelPress();
    // A short tap on a button acts (cycles the mode, flips a toggle); on anything else it explains.
    if (press.target.closest('button') !== null) {
      this.hide();
      return;
    }

    if (this._target === press.target) this.hide();
    else this.showForTouch(press.target);
  };

  private readonly cancelPress = (): void => {
    if (this._press === null) return;
    window.clearTimeout(this._press.timer);
    this._press = null;
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (!this._swallow) return;
    this._swallow = false;
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    // Mobile browsers fire a context menu on long press: the tooltip already answered it.
    if (this._swallow || this._press !== null) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  /** A tap anywhere outside the open touch tooltip's target closes it. */
  private readonly onDocumentDown = (event: PointerEvent): void => {
    if (this._target !== null && !this._target.contains(event.target as Node)) this.hide();
  };

  private readonly onScroll = (): void => {
    this.hide();
  };

  private showForTouch(target: HTMLElement): void {
    this.show(target);
    document.addEventListener('pointerdown', this.onDocumentDown, true);
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
    this._holdTimer = window.setTimeout(() => {
      this.hide();
    }, TOUCH_HOLD_MS);
  }

  private show(target: HTMLElement): void {
    this.hide();
    this._target = target;
    const content = rich.get(target);
    if (content === undefined) this._element.textContent = target.dataset['tip'] ?? '';
    else this.build(content);
    this._element.classList.toggle('tez-tip-rich', content !== undefined);
    this._element.hidden = false;
    target.setAttribute('aria-describedby', this._element.id);
    this.place(target);
  }

  private hide(): void {
    window.clearTimeout(this._holdTimer);
    document.removeEventListener('pointerdown', this.onDocumentDown, true);
    window.removeEventListener('scroll', this.onScroll, { capture: true });
    this._target?.removeAttribute('aria-describedby');
    this._target = null;
    this._values = null;
    this._shown = null;
    this._element.hidden = true;
  }

  private build(content: TipContent): void {
    const nodes: HTMLElement[] = [span('tez-tip-title', content.title)];
    if (content.text !== undefined) nodes.push(span('tez-tip-text', content.text));
    const legend = content.legend ?? [];
    if (legend.length > 0) {
      const list = document.createElement('div');
      list.className = 'tez-tip-legend';
      for (let i = 0, l = legend.length; i < l; i++) {
        const row = span('tez-tip-row');
        row.append(markNode(legend[i].mark), span('', legend[i].text));
        list.append(row);
      }

      nodes.push(list);
    }

    this._values = null;
    if (content.values !== undefined) {
      this._values = document.createElement('div');
      this._values.className = 'tez-tip-values';
      nodes.push(this._values);
      this.fillValues(content);
    }

    const sections = content.sections ?? [];
    for (let i = 0, l = sections.length; i < l; i++) {
      const block = span('tez-tip-section');
      block.append(span('tez-tip-section-title', sections[i].title), span('', sections[i].text));
      const tip = sections[i].advice;
      if (tip !== undefined) block.append(span('tez-tip-section-advice', tip));
      nodes.push(block);
    }

    if (content.advice !== undefined) {
      const advice = span('tez-tip-advice');
      advice.append(span('tez-tip-advice-key', 'TIP'), span('', content.advice));
      nodes.push(advice);
    }

    this._shown = content;
    this._element.replaceChildren(...nodes);
  }

  private fillValues(content: TipContent): void {
    const values = this._values;
    if (values === null || content.values === undefined) return;
    let rows: readonly (readonly [string, string])[];
    try {
      rows = content.values();
    } catch {
      rows = [];
    }

    const nodes: HTMLElement[] = [];
    for (let i = 0, l = rows.length; i < l; i++) {
      const row = span('tez-tip-pair');
      row.append(span('tez-tip-key', rows[i][0]), span('tez-tip-value', rows[i][1]));
      nodes.push(row);
    }

    values.replaceChildren(...nodes);
  }

  /** Above the target when there is room, otherwise below; always inside the overlay. */
  private place(target: HTMLElement): void {
    const root = this._root.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const tip = this._element.getBoundingClientRect();
    let top = box.top - root.top - tip.height - GAP;
    if (top < 4) top = box.bottom - root.top + GAP;
    top = Math.min(top, root.height - tip.height - 4);
    const left = Math.min(Math.max(4, box.left - root.left), root.width - tip.width - 4);
    this._element.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(4, top))}px)`;
  }
}
