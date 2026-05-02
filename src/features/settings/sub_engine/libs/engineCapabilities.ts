/**
 * Engine capability map -- defines which CLI operations each provider supports.
 *
 * Defaults are derived from Round 9 business-level integration tests (9 operations × 3 providers).
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

/** i18n keys on t.settings.engine for each operation's display strings.
 *  Per-op since labels and descriptions translate independently of the
 *  CliOperation id (which is a backend identifier). */
export type CliOperationLabelKey =
  | 'op_persona_execution_label' | 'op_design_analysis_label' | 'op_credential_design_label'
  | 'op_credential_healthcheck_label' | 'op_n8n_transform_label' | 'op_template_adopt_label'
  | 'op_test_generation_label' | 'op_healing_analysis_label' | 'op_recipe_execution_label'
  | 'op_query_debug_label';
export type CliOperationDescriptionKey =
  | 'op_persona_execution_description' | 'op_design_analysis_description' | 'op_credential_design_description'
  | 'op_credential_healthcheck_description' | 'op_n8n_transform_description' | 'op_template_adopt_description'
  | 'op_test_generation_description' | 'op_healing_analysis_description' | 'op_recipe_execution_description'
  | 'op_query_debug_description';

export interface CliOperationMeta {
  id: CliOperation;
  labelKey: CliOperationLabelKey;
  descriptionKey: CliOperationDescriptionKey;
}

export const CLI_OPERATIONS: CliOperationMeta[] = [
  { id: 'persona_execution',      labelKey: 'op_persona_execution_label',      descriptionKey: 'op_persona_execution_description' },
  { id: 'design_analysis',        labelKey: 'op_design_analysis_label',        descriptionKey: 'op_design_analysis_description' },
  { id: 'credential_design',      labelKey: 'op_credential_design_label',      descriptionKey: 'op_credential_design_description' },
  { id: 'credential_healthcheck', labelKey: 'op_credential_healthcheck_label', descriptionKey: 'op_credential_healthcheck_description' },
  { id: 'n8n_transform',          labelKey: 'op_n8n_transform_label',          descriptionKey: 'op_n8n_transform_description' },
  { id: 'template_adopt',         labelKey: 'op_template_adopt_label',         descriptionKey: 'op_template_adopt_description' },
  { id: 'test_generation',        labelKey: 'op_test_generation_label',        descriptionKey: 'op_test_generation_description' },
  { id: 'healing_analysis',       labelKey: 'op_healing_analysis_label',       descriptionKey: 'op_healing_analysis_description' },
  { id: 'recipe_execution',       labelKey: 'op_recipe_execution_label',       descriptionKey: 'op_recipe_execution_description' },
  { id: 'query_debug',            labelKey: 'op_query_debug_label',            descriptionKey: 'op_query_debug_description' },
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
 * Codex CLI removed — all execution uses Claude Code CLI only.
 */
export const DEFAULT_CAPABILITIES: EngineCapabilityMap = {
  design_analysis:        { claude_code: true, ollama: false },
  credential_design:      { claude_code: true, ollama: false },
  credential_healthcheck: { claude_code: true, ollama: false },
  n8n_transform:          { claude_code: true, ollama: false },
  test_generation:        { claude_code: true, ollama: false },
  persona_execution:      { claude_code: true, ollama: false },
  template_adopt:         { claude_code: true, ollama: false },
  query_debug:            { claude_code: true, ollama: false },
  healing_analysis:       { claude_code: true, ollama: false },
  recipe_execution:       { claude_code: true, ollama: false },
};

/** Settings key for the persisted capability map */
export const CAPABILITY_SETTING_KEY = 'engine_capabilities';

/**
 * Merge saved overrides with defaults.
 *
 * Iterates the canonical CLI_OPERATIONS list (not Object.keys(saved)), so
 * any saved entry whose op.id no longer exists in CLI_OPERATIONS is silently
 * dropped. This is intentional defense against stale schema (a removed
 * operation shouldn't reanimate via storage), but the silent drop hides
 * downgrade-then-upgrade losses — if you remove an operation, ship a
 * migration if the user's choice for that op should carry forward.
 */
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

/**
 * Get the best available provider for an operation.
 *
 * Single-provider state since Codex removal — PROVIDERS contains only
 * `claude_code`. The previous implementation had a fallback `for (const p of
 * PROVIDERS)` loop after the explicit Claude check, which iterated exactly
 * one element that was already returned by the check above. Restore the
 * loop if PROVIDERS gains entries.
 */
export function getPreferredProvider(
  map: EngineCapabilityMap,
  operation: CliOperation,
  installedProviders: Set<CliEngine>,
): CliEngine | null {
  if (isOperationEnabled(map, operation, 'claude_code', installedProviders)) {
    return 'claude_code';
  }
  return null;
}
