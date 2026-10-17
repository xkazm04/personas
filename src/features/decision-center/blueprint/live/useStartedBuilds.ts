// The builds this sheet started, followed live. Each `start` line the dock console printed carries the drive's
// `personas:<uuid>` label; the fleet already tags every session of that drive with it. This reads the fleet's
// session registry (the system store, kept warm by the ungated FleetBootstrap and fed by the fleet-session-state /
// -exited events), so it opens NO listener of its own and adds no backend command. When a start settles (its last
// session ends) it calls `onSettled` once: that event is the invalidation, and it beats the poll.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from '@/stores/systemStore';
import type { StartLine } from '../ui/rail/panels/agentsModel';
import type { Run } from '@/lib/lensScan/wire';
import { SILENT_AFTER_MS, belongsTo, coveredBy, deriveStart, isBuilding, type SessionLite, type StartState } from './startedModel';

export interface StartedBuilds {
  /** Each start's state, by its label. */
  byLabel: ReadonlyMap<string, StartState>;
  /** The proposal ids of every start still in flight (the queue rows say "building"). */
  building: ReadonlySet<string>;
  /** Is any start still in flight? Holds the sheet's fast re-read open. */
  unsettled: boolean;
}

const NONE: readonly SessionLite[] = [];
const NO_STATES: ReadonlyMap<string, StartState> = new Map();
const NO_IDS: ReadonlySet<string> = new Set();

export function useStartedBuilds(starts: readonly StartLine[], onEnded: () => void, runs: readonly Run[]): StartedBuilds {
  const labels = starts.map((l) => l.result.label);
  const labelKey = labels.join('|');
  // only the sessions of OUR starts: an unrelated session's event leaves this selection shallow-equal, no re-render
  const sessions = useSystemStore(useShallow((s): readonly SessionLite[] => (
    labels.length ? s.fleetSessions.filter((x) => labels.some((l) => belongsTo(x, l))) : NONE
  )));
  const seen = useRef(new Map<string, number>());
  const [clock, setClock] = useState(0);

  const byLabel = useMemo(() => {
    if (!starts.length) return NO_STATES;
    const now = Date.now();
    const out = new Map<string, StartState>();
    for (const l of starts) {
      const label = l.result.label;
      if (!seen.current.has(label)) seen.current.set(label, now);
      out.set(label, deriveStart(sessions.filter((x) => belongsTo(x, label)), seen.current.get(label) ?? now, now, coveredBy(runs, l.ids)));
    }
    return out;
    // `clock` re-derives when the silent deadline passes; `starts` is read through its labels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, labelKey, clock, runs]);

  const building = useMemo(() => {
    const ids = new Set<string>();
    for (const l of starts) {
      const st = byLabel.get(l.result.label);
      if (st && isBuilding(st)) for (const id of l.ids) ids.add(id);
    }
    return ids.size ? ids : NO_IDS;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byLabel, labelKey]);

  // a start with no session yet is "silent" after a while: wake once at the earliest such deadline
  useEffect(() => {
    const waiting = [...byLabel].filter(([label, st]) => st.sessions === 0 && !st.settled && seen.current.has(label));
    if (!waiting.length) return;
    const due = Math.min(...waiting.map(([label]) => (seen.current.get(label) ?? 0) + SILENT_AFTER_MS + 1));
    const t = setTimeout(() => setClock((n) => n + 1), Math.max(0, due - Date.now()));
    return () => clearTimeout(t);
  }, [byLabel]);

  // the edge from "a session alive" to "every session ended" fires the one reload: it is what lets the store tell us
  // its run is over (the build only settles once it has)
  const was = useRef(new Map<string, boolean>());
  const settled = useRef(onEnded);
  settled.current = onEnded;
  useEffect(() => {
    let fire = false;
    for (const [label, st] of byLabel) {
      if (was.current.get(label) === false && st.ended) fire = true;
      was.current.set(label, st.ended);
    }
    if (fire) settled.current();
  }, [byLabel]);

  const unsettled = [...byLabel.values()].some(isBuilding);
  return { byLabel, building, unsettled };
}
