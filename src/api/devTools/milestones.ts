// Ship layer API (Factory L2 → Ship tab) — wrappers over the
// dev_tools_*_milestone* Tauri commands. A milestone is a convergence cut:
// use cases join with a bucket (core/later/never), goals bind as objectives,
// and contexts/progress/exit-criteria all DERIVE client-side from members +
// existing signals — the backend stores decisions, never percentages.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevMilestone } from "@/lib/bindings/DevMilestone";
import type { DevMilestoneItem } from "@/lib/bindings/DevMilestoneItem";

export type MilestoneStatus = "planned" | "active" | "shipped";
export type MilestoneBucket = "core" | "later" | "never";
export type MilestoneItemKind = "use_case" | "goal";

export async function listMilestones(projectId: string): Promise<DevMilestone[]> {
  return invoke<DevMilestone[]>("dev_tools_list_milestones", { projectId });
}

export async function createMilestone(input: {
  projectId: string;
  name: string;
  goal?: string;
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
    goal?: string;
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
 *  backend: a new membership on an already-cut milestone is scope creep. */
export async function setMilestoneItem(
  milestoneId: string,
  itemKind: MilestoneItemKind,
  itemId: string,
  bucket: MilestoneBucket,
): Promise<DevMilestoneItem> {
  return invoke<DevMilestoneItem>("dev_tools_set_milestone_item", {
    milestoneId,
    itemKind,
    itemId,
    bucket,
  });
}

export async function removeMilestoneItem(
  milestoneId: string,
  itemKind: MilestoneItemKind,
  itemId: string,
): Promise<void> {
  return invoke<void>("dev_tools_remove_milestone_item", { milestoneId, itemKind, itemId });
}
