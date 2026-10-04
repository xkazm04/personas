// The workspace layer, ported from the Plate variant at consolidation.
//
// The Annunciator painted ONE flat layer: every team of every workspace at
// once. Plate's one idea worth keeping was the layer above it — a workspace is
// a place, and an operator works one at a time. Here it is a NOTEPAD TAB over
// the panel rather than Plate's whole second screen: the board below narrows,
// nothing navigates, and "All workspaces" is the resting state so the surface
// is never silently showing a slice of the fleet.
//
// The join already exists in the data: `DevProject` carries BOTH `workspace_id`
// and `team_id`, and a board column IS a team. So a workspace resolves to a set
// of team ids, and everything on the panel — a bay, a queue row, a parked
// session — is kept or dropped by the team it belongs to. Sessions reach their
// team the same way `groupSessions` does, by `cwd` → project root, so a session
// and the bay it sits in can never disagree about which workspace they are in.

import { useCallback, useMemo, useState } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useWorkspaces } from '@/features/plugins/dev-tools/sub_workspaces/workspaceStore';
import { tallyStates } from '../../fleetGridModel';
import type { BoardColumn } from '../../useBoardModel';
import type { ActivitySurface } from '../useActivitySurface';

/** Mirrors `fleetSessionModel.normPath` — the one cwd↔root comparison. */
const normPath = (p: string): string => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

export interface WorkspaceTab {
  id: string;
  name: string;
  color: string;
  /** Personas in this workspace that need a human: attention + failed. */
  needsYou: number;
}

export interface WorkspaceScope {
  /** The named workspaces that hold at least one board team. */
  tabs: WorkspaceTab[];
  /** `null` = every workspace; the strip's first tab. */
  activeId: string | null;
  pick: (id: string | null) => void;
  /** A workspace is picked, so the board below is a slice. */
  active: boolean;
  /** Keep a bay / queue row by the team it belongs to. */
  keepTeam: (teamId: string | null | undefined) => boolean;
  /** Keep a session by the project its cwd sits in. */
  keepSession: (s: Pick<FleetSession, 'cwd'>) => boolean;
}

export function useWorkspaceScope(surface: ActivitySurface): WorkspaceScope {
  const { workspaces } = useWorkspaces();
  const projects = surface.board.projects;
  const columns = surface.unfilteredModel.columns;
  const [activeId, setActiveId] = useState<string | null>(null);

  const byTeam = useMemo(() => {
    const m = new Map<string, BoardColumn>();
    for (const c of columns) m.set(c.teamId, c);
    return m;
  }, [columns]);

  const tabs = useMemo((): WorkspaceTab[] => {
    const out: WorkspaceTab[] = [];
    for (const ws of workspaces) {
      let needsYou = 0;
      let teams = 0;
      for (const p of projects) {
        if (p.workspace_id !== ws.id || !p.enabled || !p.team_id) continue;
        const column = byTeam.get(p.team_id);
        if (!column) continue;
        teams += 1;
        const states = tallyStates(column.cards);
        needsYou += states.attention + states.failed;
      }
      // A workspace whose projects reach no board team has nothing to narrow
      // to; a tab for it would open on an empty panel every time.
      if (teams > 0) out.push({ id: ws.id, name: ws.name, color: ws.color, needsYou });
    }
    return out;
  }, [workspaces, projects, byTeam]);

  // Teams of the picked workspace, and the project roots that reach them.
  const picked = useMemo(() => {
    if (activeId === null) return null;
    const teamIds = new Set<string>();
    const roots = new Set<string>();
    for (const p of projects) {
      if (p.workspace_id !== activeId || !p.enabled || !p.team_id) continue;
      teamIds.add(p.team_id);
      if (p.root_path) roots.add(normPath(p.root_path));
    }
    return { teamIds, roots };
  }, [activeId, projects]);

  const keepTeam = useCallback(
    (teamId: string | null | undefined) => picked === null || (!!teamId && picked.teamIds.has(teamId)),
    [picked],
  );

  const keepSession = useCallback(
    (s: Pick<FleetSession, 'cwd'>) => picked === null || (!!s.cwd && picked.roots.has(normPath(s.cwd))),
    [picked],
  );

  // A picked workspace that disappears (deleted, or its last team emptied)
  // must not strand the panel on a slice nothing can reach.
  const live = activeId !== null && tabs.some((w) => w.id === activeId) ? activeId : null;

  return {
    tabs,
    activeId: live,
    pick: setActiveId,
    active: live !== null,
    keepTeam: live === null ? ALWAYS : keepTeam,
    keepSession: live === null ? ALWAYS : keepSession,
  };
}

const ALWAYS = () => true;
