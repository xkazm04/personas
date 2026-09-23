// Curator - wrappers over the `curator_*` Tauri commands.
//
// Her own door. The CATEGORY's door (who exists, who may be on) stays in
// `companions.ts`; this module is the instrument and the projection, which are
// hers alone.
//
// `curator_decisions_list` is absent because the command is: nothing writes a
// `curator_decision` yet, so a read would only ever return `[]`. The package
// that raises the first decision adds the wrapper with it.
import type { CuratorPlan } from "@/lib/bindings/CuratorPlan";
import type { CuratorPolicy } from "@/lib/bindings/CuratorPolicy";
import type { CuratorProject } from "@/lib/bindings/CuratorProject";
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

/**
 * The projection as it stands, or `null` when none has been made.
 *
 * `null` is a real answer and not an error: it means nobody has run the
 * instrument against this registry yet, which a surface must say rather than
 * rendering an empty corpus.
 */
export async function curatorPlanCurrent(): Promise<CuratorPlan | null> {
  return invoke<CuratorPlan | null>("curator_plan_current");
}

/** Re-read the instrument and supersede the current projection. */
export async function curatorPlanRefresh(): Promise<CuratorPlan> {
  return invoke<CuratorPlan>("curator_plan_refresh");
}

/** The operator's standing settings, with the unset caps left as `null`. */
export async function curatorPolicyGet(): Promise<CuratorPolicy> {
  return invoke<CuratorPolicy>("curator_policy_get");
}

/** Every checkout Curator may look at, with the operator's switches on it. */
export async function curatorProjectsList(): Promise<CuratorProject[]> {
  return invoke<CuratorProject[]>("curator_projects_list");
}
