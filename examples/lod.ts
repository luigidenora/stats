/**
 * LOD statistics, measured outside the library and plugged in through the Stats API.
 * This is the pattern for any project-specific statistic: measure it in your code,
 * then describe it declaratively with defineMode() or extendMode().
 *
 * What an engineer tuning LOD needs at a glance:
 * - objects per level (the vertical LOD LVL bar on the right edge);
 * - switches per second, split by direction: towards coarser levels above the middle line,
 *   towards finer levels below. Symmetric spikes while the camera stands still mean objects
 *   oscillate on a threshold (popping): add hysteresis;
 * - the share of objects within ±10% of a switching distance: popping risk before it shows;
 * - triangles saved compared with drawing everything at L0, as a top-right value;
 * - a large histogram of on-screen size per level (L0 red, L1 green, L2 blue): where two levels
 *   cover the same sizes, distance-based LOD is ignoring object size (an L0 at 3 px wastes triangles).
 *
 * Three levels on purpose: light has three channels, so each level gets one.
 */

import type * as THREE_NS from 'three';
import type { GlyphSpec, Stats } from '../src/index.js';

type Three = typeof THREE_NS;

/** Detail per level: icosahedron subdivisions, from fine (L0) to coarse (L2). */
const DETAILS = [4, 1, 0];
const DISTANCES = [0, 5, 9];
/** Hysteresis per level, as a share of its distance: a little overlap between levels. */
/** three.js reads hysteresis as a fraction of each level's distance: 8% here. */
const HYSTERESIS = 0.08;
/** Object sizes vary, so on-screen size and distance disagree: the case the histogram exposes. */
const RADII = [0.12, 0.22, 0.4];
/** "Near a threshold": within this share of the switching distance. */
const NEAR = 0.1;
/** Level colours for the LOD colour view, as in the histogram: L0 red (full detail), L1 green, L2 blue (coarsest). */
const LEVEL_COLORS = [0xff3b30, 0x2ee84a, 0x4f7dff];

const circle = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;

/** Custom glyph for the counter grid: one object at three levels of detail, large to small. */
export const LOD_GLYPH: GlyphSpec = {
  category: 'frame',
  label: 'LOD objects at full detail',
  base: [{ d: `${circle(4.5, 11, 3.5)}${circle(10.6, 8.5, 2.3)}${circle(14, 6.2, 1.3)}` }]
};

export class LodField {
  public readonly group: THREE_NS.Group;
  public camera: THREE_NS.Camera | null = null;
  private readonly _lods: THREE_NS.LOD[] = [];
  private readonly _levelTriangles: number[] = [];
  /** Level of each object at the previous frame (no allocation per frame). */
  private readonly _previous: Int8Array;
  private _measured = false;
  private _toCoarser = 0;
  private _toFiner = 0;
  private _since = performance.now();
  private readonly _cameraPosition: THREE_NS.Vector3;
  private readonly _objectPosition: THREE_NS.Vector3;
  private readonly _material: THREE_NS.Material;
  private readonly _levelMaterials: THREE_NS.Material[];
  /** On-screen diameter in px per level, refilled at each refresh (no allocation). */
  private readonly _sizes: Float32Array[];
  private readonly _sizeCounts: number[];
  public viewportHeight = 1;

  constructor(THREE: Three, count = 160) {
    this.group = new THREE.Group();
    this._previous = new Int8Array(count);
    this._cameraPosition = new THREE.Vector3();
    this._objectPosition = new THREE.Vector3();
    const material = new THREE.MeshStandardMaterial({ color: 0xe3e6df, roughness: 0.4, flatShading: true });
    this._material = material;
    this._levelMaterials = LEVEL_COLORS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, flatShading: true }));
    const geometries = DETAILS.map((detail) => new THREE.IcosahedronGeometry(1, detail));
    this._sizes = DETAILS.map(() => new Float32Array(count));
    this._sizeCounts = DETAILS.map(() => 0);
    for (const geometry of geometries) this._levelTriangles.push(geometry.index === null ? geometry.attributes['position'].count / 3 : geometry.index.count / 3);

    for (let i = 0; i < count; i++) {
      const lod = new THREE.LOD();
      geometries.forEach((geometry, level) => lod.addLevel(new THREE.Mesh(geometry, material), DISTANCES[level], HYSTERESIS));
      lod.scale.setScalar(RADII[i % RADII.length]);
      const angle = (i / count) * Math.PI * 2;
      const radius = 1.5 + (i % 8) * 0.9;
      lod.position.set(Math.cos(angle) * radius, 0.6 + Math.sin(i * 1.7) * 0.4, Math.sin(angle) * radius);
      this.group.add(lod);
      this._lods.push(lod);
    }
  }

  /** Colour each object by its LOD level (on) or back to its normal look (off). */
  public setColored(on: boolean): void {
    for (const lod of this._lods) {
      lod.levels.forEach((level, index) => {
        (level.object as THREE_NS.Mesh).material = on ? this._levelMaterials[index] : this._material;
      });
    }
  }

  /** Objects currently at full detail (L0). */
  public fullDetail(): number | null {
    if (!this._measured) return null;
    let count = 0;
    for (let i = 0, l = this._previous.length; i < l; i++) if (this._previous[i] === 0) count++;
    return count;
  }

  /** Call after rendering: counts level changes since the previous frame, by direction. */
  public afterRender(): void {
    for (let i = 0, l = this._lods.length; i < l; i++) {
      const level = this._lods[i].getCurrentLevel();
      if (this._measured && level !== this._previous[i]) {
        if (level > this._previous[i]) this._toCoarser++;
        else this._toFiner++;
      }

      this._previous[i] = level;
    }

    this._measured = true;
  }

  /** Objects per LOD level, L0..Ln. */
  public countsPerLevel(): number[] | null {
    if (!this._measured) return null;
    const counts = DETAILS.map(() => 0);
    for (let i = 0, l = this._previous.length; i < l; i++) counts[this._previous[i]]++;
    return counts;
  }

  /** Share of triangles saved compared with drawing every object at L0. */
  public savedPercent(): number | null {
    if (!this._measured) return null;
    const full = this._levelTriangles[0] * this._lods.length;
    let drawn = 0;
    for (let i = 0, l = this._previous.length; i < l; i++) drawn += this._levelTriangles[this._previous[i]];
    return (1 - drawn / full) * 100;
  }

  /**
   * On-screen diameter in px of the objects at `level`. Level 0 refreshes the measurements for
   * every level, so read level 0 first (the histogram reads channels in order).
   */
  public screenSizes(level: number): Float32Array | null {
    const camera = this.camera as THREE_NS.PerspectiveCamera | null;
    if (camera === null || !this._measured) return null;
    if (level === 0) {
      camera.getWorldPosition(this._cameraPosition);
      const focal = this.viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
      this._sizeCounts.fill(0);
      for (let i = 0, l = this._lods.length; i < l; i++) {
        const lod = this._lods[i];
        const distance = Math.max(0.01, this._cameraPosition.distanceTo(lod.getWorldPosition(this._objectPosition)));
        const at = this._previous[i];
        this._sizes[at][this._sizeCounts[at]++] = ((2 * lod.scale.x) / distance) * focal;
      }
    }

    return this._sizes[level].subarray(0, this._sizeCounts[level]);
  }

  /** Switches towards coarser levels per second, since the last call. */
  public coarserPerSecond(): number {
    return this.rate(this._toCoarser);
  }

  /** Switches towards finer levels per second, over the same window as coarserPerSecond(). */
  public finerPerSecond(): number {
    const rate = this.rate(this._toFiner);
    // Both directions read at the same refresh: reset the window after the second one.
    this._toCoarser = 0;
    this._toFiner = 0;
    this._since = performance.now();
    return rate;
  }

  /** Share of objects within ±10% of one of their switching distances (popping risk). */
  public nearThresholdPercent(): number | null {
    const camera = this.camera;
    if (camera === null || this._lods.length === 0) return null;
    camera.getWorldPosition(this._cameraPosition);
    const zoom = (camera as Partial<THREE_NS.PerspectiveCamera>).zoom ?? 1;
    let near = 0;
    for (let i = 0, l = this._lods.length; i < l; i++) {
      const lod = this._lods[i];
      const distance = this._cameraPosition.distanceTo(lod.getWorldPosition(this._objectPosition)) / zoom;
      for (let k = 1, kl = lod.levels.length; k < kl; k++) {
        const threshold = lod.levels[k].distance;
        if (Math.abs(distance - threshold) <= threshold * NEAR) {
          near++;
          break;
        }
      }
    }

    return (near / this._lods.length) * 100;
  }

  private rate(count: number): number {
    return (count * 1000) / Math.max(1, performance.now() - this._since);
  }
}

/** Adds a 'lod' display mode to the mode plate. Everything here is plain declarative data. */
export function addLodMode(stats: Stats, field: LodField): void {
  // A counter with a custom glyph, beside the built-in ones in every mode.
  stats.addMetric({ id: 'lod.full', label: 'LOD objects at full detail (L0)', glyph: LOD_GLYPH, read: () => field.fullDetail() });

  stats.defineMode({
    id: 'lod',
    name: 'Level of detail',
    code: 'LOD',
    description: 'Objects per LOD level, switches per second by direction and objects near a threshold.',
    histogram: {
      id: 'lod.px',
      label: ['LOD', 'PX'],
      unit: 'px',
      domain: { min: 2, max: 400, log: true },
      channels: [
        { name: 'L0', read: () => field.screenSizes(0) },
        { name: 'L1', read: () => field.screenSizes(1) },
        { name: 'L2', read: () => field.screenSizes(2) }
      ],
      description: 'On-screen size of objects per LOD level (log scale): red L0, green L1, blue L2. '
        + 'Where colours overlap, two levels are used for the same size: distance-based LOD ignores object size.'
    },
    graphs: [
      {
        id: 'lod.switches',
        label: ['LOD', 'SW/S'],
        scale: 'auto',
        unit: 'sw/s',
        read: () => field.coarserPerSecond(),
        readBelow: () => field.finerPerSecond(),
        description: 'LOD switches per second: above the middle line towards coarser levels, below towards finer ones. '
          + 'Symmetric spikes while the camera stands still mean objects oscillate on a threshold: add hysteresis.'
      },
      {
        id: 'lod.near',
        label: ['NEAR', 'BND %'],
        scale: 'auto',
        unit: '%',
        read: () => field.nearThresholdPercent(),
        description: 'Share of objects within ±10% of a LOD switching distance. When it is high, a small camera move '
          + 'switches many objects at once: spread the thresholds or rearrange the scene.'
      }
    ],
    // A toggle next to the mode plate, shown only in this mode.
    controls: [
      { id: 'lod.color', label: 'COLOR', description: 'Colour objects by LOD level: red L0 (full detail), green L1, blue L2 (coarsest), as in the histogram.', onChange: (on) => { field.setColored(on); } }
    ],
    metrics: [
      { id: 'lod.saved', label: 'Triangles saved by LOD, compared with drawing everything at L0', place: 'top', plate: 'SAVE', unit: '%', width: 3, read: () => field.savedPercent(), format: (v) => String(Math.round(v)), threshold: { below: 30 } }
    ],
    distribution: {
      id: 'lod.levels',
      label: ['LOD', 'LVL'],
      read: () => field.countsPerLevel(),
      description: 'Objects at each LOD level, L0 (full detail) to L2 (coarsest)'
    }
  });
}
