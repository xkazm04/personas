/**
 * Attention taxonomy for the chat panel's two-level alert structure.
 *
 * Six independent surfaces used to stack unconditionally above the
 * transcript (MCP requests, the pending decision, assignment cards, the
 * autonomous-actions ledger, and one full card per proactive nudge). On a
 * busy day that pushed the actual conversation off screen, which is the
 * opposite of what a chat window is for.
 *
 * Level 1 is a single counts bar (`AttentionBar`); level 2 is the cards
 * themselves, revealed per kind. This module owns the vocabulary shared
 * by both levels — pure data, no store and no React.
 */

/** One row of the counts bar. Order here is the render order. */
export const ATTENTION_KINDS = [
  'blocked',
  'errors',
  'warnings',
  'nudges',
  'assignments',
  'activity',
] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export type AttentionCounts = Record<AttentionKind, number>;

export const EMPTY_ATTENTION_COUNTS: AttentionCounts = {
  blocked: 0,
  errors: 0,
  warnings: 0,
  nudges: 0,
  assignments: 0,
  activity: 0,
};

/**
 * `blocked` is expanded out of the box because something is genuinely
 * waiting on the user — a spawned CLI session is parked until its MCP
 * request is answered, and a pending decision is Athena holding for a
 * call. Everything else starts collapsed (the whole point of the
 * redesign) and whatever the user toggles is remembered from then on.
 */
export const DEFAULT_EXPANDED_KINDS: AttentionKind[] = ['blocked'];

export function isAttentionKind(value: string): value is AttentionKind {
  return (ATTENTION_KINDS as readonly string[]).includes(value);
}

/** Severity of one proactive nudge, derived from its trigger kind. */
export type NudgeSeverity = 'errors' | 'warnings' | 'nudges';

/**
 * Trigger kind → severity bucket. Mirrors the accent colors
 * `ProactiveCard` already paints per kind, so the bar's chip and the
 * card's border agree; a kind nobody mapped falls through to `nudges`
 * (informational) rather than inventing urgency.
 */
const ERROR_TRIGGERS = new Set([
  'backlog_aging',
  'fleet_failed',
  'fleet_stuck_dispatched',
  'incident_blocker',
]);

const WARNING_TRIGGERS = new Set([
  'goal_target_approaching',
  'fleet_awaiting',
  'fleet_stale',
  'execution_review',
]);

export function nudgeSeverity(triggerKind: string): NudgeSeverity {
  if (ERROR_TRIGGERS.has(triggerKind)) return 'errors';
  if (WARNING_TRIGGERS.has(triggerKind)) return 'warnings';
  return 'nudges';
}

/**
 * `message_attention` rows are per-message decision-queue items already
 * aggregated onto the `message_digest` card, so they never render as
 * standalone cards and must not be counted either.
 */
export function isCountableNudge(triggerKind: string): boolean {
  return triggerKind !== 'message_attention';
}

export function totalAttention(counts: AttentionCounts): number {
  return ATTENTION_KINDS.reduce((sum, k) => sum + counts[k], 0);
}
