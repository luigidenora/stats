/**
 * An Image mode for the demo, built only with the public API: what a plugin can do.
 *
 * - an RGB histogram of the rendered image (a binned `histogram` with three channels);
 * - ZEBRA: stripes over clipped highlights, on a canvas the example lays over the renderer's;
 * - GRID: rule-of-thirds lines and a centre mark;
 * - PIX: the colour under the pointer, as hex.
 *
 * It is not part of the package: copy it, change it, or leave it out.
 */

import type { Stats } from '../src/index.js';
import { IMAGE_BINS, IMAGE_HEIGHT, IMAGE_WIDTH, ImageSampler, zebraMask } from './image-sampler.js';

/** Aids drawn over the canvas: they sit under the overlay, which is fixed on top. */
function overlayCanvas(source: HTMLCanvasElement): { zebra: HTMLCanvasElement; grid: HTMLDivElement; place: () => void; dispose: () => void } {
  const zebra = document.createElement('canvas');
  zebra.width = IMAGE_WIDTH;
  zebra.height = IMAGE_HEIGHT;
  zebra.style.cssText = 'position: fixed; pointer-events: none; image-rendering: pixelated; z-index: 9999;';
  zebra.hidden = true;
  const grid = document.createElement('div');
  grid.style.cssText = 'position: fixed; pointer-events: none; z-index: 9999;';
  grid.hidden = true;
  // Thirds and a centre cross: 1px light lines with a dark contour, like the overlay's own geometry.
  const line = 'position: absolute; background: #f4f4f1; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.85); opacity: 0.8;';
  for (const at of ['33.333%', '66.667%']) {
    const vertical = document.createElement('span');
    vertical.style.cssText = `${line} top: 0; bottom: 0; width: 1px; left: ${at};`;
    const horizontal = document.createElement('span');
    horizontal.style.cssText = `${line} left: 0; right: 0; height: 1px; top: ${at};`;
    grid.append(vertical, horizontal);
  }

  const cross = document.createElement('span');
  cross.style.cssText = `${line} left: calc(50% - 4px); top: 50%; width: 9px; height: 1px;`;
  const crossV = document.createElement('span');
  crossV.style.cssText = `${line} left: 50%; top: calc(50% - 4px); width: 1px; height: 9px;`;
  grid.append(cross, crossV);
  document.body.append(zebra, grid);
  const place = (): void => {
    const box = source.getBoundingClientRect();
    for (const element of [zebra, grid]) {
      element.style.left = `${box.left}px`;
      element.style.top = `${box.top}px`;
      element.style.width = `${box.width}px`;
      element.style.height = `${box.height}px`;
    }
  };

  place();
  addEventListener('resize', place);
  return {
    zebra, grid, place,
    dispose: () => {
      removeEventListener('resize', place);
      zebra.remove();
      grid.remove();
    }
  };
}

export function addImageMode(stats: Stats, canvas: HTMLCanvasElement): void {
  const sampler = new ImageSampler();
  const aids = overlayCanvas(canvas);
  const zebraContext = aids.zebra.getContext('2d');
  const zebraImage = zebraContext?.createImageData(IMAGE_WIDTH, IMAGE_HEIGHT) ?? null;
  let zebraPhase = 0;
  let pointer: { x: number; y: number } | null = null;
  addEventListener('pointermove', (event) => {
    pointer = { x: event.clientX, y: event.clientY };
  }, { passive: true });

  // Channel reads run inside stats.end(), right after the render: the copy needs no preserved buffer.
  const channel = (bins: Float32Array) => (): Float32Array | null => {
    if (!sampler.capture(canvas)) return null;
    if (zebraImage !== null && zebraContext !== null && aids.zebra.hidden !== true && sampler.pixels !== null) {
      zebraMask(sampler.pixels, zebraImage.data, zebraPhase++);
      zebraContext.putImageData(zebraImage, 0, 0);
    }

    return bins;
  };

  const pixel = (): number | null => {
    const pixels = sampler.pixels;
    if (pixels === null || pointer === null || !sampler.valid) return null;
    const box = canvas.getBoundingClientRect();
    const u = (pointer.x - box.left) / box.width;
    const v = (pointer.y - box.top) / box.height;
    if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return null;
    const at = (Math.floor(v * IMAGE_HEIGHT) * IMAGE_WIDTH + Math.floor(u * IMAGE_WIDTH)) * 4;
    return (pixels[at] << 16) | (pixels[at + 1] << 8) | pixels[at + 2];
  };

  stats.defineMode({
    id: 'image',
    name: 'Image',
    code: 'IMG',
    description: 'The R, G, B histogram of the rendered image, with zebra, framing guides and the pixel under the pointer.',
    histogram: {
      id: 'image.rgb',
      label: ['RGB', 'IMG'],
      unit: '',
      bins: IMAGE_BINS,
      binned: true,
      domain: { min: 0, max: 255 },
      channels: [
        { name: 'R', read: channel(sampler.red) },
        { name: 'G', read: channel(sampler.green) },
        { name: 'B', read: channel(sampler.blue) }
      ],
      tip: {
        title: 'Image histogram',
        text: 'Red, green and blue of the rendered image after tone mapping, 0 (black) to 255 (white). White where the three agree, coloured fringes for casts.',
        legend: [
          { mark: 'r', text: 'Red channel' },
          { mark: 'g', text: 'Green channel' },
          { mark: 'b', text: 'Blue channel' },
          { mark: 'alert', text: 'Edge mark: values piled up at black or white (clipping)' }
        ],
        values: () => (sampler.valid
          ? [['Highlights clipped', `${Math.round(sampler.clippedHigh * 100)}%`], ['Blacks crushed', `${Math.round(sampler.clippedLow * 100)}%`]]
          : [['Canvas', 'not readable']])
      }
    },
    metrics: [{
      id: 'image.pixel', label: 'Colour of the rendered pixel under the pointer.', place: 'top', plate: 'PIX', width: 7,
      read: pixel, format: (value) => `#${value.toString(16).padStart(6, '0').toUpperCase()}`
    }],
    controls: [
      {
        id: 'image.zebra', label: 'ZEBRA', description: 'Stripes over clipped highlights (a channel at 250 or more of 255).',
        onChange: (on) => {
          aids.place();
          aids.zebra.hidden = !on;
        }
      },
      {
        id: 'image.grid', label: 'GRID', description: 'Framing guides: rule-of-thirds lines and a centre mark.',
        onChange: (on) => {
          aids.place();
          aids.grid.hidden = !on;
        }
      }
    ]
  });

  // The aids belong to the mode: leaving it hides them, coming back restores them.
  let wasImage = false;
  const watch = (): void => {
    const isImage = stats.mode === 'image';
    if (isImage !== wasImage) {
      wasImage = isImage;
      if (!isImage) {
        aids.zebra.hidden = true;
        aids.grid.hidden = true;
        stats.setControl('image.zebra', false);
        stats.setControl('image.grid', false);
      }
    }

    requestAnimationFrame(watch);
  };

  requestAnimationFrame(watch);
}
