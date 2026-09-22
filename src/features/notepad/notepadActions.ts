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
import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import { toastCatch } from '@/lib/silentCatch';

import { buildNoteAskPrompt } from './athena/buildNoteAskPrompt';
import { buildNoteGoalsPrompt } from './athena/buildNoteGoalsPrompt';
import { openSuggestionCountFor } from './athena/noteSuggestions';
import { startAsk } from './notepadAskState';
import { linkMilestone, promoteNote, setNoteStatus } from './notepadStore';
import { noteSessionLabel } from './noteGuards';

// Re-exported: the label moved to `noteGuards.ts` so pure predicates (the
// delete guard, the presence chip) can match sessions without importing the
// dispatch doors.
export { noteSessionLabel };

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
export function sendAthenaPointer(text: string): void {
  useAthenaStore.getState().setPendingChatPrompt({ text, source: 'notepad' });
}
const ask = sendAthenaPointer;

/**
 * Ask Athena about this note, optionally focused on something the operator
 * typed in the dispatch bar.
 *
 * Changes no status. Asking a question about a draft is not dispatching it, and
 * a note that moved to `published` the moment he asked for a second opinion
 * would lock its own body — which is the one thing her suggestions need.
 */
export async function askAthena(note: DevNote, focus?: string): Promise<NoteDispatchResult> {
  // A LINKED note is two things and the prompt names both ops. It is the note
  // that carries the milestone id, not the caller, so nothing upstream has to
  // know which rail this note is on.
  ask(buildNoteAskPrompt(note.id, focus, note.milestoneId));
  // Open the wait here, not only in the bar: the card menu's quick-ask reaches
  // this door too, and the presence chip must read the same answer.
  startAsk(note.id, openSuggestionCountFor(note.id));
  return OK;
}

/**
 * What the operator said about the previous run — appended to the brief as a
 * trailing `## Operator feedback` section on a re-dispatch. The `note-task`
 * skill treats that section as binding.
 */
export interface NoteRunFeedback {
  /** Why the last run was rejected. Required: a re-run with no reason is the
   *  same run again. */
  reason: string;
  /** The operator's thread comments posted since that run's review. */
  comments?: readonly string[];
}

/** The heading the `note-task` skill looks for. Fixed: it finds it by name. */
export const OPERATOR_FEEDBACK_HEADING = '## Operator feedback';

/** The brief `note.md` the `note-task` skill reads. Pure — exported for tests. */
export function composeNoteBrief(
  note: Pick<DevNote, 'id' | 'title' | 'bodyMd'>,
  projectId: string,
  feedback?: NoteRunFeedback,
): string {
  // Frontmatter first so the skill can identify the note without parsing the
  // path it was handed. `note_id` is the handshake: every artifact the run
  // writes back is keyed on it.
  const lines = [
    '---',
    `note_id: ${note.id}`,
    `title: ${JSON.stringify(note.title)}`,
    `project_id: ${projectId}`,
    '---',
    '',
    note.bodyMd,
    '',
  ];
  if (feedback) {
    // LAST, and under a fixed heading: the skill finds it by name, and a
    // section appended after the body cannot be mistaken for part of the
    // requirement the operator wrote.
    const comments = (feedback.comments ?? []).map((c) => c.trim()).filter(Boolean);
    lines.push(
      OPERATOR_FEEDBACK_HEADING,
      '',
      'The previous run of this note was rejected. What follows is binding for this run.',
      '',
      `Reason: ${feedback.reason.trim()}`,
      '',
    );
    if (comments.length > 0) {
      lines.push('Comments since the previous run:', '');
      for (const c of comments) lines.push(`- ${c.replace(/\s*\n+\s*/g, ' ')}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

/**
 * Write the brief, install the skill, launch the session — the three steps of a
 * Fleet dispatch that do NOT touch the note's status. THROWS on any failure.
 *
 * Shared by `publishFleet` (which stamps `published` after it) and the rework
 * path (where the server already moved the note `completed → published` when
 * the run review was rejected, so a second status write would be refused).
 *
 * Order is load-bearing and each step is a precondition for the next:
 *   1. write `note.md` into the repo — the session's brief must exist BEFORE
 *      anything is spawned that will read it;
 *   2. install the `note-task` skill into that repo — a dispatched session can
 *      only invoke `/note-task` if the skill is physically there;
 *   3. dispatch through the typed door.
 */
export async function dispatchNoteToFleet(
  note: DevNote,
  project: DevProject,
  opts?: { feedback?: NoteRunFeedback },
): Promise<void> {
  await writeDispatchBrief(
    project.root_path,
    noteBriefPath(note.id),
    composeNoteBrief(note, project.id, opts?.feedback),
  );
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
}

/**
 * Publish the note to Fleet as a `/note-task` session.
 *
 * `dispatchNoteToFleet` first, and only then the `published` stamp, because
 * that stamp is what LOCKS the body, and locking it before the dispatch
 * succeeded would leave him with a note he can neither run nor edit.
 */
export async function publishFleet(
  note: DevNote,
  project: DevProject | null,
): Promise<NoteDispatchResult> {
  if (!project || note.projectId !== project.id) return BLOCKED;
  if (note.status !== 'draft') return BLOCKED;
  try {
    await dispatchNoteToFleet(note, project);
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

// --- the plan rail ------------------------------------------------------------

/**
 * Turn a draft into a plan: mint (or adopt) its milestone and link it.
 *
 * Separate from `toGoals`, which it now runs in FRONT of. The two answer
 * different questions and used to be collapsed into one: "turn this into goals"
 * asked Athena to decompose the body, and the goals landed under whichever
 * milestone the project happened to have open — a binding nobody chose and
 * nothing recorded. Promoting first means the note IS the milestone's brief
 * before she is asked, so the goals she proposes have a declared home and the
 * note keeps moving with them.
 */
export async function promote(note: DevNote): Promise<NoteDispatchResult> {
  if (!note.projectId) return BLOCKED;
  const promotion = await promoteNote(note.id);
  // `promoteNote` already reported through `toastCatch`; a null here is a
  // failure the operator has seen, not a precondition the bar states.
  return promotion ? OK : FAILED;
}

/** Bind the note to a milestone the operator picked out of the project's open
 *  ones. The server decides whether the status moves; the pad never guesses. */
export async function linkExisting(note: DevNote, milestoneId: string): Promise<NoteDispatchResult> {
  if (!note.projectId) return BLOCKED;
  return (await linkMilestone(note.id, milestoneId)) ? OK : FAILED;
}

/**
 * Unbind the note from its milestone.
 *
 * Legal only while `scoped`, and the server is what enforces that — the bar
 * simply does not offer the verb once the scope is cut, because after a cut the
 * note is the RECORD of what was cut and unlinking it would orphan that record
 * from the thing it describes.
 */
export async function unlink(note: DevNote): Promise<NoteDispatchResult> {
  if (!note.milestoneId) return BLOCKED;
  return (await linkMilestone(note.id, null)) ? OK : FAILED;
}

/** The action surface every body variant and the dispatch bar receive. Passing
 *  it as a prop (rather than importing the module) is what lets a test drive a
 *  variant without a companion, a fleet or a database. */
export interface NoteActions {
  askAthena: (focus?: string) => Promise<NoteDispatchResult>;
  publishFleet: () => Promise<NoteDispatchResult>;
  /** Promote FIRST, then ask — see `toGoalsUnderMilestone`. */
  toGoals: () => Promise<NoteDispatchResult>;
  /** Mint or adopt this note's milestone and link it (the picker's "New"). */
  promote: () => Promise<NoteDispatchResult>;
  /** Link a milestone the operator chose from the project's open ones. */
  link: (milestoneId: string) => Promise<NoteDispatchResult>;
  /** Unbind — offered while `scoped` only. */
  unlink: () => Promise<NoteDispatchResult>;
}

/**
 * "Turn into goals", in the order the two halves have to happen in.
 *
 * The promotion comes first and its failure is fatal to the whole verb: asking
 * her to decompose a note that is not yet anybody's brief produces goals under
 * whichever milestone the project happened to have open — a binding nobody
 * chose and nothing recorded. Only once the note IS a milestone's brief is she
 * asked.
 *
 * The second half is what this function replaced: the original `toGoals`
 * stamped `published` and sent the prompt, and nothing bound the note to the
 * milestone the goals landed under.
 */
export async function toGoals(
  note: DevNote,
  project: DevProject | null,
): Promise<NoteDispatchResult> {
  if (!project || note.projectId !== project.id) return BLOCKED;
  if (note.status !== 'draft') return BLOCKED;

  const promotion = await promoteNote(note.id);
  if (!promotion) return FAILED;

  // WHICH STATUS THE NOTE IS IN NOW IS THE SERVER'S ANSWER, NOT OURS.
  //
  // The second half of this verb is the legacy `draft → published` stamp, which
  // exists for exactly one reason: it is what stops the pad offering this button
  // again while a `show_ship_goals` card is already on screen. Promotion may
  // ALREADY have achieved that by moving the note onto the plan rail — and if it
  // did, stamping `published` on top would be an illegal transition the server
  // refuses, turning a successful promotion into a failed verb.
  //
  // So the stamp is conditional on the row that came back, not on the stale copy
  // this function was called with. If promotion left the note a draft we take
  // the original path; if it moved it, the move is already the guard.
  if (promotion.note.status === 'draft') {
    try {
      await setNoteStatus(note.id, 'published', {
        dispatchTarget: 'athena_goals',
        dispatchKey: noteDispatchKey(note.id),
      });
    } catch (e) {
      toastCatch('notepad to goals')(e);
      return FAILED;
    }
  }

  ask(buildNoteGoalsPrompt(note.id));
  return OK;
}

/** Bind the module-level actions to one note and its resolved project. */
export function noteActionsFor(note: DevNote, project: DevProject | null): NoteActions {
  return {
    askAthena: (focus) => askAthena(note, focus),
    publishFleet: () => publishFleet(note, project),
    toGoals: () => toGoals(note, project),
    promote: () => promote(note),
    link: (milestoneId) => linkExisting(note, milestoneId),
    unlink: () => unlink(note),
  };
}
