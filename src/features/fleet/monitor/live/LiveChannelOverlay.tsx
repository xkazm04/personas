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
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { MergedChannels } from '../channels/mergedFeed';
import type { FeedTeam, TaggedItem } from '../channels/types';
import type { Persona } from '@/lib/bindings/Persona';
import { LiveCommsStack } from './LiveCommsStack';
import { LIVE_TTL_MS, projectChannelItem, type LiveMessage, type LiveVariantProps } from './liveModel';

const CAP = 30;        // bound the accumulated window
const TICK_MS = 300;   // auto-expire resolution
const NEW_GRACE_MS = 8000; // an item this fresh at mount still pops (vs. silent history)

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
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const incomingRef = useRef(incoming);
  incomingRef.current = incoming;
  const pauseStart = useRef(new Map<string, number>());
  const pausedTotal = useRef(new Map<string, number>());

  const enqueue = useCallback((msgs: LiveMessage[]) => {
    setIncoming((prev) => [...msgs, ...prev].slice(0, CAP));
  }, []);
  const onDismiss = useCallback((id: string) => setDismissed((p) => new Set(p).add(id)), []);
  const onDismissAll = useCallback(() => setDismissed(new Set(incomingRef.current.map((m) => m.id))), []);
  const onHover = useCallback((id: string, hovered: boolean) => {
    if (hovered) {
      pauseStart.current.set(id, Date.now());
    } else {
      const started = pauseStart.current.get(id);
      if (started != null) {
        pausedTotal.current.set(id, (pausedTotal.current.get(id) ?? 0) + (Date.now() - started));
        pauseStart.current.delete(id);
      }
    }
  }, []);
  const onOpenTimeline = useCallback(() => {
    // Redirect into the Channels → Timeline view (team-scoped filter is a follow-up).
    const s = useSystemStore.getState();
    s.setMonitorInitialView('channels');
    s.setHeaderOverlay('monitor');
  }, []);

  // Disabling clears the queue so stale pop-ups can't resurface on re-enable.
  useEffect(() => {
    if (enabled) return;
    setIncoming([]);
    setDismissed(new Set());
    pauseStart.current.clear();
    pausedTotal.current.clear();
  }, [enabled]);

  // Natural auto-timeout — expire non-paused messages past their TTL.
  useEffect(() => {
    if (!enabled) return;
    const iv = setInterval(() => {
      const now = Date.now();
      setDismissed((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const m of incomingRef.current) {
          if (next.has(m.id) || pauseStart.current.has(m.id)) continue;
          const age = now - m.receivedAt - (pausedTotal.current.get(m.id) ?? 0);
          if (age >= LIVE_TTL_MS) { next.add(m.id); changed = true; }
        }
        return changed ? next : prev;
      });
    }, TICK_MS);
    return () => clearInterval(iv);
  }, [enabled]);

  const live = useMemo(() => incoming.filter((m) => !dismissed.has(m.id)), [incoming, dismissed]);
  const props: LiveVariantProps = { messages: live, onDismiss, onDismissAll, onOpenTimeline, onHover, reducedMotion };

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
