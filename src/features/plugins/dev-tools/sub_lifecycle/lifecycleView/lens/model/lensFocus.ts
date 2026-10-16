/**
 * The way another surface opens Lifecycle on one project (the Overseer's
 * watched pipelines, a deep link), without touching the app-wide active
 * project: Lifecycle keeps its own focus (owner's decision, 2026-10-16).
 *
 * A request is a one-shot: the Lens takes it when it mounts, or at once when
 * it is already mounted, and clears it. The last route is remembered for the
 * session (module memory, never persisted), so leaving the page and coming
 * back lands where the reader was.
 */
import { create } from 'zustand';

import type { LensRoute } from './lensRoute';

interface LensFocusState {
  request: { projectId: string; stepId: string | null } | null;
  open: (projectId: string, stepId?: string | null) => void;
  take: () => { projectId: string; stepId: string | null } | null;
}

export const useLensFocus = create<LensFocusState>((set, get) => ({
  request: null,
  open: (projectId, stepId = null) => set({ request: { projectId, stepId } }),
  take: () => {
    const r = get().request;
    if (r) set({ request: null });
    return r;
  },
}));

/** Ask Lifecycle to open on a project; navigate to the page separately. */
export function openLifecycleProject(projectId: string, stepId: string | null = null): void {
  useLensFocus.getState().open(projectId, stepId);
}

let lastRoute: LensRoute = { plane: 'portfolio', stepId: null };

export function rememberLensRoute(route: LensRoute): void {
  lastRoute = route;
}

/** The project the Lens is (or was last) focused on: a pending request, else the last route's. */
export function lastLensProject(): string | null {
  const r = useLensFocus.getState().request;
  if (r) return r.projectId;
  return lastRoute.plane === 'project' ? lastRoute.projectId : null;
}

/** Where the Lens opens: a pending request first, else where the reader last was. */
export function initialLensRoute(): LensRoute {
  const r = useLensFocus.getState().take();
  return r ? { plane: 'project', projectId: r.projectId, stepId: r.stepId } : lastRoute;
}

/** Test-only. */
export function __resetLensFocusForTests(): void {
  lastRoute = { plane: 'portfolio', stepId: null };
  useLensFocus.setState({ request: null });
}
