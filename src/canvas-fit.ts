/**
 * Shrinks the renderer's canvas into the INFO thumbnail with a CSS transform.
 *
 * Why a transform and not renderer.setSize(): the drawing buffer keeps its size, so pixels,
 * GPU time and triangle counts stay true (setSize would change what is being measured and break
 * the page's own passes). A transform also never fires ResizeObserver. Side effect: pointer code
 * that uses clientWidth/clientHeight (e.g. OrbitControls) is slightly off while INFO is open.
 */

export class CanvasFit {
  private _saved: { transform: string; origin: string } | null = null;

  constructor(private readonly _canvas: HTMLCanvasElement) {}

  /** Puts the canvas back where the page had it (call before measuring it). */
  public clear(): void {
    if (this._saved === null) return;
    this._canvas.style.transform = this._saved.transform;
    this._canvas.style.transformOrigin = this._saved.origin;
    this._saved = null;
  }

  /** Fits the canvas, whose untransformed box is `rect`, inside `target` (1px border kept). Null restores it. */
  public apply(rect: DOMRect, target: DOMRect | null): void {
    if (target === null || rect.width === 0) {
      this.clear();
      return;
    }

    this._saved ??= { transform: this._canvas.style.transform, origin: this._canvas.style.transformOrigin };
    const scale = (target.width - 2) / rect.width;
    const x = target.left + 1 - rect.left;
    const y = target.top + 1 - rect.top;
    this._canvas.style.transformOrigin = '0 0';
    this._canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }
}
