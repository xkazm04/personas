import type { AdoptionRequirement, ConnectorPipelineStep, AgentIR, StructuredPromptSection, SuggestedTrigger } from '@/lib/types/designTypes';
import { sanitizeVariableValues, validateAllVariables } from '@/lib/utils/variableSanitizer';

const VAR_PATTERN = /\{\{(\w+)\}\}/g;

/** Extract adoption_requirements from an AgentIR */
export function getAdoptionRequirements(design: AgentIR): AdoptionRequirement[] {
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
 * Filter an AgentIR to only include user-selected entities.
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
  design: AgentIR,
  selections: {
    selectedToolIndices: Set<number>;
    selectedTriggerIndices: Set<number>;
    selectedConnectorNames: Set<string>;
    selectedChannelIndices: Set<number>;
    selectedEventIndices: Set<number>;
  },
  connectorSwaps?: Record<string, string>,
): AgentIR {
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

  // Apply connector swaps to service_flow pipeline steps and filter out deselected connectors (Area #16)
  const activeConnectorNames = new Set(filteredConnectors?.map((c) => c.name) ?? []);
  let filteredPipeline: ConnectorPipelineStep[] | undefined = design.service_flow;
  if (filteredPipeline) {
    // Apply swaps first
    if (connectorSwaps && Object.keys(connectorSwaps).length > 0) {
      filteredPipeline = filteredPipeline.map((step) => {
        const replacement = connectorSwaps[step.connector_name];
        return replacement ? { ...step, connector_name: replacement } : step;
      });
    }
    // Then filter out steps whose connector was deselected
    filteredPipeline = filteredPipeline.filter((step) =>
      !step.connector_name || activeConnectorNames.has(step.connector_name),
    );
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
  design: AgentIR,
  values: Record<string, string>,
): AgentIR {
  // Sanitize all values before substitution to prevent prompt injection
  const requirements = design.adoption_requirements ?? [];
  const sanitized = sanitizeVariableValues(requirements, values);

  const sp = design.structured_prompt;
  const substitutedSections: StructuredPromptSection[] = (sp.customSections ?? []).map((s) => ({
    ...s,
    content: replaceVars(s.content, sanitized),
  }));

  // Phase C (Area #8) — substitute variables in tool names, trigger descriptions/configs,
  // connector setup instructions, and adoption questions
  const substitutedTools = design.suggested_tools.map((t) => replaceVars(t, sanitized));

  const substitutedTriggers = design.suggested_triggers.map((t) => ({
    ...t,
    description: replaceVars(t.description, sanitized),
    config: Object.fromEntries(
      Object.entries(t.config).map(([k, v]) => [k, typeof v === 'string' ? replaceVars(v, sanitized) : v]),
    ),
  }));

  const substitutedConnectors = design.suggested_connectors?.map((c) => ({
    ...c,
    setup_instructions: c.setup_instructions ? replaceVars(c.setup_instructions, sanitized) : c.setup_instructions,
  }));

  const substitutedQuestions = design.adoption_questions?.map((q) => ({
    ...q,
    question: replaceVars(q.question, sanitized),
    context: q.context ? replaceVars(q.context, sanitized) : q.context,
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
    suggested_tools: substitutedTools,
    suggested_triggers: substitutedTriggers,
    suggested_connectors: substitutedConnectors,
    adoption_questions: substitutedQuestions,
    full_prompt_markdown: replaceVars(design.full_prompt_markdown, sanitized),
    summary: replaceVars(design.summary, sanitized),
  };
}
