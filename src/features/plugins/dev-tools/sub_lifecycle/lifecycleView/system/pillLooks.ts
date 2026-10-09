// The tone map behind the module's ONE pill (`Pill.tsx`). Four vocabularies
// draw a pill here - a step's verdict, a command run's outcome, a change's
// outcome for a step, a binding's state - and before this file each drew its
// own (VerdictBadge, RunOutcomeChip border-2, EvidenceRows border-current,
// StepRule's bordered span). Now each is a row of the same table.
//
// Every look is legible WITHOUT colour on two axes: the stroke (solid 2px,
// hairline 1px, dashed, dotted, and only closed strokes are filled) and the
// glyph. That is what keeps a timeout and a run that never started apart from
// a failure: failed is a closed, filled stroke with an octagon; a timeout is
// dotted, unfilled, with a stopped timer; did-not-run is dashed, unfilled,
// with a slashed circle.
import {
  Archive, Ban, CircleCheck, CircleDashed, CircleDot, CircleHelp, CircleSlash, Clock, Eye, Hourglass, Info,
  Lightbulb, OctagonX, PlugZap, SkipForward, TimerOff, TriangleAlert, Unplug, type LucideIcon,
} from 'lucide-react';

import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';
import type { LifecycleRunOutcome } from '@/lib/bindings/LifecycleRunOutcome';

export type PillTone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'quiet';
/** solid = closed 2px and filled; hairline = closed 1px and filled; dashed / dotted = open, unfilled. */
export type PillStroke = 'solid' | 'hairline' | 'dashed' | 'dotted';

export interface PillLook {
  tone: PillTone;
  stroke: PillStroke;
  glyph: LucideIcon;
}

/** Ink, line and wash per tone (status tokens only; `quiet` is the instructed / advisory surface). */
export const PILL_TONE: Record<PillTone, { ink: string; line: string; wash: string }> = {
  success: { ink: 'text-status-success', line: 'border-status-success/60', wash: 'bg-status-success/10' },
  warning: { ink: 'text-status-warning', line: 'border-status-warning/70', wash: 'bg-status-warning/10' },
  error: { ink: 'text-status-error', line: 'border-status-error/70', wash: 'bg-status-error/10' },
  info: { ink: 'text-status-info', line: 'border-status-info/70', wash: 'bg-status-info/10' },
  neutral: { ink: 'text-foreground', line: 'border-foreground/50', wash: 'bg-secondary/40' },
  quiet: { ink: 'text-foreground', line: 'border-primary/25', wash: 'bg-secondary/40' },
};

export const PILL_STROKE: Record<PillStroke, string> = {
  solid: 'border-2 border-solid',
  hairline: 'border border-solid',
  dashed: 'border-2 border-dashed',
  dotted: 'border-2 border-dotted',
};

/** Only a closed stroke is filled: an open pill says "this did not happen". */
export function pillFilled(stroke: PillStroke): boolean {
  return stroke === 'solid' || stroke === 'hairline';
}

export const VERDICT_LOOK: Record<LifecycleHealth, PillLook> = {
  green: { tone: 'success', stroke: 'solid', glyph: CircleCheck },
  amber: { tone: 'warning', stroke: 'solid', glyph: TriangleAlert },
  red: { tone: 'error', stroke: 'solid', glyph: OctagonX },
  unmeasured: { tone: 'neutral', stroke: 'dashed', glyph: CircleDashed },
  instructed: { tone: 'quiet', stroke: 'hairline', glyph: Info },
  stale: { tone: 'info', stroke: 'dotted', glyph: Clock },
};

export const RUN_LOOK: Record<LifecycleRunOutcome, PillLook> = {
  passed: { tone: 'success', stroke: 'solid', glyph: CircleCheck },
  failed: { tone: 'error', stroke: 'solid', glyph: OctagonX },
  timeout: { tone: 'warning', stroke: 'dotted', glyph: TimerOff },
  did_not_run: { tone: 'neutral', stroke: 'dashed', glyph: CircleSlash },
};

export const OUTCOME_LOOK: Record<LifecycleOutcome, PillLook> = {
  done: { tone: 'success', stroke: 'solid', glyph: CircleCheck },
  skipped: { tone: 'neutral', stroke: 'hairline', glyph: SkipForward },
  unknown: { tone: 'neutral', stroke: 'dashed', glyph: CircleHelp },
  failed: { tone: 'error', stroke: 'solid', glyph: OctagonX },
};

/** The binding ladder (journeyStyles): closed = it exists, open = it does not; 2px acts, 1px reads. */
export const BINDING_LOOK: Record<LifecycleBindingState, PillLook> = {
  live: { tone: 'success', stroke: 'solid', glyph: PlugZap },
  detected: { tone: 'info', stroke: 'hairline', glyph: Eye },
  pending: { tone: 'warning', stroke: 'dashed', glyph: Hourglass },
  missing: { tone: 'error', stroke: 'dotted', glyph: Unplug },
  advisory: { tone: 'quiet', stroke: 'hairline', glyph: Lightbulb },
};

/**
 * A backlog item's status (`dev_ideas.status`): open (pending, accepted) is
 * closed-stroked and filled, decided-against is a hairline, done is solid
 * success, timed out is dotted. An unknown status is dashed and says so.
 */
export const ITEM_STATUSES = ['pending', 'accepted', 'delivered', 'rejected', 'archived', 'expired'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_LOOK: Record<ItemStatus | 'unknown', PillLook> = {
  pending: { tone: 'warning', stroke: 'hairline', glyph: Hourglass },
  accepted: { tone: 'info', stroke: 'solid', glyph: CircleDot },
  delivered: { tone: 'success', stroke: 'solid', glyph: CircleCheck },
  rejected: { tone: 'neutral', stroke: 'hairline', glyph: Ban },
  archived: { tone: 'quiet', stroke: 'hairline', glyph: Archive },
  expired: { tone: 'neutral', stroke: 'dotted', glyph: Clock },
  unknown: { tone: 'neutral', stroke: 'dashed', glyph: CircleHelp },
};

export function itemStatusOf(status: string): ItemStatus | 'unknown' {
  return (ITEM_STATUSES as readonly string[]).includes(status) ? (status as ItemStatus) : 'unknown';
}
