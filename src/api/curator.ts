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
import type { CuratorRequest } from "@/lib/bindings/CuratorRequest";
import type { CuratorRuntime } from "@/lib/bindings/CuratorRuntime";
import type { CuratorSkill } from "@/lib/bindings/CuratorSkill";
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

// ---------------------------------------------------------------------------
// The loop: her human lane, the skills she may dispatch, and what she is doing
// ---------------------------------------------------------------------------

/**
 * The operator's own lane, oldest first, in the order they wrote it.
 *
 * She drains this BEFORE her own plan, which is why the surface draws it above
 * the ledger rather than beside it.
 */
export async function curatorRequestsList(): Promise<CuratorRequest[]> {
  return invoke<CuratorRequest[]>("curator_requests_list");
}

/**
 * File one request against a registry skill.
 *
 * `argument` is `null` only for a skill that DOCUMENTS running bare. A skill
 * whose invocation is undocumented (`runsBare === null`) is not bare-runnable -
 * it is unknown, and the composer makes the operator state the argument rather
 * than letting the UI guess one. See `blueprint/console/skillInvocation.ts`.
 */
export async function curatorRequestCreate(input: {
  skill: string;
  argument: string | null;
  note: string | null;
}): Promise<CuratorRequest> {
  return invoke<CuratorRequest>("curator_request_create", input);
}

/** Withdraw a request that has not been picked up. Only `queued` may cancel. */
export async function curatorRequestCancel(id: string): Promise<CuratorRequest> {
  return invoke<CuratorRequest>("curator_request_cancel", { id });
}

/**
 * Every registry skill she can dispatch, discovered by READING the lane on
 * disk. Carries `runsBare`, which is `boolean | null` - and the null arm is
 * load-bearing, not a missing value to default away.
 */
export async function curatorSkillsList(): Promise<CuratorSkill[]> {
  return invoke<CuratorSkill[]>("curator_skills_list");
}

/**
 * What her loop is doing, and every brake on it.
 *
 * `fannedOut` is nullable because a dispatcher skill spawns its own pool: when
 * she cannot see inside a worker the answer is UNKNOWN and must be drawn as
 * such, never as a zero.
 */
export async function curatorRuntimeGet(): Promise<CuratorRuntime> {
  return invoke<CuratorRuntime>("curator_runtime_get");
}
