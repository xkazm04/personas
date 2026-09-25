import { useCallback, useMemo, useState } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { GROUP_ORDER, type FleetGroup } from './fleetGridGroups';

export type FleetSessionGroup = FleetGroup & { sessions: FleetSession[] };

/**
 * The Sessions list's view state: the state filter (a summary pill), the text
 * query, the grouped and ordered rows, and the keyboard moves over them.
 */
export function useFleetGridNavigation(
  sessions: FleetSession[],
  activeSessionId: string | null,
  setActiveSession: (id: string) => void,
) {
  const [filter, setFilter] = useState<FleetSessionState | null>(null);
  const [query, setQuery] = useState('');

  const toggleFilter = useCallback(
    (state: FleetSessionState) => setFilter((cur) => (cur === state ? null : state)),
    [],
  );

  // Sessions blocked on the operator: drives the "Needs you" attention
  // banner. Newest activity first so the most recent prompt leads.
  const waitingSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.state === 'awaiting_input')
        .sort((a, b) => Number(b.lastActivityMs) - Number(a.lastActivityMs)),
    [sessions],
  );

  // Cycle focus through the waiting sessions, wrapping around from the
  // currently-focused one: fast triage when several are blocked at once.
  const handleCycleNext = useCallback(() => {
    if (waitingSessions.length === 0) return;
    const idx = waitingSessions.findIndex((s) => s.id === activeSessionId);
    const next = waitingSessions[(idx + 1) % waitingSessions.length];
    if (next) setActiveSession(next.id);
  }, [waitingSessions, activeSessionId, setActiveSession]);

  // Group sessions by lifecycle state in GROUP_ORDER; within a group, newest
  // activity first.
  const groups = useMemo<FleetSessionGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const buckets = new Map<FleetSessionState, FleetSession[]>();
    for (const s of sessions) {
      if (q && !`${s.projectLabel} ${s.name ?? ''}`.toLowerCase().includes(q)) continue;
      const arr = buckets.get(s.state) ?? [];
      arr.push(s);
      buckets.set(s.state, arr);
    }
    for (const arr of buckets.values()) {
      arr.sort((a, b) => Number(b.lastActivityMs) - Number(a.lastActivityMs));
    }
    return GROUP_ORDER
      .filter((g) => buckets.has(g.id) && (filter === null || g.id === filter))
      .map((g) => ({ ...g, sessions: buckets.get(g.id)! }));
  }, [sessions, filter, query]);

  // Flattened visible sessions in display order: drives the up/down hotkey
  // focus moves so keyboard order matches what's on screen.
  const flatVisibleSessions = useMemo(() => groups.flatMap((g) => g.sessions), [groups]);

  const handleMoveFocus = useCallback(
    (delta: 1 | -1) => {
      const list = flatVisibleSessions;
      if (list.length === 0) return;
      const idx = list.findIndex((s) => s.id === activeSessionId);
      const next =
        idx === -1
          ? (delta === 1 ? list[0] : list[list.length - 1])
          : list[(idx + delta + list.length) % list.length];
      if (next) setActiveSession(next.id);
    },
    [flatVisibleSessions, activeSessionId, setActiveSession],
  );

  return { filter, toggleFilter, query, setQuery, groups, waitingSessions, handleCycleNext, handleMoveFocus };
}
