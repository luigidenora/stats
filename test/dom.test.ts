// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphColors, TimeReadout } from '../src/dom.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TimeReadout dial', () => {
  it('redraws when the frame goes from almost full to over budget', () => {
    const readout = new TimeReadout(document.createElement('span'), 'CPU', 4);
    readout.update(16.5, 1000 / 60, undefined);
    const almost = readout.dial.firstElementChild;
    readout.update(25, 1000 / 60, undefined);
    expect(readout.dial.firstElementChild).not.toBe(almost);
    const over = readout.dial.firstElementChild;
    readout.update(30, 1000 / 60, undefined);
    expect(readout.dial.firstElementChild).toBe(over);
  });
});

describe('graphColors', () => {
  it('follows a custom property changed at runtime, within a second', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const root = document.createElement('div');
    document.body.append(root);
    expect(graphColors(root).ink).toBe('#f4f4f1');
    root.style.setProperty('--tez-ink', '#000000');
    now += 1100;
    expect(graphColors(root).ink).toBe('#000000');
    root.remove();
  });
});
