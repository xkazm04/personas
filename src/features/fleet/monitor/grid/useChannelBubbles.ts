// useChannelBubbles — a persona's latest channel line, on its tile, for ten
// seconds; and a count of what it said that the operator has not looked at.
//
// Reads the same refcounted channel cache the rail's Messages tab holds open
// (`useMergedChannels`), so subscribing here adds a Set entry, not a poll. The
// diff rules live in `channelBubbleModel`; this hook owns the two pieces of
// state and the fade timers.
//
//   • `bubbles` — at most one per persona, removed by its own timer after
//     BUBBLE_TTL_MS. A newer message from the same persona replaces the text
//     and restarts the clock, so a talkative persona reads as "still talking"
//     rather than flickering.
//   • `unseen`  — messages per persona since the operator last opened that
//     persona (the tile click), NOT since the bubble faded. The bubble is the
//     glance; this is the ledger, and it is what stays on the node.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMergedChannels } from '../channels/mergedFeed';
import type { FeedTeam } from '../channels/types';
import {
  BUBBLE_TTL_MS, createBubbleLedger, diffChatArrivals, latestPerPersona, type ChatBubble,
} from './channelBubbleModel';

const NO_TEAMS: FeedTeam[] = [];

export interface ChannelBubbles {
  bubbles: ReadonlyMap<string, ChatBubble>;
  unseen: ReadonlyMap<string, number>;
  /** The operator opened this persona — clear its ledger and its bubble. */
  acknowledge: (personaId: string) => void;
}

export function useChannelBubbles(
  feedTeams: FeedTeam[] | undefined,
  personaIds: ReadonlySet<string>,
): ChannelBubbles {
  const { merged } = useMergedChannels(feedTeams ?? NO_TEAMS);
  const ledger = useRef(createBubbleLedger(Date.now()));
  const [bubbles, setBubbles] = useState<Map<string, ChatBubble>>(() => new Map());
  const [unseen, setUnseen] = useState<Map<string, number>>(() => new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dropBubble = useCallback((personaId: string, id: string) => {
    setBubbles((prev) => {
      if (prev.get(personaId)?.id !== id) return prev; // superseded already
      const next = new Map(prev);
      next.delete(personaId);
      return next;
    });
  }, []);

  // Fade timers live in a ref keyed by persona, NOT in the diff effect's
  // cleanup: that effect re-runs on every channel poll, and a cleanup there
  // would take every bubble down the moment an unrelated row arrived. The
  // unmount effect below is the one that clears them.
  const armFade = useCallback((pid: string, id: string) => {
    const open = timers.current.get(pid);
    if (open) clearTimeout(open);
    timers.current.set(pid, setTimeout(() => {
      timers.current.delete(pid);
      dropBubble(pid, id);
    }, BUBBLE_TTL_MS));
  }, [dropBubble]);

  useEffect(() => {
    if (merged.length === 0) return;
    const fresh = diffChatArrivals(ledger.current, merged, personaIds, Date.now());
    if (fresh.length === 0) return;

    setUnseen((prev) => {
      const next = new Map(prev);
      for (const b of fresh) next.set(b.personaId, (next.get(b.personaId) ?? 0) + 1);
      return next;
    });

    const latest = latestPerPersona(fresh);
    setBubbles((prev) => {
      const next = new Map(prev);
      for (const [pid, b] of latest) next.set(pid, b);
      return next;
    });
    for (const [pid, b] of latest) armFade(pid, b.id);
  }, [merged, personaIds, armFade]);

  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of t.values()) clearTimeout(id);
      t.clear();
    };
  }, []);

  const acknowledge = useCallback((personaId: string) => {
    setUnseen((prev) => {
      if (!prev.has(personaId)) return prev;
      const next = new Map(prev);
      next.delete(personaId);
      return next;
    });
    setBubbles((prev) => {
      if (!prev.has(personaId)) return prev;
      const next = new Map(prev);
      next.delete(personaId);
      return next;
    });
    const open = timers.current.get(personaId);
    if (open) {
      clearTimeout(open);
      timers.current.delete(personaId);
    }
  }, []);

  return useMemo(() => ({ bubbles, unseen, acknowledge }), [bubbles, unseen, acknowledge]);
}
