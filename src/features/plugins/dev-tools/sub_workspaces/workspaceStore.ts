// PROTOTYPE-STAGE workspace model — a grouping ABOVE dev projects.
//
// Deliberately backed by localStorage, not SQLite: the CRUD in the variants is
// REAL (create / rename / recolour / delete / re-assign projects, all durable
// across reloads) so the directions can be judged with live data, but no
// permanent migration is committed before the UX is settled. The eventual
// backend swap is confined to this module — the shape below mirrors the
// planned `dev_workspaces` table + nullable `dev_projects.workspace_id`, so
// every consumer keeps its import.
//
// Why a new table and not `dev_projects.team_id`: that column is a *pipeline
// binding* (project → the PersonaTeam that executes on it) and the engine
// assumes it resolves to at most one project (`team_context.rs` does
// `SELECT id FROM dev_projects WHERE team_id = ?1 LIMIT 1`). A `PersonaGroup`
// "design-time workspace folder" did exist and was retired into teams in
// 2026-05; re-overloading teams would re-create exactly that cardinality
// problem and corrupt persona attribution.
import { useSyncExternalStore } from 'react';

export interface Workspace {
  id: string;
  name: string;
  /** Swatch colour — a workspace's identity at a glance in every switcher. */
  color: string;
  /** Project ids assigned to this workspace (1:N — a project lives in one). */
  projectIds: string[];
}

/** Sentinel for "no workspace selected" — every project is in scope. */
export const ALL_WORKSPACES = null;

export const WORKSPACE_COLORS = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#a78bfa', '#ec4899', '#64748b',
] as const;

const KEY = 'devtools.workspaces.v1';
const ACTIVE_KEY = 'devtools.activeWorkspace.v1';

interface Snapshot {
  workspaces: Workspace[];
  activeId: string | null;
}

let snapshot: Snapshot = { workspaces: [], activeId: null };
let hydrated = false;
const listeners = new Set<() => void>();

function readStorage(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY);
    const workspaces = raw ? (JSON.parse(raw) as Workspace[]) : [];
    const activeId = localStorage.getItem(ACTIVE_KEY);
    // A stale active id (workspace deleted in another tab) must not strand the
    // UI on a workspace that no longer exists.
    return { workspaces, activeId: workspaces.some((w) => w.id === activeId) ? activeId : null };
  } catch {
    return { workspaces: [], activeId: null };
  }
}

function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  snapshot = readStorage();
}

function commit(next: Snapshot): void {
  snapshot = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next.workspaces));
    if (next.activeId) localStorage.setItem(ACTIVE_KEY, next.activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // best-effort — a blocked storage must never break the switchers
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  ensureHydrated();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): Snapshot {
  ensureHydrated();
  return snapshot;
}

/** Live workspaces + active selection. Snapshot identity is stable between
 *  mutations, so this is safe for useSyncExternalStore. */
export function useWorkspaces(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// -- mutations ---------------------------------------------------------------

const uid = () => `ws${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function createWorkspace(name: string, color?: string): Workspace {
  ensureHydrated();
  const ws: Workspace = {
    id: uid(),
    name: name.trim() || 'New workspace',
    color: color ?? WORKSPACE_COLORS[snapshot.workspaces.length % WORKSPACE_COLORS.length]!,
    projectIds: [],
  };
  commit({ workspaces: [...snapshot.workspaces, ws], activeId: ws.id });
  return ws;
}

export function renameWorkspace(id: string, name: string): void {
  ensureHydrated();
  commit({
    ...snapshot,
    workspaces: snapshot.workspaces.map((w) => (w.id === id ? { ...w, name: name.trim() || w.name } : w)),
  });
}

export function recolorWorkspace(id: string, color: string): void {
  ensureHydrated();
  commit({ ...snapshot, workspaces: snapshot.workspaces.map((w) => (w.id === id ? { ...w, color } : w)) });
}

/** Delete a workspace. Its projects become unassigned — never deleted. */
export function deleteWorkspace(id: string): void {
  ensureHydrated();
  const workspaces = snapshot.workspaces.filter((w) => w.id !== id);
  commit({ workspaces, activeId: snapshot.activeId === id ? null : snapshot.activeId });
}

/** Move a project into a workspace (or out of every one when null). A project
 *  belongs to exactly one workspace, so this removes it from the others. */
export function assignProject(projectId: string, workspaceId: string | null): void {
  ensureHydrated();
  const workspaces = snapshot.workspaces.map((w) => {
    const without = w.projectIds.filter((id) => id !== projectId);
    return w.id === workspaceId ? { ...w, projectIds: [...without, projectId] } : { ...w, projectIds: without };
  });
  commit({ ...snapshot, workspaces });
}

export function setActiveWorkspace(id: string | null): void {
  ensureHydrated();
  commit({ ...snapshot, activeId: id });
}

// -- selectors ---------------------------------------------------------------

/** The workspace a project belongs to, if any. */
export function workspaceOf(workspaces: Workspace[], projectId: string): Workspace | null {
  return workspaces.find((w) => w.projectIds.includes(projectId)) ?? null;
}

/** Scope a project list to a workspace. `null` (All) passes everything through
 *  — the safe default that keeps every existing surface working untouched. */
export function scopeProjects<T extends { id: string }>(
  projects: T[],
  workspaces: Workspace[],
  activeId: string | null,
): T[] {
  if (!activeId) return projects;
  const ws = workspaces.find((w) => w.id === activeId);
  if (!ws) return projects;
  const set = new Set(ws.projectIds);
  return projects.filter((p) => set.has(p.id));
}

/** Projects assigned to no workspace at all. */
export function unassignedProjects<T extends { id: string }>(projects: T[], workspaces: Workspace[]): T[] {
  const assigned = new Set(workspaces.flatMap((w) => w.projectIds));
  return projects.filter((p) => !assigned.has(p.id));
}
