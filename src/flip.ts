/**
 * Transitions for grid re-arrangements and mode changes.
 *
 * - Moved: FLIP. Record where an element is, change the layout, animate it from the old place.
 * - Leaving: a still copy (a "ghost") keeps the old box and slides out past the nearest overlay
 *   edge, so a hidden or removed element exits the screen instead of blinking out.
 * - Entering: slides in from the nearest edge.
 *
 * Grid areas cannot interpolate by themselves, so this is what makes changes glide.
 */

const DURATION = 280;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_IN = 'cubic-bezier(0.55, 0, 0.75, 0.2)';

export interface Snapshot {
  elements: readonly HTMLElement[];
  rects: (DOMRect | null)[];
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** True when the element takes part in the rendered layout and is not hidden. */
function shown(element: HTMLElement): boolean {
  return element.isConnected && element.offsetParent !== null && getComputedStyle(element).visibility !== 'hidden';
}

/** Records the current box of each element (null when it is not on screen). */
export function snapshot(elements: readonly HTMLElement[]): Snapshot {
  const rects: (DOMRect | null)[] = [];
  for (let i = 0, l = elements.length; i < l; i++) rects.push(shown(elements[i]) ? elements[i].getBoundingClientRect() : null);
  return { elements, rects };
}

/** Offset that moves a box just past the overlay edge nearest to it. */
function edgeOffset(box: DOMRect, root: DOMRect): [number, number] {
  const left = box.right - root.left;
  const right = root.right - box.left;
  const up = box.bottom - root.top;
  const down = root.bottom - box.top;
  const min = Math.min(left, right, up, down);
  if (min === down) return [0, down + 8];
  if (min === up) return [0, -(up + 8)];
  return min === left ? [-(left + 8), 0] : [right + 8, 0];
}

/** Copies the pixels of every canvas in `from` into the matching canvas of its clone. */
function copyCanvases(from: HTMLElement, to: HTMLElement): void {
  const sources = from.querySelectorAll('canvas');
  const targets = to.querySelectorAll('canvas');
  for (let i = 0, l = Math.min(sources.length, targets.length); i < l; i++) {
    targets[i].width = sources[i].width;
    targets[i].height = sources[i].height;
    targets[i].getContext('2d')?.drawImage(sources[i], 0, 0);
  }
}

/** A still copy of a leaving element that slides out past the nearest edge, then removes itself. */
function exit(element: HTMLElement, box: DOMRect, root: HTMLElement): void {
  const rootBox = root.getBoundingClientRect();
  const ghost = element.cloneNode(true) as HTMLElement;
  copyCanvases(element, ghost);
  ghost.removeAttribute('id');
  // Rows and plates leave by `hidden = true`: the copy must not inherit it, or it never renders.
  ghost.hidden = false;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.add('tez-ghost');
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${box.left - rootBox.left}px`,
    top: `${box.top - rootBox.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: '0',
    visibility: 'visible',
    // Out of the grid: an absolute grid item would otherwise be offset inside its old grid area.
    gridArea: 'auto',
    transform: 'none'
  });
  root.append(ghost);
  const [dx, dy] = edgeOffset(box, rootBox);
  const animation = ghost.animate(
    [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }],
    { duration: DURATION, easing: EASE_IN, fill: 'forwards' }
  );
  animation.onfinish = (): void => {
    ghost.remove();
  };
}

/** Moves, brings in and sends out elements between two layouts. */
export function play(before: Snapshot, root: HTMLElement): void {
  const rootBox = root.getBoundingClientRect();
  for (let i = 0, l = before.elements.length; i < l; i++) {
    const element = before.elements[i];
    const from = before.rects[i];
    const visible = shown(element);
    if (from !== null && !visible) {
      exit(element, from, root);
      continue;
    }

    if (!visible) continue;
    const to = element.getBoundingClientRect();
    if (from === null) {
      const [dx, dy] = edgeOffset(to, rootBox);
      element.animate([{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: DURATION, easing: EASE_OUT });
      continue;
    }

    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: DURATION, easing: EASE_OUT });
  }
}
