// Project → workspace → registry → skill library root.
//
// The Skills surface is scoped to the ACTIVE PROJECT, but a registry is wired at
// WORKSPACE level (one registry serves every project in the territory, and one
// registry can serve several workspaces). This hook is the join, so no surface
// has to re-derive it — and so "which library am I looking at?" has exactly one
// answer per project.
//
// Returns `libraryRoot: null` when nothing is wired. That is not an error state
// and not an empty library: it is the difference between "the registry publishes
// no skills" and "you have not connected a registry", which the UI must say
// differently or the user will go looking for skills that were never meant to be
// there.
//
// When no workspace registry is paired, the hook falls back to the PROJECT
// REPO's own declaration: `.ai/manifest.yaml` → `registry.local`, resolved by
// `skillFilesRegistryRoot` over IPC. That probe is async, so `source` is null
// (and `ready` false) until it settles — consumers must not paint the
// "no registry connected" state before then. Results are cached per
// root_path so tab switches never re-invoke IPC.

import { useEffect, useState, useSyncExternalStore } from 'react';

import { skillFilesRegistryRoot } from '@/api/devTools/devTools';
import { silentCatch } from '@/lib/silentCatch';
import { createSWRFetcher } from '@/lib/utils/staleWhileRevalidate';
import { useSystemStore } from '@/stores/systemStore';

import { registryFor, registryLinkSnapshot, subscribeRegistryLinks, type Registry } from './registryLinkStore';
import { useWorkspaces, workspaceOf, workspacesSnapshot } from '../workspaceStore';

/** The lane a registry publishes skills in. Fixed by the registry spec. */
const SKILLS_LANE = 'skills';

/** Clone path + lane → library root. ONE definition: the hook and the non-React
 *  resolver below both call it, because two copies of a path join is exactly the
 *  drift that makes two surfaces disagree about which library they are reading. */
function laneRoot(clonePath: string): string {
  return `${clonePath.replace(/[/\\]+$/, '')}/${SKILLS_LANE}`;
}

/**
 * Where `libraryRoot` was resolved from.
 * - `'registry'` — the workspace's wired registry clone (pairing wins).
 * - `'manifest'` — the project repo's `.ai/manifest.yaml` `registry.local`.
 * - `'home'` — nothing wired anywhere; callers fall back to `~/.claude/skills`
 *   (which is what `listSkillsGlobal(null)` reads).
 * - `null` — the manifest probe is still in flight; not settled yet.
 */
export type RegistryLibrarySource = 'registry' | 'manifest' | 'home' | null;

export interface RegistryLibrary {
  /** The registry this project's workspace holds, if any. */
  registry: Registry | null;
  /** Workspace the project belongs to — null when it is unassigned. */
  workspaceId: string | null;
  workspaceName: string | null;
  /**
   * Absolute path of the registry's `skills/` lane, or null when no registry is
   * wired. Pass straight to `listSkillsGlobal`.
   */
  libraryRoot: string | null;
  /** Where `libraryRoot` came from; null while the manifest probe is in flight. */
  source: RegistryLibrarySource;
  /** True once a registry is wired AND its pairing completed, OR the project's
   *  manifest resolved a library root. False while the probe is in flight. */
  ready: boolean;
}

/**
 * The resolution order, as a pure function so it is testable: a paired
 * workspace registry wins > the repo manifest's root > home (null). While the
 * async manifest probe has not settled, the answer is deliberately "not yet"
 * (`source: null`) rather than a premature "home" — that distinction is what
 * keeps consumers from flashing the wrong empty state.
 */
export function resolveLibraryRoot(input: {
  registryRoot: string | null;
  manifestRoot: string | null;
  manifestSettled: boolean;
}): { libraryRoot: string | null; source: RegistryLibrarySource } {
  if (input.registryRoot) return { libraryRoot: input.registryRoot, source: 'registry' };
  if (!input.manifestSettled) return { libraryRoot: null, source: null };
  if (input.manifestRoot) return { libraryRoot: input.manifestRoot, source: 'manifest' };
  return { libraryRoot: null, source: 'home' };
}

/** root_path → settled manifest probe result. Backed by the repo's shared
 *  SWR primitive (createSWRFetcher: module cache + in-flight dedupe + TTL +
 *  size cap live THERE, not here) — a manifest rarely changes mid-session, so
 *  a 5-minute TTL keeps tab switches free while still noticing an edit.
 *  `manifestSettledRoots` only records "this root_path has an answer" so the
 *  hook can render synchronously; the value itself always comes through SWR. */
const MANIFEST_TTL_MS = 5 * 60_000;
const manifestSettledRoots = new Map<string, string | null>();

function loadManifestRoot(rootPath: string): Promise<void> {
  const fetchOnce = createSWRFetcher<string | null>(
    `registry-manifest-root:${rootPath}`,
    () => skillFilesRegistryRoot(rootPath).catch((e) => {
      silentCatch('registryLibrary manifest root')(e);
      return null;
    }),
    MANIFEST_TTL_MS,
  );
  return fetchOnce().then(({ data }) => {
    manifestSettledRoots.set(rootPath, data);
  });
}

export function useRegistryLibrary(projectId: string | null): RegistryLibrary {
  const { workspaces } = useWorkspaces();
  useSyncExternalStore(subscribeRegistryLinks, registryLinkSnapshot, registryLinkSnapshot);
  const projects = useSystemStore((s) => s.projects);
  const projectsLoading = useSystemStore((s) => s.projectsLoading);

  const workspace = projectId ? workspaceOf(workspaces, projectId) : null;
  const registry = workspace ? registryFor(workspace.id) : null;

  // The clone path is joined with the lane name rather than stored as a second
  // field: the lane is part of the registry contract, not a user choice, and a
  // stored copy would be one more thing that can drift from it.
  const registryRoot = registry ? laneRoot(registry.clonePath) : null;

  // Manifest fallback — only probed when no registry resolves a root and the
  // project is known. Cached per root_path; the effect just wakes the render
  // when a cold probe lands.
  // Distinguish "the projects store is mid-fetch" from "this project does not
  // exist": while a fetch is in flight and a projectId is named but unfound,
  // the row is MISSING-not-absent, so resolution must hold (source stays
  // null) instead of settling on the home library. A store that was never
  // fetched (empty, not loading) settles like before - it cannot wedge.
  const projectRow = projectId ? projects.find((p) => p.id === projectId) : undefined;
  const projectRoot = !registry && projectRow ? projectRow.root_path : null;
  const awaitingProjects = !registry && projectId !== null && !projectRow && projectsLoading;
  const [, bump] = useState(0);
  useEffect(() => {
    if (!projectRoot || manifestSettledRoots.has(projectRoot)) return;
    let alive = true;
    void loadManifestRoot(projectRoot).then(() => { if (alive) bump((n) => n + 1); });
    return () => { alive = false; };
  }, [projectRoot]);

  const manifestSettled = !awaitingProjects && (projectRoot === null || manifestSettledRoots.has(projectRoot));
  const manifestRoot = projectRoot ? (manifestSettledRoots.get(projectRoot) ?? null) : null;

  const { libraryRoot, source } = resolveLibraryRoot({ registryRoot, manifestRoot, manifestSettled });

  return {
    registry,
    workspaceId: workspace?.id ?? null,
    workspaceName: workspace?.name ?? null,
    libraryRoot,
    source,
    ready: source === 'registry' ? registry?.state === 'paired' : source === 'manifest',
  };
}

/**
 * The same resolution without React, for dispatch helpers that run outside a
 * component. Returns null when the project is unassigned or its workspace holds
 * no registry — the caller then keeps the home library, which is the behaviour
 * that predates registries.
 *
 * Deliberately does NOT carry the hook's async manifest fallback: this twin is
 * sync by contract, and answering from the manifest cache would make the result
 * depend on whether some component happened to warm it first — a
 * nondeterminism worse than the narrower answer. Callers that need the
 * manifest lane await `skillFilesRegistryRoot(root_path)` themselves.
 */
export function registryLibraryRootFor(projectId: string): string | null {
  const workspace = workspaceOf(workspacesSnapshot().workspaces, projectId);
  if (!workspace) return null;
  const registry = registryFor(workspace.id);
  if (!registry) return null;
  return laneRoot(registry.clonePath);
}

/**
 * The root the knowledge CORPUS should be read from for a project.
 *
 * This is the P3 flip: once a workspace is wired to a registry, the corpus the
 * Patterns UI shows is the REGISTRY's, not the project's own
 * `docs/concepts/paths/`. Returns null when nothing is wired, and the reader
 * then falls back to the project root — so the flip is per-workspace and opt-in
 * rather than a big-bang switch.
 *
 * The clone ROOT, not a lane: the Rust reader discovers `knowledge/<domain>/`
 * inside it (or `docs/concepts/paths/`, for a repo shaped the old way), and it
 * is the one authority on that layout. Naming the lane here would put the
 * layout in two places.
 */
export function corpusRootFor(projectId: string | null): string | null {
  if (!projectId) return null;
  const workspace = workspaceOf(workspacesSnapshot().workspaces, projectId);
  if (!workspace) return null;
  return registryFor(workspace.id)?.clonePath ?? null;
}

/**
 * Repo-relative usage file a contributor writes into a registry.
 *
 * The slug rule is the registry gate's (`[a-z0-9][a-z0-9-]*`, and the filename
 * stem must equal the `contributor` field). The Rust writer slugifies the same
 * way and names the file from ITS result — this is only for telling the share
 * task which path to commit, so a disagreement shows up as a missing file in the
 * commit rather than a wrong file being written. Returns null when nothing
 * usable survives, which is also what the writer does rather than inventing an
 * id that could collide with another installation's.
 */
export function usageFileFor(contributor: string): string | null {
  const slug = contributor
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `usage/${slug}.json` : null;
}
