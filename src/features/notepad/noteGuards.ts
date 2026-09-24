// The predicates two surfaces must agree on, in one place.
//
// The dispatch bar and the desk card's context menu both offer "Ask Athena",
// and the card menu offers "Delete permanently". A refusal that one surface
// states and the other does not is a second vocabulary for one rule — so the
// rule lives here and both import it. Pure: no store, no IPC, no React.
import type { DevNote } from '@/lib/bindings/DevNote';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';

/** The Fleet session label. Short on purpose — it sits in a grid beside seven
 *  others, and a full uuid there is a column of noise. The listener that maps a
 *  running session back to its note matches on this prefix. */
export const noteSessionLabel = (noteId: string) => `note:${noteId.slice(0, 8)}`;

/**
 * Does this Fleet session name belong to this note?
 *
 * The dispatch labels a session `noteSessionLabel(id)`; the single-session spawn
 * path renders it verbatim (`athena · note:abc12345`) and the multi-session path
 * kebabs it (`athena-note-abc12345`) — the same two spellings
 * `notepadStore.noteIdForSessionName` accepts. Matched against THIS note's id
 * rather than resolved through the note map, so it stays pure.
 */
export function sessionNameMatchesNote(name: string | null | undefined, noteId: string): boolean {
  if (!name) return false;
  if (name === noteSessionLabel(noteId)) return true;
  const match = /note[:-]([0-9a-fA-F]{8})(?![0-9a-fA-F])/.exec(name);
  return !!match && match[1]!.toLowerCase() === noteId.slice(0, 8).toLowerCase();
}

/** States in which a note's session is actively WORKING — what the card's
 *  presence chip claims. `idle` is not work (the Stop hook fired), `queued` has
 *  not started, `stale` is a reading nobody should present as progress. */
export const FLEET_WORKING_STATES: ReadonlySet<FleetSessionState> = new Set<FleetSessionState>([
  'spawning',
  'running',
  'awaiting_input',
]);

/** States in which a note's session still holds the note — queued included,
 *  because deleting a note whose run is about to start strands the run. */
export const FLEET_HOLDING_STATES: ReadonlySet<FleetSessionState> = new Set<FleetSessionState>([
  'queued',
  ...FLEET_WORKING_STATES,
]);

/** The note's newest session in a working state, if any. */
export function workingSessionFor(
  sessions: readonly FleetSession[],
  noteId: string,
  states: ReadonlySet<FleetSessionState> = FLEET_WORKING_STATES,
): FleetSession | undefined {
  let best: FleetSession | undefined;
  for (const s of sessions) {
    if (!states.has(s.state) || !sessionNameMatchesNote(s.name, noteId)) continue;
    if (!best || s.createdAtMs > best.createdAtMs) best = s;
  }
  return best;
}

/**
 * Why Athena cannot take this note, as a `t.notepad.*` key — or `null` when she
 * can.
 *
 * She writes nothing, so she is available wherever the note is READABLE as
 * itself: a draft being written, a brief being worked (`scoped`/`cut`), a record
 * being questioned (`shipped`). She stays blocked on the brainstorm rail's
 * post-dispatch states (`published`, `in_progress`, `completed`), where the note
 * belongs to a run — and on a note with no project, which she cannot ground.
 */
export function noteAskBlockedReasonKey(
  note: Pick<DevNote, 'projectId' | 'status'>,
): 'dispatch_needs_project' | 'dispatch_needs_draft' | null {
  if (!note.projectId) return 'dispatch_needs_project';
  const readable =
    note.status === 'draft' || note.status === 'scoped' || note.status === 'cut' || note.status === 'shipped';
  return readable ? null : 'dispatch_needs_draft';
}

/** True when "Ask Athena" must be refused for this note. */
export function noteAskBlocked(note: Pick<DevNote, 'projectId' | 'status'>): boolean {
  return noteAskBlockedReasonKey(note) !== null;
}

/**
 * True while a Fleet session for the note still holds it — deleting the note
 * would leave a run writing artifacts for a row that no longer exists. The menu
 * shows `t.notepad.menu_delete_blocked_running` on the disabled item.
 */
export function noteDeleteBlocked(
  note: Pick<DevNote, 'id'>,
  fleetSessions: readonly FleetSession[],
): boolean {
  return workingSessionFor(fleetSessions, note.id, FLEET_HOLDING_STATES) !== undefined;
}
