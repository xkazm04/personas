// Curator - wrappers over the `curator_*` Tauri commands.
//
// Her own door. The CATEGORY's door (who exists, who may be on) stays in
// `companions.ts`; this module is the instrument and the projection, which are
// hers alone.
//
// `curator_decisions_list` is absent because the command is: nothing writes a
// `curator_decision` yet, so a read would only ever return `[]`. The package
// that raises the first decision adds the wrapper with it.
import { EventName } from "@/lib/eventRegistry";

import type { CuratorAttrition } from "@/lib/bindings/CuratorAttrition";
import type { CuratorGrowthReading } from "@/lib/bindings/CuratorGrowthReading";
import type { CuratorImpediment } from "@/lib/bindings/CuratorImpediment";
import type { CuratorPlan } from "@/lib/bindings/CuratorPlan";
import type { CuratorPolicy } from "@/lib/bindings/CuratorPolicy";
import type { CuratorRefresh } from "@/lib/bindings/CuratorRefresh";
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

/**
 * Re-read the instrument and supersede the current projection.
 *
 * Answers with more than the plan, because the plan alone cannot tell the
 * operator what happened: an identical projection returned from the five-minute
 * cache looks exactly like a control that did nothing. `fromCache` and
 * `changed` are measurements only the backend can take - a stopwatch around
 * this call is a guess at the cache, and comparing against whatever the page
 * holds is not comparing against the run that was superseded.
 */
export async function curatorPlanRefresh(): Promise<CuratorRefresh> {
  return invoke<CuratorRefresh>("curator_plan_refresh");
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
 * it is unknown, and whatever composes a request must make the operator state
 * the argument rather than letting the UI guess a command the skill's own file
 * never promised. The Blueprint's composer, which held that rule, moved out to
 * the app-wide console; the rule travels with it and lives here in the
 * meantime.
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

/**
 * What blocks her plan, counted and ranked worst first.
 *
 * `blocks` is what an impediment HOLDS; `frees` is what closing it would
 * release, and they are different numbers whenever two things are missing at
 * once - a surface that drew only the first would rank the biggest number on the
 * board ahead of the one that actually unblocks her.
 *
 * `[]` is a real and good answer: her plan has no undispatchable engine in it.
 * A missing plan errors instead, so the two cannot be confused.
 */
export async function curatorImpedimentsGet(): Promise<CuratorImpediment[]> {
  return invoke<CuratorImpediment[]>("curator_impediments_get");
}

/**
 * Is the ecosystem of projects growing, over her newest samples.
 *
 * Every metric is nullable because unknown is not zero, and `verdict: "unknown"`
 * with `samples: 1` is the honest answer on a fresh install - which is NOT the
 * same answer as `flat`. `flatStreak` is the figure the owner actually asks for:
 * how many consecutive passes moved nothing at all.
 */
export async function curatorGrowthGet(): Promise<CuratorGrowthReading> {
  return invoke<CuratorGrowthReading>("curator_growth_get");
}

/**
 * Her runs that stopped reporting, and what that cost.
 *
 * The fleet marks a session `stale` after `staleAfterSecs` of no log growth, a
 * rule written for an interactive session that a person walked away from. Her
 * workers are headless and a research pass thinks for longer than that, so a
 * quiet run here is a claim about the tracker at least as often as about the
 * worker - which is exactly why the reason travels verbatim instead of being
 * summarised into a status.
 */
export async function curatorAttritionGet(): Promise<CuratorAttrition> {
  return invoke<CuratorAttrition>("curator_attrition_get");
}

/**
 * The event her loop fires whenever its observable state moves.
 *
 * The literal comes FROM the registry rather than being repeated here: the name
 * crosses the Rust -> JS boundary, and two copies of a string is one typo away
 * from a surface that listens to nothing and says nothing about it.
 */
export const CURATOR_PULSE_EVENT = EventName.CURATOR_PULSE;
