/**
 * Where the reader is in the Lens, as one value and a transition TABLE, not a
 * set of flags (port-quality Q1).
 *
 *   portfolio            every project x every step (cells are projects)
 *   portfolioStep        one step across the portfolio, full width (a leaf)
 *   project              one project x every step (cells are its changes)
 *   project + open step  that step's detail, full width (the last layer)
 *
 * The open step of a project is the view model's `openStepId`, which the step
 * screen, its deep links (`StepFocus`) and its Esc already own; this table
 * owns everything above it. `stepId` is the lit column on each plane and is
 * carried across planes, so Esc lands on the step the reader came from.
 *
 * Lifecycle keeps its OWN focused project: opening one here never changes the
 * app-wide active project (owner's decision, 2026-10-16).
 */
export type LensRoute =
  | { plane: 'portfolio'; stepId: string | null }
  | { plane: 'portfolioStep'; stepId: string }
  | { plane: 'project'; projectId: string; stepId: string | null };

export type LensPlane = LensRoute['plane'];

export type LensAction =
  | { type: 'select'; stepId: string }
  | { type: 'openStepAcross'; stepId: string }
  | { type: 'openProject'; projectId: string; stepId?: string | null }
  | { type: 'back' };

type Handlers = { [A in LensAction['type']]?: (r: LensRoute, a: Extract<LensAction, { type: A }>) => LensRoute };

const toProject = (r: LensRoute, a: Extract<LensAction, { type: 'openProject' }>): LensRoute =>
  ({ plane: 'project', projectId: a.projectId, stepId: a.stepId === undefined ? r.stepId : a.stepId });

/** Every legal move, by plane. A move a plane does not list leaves the route as it is. */
export const LENS_TRANSITIONS: Record<LensPlane, Handlers> = {
  portfolio: {
    select: (_r, a) => ({ plane: 'portfolio', stepId: a.stepId }),
    openStepAcross: (_r, a) => ({ plane: 'portfolioStep', stepId: a.stepId }),
    openProject: toProject,
  },
  portfolioStep: {
    select: (_r, a) => ({ plane: 'portfolioStep', stepId: a.stepId }),
    openProject: toProject,
    back: (r) => ({ plane: 'portfolio', stepId: r.stepId }),
  },
  project: {
    select: (r, a) => (r.plane === 'project' ? { ...r, stepId: a.stepId } : r),
    openProject: toProject,
    back: (r) => ({ plane: 'portfolio', stepId: r.stepId }),
  },
};

export function lensReducer(route: LensRoute, action: LensAction): LensRoute {
  const handler = LENS_TRANSITIONS[route.plane][action.type] as ((r: LensRoute, a: LensAction) => LensRoute) | undefined;
  return handler ? handler(route, action) : route;
}

/** How deep a plane sits, for the depth indicator: the open step is one more. */
export function lensDepth(route: LensRoute, stepOpen: boolean): 0 | 1 | 2 {
  if (route.plane === 'portfolio') return 0;
  if (route.plane === 'portfolioStep') return 1;
  return stepOpen ? 2 : 1;
}
