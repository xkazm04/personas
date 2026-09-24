/**
 * The module's colour vocabulary, by meaning (doctrine section 4): a release or
 * roadmap item is coloured for what it IS, never for a hue. One chip recipe per
 * tone (`bg-x/10 text-x border-x/30`), one fill per tone for dots and rails.
 *
 * Tones: `highlight` = look here (the theme's own hue); the four statuses say
 * how something went; `neutral` says nothing.
 */
import { Bug, FileText, Sparkles, ShieldCheck, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
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

export const TONE_FILL: Record<ReleaseTone, string> = {
  highlight: 'bg-role-highlight',
  info: 'bg-status-info',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  neutral: 'bg-foreground/30',
};

export const TONE_CHIP: Record<ReleaseTone, string> = {
  highlight: 'border-role-highlight/30 bg-role-highlight/10 text-role-highlight',
  info: 'border-status-info/30 bg-status-info/10 text-status-info',
  success: 'border-status-success/30 bg-status-success/10 text-status-success',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  error: 'border-status-error/30 bg-status-error/10 text-status-error',
  neutral: 'border-primary/10 bg-secondary/40 text-foreground',
};

/** How a roadmap item is going. In progress is the one moving state (info). */
export const ITEM_STATUS_TONE: Record<ReleaseItemStatus, ReleaseTone> = {
  in_progress: 'info',
  completed: 'success',
  planned: 'neutral',
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

/** A release item's kind as a glyph: security and breaking carry a status,
 * the rest are told apart by shape alone. */
export const ITEM_TYPE_GLYPH: Record<ReleaseItemType, { icon: LucideIcon; tone: ReleaseTone }> = {
  feature: { icon: Sparkles, tone: 'highlight' },
  fix: { icon: Bug, tone: 'success' },
  security: { icon: ShieldCheck, tone: 'error' },
  breaking: { icon: TriangleAlert, tone: 'warning' },
  docs: { icon: FileText, tone: 'neutral' },
  chore: { icon: Wrench, tone: 'neutral' },
};
