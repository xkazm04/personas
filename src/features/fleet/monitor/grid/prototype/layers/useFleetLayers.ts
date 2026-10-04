// useFleetLayers — the layer the Activity surface has never had.
//
// Baseline and the Annunciator both paint ONE flat layer: every team column of
// every workspace, side by side, with the decision rail open beside them. At a
// hundred personas across a dozen projects that is a wall of text with nothing
// above it, which is the defect both prototypes share.
//
// The join that makes a layer possible already exists in the data and nothing
// on the board was reading it: `DevProject` carries BOTH `workspace_id` and
// `team_id`. So:
//
//     workspace  (workspaceStore: id, name, colour)
//        └─ project   (DevProject.workspace_id -> workspace)
//              └─ team     (DevProject.team_id -> the board column)
//                    └─ personas + sessions   (the column's rows)
//
// This hook derives that tree once and hands both layer variants the same
// model, so they differ in how they DRAW the layers and never in what a layer
// means. It owns no pixels.

import { useCallback, useMemo, useState } from 'react';
import type { DevProject } from '@/lib/bindings/DevProject';
import { useWorkspaces } from '@/features/plugins/dev-tools/sub_workspaces/workspaceStore';
import { tallyStates, type SquareState } from '../../fleetGridModel';
import type { BoardColumn, BoardModel } from '../../useBoardModel';
import type { ActivitySurface } from '../useActivitySurface';

/** What a project owes a human, by kind. Three counts that never overlap:
 *  a decision waiting, something that broke, something unread. */
export interface FollowUps {
  reviews: number;
  warnings: number;
  messages: number;
  total: number;
}

/** A project as a layer-1 unit: its column, its roster states, what it owes you. */
export interface ProjectUnit {
  projectId: string;
  name: string;
  /** The board column this project's work lands in, when it is bound to one. */
  column: BoardColumn | null;
  teamId: string | null;
  /** Per-state persona counts, from the column's own cards. */
  states: Record<SquareState, number>;
  personas: number;
  /** Personas this project needs a human for: attention + failed. */
  needsYou: number;
  /** Live sessions the column carries (running, spawning, awaiting input…). */
  sessions: number;
  /** The project's own colour, inherited from its workspace. */
  color: string;
  /** Rolled up from the column's own cards — the same numbers the board badges
   *  each persona with, summed, so a card and its personas cannot disagree. */
  followUps: FollowUps;
  /** The one state the card is drawn in: the worst thing happening inside. */
  dominant: SquareState;
}

export interface WorkspaceUnit {
  workspaceId: string;
  name: string;
  color: string;
  projects: ProjectUnit[];
  needsYou: number;
  personas: number;
}

const NO_STATES: Record<SquareState, number> = { running: 0, attention: 0, failed: 0, idle: 0 };

/** The board's OWN tally, never a second count of the same cards — a column
 *  that disagreed with the header's pills would be the layer lying about the
 *  board underneath it. */
function tallyColumn(column: BoardColumn | null): Record<SquareState, number> {
  return column ? tallyStates(column.cards) : NO_STATES;
}

const NO_FOLLOW_UPS: FollowUps = { reviews: 0, warnings: 0, messages: 0, total: 0 };

function followUpsOf(column: BoardColumn | null, states: Record<SquareState, number>): FollowUps {
  if (!column) return NO_FOLLOW_UPS;
  let reviews = 0;
  let messages = 0;
  for (const card of column.cards) {
    reviews += card.reviewCount;
    messages += card.messageCount;
  }
  // A warning is a persona that BROKE, which is a different fact from a review
  // waiting or a report unread — so the three never double-count one thing.
  const warnings = states.failed;
  return { reviews, warnings, messages, total: reviews + warnings + messages };
}

/** Worst-first: a project with one failure is a failing project however many
 *  of its agents are idle. */
function dominantState(states: Record<SquareState, number>): SquareState {
  if (states.failed > 0) return 'failed';
  if (states.attention > 0) return 'attention';
  if (states.running > 0) return 'running';
  return 'idle';
}

/**
 * Columns that belong to no project of any workspace — teamless personas, the
 * cross-project workspace groups themselves, contest lanes, remote devices.
 * They are still the operator's fleet, so layer 1 must be able to show them
 * rather than silently dropping whatever the join does not reach.
 */
function unboundColumns(model: BoardModel, claimed: ReadonlySet<string>): BoardColumn[] {
  return model.columns.filter((c) => !claimed.has(c.teamId) && c.rows.length > 0);
}

export interface FleetLayers {
  workspaces: WorkspaceUnit[];
  /** Columns no workspace project claims, as layer-1 units of their own. */
  loose: ProjectUnit[];
  /** The workspace layer 1 is showing, or null for "every workspace". */
  workspaceId: string | null;
  setWorkspaceId: (id: string | null) => void;
  /** The project layer 2 is showing, or null while layer 1 is up. */
  openProjectId: string | null;
  openProject: (projectId: string) => void;
  closeProject: () => void;
  /** The units layer 1 draws right now (one workspace's, or all of them). */
  visible: ProjectUnit[];
  /** The unit layer 2 is drawing, resolved from `openProjectId`. */
  open: ProjectUnit | null;
  /** Everything the fleet owes a human, across every workspace. */
  totalNeedsYou: number;
}

export function useFleetLayers(surface: ActivitySurface): FleetLayers {
  const { workspaces: allWorkspaces, activeId } = useWorkspaces();
  const projects: readonly DevProject[] = surface.board.projects;
  const model = surface.model;

  // `undefined` means "nobody has chosen yet, follow the app's active
  // workspace"; a string or an explicit null is the viewer's own choice. The
  // distinction is load-bearing: the store hydrates after the first render, so
  // initialising state FROM `activeId` would pin the surface to whatever was
  // known at mount (usually nothing) and never catch up.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const workspaceId = picked === undefined ? activeId : picked;
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);

  // Switching workspace closes whatever project was open: layer 2 belongs to
  // the workspace that opened it, and leaving it mounted would show one
  // workspace's project under another one's name.
  const pickWorkspace = useCallback((id: string | null) => {
    setPicked(id);
    setOpenProjectId(null);
  }, []);

  const openProject = useCallback((projectId: string) => setOpenProjectId(projectId), []);
  const closeProject = useCallback(() => setOpenProjectId(null), []);

  const byTeam = useMemo(() => {
    const m = new Map<string, BoardColumn>();
    for (const c of model.columns) m.set(c.teamId, c);
    return m;
  }, [model.columns]);

  const unitFor = useCallback(
    (project: DevProject, color: string): ProjectUnit => {
      const column = (project.team_id && byTeam.get(project.team_id)) || null;
      const states = tallyColumn(column);
      return {
        projectId: project.id,
        name: project.name,
        column,
        teamId: project.team_id,
        states,
        personas: column ? column.cards.length : 0,
        needsYou: states.attention + states.failed,
        sessions: column ? column.rows.filter((r) => r.kind === 'session').length : 0,
        color,
        followUps: followUpsOf(column, states),
        dominant: dominantState(states),
      };
    },
    [byTeam],
  );

  const workspaces = useMemo((): WorkspaceUnit[] => {
    return allWorkspaces.map((ws) => {
      const own = projects.filter((p) => p.workspace_id === ws.id && p.enabled);
      const units = own.map((p) => unitFor(p, ws.color));
      return {
        workspaceId: ws.id,
        name: ws.name,
        color: ws.color,
        projects: units,
        needsYou: units.reduce((n, u) => n + u.needsYou, 0),
        personas: units.reduce((n, u) => n + u.personas, 0),
      };
    });
  }, [allWorkspaces, projects, unitFor]);

  // Every team a workspace project already speaks for. A column reached twice
  // (two projects on one team) is claimed once.
  const claimed = useMemo(() => {
    const s = new Set<string>();
    for (const ws of workspaces) for (const u of ws.projects) if (u.teamId) s.add(u.teamId);
    return s;
  }, [workspaces]);

  const loose = useMemo((): ProjectUnit[] => {
    return unboundColumns(model, claimed).map((column) => {
      const states = tallyColumn(column);
      return {
        projectId: `column:${column.teamId}`,
        name: column.teamName,
        column,
        teamId: column.teamId,
        states,
        personas: column.cards.length,
        needsYou: states.attention + states.failed,
        sessions: column.rows.filter((r) => r.kind === 'session').length,
        color: column.teamColor,
        followUps: followUpsOf(column, states),
        dominant: dominantState(states),
      };
    });
  }, [model, claimed]);

  const visible = useMemo((): ProjectUnit[] => {
    const fromWorkspaces = workspaceId === null
      ? workspaces.flatMap((w) => w.projects)
      : (workspaces.find((w) => w.workspaceId === workspaceId)?.projects ?? []);
    // The loose columns ride along only on the "every workspace" view: inside a
    // named workspace they would be a claim that they belong to it.
    const units = workspaceId === null ? [...fromWorkspaces, ...loose] : fromWorkspaces;
    // What needs a human first, then the busiest, then by name — so the top of
    // layer 1 is always the answer to "where do I go".
    return [...units].sort(
      (a, b) =>
        b.needsYou - a.needsYou
        || b.states.running - a.states.running
        || a.name.localeCompare(b.name),
    );
  }, [workspaces, workspaceId, loose]);

  const open = useMemo(
    () => visible.find((u) => u.projectId === openProjectId) ?? null,
    [visible, openProjectId],
  );

  const totalNeedsYou = useMemo(
    () => workspaces.reduce((n, w) => n + w.needsYou, 0) + loose.reduce((n, u) => n + u.needsYou, 0),
    [workspaces, loose],
  );

  return {
    workspaces, loose, workspaceId, setWorkspaceId: pickWorkspace,
    openProjectId, openProject, closeProject, visible, open, totalNeedsYou,
  };
}
