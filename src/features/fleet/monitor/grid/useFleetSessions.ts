// useFleetSessions — the Activity board's read on live Claude (Fleet) sessions.
//
// Freshness: `FleetBootstrap` is mounted UNGATED in App.tsx, so the session
// registry is listened to and pulled once at app boot in every build, dev or
// prod — this hook subscribes to an already-warm store and starts nothing. The
// list is event-driven (fleet:session-state / :session-exited /
// :registry-changed), never polled, so a square's border follows the real
// session within one Tauri event.
//
// Dev projects are the one piece that is NOT guaranteed warm: `fetchProjects`
// is deliberately absent from the startup waves (PersonasPage prewarms it 2s
// in). Without projects every session is unmappable, so the board would show
// them all as Ungrouped — correct, but less useful. We therefore kick a single
// fetch when the list is empty, once per mount, never in a loop.

import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import { groupSessions, type SessionGrouping } from './fleetSessionModel';

export function useFleetSessions(): SessionGrouping {
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));
  const projects = useSystemStore(useShallow((s) => s.projects));
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || projects.length > 0) return;
    asked.current = true;
    void fetchProjects?.().catch(silentCatch('FleetGrid:fetchProjects'));
  }, [projects.length, fetchProjects]);

  return useMemo(() => groupSessions(sessions, projects), [sessions, projects]);
}
