// useChannelBubbles — a persona's latest channel line, on its tile; and a
// count of what it said that the operator has not looked at.
//
// TWO SOURCES, both landing in one `bubbles` map (the rules and the reason for
// the second one are in `channelBubbleModel`):
//
//   • AMBIENT — the same refcounted channel cache the rail's Messages tab
//     holds open (`useMergedChannels`), so subscribing here adds a Set entry,
//     not a poll. Fades after BUBBLE_TTL_MS.
//   • ASKED — the operator's quick chat. A sentinel-keyed persona channel is
//     invisible to every team reader by construction, so the reply the
//     operator asked for cannot arrive through the ambient feed. The ask
//     takes a refcounted `subscribePersonaChannel`, which the ONE existing
//     channel service already refreshes off the PERSONA_CHANNEL_MESSAGE push.
//     No new listener, no new poll, no new timer. It wears a quiet pending
//     mark until the reply lands, then an ASKED_BUBBLE_TTL_MS bubble.
//
//   • `unseen` — messages per persona since the operator last opened that
//     persona (the tile click), NOT since the bubble faded. The bubble is the
//     glance; this is the ledger, and it is what stays on the node.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useMergedChannels } from '../channels/mergedFeed';
import type { FeedTeam } from '../channels/types';
import {
  bubbleTtlMs, clearQuickChatAsk, createBubbleLedger, diffChatArrivals, getQuickChatAsks,
  latestPerPersona, pendingBubble, pickPersonaReply, subscribeQuickChatAsks, type ChatBubble,
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
  const asks = useSyncExternalStore(subscribeQuickChatAsks, getQuickChatAsks, getQuickChatAsks);
  const subscribePersonaChannel = usePipelineStore((s) => s.subscribePersonaChannel);
  const personaChannels = usePipelineStore((s) => s.personaChannels);
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
  const armFade = useCallback((pid: string, b: ChatBubble) => {
    const open = timers.current.get(pid);
    if (open) clearTimeout(open);
    timers.current.delete(pid);
    const ttl = bubbleTtlMs(b);
    if (ttl === null) return; // a pending ask never fades on its own
    timers.current.set(pid, setTimeout(() => {
      timers.current.delete(pid);
      dropBubble(pid, b.id);
    }, ttl));
  }, [dropBubble]);

  // SOURCE 1 — ambient team chatter.
  useEffect(() => {
    if (merged.length === 0) return;
    const fresh = diffChatArrivals(ledger.current, merged, personaIds, Date.now());
    if (fresh.length === 0) return;

    setUnseen((prev) => {
      const next = new Map(prev);
      for (const b of fresh) next.set(b.personaId, (next.get(b.personaId) ?? 0) + 1);
      return next;
    });

    // A persona with an outstanding ask keeps its pending mark: the operator
    // is waiting on an ANSWER, and ambient chatter is not it.
    const latest = latestPerPersona(fresh);
    const pending = getQuickChatAsks();
    setBubbles((prev) => {
      const next = new Map(prev);
      for (const [pid, b] of latest) if (!pending.has(pid)) next.set(pid, b);
      return next;
    });
    for (const [pid, b] of latest) if (!pending.has(pid)) armFade(pid, b);
  }, [merged, personaIds, armFade]);

  // SOURCE 2a — an ask opens a refcounted subscription on that persona's own
  // channel, which is what makes the existing service refresh it on push.
  useEffect(() => {
    if (asks.size === 0) return;
    const offs = [...asks.keys()].map((id) => subscribePersonaChannel(id));
    return () => { for (const off of offs) off(); };
  }, [asks, subscribePersonaChannel]);

  // SOURCE 2b — the pending mark, from send until the reply lands.
  useEffect(() => {
    if (asks.size === 0) return;
    setBubbles((prev) => {
      let next: Map<string, ChatBubble> | null = null;
      for (const ask of asks.values()) {
        const cur = prev.get(ask.personaId);
        if (cur?.pending && cur.at === ask.at) continue;
        (next ??= new Map(prev)).set(ask.personaId, pendingBubble(ask));
      }
      return next ?? prev;
    });
    for (const pid of asks.keys()) {
      const open = timers.current.get(pid);
      if (open) { clearTimeout(open); timers.current.delete(pid); }
    }
  }, [asks]);

  // SOURCE 2c — the reply. Reads the head the service already refreshed.
  useEffect(() => {
    if (asks.size === 0) return;
    const delivered: ChatBubble[] = [];
    for (const ask of asks.values()) {
      const reply = pickPersonaReply(personaChannels[ask.personaId]?.items ?? [], ask);
      if (reply) delivered.push(reply);
    }
    if (delivered.length === 0) return;

    setUnseen((prev) => {
      const next = new Map(prev);
      for (const b of delivered) next.set(b.personaId, (next.get(b.personaId) ?? 0) + 1);
      return next;
    });
    setBubbles((prev) => {
      const next = new Map(prev);
      for (const b of delivered) next.set(b.personaId, b);
      return next;
    });
    for (const b of delivered) {
      armFade(b.personaId, b);
      clearQuickChatAsk(b.personaId); // the ask is answered; the subscription releases
    }
  }, [asks, personaChannels, armFade]);

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
    // Opening the persona IS reading the answer: the ask stops being outstanding.
    clearQuickChatAsk(personaId);
  }, []);

  return useMemo(() => ({ bubbles, unseen, acknowledge }), [bubbles, unseen, acknowledge]);
}
