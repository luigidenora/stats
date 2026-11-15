// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTip, tipText, Tooltip } from '../src/tooltip.js';
import type { TipContent } from '../src/types.js';
import { must } from './helpers.js';

let root: HTMLElement;
let tooltip: Tooltip;

function tipElement(): HTMLElement {
  return must(root.querySelector<HTMLElement>('.tez-tip'));
}

function pointer(target: Element, type: string, init: PointerEventInit = {}): PointerEvent {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', clientX: 10, clientY: 10, ...init });
  target.dispatchEvent(event);
  return event;
}

function click(target: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  document.body.append(root);
  tooltip = new Tooltip(root);
});

afterEach(() => {
  tooltip.dispose();
  root.remove();
  vi.useRealTimers();
});

describe('tipText', () => {
  it('flattens rich content for data-tip and assistive technology', () => {
    const content: TipContent = {
      title: 'FPS', text: 'Frames per second.', legend: [{ mark: 'frame', text: 'Blue line' }],
      sections: [{ title: 'Stutter', text: 'P95 30 ms' }], advice: 'Warm up shaders.'
    };
    expect(tipText(content)).toBe('FPS. Frames per second. Blue line. Stutter: P95 30 ms. Tip: Warm up shaders.');
  });
});

describe('Tooltip with a mouse', () => {
  it('shows a plain data-tip on hover and hides it on leave', () => {
    const target = document.createElement('span');
    target.dataset['tip'] = 'Draw calls';
    root.append(target);
    pointer(target, 'pointerover', { pointerType: 'mouse' });
    expect(tipElement().hidden).toBe(false);
    expect(tipElement().textContent).toBe('Draw calls');
    expect(target.getAttribute('aria-describedby')).toBe(tipElement().id);
    pointer(target, 'pointerout', { pointerType: 'mouse' });
    expect(tipElement().hidden).toBe(true);
    expect(target.hasAttribute('aria-describedby')).toBe(false);
  });

  it('builds rich content and refreshes its live values while open', () => {
    let fps = 60;
    const target = setTip(document.createElement('span'), {
      title: 'FPS', legend: [{ mark: 'alert', text: 'Below target' }], values: () => [['Now', String(fps)]], advice: 'Lower the pixel ratio.'
    });
    root.append(target);
    pointer(target, 'pointerover', { pointerType: 'mouse' });
    const tip = tipElement();
    expect(tip.classList.contains('tez-tip-rich')).toBe(true);
    expect(tip.querySelector('.tez-tip-title')?.textContent).toBe('FPS');
    expect(tip.querySelector<HTMLElement>('.tez-tip-mark')?.dataset['mark']).toBe('alert');
    expect(tip.querySelector('.tez-tip-value')?.textContent).toBe('60');
    fps = 42;
    tooltip.refresh();
    expect(tip.querySelector('.tez-tip-value')?.textContent).toBe('42');
    expect(tip.querySelector('.tez-tip-advice')?.textContent).toContain('Lower the pixel ratio.');
  });

  it('rebuilds when the content of the open target is replaced', () => {
    const target = setTip(document.createElement('span'), { title: 'TIP 1' });
    root.append(target);
    pointer(target, 'pointerover', { pointerType: 'mouse' });
    setTip(target, { title: 'TIP 2', sections: [{ title: 'Stutter', text: 'P95', advice: 'Look' }] });
    tooltip.refresh();
    expect(tipElement().querySelector('.tez-tip-title')?.textContent).toBe('TIP 2');
    expect(tipElement().querySelector('.tez-tip-section-advice')?.textContent).toBe('Look');
  });

  it('survives a values callback that throws', () => {
    const target = setTip(document.createElement('span'), { title: 'X', values: () => {
      throw new Error('boom');
    } });
    root.append(target);
    expect(() => pointer(target, 'pointerover', { pointerType: 'mouse' })).not.toThrow();
    expect(tipElement().querySelectorAll('.tez-tip-pair')).toHaveLength(0);
  });

  it('prefers the nearest rich ancestor over a plain data-tip inside it', () => {
    const panel = setTip(document.createElement('div'), { title: 'Frame graph' });
    const canvas = document.createElement('canvas');
    canvas.dataset['tip'] = 'plain';
    panel.append(canvas);
    root.append(panel);
    pointer(canvas, 'pointerover', { pointerType: 'mouse' });
    expect(tipElement().querySelector('.tez-tip-title')?.textContent).toBe('Frame graph');
  });

  it('ignores elements outside the overlay', () => {
    const outside = document.createElement('span');
    outside.dataset['tip'] = 'outside';
    document.body.append(outside);
    pointer(outside, 'pointerover', { pointerType: 'mouse' });
    expect(tipElement().hidden).toBe(true);
    outside.remove();
  });
});

describe('Tooltip with touch', () => {
  function readout(): HTMLElement {
    const target = document.createElement('span');
    target.dataset['tip'] = 'CPU time';
    root.append(target);
    return target;
  }

  function button(onClick: () => void): HTMLButtonElement {
    const element = document.createElement('button');
    element.dataset['tip'] = 'Display mode';
    element.addEventListener('click', onClick);
    root.append(element);
    return element;
  }

  it('does not open on the pointerover that precedes a tap', () => {
    pointer(readout(), 'pointerover');
    expect(tipElement().hidden).toBe(true);
  });

  it('opens on a short tap on a readout, stays when the finger lifts, and closes after 6 s', () => {
    const target = readout();
    pointer(target, 'pointerdown');
    pointer(target, 'pointerup');
    pointer(target, 'pointerout');
    expect(tipElement().hidden).toBe(false);
    vi.advanceTimersByTime(5900);
    expect(tipElement().hidden).toBe(false);
    vi.advanceTimersByTime(200);
    expect(tipElement().hidden).toBe(true);
  });

  it('closes on a second tap on the same readout and on a tap elsewhere', () => {
    const target = readout();
    pointer(target, 'pointerdown');
    pointer(target, 'pointerup');
    pointer(target, 'pointerdown');
    pointer(target, 'pointerup');
    expect(tipElement().hidden).toBe(true);

    pointer(target, 'pointerdown');
    pointer(target, 'pointerup');
    pointer(document.body, 'pointerdown');
    expect(tipElement().hidden).toBe(true);
  });

  it('closes on scroll', () => {
    const target = readout();
    pointer(target, 'pointerdown');
    pointer(target, 'pointerup');
    window.dispatchEvent(new Event('scroll'));
    expect(tipElement().hidden).toBe(true);
  });

  it('lets a short tap on a button act, without a tooltip', () => {
    const onClick = vi.fn();
    const target = button(onClick);
    pointer(target, 'pointerdown');
    pointer(target, 'pointerup');
    click(target);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(tipElement().hidden).toBe(true);
  });

  it('explains a button on long press and swallows the click and context menu that follow', () => {
    const onClick = vi.fn();
    const target = button(onClick);
    pointer(target, 'pointerdown');
    vi.advanceTimersByTime(460);
    expect(tipElement().hidden).toBe(false);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    target.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    pointer(target, 'pointerup');
    click(target);
    expect(onClick).not.toHaveBeenCalled();
    // The next tap works again.
    pointer(target, 'pointerdown');
    pointer(target, 'pointerup');
    click(target);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not eat a later mouse click when the long press was not followed by a click', () => {
    const onClick = vi.fn();
    const target = button(onClick);
    pointer(target, 'pointerdown');
    vi.advanceTimersByTime(460);
    pointer(target, 'pointercancel');
    // A hybrid device: the next input is a mouse.
    pointer(target, 'pointerdown', { pointerType: 'mouse' });
    click(target);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('treats a moving finger as a scroll, not a press', () => {
    const target = readout();
    pointer(target, 'pointerdown', { clientX: 10, clientY: 10 });
    pointer(target, 'pointermove', { clientX: 10, clientY: 40 });
    vi.advanceTimersByTime(500);
    pointer(target, 'pointerup');
    expect(tipElement().hidden).toBe(true);
  });

  it('cancels a pending press on dispose', () => {
    const target = readout();
    pointer(target, 'pointerdown');
    tooltip.dispose();
    vi.advanceTimersByTime(500);
    expect(root.querySelector('.tez-tip')).toBeNull();
    tooltip = new Tooltip(root);
  });
});
