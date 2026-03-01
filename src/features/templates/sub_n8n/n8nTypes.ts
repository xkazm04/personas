import type { N8nPersonaDraft } from '@/api/tauriApi';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { WorkflowPlatform } from '@/lib/personas/workflowDetector';
import {
  toEditableStructuredPrompt,
  fromEditableStructuredPrompt,
} from '@/lib/personas/promptMigration';

// Re-export StructuredPrompt types from the canonical module
export type { EditableCustomSection, EditableStructuredPrompt } from '@/lib/personas/promptMigration';
export { toEditableStructuredPrompt, fromEditableStructuredPrompt };

export const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
export const asNullableString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
};
export const asNullableNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function normalizeDraftFromUnknown(value: unknown): N8nPersonaDraft | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (typeof record.system_prompt !== 'string') return null;

  const structuredPrompt =
    record.structured_prompt && typeof record.structured_prompt === 'object'
      ? fromEditableStructuredPrompt(
          toEditableStructuredPrompt(record.structured_prompt as Record<string, unknown>),
        )
      : null;

  return {
    name: asNullableString(record.name),
    description: asNullableString(record.description),
    system_prompt: record.system_prompt,
    structured_prompt: structuredPrompt,
    icon: asNullableString(record.icon),
    color: asNullableString(record.color),
    model_profile: asNullableString(record.model_profile),
    max_budget_usd: asNullableNumber(record.max_budget_usd),
    max_turns:
      typeof record.max_turns === 'number' && Number.isInteger(record.max_turns)
        ? record.max_turns
        : null,
    design_context: asNullableString(record.design_context),
    // Pass through entity fields from Rust N8nPersonaOutput
    tools: Array.isArray(record.tools) ? record.tools as N8nPersonaDraft['tools'] : undefined,
    triggers: Array.isArray(record.triggers) ? record.triggers as N8nPersonaDraft['triggers'] : undefined,
    required_connectors: Array.isArray(record.required_connectors) ? record.required_connectors as N8nPersonaDraft['required_connectors'] : undefined,
  };
}

export function normalizeDraft(draft: N8nPersonaDraft): N8nPersonaDraft {
  return {
    ...draft,
    system_prompt: draft.system_prompt || '',
    structured_prompt: draft.structured_prompt
      ? fromEditableStructuredPrompt(toEditableStructuredPrompt(draft.structured_prompt))
      : null,
  };
}

export function stringifyDraft(draft: N8nPersonaDraft): string {
  return JSON.stringify(draft, null, 2);
}

export const N8N_TRANSFORM_CONTEXT_KEY = 'n8n-transform-context-v1';

export type PersistedTransformContext = {
  transformId: string;
  workflowName: string;
  rawWorkflowJson: string;
  parsedResult: DesignAnalysisResult;
  /** Detected source platform */
  platform?: WorkflowPlatform;
  /** Timestamp when context was persisted (ms since epoch) */
  savedAt?: number;
};

/** Max age for persisted context before it's considered stale (10 minutes) */
export const TRANSFORM_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;
