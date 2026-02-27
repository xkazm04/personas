import type { AdoptionRequirement, DesignAnalysisResult, StructuredPromptSection, SuggestedTrigger } from '@/lib/types/designTypes';

const VAR_PATTERN = /\{\{(\w+)\}\}/g;

/** Extract adoption_requirements from a DesignAnalysisResult */
export function getAdoptionRequirements(design: DesignAnalysisResult): AdoptionRequirement[] {
  return design.adoption_requirements ?? [];
}

/** Build initial values map from defaults in requirements */
export function getDefaultValues(requirements: AdoptionRequirement[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const req of requirements) {
    if (req.default_value) values[req.key] = req.default_value;
  }
  return values;
}

/** Validate that all required variables have non-empty values */
export function validateVariables(
  requirements: AdoptionRequirement[],
  values: Record<string, string>,
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const req of requirements) {
    if (req.required && !values[req.key]?.trim()) {
      missing.push(req.key);
    }
  }
  return { valid: missing.length === 0, missing };
}

/** Replace all {{key}} occurrences in a string with the provided values */
function replaceVars(text: string, values: Record<string, string>): string {
  return text.replace(VAR_PATTERN, (match, key: string) => {
    const val = values[key];
    return val !== undefined ? val : match;
  });
}

/**
 * Substitute {{key}} placeholders in all text fields of a DesignAnalysisResult.
 * Returns a NEW DesignAnalysisResult with variables replaced.
 */
/** Filter a DesignAnalysisResult to only include user-selected entities */
export function filterDesignResult(
  design: DesignAnalysisResult,
  selections: {
    selectedToolIndices: Set<number>;
    selectedTriggerIndices: Set<number>;
    selectedConnectorNames: Set<string>;
    selectedChannelIndices: Set<number>;
    selectedEventIndices: Set<number>;
  },
): DesignAnalysisResult {
  return {
    ...design,
    suggested_tools: design.suggested_tools.filter((_, i) => selections.selectedToolIndices.has(i)),
    suggested_triggers: design.suggested_triggers.filter((_, i) => selections.selectedTriggerIndices.has(i)),
    suggested_connectors: design.suggested_connectors?.filter((c) => selections.selectedConnectorNames.has(c.name)),
    suggested_notification_channels: design.suggested_notification_channels?.filter((_, i) => selections.selectedChannelIndices.has(i)),
    suggested_event_subscriptions: design.suggested_event_subscriptions?.filter((_, i) => selections.selectedEventIndices.has(i)),
  };
}

/** Merge user trigger configs into the selected triggers */
export function applyTriggerConfigs(
  triggers: SuggestedTrigger[],
  configs: Record<number, Record<string, string>>,
): SuggestedTrigger[] {
  return triggers.map((t, i) => configs[i] ? { ...t, config: { ...t.config, ...configs[i] } } : t);
}

export function substituteVariables(
  design: DesignAnalysisResult,
  values: Record<string, string>,
): DesignAnalysisResult {
  const sp = design.structured_prompt;
  const substitutedSections: StructuredPromptSection[] = (sp.customSections ?? []).map((s) => ({
    ...s,
    content: replaceVars(s.content, values),
  }));

  return {
    ...design,
    structured_prompt: {
      identity: replaceVars(sp.identity, values),
      instructions: replaceVars(sp.instructions, values),
      toolGuidance: replaceVars(sp.toolGuidance, values),
      examples: replaceVars(sp.examples, values),
      errorHandling: replaceVars(sp.errorHandling, values),
      customSections: substitutedSections,
    },
    full_prompt_markdown: replaceVars(design.full_prompt_markdown, values),
    summary: replaceVars(design.summary, values),
  };
}
