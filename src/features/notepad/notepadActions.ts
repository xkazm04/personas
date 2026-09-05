// The three dispatch doors a note can leave through — Athena, Fleet, Goals.
//
// STUBS. WP3 owns the real implementations (companion dispatch, the
// `/note-task` fleet plan, `companion_create_ship_goals`). They live behind
// this module rather than inline in `NoteDispatchBar` so the bar's disabled
// logic, its busy states and its tests are all real NOW, and WP3's change is
// confined to three function bodies — no UI edits, no prop churn.
//
// Each one resolves rather than throwing: an `AsyncButton` whose handler
// rejects paints an error the user cannot act on, and "nothing happened yet"
// is the honest state of a stub.
import type { DevNote } from '@/lib/bindings/DevNote';

/** Outcome of a dispatch attempt. `ok: false` carries a reason the bar shows. */
export interface NoteDispatchResult {
  ok: boolean;
  /** Present only when this build cannot yet perform the action. */
  pending?: boolean;
}

const NOT_WIRED: NoteDispatchResult = { ok: false, pending: true };

/**
 * Ask Athena about this note, optionally focused on a question the user typed.
 *
 * TODO(WP3): open the companion panel with a `describe_note` READ_OP for
 * `note.id` and seed the composer with `focus`. Contract:
 * `.claude/spark/notepad-contract.md` § Athena.
 */
export async function askAthena(_note: DevNote, _focus?: string): Promise<NoteDispatchResult> {
  return NOT_WIRED;
}

/**
 * Publish the note to Fleet as a `/note-task` session.
 *
 * TODO(WP3): write `<root>/.personas/notepad/<id>/note.md`, then
 * `companionDispatchFleetPlan("Execute note: <title>", [{ cwd, objective:
 * note.id, skill: "note-task", label: "note:<id-prefix-8>" }], undefined,
 * "notepad")`, then `setNoteStatus(id, 'published', { dispatchTarget: 'fleet',
 * dispatchKey: 'note:<id>' })`.
 */
export async function publishFleet(_note: DevNote): Promise<NoteDispatchResult> {
  return NOT_WIRED;
}

/**
 * Turn the note into Ship goals under the project's open milestone.
 *
 * TODO(WP3): `show_ship_goals` with the optional `note_id`, then
 * `companion_create_ship_goals(milestone_id, goals, note_id)`; stamp
 * `dispatchTarget: 'athena_goals'` and store `{ goal_ids }` in `resultJson`.
 */
export async function toGoals(_note: DevNote): Promise<NoteDispatchResult> {
  return NOT_WIRED;
}

/** The action surface every body variant and the dispatch bar receive. Passing
 *  it as a prop (rather than importing the module) is what lets a test drive a
 *  variant without a companion, a fleet or a database. */
export interface NoteActions {
  askAthena: (focus?: string) => Promise<NoteDispatchResult>;
  publishFleet: () => Promise<NoteDispatchResult>;
  toGoals: () => Promise<NoteDispatchResult>;
}

/** Bind the module-level stubs to one note. */
export function noteActionsFor(note: DevNote): NoteActions {
  return {
    askAthena: (focus) => askAthena(note, focus),
    publishFleet: () => publishFleet(note),
    toGoals: () => toGoals(note),
  };
}
