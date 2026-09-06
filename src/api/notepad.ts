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
