// LIVE CHANNEL OVERLAY — the production host for the corner pop-up layer.
//
// Mounted at App root (sibling to ToastContainer) so it floats over the whole
// app whether or not the Persona Monitor is open. It watches every team that
// has a channel via the shared MergedChannels feed, projects genuinely-NEW
// items into pop-ups (history present at mount is absorbed silently — no
// startup blast), and owns the queue engine: click-to-dismiss, the natural
// auto-timeout, and hover-pause. Presentation is the Comms Stack. The whole
// layer is gated behind the persisted `monitorLiveMode` toggle, surfaced in the
// Channels → Timeline view.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { MergedChannels } from '../channels/mergedFeed';
import type { FeedTeam, TaggedItem } from '../channels/types';
import type { Persona } from '@/lib/bindings/Persona';
import { LiveCommsStack } from './LiveCommsStack';
import { onMockLiveMessage } from './liveDevHarness';
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
  try {
    const raw = localStorage.getItem(READ_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function persistReadIds(ids: Set<string>): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids].slice(-READ_CAP)));
  } catch (e) {
    // Private mode / quota: acknowledge still works this session.
    silentCatch('live:read-ledger')(e);
  }
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
  // Acknowledge = mark read, forever. The click lives on the card's icon
  // button; body clicks keep opening the messaging UI instead.
  const onDismiss = useCallback((id: string) => {
    setDismissed((p) => {
      const next = new Set(p).add(id);
      persistReadIds(next);
      return next;
    });
  }, []);
  const onDismissAll = useCallback(() => {
    setDismissed((p) => {
      const next = new Set(p);
      for (const m of incomingRef.current) next.add(m.id);
      persistReadIds(next);
      return next;
    });
  }, []);
  const onOpenTimeline = useCallback((teamId?: string) => {
    // Redirect into the Channels → Timeline view, scoped to the pop-up's team
    // when the card carries one.
    const s = useSystemStore.getState();
    s.setMonitorInitialView('channels');
    s.setMonitorChannelPreset(teamId ? { teamId, personaId: null } : null);
    s.setHeaderOverlay('monitor');
  }, []);

  // Disabling clears the QUEUE so stale pop-ups can't resurface on re-enable
  // — but the read ledger survives: acknowledged means acknowledged.
  useEffect(() => {
    if (enabled) return;
    setIncoming([]);
    setDismissed(loadReadIds());
  }, [enabled]);

  // No auto-timeout (redesigned 2026-08-26): pop-ups showed and hid too
  // quickly. A card now stays until the operator acknowledges it (the icon
  // button — marks it read persistently) or opens the messaging UI from it.

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
  const props: LiveVariantProps = { messages: live, onDismiss, onDismissAll, onOpenTimeline, reducedMotion };

  if (!enabled) return null;

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
