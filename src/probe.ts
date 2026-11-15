/**
 * `@three.ez/stats/probe`: pick an object, move it, read its coordinates.
 *
 * For placing things: a click on the canvas selects the object under the pointer and shows a
 * translate gizmo; rows show its name and local position, live while dragging; `C` copies
 * `object.position.set(x, y, z)` ready to paste into code.
 *
 * It imports three.js and changes the scene (the gizmo is an object in it, and dragging moves the
 * selection), which is why it is an add-on and not part of the read-only overlay. While it is on,
 * the gizmo adds a few draw calls to the counters.
 */

import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Stats } from './stats.js';

export interface ProbeOptions {
  /** Objects under this root can be picked. */
  scene: Object3D;
  camera: Camera;
  /** The renderer, for its canvas. */
  renderer: { domElement: HTMLElement };
  /** Camera controls to switch off while dragging, e.g. OrbitControls. */
  controls?: { enabled: boolean };
  /** Called when the selection changes. */
  onSelect?: (object: Object3D | null) => void;
  /** Called while the selection is dragged. */
  onMove?: (object: Object3D) => void;
}

export interface Probe {
  /** The probe is on: clicks pick objects. Same as the PROBE plate. */
  active: boolean;
  /** The picked object, or null. */
  readonly selected: Object3D | null;
  /** Selects an object from code (null clears the selection). */
  select: (object: Object3D | null) => void;
  /** Copies `object.position.set(x, y, z);` for the selection to the clipboard and returns it; null without a selection. */
  copy: () => string | null;
  /** Removes the plate, the rows, the gizmo and every listener. */
  dispose: () => void;
}

/** A pointer that moves farther than this between down and up is a camera drag, not a click. */
const CLICK_SLOP = 5;
const ROWS = ['probe.object', 'probe.x', 'probe.y', 'probe.z', 'probe.distance'];

/** Three decimals, without trailing zeros: 1.5, -0.125, 12. */
export function formatCoordinate(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** `object.position.set(x, y, z);` for pasting into code. */
export function positionCode(object: { position: { x: number; y: number; z: number } }): string {
  const { x, y, z } = object.position;
  return `object.position.set(${formatCoordinate(x)}, ${formatCoordinate(y)}, ${formatCoordinate(z)});`;
}

/** What a click on `object` selects: a level of a LOD stands for the whole LOD. */
function target(object: Object3D): Object3D {
  let current = object;
  while (current.parent !== null && (current.parent as { isLOD?: boolean }).isLOD === true) current = current.parent;
  return current;
}

/** Adds the PROBE plate to a Stats overlay. */
export function addProbe(stats: Stats, options: ProbeOptions): Probe {
  const { scene, camera, renderer } = options;
  const canvas = renderer.domElement;
  const gizmo = new TransformControls(camera, canvas);
  const helper = gizmo.getHelper();
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const world = new Vector3();
  const eye = new Vector3();
  let active = false;
  let selected: Object3D | null = null;
  let down: { x: number; y: number } | null = null;
  let dragged = false;

  const inGizmo = (object: Object3D): boolean => {
    for (let current: Object3D | null = object; current !== null; current = current.parent) {
      if (current === helper) return true;
    }

    return false;
  };

  const coordinate = (axis: 'x' | 'y' | 'z') => (): number | null => (selected === null ? null : selected.position[axis]);
  const showRows = (): void => {
    const format = (value: number): string => value.toFixed(2);
    stats.addMetric({
      id: ROWS[0], label: 'Picked object: its name, or its type when it has none. Click an object on the canvas to pick it.', place: 'top', plate: 'OBJ', width: 10,
      read: () => (selected === null ? null : selected.id),
      format: () => (selected === null ? '' : (selected.name !== '' ? selected.name : selected.type).slice(0, 10))
    });
    stats.addMetric({ id: ROWS[1], label: 'Local X of the picked object. Press C to copy position.set(x, y, z).', place: 'top', plate: 'X', width: 7, read: coordinate('x'), format });
    stats.addMetric({ id: ROWS[2], label: 'Local Y of the picked object. Press C to copy position.set(x, y, z).', place: 'top', plate: 'Y', width: 7, read: coordinate('y'), format });
    stats.addMetric({ id: ROWS[3], label: 'Local Z of the picked object. Press C to copy position.set(x, y, z).', place: 'top', plate: 'Z', width: 7, read: coordinate('z'), format });
    stats.addMetric({
      id: ROWS[4], label: 'Distance from the camera to the picked object, in world units.', place: 'top', plate: 'DIST', width: 7, format,
      read: () => (selected === null ? null : selected.getWorldPosition(world).distanceTo(camera.getWorldPosition(eye)))
    });
  };

  const hideRows = (): void => {
    for (let i = 0, l = ROWS.length; i < l; i++) stats.removeMetric(ROWS[i]);
  };

  const select = (object: Object3D | null): void => {
    if (object === selected) return;
    selected = object;
    if (object === null) gizmo.detach();
    else gizmo.attach(object);
    options.onSelect?.(object);
  };

  const copy = (): string | null => {
    if (selected === null) return null;
    const code = positionCode(selected);
    // The clipboard needs a secure page and focus: the text is returned either way.
    // Absent on insecure pages, whatever the types say.
    const clipboard = globalThis.navigator.clipboard as Clipboard | undefined;
    void clipboard?.writeText(code).catch(() => undefined);
    return code;
  };

  const onDown = (event: PointerEvent): void => {
    // A press on a gizmo handle starts a drag, not a pick.
    down = gizmo.axis === null ? { x: event.clientX, y: event.clientY } : null;
  };

  const onUp = (event: PointerEvent): void => {
    const start = down;
    down = null;
    if (start === null || dragged || Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) {
      dragged = false;
      return;
    }

    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(scene, true);
    for (let i = 0, l = hits.length; i < l; i++) {
      if (inGizmo(hits[i].object) || !hits[i].object.visible) continue;
      select(target(hits[i].object));
      return;
    }

    select(null);
  };

  const onKey = (event: KeyboardEvent): void => {
    const element = event.target as HTMLElement | null;
    if (element !== null && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable)) return;
    if (event.key === 'Escape') select(null);
    else if ((event.key === 'c' || event.key === 'C') && !event.ctrlKey && !event.metaKey) copy();
  };

  const onDragging = (event: { value: unknown }): void => {
    const dragging = event.value === true;
    if (dragging) dragged = true;
    if (options.controls !== undefined) options.controls.enabled = !dragging;
  };

  const onObjectChange = (): void => {
    if (selected !== null) options.onMove?.(selected);
  };

  const setActive = (on: boolean): void => {
    if (on === active) return;
    active = on;
    gizmo.enabled = on;
    if (on) {
      scene.add(helper);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      window.addEventListener('keydown', onKey);
      showRows();
    } else {
      select(null);
      scene.remove(helper);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      hideRows();
    }
  };

  gizmo.enabled = false;
  gizmo.addEventListener('dragging-changed', onDragging);
  gizmo.addEventListener('objectChange', onObjectChange);
  stats.addControl({
    id: 'probe',
    label: 'PROBE',
    description: 'Pick and move objects: click one on the canvas, drag the arrows, press C to copy its position, Escape to deselect.',
    onChange: setActive
  });

  return {
    get active(): boolean { return active; },
    set active(on: boolean) {
      setActive(on);
      // Keeps the plate in step (it calls back into setActive, which is then a no-op).
      stats.setControl('probe', on);
    },
    get selected(): Object3D | null { return selected; },
    select,
    copy,
    dispose: () => {
      setActive(false);
      gizmo.removeEventListener('dragging-changed', onDragging);
      gizmo.removeEventListener('objectChange', onObjectChange);
      gizmo.dispose();
      stats.removeControl('probe');
    }
  };
}
