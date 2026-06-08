import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { listTeamChannel, postTeamDirective } from '@/api/pipeline/teamChannel';
import { silentCatch } from '@/lib/silentCatch';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/* ----------------------------------------------------------------------------
 * Design B — the real living-chat feed.
 *
 * Server read-model (`list_team_channel`: step layer ∪ bus ∪ memories, keyset
 * pagination) + push: the orchestrator's TEAM_ASSIGNMENT_PROGRESS emit
 * triggers a head refresh the moment any step moves, with a poll fallback for
 * the non-step sources. Directives post optimistically and accumulate
 * step-boundary delivery receipts (parsed from `extra.deliveries`).
 * -------------------------------------------------------------------------- */

const PAGE = 60;
const POLL_MS = 15_000;

export interface DirectiveDelivery {
  step_id: string;
  persona_id: string;
  at: string;
}

/** Parse a directive item's receipts out of its `extra` (tags JSON). */
export function parseDeliveries(item: TeamChannelItem): DirectiveDelivery[] {
  if (item.kind !== 'directive' || !item.extra) return [];
  try {
    const root: unknown = JSON.parse(item.extra);
    const arr = (root as { deliveries?: unknown }).deliveries;
    return Array.isArray(arr) ? (arr as DirectiveDelivery[]) : [];
  } catch {
    return [];
  }
}

export function useTeamChannel(teamId: string) {
  const [items, setItems] = useState<TeamChannelItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [posting, setPosting] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Refresh the head page and merge over what's loaded (keeps older pages). */
  const refreshHead = useCallback(() => {
    listTeamChannel(teamId, PAGE)
      .then((head) => {
        setItems((prev) => {
          const seen = new Set(head.map((i) => i.id));
          const olderTail = prev.filter((i) => !seen.has(i.id) && (head.length === 0 || i.at <= head[head.length - 1]!.at));
          return [...head, ...olderTail];
        });
        setLoaded(true);
      })
      .catch(silentCatch('teams/collab:channel-head'));
  }, [teamId]);

  /** Keyset page older history (infinite scroll). */
  const loadOlder = useCallback(() => {
    setItems((prev) => {
      const cursor = prev[prev.length - 1]?.at;
      if (!cursor) return prev;
      listTeamChannel(teamId, PAGE, cursor)
        .then((older) => {
          if (older.length === 0) setExhausted(true);
          setItems((cur) => {
            const known = new Set(cur.map((i) => i.id));
            return [...cur, ...older.filter((i) => !known.has(i.id))];
          });
        })
        .catch(silentCatch('teams/collab:channel-older'));
      return prev;
    });
  }, [teamId]);

  // Initial load + reset on team switch.
  useEffect(() => {
    setItems([]);
    setLoaded(false);
    setExhausted(false);
    refreshHead();
  }, [refreshHead]);

  // Push: any step movement on this team's assignments → head refresh.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen(EventName.TEAM_ASSIGNMENT_PROGRESS, () => {
      if (!cancelled) refreshHead();
    }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [refreshHead]);

  // Poll fallback for bus events + memories (no push channel yet).
  useEffect(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(refreshHead, POLL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [refreshHead]);

  const sendDirective = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text) return;
      setPosting(true);
      try {
        await postTeamDirective(teamId, text);
        refreshHead();
      } finally {
        setPosting(false);
      }
    },
    [teamId, refreshHead],
  );

  /**
   * Presence, derived from the step layer: a persona whose most recent step
   * row is `step_running` is WORKING; one whose latest row is the
   * awaiting-review gate is WAITING; everyone else with traffic is IDLE.
   */
  const presence = useMemo(() => {
    const latestByStep = new Map<string, TeamChannelItem>();
    for (const i of items) {
      if (i.kind !== 'step' || !i.stepId) continue;
      if (!latestByStep.has(i.stepId)) latestByStep.set(i.stepId, i); // items are newest-first
    }
    const map = new Map<string, 'working' | 'waiting'>();
    for (const i of latestByStep.values()) {
      if (!i.personaId) continue;
      if (i.label === 'step_running') map.set(i.personaId, 'working');
      else if (i.label === 'status_awaiting_review' && !map.has(i.personaId)) map.set(i.personaId, 'waiting');
    }
    return map;
  }, [items]);

  return { items, loaded, exhausted, posting, presence, refreshHead, loadOlder, sendDirective };
}
