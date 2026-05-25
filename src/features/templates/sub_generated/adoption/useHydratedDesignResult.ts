import { useEffect, useState } from 'react';
import { listRecipes } from '@/api/recipes/recipes';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Adoption-time recipe-ref hydration.
 *
 * Templates store their capabilities as `recipe_ref` pointers
 * (`{ recipe_ref: { id, version, bindings } }`) after the Stage-B recipe
 * migration, and `seedTemplates.ts` persists that raw payload verbatim into
 * `review.design_result`. The backend expands those refs at adopt/build time
 * (`engine::template_v3::hydrate_recipe_refs`), but the **adoption
 * questionnaire renders before that** — so without hydrating here the
 * capability rows (`designResult.use_cases`) have no top-level `id`/`title`,
 * the Persona Layout's `items` come out empty, and the user sees
 * "All capabilities are skipped — enable at least one to continue." even
 * though the template clearly declares capabilities.
 *
 * This mirrors the Rust hydration on the frontend: fetch the recipe rows once
 * (`list_recipes`), replace each `recipe_ref` use case with the inline UC
 * stored in `recipe.prompt_template`, and apply any `{{placeholder}}` bindings.
 *
 * Keyed on the raw JSON string (stable across renders, unlike a re-parsed
 * object). Returns the parsed result immediately (with raw refs) and swaps in
 * the hydrated version once recipes load; falls back to the raw parse on any
 * failure so adoption is never fully blocked.
 */
function parse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasRecipeRefs(dr: Record<string, unknown> | null): boolean {
  const ucs = dr?.use_cases;
  return (
    Array.isArray(ucs) &&
    ucs.some((uc) => uc && typeof uc === 'object' && 'recipe_ref' in (uc as object))
  );
}

/** Substitute `{{key}}` placeholders in a serialized UC with binding values —
 *  string-level, mirroring `engine::template_v3::apply_bindings`. */
function applyBindings(uc: unknown, bindings: Record<string, unknown> | undefined): unknown {
  if (!bindings || Object.keys(bindings).length === 0) return uc;
  let serialized = JSON.stringify(uc);
  for (const [key, value] of Object.entries(bindings)) {
    const replacement = typeof value === 'string' ? value : JSON.stringify(value);
    serialized = serialized.split(`{{${key}}}`).join(replacement);
  }
  try {
    return JSON.parse(serialized);
  } catch {
    return uc;
  }
}

export function useHydratedDesignResult(
  designResultJson: string | null,
): Record<string, unknown> | null {
  const [result, setResult] = useState<Record<string, unknown> | null>(() => parse(designResultJson));

  useEffect(() => {
    const parsed = parse(designResultJson);
    if (!parsed || !hasRecipeRefs(parsed)) {
      setResult(parsed);
      return;
    }
    // Surface the raw parse immediately so the questionnaire (whose
    // adoption_questions live at the top level, untouched by hydration) is
    // interactive while recipes load.
    setResult(parsed);

    let cancelled = false;
    (async () => {
      try {
        const recipes = await listRecipes();
        if (cancelled) return;
        const byId = new Map(recipes.map((r) => [r.id, r]));
        const ucs = (parsed.use_cases ?? []) as Array<Record<string, unknown>>;
        const hydrated = ucs.map((uc) => {
          const ref = (uc?.recipe_ref ?? null) as { id?: string; bindings?: Record<string, unknown> } | null;
          if (!ref?.id) return uc;
          const recipe = byId.get(ref.id);
          if (!recipe?.prompt_template) return uc;
          try {
            const inline = JSON.parse(recipe.prompt_template);
            return applyBindings(inline, ref.bindings);
          } catch {
            return uc;
          }
        });
        setResult({ ...parsed, use_cases: hydrated });
      } catch (err) {
        silentCatch('useHydratedDesignResult')(err);
        // Leave the raw parse in place — adoption proceeds, capabilities just
        // stay collapsed until a working recipe lookup is available.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [designResultJson]);

  return result;
}
