/**
 * Bridge for credential resource-scoping commands.
 *
 * Scoped resources pin a credential to a subset of user-pickable sub-resources
 * (e.g. a GitHub PAT limited to 2 repos, a Supabase token scoped to one project).
 * See docs/resource-scoping-spec.md for the full model.
 */
import { invokeWithTimeout } from '@/lib/tauriInvoke';

/** A single picker item returned by `list_connector_resources`. */
export interface ResourceItem {
  id: string;
  label: string;
  sublabel?: string;
  meta?: Record<string, unknown>;
}

/** Shape stored on the credential row — a map of resource id → picks. */
export type ScopedResources = Record<string, ResourceItem[]>;

/**
 * Read the JSON `scoped_resources` blob for a credential.
 *
 * Returns `null` when the credential has broad scope (never prompted / skipped
 * with no picks). Returns an object — possibly empty `{}` — when the picker
 * has been opened at least once.
 */
export async function getScopedResources(credentialId: string): Promise<ScopedResources | null> {
  const raw = await invokeWithTimeout<string | null>('get_scoped_resources', { credentialId });
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as ScopedResources;
  } catch {
    return {};
  }
}

/**
 * Replace the `scoped_resources` blob. Pass `null` to reset to broad scope.
 * Empty object `{}` means "picker opened, user skipped".
 */
export async function saveScopedResources(
  credentialId: string,
  scopedResources: ScopedResources | null,
): Promise<void> {
  await invokeWithTimeout<void>('save_scoped_resources', {
    credentialId,
    scopedResources: scopedResources == null ? null : JSON.stringify(scopedResources),
  });
}

/**
 * List picker items for a given resource spec.
 *
 * `dependsOnContext` carries prior picks keyed by resource id. For a resource
 * that declares `depends_on: ["team"]`, pass `{ team: { id: "abc", label: "…" } }`.
 */
export async function listConnectorResources(
  credentialId: string,
  resourceId: string,
  dependsOnContext: Record<string, unknown> = {},
): Promise<ResourceItem[]> {
  return invokeWithTimeout<ResourceItem[]>('list_connector_resources', {
    credentialId,
    resourceId,
    dependsOnContext,
  });
}
