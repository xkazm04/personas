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
import { planFromGoal } from './rulePlanner';
import type { Plan, PlanSource } from './types';

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
  isAvailable: () => false,
  generate: async () => null,
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
