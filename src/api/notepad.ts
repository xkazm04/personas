// Notepad API — thin wrappers over the `notepad_*` Tauri commands.
//
// The wire contract (statuses, legal transitions, the 10-note cap, which
// fields are editable in which status) is owned by the Rust side and stated in
// `.claude/spark/notepad-contract.md`. Nothing here re-validates it: a client
// that disagrees with the server about a transition would just produce two
// answers to one question. The UI *disables* controls it knows are illegal so
// the user never fires a doomed call, and the server is the one that refuses.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevNote } from "@/lib/bindings/DevNote";
import type { NoteStatus } from "@/lib/bindings/NoteStatus";
import type { NotepadIngestReport } from "@/lib/bindings/NotepadIngestReport";
import type { DevNoteRun } from "@/lib/bindings/DevNoteRun";
import type { NotePlanSummary } from "@/lib/bindings/NotePlanSummary";
import type { NotePromotion } from "@/lib/bindings/NotePromotion";
import type { NoteComment } from "@/lib/bindings/NoteComment";
import type { NoteUnread } from "@/lib/bindings/NoteUnread";
import type { NoteReviewVerdict } from "@/lib/bindings/NoteReviewVerdict";

/** Max non-archived notes, used only to grey out `+` before the user clicks
 *  it — the server refuses the eleventh note regardless of this number. The
 *  authoritative value is `repos::dev::notes::NOTE_CAP`; the Rust test
 *  `note_cap_is_ten_and_the_client_copy_lives_in_src_api_notepad_ts` is the
 *  tripwire that names this file when that value moves. */
export const NOTE_CAP = 10;

/** Ordered by order_index, then created_at. Archived notes are excluded unless
 *  asked for — the tab strip never wants them, the archive modal always does. */
export async function listNotes(includeArchived = false): Promise<DevNote[]> {
  return invoke<DevNote[]>("notepad_list_notes", { includeArchived });
}

export async function createNote(title: string, projectId?: string | null): Promise<DevNote> {
  return invoke<DevNote>("notepad_create_note", { title, projectId: projectId ?? null });
}

/** Patch-style update. The patch travels as ONE object (`NotePatch` on the
 *  Rust side, `double_option` on `projectId`) so the wire keeps all three
 *  states apart: an omitted key leaves the column alone, `projectId: null`
 *  explicitly CLEARS the mapping, a string sets it. Bare optional command args
 *  cannot express that — serde collapses an explicit null to "absent". */
export async function updateNote(
  id: string,
  patch: {
    title?: string;
    bodyMd?: string;
    projectId?: string | null;
    orderIndex?: number;
  },
): Promise<DevNote> {
  return invoke<DevNote>("notepad_update_note", {
    id,
    patch: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.bodyMd !== undefined ? { bodyMd: patch.bodyMd } : {}),
      // `in` rather than `!== undefined`: passing null is the clear operation and
      // must survive to the wire, where an absent key means "leave it".
      ...("projectId" in patch ? { projectId: patch.projectId ?? null } : {}),
      ...(patch.orderIndex !== undefined ? { orderIndex: patch.orderIndex } : {}),
    },
  });
}

/** Extra dispatch metadata stamped alongside a status change. Empty for the
 *  plain transitions (archive, restore); populated by the Fleet/goals doors. */
export interface SetNoteStatusExtra {
  dispatchTarget?: string | null;
  dispatchKey?: string | null;
  fleetSessionId?: string | null;
  resultJson?: string | null;
}

export async function setNoteStatus(
  id: string,
  status: NoteStatus,
  extra?: SetNoteStatusExtra,
): Promise<DevNote> {
  return invoke<DevNote>("notepad_set_status", {
    id,
    status,
    dispatchTarget: extra?.dispatchTarget ?? null,
    dispatchKey: extra?.dispatchKey ?? null,
    fleetSessionId: extra?.fleetSessionId ?? null,
    resultJson: extra?.resultJson ?? null,
  });
}

/** Allowed for `draft` and `archived` only — the server refuses the rest. */
export async function deleteNote(id: string): Promise<void> {
  return invoke<void>("notepad_delete_note", { id });
}

/** New draft carrying the same body + project, titled "<title> (copy)". */
export async function forkNote(id: string): Promise<DevNote> {
  return invoke<DevNote>("notepad_fork_note", { id });
}

/** Run the run-artifact sweeper once, on demand. The same sweep also runs on
 *  the fleet stale tick; this is the "check now" door. */
export async function ingestNoteRuns(): Promise<NotepadIngestReport> {
  return invoke<NotepadIngestReport>("notepad_ingest_runs", undefined, { timeoutMs: 60_000 });
}

/** Resolve one Athena suggestion row against a note (WP3 surface). */
export async function resolveNoteSuggestion(
  cardId: string,
  rowId: string,
  outcome: "accepted" | "rejected" | "edited",
  bodyMd?: string,
): Promise<DevNote> {
  return invoke<DevNote>("notepad_resolve_suggestion", {
    cardId,
    rowId,
    outcome,
    bodyMd: bodyMd ?? null,
  });
}

// --- the plan rail ------------------------------------------------------------
//
// A note that has been LINKED to a milestone stops being a brainstorm and
// becomes that milestone's living brief. The five commands below are the whole
// seam; none of them travel through `updateNote`'s patch, deliberately —
// `milestone_id` and `status` are transitions the server owns, and a patch key
// for either would give the client a second, unvalidated way to make them.

/** Link the note to a milestone, or pass `null` to unlink it. Unlinking is
 *  legal only while the note is `scoped`: once the scope is cut the note IS
 *  the record of that cut, and the server refuses. */
export async function linkMilestone(id: string, milestoneId: string | null): Promise<DevNote> {
  return invoke<DevNote>("notepad_link_milestone", { id, milestoneId });
}

/** Promote a draft into a plan: mint (or adopt) a milestone and link it. The
 *  reply says which of the two happened — `created: false` means the note was
 *  bound to the project's already-open milestone rather than a new one. */
export async function promoteNote(id: string): Promise<NotePromotion> {
  return invoke<NotePromotion>("notepad_promote_note", { id });
}

/** One row per LINKED note — the desk's and the timeline's join, in one read.
 *  Notes with no milestone are simply absent (not null rows). */
export async function listPlanSummaries(): Promise<NotePlanSummary[]> {
  return invoke<NotePlanSummary[]>("notepad_list_plan_summaries");
}

/** Every run this note has been through, append-only. Newest-first is the
 *  CALLER's ordering decision — the command returns the table's order. */
export async function listNoteRuns(id: string): Promise<DevNoteRun[]> {
  return invoke<DevNoteRun[]>("notepad_list_runs", { id });
}

/** Record that a run STARTED. Called the moment a dispatch succeeds, so a run
 *  that never reports back is still visible as one that was launched — the
 *  alternative is a spawn with no trace until the sweeper finds an artifact,
 *  and a run that crashed before writing one leaves no trace at all. */
export async function recordNoteRunStart(
  id: string,
  kind: string,
  dispatchKey?: string | null,
  fleetSessionId?: string | null,
): Promise<DevNoteRun> {
  return invoke<DevNoteRun>("notepad_record_run_start", {
    id,
    kind,
    dispatchKey: dispatchKey ?? null,
    fleetSessionId: fleetSessionId ?? null,
  });
}

// --- the per-note thread (dev_note_comments, e40) ------------------------------
//
// Comments, reviews and status milestones about one note. Writes emit
// `notepad-note-comment` with the full row, so a listener never refetches.

/** One note's thread, oldest first. */
export async function listNoteComments(noteId: string): Promise<NoteComment[]> {
  return invoke<NoteComment[]>("notepad_list_comments", { noteId });
}

/** Every note with unread thread entries. Notes with nothing unread are
 *  absent, not zero. The operator's own comments are born read. */
export async function noteUnreadCounts(): Promise<NoteUnread[]> {
  return invoke<NoteUnread[]>("notepad_unread_counts");
}

/** The operator comments on a note. Returns the stored row. */
export async function addNoteComment(noteId: string, bodyMd: string): Promise<NoteComment> {
  return invoke<NoteComment>("notepad_add_comment", { noteId, bodyMd });
}

/** Stamp every unread entry of one note read (popover open). */
export async function markNoteCommentsRead(noteId: string): Promise<void> {
  return invoke<void>("notepad_mark_comments_read", { noteId });
}

/** Answer a review entry. The server refuses `pending`, and refuses
 *  `rejected` without a non-empty reason. */
export async function setNoteReviewVerdict(
  commentId: string,
  verdict: Exclude<NoteReviewVerdict, "pending">,
  reason?: string,
): Promise<NoteComment> {
  return invoke<NoteComment>("notepad_set_review_verdict", {
    commentId,
    verdict,
    reason: reason ?? null,
  });
}
