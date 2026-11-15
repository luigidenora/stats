import { afterEach, describe, expect, it, vi } from 'vitest';
import { Diagnostics, type DiagnosticRule } from '../src/diagnostics.js';
import { makeContext, makeSurvey } from './helpers.js';

/** A frame rule driven by a flag the test flips. */
function switchRule(id = 'flag'): { rule: DiagnosticRule; set: (on: boolean, message?: string) => void } {
  let on = false;
  let message = 'wrong';
  return {
    rule: { id, title: id.toUpperCase(), check: () => (on ? { message, advice: 'fix it' } : null) },
    set: (value, text = 'wrong') => {
      on = value;
      message = text;
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Diagnostics', () => {
  it('shows a frame finding after two failing checks and hides it after three passing ones', () => {
    const { rule, set } = switchRule();
    const diagnostics = new Diagnostics([rule]);
    const context = makeContext();
    set(true);
    expect(diagnostics.evaluate(context, 'frame')).toBe(false);
    expect(diagnostics.findings()).toEqual([]);
    expect(diagnostics.evaluate(context, 'frame')).toBe(true);
    expect(diagnostics.findings()).toEqual([{ id: 'flag', title: 'FLAG', message: 'wrong', advice: 'fix it' }]);

    set(false);
    expect(diagnostics.evaluate(context, 'frame')).toBe(false);
    expect(diagnostics.evaluate(context, 'frame')).toBe(false);
    expect(diagnostics.findings()).toHaveLength(1);
    expect(diagnostics.evaluate(context, 'frame')).toBe(true);
    expect(diagnostics.findings()).toEqual([]);
  });

  it('does not flash on a single noisy second', () => {
    const { rule, set } = switchRule();
    const diagnostics = new Diagnostics([rule]);
    for (let i = 0; i < 10; i++) {
      set(i % 2 === 0);
      diagnostics.evaluate(makeContext(), 'frame');
    }

    expect(diagnostics.findings()).toEqual([]);
  });

  it('reports a change when an active finding updates its numbers', () => {
    const { rule, set } = switchRule();
    const diagnostics = new Diagnostics([rule]);
    set(true, '10 calls');
    diagnostics.evaluate(makeContext(), 'frame');
    diagnostics.evaluate(makeContext(), 'frame');
    set(true, '12 calls');
    expect(diagnostics.evaluate(makeContext(), 'frame')).toBe(true);
    expect(diagnostics.findings()[0].message).toBe('12 calls');
    expect(diagnostics.evaluate(makeContext(), 'frame')).toBe(false);
  });

  it('runs scene rules only in the scene scope, only with a survey, and switches them at once', () => {
    const check = vi.fn(() => ({ message: 'heavy', advice: 'lighter' }));
    const diagnostics = new Diagnostics([{ id: 'heavy', title: 'Heavy', scope: 'scene', check }]);
    diagnostics.evaluate(makeContext({ scene: makeSurvey() }), 'frame');
    diagnostics.evaluate(makeContext(), 'scene');
    expect(check).not.toHaveBeenCalled();

    expect(diagnostics.evaluate(makeContext({ scene: makeSurvey() }), 'scene')).toBe(true);
    expect(diagnostics.findings()).toHaveLength(1);
    check.mockReturnValue(null as never);
    expect(diagnostics.evaluate(makeContext({ scene: makeSurvey() }), 'scene')).toBe(true);
    expect(diagnostics.findings()).toEqual([]);
  });

  it('clears scene findings when the scene goes away', () => {
    const diagnostics = new Diagnostics([{ id: 'heavy', title: 'Heavy', scope: 'scene', check: () => ({ message: 'heavy', advice: 'lighter' }) }]);
    diagnostics.evaluate(makeContext({ scene: makeSurvey() }), 'scene');
    expect(diagnostics.findings()).toHaveLength(1);
    expect(diagnostics.evaluate(makeContext({ scene: null }), 'scene')).toBe(true);
    expect(diagnostics.findings()).toEqual([]);
  });

  it('skips disabled rules everywhere', () => {
    const { rule, set } = switchRule('noisy');
    const diagnostics = new Diagnostics([rule], ['noisy']);
    set(true);
    diagnostics.evaluate(makeContext(), 'frame');
    diagnostics.evaluate(makeContext(), 'frame');
    expect(diagnostics.findings()).toEqual([]);
    expect(diagnostics.report()).toEqual([]);
  });

  it('replaces a rule with the same id and removes rules by id', () => {
    const diagnostics = new Diagnostics([{ id: 'a', title: 'Old', check: () => null }]);
    diagnostics.add({ id: 'a', title: 'New', check: () => null });
    expect(diagnostics.report().map((entry) => entry.title)).toEqual(['New']);
    diagnostics.remove('a');
    expect(diagnostics.report()).toEqual([]);
  });

  it('rejects invalid rules with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const diagnostics = new Diagnostics([]);
    expect(diagnostics.add({ id: '', title: 'x', check: () => null })).toBe(false);
    expect(diagnostics.add({ id: 'x', title: 'x' } as unknown as DiagnosticRule)).toBe(false);
    expect(diagnostics.report()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('switches off a rule that keeps throwing, warning once, and keeps the others running', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = vi.fn(() => {
      throw new Error('boom');
    });
    const { rule, set } = switchRule('fine');
    const diagnostics = new Diagnostics([{ id: 'broken', title: 'Broken', check: broken }, rule]);
    set(true);
    for (let i = 0; i < 8; i++) diagnostics.evaluate(makeContext(), 'frame');
    expect(broken).toHaveBeenCalledTimes(5);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('"broken"'))).toHaveLength(1);
    expect(diagnostics.findings().map((finding) => finding.id)).toEqual(['fine']);
    expect(diagnostics.report().map((entry) => entry.id)).toEqual(['fine']);
  });

  it('reports every rule as unchecked, ok or warn', () => {
    const { rule, set } = switchRule('warns');
    const diagnostics = new Diagnostics([rule, { id: 'ok', title: 'OK', check: () => null }, { id: 'later', title: 'Later', scope: 'scene', check: () => null }]);
    set(true);
    diagnostics.evaluate(makeContext(), 'frame');
    diagnostics.evaluate(makeContext(), 'frame');
    expect(diagnostics.report().map((entry) => [entry.id, entry.status])).toEqual([['warns', 'warn'], ['ok', 'ok'], ['later', 'unchecked']]);
  });

  it('drops the finding of a rule that was active when it started throwing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let throws = false;
    const diagnostics = new Diagnostics([{ id: 'flaky', title: 'Flaky', check: () => {
      if (throws) throw new Error('boom');
      return { message: 'x', advice: 'y' };
    } }]);
    diagnostics.evaluate(makeContext(), 'frame');
    diagnostics.evaluate(makeContext(), 'frame');
    expect(diagnostics.findings()).toHaveLength(1);
    throws = true;
    let changed = false;
    for (let i = 0; i < 5; i++) changed = diagnostics.evaluate(makeContext(), 'frame') || changed;
    expect(changed).toBe(true);
    expect(diagnostics.findings()).toEqual([]);
  });

  it('reports a change when add() replaces an active rule', () => {
    const diagnostics = new Diagnostics([{ id: 'a', title: 'A', check: () => ({ message: 'x', advice: 'y' }) }]);
    diagnostics.evaluate(makeContext(), 'frame');
    diagnostics.evaluate(makeContext(), 'frame');
    expect(diagnostics.findings()).toHaveLength(1);
    diagnostics.add({ id: 'a', title: 'A2', check: () => null });
    expect(diagnostics.findings()).toEqual([]);
  });

  it('reads a check that returns undefined or a malformed finding as fine, with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const diagnostics = new Diagnostics([
      { id: 'forgot', title: 'Forgot', check: (() => undefined) as never },
      { id: 'shape', title: 'Shape', check: (() => ({ text: 'no message' })) as never }
    ]);
    for (let i = 0; i < 4; i++) diagnostics.evaluate(makeContext(), 'frame');
    expect(diagnostics.findings()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
