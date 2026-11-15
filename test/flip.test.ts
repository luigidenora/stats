// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { play } from '../src/flip.js';
import { must } from './helpers.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('exit ghosts', () => {
  it('render even when the leaving element was hidden with the hidden attribute', () => {
    const root = document.createElement('div');
    const row = document.createElement('span');
    row.className = 'tez-row';
    row.append(document.createElement('span'));
    root.append(row);
    document.body.append(root);
    // As in a browser: a display: none element has no offsetParent.
    Object.defineProperty(row, 'offsetParent', { configurable: true, get: () => (row.hidden === true ? null : document.body) });
    const animate = vi.fn(() => ({ onfinish: null }) as unknown as Animation);
    HTMLElement.prototype.animate = animate;
    row.hidden = true;
    play({ elements: [row], rects: [new DOMRect(10, 10, 40, 20)] }, root);
    const ghost = must(root.querySelector<HTMLElement>('.tez-ghost'), 'a ghost');
    expect(ghost.hidden).toBe(false);
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(animate).toHaveBeenCalled();
  });
});
