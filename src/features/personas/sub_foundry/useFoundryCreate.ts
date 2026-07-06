import { useCallback, useState } from 'react';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { promoteBuildDraft } from '@/api/agents/buildSession';
import { applyDesignContextMutation } from '@/hooks/design/core/useDesignContextMutator';
import { resolveIconForTemplate } from '@/lib/icons/templateIconResolver';
import { useTranslation } from '@/i18n/useTranslation';
import type { Archetype, MemoryStrategy } from '@/api/archetypes';
import type { Recipe } from '@/features/templates/sub_recipes/types';

export interface FoundryComposition {
  archetype: Archetype;
  memoryStrategy: MemoryStrategy;
  recipes: Recipe[];
  name: string;
}

/**
 * The Foundry create drive. Synthesizes a schema-v3 template payload from
 * the composition (archetype persona + selected `recipe_ref`s + persona_meta)
 * and drives the REAL adoption pipeline — `createPersona` (draft shell) →
 * `create_adoption_session` (hydrates the refs, normalizes v3 → flat) →
 * `promote_build_draft` (tools/triggers/subscriptions/prompt in one
 * transaction, core dials stamped into `core_profile`, connector readiness
 * written to `setup_detail`). Deliberately NO parallel compile path: Foundry
 * personas are template adoptions of a template that never lived on disk.
 *
 * Orphan-cleanup contract mirrors ChronologyAdoptionView: if any step after
 * `createPersona` fails, the draft shell is deleted so transient failures
 * never leave phantom personas in the list.
 */
export function useFoundryCreate() {
  const { t, tx } = useTranslation();
  const [creating, setCreating] = useState(false);

  const create = useCallback(
    async (comp: FoundryComposition): Promise<string | null> => {
      if (creating) return null;
      setCreating(true);
      let createdPersonaId: string | null = null;
      try {
        const resolved = resolveIconForTemplate(
          comp.archetype.recipeAffinity,
          comp.name,
          comp.archetype.tagline,
        );

        // 1. Draft persona shell (same defaults the template flow uses).
        const persona = await useAgentStore.getState().createPersona({
          name: comp.name.slice(0, 60),
          description: comp.archetype.tagline,
          system_prompt: 'You are a helpful AI assistant.',
          icon: resolved.icon,
          color: comp.archetype.color || resolved.color,
        });
        createdPersonaId = persona.id;

        // 2. Synthesize the v3 payload. `persona` is the archetype's mini
        // template persona verbatim; capabilities attach as recipe_refs so
        // the pipeline's hydration + flatten produce real triggers/tools.
        const payload = {
          persona: comp.archetype.persona,
          use_cases: comp.recipes.map((r) => ({
            recipe_ref: { id: r.id, version: r.version, bindings: {} },
          })),
          adoption_questions: [],
          persona_meta: {
            name: comp.name.slice(0, 60),
            icon: resolved.icon,
            color: comp.archetype.color || resolved.color,
          },
        };
        const intent = `Foundry composition: ${comp.archetype.name} archetype + ${comp.recipes.length} capabilities (${comp.memoryStrategy.name} memory)`;
        const sessionId = await invokeWithTimeout<string>('create_adoption_session', {
          personaId: persona.id,
          intent,
          agentIrJson: JSON.stringify(payload),
          resolvedCellsJson: null,
        });

        // 3. Promote directly — draft_ready → promoted is a legal transition
        // and a Foundry composition has no questionnaire or LLM test step.
        await promoteBuildDraft(sessionId, persona.id, []);

        // 4. Foundation provenance — archetype + memory-strategy intent onto
        // design_context (typed fields on DesignContextData; the queued
        // mutator serializes against promote's fresh design_context).
        await useAgentStore.getState().fetchDetail(persona.id);
        await applyDesignContextMutation(persona.id, (ctx) => {
          const data = ctx ? (JSON.parse(ctx) as Record<string, unknown>) : {};
          return JSON.stringify({
            ...data,
            archetypeId: comp.archetype.id,
            memoryStrategyId: comp.memoryStrategy.id,
          });
        });

        await useAgentStore.getState().fetchDetail(persona.id);
        useToastStore.getState().addToast(
          tx(t.foundry.created_toast, { name: comp.name }),
          'success',
        );

        // 5. Land in the editor.
        useAgentStore.getState().selectPersona(persona.id);
        useSystemStore.getState().setIsCreatingPersona(false);
        return persona.id;
      } catch (err) {
        // Orphan cleanup — never leave a phantom draft behind.
        if (createdPersonaId) {
          void useAgentStore
            .getState()
            .deletePersona(createdPersonaId)
            .catch(() => { /* best-effort */ });
        }
        toastCatch('foundry:create')(err);
        return null;
      } finally {
        setCreating(false);
      }
    },
    [creating, t, tx],
  );

  return { create, creating };
}
