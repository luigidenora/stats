// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CanvasFit } from '../src/canvas-fit.js';

describe('CanvasFit', () => {
  it('scales the canvas into the thumbnail with a transform, inside a 1px border, and restores the page style', () => {
    const canvas = document.createElement('canvas');
    canvas.style.transform = 'rotate(1deg)';
    const fit = new CanvasFit(canvas);
    fit.apply(new DOMRect(0, 0, 1000, 500), new DOMRect(100, 50, 502, 252));
    expect(canvas.style.transformOrigin).toBe('0 0');
    expect(canvas.style.transform).toBe('translate(101px, 51px) scale(0.5)');
    // A second apply keeps the original style to restore, not the fitted one.
    fit.apply(new DOMRect(0, 0, 1000, 500), new DOMRect(0, 0, 202, 102));
    fit.clear();
    expect(canvas.style.transform).toBe('rotate(1deg)');
    fit.clear();
    expect(canvas.style.transform).toBe('rotate(1deg)');
  });

  it('restores instead of fitting with no target or an empty canvas', () => {
    const canvas = document.createElement('canvas');
    const fit = new CanvasFit(canvas);
    fit.apply(new DOMRect(0, 0, 100, 100), new DOMRect(0, 0, 52, 52));
    fit.apply(new DOMRect(0, 0, 100, 100), null);
    expect(canvas.style.transform).toBe('');
    fit.apply(new DOMRect(0, 0, 0, 0), new DOMRect(0, 0, 52, 52));
    expect(canvas.style.transform).toBe('');
  });
});
