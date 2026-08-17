/**
 * useAutomationSuggestions — state + decision flows for the Studio's mined
 * ghost cables (Self-Wiring Fabric v1).
 *
 * Accept walks the EXISTING trigger machinery, dry-run first, in an order
 * chosen so the mined-route tag can never be skipped:
 *
 *   1. `createTrigger` — the suggestion's event_listener, DISABLED
 *      (`suggestionCommit.ts` shares the hand-wired form mapping);
 *   2. `dryRunTrigger` — full validation + simulated routing; a failed
 *      dry-run deletes the trigger and leaves the suggestion proposed;
 *   3. `acceptAutomationSuggestion` — stamps `committedTriggerId`, the tag
 *      that excludes this route's traffic from all future mining evidence;
 *   4. `updateTrigger(enabled: true)` — only a tagged route ever goes live.
 *
 * Reject is logged to the suggestions table (the miner never re-proposes a
 * rejected pair). Nothing here runs without an explicit user click.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { createTrigger, deleteTrigger, dryRunTrigger, updateTrigger } from '@/api/pipeline/triggers';
import {
  acceptAutomationSuggestion, listAutomationSuggestions, rejectAutomationSuggestion,
} from '@/api/pipeline/automationSuggestions';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import type { AutomationSuggestion } from '@/lib/bindings/AutomationSuggestion';
import type { AutomationSuggestionFeed } from '@/lib/bindings/AutomationSuggestionFeed';
import { suggestionToTriggerInput } from './suggestionCommit';

export function useAutomationSuggestions(onRouteCommitted?: () => void) {
  const { t, tx } = useTranslation();
  const st = t.triggers.studio;
  const addToast = useToastStore((s) => s.addToast);

  const [feed, setFeed] = useState<AutomationSuggestionFeed | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    try {
      setFeed(await listAutomationSuggestions());
    } catch (err) {
      silentCatch('features/triggers/sub_studio/useAutomationSuggestions:reload')(err);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const proposed = useMemo(
    () => (feed?.suggestions ?? []).filter((s) => s.status === 'proposed'),
    [feed],
  );

  const withBusy = async (id: string, run: () => Promise<void>) => {
    setBusy((s) => new Set(s).add(id));
    try {
      await run();
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  /** Wire a suggested route: create-disabled → dry-run → tag → enable. */
  const accept = (s: AutomationSuggestion) => withBusy(s.id, async () => {
    let createdId: string | null = null;
    try {
      const created = await createTrigger(suggestionToTriggerInput(s));
      createdId = created.id;

      const dry = await dryRunTrigger(created.id);
      if (!dry.valid) {
        // Honest rollback: no half-wired routes. The suggestion stays
        // proposed so the user can retry after fixing whatever failed.
        await deleteTrigger(created.id, s.personaId).catch(
          silentCatch('useAutomationSuggestions:accept:cleanup'),
        );
        const failed = dry.validation.checks.find((c) => !c.passed);
        addToast(tx(st.ghost_dry_run_failed, { error: failed?.message ?? '' }), 'error');
        return;
      }

      // Stamp the mined-route tag BEFORE arming — a live mined route without
      // its exclusion tag would let its own traffic feed future evidence.
      await acceptAutomationSuggestion(s.id, created.id);
      await updateTrigger(created.id, s.personaId, {
        // `enabled` only. `next_trigger_at` used to be passed as null here,
        // which is a double_option — so this cleared the fire time at the same
        // moment it enabled the trigger. Every accepted suggestion was armed
        // and disarmed in one call.
        enabled: true,
      });

      addToast(st.ghost_accepted_toast, 'success');
      await reload();
      onRouteCommitted?.();
    } catch (err) {
      if (createdId) {
        await deleteTrigger(createdId, s.personaId).catch(
          silentCatch('useAutomationSuggestions:accept:cleanup'),
        );
      }
      toastCatch('useAutomationSuggestions:accept', st.ghost_accept_failed)(err);
      await reload();
    }
  });

  /** Dismiss — logged so the miner never re-proposes this pair. */
  const reject = (s: AutomationSuggestion) => withBusy(s.id, async () => {
    try {
      await rejectAutomationSuggestion(s.id);
      addToast(st.ghost_rejected_toast, 'success');
      await reload();
    } catch (err) {
      toastCatch('useAutomationSuggestions:reject', st.ghost_reject_failed)(err);
    }
  });

  return { feed, proposed, busy, accept, reject, reload };
}

export type AutomationSuggestionsState = ReturnType<typeof useAutomationSuggestions>;
