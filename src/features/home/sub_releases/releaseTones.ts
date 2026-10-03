/**
 * The module's colour vocabulary, by meaning (doctrine section 4): a release or
 * roadmap item is coloured for what it IS, never for a hue. One chip recipe and
 * one text class per tone (`bg-x/10 text-x border-x/30`).
 *
 * Tones: `highlight` = look here (the theme's own hue); the four statuses say
 * how something went; `neutral` says nothing. Item status is the exception
 * (Gate 1): it keeps the theme glow on its rail, see ITEM_STATUS_RAIL.
 */
import type { Glyph } from '@/features/shared/components/kit';
import type { ReleaseItemPriority, ReleaseItemStatus, ReleaseItemType, ReleaseStatus } from '@/data/releases';
import type { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';

/** Guard against `useRevealTracker`'s per-id "already entered" tracking so the
 * one-shot entrance cascade never replays on live-refresh or unrelated
 * re-renders (law 4): only a genuinely new item id fades in on its own. */
export type RevealTracker = ReturnType<typeof useRevealTracker>;

export type ReleaseTone = 'highlight' | 'info' | 'success' | 'warning' | 'error' | 'neutral';

export const TONE_TEXT: Record<ReleaseTone, string> = {
  highlight: 'text-role-highlight',
  info: 'text-status-info',
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  neutral: 'text-foreground',
};

export const TONE_CHIP: Record<ReleaseTone, string> = {
  highlight: 'border-role-highlight/30 bg-role-highlight/10 text-role-highlight',
  info: 'border-status-info/30 bg-status-info/10 text-status-info',
  success: 'border-status-success/30 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  error: 'border-status-error/30 bg-status-error/10 text-status-error',
  neutral: 'border-primary/10 bg-secondary/40 text-foreground',
};

/**
 * A roadmap item's status as the card's left rail and the hero's dot (Gate 1):
 * in progress glows in the theme's own primary, done glows in success,
 * planned is a quiet foreground rail. The column and the rail carry status, so
 * no card repeats it as a text label.
 */
// style-deviation: the rail glow is the theme glow the operator asked back at Gate 1; no shadow token draws a coloured glow, so it is color-mix over the theme variable.
export const ITEM_STATUS_RAIL: Record<ReleaseItemStatus, string> = {
  in_progress: 'bg-primary shadow-[0_0_10px_color-mix(in_oklab,var(--primary)_60%,transparent)]',
  completed: 'bg-status-success shadow-[0_0_10px_color-mix(in_oklab,var(--status-success)_60%,transparent)]',
  planned: 'bg-foreground/30',
};

/** The hero's status head: in progress speaks in the theme's primary. */
export const ITEM_STATUS_HEAD: Record<ReleaseItemStatus, string> = {
  in_progress: 'text-primary',
  completed: 'text-status-success',
  planned: 'text-foreground',
};

/** The current horizon is where to look; later horizons say nothing more. */
export const PRIORITY_TONE: Record<ReleaseItemPriority, ReleaseTone> = {
  now: 'highlight',
  next: 'neutral',
  later: 'neutral',
};

/** Released is done (success); the current release is where to look. */
export const RELEASE_STATUS_TONE: Record<ReleaseStatus, ReleaseTone> = {
  released: 'success',
  active: 'highlight',
  planned: 'neutral',
  roadmap: 'neutral',
};

/**
 * A release item's kind as the kit's own bulletpoint - a `Dot`, tone x glyph (owner,
 * 2026-10-03: "For each release row design rather themed bulletpoint instead of spark
 * icon"). The lucide icon per kind (Sparkles, Bug, ShieldCheck, TriangleAlert, FileText,
 * Wrench) is gone: a release is read as a LIST, and 23 different 16px pictograms down its
 * left edge compete with the sentences they are meant to introduce.
 *
 * What carries the six kinds now, and how far it carries them: TONE separates the four
 * that mean something - a feature is the theme's own hue, a fix is success, a security
 * item is error, a breaking change is warning - so the two the owner's brief calls out as
 * having to stay distinguishable are distinguishable by colour alone. `docs` and `chore`
 * both mean "says nothing" and share `neutral` on purpose (doctrine section 4: colour by
 * meaning, and neither is a status); GLYPH is what tells those two apart - a hollow ring
 * for docs against a half-filled dot for chore. That is the weakest of the six
 * distinctions, deliberately, because they are the two lowest-salience kinds; the
 * Tooltip and the dot's accessible name state the kind for every item regardless.
 */
export const ITEM_TYPE_MARK: Record<ReleaseItemType, { tone: ReleaseTone; glyph: Glyph }> = {
  feature: { tone: 'highlight', glyph: 'solid' },
  fix: { tone: 'success', glyph: 'solid' },
  security: { tone: 'error', glyph: 'solid' },
  breaking: { tone: 'warning', glyph: 'solid' },
  docs: { tone: 'neutral', glyph: 'hollow' },
  chore: { tone: 'neutral', glyph: 'soft' },
};
