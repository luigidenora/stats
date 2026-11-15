/** Toggle plates next to the mode plate, defined by the page (e.g. a LOD colour view). */

import { warnOnce } from './custom.js';
import { setTip } from './tooltip.js';
import type { ControlDefinition } from './types.js';

export class Toggle {
  public readonly element: HTMLButtonElement;
  private _active: boolean;

  constructor(public readonly definition: ControlDefinition) {
    this._active = definition.active ?? false;
    this.element = document.createElement('button');
    this.element.type = 'button';
    this.element.className = 'tez-plate tez-toggle tez-hit';
    if (definition.tip === undefined) this.element.dataset['tip'] = definition.description;
    else setTip(this.element, definition.tip);
    const text = document.createElement('span');
    text.textContent = definition.label;
    this.element.append(text);
    this.element.addEventListener('click', this.onClick);
    this.render();
  }

  public get active(): boolean { return this._active; }

  /** Sets the state from code; calls onChange like a click would. */
  public set active(active: boolean) {
    if (active === this._active) return;
    this._active = active;
    this.render();
    this.notify();
  }

  public dispose(): void {
    this.element.removeEventListener('click', this.onClick);
    this.element.remove();
  }

  private readonly onClick = (): void => {
    this.active = !this._active;
  };

  private notify(): void {
    try {
      this.definition.onChange(this._active);
    } catch (error) {
      warnOnce(`control "${this.definition.id}" onChange threw (${String(error)}).`);
    }
  }

  private render(): void {
    this.element.setAttribute('aria-pressed', String(this._active));
    this.element.setAttribute('aria-label', `${this.definition.description} (${this._active ? 'on' : 'off'})`);
  }
}

/** Returns why a control definition is invalid, or null. */
export function checkControl(control: ControlDefinition): string | null {
  if (typeof control.id !== 'string' || control.id === '') return 'a control needs a non-empty string id.';
  if (typeof control.onChange !== 'function') return `control "${control.id}": onChange must be a function.`;
  if (typeof control.label !== 'string' || control.label.length === 0 || control.label.length > 5) return `control "${control.id}": label must be 1 to 5 characters.`;
  return null;
}
