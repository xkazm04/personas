// Canvas action grammar — programmatic control of the Mastermind canvas.
//
// Generalizes the focusStore pattern ("lift the REQUEST, not the camera"): an
// external queue of typed actions the shell subscribes to and answers. Three
// doors dispatch into it — the dev/test bridge (`canvasTestBridge`, driven live
// through the :17320 test-automation `/eval` tool), and later Athena's
// `canvas_control` companion op. One grammar, proven live before she gets it.
//
// Camera-request driven ON PURPOSE: off-screen islands are not in the DOM
// (viewport culling + mount waves), so no action here may be a DOM lookup —
// the shell answers with the same `fit`/`animateTo`/popover callbacks the
// human affordances use, which is what keeps the two paths from drifting.
//
// Every dispatch resolves with a `CanvasActionResult` envelope — honest acks
// (`band_too_far`, `demo_scene`, `clamped`) rather than silent best-effort,
// because the v2 consumer narrates from these payloads.
import { useSyncExternalStore } from 'react';

import type { DimNode, DimStatus, Island, IslandShip, IslandState, ZoomBand } from './types';
import { zoomBand } from './types';
import type { IslandStat } from './islandStats';

// --- the grammar --------------------------------------------------------------

export type CanvasActionRequest =
  /** No-op probe — returns the camera readout only. */
  | { kind: 'camera.read' }
  /** Relative move per axis. `unit: 'world'` (default) moves the viewport by
   *  world units; `'screen'` by CSS pixels. Positive dx looks rightward. */
  | { kind: 'camera.pan'; dx: number; dy: number; unit?: 'world' | 'screen' }
  /** Multiply z around the viewport centre, OR jump to a named detail band. */
  | { kind: 'camera.zoom'; factor?: number; band?: ZoomBand }
  /** Travel to an island, at a requested detail level (default `close`). */
  | { kind: 'camera.focus'; slug: string; band?: ZoomBand }
  /** Frame a set of islands (absent = the whole scene). */
  | { kind: 'camera.fit'; slugs?: string[] }
  /** Pure model read of one island — no UI, no camera. */
  | { kind: 'island.read'; slug: string }
  /** Pure model read of one dimension cell. */
  | { kind: 'dim.read'; slug: string; key: string }
  /** Open the dimension's Improve popover, exactly as a click would. The zoom
   *  gate lives here: below `near`, `travel: true` (default) first runs
   *  `camera.focus(slug, 'close')`; `travel: false` refuses `band_too_far`. */
  | { kind: 'dim.open'; slug: string; key: string; travel?: boolean }
  /** Open a collapsed category cell's dimension list (the far/mid affordance). */
  | { kind: 'category.open'; slug: string; category: string }
  /** Open the island context menu (the right-click / Shift+F10 affordance). */
  | { kind: 'island.menu'; slug: string };

export type CanvasActionFailReason =
  | 'unknown_slug'
  | 'unknown_target'
  | 'band_too_far'
  | 'demo_scene'
  | 'canvas_closed'
  | 'bad_request';

export interface CanvasCameraReadout {
  x: number;
  y: number;
  z: number;
  band: ZoomBand;
  viewport: { w: number; h: number };
  /** Islands whose centre is inside the viewport at this camera. */
  visibleSlugs: string[];
}

export interface DimReadPayload {
  key: string;
  label: string;
  status: DimStatus;
  detail: string | null;
  reached: number;
  steps: number;
  /** Which Improve affordance the cell offers (null = inert). */
  action: string | null;
}

export interface IslandReadPayload {
  slug: string;
  name: string;
  purpose: string;
  state: IslandState;
  stateSource: 'readiness' | 'errors';
  blockers: number;
  attention: boolean;
  autoScore: number;
  prodScore: number;
  lifecycle: string;
  monitorErrors: number | null;
  fleet: Array<{ id: string; label: string; state: string }>;
  personasRunning: string[];
  stats: IslandStat[];
  ship: IslandShip | null;
  dims: DimReadPayload[];
}

export interface CanvasActionResult {
  seq: number;
  ok: boolean;
  reason?: CanvasActionFailReason;
  /** A camera request hit the z clamp and landed short of the ask. */
  clamped?: boolean;
  /** Camera state AFTER the action settled (every answered action carries it). */
  camera?: CanvasCameraReadout;
  payload?: unknown;
}

// --- payload builders (pure, unit-tested) ------------------------------------

/** One dimension cell as the grammar reports it — the scene model verbatim,
 *  which is strictly more than the pixels show at any band. */
export function dimReadPayload(node: DimNode): DimReadPayload {
  return {
    key: node.key,
    label: node.label,
    status: node.status,
    detail: node.detail,
    reached: node.reached,
    steps: node.steps,
    action: node.action ?? null,
  };
}

export function islandReadPayload(island: Island): IslandReadPayload {
  return {
    slug: island.slug,
    name: island.name,
    purpose: island.purpose,
    state: island.state,
    stateSource: island.stateSource,
    blockers: island.blockers,
    attention: island.attention,
    autoScore: island.autoScore,
    prodScore: island.prodScore,
    lifecycle: island.lifecycle,
    monitorErrors: island.monitorErrors,
    fleet: island.fleet.map((f) => ({ id: f.id, label: f.label, state: f.state })),
    personasRunning: [...island.personasRunning],
    stats: island.stats,
    ship: island.ship ?? null,
    dims: island.nodes.map(dimReadPayload),
  };
}

// --- band targeting (pure, unit-tested) --------------------------------------

/** Target z that lands comfortably INSIDE each band — not at its threshold,
 *  where a rounding wobble could read back as the neighbouring band. `close`
 *  matches fit()'s 0.9 ceiling so "focus close" and a tight fit agree. */
export const BAND_TARGET_Z: Record<ZoomBand, number> = {
  far: 0.12,
  mid: 0.3,
  near: 0.62,
  close: 0.9,
};

/** Sanity guard kept next to the table: every target must map into its band. */
export const bandTargetZ = (band: ZoomBand): number => BAND_TARGET_Z[band];

// A dimension cell is only an individual click target from `near` in — below
// that the body renders collapsed categories (see dimCategories.ts).
export const DIM_OPEN_MIN_BAND: ZoomBand = 'near';

export { zoomBand };

// --- the queue ----------------------------------------------------------------

/** How long a dispatched action waits for a mounted shell to pick it up before
 *  failing `canvas_closed`. Long enough to survive a route-in render; short
 *  enough that a caller on the wrong screen learns so promptly. */
export const PICKUP_TIMEOUT_MS = 2000;

export interface PendingCanvasAction {
  seq: number;
  action: CanvasActionRequest;
  /** Answer the dispatcher. Idempotent — the first settle wins. */
  settle: (result: CanvasActionResult) => void;
  /** Take-time duty: stop the pickup timeout — the taker now owns settling,
   *  however long the action (a travel tween, a serial batch) takes. */
  cancelPickupTimer: () => void;
}

type Listener = () => void;
const listeners = new Set<Listener>();

let queue: PendingCanvasAction[] = [];
let seq = 0;
let version = 0;

function emit(): void {
  version += 1;
  for (const l of [...listeners]) l();
}

export function subscribeCanvasActions(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const canvasActionVersion = (): number => version;

/** The shell's subscription — bumps whenever a new action is queued. */
export const useCanvasActionVersion = (): number =>
  useSyncExternalStore(subscribeCanvasActions, canvasActionVersion);

/**
 * Dispatch one action; resolves with the shell's answer (never rejects — a
 * missing shell answers `canvas_closed`, so callers always get an envelope).
 */
export function dispatchCanvasAction(action: CanvasActionRequest): Promise<CanvasActionResult> {
  seq += 1;
  const mySeq = seq;
  return new Promise<CanvasActionResult>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      queue = queue.filter((p) => p.seq !== mySeq);
      settle({ seq: mySeq, ok: false, reason: 'canvas_closed' });
    }, PICKUP_TIMEOUT_MS);
    const settle = (result: CanvasActionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    queue.push({ seq: mySeq, action, settle, cancelPickupTimer: () => clearTimeout(timer) });
    emit();
  });
}

/** Drain the queue — the shell takes ownership of everything pending. Taking
 *  clears each entry's pickup timer (settling is now the taker's duty). */
export function takeCanvasActions(): PendingCanvasAction[] {
  const taken = queue;
  queue = [];
  for (const p of taken) p.cancelPickupTimer();
  return taken;
}

/** Test-only reset of the module singletons (mirrors focusStore). */
export function __resetCanvasActionsForTests(): void {
  for (const p of queue) p.settle({ seq: p.seq, ok: false, reason: 'canvas_closed' });
  queue = [];
  seq = 0;
  version = 0;
  emit();
}
