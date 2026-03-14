import type { DesignContextData, DesignUseCase, BuilderMeta } from '@/lib/types/frontendTypes';
import type { ConnectorPipelineStep } from '@/lib/types/designTypes';
import type { BuilderState, TriggerPreset, BuilderComponent, ComponentRole, CredentialCoverage, CoverageStatus } from './types';
import { INITIAL_BUILDER_STATE, TRIGGER_PRESETS, ERROR_STRATEGIES, REVIEW_POLICIES } from './types';

// -- Trigger -> design context helper --

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

  // Preserve builder metadata for round-trip reconstruction
  const componentRoles: Record<string, string> = {};
  for (const comp of state.components) {
    componentRoles[comp.connectorName] = comp.role;
  }

  const builderMeta: BuilderMeta = {
    errorStrategy: state.errorStrategy,
    reviewPolicy: state.reviewPolicy,
    channels: state.channels.length > 0 ? state.channels : undefined,
    globalTrigger: state.globalTrigger,
    componentRoles,
  };

  return {
    useCases: useCases.length > 0 ? useCases : undefined,
    connectorPipeline: connectorPipeline.length > 0 ? connectorPipeline : undefined,
    credentialLinks: Object.keys(credentialLinks).length > 0 ? credentialLinks : undefined,
    watchedTables: Object.keys(watchedTables).length > 0 ? watchedTables : undefined,
    summary: state.intent.trim() || generateSummary(state) || undefined,
    builderMeta,
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

// -- Round-trip: reconstruct BuilderState from design_context --------

let _ucSeq = 0;
let _compSeq = 0;

function suggestedToTrigger(suggested: { type?: string; cron?: string; description?: string } | undefined): TriggerPreset | null {
  if (!suggested) return null;
  // Try to match an existing preset
  if (suggested.cron) {
    const match = TRIGGER_PRESETS.find((p) => p.cron === suggested.cron);
    if (match) return match;
    return { label: suggested.description || suggested.cron, type: (suggested.type as TriggerPreset['type']) || 'schedule', cron: suggested.cron };
  }
  if (suggested.type === 'webhook') return TRIGGER_PRESETS.find((p) => p.type === 'webhook') ?? { label: 'On webhook', type: 'webhook' };
  return null;
}

/**
 * Reconstruct a BuilderState from a stored DesignContextData.
 * Recovers as much state as possible; fields not stored in builderMeta
 * fall back to defaults.
 */
export function fromDesignContext(data: DesignContextData): BuilderState {
  const meta = data.builderMeta;

  const useCases = (data.useCases ?? []).map((uc) => ({
    id: uc.id || `uc_resume_${++_ucSeq}`,
    title: uc.title,
    description: uc.description || '',
    category: uc.category || 'automation',
    executionMode: (uc.execution_mode as 'e2e' | 'mock' | 'non_executable') || 'e2e',
    trigger: suggestedToTrigger(uc.suggested_trigger),
  }));

  const components: BuilderComponent[] = (data.connectorPipeline ?? []).map((pipe) => {
    const roleStr = meta?.componentRoles?.[pipe.connector_name];
    // action_label format is "[role] connectorName" — fallback parse
    const parsedRole = !roleStr && pipe.action_label
      ? (pipe.action_label.match(/^\[(\w+)\]/)?.[1] as ComponentRole | undefined)
      : undefined;
    const role: ComponentRole = (roleStr as ComponentRole) || parsedRole || 'act';

    return {
      id: `comp_resume_${++_compSeq}`,
      role,
      connectorName: pipe.connector_name,
      credentialId: data.credentialLinks?.[pipe.connector_name] ?? null,
      watchedTables: data.watchedTables?.[pipe.connector_name],
    };
  });

  // Ensure default notify component exists
  if (!components.some((c) => c.connectorName === 'in-app-messaging')) {
    components.unshift({ id: 'default_notify', role: 'notify', connectorName: 'in-app-messaging', credentialId: null });
  }

  return {
    intent: data.summary ?? '',
    useCases,
    components,
    globalTrigger: meta?.globalTrigger ? suggestedToTrigger(meta.globalTrigger) : null,
    channels: meta?.channels ?? [],
    errorStrategy: meta?.errorStrategy ?? INITIAL_BUILDER_STATE.errorStrategy,
    reviewPolicy: meta?.reviewPolicy ?? INITIAL_BUILDER_STATE.reviewPolicy,
  };
}

// -- Credential Coverage --

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
