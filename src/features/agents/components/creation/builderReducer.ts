import type { NotificationChannel } from '@/lib/types/frontendTypes';
import type { DesignContextData, DesignUseCase } from '@/lib/types/frontendTypes';
import type { ConnectorPipelineStep, DesignAnalysisResult } from '@/lib/types/designTypes';
import type { BuilderState, BuilderUseCase, BuilderComponent, TriggerPreset } from './types';
import { INITIAL_BUILDER_STATE, TRIGGER_PRESETS, ERROR_STRATEGIES, REVIEW_POLICIES } from './types';

// ── Actions ─────────────────────────────────────────────────────────

export type BuilderAction =
  | { type: 'SET_INTENT'; payload: string }
  | { type: 'ADD_USE_CASE' }
  | { type: 'ADD_USE_CASE_WITH_DATA'; payload: { title: string; description: string; category?: string } }
  | { type: 'UPDATE_USE_CASE'; payload: { id: string; updates: Partial<BuilderUseCase> } }
  | { type: 'REMOVE_USE_CASE'; payload: string }
  | { type: 'ADD_COMPONENT'; payload: string }
  | { type: 'REMOVE_COMPONENT'; payload: string }
  | { type: 'SET_COMPONENT_CREDENTIAL'; payload: { connectorName: string; credentialId: string | null } }
  | { type: 'SET_GLOBAL_TRIGGER'; payload: TriggerPreset | null }
  | { type: 'TOGGLE_CHANNEL'; payload: NotificationChannel }
  | { type: 'UPDATE_CHANNEL'; payload: { index: number; config: Record<string, string> } }
  | { type: 'SET_ERROR_STRATEGY'; payload: string }
  | { type: 'SET_REVIEW_POLICY'; payload: string }
  | { type: 'APPLY_DESIGN_RESULT'; payload: DesignAnalysisResult }
  | { type: 'RESET' };

let nextId = 1;

function makeUseCaseId(): string {
  return `uc_${Date.now()}_${nextId++}`;
}

// ── Design result mapping helpers ───────────────────────────────────

function matchTriggerPreset(triggerType: string, cron?: string): TriggerPreset | null {
  if (cron) {
    const match = TRIGGER_PRESETS.find((p) => p.cron === cron);
    if (match) return match;
  }
  if (triggerType === 'webhook') return TRIGGER_PRESETS.find((p) => p.type === 'webhook') ?? null;
  if (triggerType === 'manual') return TRIGGER_PRESETS.find((p) => p.type === 'manual') ?? null;
  if (triggerType === 'schedule' && cron) {
    return { label: `Custom (${cron})`, type: 'schedule', cron };
  }
  return null;
}

function applyDesignResult(state: BuilderState, result: DesignAnalysisResult): BuilderState {
  let next = { ...state };

  // Use cases: derive from summary/instructions if no explicit use cases
  const instructions = result.structured_prompt?.instructions;
  if (instructions && state.useCases.length === 0) {
    const lines = instructions.split('\n').filter((l) => l.trim().startsWith('-') || l.trim().startsWith('*'));
    const newCases: BuilderUseCase[] = lines.slice(0, 5).map((line) => ({
      id: makeUseCaseId(),
      title: line.replace(/^[\s\-*]+/, '').slice(0, 80),
      description: '',
      category: 'automation',
      executionMode: 'e2e' as const,
      trigger: null,
    }));
    if (newCases.length > 0) {
      next = { ...next, useCases: [...next.useCases, ...newCases] };
    }
  }

  // Triggers
  if (result.suggested_triggers?.length > 0) {
    const t = result.suggested_triggers[0];
    if (t) {
      const preset = matchTriggerPreset(t.trigger_type, t.config?.cron as string | undefined);
      if (preset) next = { ...next, globalTrigger: preset };
    }
  }

  // Connectors: merge suggested_connectors with existing components
  if (result.suggested_connectors?.length) {
    const existingNames = new Set(next.components.map((c) => c.connectorName));
    const newComponents: BuilderComponent[] = result.suggested_connectors
      .filter((sc) => !existingNames.has(sc.name))
      .map((sc) => ({ connectorName: sc.name, credentialId: null }));
    next = { ...next, components: [...next.components, ...newComponents] };
  }

  // Notification channels
  if (result.suggested_notification_channels?.length) {
    const existingTypes = new Set(next.channels.map((c) => c.type));
    const newChannels: NotificationChannel[] = result.suggested_notification_channels
      .filter((ch) => !existingTypes.has(ch.type))
      .map((ch) => ({
        type: ch.type,
        enabled: true,
        config: ch.config_hints ?? {},
      }));
    next = { ...next, channels: [...next.channels, ...newChannels] };
  }

  // Summary → intent (if empty)
  if (!next.intent.trim() && result.summary) {
    next = { ...next, intent: result.summary };
  }

  return next;
}

// ── Reducer ─────────────────────────────────────────────────────────

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
            id: makeUseCaseId(),
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
            id: makeUseCaseId(),
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

    case 'ADD_COMPONENT': {
      const name = action.payload;
      if (state.components.some((c) => c.connectorName === name)) return state;
      return {
        ...state,
        components: [...state.components, { connectorName: name, credentialId: null }],
      };
    }

    case 'REMOVE_COMPONENT':
      return {
        ...state,
        components: state.components.filter((c) => c.connectorName !== action.payload),
      };

    case 'SET_COMPONENT_CREDENTIAL':
      return {
        ...state,
        components: state.components.map((c) =>
          c.connectorName === action.payload.connectorName
            ? { ...c, credentialId: action.payload.credentialId }
            : c,
        ),
      };

    case 'SET_GLOBAL_TRIGGER':
      return { ...state, globalTrigger: action.payload };

    case 'TOGGLE_CHANNEL': {
      const existing = state.channels.findIndex((c) => c.type === action.payload.type);
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

// ── Helpers ─────────────────────────────────────────────────────────

function triggerToSuggested(preset: TriggerPreset) {
  return {
    type: preset.type as 'schedule' | 'webhook' | 'manual',
    cron: preset.cron,
    description: preset.label,
  };
}

export function toDesignContext(state: BuilderState): DesignContextData {
  const globalTrigger = state.globalTrigger
    ? triggerToSuggested(state.globalTrigger)
    : undefined;

  const useCases: DesignUseCase[] = state.useCases
    .filter((uc) => uc.title.trim())
    .map((uc) => ({
      id: uc.id,
      title: uc.title,
      description: uc.description,
      category: uc.category || undefined,
      execution_mode: uc.executionMode,
      suggested_trigger: uc.trigger
        ? triggerToSuggested(uc.trigger)
        : globalTrigger,
      notification_channels: state.channels.length > 0 ? state.channels : undefined,
    }));

  const connectorPipeline: ConnectorPipelineStep[] = state.components.map(
    (comp, i) => ({
      connector_name: comp.connectorName,
      action_label: `Use ${comp.connectorName}`,
      order: i,
    }),
  );

  const credentialLinks: Record<string, string> = {};
  for (const comp of state.components) {
    if (comp.credentialId) {
      credentialLinks[comp.connectorName] = comp.credentialId;
    }
  }

  return {
    useCases: useCases.length > 0 ? useCases : undefined,
    connectorPipeline: connectorPipeline.length > 0 ? connectorPipeline : undefined,
    credentialLinks: Object.keys(credentialLinks).length > 0 ? credentialLinks : undefined,
    summary: state.intent.trim() || generateSummary(state) || undefined,
  };
}

export function generateSystemPrompt(state: BuilderState): string {
  const lines: string[] = ['You are a helpful AI assistant.'];

  if (state.useCases.length > 0) {
    lines.push('');
    lines.push('## Use Cases');
    for (const uc of state.useCases) {
      if (!uc.title.trim()) continue;
      lines.push(`- **${uc.title}**: ${uc.description || 'No description provided.'}`);
    }
  }

  if (state.components.length > 0) {
    lines.push('');
    lines.push(`## Connectors: ${state.components.map((c) => c.connectorName).join(', ')}`);
  }

  const errorLabel = ERROR_STRATEGIES.find((e) => e.value === state.errorStrategy)?.description;
  const reviewLabel = REVIEW_POLICIES.find((r) => r.value === state.reviewPolicy)?.description;

  if (state.errorStrategy !== 'halt' || state.reviewPolicy !== 'never') {
    lines.push('');
    lines.push('## Policies');
    if (errorLabel && state.errorStrategy !== 'halt') {
      lines.push(`- Error handling: ${errorLabel}`);
    }
    if (reviewLabel && state.reviewPolicy !== 'never') {
      lines.push(`- Manual review: ${reviewLabel}`);
    }
  }

  return lines.join('\n');
}

export function generateSummary(state: BuilderState): string {
  const parts: string[] = [];

  const ucCount = state.useCases.filter((uc) => uc.title.trim()).length;
  if (ucCount > 0) parts.push(`${ucCount} use case${ucCount !== 1 ? 's' : ''}`);

  if (state.components.length > 0) {
    parts.push(`${state.components.length} component${state.components.length !== 1 ? 's' : ''}`);
  }

  if (state.globalTrigger) parts.push(state.globalTrigger.label);

  if (state.channels.length > 0) {
    parts.push(state.channels.map((c) => c.type).join(', '));
  }

  return parts.join(' · ');
}
