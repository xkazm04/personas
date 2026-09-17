import { PencilLine, Send, Loader, CircleCheck, Archive, CircleHelp, Crosshair, Scissors, PackageCheck, type LucideIcon } from 'lucide-react';

import { BADGE_VARIANTS, type BadgeVariant } from '@/features/shared/components/display/Badge';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';
import type { Translations } from '@/i18n/generated/types';

/**
 * ONE presentation table for `NoteStatus`.
 *
 * Every surface that shows a status — the tab glyph, the dispatch-bar badge,
 * the lifecycle timeline, the desk card's icon-only badge — reads it from here,
 * so a status can never look like two different things in two places. Every
 * icon is DISTINCT: the desk card shows the glyph alone, so two statuses sharing
 * one would be indistinguishable. `labelKey` is resolved against the live
 * translations rather than stored as text: a table of English strings is a
 * table that ships English to every locale.
 */
/** A status as COLOUR, for surfaces that carry it on geometry (a card outline,
 *  a rail, a lifecycle tick) rather than in a badge. Literal class strings so
 *  Tailwind can see them; every one resolves to a `primary` / `status-*` token. */
export interface NoteStatusTone {
  /** Outline at rest. */
  border: string;
  /** Solid fill — rails, dots, ticks. */
  fill: string;
  text: string;
  /** Faint ground wash. */
  wash: string;
}

export interface NoteStatusMeta {
  status: NoteStatus;
  /** Resolver against the translation tree — never a literal string. */
  labelKey: (t: Translations) => string;
  badgeVariant: BadgeVariant;
  Icon: LucideIcon;
  tone: NoteStatusTone;
}

export const NOTE_STATUS_META: Record<NoteStatus, NoteStatusMeta> = {
  draft: {
    status: 'draft',
    labelKey: (t) => t.notepad.status_draft,
    badgeVariant: 'neutral',
    Icon: PencilLine,
    // The theme accent, not grey: a draft is the one state you can still write
    // into, and it should look alive rather than inert.
    tone: { border: 'border-primary/35', fill: 'bg-primary', text: 'text-primary', wash: 'bg-primary/5' },
  },
  published: {
    status: 'published',
    labelKey: (t) => t.notepad.status_published,
    badgeVariant: 'blue',
    Icon: Send,
    tone: { border: 'border-status-info/40', fill: 'bg-status-info', text: 'text-status-info', wash: 'bg-status-info/5' },
  },
  in_progress: {
    status: 'in_progress',
    labelKey: (t) => t.notepad.status_in_progress,
    badgeVariant: 'cyan',
    Icon: Loader,
    tone: { border: 'border-status-pending/40', fill: 'bg-status-pending', text: 'text-status-pending', wash: 'bg-status-pending/5' },
  },
  completed: {
    status: 'completed',
    labelKey: (t) => t.notepad.status_completed,
    badgeVariant: 'emerald',
    Icon: CircleCheck,
    tone: { border: 'border-status-success/40', fill: 'bg-status-success', text: 'text-status-success', wash: 'bg-status-success/5' },
  },
  archived: {
    status: 'archived',
    labelKey: (t) => t.notepad.status_archived,
    badgeVariant: 'neutral',
    Icon: Archive,
    tone: { border: 'border-status-neutral/30', fill: 'bg-status-neutral', text: 'text-status-neutral', wash: 'bg-status-neutral/5' },
  },
  // The plan rail: a note that is the living brief of a milestone. Scoped
  // keeps the draft accent (still writable), cut rings warning (scope is
  // frozen — anything added now is creep), shipped is the success close.
  scoped: {
    status: 'scoped',
    labelKey: (t) => t.notepad.status_scoped,
    badgeVariant: 'blue',
    Icon: Crosshair,
    tone: { border: 'border-primary/35', fill: 'bg-primary', text: 'text-primary', wash: 'bg-primary/5' },
  },
  cut: {
    status: 'cut',
    labelKey: (t) => t.notepad.status_cut,
    badgeVariant: 'amber',
    Icon: Scissors,
    tone: { border: 'border-status-warning/40', fill: 'bg-status-warning', text: 'text-status-warning', wash: 'bg-status-warning/5' },
  },
  shipped: {
    status: 'shipped',
    labelKey: (t) => t.notepad.status_shipped,
    badgeVariant: 'emerald',
    Icon: PackageCheck,
    tone: { border: 'border-status-success/40', fill: 'bg-status-success', text: 'text-status-success', wash: 'bg-status-success/5' },
  },
};

/** The entry an unknown token falls back to. Amber, not neutral: a token this
 *  build has never heard of is a signal, and rendering it as an ordinary state
 *  hides the drift. It is NOT a `NoteStatus` — nothing may switch on it. */
const UNKNOWN_META: Omit<NoteStatusMeta, 'status'> & { status: NoteStatus } = {
  status: 'draft',
  labelKey: (t) => t.notepad.status_unknown,
  badgeVariant: 'amber',
  Icon: CircleHelp,
  tone: { border: 'border-status-warning/40', fill: 'bg-status-warning', text: 'text-status-warning', wash: 'bg-status-warning/5' },
};

/**
 * Resolve a status token to its presentation.
 *
 * The parameter is typed `NoteStatus`, but the values arriving here came off
 * the wire from a Rust enum that can gain a variant in a build the frontend
 * has not caught up with. The lookup is therefore defensive rather than
 * exhaustive-by-construction — a raw token must never reach the screen.
 */
export function noteStatusMeta(status: NoteStatus): NoteStatusMeta {
  return NOTE_STATUS_META[status] ?? UNKNOWN_META;
}

/** Convenience for the badge's class string. */
export function noteStatusBadgeClass(status: NoteStatus): string {
  return BADGE_VARIANTS[noteStatusMeta(status).badgeVariant];
}

/**
 * TWO RAILS, not one list.
 *
 * A note leaves the pad through one of two doors and they are not stages of
 * each other. The BRAINSTORM rail is the original: the note is handed to a
 * runner and the run reports back. The PLAN rail is what a note becomes when it
 * is linked to a milestone: it stops being a thing that gets executed and
 * becomes the milestone's living brief, moving as the SCOPE moves — written,
 * frozen, shipped.
 *
 * They share only `draft`, which is the honest shape: every note starts as one
 * and the link is the fork. A single merged rail would have to claim that
 * `published` comes before `scoped` (it does not — they are alternatives) and
 * would render four steps a linked note can never reach.
 *
 * `archived` is absent from both: it is an exit from the lifecycle, not a step
 * along it.
 */
export const NOTE_LIFECYCLE_BRAINSTORM: readonly NoteStatus[] = ['draft', 'published', 'in_progress', 'completed'];
export const NOTE_LIFECYCLE_PLAN: readonly NoteStatus[] = ['draft', 'scoped', 'cut', 'shipped'];

/** The rail a note walks. The LINK is what decides it, not the status: a note
 *  linked while still `draft` is already on the plan rail and should show the
 *  three steps ahead of it, not four it will never take. */
export function noteLifecycleFor(milestoneId: string | null | undefined): readonly NoteStatus[] {
  return milestoneId ? NOTE_LIFECYCLE_PLAN : NOTE_LIFECYCLE_BRAINSTORM;
}

/** The brainstorm rail under its historical name. Kept as the default export of
 *  the pair so nothing that only ever meant "the original four" has to choose. */
export const NOTE_LIFECYCLE = NOTE_LIFECYCLE_BRAINSTORM;

/** Statuses in which the pad renders the note's own plan surface instead of the
 *  brainstorm workbench. `draft` is NOT among them: a linked draft is still
 *  being written and the milestone has no scope to show yet. */
export const NOTE_PLAN_STATUSES: readonly NoteStatus[] = ['scoped', 'cut', 'shipped'];

/** Body + project edits are legal here (the server agrees — see
 *  `NoteStatus::can_edit_body`). Everything else is a record. */
export function noteBodyEditable(status: NoteStatus): boolean {
  return status === 'draft' || status === 'scoped' || status === 'cut';
}

/**
 * Does this note occupy one of the ten slots the cap counts?
 *
 * MIRRORS `ACTIVE_STATUSES` in `src-tauri/db/src/repos/dev/notes.rs:134`, which
 * is the authority: `'draft','published','in_progress','scoped','cut'`. Note
 * what is absent — `completed` is a finished report and `shipped` is a milestone
 * that already landed; neither is live work, and counting them would let a
 * handful of finished briefs lock the pad shut.
 *
 * The frontend used to count `status !== 'archived'`, which is a DIFFERENT
 * predicate: it greyed the `+` button out and disabled the capture line while
 * the server would still happily have created the note, and `overview_count`
 * could render "12 of 10 notes". One predicate, stated once, in the one place
 * that already owns what a status means.
 */
export function noteOccupiesSlot(status: NoteStatus): boolean {
  return status === 'draft'
    || status === 'published'
    || status === 'in_progress'
    || status === 'scoped'
    || status === 'cut';
}
