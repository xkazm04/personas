import { useCallback, useEffect, useState } from 'react';
import {
  createRecipe,
  deleteRecipe,
  getCredentialRecipes,
} from '@/api/recipes/recipes';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { useRecipeGenerator } from '@/hooks/design/template/useRecipeGenerator';
import { getActiveTranslations, useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { silentCatch } from '@/lib/silentCatch';

/**
 * The credential playground's recipe lane.
 *
 * Everything this composes already shipped and none of it was reachable:
 * `RecipeCreateFlow` and `RecipeListItem` had no consumer anywhere in `src/`,
 * `getCredentialRecipes` exists for exactly this credential-scoped list, and
 * `vault.shared` already carried a full panel's worth of translated copy
 * (`recipes`, `no_recipes`, `create_first_recipe`, `failed_delete_recipe`, ...)
 * that nothing rendered. A working request in the explorer could only become an
 * automation by retyping it in another part of the app.
 */
export function useCredentialRecipes(credentialId: string) {
  const { t } = useTranslation();
  const generator = useRecipeGenerator();

  const [recipes, setRecipes] = useState<RecipeDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRecipes(await getCredentialRecipes(credentialId));
    } catch (err) {
      silentCatch('useCredentialRecipes:getCredentialRecipes')(err);
    } finally {
      setIsLoading(false);
    }
  }, [credentialId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    getCredentialRecipes(credentialId)
      .then((rows) => { if (!cancelled) setRecipes(rows); })
      .catch(silentCatch('useCredentialRecipes:getCredentialRecipes'))
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [credentialId]);

  /** Open the create flow, optionally seeded from what the user just ran. */
  const beginCreate = useCallback((seedDescription = '') => {
    generator.reset();
    setError(null);
    setDescription(seedDescription);
    setIsCreating(true);
  }, [generator]);

  const cancelCreate = useCallback(() => {
    generator.cancel();
    generator.reset();
    setIsCreating(false);
    setDescription('');
    setError(null);
  }, [generator]);

  const generate = useCallback(() => {
    if (!description.trim()) return;
    setError(null);
    // The credential is the generator's context: the draft it writes is a
    // prompt that calls THIS connector.
    generator.start(credentialId, description.trim());
  }, [credentialId, description, generator]);

  const saveDraft = useCallback(async () => {
    const draft = generator.draft;
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createRecipe({
        credential_id: credentialId,
        use_case_id: null,
        name: draft.name,
        description: draft.description,
        category: draft.category,
        prompt_template: draft.prompt_template,
        input_schema: draft.input_schema,
        output_contract: null,
        tool_requirements: null,
        credential_requirements: null,
        model_preference: null,
        sample_inputs: draft.sample_inputs,
        tags: draft.tags,
        icon: null,
        color: null,
        source_template_id: null,
        source_use_case_id: null,
        source_use_case_name: null,
        source_version: null,
      });
      await refresh();
      cancelCreate();
    } catch (err) {
      // Resolved before it is stored, never after. What the producer emitted is
      // a machine sentence: untranslated in a 14-locale app and unbounded in a
      // bounded layout. `getActiveTranslations` is the door for a hook, which
      // cannot call `useTranslation` at the point of failure.
      const raw = err instanceof Error ? err.message : String(err);
      setError(resolveErrorTranslated(getActiveTranslations(), raw).message);
    } finally {
      setSaving(false);
    }
  }, [credentialId, generator.draft, refresh, saving, cancelCreate]);

  const remove = useCallback(async (id: string) => {
    try {
      await deleteRecipe(id);
      setRecipes((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(t.vault.shared.failed_delete_recipe);
      silentCatch('useCredentialRecipes:deleteRecipe')(err);
    }
  }, [t.vault.shared.failed_delete_recipe]);

  return {
    recipes,
    isLoading,
    isCreating,
    description,
    setDescription,
    generator,
    saving,
    /** Already resolved to the product's copy in the active locale. */
    error,
    beginCreate,
    cancelCreate,
    generate,
    saveDraft,
    remove,
  };
}

export type CredentialRecipesState = ReturnType<typeof useCredentialRecipes>;

/**
 * The seed description for "Save as recipe": what the user just ran, in words
 * the generator can work from. Kept here (not in the component) so the exact
 * text is assertable without rendering.
 */
export function recipeSeedFromRequest(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}
