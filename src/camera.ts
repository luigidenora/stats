/** The subset of a three.js camera the overlay reads: the INFO Camera page and the depth precision check. */
export interface InfoCamera {
  type?: string | undefined;
  isPerspectiveCamera?: boolean | undefined;
  isOrthographicCamera?: boolean | undefined;
  /** Vertical field of view in degrees (perspective cameras). */
  fov?: number | undefined;
  aspect?: number | undefined;
  zoom?: number | undefined;
  near: number;
  far: number;
  position: { x: number; y: number; z: number };
}

/** Focal length of a full-frame (36 × 24 mm) lens with this vertical field of view, in mm. */
export function focalLength35(fov: number): number {
  return 12 / Math.tan((fov * Math.PI) / 360);
}
