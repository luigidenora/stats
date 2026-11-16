/**
 * Display modes and the mode plate (bottom-right).
 *
 * Like a camera's display button, a click steps to the next mode. The plate shows a display icon
 * and the current mode's code; the caret beside it (or a right click) opens a menu to pick one
 * directly. Built-in modes are cumulative: each one adds to the previous. Custom modes join the
 * cycle after the built-in ones, before 'off'.
 */

import { createCaret, createModeIcon } from './glyphs.js';
import { setTip } from './tooltip.js';
import type { StatsMode } from './types.js';

export type { StatsMode } from './types.js';

export interface ModeInfo {
  id: StatsMode;
  /** Name in the menu. */
  name: string;
  /** Short code on the mode plate, at most 4 characters. */
  code: string;
  description: string;
}

export const MODES: readonly ModeInfo[] = [
  { id: 'simple', name: 'Simple', code: 'STD', description: 'Frame rate, CPU and GPU time.' },
  { id: 'performance', name: 'Performance', code: 'PERF', description: 'Simple plus the JS heap and the renderer counters.' },
  { id: 'graph', name: 'Graph', code: 'GRPH', description: 'Performance plus the frame, CPU and GPU time graphs and the frame pacing rows.' },
  { id: 'off', name: 'Off', code: 'OFF', description: 'Nothing on screen but this control.' }
];

export function findMode(modes: readonly ModeInfo[], id: StatsMode): ModeInfo | null {
  for (let i = 0, l = modes.length; i < l; i++) {
    if (modes[i].id === id) return modes[i];
  }

  return null;
}

/** The mode plate and its menu. */
export class ModeControl {
  public readonly element: HTMLDivElement;

  private readonly _button: HTMLButtonElement;
  /** Caret plate: opens the menu with a plain click, so touch screens reach it too. */
  private readonly _more: HTMLButtonElement;
  private readonly _code: HTMLSpanElement;
  private readonly _menu: HTMLDivElement;
  private _mode: StatsMode;

  constructor(initial: StatsMode, private readonly _modes: () => readonly ModeInfo[], private readonly _onChange: (mode: StatsMode) => void) {
    this._mode = initial;
    this.element = document.createElement('div');
    this.element.className = 'tez-disp';
    this._button = document.createElement('button');
    this._button.type = 'button';
    this._button.className = 'tez-plate tez-disp-button tez-hit';
    this._code = document.createElement('span');
    this._code.className = 'tez-disp-code';
    this._button.append(...createModeIcon(), this._code);
    this._more = document.createElement('button');
    this._more.type = 'button';
    this._more.className = 'tez-plate tez-disp-more tez-hit';
    this._more.dataset['tip'] = 'Choose a display mode from the list.';
    this._more.setAttribute('aria-label', 'Choose a display mode');
    this._more.setAttribute('aria-haspopup', 'menu');
    this._more.setAttribute('aria-expanded', 'false');
    this._more.append(createCaret());
    this._menu = document.createElement('div');
    this._menu.className = 'tez-menu';
    this._menu.setAttribute('role', 'menu');
    this._menu.hidden = true;
    this.element.append(this._button, this._more, this._menu);

    this._button.addEventListener('click', this.onClick);
    this._button.addEventListener('contextmenu', this.onContextMenu);
    this._more.addEventListener('click', this.onToggleMenu);
    this._more.addEventListener('contextmenu', this.onContextMenu);
    this.render();
  }

  public get mode(): StatsMode { return this._mode; }

  public set mode(mode: StatsMode) {
    this._mode = mode;
    this.render();
  }

  /** Call when the list of modes changes (a custom mode was defined). */
  public refresh(): void {
    this.render();
  }

  public dispose(): void {
    this._button.removeEventListener('click', this.onClick);
    this._button.removeEventListener('contextmenu', this.onContextMenu);
    this._more.removeEventListener('click', this.onToggleMenu);
    this._more.removeEventListener('contextmenu', this.onContextMenu);
    this.closeMenu();
  }

  private readonly onClick = (): void => {
    if (this._menu.hidden !== true) {
      this.closeMenu();
      return;
    }

    const modes = this._modes();
    let index = 0;
    for (let i = 0, l = modes.length; i < l; i++) {
      if (modes[i].id === this._mode) index = i;
    }

    this.select(modes[(index + 1) % modes.length].id);
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.onToggleMenu();
  };

  private readonly onToggleMenu = (): void => {
    if (this._menu.hidden === true) this.openMenu();
    else this.closeMenu();
  };

  private readonly onOutside = (event: PointerEvent): void => {
    if (!this.element.contains(event.target as Node)) this.closeMenu();
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.closeMenu();
  };

  private select(mode: StatsMode): void {
    this.closeMenu();
    if (mode === this._mode) return;
    this._mode = mode;
    this.render();
    this._onChange(mode);
  }

  private openMenu(): void {
    this.buildItems();
    this._menu.hidden = false;
    this._more.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', this.onOutside, true);
    document.addEventListener('keydown', this.onKey);
    this._menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }

  private closeMenu(): void {
    this._menu.hidden = true;
    this._more.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('keydown', this.onKey);
  }

  private buildItems(): void {
    const modes = this._modes();
    const items: HTMLElement[] = [];
    for (let i = 0, l = modes.length; i < l; i++) {
      const info = modes[i];
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'tez-menu-item';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(info.id === this._mode));
      item.dataset['mode'] = info.id;
      item.dataset['tip'] = info.description;
      const name = document.createElement('span');
      name.textContent = info.name;
      const code = document.createElement('span');
      code.className = 'tez-menu-code';
      code.textContent = info.code;
      item.append(name, code);
      item.addEventListener('click', () => {
        this.select(info.id);
      });
      items.push(item);
    }

    this._menu.replaceChildren(...items);
  }

  private render(): void {
    const info = findMode(this._modes(), this._mode) ?? MODES[0];
    this._code.textContent = info.code;
    const tip = `Display mode: ${info.name}. Click for the next mode; the arrow or a right click opens the list.`;
    setTip(this._button, {
      title: `Display mode: ${info.name}`,
      text: info.description,
      legend: [
        { mark: 'alert', text: 'Click or tap: the next mode' },
        { mark: 'alert', text: 'Arrow or right click: choose from the list' },
        { mark: 'alert', text: 'Touch: long press any element for its help' }
      ]
    });
    this._button.setAttribute('aria-label', tip);
    this.element.classList.toggle('tez-disp-off', this._mode === 'off');
    if (this._menu.hidden !== true) this.buildItems();
  }
}
