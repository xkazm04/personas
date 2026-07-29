/**
 * cockpitKinds — the small shared vocabulary the three Cockpit panes agree on.
 *
 * Three things live here because all three panes need them and none of them
 * owns them: how a {@link TriageKind} looks, how a {@link TriageTone} maps onto
 * the app's status tokens, and how the cross-domain `weight` scale reads as an
 * urgency signal a reviewer can scan down a rail without reading a number.
 *
 * ⚠️ PROTOTYPE (/prototype round 1). English string literals are inline on
 * purpose: another session holds uncommitted work in `src/i18n/**`, so this
 * variant must not touch the locale files. If Cockpit wins, every literal in
 * `triage/cockpit/*` moves to `t.*` at consolidation.
 */
import {
  BookOpen,
  HelpCircle,
  Lightbulb,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

import type { TriageKind, TriageTone } from '../triageTypes';

export interface KindMeta {
  icon: LucideIcon;
  /** Singular, for a row glyph's accessible name. */
  label: string;
  /** Section header in the queue rail. */
  plural: string;
}

/** Rail grouping order — most-urgent-source-first, so the rail reads top-down. */
export const KIND_ORDER: readonly TriageKind[] = ['review', 'question', 'idea', 'practice'];

export const KIND_META: Record<TriageKind, KindMeta> = {
  review: { icon: ShieldAlert, label: 'Review', plural: 'Human reviews' },
  question: { icon: HelpCircle, label: 'Question', plural: 'Build questions' },
  idea: { icon: Lightbulb, label: 'Idea', plural: 'Backlog ideas' },
  practice: { icon: BookOpen, label: 'Practice', plural: 'Workspace practices' },
};

/** Tone → foreground token. Never a raw palette class. */
export const TONE_TEXT: Record<TriageTone, string> = {
  neutral: 'text-foreground',
  accent: 'text-primary',
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-error',
};

/** Tone → solid fill, for meters and signal bars. */
export const TONE_FILL: Record<TriageTone, string> = {
  neutral: 'bg-foreground/45',
  accent: 'bg-primary',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-error',
};

/** Tone → chip surface (border + fill + text) for tags and filters. */
export const TONE_CHIP: Record<TriageTone, string> = {
  neutral: 'border-primary/15 bg-secondary/45 text-foreground',
  accent: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-status-success/30 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  danger: 'border-status-error/30 bg-status-error/10 text-status-error',
};

/** Tone → pressable action surface, with the hover state a button needs. */
export const TONE_ACTION: Record<TriageTone, string> = {
  neutral: 'border-primary/20 bg-secondary/45 text-foreground hover:bg-secondary/70 hover:border-primary/30',
  accent: 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
  success:
    'border-status-success/35 bg-status-success/12 text-status-success hover:bg-status-success/22',
  warning:
    'border-status-warning/35 bg-status-warning/12 text-status-warning hover:bg-status-warning/22',
  danger: 'border-status-error/35 bg-status-error/12 text-status-error hover:bg-status-error/22',
};

/* -------------------------------------------------------------------------- */
/* Urgency                                                                     */
/* -------------------------------------------------------------------------- */

export type WeightTier = 'routine' | 'elevated' | 'urgent';

const TIER_TONE: Record<WeightTier, TriageTone> = {
  routine: 'neutral',
  elevated: 'warning',
  urgent: 'danger',
};

const TIER_LABEL: Record<WeightTier, string> = {
  routine: 'Routine priority',
  elevated: 'Elevated priority',
  urgent: 'Urgent priority',
};

const TIER_BARS: Record<WeightTier, number> = { routine: 1, elevated: 2, urgent: 3 };

/**
 * Three bands over the adapters' cross-domain weight scale (≈12…140).
 *
 * The cut points are the adapters' own: 90 is a blocked build session and a
 * high-severity review, 55 is a medium-severity review and a strong idea. A
 * reviewer never sees the number — only which of three bands it fell in.
 */
export function weightTier(weight: number): WeightTier {
  if (weight >= 90) return 'urgent';
  if (weight >= 55) return 'elevated';
  return 'routine';
}

/**
 * A three-bar signal-strength glyph. Static by design — an urgency indicator
 * that pulses turns a rail of twelve items into twelve competing alarms.
 */
export function WeightSignal({ weight, className = '' }: { weight: number; className?: string }) {
  const tier = weightTier(weight);
  const filled = TIER_BARS[tier];
  const fill = TONE_FILL[TIER_TONE[tier]];
  return (
    <span
      className={`inline-flex items-end gap-[2px] ${className}`}
      role="img"
      aria-label={TIER_LABEL[tier]}
      title={TIER_LABEL[tier]}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-pill ${i < filled ? fill : 'bg-primary/15'}`}
          style={{ height: 4 + i * 3 }}
        />
      ))}
    </span>
  );
}
