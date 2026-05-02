import { useCallback, useMemo, useState } from 'react';
import {
  setUseCaseGenerationSettings,
  type UseCaseGenerationSettings,
} from '@/api/agents/useCases';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { DisplayUseCase } from './displayUseCase';

export type ReviewMode = 'on' | 'off' | 'trust_llm';
export type BoolMode = 'on' | 'off';
export type PolicyKey = 'memories' | 'reviews' | 'events';

interface UsePolicyControlsArgs {
  personaId: string;
  uc: DisplayUseCase;
  /** Persona-level default for memories. Used when the use case has no
   *  explicit `generation_settings.memories`. */
  memoriesDefault: boolean;
  /** Persona-level default for reviews — same fallback semantics. */
  reviewsDefault: boolean;
}

export interface UsePolicyControls {
  memoriesValue: BoolMode;
  reviewsValue: ReviewMode;
  eventsValue: BoolMode;
  /** Number of event-name aliases configured on this use case. Drives the
   *  badge on the Rename button. */
  aliasCount: number;
  /** Raw settings object — pass to EventRenameModal so it can edit aliases
   *  in place without refetching. */
  settings: UseCaseGenerationSettings;
  /** Which policy key is currently persisting (or null when idle). Drives
   *  the disabled+spinner state on toggle buttons. */
  pending: PolicyKey | null;
  toggleMemories: () => void;
  toggleEvents: () => void;
  cycleReviews: () => void;
}

/**
 * Shared persist+state machinery for the per-use-case generation policy
 * (memories / reviews / events / event-aliases). Reused by:
 *   - TilePolicyToggles (compact column on grid tile right edge)
 *   - UseCaseDetailExpanded (interactive Memory/Review/Event dim cards)
 *
 * Persistence is fire-and-await: `setUseCaseGenerationSettings` then
 * `fetchDetail` so any other consumer of `agentStore.selectedPersona`
 * reflects the change immediately (TilePolicyToggles ↔ in-card toggles
 * stay in sync without explicit cross-talk).
 */
export function usePolicyControls({
  personaId, uc, memoriesDefault, reviewsDefault,
}: UsePolicyControlsArgs): UsePolicyControls {
  const fetchDetail = useAgentStore((s) => s.fetchDetail);
  const { t, tx } = useTranslation();
  const settings: UseCaseGenerationSettings = useMemo(
    () => (uc.raw.generation_settings ?? {}) as UseCaseGenerationSettings,
    [uc.raw.generation_settings],
  );

  const memoriesValue: BoolMode = settings.memories ?? (memoriesDefault ? 'on' : 'off');
  const reviewsValue: ReviewMode = settings.reviews ?? (reviewsDefault ? 'on' : 'off');
  const eventsValue: BoolMode = settings.events ?? 'on';
  const aliasCount = Object.keys(settings.event_aliases ?? {}).length;

  const [pending, setPending] = useState<PolicyKey | null>(null);

  const persist = useCallback(
    async (next: UseCaseGenerationSettings, key: PolicyKey) => {
      setPending(key);
      try {
        await setUseCaseGenerationSettings(personaId, uc.id, next);
        useToastStore.getState().addToast(tx(t.agents.use_cases.policy_updated, { key: capitalize(key) }), 'success');
        await fetchDetail(personaId);
      } catch (err) {
        toastCatch('usePolicyControls:persist')(err);
      } finally {
        setPending(null);
      }
    },
    [personaId, uc.id, fetchDetail, t, tx],
  );

  const toggleMemories = useCallback(() => {
    persist({ ...settings, memories: memoriesValue === 'on' ? 'off' : 'on' }, 'memories');
  }, [memoriesValue, settings, persist]);

  const toggleEvents = useCallback(() => {
    persist({ ...settings, events: eventsValue === 'on' ? 'off' : 'on' }, 'events');
  }, [eventsValue, settings, persist]);

  const cycleReviews = useCallback(() => {
    const order: ReviewMode[] = ['on', 'trust_llm', 'off'];
    const next = order[(order.indexOf(reviewsValue) + 1) % order.length] ?? 'on';
    persist({ ...settings, reviews: next }, 'reviews');
  }, [reviewsValue, settings, persist]);

  return {
    memoriesValue, reviewsValue, eventsValue,
    aliasCount, settings, pending,
    toggleMemories, toggleEvents, cycleReviews,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
