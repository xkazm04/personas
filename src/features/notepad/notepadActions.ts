// The three dispatch doors a note can leave through — Athena, Fleet, Goals.
//
// They live behind this module rather than inline in `NoteDispatchBar` so the
// bar's disabled logic, its busy states and its tests never had to change when
// WP3 replaced the stubs: the change was confined to three function bodies.
//
// Each one resolves rather than throwing. An `AsyncButton` whose handler
// rejects paints an error the user cannot act on; a failure here is reported
// through `toastCatch` (which is the door that reaches Sentry AND the toast)
// and the bar simply re-enables.
import { companionDispatchFleetPlan } from '@/api/companion';
import { writeDispatchBrief } from '@/api/fleet/fleet';
import { installSystemSkill } from '@/api/devTools/devTools';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import { toastCatch } from '@/lib/silentCatch';

import { buildNoteAskPrompt } from './athena/buildNoteAskPrompt';
import { buildNoteGoalsPrompt } from './athena/buildNoteGoalsPrompt';
import { setNoteStatus } from './notepadStore';

/** Outcome of a dispatch attempt. `ok: false` carries a reason the bar shows. */
export interface NoteDispatchResult {
  ok: boolean;
  /** Present only when the action could not run for a reason the UI already
   *  states on the disabled control (no project, not a draft). */
  pending?: boolean;
}

const OK: NoteDispatchResult = { ok: true };
const FAILED: NoteDispatchResult = { ok: false };
/** The precondition the bar already renders as a tooltip. */
const BLOCKED: NoteDispatchResult = { ok: false, pending: true };

/** The `dispatch_key` a note carries once it has left the pad. */
export const noteDispatchKey = (noteId: string) => `note:${noteId}`;

/** The Fleet session label. Short on purpose — it sits in a grid beside seven
 *  others, and a full uuid there is a column of noise. The listener that maps a
 *  running session back to its note matches on this prefix. */
export const noteSessionLabel = (noteId: string) => `note:${noteId.slice(0, 8)}`;

/** Where the published brief lands inside the target repo. Mirrors the path
 *  the `note-task` skill reads and the sweeper watches beside. */
export const noteBriefPath = (noteId: string) => `.personas/notepad/${noteId}/note.md`;

/**
 * Speak to Athena on the pad's behalf.
 *
 * The store call is what `useAskAthena` does, made directly because this is a
 * module-scope action and not a component — the `source` tag is the part that
 * matters and it is non-negotiable: it files the turn as a SURFACE handing her
 * a situation rather than the operator typing, which keeps it from cancelling
 * an autonomous chain and tells her a button was pressed.
 */
function ask(text: string): void {
  useCompanionStore.getState().setPendingChatPrompt({ text, source: 'notepad' });
}

/**
 * Ask Athena about this note, optionally focused on something the operator
 * typed in the dispatch bar.
 *
 * Changes no status. Asking a question about a draft is not dispatching it, and
 * a note that moved to `published` the moment he asked for a second opinion
 * would lock its own body — which is the one thing her suggestions need.
 */
export async function askAthena(note: DevNote, focus?: string): Promise<NoteDispatchResult> {
  ask(buildNoteAskPrompt(note.id, focus));
  return OK;
}

/**
 * Publish the note to Fleet as a `/note-task` session.
 *
 * Order is load-bearing and each step is a precondition for the next:
 *   1. write `note.md` into the repo — the session's brief must exist BEFORE
 *      anything is spawned that will read it;
 *   2. install the `note-task` skill into that repo — a dispatched session can
 *      only invoke `/note-task` if the skill is physically there;
 *   3. dispatch through the typed door;
 *   4. only then stamp the note `published`, because that stamp is what LOCKS
 *      the body, and locking it before the dispatch succeeded would leave him
 *      with a note he can neither run nor edit.
 */
export async function publishFleet(
  note: DevNote,
  project: DevProject | null,
): Promise<NoteDispatchResult> {
  if (!project || note.projectId !== project.id) return BLOCKED;
  if (note.status !== 'draft') return BLOCKED;
  try {
    // Frontmatter first so the skill can identify the note without parsing the
    // path it was handed. `note_id` is the handshake: every artifact the run
    // writes back is keyed on it.
    const brief = [
      '---',
      `note_id: ${note.id}`,
      `title: ${JSON.stringify(note.title)}`,
      `project_id: ${project.id}`,
      '---',
      '',
      note.bodyMd,
      '',
    ].join('\n');
    await writeDispatchBrief(project.root_path, noteBriefPath(note.id), brief);
    // Deterministic copy from the app bundle — no LLM, no token cost. `true`
    // refreshes a stale local copy, which is what `dispatchSkillToRepo` does for
    // the same reason: a run must not use an edited copy of a system skill.
    //
    // The outcome is READ, not assumed. With `overwrite: true` the backend
    // either writes or throws, so `installed: false` should be unreachable —
    // but "should be unreachable" is exactly the claim that turns into a
    // dispatched session invoking a slash command that does not exist in the
    // repo, and the operator sees a terminal that does nothing. Refuse here
    // instead, while nothing has been spawned and nothing has been locked.
    const install = await installSystemSkill('note-task', project.id, true);
    if (!install.installed) {
      throw new Error(
        `The note-task skill is not installed in ${project.name} (${install.reason ?? 'unknown reason'}), so a dispatched session would have no /note-task to run.`,
      );
    }
    await companionDispatchFleetPlan(
      `Execute note: ${note.title}`,
      [
        {
          cwd: project.root_path,
          // The server composes `/note-task <objective>`, so the objective IS
          // the note id — the whole brief is on disk and the skill reads it.
          objective: note.id,
          skill: 'note-task',
          label: noteSessionLabel(note.id),
        },
      ],
      undefined,
      'notepad',
    );
    // `fleetSessionId` is deliberately absent: `companion_dispatch_fleet_plan`
    // returns a human-readable message, not an id. The fleet session-state
    // listener binds the id when the session reaches Running (it matches on the
    // label above), and the run-artifact sweeper is authoritative for the rest
    // of the lifecycle either way.
    await setNoteStatus(note.id, 'published', {
      dispatchTarget: 'fleet',
      dispatchKey: noteDispatchKey(note.id),
    });
    return OK;
  } catch (e) {
    toastCatch('notepad publish to fleet')(e);
    return FAILED;
  }
}

/**
 * Turn the note into Ship goals under the project's open milestone.
 *
 * The status moves BEFORE she is asked, and that ordering is the whole
 * mechanism: `show_ship_goals` carrying a `note_id` moves a **published** note
 * to `in_progress`, which is how the pad stops offering this button while a
 * card is already on screen. Asking first would race her.
 */
export async function toGoals(
  note: DevNote,
  project: DevProject | null,
): Promise<NoteDispatchResult> {
  if (!project || note.projectId !== project.id) return BLOCKED;
  if (note.status !== 'draft') return BLOCKED;
  try {
    await setNoteStatus(note.id, 'published', {
      dispatchTarget: 'athena_goals',
      dispatchKey: noteDispatchKey(note.id),
    });
    ask(buildNoteGoalsPrompt(note.id));
    return OK;
  } catch (e) {
    toastCatch('notepad to goals')(e);
    return FAILED;
  }
}

/** The action surface every body variant and the dispatch bar receive. Passing
 *  it as a prop (rather than importing the module) is what lets a test drive a
 *  variant without a companion, a fleet or a database. */
export interface NoteActions {
  askAthena: (focus?: string) => Promise<NoteDispatchResult>;
  publishFleet: () => Promise<NoteDispatchResult>;
  toGoals: () => Promise<NoteDispatchResult>;
}

/** Bind the module-level actions to one note and its resolved project. */
export function noteActionsFor(note: DevNote, project: DevProject | null): NoteActions {
  return {
    askAthena: (focus) => askAthena(note, focus),
    publishFleet: () => publishFleet(note, project),
    toGoals: () => toGoals(note, project),
  };
}
