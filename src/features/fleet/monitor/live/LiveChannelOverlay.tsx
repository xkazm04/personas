// LIVE CHANNEL OVERLAY — the production host for the title-bar pop-up layer.
//
// Mounted at App root (sibling to ToastContainer) so it floats over the whole
// app whether or not the Persona Monitor is open. It watches every team that
// has a channel via the shared MergedChannels feed, projects genuinely-NEW
// items into pop-ups (history present at mount is absorbed silently — no
// startup blast), and owns the queue engine: acknowledge-to-read, the 10s
// per-message lifetime (useLiveLifetimes), and hold-to-pause. Presentation is
// the Signal Island (LiveCommsStack). The CHANNEL
// feed is gated behind the persisted `monitorLiveMode` toggle, surfaced in the
// Channels → Timeline view. External feeds (`liveExternal.ts` — Notepad thread
// entries for a note whose card is not on screen) are not: they carry decisions
// waiting on the operator, not channel chatter, and they survive the toggle.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useSystemStore } from '@/stores/systemStore';
import { jsonOr, safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/personaIndex';
import { MergedChannels } from '../channels/mergedFeed';
import type { FeedTeam, TaggedItem } from '../channels/types';
import type { Persona } from '@/lib/bindings/Persona';
import { LiveCommsStack } from './LiveCommsStack';
import { onMockLiveMessage } from './liveDevHarness';
import { liveSourceFor, onExternalLiveMessage } from './liveExternal';
import { useLiveLifetimes } from './useLiveLifetimes';
import { projectChannelItem, type LiveMessage, type LiveVariantProps } from './liveModel';

const CAP = 30;        // bound the accumulated window
const NEW_GRACE_MS = 8000; // an item this fresh at mount still pops (vs. silent history)

/* -- Persistent read ledger ------------------------------------------------
 * A pop-up dismissed via its acknowledge button is READ — it must never be
 * displayed again, across live-mode re-enables and app restarts. A bounded
 * id ring in localStorage (newest-last) is enough: the pop-up window only
 * ever surfaces near-mount arrivals, so 400 ids comfortably outlives any id
 * that could still resurface. */
const READ_KEY = 'personas.live.readIds';
const READ_CAP = 400;

function loadReadIds(): Set<string> {
  const ids = jsonOr<unknown>(safeLocalGet(READ_KEY, 'live:read-ledger read'), []);
  // The blob is whatever an older build wrote; keep only string ids.
  return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
}

function persistReadIds(ids: Set<string>): void {
  // Private mode / quota: acknowledge still works this session (best-effort write).
  safeLocalSet(READ_KEY, JSON.stringify([...ids].slice(-READ_CAP)), 'live:read-ledger');
}

/** Hidden diff sink — turns merged-feed deltas into new pop-up events. */
function LiveFeedSink({
  merged, personaIndex, onNew,
}: {
  merged: TaggedItem[];
  personaIndex: Map<string, Persona>;
  onNew: (msgs: LiveMessage[]) => void;
}) {
  const seen = useRef<Set<string>>(new Set());
  const established = useRef(false);
  const mountAt = useRef(Date.now());

  useEffect(() => {
    if (merged.length === 0) return;
    const now = Date.now();
    const fresh: LiveMessage[] = [];
    for (const tg of merged) {
      const id = tg.item.id;
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      // Athena speaks on exactly two dimensions: the chat window (full
      // information) and the orb (quick info / decision). A corner pop-up is a
      // third one, so her rows never pop here — they stay in the Channels
      // timeline (MergedRow still renders them with full author metadata) and,
      // when they need the operator, reach them through the orb/chat. Every
      // other author (persona / director / directive / step / event / memory /
      // slack) is unaffected.
      if (tg.item.kind === 'athena') continue;
      // First populated run absorbs history; only near-mount arrivals pop.
      const atMs = Date.parse(tg.item.at);
      const isLive = established.current || (Number.isFinite(atMs) && atMs >= mountAt.current - NEW_GRACE_MS);
      if (isLive) {
        const persona = tg.item.personaId ? personaIndex.get(tg.item.personaId) : undefined;
        fresh.push(projectChannelItem(tg, persona, now));
      }
    }
    established.current = true;
    if (fresh.length > 0) onNew(fresh);
    // Bound the dedupe set; the merged window is itself bounded.
    if (seen.current.size > 800) seen.current = new Set(merged.map((m) => m.item.id));
  }, [merged, personaIndex, onNew]);

  return null;
}

/**
 * @catalog Live-mode corner pop-ups for incoming team-channel messages — app-wide bottom-right stack driven by the shared channel feed, gated by the Channels→Timeline toggle.
 */
export function LiveChannelOverlay() {
  const enabled = useSystemStore((s) => s.monitorLiveMode);
  const reducedMotion = useReducedMotion() ?? false;

  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const personaIndex = usePersonaIndex();

  useEffect(() => { void fetchTeams(); }, [fetchTeams]);

  // Watch only teams that actually have a channel (≥1 home persona).
  const feedTeams = useMemo<FeedTeam[]>(() => {
    const hasPersona = new Set<string>();
    for (const p of personaIndex.values()) if (p.home_team_id) hasPersona.add(p.home_team_id);
    return teams
      .filter((tm) => hasPersona.has(tm.id))
      .map((tm) => ({ teamId: tm.id, teamName: tm.name, teamColor: tm.color, members: [] }));
  }, [teams, personaIndex]);

  // ── Queue engine ──────────────────────────────────────────────────────────
  const [incoming, setIncoming] = useState<LiveMessage[]>([]);
  // Read ledger — seeded from localStorage so acknowledged messages stay gone.
  const [dismissed, setDismissed] = useState<Set<string>>(loadReadIds);
  const incomingRef = useRef(incoming);
  incomingRef.current = incoming;

  const enqueue = useCallback((msgs: LiveMessage[]) => {
    setIncoming((prev) => [...msgs, ...prev].slice(0, CAP));
  }, []);

  // TEMP (prototype): inject a synthetic message when the Channels test cluster
  // fires "Mock pop-up". Lets the redesign be evaluated on demand without
  // waiting for live channel traffic. Remove with liveDevHarness.
  useEffect(() => onMockLiveMessage((m) => enqueue([m])), [enqueue]);

  // EXTERNAL FEEDS (Notepad thread entries, `liveExternal.ts`). Not gated by
  // live mode: live mode is the operator's switch for CHANNEL chatter, and a
  // review waiting on him in a note he is not looking at is not chatter. One
  // entry per note — a newer one replaces the older, the same coalescing the
  // desk card's bubble applies.
  useEffect(
    () =>
      onExternalLiveMessage((m) => {
        setIncoming((prev) => {
          const rest = m.noteId ? prev.filter((x) => !(x.source === m.source && x.noteId === m.noteId)) : prev;
          return [m, ...rest].slice(0, CAP);
        });
      }),
    [],
  );
  // Acknowledge = mark read, forever. The click lives on the card's icon
  // button; body clicks keep opening the messaging UI instead.
  const onDismiss = useCallback((id: string) => {
    setDismissed((p) => {
      const next = new Set(p).add(id);
      persistReadIds(next);
      return next;
    });
    // A feed's own meaning of "acknowledged" (Notepad: the thread is read).
    const msg = incomingRef.current.find((m) => m.id === id);
    if (msg) liveSourceFor(msg)?.acknowledge?.(msg);
  }, []);
  const onOpenExternal = useCallback(
    (m: LiveMessage) => {
      liveSourceFor(m)?.open?.(m);
      onDismiss(m.id);
    },
    [onDismiss],
  );
  const onDismissAll = useCallback(() => {
    setDismissed((p) => {
      const next = new Set(p);
      for (const m of incomingRef.current) next.add(m.id);
      persistReadIds(next);
      return next;
    });
    for (const m of incomingRef.current) liveSourceFor(m)?.acknowledge?.(m);
  }, []);
  const onOpenConversation = useCallback((teamId?: string, personaId?: string | null, itemId?: string | null) => {
    // Into CONVERSATIONS, scoped to the pop-up's team when the card carries
    // one. It used to land in the merged Timeline, which is the wrong room for
    // this gesture: the Timeline is a read of everything at once, and a reader
    // who just clicked ONE message wants that message's thread and a composer
    // under it. The Timeline is still one tab away for the wider read.
    //
    // AND ONTO THE LINE, not just into the room. The preset carried a team and
    // nothing else, so the operator arrived at a clustered, oldest-first
    // conversation and still had to find the message that popped. It now
    // carries the item the card was about, and the conversation poses that row
    // at the top of the viewport through the pin the composer already uses.
    const s = useSystemStore.getState();
    s.setMonitorInitialView('conversations');
    s.setMonitorChannelPreset(
      teamId ? { teamId, personaId: personaId ?? null, itemId: itemId ?? null } : null,
    );
    s.setHeaderOverlay('monitor');
  }, []);

  // Disabling clears the QUEUE so stale pop-ups can't resurface on re-enable
  // — but the read ledger survives: acknowledged means acknowledged.
  useEffect(() => {
    if (enabled) return;
    // Channel rows only — an external feed's entries are not live-mode's to wipe.
    setIncoming((prev) => prev.filter((m) => m.source !== undefined && m.source !== 'channel'));
    setDismissed(loadReadIds());
  }, [enabled]);


  // Prune the tombstone set whenever the live window shrinks (CAP eviction or
  // an enqueue) — otherwise `dismissed` is a permanent set that only grows,
  // one entry per pop-up ever shown, for the life of a long live-mode session.
  useEffect(() => {
    const liveIds = new Set(incoming.map((m) => m.id));
    setDismissed((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (liveIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [incoming]);

  const live = useMemo(() => incoming.filter((m) => !dismissed.has(m.id)), [incoming, dismissed]);
  // Each pop-up lives LIVE_LIFETIME_MS from arrival (paused while the operator
  // holds the island open). Expiry drops it from the queue WITHOUT marking it
  // read — it was not acknowledged, only not looked at in time.
  const expire = useCallback((ids: ReadonlySet<string>) => {
    setIncoming((prev) => prev.filter((m) => !ids.has(m.id)));
  }, []);
  const { deadlines, onHoldChange } = useLiveLifetimes(live, expire);
  const props: LiveVariantProps = {
    messages: live, onDismiss, onDismissAll, onOpenConversation, onOpenExternal, reducedMotion, deadlines, onHoldChange,
  };

  // Live mode off: no channel feed at all, but the stack still carries whatever
  // an external feed pushed (the queue holds only those once the mode is off).
  if (!enabled) return live.length > 0 ? <LiveCommsStack {...props} /> : null;

  return (
    <>
      {feedTeams.length > 0 && (
        <MergedChannels teams={feedTeams}>
          {(merged) => <LiveFeedSink merged={merged} personaIndex={personaIndex} onNew={enqueue} />}
        </MergedChannels>
      )}
      <LiveCommsStack {...props} />
    </>
  );
}

export default LiveChannelOverlay;
