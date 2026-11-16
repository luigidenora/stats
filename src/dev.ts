/**
 * `@three.ez/stats/dev`: the overlay in development, a no-op in production builds.
 *
 * The package maps this entry to `noop.js` under the `production` export condition, which Vite
 * and webpack set from the build mode. Call sites stay as they are; a production bundle carries a
 * few hundred bytes instead of the overlay. Use the main entry to keep the overlay in production.
 */

export { Stats, type StatsOptions } from './stats.js';
export type { StatsMode, StatsMetric, GraphDefinition, DistributionDefinition, ModeContent, ModeDefinition, ControlDefinition, HistogramDefinition, TipContent } from './types.js';
export type { StatsReport } from './recorder.js';
export type { StatsSnapshot } from './snapshot.js';
export type { Pressure } from './pressure.js';
