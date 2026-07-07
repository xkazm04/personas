import { useCallback, useState } from 'react';
import { mutateUseCases } from '@/hooks/design/core/useDesignContextMutator';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { useTranslation } from '@/i18n/useTranslation';
import type { DesignUseCase, NotificationChannel } from '@/lib/types/frontendTypes';
import type { Recipe, BindingValue } from '../types';
import { substituteDeep } from './substituteBindings';

interface AdoptionResult {
  /** ID of the newly-created use case in the persona's design_context. */
  useCaseId: string;
}

/**
 * Hook owning the recipe adopt/remove side effects. Caller passes:
 *   - target persona id
 *   - recipe to adopt (or its id to remove)
 *   - filled binding values
 *
 * `adopt` substitutes bindings into `recipe.template`, materialises a
 * `DesignUseCase`, appends it to the persona's `design_context.useCases`,
 * and refreshes the persona detail so SigilGrid (or Grid/Glyph) reflects
 * the new capability immediately. It is IDEMPOTENT per recipe: the dedupe
 * check runs inside the queued mutator (against the freshest use-case
 * list), so a double-click or a stale UI can never append the same recipe
 * twice (pre-hardening, every re-adopt silently created a duplicate UC).
 *
 * `remove` is the symmetric detach: it drops every use case whose
 * `source_recipe_id` matches, which also un-lights the "Adopted" badge
 * derived from that provenance.
 *
 * `pending` tracks the in-flight state so callers can disable their
 * buttons while a mutation runs.
 *
 * NOTE: provenance via `AdoptionMetadata` is *not* persisted in v1 — the
 * `DesignUseCase` shape doesn't carry it yet. That extension lands once
 * we have the "republished recipe → reconcile" flow in scope.
 */
export function useAdoption() {
  const { t, tx } = useTranslation();
  const fetchDetail = useAgentStore((s) => s.fetchDetail);
  const [pending, setPending] = useState(false);

  const adopt = useCallback(
    async (
      personaId: string,
      recipe: Recipe,
      values: Record<string, BindingValue | undefined>,
    ): Promise<AdoptionResult | null> => {
      setPending(true);
      try {
        const newUseCase = recipeToUseCase(recipe, values);
        // Dedupe INSIDE the queued mutator: it sees the latest use-case
        // list (after any prior queued writes), so this is the race-safe
        // spot — not a pre-flight check against possibly-stale UI state.
        let alreadyAdopted = false;
        await mutateUseCases(personaId, (existing) => {
          if (existing.some((uc) => uc.source_recipe_id === recipe.id)) {
            alreadyAdopted = true;
            return existing;
          }
          return [...existing, newUseCase];
        });
        if (alreadyAdopted) {
          useToastStore.getState().addToast(
            tx(t.recipes_catalog.already_adopted_toast, { title: recipe.name }),
            'warning',
          );
          return null;
        }
        // Reconcile persona.parameters + the injected `## Capability Parameters`
        // section from the recipe's input_schema (Gap 2). Idempotent and
        // best-effort — a parameterization failure must not fail the adopt.
        await invokeWithTimeout('sync_capability_parameters', { personaId }).catch(
          silentCatch('useAdoption:adopt:syncParams'),
        );
        await fetchDetail(personaId);
        useToastStore.getState().addToast(
          tx(t.recipes_catalog.adopted_toast, { title: newUseCase.title }),
          'success',
        );
        return { useCaseId: newUseCase.id };
      } catch (err) {
        toastCatch('useAdoption:adopt')(err);
        return null;
      } finally {
        setPending(false);
      }
    },
    [fetchDetail, t, tx],
  );

  const remove = useCallback(
    async (personaId: string, recipe: Pick<Recipe, 'id' | 'name'>): Promise<boolean> => {
      setPending(true);
      try {
        let removedAny = false;
        await mutateUseCases(personaId, (existing) => {
          const kept = existing.filter((uc) => uc.source_recipe_id !== recipe.id);
          removedAny = kept.length !== existing.length;
          return kept;
        });
        if (!removedAny) return false; // nothing to detach — stale UI, no-op
        // Re-sync so the removed capability's parameter lines drop out of the
        // injected section (its params stay, inert, per the documented contract).
        await invokeWithTimeout('sync_capability_parameters', { personaId }).catch(
          silentCatch('useAdoption:remove:syncParams'),
        );
        await fetchDetail(personaId);
        useToastStore.getState().addToast(
          tx(t.recipes_catalog.removed_toast, { title: recipe.name }),
          'success',
        );
        return true;
      } catch (err) {
        toastCatch('useAdoption:remove')(err);
        return false;
      } finally {
        setPending(false);
      }
    },
    [fetchDetail, t, tx],
  );

  return { adopt, remove, pending };
}

/** Project a `Recipe` + filled bindings into a `DesignUseCase` ready to
 *  drop into `design_context.useCases`. Pure — no side effects. */
export function recipeToUseCase(
  recipe: Recipe,
  values: Record<string, BindingValue | undefined>,
): DesignUseCase {
  const bindings = recipe.bindings;
  const tpl = recipe.template;

  // Substitute all placeholder strings in template fields. We compute
  // `promptTemplate` for forward-compat (DesignUseCase doesn't carry a
  // prompt field today; when it does, store the substituted prompt
  // there rather than re-deriving from capability_summary at runtime).
  const title = substituteDeep(tpl.title, values, bindings);
  const description = substituteDeep(tpl.description, values, bindings);
  const capabilitySummary = substituteDeep(tpl.capabilitySummary, values, bindings);
  // Pre-compute even though unused — doc-as-code that the substitution
  // contract works for the prompt body.
  void substituteDeep(tpl.promptTemplate, values, bindings);

  // Build NotificationChannel[] from the recipe's declared types. Concrete
  // routing (channel id, credential id) is a Phase 3g concern — for now we
  // produce stub channels with empty config so the persona's runtime knows
  // *what kind* of notification to send, even if the *where* still needs
  // wiring through the existing channel picker.
  const channels: NotificationChannel[] = tpl.notificationChannelTypes.map((type) => ({
    type,
    enabled: true,
    config: {},
  }));

  // Suggested trigger may carry a placeholder cron from the user's binding
  // (e.g. "briefTime" maps to a cron preset string). When the recipe
  // declares a `briefTime` / `sendTime` / `pollingFrequency` binding that
  // resolves to a cron expression, that wins over the template's static
  // cron. Heuristic: take the first cron-typed binding's value if set.
  const cronOverride = pickCronFromBindings(recipe, values);
  const suggested_trigger = tpl.suggestedTrigger
    ? {
        type: tpl.suggestedTrigger.type,
        cron: cronOverride ?? tpl.suggestedTrigger.cron,
        description: tpl.suggestedTrigger.description,
      }
    : undefined;

  return {
    id: `uc-${cryptoRandomId()}`,
    title,
    description,
    capability_summary: capabilitySummary,
    category: tpl.category,
    execution_mode: 'e2e',
    enabled: true,
    suggested_trigger,
    notification_channels: channels.length > 0 ? channels : undefined,
    tool_hints: tpl.toolHints,
    generation_settings: tpl.generationSettings,
    // Stash the substituted prompt body in description for now — we don't
    // yet have a `prompt_template` field on DesignUseCase. The runtime
    // composes prompts from capability_summary + persona system prompt;
    // the recipe's promptTemplate is appended for visibility until we
    // wire a dedicated field.
    sample_input: undefined,
    input_schema: undefined,
    // Provenance: lets the catalog show which recipes this persona already
    // adopted, and future republish flows reconcile against the source.
    source_recipe_id: recipe.id,
  } satisfies DesignUseCase as DesignUseCase;
}

function pickCronFromBindings(
  recipe: Recipe,
  values: Record<string, BindingValue | undefined>,
): string | undefined {
  for (const b of recipe.bindings) {
    if (b.kind.type !== 'cron' && b.kind.type !== 'enum') continue;
    const v = values[b.variable];
    if (typeof v === 'string' && /^[\d*/,\-\s]+$/.test(v) && v.includes('*')) {
      return v;
    }
  }
  return undefined;
}

function cryptoRandomId(): string {
  // crypto.randomUUID is available in modern browsers + the Tauri webview;
  // avoid importing a dep just for this.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
