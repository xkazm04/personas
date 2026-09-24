// The thread's verbs: comment, approve a review, reject a review.
//
// Same contract as `notepadActions.ts`: every door RESOLVES to a
// `NoteDispatchResult` rather than throwing (an `AsyncButton` whose handler
// rejects paints an error nobody can act on), real failures go through
// `toastCatch` — the door that reaches Sentry AND the toast — and a
// precondition the UI already states comes back as `{ ok: false, pending: true }`.
import {
  addNoteComment,
  listNoteComments,
  resolveNoteSuggestion,
  setNoteReviewVerdict,
} from '@/api/notepad';
import { getProject } from '@/api/devTools/devTools';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { NoteComment } from '@/lib/bindings/NoteComment';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

import { buildNoteCommentPrompt } from '../athena/buildNoteCommentPrompt';
import {
  markRowResolvedLocally,
  noteSuggestionCards,
  openSuggestionCountFor,
} from '../athena/noteSuggestions';
import { startAsk } from '../notepadAskState';
import {
  dispatchNoteToFleet,
  sendAthenaPointer,
  type NoteDispatchResult,
  type NoteRunFeedback,
} from '../notepadActions';
import { getNote, refetchNote } from '../notepadStore';
import { ingestNoteComment } from './noteThreadStore';

const OK: NoteDispatchResult = { ok: true };
const FAILED: NoteDispatchResult = { ok: false };
const BLOCKED: NoteDispatchResult = { ok: false, pending: true };

// --- comment ------------------------------------------------------------------

/**
 * The operator comments on a note — and Athena is told where to read it.
 *
 * Two steps, in this order: the comment is STORED first (it is the operator's
 * words and must survive whatever happens to the second step), then Athena gets
 * a pointer turn naming `describe_note` and `comment_on_note`. The pointer
 * carries no copy of the comment: she reads it from the thread, where it is
 * anchored to the entries it answers.
 *
 * Opens the "Athena is working" wait for the note; her reply in the thread (or
 * blocks landing, or the ceiling) ends it.
 */
export async function commentOnNote(
  note: Pick<DevNote, 'id'>,
  text: string,
): Promise<NoteDispatchResult> {
  const body = text.trim();
  if (!body) return BLOCKED;
  try {
    const row = await addNoteComment(note.id, body);
    ingestNoteComment(row);
  } catch (e) {
    toastCatch('notepad thread comment')(e);
    return FAILED;
  }
  sendAthenaPointer(buildNoteCommentPrompt(note.id));
  startAsk(note.id, openSuggestionCountFor(note.id));
  return OK;
}

// --- reviews ------------------------------------------------------------------

type RowOutcome = 'accepted' | 'rejected';

/**
 * Resolve every OPEN row of one `note_suggestions` card through the same door
 * `SuggestionSlot` uses, one at a time and in card order — an accepted section
 * inserts text, and two inserts racing into one body would interleave.
 *
 * THROWS on the first failure: a verdict stamped over a half-applied card would
 * say "approved" about rows that never landed.
 *
 * A card the transcript no longer holds (pruned, never hydrated) has no rows
 * this side can see; that is reported to Sentry and the verdict still goes
 * through, because the card's rows are then invisible everywhere in the app and
 * refusing the verdict would leave a review that can never be answered.
 */
async function resolveCardRows(cardId: string | null, outcome: RowOutcome): Promise<string | null> {
  if (!cardId) return null;
  const card = noteSuggestionCards(useCompanionStore.getState().chatCards).find((c) => c.cardId === cardId);
  if (!card) {
    silentCatch('notepad review: suggestion card not in transcript')(
      new Error(`note_suggestions card ${cardId} is not loaded; stamping the verdict without resolving its rows`),
    );
    return null;
  }
  let touchedNote: string | null = null;
  for (const row of card.rows) {
    if (row.outcome !== null) continue;
    const note = await resolveNoteSuggestion(row.cardId, row.rowId, outcome);
    markRowResolvedLocally(row.cardId, row.rowId, outcome);
    touchedNote = note.id;
  }
  return touchedNote;
}

/**
 * Approve a review entry.
 *
 *  - `suggestion_card`: accept every open row of that card, THEN stamp
 *    `approved`. The verdict is the record of a decision that already landed.
 *  - `run` (and anything else): stamp `approved`. No status move — a completed
 *    run the operator approves stays completed.
 */
export async function approveReview(comment: NoteComment): Promise<NoteDispatchResult> {
  if (comment.kind !== 'review') return BLOCKED;
  try {
    if (comment.refKind === 'suggestion_card') {
      const touched = await resolveCardRows(comment.refId, 'accepted');
      if (touched) void refetchNote(touched);
    }
    const row = await setNoteReviewVerdict(comment.id, 'approved');
    ingestNoteComment(row);
    return OK;
  } catch (e) {
    toastCatch('notepad approve review')(e);
    return FAILED;
  }
}

/**
 * The operator's comments posted AFTER a run review — what goes into the
 * re-run's brief beside the reason. The reason itself is excluded: the server
 * records it as an operator comment too, and the brief states it once.
 * Exported for tests.
 */
export function feedbackCommentsSince(
  thread: readonly NoteComment[],
  review: Pick<NoteComment, 'createdAt'>,
  reason: string,
): string[] {
  const r = reason.trim();
  return thread
    .filter(
      (c) =>
        c.authorKind === 'operator' &&
        c.kind === 'comment' &&
        c.createdAt >= review.createdAt &&
        c.bodyMd.trim() !== r,
    )
    .map((c) => c.bodyMd.trim())
    .filter(Boolean);
}

export interface RejectReviewOptions {
  /** The note's resolved project, when the caller already has it. Fetched by
   *  id otherwise — the rework dispatch needs its `root_path`. */
  project?: DevProject | null;
}

/**
 * Reject a review entry.
 *
 *  - `suggestion_card`: reject every open row, then stamp `rejected` (the
 *    reason is optional here and forwarded when given).
 *  - `run`: the REWORK loop. A non-empty reason is required (a re-run with no
 *    reason is the same run again, and the loop would ping-pong). The server's
 *    `rejected` verdict records the reason and moves the note
 *    `completed → published` itself; this door then re-reads the note and
 *    re-dispatches it to Fleet with the reason and the operator's comments since
 *    the review appended to the brief — WITHOUT a second status write.
 */
export async function rejectReview(
  comment: NoteComment,
  reason?: string,
  opts: RejectReviewOptions = {},
): Promise<NoteDispatchResult> {
  if (comment.kind !== 'review') return BLOCKED;
  const why = reason?.trim() ?? '';

  if (comment.refKind !== 'run') {
    try {
      if (comment.refKind === 'suggestion_card') {
        const touched = await resolveCardRows(comment.refId, 'rejected');
        if (touched) void refetchNote(touched);
      }
      const row = await setNoteReviewVerdict(comment.id, 'rejected', why || undefined);
      ingestNoteComment(row);
      return OK;
    } catch (e) {
      toastCatch('notepad reject review')(e);
      return FAILED;
    }
  }

  if (!why) return BLOCKED;
  try {
    const row = await setNoteReviewVerdict(comment.id, 'rejected', why);
    ingestNoteComment(row);
  } catch (e) {
    toastCatch('notepad reject review')(e);
    return FAILED;
  }
  return redispatchWithFeedback(comment, why, opts.project);
}

/**
 * The second half of a rejected run: the verdict is stored and the server has
 * moved the note back to `published`; now run it again with the feedback.
 */
async function redispatchWithFeedback(
  review: NoteComment,
  reason: string,
  knownProject: DevProject | null | undefined,
): Promise<NoteDispatchResult> {
  try {
    await refetchNote(review.noteId);
    const note = getNote(review.noteId);
    if (!note) throw new Error(`note ${review.noteId} is gone; nothing to re-run`);
    // The verdict is what moved it. If it did not, dispatching would run a note
    // the server still calls completed — and the sweeper would file the new
    // run's artifacts against a lifecycle that never reopened.
    if (note.status !== 'published') {
      throw new Error(`note ${note.id} is ${note.status} after the rejection, not published; the re-run was not started`);
    }
    if (!note.projectId) throw new Error(`note ${note.id} has no project; the re-run was not started`);
    const project =
      knownProject && knownProject.id === note.projectId ? knownProject : await getProject(note.projectId);

    const thread = await listNoteComments(note.id);
    const feedback: NoteRunFeedback = {
      reason,
      comments: feedbackCommentsSince(thread, review, reason),
    };
    await dispatchNoteToFleet(note, project, { feedback });
    return OK;
  } catch (e) {
    toastCatch('notepad rework dispatch')(e);
    return FAILED;
  }
}
