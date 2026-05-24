/**
 * Goal-to-Plan — pluggable plan providers (Stage 2 seam).
 *
 * A `PlanProvider` turns a goal string into a `Plan`. The panel talks only
 * to `generatePlan()`, so the planning *brain* can be swapped without
 * touching the UI. Stage 1 ships the deterministic rule provider; the LLM
 * provider is stubbed behind `isAvailable()` and becomes live the moment a
 * `plan_goal_llm` backend command exists (see the stub below) — at which
 * point existing goals get AI-quality plans with the rule planner as an
 * automatic fallback.
 */
import { silentCatch } from '@/lib/silentCatch';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { planFromGoal } from './rulePlanner';
import { ACTION_CATALOG } from './actionCatalog';
import type { Plan, PlanSource, PlanActionId, PlanStep } from './types';

/** Wire shape of the `plan_goal_llm` command result. Mirrors the ts-rs
 *  binding `LlmPlanResult` (src/lib/bindings/) — kept local so the planner
 *  compiles independently of binding-generation timing. */
interface LlmPlanStepWire {
  actionId: string;
  params?: Record<string, string>;
  confidence: number;
}
interface LlmPlanResultWire {
  steps: LlmPlanStepWire[];
}

/** Map a validated wire result onto the Plan shape, dropping any unknown
 *  action ids the catalog doesn't recognise. */
function wireToPlan(goal: string, wire: LlmPlanResultWire): Plan | null {
  const steps: PlanStep[] = wire.steps
    .filter((s): s is LlmPlanStepWire => (s.actionId as PlanActionId) in ACTION_CATALOG)
    .map((s, i) => ({
      id: `llm-${Date.now().toString(36)}-${i}`,
      actionId: s.actionId as PlanActionId,
      params: s.params ?? {},
      confidence: Math.max(0, Math.min(1, s.confidence ?? 0.7)),
    }));
  if (steps.length === 0) return null;
  return { id: `plan-${Date.now().toString(36)}`, goal, steps, source: 'llm', createdAt: Date.now() };
}

export interface PlanProvider {
  readonly source: PlanSource;
  /** Whether this provider can run right now. May probe async (e.g. check a
   *  backend capability flag). */
  isAvailable(): boolean | Promise<boolean>;
  /** Produce a plan, or `null` for an empty/unplannable goal. */
  generate(goal: string): Promise<Plan | null>;
}

/** Deterministic, always-available, instant. The baseline. */
export const rulePlanProvider: PlanProvider = {
  source: 'rule',
  isAvailable: () => true,
  generate: async (goal) => planFromGoal(goal),
};

/**
 * LLM-backed provider — the Stage-3 seam. When wired, `generate()` will call
 * a `plan_goal_llm(goal)` Tauri command that prompts Sonnet with the action
 * catalog (`ACTION_CATALOG`) as its allowed vocabulary and parses the
 * returned plan JSON into the same `Plan` shape. Until that command lands,
 * `isAvailable()` is `false`, so `resolvePlanProvider()` falls through to the
 * rule planner and the surface keeps working unchanged.
 */
export const llmPlanProvider: PlanProvider = {
  source: 'llm',
  // Try the LLM brain first; `generatePlan` falls back to the rule planner if
  // the command errors (e.g. the Claude CLI isn't authed in this build).
  isAvailable: () => true,
  generate: async (goal) => {
    const clean = goal.trim();
    if (!clean) return null;
    const wire = await invokeWithTimeout<LlmPlanResultWire>('plan_goal_llm', { goal: clean }, { timeoutMs: 60_000 });
    return wireToPlan(clean, wire);
  },
};

/** Preference order: richest brain first, deterministic fallback last. */
const PROVIDERS: readonly PlanProvider[] = [llmPlanProvider, rulePlanProvider];

/** Pick the best provider that reports itself available. */
export async function resolvePlanProvider(): Promise<PlanProvider> {
  for (const p of PROVIDERS) {
    try {
      if (await p.isAvailable()) return p;
    } catch (e) {
      silentCatch('planner/resolvePlanProvider')(e);
    }
  }
  return rulePlanProvider;
}

/**
 * Generate a plan via the best available provider, falling back to the rule
 * planner if the chosen provider throws or yields nothing. This is the only
 * entry point the UI uses.
 */
export async function generatePlan(goal: string): Promise<Plan | null> {
  const provider = await resolvePlanProvider();
  try {
    const plan = await provider.generate(goal);
    if (plan) return plan;
  } catch (e) {
    silentCatch('planner/generatePlan')(e);
  }
  // Fallback — never leave the user without a plan when they asked for one.
  return rulePlanProvider.generate(goal);
}
