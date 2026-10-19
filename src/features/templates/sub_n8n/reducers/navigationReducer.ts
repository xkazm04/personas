import type { N8nImportState, N8nImportAction, N8nWizardStep } from '../hooks/useN8nImportReducer';

// -- Navigation State Slice --

export interface NavigationState {
  step: N8nWizardStep;
}

export const INITIAL_NAVIGATION: NavigationState = {
  step: 'upload',
};

// -- Step Preconditions --

export function checkStepPrecondition(
  step: N8nWizardStep,
  state: Pick<N8nImportState, 'parsedResult' | 'draft' | 'draftJsonError'>,
): string | null {
  switch (step) {
    case 'analyze':
      if (!state.parsedResult) return 'Cannot view analysis: no parsed workflow. Upload a workflow first.';
      break;
    case 'transform':
      if (!state.parsedResult) return 'Cannot transform: no parsed workflow. Upload and parse a workflow first.';
      break;
    case 'edit':
      if (!state.draft) return 'Cannot open editor: no draft available. Run a transform first.';
      break;
    case 'confirm':
      if (!state.draft) return 'Cannot confirm: no draft available. Run a transform first.';
      if (state.draftJsonError) return 'Cannot confirm: draft has JSON errors. Fix them in the editor first.';
      break;
  }
  return null;
}

/**
 * Single source of truth for "which step should we land on, given only the
 * data we have" — used whenever a persisted/target step turns out to be
 * unreachable (failed/interrupted sessions, or a restored step whose
 * precondition fails). Centralized so the session-restore call site and the
 * reducer's own fallback can't silently diverge.
 */
export function fallbackStepForData(state: {
  draft: unknown;
  parsedResult: unknown;
}): N8nWizardStep {
  if (state.draft) return 'edit';
  if (state.parsedResult) return 'analyze';
  return 'upload';
}

/**
 * The steps N8nImportTab still renders a surface for. The transform / edit /
 * confirm step components were deleted with the n8n subtree cleanup; the
 * wizard hands off to the matrix build from `analyze`. A resumed session must
 * land on one of these, or it opens an empty panel with no way forward.
 */
export const SURFACED_STEPS: readonly N8nWizardStep[] = ['upload', 'analyze'];

/** Clamp a restore target to a step that has a surface. */
export function surfacedStep(step: N8nWizardStep, state: { parsedResult: unknown }): N8nWizardStep {
  if (SURFACED_STEPS.includes(step)) return step === 'analyze' && !state.parsedResult ? 'upload' : step;
  return state.parsedResult ? 'analyze' : 'upload';
}

// -- Reducer --

export function navigationReducer(
  slice: NavigationState,
  action: N8nImportAction,
  fullState: N8nImportState,
): NavigationState {
  switch (action.type) {
    case 'FILE_PARSED':
      return { step: 'analyze' };

    case 'TRANSFORM_STARTED':
      return { step: 'transform' };

    case 'TRANSFORM_COMPLETED':
      return { step: 'edit' };

    case 'TRANSFORM_CANCELLED':
      return { step: fullState.parsedResult ? 'analyze' : 'upload' };

    case 'GO_TO_STEP': {
      const preconditionError = checkStepPrecondition(action.step, fullState);
      if (preconditionError) return slice;
      return { step: action.step };
    }

    case 'RESTORE_CONTEXT':
      return { step: 'transform' };

    default:
      return slice;
  }
}
