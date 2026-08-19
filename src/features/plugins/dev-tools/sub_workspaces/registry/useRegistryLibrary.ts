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

import { useSyncExternalStore } from 'react';

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
  /** True once a registry is wired AND its pairing completed. */
  ready: boolean;
}

export function useRegistryLibrary(projectId: string | null): RegistryLibrary {
  const { workspaces } = useWorkspaces();
  useSyncExternalStore(subscribeRegistryLinks, registryLinkSnapshot, registryLinkSnapshot);

  const workspace = projectId ? workspaceOf(workspaces, projectId) : null;
  const registry = workspace ? registryFor(workspace.id) : null;

  // The clone path is joined with the lane name rather than stored as a second
  // field: the lane is part of the registry contract, not a user choice, and a
  // stored copy would be one more thing that can drift from it.
  const libraryRoot = registry ? laneRoot(registry.clonePath) : null;

  return {
    registry,
    workspaceId: workspace?.id ?? null,
    workspaceName: workspace?.name ?? null,
    libraryRoot,
    ready: registry?.state === 'paired',
  };
}

/**
 * The same resolution without React, for dispatch helpers that run outside a
 * component. Returns null when the project is unassigned or its workspace holds
 * no registry — the caller then keeps the home library, which is the behaviour
 * that predates registries.
 */
export function registryLibraryRootFor(projectId: string): string | null {
  const workspace = workspaceOf(workspacesSnapshot().workspaces, projectId);
  if (!workspace) return null;
  const registry = registryFor(workspace.id);
  if (!registry) return null;
  return laneRoot(registry.clonePath);
}
