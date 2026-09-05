import { FileText, Rocket, Loader, CircleCheck, Archive, CircleHelp, type LucideIcon } from 'lucide-react';

import { BADGE_VARIANTS, type BadgeVariant } from '@/features/shared/components/display/Badge';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';
import type { Translations } from '@/i18n/generated/types';

/**
 * ONE presentation table for `NoteStatus`.
 *
 * Every surface that shows a status — the tab glyph, the dispatch-bar badge,
 * the lifecycle timeline — reads it from here, so a status can never look like
 * two different things in two places. `labelKey` is resolved against the live
 * translations rather than stored as text: a table of English strings is a
 * table that ships English to every locale.
 */
export interface NoteStatusMeta {
  status: NoteStatus;
  /** Resolver against the translation tree — never a literal string. */
  labelKey: (t: Translations) => string;
  badgeVariant: BadgeVariant;
  Icon: LucideIcon;
}

export const NOTE_STATUS_META: Record<NoteStatus, NoteStatusMeta> = {
  draft: {
    status: 'draft',
    labelKey: (t) => t.notepad.status_draft,
    badgeVariant: 'neutral',
    Icon: FileText,
  },
  published: {
    status: 'published',
    labelKey: (t) => t.notepad.status_published,
    badgeVariant: 'blue',
    Icon: Rocket,
  },
  in_progress: {
    status: 'in_progress',
    labelKey: (t) => t.notepad.status_in_progress,
    badgeVariant: 'cyan',
    Icon: Loader,
  },
  completed: {
    status: 'completed',
    labelKey: (t) => t.notepad.status_completed,
    badgeVariant: 'emerald',
    Icon: CircleCheck,
  },
  archived: {
    status: 'archived',
    labelKey: (t) => t.notepad.status_archived,
    badgeVariant: 'neutral',
    Icon: Archive,
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

/** The lifecycle order the timeline walks. `archived` is deliberately absent:
 *  it is an exit from the lifecycle, not a step along it. */
export const NOTE_LIFECYCLE: readonly NoteStatus[] = ['draft', 'published', 'in_progress', 'completed'];
