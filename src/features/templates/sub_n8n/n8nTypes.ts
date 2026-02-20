import type { N8nPersonaDraft } from '@/api/tauriApi';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

export type EditableCustomSection = {
  key: string;
  label: string;
  content: string;
};

export type EditableStructuredPrompt = {
  identity: string;
  instructions: string;
  toolGuidance: string;
  examples: string;
  errorHandling: string;
  customSections: EditableCustomSection[];
};

export const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
export const asNullableString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : null;
};
export const asNullableNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function toEditableStructuredPrompt(value: Record<string, unknown> | null): EditableStructuredPrompt {
  const src = value ?? {};
  const rawCustom = Array.isArray(src.customSections) ? src.customSections : [];

  return {
    identity: asString(src.identity),
    instructions: asString(src.instructions),
    toolGuidance: asString(src.toolGuidance),
    examples: asString(src.examples),
    errorHandling: asString(src.errorHandling),
    customSections: rawCustom
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        key: asString(entry.key),
        label: asString(entry.label || entry.title),
        content: asString(entry.content),
      })),
  };
}

export function fromEditableStructuredPrompt(value: EditableStructuredPrompt): Record<string, unknown> {
  return {
    identity: value.identity,
    instructions: value.instructions,
    toolGuidance: value.toolGuidance,
    examples: value.examples,
    errorHandling: value.errorHandling,
    customSections: value.customSections
      .filter((section) => section.label.trim() || section.key.trim() || section.content.trim())
      .map((section) => ({
        key: section.key,
        label: section.label,
        content: section.content,
      })),
  };
}

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
};
