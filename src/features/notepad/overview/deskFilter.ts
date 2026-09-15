// The desk's STATUS filter — the second axis beside the project filter.
//
// Two rails share the desk (`noteStatusMeta`: brainstorm `draft → published →
// in_progress → completed`, plan `draft → scoped → cut → shipped`), and they are
// alternatives rather than stages of each other. A single grid of both is what
// the desk was; this filter lets the operator look down one rail at a time
// without inventing a third concept.
//
// `shipped` is absent from EVERY option, including `all`. A shipped note is the
// record of a milestone that landed — it belongs in the archive drawer's Shipped
// group beside the archived ones, not on a desk of live work. Rust already keeps
// it out of the non-archived cap, so the desk and the cap agree.
import type { NoteStatus } from '@/lib/bindings/NoteStatus';
import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

import { NOTE_LIFECYCLE_BRAINSTORM } from '../noteStatusMeta';

export type DeskFilter = 'drafts' | 'scoped' | 'all';

export const DESK_FILTERS: readonly DeskFilter[] = ['drafts', 'scoped', 'all'];

/** The plan rail's WORKING states — `shipped` is deliberately not one of them
 *  (see the file header) and `draft` belongs to the brainstorm option, which is
 *  where an unlinked note starts. */
const SCOPED_STATUSES: readonly NoteStatus[] = ['scoped', 'cut'];

/** Does a note belong under this filter? `shipped` answers false everywhere. */
export function matchesDeskFilter(status: NoteStatus, filter: DeskFilter): boolean {
  if (status === 'shipped') return false;
  if (filter === 'drafts') return NOTE_LIFECYCLE_BRAINSTORM.includes(status);
  if (filter === 'scoped') return SCOPED_STATUSES.includes(status);
  return NOTE_LIFECYCLE_BRAINSTORM.includes(status) || SCOPED_STATUSES.includes(status);
}

/** Per-viewer convenience only — which lens the desk opened on last time. Never
 *  the authority for anything (`client-state-persistence` step 10): a blocked or
 *  full storage silently falls back to `all`, and nothing downstream notices. */
const KEY = 'personas.notepad.deskFilter';

export function readDeskFilter(): DeskFilter {
  const raw = safeLocalGet(KEY, 'notepad desk filter read');
  // Coerced field by field rather than asserted: the value was written by some
  // build of this app, and an option this build has never heard of must not
  // reach the filter as a live token.
  return DESK_FILTERS.includes(raw as DeskFilter) ? (raw as DeskFilter) : 'all';
}

export function writeDeskFilter(filter: DeskFilter): void {
  safeLocalSet(KEY, filter, 'notepad desk filter write');
}
