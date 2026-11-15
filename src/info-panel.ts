/**
 * The INFO mode's page: a header ("RENDERER 1/4") and key/value rows, like a camera's detailed
 * info screen. The PAGE plate next to the mode plate turns pages. Rows are rebuilt every couple of
 * seconds while the mode is open, never per frame.
 */

import { el, hit } from './dom.js';
import type { InfoPage } from './info.js';

const REBUILD_MS = 2000;

export class InfoPanel {
  public readonly element: HTMLDivElement;
  /** The PAGE plate, placed next to the mode plate by the overlay. */
  public readonly pager: HTMLButtonElement;

  private readonly _title = el('span', 'tez-info-title');
  private readonly _count = el('span', 'tez-info-count');
  private readonly _rows = el('div', 'tez-info-rows');
  private _page = 0;
  private _built = 0;

  constructor(private readonly _pages: number, private readonly _build: (index: number) => InfoPage) {
    this.element = el('div', 'tez-info-page');
    const head = el('div', 'tez-info-head');
    head.append(this._title, this._count);
    this.element.append(head, this._rows);
    this.pager = hit(el('button', 'tez-plate tez-toggle tez-pager'), 'Next info page');
    this.pager.type = 'button';
    this.pager.append(el('span', '', 'PAGE'));
    this.pager.addEventListener('click', this.onNext);
  }

  /** Rebuilds the current page when it is stale (or always, with `force`). */
  public update(force = false): void {
    const now = performance.now();
    if (!force && now - this._built < REBUILD_MS) return;
    this._built = now;
    let page: InfoPage;
    try {
      page = this._build(this._page);
    } catch (error) {
      // A renderer or scene in a strange state must not break the frame that refreshes the page.
      page = { title: 'Info', rows: [{ key: 'Unavailable', value: String(error).slice(0, 40), warn: true }] };
    }

    this._title.textContent = page.title.toUpperCase();
    this._count.textContent = `${this._page + 1}/${this._pages}`;
    this.pager.setAttribute('aria-label', `Info page ${this._page + 1} of ${this._pages}: ${page.title}. Click for the next page.`);
    const rows: HTMLElement[] = [];
    for (let i = 0, l = page.rows.length; i < l; i++) {
      const row = page.rows[i];
      const line = el('div', row.warn === true ? 'tez-info-row tez-alert' : 'tez-info-row');
      line.append(el('span', 'tez-info-key', row.key), el('span', 'tez-info-value', row.value));
      rows.push(line);
    }

    this._rows.replaceChildren(...rows);
  }

  public dispose(): void {
    this.pager.removeEventListener('click', this.onNext);
  }

  private readonly onNext = (): void => {
    this._page = (this._page + 1) % this._pages;
    this.update(true);
  };
}
