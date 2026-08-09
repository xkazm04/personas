import { invokeWithTimeout } from '@/lib/tauriInvoke';
import type { RecipeParameterCoverage } from '@/lib/bindings/RecipeParameterCoverage';

/**
 * How completely a recipe's declared `input_schema` settings survive adoption.
 *
 * Adoption derives the persona's editable knobs from the recipe's
 * `input_schema`, but three declared types (`source_definition`,
 * `connector_ref`, `list[string]`) have no persona ParamType and are dropped.
 * Before this existed the only trace was a backend `tracing::debug!` line: the
 * user adopted a capability, went looking for the settings the catalog
 * promised, and simply did not find them.
 *
 * The supported-type list deliberately lives ONLY in Rust
 * (`engine::recipe_parameters::params_from_schema`) so it cannot drift from
 * what actually runs. This module just asks.
 *
 * NOTE: normally an `invoke` wrapper like this would live in `src/api/`. It
 * sits here because the catalog is its only consumer; promote it to
 * `src/api/recipes/` the moment a second surface needs it.
 */
export const getRecipeParameterCoverage = (recipeId: string) =>
  invokeWithTimeout<RecipeParameterCoverage>('get_recipe_parameter_coverage', {
    recipeId,
  });

/** A recipe whose settings did not fully materialize, ready for display. */
export interface CoverageGap {
  /** How many declared settings could not be created. */
  missing: number;
  /** How many the recipe declared in total. */
  declared: number;
  /** The distinct unsupported type tokens that caused the drop, deduped. */
  types: string[];
}

/**
 * Reduce a coverage report to a displayable gap, or `null` when every declared
 * setting became an editable knob (the common case: 572 of the 594 fields in
 * the seeded catalog are supported types).
 */
export function coverageGap(
  coverage: RecipeParameterCoverage | null | undefined,
): CoverageGap | null {
  if (!coverage || coverage.skipped.length === 0) return null;
  const types: string[] = [];
  for (const field of coverage.skipped) {
    if (!types.includes(field.declared_type)) types.push(field.declared_type);
  }
  return {
    missing: coverage.skipped.length,
    declared: coverage.declared,
    types,
  };
}
