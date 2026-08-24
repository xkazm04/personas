// Ship layer API (Factory L2 → Ship tab) — wrappers over the
// dev_tools_*_milestone* Tauri commands. A milestone is a convergence cut:
// use cases join with a bucket (core/later/never), goals bind as objectives,
// and contexts/progress/exit-criteria all DERIVE client-side from members +
// existing signals — the backend stores decisions, never percentages.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevMilestone } from "@/lib/bindings/DevMilestone";
import type { DevMilestoneItem } from "@/lib/bindings/DevMilestoneItem";
import type { DevProjectWallSummary } from "@/lib/bindings/DevProjectWallSummary";

export type MilestoneStatus = "planned" | "active" | "shipped";
export type MilestoneBucket = "core" | "later" | "never";
export type MilestoneItemKind = "use_case" | "goal";

export async function listMilestones(projectId: string): Promise<DevMilestone[]> {
  return invoke<DevMilestone[]>("dev_tools_list_milestones", { projectId });
}

export async function createMilestone(input: {
  projectId: string;
  name: string;
  /** The objective as a SHORT TITLE — a handful of words. Prose belongs in
   *  `description`; the backend enforces the split with a length bound. */
  goal?: string;
  /** What shipping this milestone means, in prose. Optional. */
  description?: string;
  status?: MilestoneStatus;
  targetDate?: string;
}): Promise<DevMilestone> {
  return invoke<DevMilestone>("dev_tools_create_milestone", { ...input });
}

/** Patch-style update. Setting status to 'active' stamps cut_at (once — the
 *  scope-creep baseline); 'shipped' stamps shipped_at. */
export async function updateMilestone(
  id: string,
  patch: {
    name?: string;
    /** Short title only — see `createMilestone`. */
    goal?: string;
    /** Nullable patch: omit to leave the stored prose alone, `''` to clear it.
     *  Editing the title must never silently wipe the description under it. */
    description?: string;
    status?: MilestoneStatus;
    targetDate?: string;
    orderIndex?: number;
  },
): Promise<DevMilestone> {
  return invoke<DevMilestone>("dev_tools_update_milestone", { id, ...patch });
}

export async function deleteMilestone(id: string): Promise<void> {
  return invoke<void>("dev_tools_delete_milestone", { id });
}

export async function listMilestoneItems(milestoneId: string): Promise<DevMilestoneItem[]> {
  return invoke<DevMilestoneItem[]>("dev_tools_list_milestone_items", { milestoneId });
}

/** Upsert a scope member (add or re-bucket). `added_after_cut` derives on the
 *  backend: a new membership on an already-cut milestone is scope creep.
 *
 *  `annotations` is a PATCH, matching the backend's nullable-patch shape: omit
 *  a key to leave that column alone, pass `null` to clear it. A `rating` is
 *  1..5; `null` means UNRATED, which is not the same judgement as a 1. */
export async function setMilestoneItem(
  milestoneId: string,
  itemKind: MilestoneItemKind,
  itemId: string,
  bucket: MilestoneBucket,
  annotations?: { description?: string | null; rating?: number | null },
): Promise<DevMilestoneItem> {
  return invoke<DevMilestoneItem>("dev_tools_set_milestone_item", {
    milestoneId,
    itemKind,
    itemId,
    bucket,
    // Spread only the keys actually supplied — an absent key must reach the
    // backend as absent, not as an explicit null (which clears the column).
    ...(annotations && "description" in annotations
      ? { description: annotations.description ?? null }
      : {}),
    ...(annotations && "rating" in annotations ? { rating: annotations.rating ?? null } : {}),
  });
}

export type { ShipMilestoneIngestSummary } from "@/lib/bindings/ShipMilestoneIngestSummary";
export type { ShipMilestoneProposedAddition } from "@/lib/bindings/ShipMilestoneProposedAddition";
import type { ShipMilestoneIngestSummary } from "@/lib/bindings/ShipMilestoneIngestSummary";

/**
 * The ONE gated door a `/ship-milestone` skill run comes back through.
 *
 * Reads `<repo>/.personas/ship-milestone/runs/<id>/result.json` (newest
 * un-ingested run when `runDir` is omitted) and applies its per-member
 * suggestions through the ordinary `set_milestone_item` upsert, replaying each
 * member's existing bucket. Path-confined, size-capped, version-checked and
 * idempotent; it validates the whole file before writing anything, so a
 * malformed run is refused rather than partly applied.
 *
 * Proposed additions come back in the summary and are NEVER applied — widening
 * a cut is an operator decision made here in the Ship tab.
 */
export async function shipMilestoneIngest(
  milestoneId: string,
  runDir?: string,
): Promise<ShipMilestoneIngestSummary> {
  return invoke<ShipMilestoneIngestSummary>(
    "dev_tools_ship_milestone_ingest",
    { milestoneId, runDir: runDir ?? null },
    { timeoutMs: 60_000 },
  );
}

export async function removeMilestoneItem(
  milestoneId: string,
  itemKind: MilestoneItemKind,
  itemId: string,
): Promise<void> {
  return invoke<void>("dev_tools_remove_milestone_item", { milestoneId, itemKind, itemId });
}

/**
 * ONE call for the whole L1 passport wall — contexts count, active KPI rows and
 * full milestone rows per project. Replaces the three per-project fan-outs
 * (`listContexts` + `listKpis` + `listMilestones`) the wall used to fire, so
 * drawing N covers costs 1 IPC round trip instead of 3N.
 *
 * Returns one entry per requested id, in request order; unknown ids come back
 * zeroed rather than erroring, so one deregistered project can't blank the wall.
 */
export async function projectWallSummary(
  projectIds: string[],
): Promise<DevProjectWallSummary[]> {
  return invoke<DevProjectWallSummary[]>("dev_tools_project_wall_summary", { projectIds });
}
