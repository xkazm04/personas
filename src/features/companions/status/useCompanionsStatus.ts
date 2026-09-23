/**
 * The one read of the Companions category, shared by the sidebar, the landing
 * page and the three Setup pages.
 *
 * The state itself lives in `companionsStatusStore` (one warm slot, one
 * ref-counted `companions://status-changed` subscription, one in-flight read).
 * This hook is the view over it.
 *
 * ## It used to patch Curator's eligibility here, and no longer does
 *
 * The workspace -> registry link lived in `localStorage`, which Rust cannot
 * read, so the backend reported Curator unblocked and a patch in this hook
 * decided on the client side. Migration e47 promoted the link to a table;
 * `commands::companions::status_snapshot` now reads it, fills
 * `detail.registryName` / `registryPath`, and raises `no_registry` itself. The
 * patch is deleted — this hook renders what the backend says, which is also
 * what Curator's own loop will act on.
 */
import { useMemo } from "react";

import type { CompanionId, CompanionStatusDto } from "../types";
import { COMPANION_IDS } from "../types";
import { readCompanionsStatus, useCompanionsStatusSlot } from "./companionsStatusStore";

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

export function useCompanionsStatus(): CompanionsStatusView {
  const snap = useCompanionsStatusSlot();
  const companions = snap.companions;

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
