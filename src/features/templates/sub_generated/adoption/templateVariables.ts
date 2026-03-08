import type { AdoptionRequirement, ConnectorPipelineStep, DesignAnalysisResult, StructuredPromptSection, SuggestedTrigger } from '@/lib/types/designTypes';
import { sanitizeVariableValues, validateAllVariables } from '@/lib/utils/variableSanitizer';

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

/**
 * Validate all variables against their typed schemas.
 * Returns per-field error messages in addition to missing-field checks.
 */
export function validateVariablesTyped(
  requirements: AdoptionRequirement[],
  values: Record<string, string>,
): { valid: boolean; missing: string[]; errors: Record<string, string> } {
  // Presence check (existing behavior)
  const { missing } = validateVariables(requirements, values);
  // Type-aware validation
  const { errors } = validateAllVariables(requirements, values);
  const allValid = missing.length === 0 && Object.keys(errors).length === 0;
  return { valid: allValid, missing, errors };
}

/** Replace all {{key}} occurrences in a string with the provided values */
function replaceVars(text: string, values: Record<string, string>): string {
  return text.replace(VAR_PATTERN, (match, key: string) => {
    const val = values[key];
    return val !== undefined ? val : match;
  });
}

/**
 * Filter a DesignAnalysisResult to only include user-selected entities.
 *
 * **Connector swap contract**: `connectorSwaps` maps an original connector name
 * to a replacement name (e.g. `{ "Slack": "Discord" }`). When a swap is present,
 * the original connector is kept in the filtered result if either it or its
 * replacement is selected, and its `name` is rewritten to the replacement.
 * The same rename is applied to `service_flow` pipeline steps.
 *
 * This is distinct from credential mapping (`connectorCredentialMap`), which
 * links a connector name to a credential ID for authentication.
 */
export function filterDesignResult(
  design: DesignAnalysisResult,
  selections: {
    selectedToolIndices: Set<number>;
    selectedTriggerIndices: Set<number>;
    selectedConnectorNames: Set<string>;
    selectedChannelIndices: Set<number>;
    selectedEventIndices: Set<number>;
  },
  connectorSwaps?: Record<string, string>,
): DesignAnalysisResult {
  let filteredConnectors = design.suggested_connectors?.filter((c) => {
    // Keep if directly selected, or if its swap replacement is selected
    if (selections.selectedConnectorNames.has(c.name)) return true;
    const replacement = connectorSwaps?.[c.name];
    return replacement ? selections.selectedConnectorNames.has(replacement) : false;
  });

  // Apply swaps: rename original connector to its replacement
  if (connectorSwaps && Object.keys(connectorSwaps).length > 0 && filteredConnectors) {
    filteredConnectors = filteredConnectors.map((c) => {
      const replacement = connectorSwaps[c.name];
      return replacement ? { ...c, name: replacement } : c;
    });
  }

  // Apply connector swaps to service_flow pipeline steps
  let filteredPipeline: ConnectorPipelineStep[] | undefined = design.service_flow;
  if (connectorSwaps && Object.keys(connectorSwaps).length > 0 && filteredPipeline) {
    filteredPipeline = filteredPipeline.map((step) => {
      const replacement = connectorSwaps[step.connector_name];
      return replacement ? { ...step, connector_name: replacement } : step;
    });
  }

  return {
    ...design,
    suggested_tools: design.suggested_tools.filter((_, i) => selections.selectedToolIndices.has(i)),
    suggested_triggers: design.suggested_triggers.filter((_, i) => selections.selectedTriggerIndices.has(i)),
    suggested_connectors: filteredConnectors,
    suggested_notification_channels: design.suggested_notification_channels?.filter((_, i) => selections.selectedChannelIndices.has(i)),
    suggested_event_subscriptions: design.suggested_event_subscriptions?.filter((_, i) => selections.selectedEventIndices.has(i)),
    service_flow: filteredPipeline,
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
  // Sanitize all values before substitution to prevent prompt injection
  const requirements = design.adoption_requirements ?? [];
  const sanitized = sanitizeVariableValues(requirements, values);

  const sp = design.structured_prompt;
  const substitutedSections: StructuredPromptSection[] = (sp.customSections ?? []).map((s) => ({
    ...s,
    content: replaceVars(s.content, sanitized),
  }));

  return {
    ...design,
    structured_prompt: {
      identity: replaceVars(sp.identity, sanitized),
      instructions: replaceVars(sp.instructions, sanitized),
      toolGuidance: replaceVars(sp.toolGuidance, sanitized),
      examples: replaceVars(sp.examples, sanitized),
      errorHandling: replaceVars(sp.errorHandling, sanitized),
      customSections: substitutedSections,
    },
    full_prompt_markdown: replaceVars(design.full_prompt_markdown, sanitized),
    summary: replaceVars(design.summary, sanitized),
  };
}
