/**
 * The one read of the Companions category, shared by the sidebar, the landing
 * page and the three Setup pages.
 *
 * WP0 CONTRACT STUB: the signature is frozen here so the nav package can be
 * built against it. WP3 implements the body: the `companions_status` call, the
 * `companions://status-changed` subscription, a module-scoped warm cache so a
 * remount paints warm, and Curator's eligibility, which in this stage is known
 * only to the frontend registry-link store (a later stage moves that link into
 * the database and the override disappears).
 */
import { useMemo } from "react";

import type { CompanionId, CompanionStatusDto } from "../types";
import { COMPANION_IDS } from "../types";

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
  // WP3 replaces this body. The shape must not change.
  return useMemo<CompanionsStatusView>(
    () => ({
      companions: null,
      loading: true,
      error: null,
      byId: () => null,
      refresh: () => {},
    }),
    [],
  );
}

/** The ids a surface iterates when it has no status yet. */
export const COMPANIONS_IN_ORDER = COMPANION_IDS;
