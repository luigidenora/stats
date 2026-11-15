import { describe, expect, it } from 'vitest';
import { detectProfile, PROFILE_BUDGETS, resolveBudgets, type DeviceHints } from '../src/budgets.js';

const DESKTOP: DeviceHints = { coarse: false, shortSide: 1080, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140' };
const PHONE: DeviceHints = { coarse: true, shortSide: 390, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' };

describe('detectProfile', () => {
  it('reads a mobile user agent as mobile, whatever the screen', () => {
    expect(detectProfile(PHONE)).toBe('mobile');
    expect(detectProfile({ ...DESKTOP, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' })).toBe('mobile');
  });

  it('reads a finger on a small screen as mobile, even with a desktop user agent (iPadOS)', () => {
    expect(detectProfile({ ...DESKTOP, coarse: true, shortSide: 820 })).toBe('mobile');
  });

  it('keeps large touch screens and mouse-driven small windows on desktop', () => {
    expect(detectProfile({ ...DESKTOP, coarse: true, shortSide: 1200 })).toBe('desktop');
    expect(detectProfile({ ...DESKTOP, coarse: false, shortSide: 500 })).toBe('desktop');
    expect(detectProfile({ ...DESKTOP, coarse: true, shortSide: 900 })).toBe('desktop');
  });
});

describe('resolveBudgets', () => {
  it('uses the named profile and leaves the shared table untouched', () => {
    const { profile, budgets } = resolveBudgets('mobile');
    expect(profile).toBe('mobile');
    expect(budgets).toEqual(PROFILE_BUDGETS.mobile);
    budgets.calls = 1;
    expect(PROFILE_BUDGETS.mobile.calls).toBe(250);
  });

  it('detects the profile on auto from the hints', () => {
    expect(resolveBudgets('auto', {}, PHONE).profile).toBe('mobile');
    expect(resolveBudgets('auto', {}, DESKTOP).profile).toBe('desktop');
  });

  it('applies valid overrides, zero included, and ignores non-finite or negative ones', () => {
    const { budgets } = resolveBudgets('desktop', { calls: 500, triangles: Number.NaN, lights: 0, shadowLights: -1, textureMB: Infinity });
    expect(budgets.calls).toBe(500);
    expect(budgets.triangles).toBe(PROFILE_BUDGETS.desktop.triangles);
    expect(budgets.lights).toBe(0);
    expect(budgets.shadowLights).toBe(PROFILE_BUDGETS.desktop.shadowLights);
    expect(budgets.textureMB).toBe(PROFILE_BUDGETS.desktop.textureMB);
  });

  it('ignores keys that are not budgets', () => {
    const { budgets } = resolveBudgets('desktop', { bogus: 3 } as never);
    expect(Object.keys(budgets).sort()).toEqual(Object.keys(PROFILE_BUDGETS.desktop).sort());
  });

  it('treats an unknown profile name as auto instead of leaving the budgets empty', () => {
    const { profile, budgets } = resolveBudgets('tablet' as never, {}, PHONE);
    expect(profile).toBe('mobile');
    expect(budgets).toEqual(PROFILE_BUDGETS.mobile);
  });
});
