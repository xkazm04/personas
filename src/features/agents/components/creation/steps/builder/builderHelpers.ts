import type { DesignContextData, DesignUseCase } from '@/lib/types/frontendTypes';
import type { ConnectorPipelineStep } from '@/lib/types/designTypes';
import type { BuilderState, TriggerPreset, BuilderComponent, ComponentRole, CredentialCoverage, CoverageStatus } from './types';
import { ERROR_STRATEGIES, REVIEW_POLICIES } from './types';

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
