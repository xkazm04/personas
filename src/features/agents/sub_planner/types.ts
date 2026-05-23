/**
 * Goal-to-Plan — shared types.
 *
 * The planner maps a natural-language goal onto an ordered sequence of
 * in-app actions drawn from the automation tool catalog (the same catalog
 * the test-automation bridge drives). Stage 1 is **read-only**: a Plan is a
 * reviewable preview of what the app *would* do — nothing here executes.
 *
 * Each PlanStep references a `PlanAction` (the verb) and carries i18n
 * template keys + params so the card layer can render translated, finished
 * sentences without the planner ever building an English string.
 */

/** The user-meaningful verbs a plan can be built from. Each maps to one or
 *  more underlying automation-bridge primitives (see `actionCatalog`). */
export type PlanActionId =
  | 'understand_goal'
  | 'create_persona'
  | 'connect_service'
  | 'configure_trigger'
  | 'configure_schedule'
  | 'fetch_web'
  | 'detect_changes'
  | 'send_notification'
  | 'review_confirm';

/** Grouping used for the step icon color + the category chip. */
export type PlanActionCategory =
  | 'persona'
  | 'connector'
  | 'trigger'
  | 'schedule'
  | 'navigation'
  | 'action'
  | 'review';

/** Static catalog entry — the vocabulary the planner draws from. */
export interface PlanAction {
  id: PlanActionId;
  category: PlanActionCategory;
  /** lucide-react icon name resolved by the card. */
  icon: string;
  /** The automation-bridge method(s) this action would drive at execution
   *  time. Metadata only in Stage 1 — surfaced for traceability, never
   *  invoked. `null` for purely-narrative steps (understand / review). */
  bridgeRef: string | null;
}

/** Coarse confidence buckets for the chip. Kept separate from the raw 0..1
 *  score so the label thresholds live in one place. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** One reviewable step in a plan. */
export interface PlanStep {
  id: string;
  actionId: PlanActionId;
  /** Interpolation params for the action's title/detail templates. Values
   *  are user content (the goal) or brand names (Gmail, Slack) — both pass
   *  through untranslated by design. */
  params?: Record<string, string>;
  /** 0..1 — how sure the planner is this step belongs. Drives the chip and
   *  the ordering tie-breaker. */
  confidence: number;
}

/** Where the plan came from. Stage 1 ships `'rule'`; the LLM brain adds
 *  `'llm'`. */
export type PlanSource = 'rule' | 'llm';

/** A full preview plan for one goal. */
export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  source: PlanSource;
  createdAt: number;
}

/** Map a raw 0..1 score to a coarse bucket. */
export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.8) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}
