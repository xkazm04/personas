// DeckChips — the tone→token bridge every Deck surface shares.
//
// `TriageItem` names semantic tones ('success', 'danger', …) and never a
// palette class; this module is the single place that turns one into the
// other. Keeping the map here (rather than inline in three components) is what
// stops the card, the filter chips and the metric badges from drifting into
// three slightly different reds.
import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck,
  BookOpen,
  ClipboardCheck,
  Dna,
  HelpCircle,
  Lightbulb,
  SlidersHorizontal,
} from 'lucide-react';

import type { Translations } from '@/i18n/en';

import type { TriageKind, TriageTone } from '../triageTypes';

/** Full chip surface: border + tint + text, in one string. */
export const TONE_CHIP: Record<TriageTone, string> = {
  neutral: 'border-primary/15 bg-secondary/40 text-foreground',
  accent: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-status-success/30 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  danger: 'border-status-error/30 bg-status-error/10 text-status-error',
};

/** Text-only, for use over a surface that owns its own background. */
export const TONE_TEXT: Record<TriageTone, string> = {
  neutral: 'text-foreground',
  accent: 'text-primary',
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-error',
};

/** Border-only, same reason. */
export const TONE_BORDER: Record<TriageTone, string> = {
  neutral: 'border-primary/20',
  accent: 'border-primary/35',
  success: 'border-status-success/40',
  warning: 'border-status-warning/40',
  danger: 'border-status-error/40',
};

/** Solid fill — meter bars and dots only. */
export const TONE_FILL: Record<TriageTone, string> = {
  neutral: 'bg-foreground',
  accent: 'bg-primary',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-error',
};

/** Hover-gated tint for pressable tone surfaces (no transform, no loop). */
export const TONE_HOVER: Record<TriageTone, string> = {
  neutral: 'hover:bg-secondary/60',
  accent: 'hover:bg-primary/20',
  success: 'hover:bg-status-success/20',
  warning: 'hover:bg-status-warning/20',
  danger: 'hover:bg-status-error/20',
};

/** Everything about a kind that a translation can't carry. */
export const KIND_META: Record<TriageKind, { icon: LucideIcon; tone: TriageTone }> = {
  review: { icon: ClipboardCheck, tone: 'danger' },
  idea: { icon: Lightbulb, tone: 'accent' },
  practice: { icon: BookOpen, tone: 'success' },
  question: { icon: HelpCircle, tone: 'warning' },
  policy: { icon: SlidersHorizontal, tone: 'accent' },
  evolution: { icon: Dna, tone: 'warning' },
  // `BadgeCheck` is the glyph the retiring tray item and the acceptance overlay
  // header both used, so the kind keeps the identity it already had. `success`
  // because a goal reaching this queue means work COMPLETED — good news awaiting
  // confirmation, not an alarm. It is the only tone in this map that is not
  // reporting a problem.
  goal: { icon: BadgeCheck, tone: 'success' },
};

/**
 * The translated half of the same map: plural (filter chips), singular (the
 * card's kind chip) and the "none of this kind is waiting" tooltip.
 *
 * A `switch` rather than a key lookup on purpose — it is what makes the
 * generated `Translations` type check every kind at compile time, so adding a
 * fifth `TriageKind` fails the build instead of rendering `undefined`.
 */
export function kindCopy(
  t: Translations,
  kind: TriageKind,
): { label: string; one: string; empty: string } {
  const m = t.monitor;
  switch (kind) {
    case 'review':
      return { label: m.triage_kind_reviews, one: m.triage_kind_review, empty: m.triage_none_reviews };
    case 'idea':
      return { label: m.triage_kind_ideas, one: m.triage_kind_idea, empty: m.triage_none_ideas };
    case 'practice':
      return { label: m.triage_kind_practices, one: m.triage_kind_practice, empty: m.triage_none_practices };
    case 'question':
      return { label: m.triage_kind_questions, one: m.triage_kind_question, empty: m.triage_none_questions };
    case 'policy':
      return { label: m.triage_kind_policies, one: m.triage_kind_policy, empty: m.triage_none_policies };
    case 'evolution':
      return {
        label: m.triage_kind_promotions,
        one: m.triage_kind_promotion,
        empty: m.triage_none_promotions,
      };
    case 'goal':
      return { label: m.triage_kind_goals, one: m.triage_kind_goal, empty: m.triage_none_goals };
  }
}

/**
 * Band a 0..max score onto a tone.
 *
 * `invert` is the whole point: effort and risk are scales where LOW is the
 * good news, so a raw ratio would paint "effort 2/10" the same alarming red as
 * "impact 2/10". Flipping first means one banding rule colours every fact
 * honestly without the view learning which fact is which.
 */
export function bandTone(value: number, max: number, invert?: boolean): TriageTone {
  const span = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / span));
  const good = invert ? 1 - ratio : ratio;
  if (good >= 0.66) return 'success';
  if (good >= 0.33) return 'warning';
  return 'danger';
}

/** A tag / kind pill. */
export function Chip({ label, tone, icon: Icon }: { label: string; tone: TriageTone; icon?: LucideIcon }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-0.5 typo-caption font-medium capitalize ${TONE_CHIP[tone]}`}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
      {label}
    </span>
  );
}

/** A keycap, for the hint line and branch digits. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded-interactive border border-primary/20 bg-secondary/50 px-1.5 py-0.5 typo-code text-foreground">
      {children}
    </kbd>
  );
}
