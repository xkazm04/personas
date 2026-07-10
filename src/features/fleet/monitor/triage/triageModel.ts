// triageModel — pure helpers for the compact "actionable-only" Persona Monitor
// variants (Action grid + Project columns). No JSX; the variants own markup.

import { AlertOctagon, Mail, MessageSquareDot, FileText, type LucideIcon } from 'lucide-react';
import { SEVERITY_META, type PersonaCardModel } from '../monitorModel';

/** Prototype copy. Promote to `t.monitor.*` at consolidation. */
export const COPY = {
  actionEmpty: 'Nothing needs you right now',
  needsAttention: 'Needs attention',
  activeGoals: 'Active goals',
  noTeam: 'No team',
  allClear: 'All clear',
} as const;

/**
 * A card is "actionable" when it needs the human: a pending review, an unread
 * message, an input gate, a ready draft, or a failed last run. Running or
 * queued alone is "busy" — not something the user must act on — so those cards
 * are hidden in the compact views (goal 1).
 */
export function isActionable(card: PersonaCardModel): boolean {
  return (
    card.execState === 'failed' ||
    card.attentionCount > 0 ||
    card.inputRequired > 0 ||
    card.draftReady > 0
  );
}

/** One actionable signal on a card, with its compact-pill styling. */
export interface ActionBadge {
  key: 'failed' | 'review' | 'message' | 'input' | 'draft';
  /** 0 means "show the icon only" (failed has no count). */
  count: number;
  icon: LucideIcon;
  /** pill class (bg + text + border). */
  tone: string;
}

const TONE = {
  failed: 'bg-red-500/15 text-red-300 border-red-500/30',
  message: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  input: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  draft: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
} as const;

/** The actionable badges for a card, highest-priority first. */
export function actionBadges(card: PersonaCardModel): ActionBadge[] {
  const out: ActionBadge[] = [];
  if (card.execState === 'failed') out.push({ key: 'failed', count: 0, icon: AlertOctagon, tone: TONE.failed });
  if (card.reviews.length > 0 && card.topReviewSeverity) {
    const sev = SEVERITY_META[card.topReviewSeverity];
    out.push({ key: 'review', count: card.reviews.length, icon: sev.icon as LucideIcon, tone: sev.badge });
  }
  if (card.inputRequired > 0) out.push({ key: 'input', count: card.inputRequired, icon: MessageSquareDot, tone: TONE.input });
  if (card.draftReady > 0) out.push({ key: 'draft', count: card.draftReady, icon: FileText, tone: TONE.draft });
  if (card.messages.length > 0) out.push({ key: 'message', count: card.messages.length, icon: Mail, tone: TONE.message });
  return out;
}

/** Total count of actionable items on a card (for column/header rollups). */
export function actionWeight(card: PersonaCardModel): number {
  return (
    (card.execState === 'failed' ? 1 : 0) +
    card.reviews.length + card.messages.length + card.inputRequired + card.draftReady
  );
}

/**
 * Shape of an active goal shown in a Project column. Real DevGoals (keyed by dev
 * project) are wired here once the team↔project map exists; until then columns
 * carry an empty list rather than fabricated placeholder goals, which were being
 * shown to users as real project state.
 */
export interface MockGoal { title: string; progress: number }
