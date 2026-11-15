/**
 * Device profiles and their budgets: the limits counters turn yellow at and diagnostics compare
 * against. The numbers are industry rules of thumb for WebGL / WebGPU scenes, not specifications;
 * every limit can be overridden with `budgets`.
 */

export type DeviceProfile = 'mobile' | 'desktop';

export interface Budgets {
  /** Draw calls per frame. */
  calls: number;
  /** Triangles drawn per frame. */
  triangles: number;
  /** Renderer pixel ratio. */
  pixelRatio: number;
  /** Estimated texture memory, in MB. */
  textureMB: number;
  /** Dynamic lights (forward shading loops over all of them per fragment). */
  lights: number;
  /** Lights that cast shadows. */
  shadowLights: number;
  /** Largest shadow map side, in px. */
  shadowMapSize: number;
}

export const PROFILE_BUDGETS: Readonly<Record<DeviceProfile, Readonly<Budgets>>> = {
  mobile: { calls: 250, triangles: 750_000, pixelRatio: 2, textureMB: 256, lights: 4, shadowLights: 1, shadowMapSize: 2048 },
  desktop: { calls: 1000, triangles: 3_000_000, pixelRatio: 2, textureMB: 512, lights: 8, shadowLights: 3, shadowMapSize: 4096 }
};

/** What profile detection looks at; injectable for tests. */
export interface DeviceHints {
  /** `(pointer: coarse)` matches: the main input is a finger. */
  coarse: boolean;
  /** Shorter side of the screen, in CSS px. */
  shortSide: number;
  userAgent: string;
}

export function deviceHints(): DeviceHints {
  return {
    coarse: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    shortSide: typeof screen === 'undefined' ? Infinity : Math.min(screen.width, screen.height),
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent
  };
}

/** Phones and tablets: a finger as the main input on a small screen, or a mobile user agent. */
export function detectProfile(hints: DeviceHints): DeviceProfile {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(hints.userAgent)) return 'mobile';
  return hints.coarse && hints.shortSide < 900 ? 'mobile' : 'desktop';
}

/** The profile in use and its budgets, with page overrides applied (negative or non-finite overrides are ignored). */
export function resolveBudgets(profile: 'auto' | DeviceProfile, overrides: Partial<Budgets> = {}, hints?: DeviceHints): { profile: DeviceProfile; budgets: Budgets } {
  // Anything but a known profile (a typo in plain JavaScript) detects, rather than leaving no budgets.
  const resolved = profile === 'mobile' || profile === 'desktop' ? profile : detectProfile(hints ?? deviceHints());
  const budgets: Budgets = { ...PROFILE_BUDGETS[resolved] };
  // Only known budgets: a typo in plain JavaScript must not add a key nothing reads.
  const keys = Object.keys(budgets) as (keyof Budgets)[];
  for (let i = 0, l = keys.length; i < l; i++) {
    const value = overrides[keys[i]];
    // Zero is a valid budget (e.g. no shadow casters on mobile).
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) budgets[keys[i]] = value;
  }

  return { profile: resolved, budgets };
}
