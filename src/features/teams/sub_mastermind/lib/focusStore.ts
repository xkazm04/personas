// Canvas focus target — the one place that says "this island is the subject
// right now" (WP3, 2026-08-04).
//
// Two things needed to drive focus from OUTSIDE the canvas: Athena composing a
// panel for a project (which must route to Teams → Mastermind, aim the camera
// and open the panel, from a listener that lives in the chat panel), and the
// page itself restoring a stored panel when the user opens a project.
// `fit()` / `onIslandFocus` live inside `CanvasShell`, so rather than lifting
// the camera out of the shell (it is genuinely shell state), this module lifts
// the REQUEST: an external store the shell subscribes to and answers.
//
// Camera-driven on purpose. Off-screen islands are not in the DOM (viewport
// culling + the mount/hydrate waves), so a focus implementation that looks for
// a node would work only for islands that happen to already be visible. The
// shell answers a request by moving the camera, which needs no node.
//
// FOCUS TARGET, not "focused slug": v1 targets a project island, but the panel
// is modelled against a `CanvasFocusTarget` so anchoring it to something else
// later (a group, a dimension cell) is a renderer change, not a rewrite.
import { useSyncExternalStore } from 'react';

/** What a panel / the camera is currently pointed at. `project` is the only
 *  kind v1 understands; the discriminant is what keeps it extensible. */
export type CanvasFocusTarget = { kind: 'project'; slug: string };

export interface CanvasFocus {
  target: CanvasFocusTarget;
  /** The camera should travel to it. False = "the panel follows, the view
   *  stays put" (a header click already put the island under the cursor). */
  travel: boolean;
  /** Monotonic, so re-focusing the SAME island still reads as a new request. */
  seq: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();

let current: CanvasFocus | null = null;
let seq = 0;

function emit(): void {
  for (const l of [...listeners]) l();
}

export function subscribeCanvasFocus(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable container until something changes — the `useSyncExternalStore` rule. */
export const canvasFocusSnapshot = (): CanvasFocus | null => current;

/** Point the canvas at one project. `travel` drives the camera as well. */
export function focusCanvasProject(slug: string, travel = true): void {
  const clean = slug.trim();
  if (!clean) return;
  seq += 1;
  current = { target: { kind: 'project', slug: clean }, travel, seq };
  emit();
}

/** Drop the focus target (panel closed, canvas left). */
export function clearCanvasFocus(): void {
  if (!current) return;
  current = null;
  emit();
}

export const useCanvasFocus = (): CanvasFocus | null =>
  useSyncExternalStore(subscribeCanvasFocus, canvasFocusSnapshot);

/** The focused project slug, or null. Convenience for panel hosts. */
export const useFocusedProjectSlug = (): string | null =>
  useCanvasFocus()?.target.slug ?? null;

/** Test-only reset of the module singletons. */
export function __resetCanvasFocusForTests(): void {
  current = null;
  seq = 0;
  emit();
}
