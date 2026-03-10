import type { NotificationChannel } from '@/lib/types/frontendTypes';
import type { AgentIR } from '@/lib/types/designTypes';
import type { BuilderState, BuilderUseCase, TriggerPreset, ComponentRole } from './types';
import { INITIAL_BUILDER_STATE } from './types';
import { applyDesignResult } from './designResultMapper';

// Re-export helpers so existing imports continue to work
export { toDesignContext, generateSystemPrompt, generateSummary, computeCredentialCoverage, computeRoleCoverage } from './builderHelpers';

// -- Actions --

export type BuilderAction =
  | { type: 'SET_INTENT'; payload: string }
  | { type: 'ADD_USE_CASE' }
  | { type: 'ADD_USE_CASE_WITH_DATA'; payload: { title: string; description: string; category?: string } }
  | { type: 'UPDATE_USE_CASE'; payload: { id: string; updates: Partial<BuilderUseCase> } }
  | { type: 'REMOVE_USE_CASE'; payload: string }
  | { type: 'REORDER_USE_CASES'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'ADD_COMPONENT'; payload: { role: ComponentRole; connectorName: string; credentialId: string | null } }
  | { type: 'REMOVE_COMPONENT'; payload: string }
  | { type: 'AUTO_MATCH_CREDENTIALS'; payload: { credentials: Array<{ id: string; service_type: string }> } }
  | { type: 'UPDATE_COMPONENT_CREDENTIAL'; payload: { componentId: string; credentialId: string | null } }
  | { type: 'SET_GLOBAL_TRIGGER'; payload: TriggerPreset | null }
  | { type: 'TOGGLE_CHANNEL'; payload: NotificationChannel }
  | { type: 'UPDATE_CHANNEL'; payload: { index: number; config: Record<string, string> } }
  | { type: 'SET_ERROR_STRATEGY'; payload: string }
  | { type: 'SET_REVIEW_POLICY'; payload: string }
  | { type: 'SET_WATCHED_TABLES'; payload: { componentId: string; tables: string[] } }
  | { type: 'APPLY_DESIGN_RESULT'; payload: AgentIR }
  | { type: 'RESET' };

let nextId = 1;

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${nextId++}`;
}

// -- Reducer --

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'SET_INTENT':
      return { ...state, intent: action.payload };

    case 'ADD_USE_CASE':
      return {
        ...state,
        useCases: [
          ...state.useCases,
          {
            id: makeId('uc'),
            title: '',
            description: '',
            category: 'automation',
            executionMode: 'e2e',
            trigger: null,
          },
        ],
      };

    case 'ADD_USE_CASE_WITH_DATA':
      return {
        ...state,
        useCases: [
          ...state.useCases,
          {
            id: makeId('uc'),
            title: action.payload.title,
            description: action.payload.description,
            category: action.payload.category || 'automation',
            executionMode: 'e2e',
            trigger: null,
          },
        ],
      };

    case 'UPDATE_USE_CASE':
      return {
        ...state,
        useCases: state.useCases.map((uc) =>
          uc.id === action.payload.id ? { ...uc, ...action.payload.updates } : uc,
        ),
      };

    case 'REMOVE_USE_CASE':
      return {
        ...state,
        useCases: state.useCases.filter((uc) => uc.id !== action.payload),
      };

    case 'REORDER_USE_CASES': {
      const { fromIndex, toIndex } = action.payload;
      if (fromIndex === toIndex) return state;
      const reordered = [...state.useCases];
      const [moved] = reordered.splice(fromIndex, 1);
      if (!moved) return state;
      reordered.splice(toIndex, 0, moved);
      return { ...state, useCases: reordered };
    }

    case 'ADD_COMPONENT': {
      const { role, connectorName, credentialId } = action.payload;
      if (credentialId && state.components.some(
        (c) => c.role === role && c.credentialId === credentialId,
      )) return state;
      if (!credentialId && state.components.some(
        (c) => c.role === role && c.connectorName === connectorName && !c.credentialId,
      )) return state;
      return {
        ...state,
        components: [
          ...state.components,
          { id: makeId('comp'), role, connectorName, credentialId },
        ],
      };
    }

    case 'REMOVE_COMPONENT':
      return {
        ...state,
        components: state.components.filter((c) => c.id !== action.payload),
      };

    case 'AUTO_MATCH_CREDENTIALS': {
      const { credentials } = action.payload;
      return {
        ...state,
        components: state.components.map((comp) => {
          if (comp.credentialId) return comp;
          const match = credentials.find((c) => c.service_type === comp.connectorName);
          return match ? { ...comp, credentialId: match.id } : comp;
        }),
      };
    }

    case 'SET_WATCHED_TABLES': {
      const { componentId, tables } = action.payload;
      return {
        ...state,
        components: state.components.map((comp) =>
          comp.id === componentId
            ? { ...comp, watchedTables: tables.length > 0 ? tables : undefined }
            : comp,
        ),
      };
    }

    case 'UPDATE_COMPONENT_CREDENTIAL': {
      const { componentId, credentialId } = action.payload;
      return {
        ...state,
        components: state.components.map((comp) =>
          comp.id === componentId
            ? { ...comp, credentialId, watchedTables: credentialId !== comp.credentialId ? undefined : comp.watchedTables }
            : comp,
        ),
      };
    }

    case 'SET_GLOBAL_TRIGGER':
      return { ...state, globalTrigger: action.payload };

    case 'TOGGLE_CHANNEL': {
      const existing = state.channels.findIndex(
        (c) => c.type === action.payload.type && (c.credential_id ?? '') === (action.payload.credential_id ?? ''),
      );
      return {
        ...state,
        channels: existing >= 0
          ? state.channels.filter((_, i) => i !== existing)
          : [...state.channels, action.payload],
      };
    }

    case 'UPDATE_CHANNEL':
      return {
        ...state,
        channels: state.channels.map((c, i) =>
          i === action.payload.index ? { ...c, config: { ...c.config, ...action.payload.config } } : c,
        ),
      };

    case 'SET_ERROR_STRATEGY':
      return { ...state, errorStrategy: action.payload };

    case 'SET_REVIEW_POLICY':
      return { ...state, reviewPolicy: action.payload };

    case 'APPLY_DESIGN_RESULT':
      return applyDesignResult(state, action.payload);

    case 'RESET':
      return INITIAL_BUILDER_STATE;

    default:
      return state;
  }
}
