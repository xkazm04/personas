import type { AgentIR } from '@/lib/types/designTypes';
import type { WorkflowPlatform } from '@/lib/personas/parsers/workflowDetector';
import type { N8nImportAction, N8nImportState } from '../hooks/useN8nImportReducer';
import { normalizeDraftFromUnknown } from '../hooks/n8nTypes';
import { checkStepPrecondition } from './navigationReducer';

// â”€â”€ Session / Upload State Slice â”€â”€

export interface SessionState {
  sessionId: string | null;
  rawWorkflowJson: string;
  workflowName: string;
  platform: WorkflowPlatform;
  error: string | null;
  sessionWarning: string | null;
  parsedResult: AgentIR | null;
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;
  confirming: boolean;
  created: boolean;
  /** True when platform was guessed and user should confirm */
  platformNeedsConfirmation: boolean;
  /** Confidence level of platform detection */
  detectedConfidence: 'high' | 'medium' | 'low';
}

export const INITIAL_SESSION: SessionState = {
  sessionId: null,
  rawWorkflowJson: '',
  workflowName: '',
  platform: 'n8n',
  error: null,
  sessionWarning: null,
  parsedResult: null,
  selectedToolIndices: new Set(),
  selectedTriggerIndices: new Set(),
  selectedConnectorNames: new Set(),
  confirming: false,
  created: false,
  platformNeedsConfirmation: false,
  detectedConfidence: 'high',
};

// â”€â”€ Helpers â”€â”€

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function initSelectionsFromResult(result: AgentIR): {
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;
} {
  return {
    selectedToolIndices: new Set(result.suggested_tools.map((_, i) => i)),
    selectedTriggerIndices: new Set(result.suggested_triggers.map((_, i) => i)),
    selectedConnectorNames: new Set((result.suggested_connectors ?? []).map((c) => c.name)),
  };
}

// â”€â”€ Reducer â”€â”€

export function sessionReducer(
  slice: SessionState,
  action: N8nImportAction,
  fullState: N8nImportState,
): SessionState {
  switch (action.type) {
    case 'FILE_PARSED': {
      const selections = initSelectionsFromResult(action.parsedResult);
      return {
        ...INITIAL_SESSION,
        workflowName: action.workflowName,
        rawWorkflowJson: action.rawWorkflowJson,
        parsedResult: action.parsedResult,
        platform: action.platform ?? 'n8n',
        platformNeedsConfirmation: action.needsConfirmation ?? false,
        detectedConfidence: action.detectedConfidence ?? 'high',
        ...selections,
      };
    }

    case 'CONFIRM_PLATFORM':
      return { ...slice, platformNeedsConfirmation: false };

    case 'TOGGLE_TOOL':
      return { ...slice, selectedToolIndices: toggleInSet(slice.selectedToolIndices, action.index) };

    case 'TOGGLE_TRIGGER':
      return { ...slice, selectedTriggerIndices: toggleInSet(slice.selectedTriggerIndices, action.index) };

    case 'TOGGLE_CONNECTOR':
      return { ...slice, selectedConnectorNames: toggleInSet(slice.selectedConnectorNames, action.name) };

    case 'CONFIRM_STARTED':
      return { ...slice, confirming: true, error: null };

    case 'CONFIRM_COMPLETED':
      return { ...slice, confirming: false, created: true };

    case 'CONFIRM_FAILED':
      return { ...slice, confirming: false, error: action.error };

    case 'SET_ERROR':
      return { ...slice, error: action.error };

    case 'CLEAR_ERROR':
      return { ...slice, error: null };

    case 'CLEAR_SESSION_WARNING':
      return { ...slice, sessionWarning: null };

    case 'SESSION_CREATED':
      return { ...slice, sessionId: action.sessionId };

    case 'RESTORE_CONTEXT': {
      const selections = action.parsedResult ? initSelectionsFromResult(action.parsedResult) : {};
      return {
        ...slice,
        workflowName: action.workflowName,
        rawWorkflowJson: action.rawWorkflowJson,
        parsedResult: action.parsedResult,
        ...selections,
      };
    }

    case 'GO_TO_STEP': {
      const preconditionError = checkStepPrecondition(action.step, fullState);
      if (preconditionError) return { ...slice, error: preconditionError };
      return { ...slice, error: null };
    }

    case 'QUESTIONS_FAILED':
      return { ...slice, error: action.error || null };

    case 'TRANSFORM_STARTED':
      return { ...slice, error: null };

    case 'TRANSFORM_FAILED':
      return { ...slice, error: action.error };

    case 'TRANSFORM_COMPLETED': {
      if (!normalizeDraftFromUnknown(action.draft) || !action.draft.system_prompt?.trim()) {
        return { ...slice, error: 'Transform output was invalid. Please retry or refine your request.' };
      }
      return slice;
    }

    case 'TRANSFORM_CANCELLED':
      return { ...slice, error: null };

    default:
      return slice;
  }
}
