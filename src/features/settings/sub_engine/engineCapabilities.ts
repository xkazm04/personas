/**
 * Engine capability map -- defines which CLI operations each provider supports.
 *
 * Defaults are derived from Round 9 business-level integration tests.
 * Claude Sonnet 4.6: 9/9 passed (100%) -- all operations enabled
 *
 * Users can override these defaults via the Engine settings UI.
 * The map is stored as a JSON string in app_settings under key "engine_capabilities".
 */
import type { CliEngine } from '@/lib/types/types';

// ===========================================================================
// CLI Operations -- every backend dispatch point that invokes a CLI provider
// ===========================================================================

export type CliOperation =
  | 'persona_execution'
  | 'design_analysis'
  | 'credential_design'
  | 'credential_healthcheck'
  | 'n8n_transform'
  | 'template_adopt'
  | 'test_generation'
  | 'healing_analysis'
  | 'recipe_execution'
  | 'query_debug';

export interface CliOperationMeta {
  id: CliOperation;
  label: string;
  description: string;
}

export const CLI_OPERATIONS: CliOperationMeta[] = [
  {
    id: 'persona_execution',
    label: 'Persona Execution',
    description: 'Protocol-compliant output with outcome_assessment, user_message, agent_memory',
  },
  {
    id: 'design_analysis',
    label: 'Persona Design',
    description: 'Structured prompts from persona briefs -- DESIGN_OUTPUT_SCHEMA JSON',
  },
  {
    id: 'credential_design',
    label: 'Credential Design',
    description: 'Connector definitions with fields, healthchecks -- CREDENTIAL_DESIGN_OUTPUT_SCHEMA',
  },
  {
    id: 'credential_healthcheck',
    label: 'Credential Healthcheck',
    description: 'API healthcheck endpoint design with {{field_key}} placeholders',
  },
  {
    id: 'n8n_transform',
    label: 'N8N Transform',
    description: 'TRANSFORM_QUESTIONS or section-delimited persona from n8n workflows',
  },
  {
    id: 'template_adopt',
    label: 'Template Adoption',
    description: 'TRANSFORM_QUESTIONS or persona JSON from template definitions',
  },
  {
    id: 'test_generation',
    label: 'Test Scenario Generation',
    description: 'TestScenario[] with mock tools, expected_tool_sequence, edge cases',
  },
  {
    id: 'healing_analysis',
    label: 'Healing Diagnosis',
    description: 'Root-cause analysis from error logs and connector failures',
  },
  {
    id: 'recipe_execution',
    label: 'Recipe Execution',
    description: 'Run automation recipes with prompt templates and input schemas',
  },
  {
    id: 'query_debug',
    label: 'Query Debug',
    description: 'Fix broken SQL in ```sql code blocks -- rejects JS/TS/Python output',
  },
];

// ===========================================================================
// Provider metadata
// ===========================================================================

export interface ProviderMeta {
  id: CliEngine;
  label: string;
  shortLabel: string;
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'claude_code', label: 'Claude Code CLI', shortLabel: 'Claude' },
];

// ===========================================================================
// Capability map type
// ===========================================================================

/** Per-operation, per-provider enabled flag */
export type EngineCapabilityMap = Record<CliOperation, Record<CliEngine, boolean>>;

/**
 * Default capability map based on Round 9 integration test results.
 * All 10 operations now have test coverage (9 from Round 9, healing/recipe from Round 8).
 *
 * Claude Sonnet 4.6: 9/9 (100%) -- all A grades
 *
 * Codex CLI is excluded (deprecated/untested).
 */
export const DEFAULT_CAPABILITIES: EngineCapabilityMap = {
  //                                claude    codex
  design_analysis:        { claude_code: true,  codex_cli: false },
  credential_design:      { claude_code: true,  codex_cli: false },
  credential_healthcheck: { claude_code: true,  codex_cli: false },
  n8n_transform:          { claude_code: true,  codex_cli: false },
  test_generation:        { claude_code: true,  codex_cli: false },
  persona_execution:      { claude_code: true,  codex_cli: false },
  template_adopt:         { claude_code: true,  codex_cli: false },
  query_debug:            { claude_code: true,  codex_cli: false },

  // Round 8 tested (generic tasks)
  healing_analysis:       { claude_code: true,  codex_cli: false },
  recipe_execution:       { claude_code: true,  codex_cli: false },
};

/** Settings key for the persisted capability map */
export const CAPABILITY_SETTING_KEY = 'engine_capabilities';

/** Merge saved overrides with defaults (handles new operations added after save) */
export function mergeCapabilities(saved: Partial<EngineCapabilityMap>): EngineCapabilityMap {
  const result = { ...DEFAULT_CAPABILITIES };
  for (const op of CLI_OPERATIONS) {
    if (saved[op.id]) {
      result[op.id] = { ...result[op.id], ...saved[op.id] };
    }
  }
  return result;
}

/** Check if a specific provider is enabled for a specific operation */
export function isOperationEnabled(
  map: EngineCapabilityMap,
  operation: CliOperation,
  provider: CliEngine,
  installedProviders: Set<CliEngine>,
): boolean {
  if (!installedProviders.has(provider)) return false;
  return map[operation]?.[provider] ?? false;
}

/** Get the best available provider for an operation (prefers Claude, then first enabled) */
export function getPreferredProvider(
  map: EngineCapabilityMap,
  operation: CliOperation,
  installedProviders: Set<CliEngine>,
): CliEngine | null {
  // Prefer Claude
  if (isOperationEnabled(map, operation, 'claude_code', installedProviders)) {
    return 'claude_code';
  }
  // Fall back to first enabled
  for (const p of PROVIDERS) {
    if (isOperationEnabled(map, operation, p.id, installedProviders)) {
      return p.id;
    }
  }
  return null;
}
