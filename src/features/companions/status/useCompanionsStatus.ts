/**
 * The one read of the Companions category, shared by the sidebar, the landing
 * page and the three Setup pages.
 *
 * The state itself lives in `companionsStatusStore` (one warm slot, one
 * ref-counted `companions://status-changed` subscription, one in-flight read).
 * What this file adds is the one fact the backend cannot see.
 *
 * ## Why Curator's eligibility is patched on this side
 *
 * The workspace -> registry link lives in the frontend's `localStorage`
 * (`sub_workspaces/registry/registryLinkStore.ts`), which Rust cannot read, so
 * the backend reports Curator as unblocked and this hook decides. The seam
 * closes when that link is promoted to a table - the same move `dev_workspaces`
 * itself made - at which point the backend answers and `withRegistryOverride`
 * is deleted.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  registryLinkSnapshot,
  subscribeRegistryLinks,
  type Registry,
} from "@/features/plugins/dev-tools/sub_workspaces/registry/registryLinkStore";

import type { CompanionId, CompanionStatusDto } from "../types";
import { COMPANION_IDS } from "../types";
import {
  attachCompanionsStatus,
  detachCompanionsStatus,
  readCompanionsStatus,
  useCompanionsStatusSlot,
} from "./companionsStatusStore";

export interface CompanionsStatusView {
  /** One entry per companion, in category order. Null while the first read is in flight. */
  companions: CompanionStatusDto[] | null;
  /** True until the first read settles (loading, never a spinner: the surfaces ghost). */
  loading: boolean;
  /** Set when the read failed; the surfaces then say so rather than inventing a state. */
  error: string | null;
  /** Convenience lookup; null while loading or when the id is unknown. */
  byId: (id: CompanionId) => CompanionStatusDto | null;
  /** Re-read now (after a switch, or when a surface wants to be sure). */
  refresh: () => void;
}

type RegistryLinks = ReturnType<typeof registryLinkSnapshot>;

/** The registry a workspace maps, picked deterministically by registry id. */
function firstMappedRegistry(links: RegistryLinks): Registry | null {
  const mapped = Object.values(links.workspaceRegistry)
    .map((id) => links.registries[id])
    .filter((r): r is Registry => Boolean(r))
    .sort((a, b) => a.id.localeCompare(b.id));
  return mapped[0] ?? null;
}

/** Replace Curator's backend-declared eligibility with what the link store knows. */
function withRegistryOverride(
  companions: CompanionStatusDto[] | null,
  links: RegistryLinks,
): CompanionStatusDto[] | null {
  if (!companions) return null;
  const registry = firstMappedRegistry(links);
  return companions.map((c) => {
    if (c.id !== "curator") return c;
    if (!registry) {
      return { ...c, eligible: false, blocker: "no_registry" as const };
    }
    // `blocker` is absent, not null, when nothing stands in the way.
    const { blocker: _resolved, ...rest } = c;
    return {
      ...rest,
      eligible: true,
      detail: { ...c.detail, registryName: registry.fullName, registryPath: registry.clonePath },
    };
  });
}

export function useCompanionsStatus(): CompanionsStatusView {
  const snap = useCompanionsStatusSlot();
  const links = useSyncExternalStore(
    subscribeRegistryLinks,
    registryLinkSnapshot,
    registryLinkSnapshot,
  );

  useEffect(() => {
    attachCompanionsStatus();
    return detachCompanionsStatus;
  }, []);

  const companions = useMemo(
    () => withRegistryOverride(snap.companions, links),
    [snap.companions, links],
  );

  return useMemo<CompanionsStatusView>(
    () => ({
      companions,
      loading: snap.loading,
      error: snap.error,
      byId: (id) => companions?.find((c) => c.id === id) ?? null,
      refresh: () => {
        void readCompanionsStatus();
      },
    }),
    [companions, snap.loading, snap.error],
  );
}

/** The ids a surface iterates when it has no status yet. */
export const COMPANIONS_IN_ORDER = COMPANION_IDS;
