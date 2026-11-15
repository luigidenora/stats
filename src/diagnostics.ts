/**
 * Diagnostics: small rules that look at what the overlay already measures and say, in one line,
 * what is wrong and what to do about it. Frame rules run once a second; scene rules run on the
 * scene survey (at most every few seconds, only with a `scene`).
 *
 * A finding needs two failing checks in a row to appear and three passing ones to go, so a single
 * noisy second never flashes a tip. A rule that throws is switched off after five failures.
 */

import { warnOnce } from './custom.js';
import type { Budgets, DeviceProfile } from './budgets.js';
import type { SceneSurvey } from './scene-survey.js';

/** Everything a rule can read. Values are null when this backend or browser cannot measure them. */
export interface DiagnosticContext {
  /** Frame budget, in ms. */
  budget: number;
  budgets: Budgets;
  profile: DeviceProfile;
  /** Seconds since the overlay started: warm-up rules can wait. */
  uptime: number;
  fps: number | null;
  cpu: number | null;
  gpu: number | null;
  p95: number | null;
  dropped: number | null;
  /** Standard deviation of frame intervals, in ms. */
  jitter: number | null;
  /** Long animation frame blocking time per second, in ms (Chromium). */
  blocking: number | null;
  calls: number;
  triangles: number;
  /** Line and point primitives drawn in the last frame: draw calls that are not small meshes. */
  lines: number;
  points: number;
  /** Render passes in the last frame (WebGPU `info.render.frameCalls`). */
  passes: number | null;
  programs: number | null;
  /** Shader programs created in the last 10 s (after warm-up). */
  recentPrograms: number;
  /** Growth over the last 30 s, or null while the history is shorter. */
  geometryGrowth: number | null;
  textureGrowth: number | null;
  /** Heap drops of more than 10% (garbage collections) per second, over the last 10 s. */
  gcRate: number | null;
  pixelRatio: number | null;
  /** Drawing buffer pixels and the display pixels it is shown on. */
  bufferPixels: number;
  displayPixels: number;
  contextLost: number;
  /** `renderer.shadowMap.enabled`, or null when the renderer does not say. */
  shadowMapEnabled: boolean | null;
  scene: SceneSurvey | null;
}

export interface DiagnosticFinding {
  /** What is wrong, with the numbers. */
  message: string;
  /** What to do about it. */
  advice: string;
}

export interface DiagnosticRule {
  /** Unique id, e.g. 'gpu-bound'. Turn rules off with `rules: ['gpu-bound']`. */
  id: string;
  /** Short name, e.g. 'GPU-bound'. */
  title: string;
  /** 'frame' rules run every second, 'scene' rules on the scene survey. Default 'frame'. */
  scope?: 'frame' | 'scene';
  /** Returns a finding when something is wrong, null when it is fine. */
  check: (context: DiagnosticContext) => DiagnosticFinding | null;
}

export interface ActiveFinding extends DiagnosticFinding {
  id: string;
  title: string;
}

interface RuleState {
  rule: DiagnosticRule;
  failing: number;
  passing: number;
  errors: number;
  active: DiagnosticFinding | null;
  /** Evaluated at least once (for the Diagnostics page: "ok" vs not checked yet). */
  checked: boolean;
}

const SHOW_AFTER = 2;
const HIDE_AFTER = 3;
const MAX_ERRORS = 5;

export class Diagnostics {
  private readonly _states: RuleState[] = [];
  private readonly _disabled: Set<string>;

  constructor(rules: readonly DiagnosticRule[], disabled: readonly string[] = []) {
    this._disabled = new Set(disabled);
    for (let i = 0, l = rules.length; i < l; i++) this.add(rules[i]);
  }

  /** Adds a rule; one with the same id replaces it. Invalid rules are skipped with a warning. */
  public add(rule: DiagnosticRule): boolean {
    if (typeof rule.id !== 'string' || rule.id === '' || typeof rule.check !== 'function' || typeof rule.title !== 'string') {
      warnOnce('a diagnostic rule needs an id, a title and a check function.');
      return false;
    }

    this.remove(rule.id);
    this._states.push({ rule, failing: 0, passing: 0, errors: 0, active: null, checked: false });
    return true;
  }

  public remove(id: string): void {
    for (let i = 0, l = this._states.length; i < l; i++) {
      if (this._states[i].rule.id === id) {
        this._states.splice(i, 1);
        return;
      }
    }
  }

  /** Runs the rules of one scope. Returns true when an active finding appeared, went or changed its text. */
  public evaluate(context: DiagnosticContext, scope: 'frame' | 'scene'): boolean {
    let changed = false;
    for (let i = 0, l = this._states.length; i < l; i++) {
      const state = this._states[i];
      if ((state.rule.scope ?? 'frame') !== scope || this._disabled.has(state.rule.id) || state.errors >= MAX_ERRORS) continue;
      if (scope === 'scene' && context.scene === null) {
        // No scene any more: its findings go with it.
        if (state.active !== null) changed = true;
        state.active = null;
        state.failing = 0;
        state.passing = 0;
        continue;
      }

      let finding: DiagnosticFinding | null;
      try {
        finding = state.rule.check(context);
      } catch (error) {
        state.errors++;
        if (state.errors >= MAX_ERRORS) {
          warnOnce(`diagnostic rule "${state.rule.id}" threw ${MAX_ERRORS} times and was switched off (${String(error)}).`);
          // A switched-off rule cannot keep a finding nobody will ever clear.
          if (state.active !== null) changed = true;
          state.active = null;
        }

        continue;
      }

      state.checked = true;
      const before = state.active;
      if (finding !== null) {
        state.failing++;
        state.passing = 0;
        // Scene rules run rarely and on stable data: they show at once. An active finding keeps its numbers current.
        if (state.active !== null || state.failing >= (scope === 'scene' ? 1 : SHOW_AFTER)) state.active = finding;
      } else {
        state.passing++;
        state.failing = 0;
        if (state.passing >= (scope === 'scene' ? 1 : HIDE_AFTER)) state.active = null;
      }

      if (!sameFinding(before, state.active)) changed = true;
    }

    return changed;
  }

  /** Active findings, in rule order. */
  public findings(): ActiveFinding[] {
    const out: ActiveFinding[] = [];
    for (let i = 0, l = this._states.length; i < l; i++) {
      const state = this._states[i];
      if (state.active !== null && !this._disabled.has(state.rule.id)) out.push({ id: state.rule.id, title: state.rule.title, ...state.active });
    }

    return out;
  }

  /** Every enabled rule with its state, for the Diagnostics page. */
  public report(): { id: string; title: string; status: 'ok' | 'warn' | 'unchecked'; finding: DiagnosticFinding | null }[] {
    const out: { id: string; title: string; status: 'ok' | 'warn' | 'unchecked'; finding: DiagnosticFinding | null }[] = [];
    for (let i = 0, l = this._states.length; i < l; i++) {
      const state = this._states[i];
      if (this._disabled.has(state.rule.id) || state.errors >= MAX_ERRORS) continue;
      out.push({ id: state.rule.id, title: state.rule.title, status: state.active !== null ? 'warn' : state.checked ? 'ok' : 'unchecked', finding: state.active });
    }

    return out;
  }
}

function sameFinding(a: DiagnosticFinding | null, b: DiagnosticFinding | null): boolean {
  if (a === null || b === null) return a === b;
  return a.message === b.message && a.advice === b.advice;
}
