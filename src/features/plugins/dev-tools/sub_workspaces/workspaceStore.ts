// Workspace store — SQLite-backed (dev_workspaces + dev_projects.workspace_id)
// via the dev_tools_workspace_* commands. Promoted from the localStorage
// prototype per docs/plans/workspace-knowledge-center.md; the prototype's
// consumer contract is preserved verbatim (useWorkspaces() snapshot shape,
// fire-and-forget mutations, pure selectors), so every switcher keeps its
// import. Legacy `devtools.workspaces.v1` data is imported once on first
// hydrate (idempotent on name), then the key is cleared.
//
// The active-workspace SELECTION stays in localStorage — it is a per-device
// UI preference, not domain data.
import { useSyncExternalStore } from 'react';

import { listProjects } from '@/api/devTools/devTools';
import {
  assignProjectToWorkspace,
  createWorkspace as apiCreateWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
  importLocalWorkspaces,
  listWorkspaces,
  updateWorkspace as apiUpdateWorkspace,
} from '@/api/devTools/workspaces';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

export interface Workspace {
  id: string;
  name: string;
  /** Swatch colour — a workspace's identity at a glance in every switcher. */
  color: string;
  /** Project ids assigned to this workspace (1:N — a project lives in one). */
  projectIds: string[];
  /** Consent (given at creation) to install the preset scan skills into
   *  member projects when they join. */
  adoptDefaultSkills: boolean;
}

/** Sentinel for "no workspace selected" — every project is in scope. */
export const ALL_WORKSPACES = null;

export const WORKSPACE_COLORS = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#a78bfa', '#ec4899', '#64748b',
] as const;

const LEGACY_KEY = 'devtools.workspaces.v1';
const ACTIVE_KEY = 'devtools.activeWorkspace.v1';

interface Snapshot {
  workspaces: Workspace[];
  activeId: string | null;
}

let snapshot: Snapshot = { workspaces: [], activeId: null };
let hydrateStarted = false;
const listeners = new Set<() => void>();

function readActiveId(workspaces: Workspace[]): string | null {
  try {
    const activeId = localStorage.getItem(ACTIVE_KEY);
    // A stale active id (workspace deleted elsewhere) must not strand the UI
    // on a workspace that no longer exists.
    return workspaces.some((w) => w.id === activeId) ? activeId : null;
  } catch {
    return null;
  }
}

function commit(next: Snapshot): void {
  snapshot = next;
  try {
    if (next.activeId) localStorage.setItem(ACTIVE_KEY, next.activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch (err) {
    // best-effort — a blocked storage must never break the switchers
    silentCatch('workspaceStore:persistActive')(err);
  }
  for (const l of listeners) l();
}

/** One-time migration of the localStorage prototype into SQLite. */
async function importLegacyIfPresent(): Promise<void> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const legacy = JSON.parse(raw) as Array<{ name?: string; color?: string; projectIds?: string[] }>;
    const items = legacy
      .filter((w) => typeof w?.name === 'string' && w.name.trim())
      .map((w) => ({
        name: w.name as string,
        color: w.color ?? null,
        project_ids: Array.isArray(w.projectIds) ? w.projectIds : [],
      }));
    if (items.length > 0) await importLocalWorkspaces(items);
    localStorage.removeItem(LEGACY_KEY);
  } catch (err) {
    // Leave the legacy key in place so a later hydrate can retry the import.
    toastCatch('workspaceStore:importLegacy')(err);
  }
}

/** Re-fetch workspaces + membership from the backend and publish. */
export async function refreshWorkspaces(): Promise<void> {
  const [rows, projects] = await Promise.all([listWorkspaces(), listProjects()]);
  const workspaces: Workspace[] = rows.map((w, i) => ({
    id: w.id,
    name: w.name,
    color: w.color ?? WORKSPACE_COLORS[i % WORKSPACE_COLORS.length]!,
    projectIds: projects.filter((p) => p.workspace_id === w.id).map((p) => p.id),
    adoptDefaultSkills: w.adopt_default_skills,
  }));
  commit({ workspaces, activeId: readActiveId(workspaces) });
}

function ensureHydrated(): void {
  if (hydrateStarted) return;
  hydrateStarted = true;
  void (async () => {
    await importLegacyIfPresent();
    await refreshWorkspaces();
  })().catch(toastCatch('workspaceStore:hydrate'));
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

// -- mutations (fire-and-forget: optimistic publish, then backend + refresh) --

export function createWorkspace(name: string, color?: string, adoptDefaultSkills?: boolean): void {
  const resolved = color ?? WORKSPACE_COLORS[snapshot.workspaces.length % WORKSPACE_COLORS.length]!;
  void apiCreateWorkspace(name.trim() || 'New workspace', resolved, undefined, adoptDefaultSkills)
    .then(async (ws) => {
      await refreshWorkspaces();
      commit({ ...snapshot, activeId: ws.id });
    })
    .catch(toastCatch('workspaceStore:create'));
}

/** Install the app's preset scan skills into a project (consenting workspace's
 *  member). Existing skills are left untouched; failures are background-only. */
async function installPresetSkills(projectId: string): Promise<void> {
  const [{ PRESET_SKILLS }, { installSystemSkill }] = await Promise.all([
    import('../constants/presetSkills'),
    import('@/api/devTools/devTools'),
  ]);
  for (const name of PRESET_SKILLS.keys()) {
    try {
      await installSystemSkill(name, projectId, false);
    } catch (e) {
      silentCatch('workspaceStore:installPresetSkill')(e);
    }
  }
}

export function renameWorkspace(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  commit({
    ...snapshot,
    workspaces: snapshot.workspaces.map((w) => (w.id === id ? { ...w, name: trimmed } : w)),
  });
  void apiUpdateWorkspace(id, { name: trimmed })
    .then(refreshWorkspaces)
    .catch(toastCatch('workspaceStore:rename'));
}

export function recolorWorkspace(id: string, color: string): void {
  commit({ ...snapshot, workspaces: snapshot.workspaces.map((w) => (w.id === id ? { ...w, color } : w)) });
  void apiUpdateWorkspace(id, { color })
    .then(refreshWorkspaces)
    .catch(toastCatch('workspaceStore:recolor'));
}

/** Delete a workspace. Its projects become unassigned — never deleted. */
export function deleteWorkspace(id: string): void {
  commit({
    workspaces: snapshot.workspaces.filter((w) => w.id !== id),
    activeId: snapshot.activeId === id ? null : snapshot.activeId,
  });
  void apiDeleteWorkspace(id)
    .then(refreshWorkspaces)
    .catch(toastCatch('workspaceStore:delete'));
}

/** Move a project into a workspace (or out of every one when null). A project
 *  belongs to exactly one workspace, so this removes it from the others. */
export function assignProject(projectId: string, workspaceId: string | null): void {
  commit({
    ...snapshot,
    workspaces: snapshot.workspaces.map((w) => {
      const without = w.projectIds.filter((id) => id !== projectId);
      return w.id === workspaceId ? { ...w, projectIds: [...without, projectId] } : { ...w, projectIds: without };
    }),
  });
  const consented = workspaceId !== null
    && snapshot.workspaces.find((w) => w.id === workspaceId)?.adoptDefaultSkills === true;
  void assignProjectToWorkspace(projectId, workspaceId)
    .then(async () => {
      // Consent given at workspace creation: joining populates the preset
      // scan skills into the member project (skip-existing, non-blocking).
      if (consented) await installPresetSkills(projectId);
      await refreshWorkspaces();
    })
    .catch(toastCatch('workspaceStore:assign'));
}

export function setActiveWorkspace(id: string | null): void {
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
