/**
 * useUnifiedInbox — the architectural keystone for the Cockpit DecisionsPanel,
 * the inline DecisionsCard, and overview/sub_inbox.
 *
 * Merges four source streams (pending manual-review approvals, unread persona
 * messages split into regular messages vs output-like artifacts, open healing
 * issues) from the Zustand overview store into a single normalized,
 * newest-first, severity-aware array of `UnifiedInboxItem`s. Persona
 * name/icon/color are resolved once from the agent store and fed into each
 * adapter call.
 *
 * Unread persona messages are partitioned via `isMessageOutput` — those that
 * look like produced artifacts (markdown content_type or title/content
 * containing output-keywords) flow through `adaptOutput` as `kind: 'output'`;
 * the rest flow through `adaptMessage` as `kind: 'message'`. A given message
 * is emitted exactly once.
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { Persona } from '@/lib/bindings/Persona';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';

import type { UnifiedInboxItem } from '../types';
import {
  adaptApproval,
  adaptHealing,
  adaptMessage,
  adaptOutput,
  isMessageOutput,
} from './adapters';
import type { PersonaSummary } from './adapters/types';

/** Maximum items returned after merge + sort. The Cockpit DecisionsPanel is a
 *  quick-scan surface; deeper history lives in overview's full inbox triage. */
const MAX_ITEMS = 50;

function resolvePersonaFromIndex(
  index: Map<string, Persona>,
  personaId: string,
  unknownLabel: string,
): PersonaSummary {
  const p = index.get(personaId);
  return {
    personaName: p?.name ?? unknownLabel,
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
  const { t } = useTranslation();
  const unknownLabel = t.cockpit.unknown_assistant;
  const { manualReviews, messages, healingIssues } = useOverviewStore(
    useShallow((s) => ({
      manualReviews: s.manualReviews,
      messages: s.messages,
      healingIssues: s.healingIssues,
    })),
  );
  const personas = useAgentStore((s) => s.personas);

  return useMemo(() => {
    const personaIndex = new Map<string, Persona>();
    if (Array.isArray(personas)) for (const p of personas) personaIndex.set(p.id, p);
    const resolve = (id: string): PersonaSummary =>
      resolvePersonaFromIndex(personaIndex, id, unknownLabel);

    const approvals = manualReviews
      .filter((r) => r.status === 'pending')
      .map((r) => adaptApproval(r, resolve(r.persona_id)));

    const outputs: UnifiedInboxItem[] = [];
    const regularMessages: UnifiedInboxItem[] = [];
    for (const m of messages) {
      if (m.is_read !== false) continue;
      const persona = resolve(m.persona_id);
      if (isMessageOutput(m)) outputs.push(adaptOutput(m, persona));
      else regularMessages.push(adaptMessage(m, persona));
    }

    const healing = healingIssues
      .filter((h) => h.status === 'open' && h.auto_fixed === false)
      .map((h) => adaptHealing(h, resolve(h.persona_id)));

    return [...approvals, ...regularMessages, ...outputs, ...healing]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_ITEMS);
  }, [manualReviews, messages, healingIssues, personas, unknownLabel]);
}
