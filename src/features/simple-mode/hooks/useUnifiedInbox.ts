/**
 * useUnifiedInbox — the architectural keystone for Simple mode.
 *
 * Merges three fragmented source streams (pending manual-review approvals,
 * unread persona messages, open healing issues) from the Zustand overview
 * store into a single normalized, newest-first, severity-aware array of
 * `UnifiedInboxItem`s. Persona name/icon/color are resolved once from the
 * agent store and fed into each adapter call.
 *
 * Consumers (Phases 07-09 Mosaic / Console / Inbox variants) read from
 * this one hook — no variant reads the underlying stores directly.
 *
 * The `'output'` branch of `UnifiedInboxItem` is reserved for Phase 07 and
 * is NOT emitted by this hook yet.
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { Persona } from '@/lib/bindings/Persona';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';

import type { UnifiedInboxItem } from '../types';
import { adaptApproval, adaptHealing, adaptMessage } from './adapters';

/** Maximum items returned after merge + sort. Simple mode is a quick-scan
 *  surface; deeper history lives in Power mode. */
const MAX_ITEMS = 50;

interface PersonaSummary {
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
}

function resolvePersona(personas: Persona[], personaId: string): PersonaSummary {
  const p = personas.find((x) => x.id === personaId);
  return {
    personaName: p?.name ?? 'Unknown assistant',
    personaIcon: p?.icon ?? null,
    personaColor: p?.color ?? null,
  };
}

/**
 * Read the overview + agent stores, run each source through its adapter,
 * merge, sort newest-first, cap at 50, and memoize the result.
 *
 * Re-renders are gated on shallow equality of the four source arrays via
 * `useShallow`, so unrelated overview-store updates (e.g. cron agents,
 * memories) do not re-compute the inbox.
 */
export function useUnifiedInbox(): UnifiedInboxItem[] {
  const { manualReviews, messages, healingIssues } = useOverviewStore(
    useShallow((s) => ({
      manualReviews: s.manualReviews,
      messages: s.messages,
      healingIssues: s.healingIssues,
    })),
  );
  const personas = useAgentStore((s) => s.personas);

  return useMemo(() => {
    const approvals = manualReviews
      .filter((r) => r.status === 'pending')
      .map((r) => adaptApproval(r, resolvePersona(personas, r.persona_id)));

    const msgs = messages
      .filter((m) => m.is_read === false)
      .map((m) => adaptMessage(m, resolvePersona(personas, m.persona_id)));

    const healing = healingIssues
      .filter((h) => h.status === 'open' && h.auto_fixed === false)
      .map((h) => adaptHealing(h, resolvePersona(personas, h.persona_id)));

    return [...approvals, ...msgs, ...healing]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_ITEMS);
  }, [manualReviews, messages, healingIssues, personas]);
}
