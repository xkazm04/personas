import type { NotificationChannel } from '@/lib/types/frontendTypes';
import type { DesignContextData, DesignUseCase } from '@/lib/types/frontendTypes';
import type { ConnectorPipelineStep, AgentIR } from '@/lib/types/designTypes';
import type { BuilderState, BuilderUseCase, BuilderComponent, TriggerPreset, ComponentRole, CredentialCoverage, CoverageStatus } from './types';
import { INITIAL_BUILDER_STATE, TRIGGER_PRESETS, ERROR_STRATEGIES, REVIEW_POLICIES } from './types';

// ── Actions ─────────────────────────────────────────────────────────

export type BuilderAction =
  | { type: 'SET_INTENT'; payload: string }
  | { type: 'ADD_USE_CASE' }
  | { type: 'ADD_USE_CASE_WITH_DATA'; payload: { title: string; description: string; category?: string } }
  | { type: 'UPDATE_USE_CASE'; payload: { id: string; updates: Partial<BuilderUseCase> } }
  | { type: 'REMOVE_USE_CASE'; payload: string }
  | { type: 'REORDER_USE_CASES'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'ADD_COMPONENT'; payload: { role: ComponentRole; connectorName: string; credentialId: string | null } }
  | { type: 'REMOVE_COMPONENT'; payload: string } // component id
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

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${nextId++}`;
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

/** Map a suggested connector role string to our ComponentRole */
function inferRole(sc: { role?: string; category?: string; name: string }): ComponentRole {
  const r = (sc.role ?? sc.category ?? '').toLowerCase();
  if (r.includes('retriev') || r.includes('fetch') || r.includes('input') || r.includes('source')) return 'retrieve';
  if (r.includes('stor') || r.includes('database') || r.includes('save') || r.includes('persist')) return 'store';
  if (r.includes('notif') || r.includes('alert') || r.includes('message')) return 'notify';
  return 'act'; // default
}

function applyDesignResult(state: BuilderState, result: AgentIR): BuilderState {
  let next = { ...state };

  // Use cases
  const instructions = result.structured_prompt?.instructions;
  if (instructions && state.useCases.length === 0) {
    const lines = instructions.split('\n').filter((l) => l.trim().startsWith('-') || l.trim().startsWith('*'));
    const newCases: BuilderUseCase[] = lines.slice(0, 5).map((line) => ({
      id: makeId('uc'),
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

  // Connectors → components with inferred roles
  if (result.suggested_connectors?.length) {
    const existingNames = new Set(next.components.map((c) => c.connectorName));
    const newComponents: BuilderComponent[] = result.suggested_connectors
      .filter((sc) => !existingNames.has(sc.name))
      .map((sc) => ({
        id: makeId('comp'),
        role: inferRole(sc),
        connectorName: sc.name,
        credentialId: null,
      }));
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

  // Summary → intent
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
      // Prevent duplicate credential under same role
      if (credentialId && state.components.some(
        (c) => c.role === role && c.credentialId === credentialId,
      )) return state;
      // Prevent duplicate connector (no credential) under same role
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
      action_label: `[${comp.role}] ${comp.connectorName}`,
      order: i,
    }),
  );

  const credentialLinks: Record<string, string> = {};
  for (const comp of state.components) {
    if (comp.credentialId) {
      credentialLinks[comp.connectorName] = comp.credentialId;
    }
  }

  const watchedTables: Record<string, string[]> = {};
  for (const comp of state.components) {
    if (comp.watchedTables && comp.watchedTables.length > 0) {
      watchedTables[comp.connectorName] = comp.watchedTables;
    }
  }

  return {
    useCases: useCases.length > 0 ? useCases : undefined,
    connectorPipeline: connectorPipeline.length > 0 ? connectorPipeline : undefined,
    credentialLinks: Object.keys(credentialLinks).length > 0 ? credentialLinks : undefined,
    watchedTables: Object.keys(watchedTables).length > 0 ? watchedTables : undefined,
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
    lines.push(`## Components: ${state.components.map((c) => `${c.connectorName} (${c.role})`).join(', ')}`);
  }

  const dbComponents = state.components.filter((c) => c.watchedTables && c.watchedTables.length > 0);
  if (dbComponents.length > 0) {
    lines.push('');
    lines.push('## Database Tables');
    for (const comp of dbComponents) {
      lines.push(`- **${comp.connectorName}**: ${comp.watchedTables!.join(', ')}`);
    }
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

  return parts.join(' \u00b7 ');
}

// ── Credential Coverage ─────────────────────────────────────────

const BUILTIN_CONNECTORS = new Set(['in-app-messaging', 'http']);

export function computeCredentialCoverage(components: BuilderComponent[]): CredentialCoverage {
  const needsCred = components.filter((c) => !BUILTIN_CONNECTORS.has(c.connectorName));
  const total = needsCred.length;
  const matched = needsCred.filter((c) => c.credentialId !== null).length;
  const status: CoverageStatus =
    total === 0 ? 'none' : matched === total ? 'full' : matched > 0 ? 'partial' : 'none';
  return { total, matched, status };
}

export function computeRoleCoverage(components: BuilderComponent[], role: ComponentRole): CoverageStatus {
  const roleComps = components.filter((c) => c.role === role && !BUILTIN_CONNECTORS.has(c.connectorName));
  if (roleComps.length === 0) return 'none';
  return roleComps.every((c) => c.credentialId !== null) ? 'full' : roleComps.some((c) => c.credentialId !== null) ? 'partial' : 'none';
}
