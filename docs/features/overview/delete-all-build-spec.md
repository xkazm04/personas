# "Delete all" buttons for 3 Overview modules — build spec

User ask: an icon button + confirm dialog in each of Messages / Human Review / Knowledge(Memories)
that **hard-deletes ALL rows** in that module's table. Lets the user clean test data safely
(confirm step) instead of raw SQLite DELETEs.

## Tables (verified counts) + FK safety
- Messages → `persona_messages` (326). FK child `persona_message_deliveries` ON DELETE CASCADE → bare `DELETE FROM persona_messages` is safe.
- Human Review → `persona_manual_reviews` (164). FK child `review_messages` ON DELETE CASCADE → bare `DELETE FROM persona_manual_reviews` is safe.
- Memories → `persona_memories` (735). NO FK children → bare `DELETE FROM persona_memories` is safe.
`PRAGMA foreign_keys = ON` is enforced (db/mod.rs:136) so cascades fire. All 3 are HARD delete (no soft-delete column). The ask is literal "delete all" → `DELETE FROM`.

## Backend (mirror `bulk_resolve_audit_incidents` end-to-end)
Reference chain to copy: command `commands/execution/audit_incidents.rs:178` (`#[tauri::command] require_auth_sync(&state)?` → repo) · repo `db/repos/execution/audit_incidents.rs:467` · registration `lib.rs:1537` · api `src/api/overview/incidents.ts:57`.

For EACH table add a repo fn + a command, returning the deleted-row count:

1. **Messages** — repo in `src-tauri/src/db/repos/communication/messages.rs` (next to `delete` at ~L382):
```rust
pub fn delete_all(pool: &DbPool) -> Result<usize, AppError> {
    let conn = pool.get()?;
    let n = conn.execute("DELETE FROM persona_messages", [])?;
    Ok(n)
}
```
Command in `src-tauri/src/commands/communication/messages.rs` (next to `delete_message` ~L56):
```rust
#[tauri::command]
pub fn delete_all_messages(state: State<'_, AppState>) -> Result<usize, AppError> {
    require_auth_sync(&state)?;
    repo::delete_all(&state.db)   // match how delete_message references the repo + state.db
}
```
(READ `delete_message` live first to copy the EXACT repo path alias + state field + return-type idiom.)

2. **Human Review** — repo in `src-tauri/src/db/repos/communication/manual_reviews.rs` (next to `delete_for_execution` ~L200): `delete_all(pool)` → `DELETE FROM persona_manual_reviews`. Command in `src-tauri/src/commands/design/reviews.rs` (next to `gc_stale_manual_reviews` ~L935): `delete_all_manual_reviews(state)`.

3. **Memories** — repo in `src-tauri/src/db/repos/core/memories.rs` (next to the `crud_delete!` at ~L672): `delete_all(pool)` → `DELETE FROM persona_memories`. Command in `src-tauri/src/commands/core/memories.rs` (next to `delete_memory` ~L126): `delete_all_memories(state)`.

Register all 3 in `src-tauri/src/lib.rs` invoke_handler (next to the existing `delete_message` / `delete_memory` / reviews entries). Then run `node scripts/generate-command-names.mjs` to add them to the CommandName union (`src/lib/commandNames.generated.ts`). Build gate: `cargo build --lib --features desktop --manifest-path src-tauri/Cargo.toml` EXIT 0. Add a unit test per repo fn (insert 2 rows → delete_all → count 0) mirroring the repo's existing test idiom if present.

## API wrappers (mirror `bulkResolveAuditIncidents`)
- `src/api/overview/messages.ts`: `export const deleteAllMessages = () => invoke<number>("delete_all_messages", {});`
- `src/api/overview/reviews.ts`: `export const deleteAllManualReviews = () => invoke<number>("delete_all_manual_reviews", {});`
- `src/api/overview/memories.ts`: `export const deleteAllMemories = () => invoke<number>("delete_all_memories", {});`
(invoke = `invokeWithTimeout as invoke` — match each file's existing import.)

## Frontend — the button + ConfirmDialog (per module)
ConfirmDialog (`src/features/shared/components/feedback/ConfirmDialog.tsx`): props `{ title, body?, danger?, confirmLabel?, cancelLabel?, onConfirm, onCancel }`. NO `isOpen` — render it conditionally on a local `const [confirming, setConfirming] = useState(false)`. Use `danger`.

Pattern per module: a `Trash2` icon button in the header actions cluster (match the inline `<button title={...} className="...">` idiom already there — mirror the existing "Clear stale"/refresh buttons in that header; use a red/destructive treatment like BulkActionBar's `bg-red-500/15 text-red-400 border-red-500/30`). On click → `setConfirming(true)`. ConfirmDialog onConfirm → `await deleteAllX()` → call the module's refresh → `setConfirming(false)` (+ toastCatch on error). Disable/hide the button when the list is empty (count 0).

1. **Messages** — `src/features/overview/sub_messages/components/MessageList.tsx`, header actions ~L226-264 (mount near the refresh button ~L257-262). Refresh after delete: `fetchMessages(true)` + `fetchUnreadMessageCount()` (from `useOverviewStore` / messageSlice). i18n under `overview.messages_view`.
2. **Human Review** — `src/features/overview/sub_manual-review/components/ManualReviewList.tsx`, header actions ~L256-280 (mount in the actions div, e.g. after the "Clear stale" button ~L272). Refresh after delete: `reviewQueue.reload()` (the `useManualReviewQueue` handle already in the component). i18n under `overview.review`.
3. **Memories** — `src/features/overview/sub_memories/components/MemoriesPage.tsx` → the `MemoriesPageBaseline` header actions ~L223-263 (mount in the actions div ~L261). Refresh after delete: `fetchMemories()` (memorySlice). i18n under `overview.memories`. (Baseline is the production variant; only the baseline header is required — note in report if Dense/Graph variants also need it.)

## i18n
Add per-section keys in `src/i18n/locales/en.json`: `delete_all` (button title, e.g. "Delete all"), `delete_all_confirm_title` (e.g. "Delete all messages?"), `delete_all_confirm_body` (e.g. "This permanently deletes all N items. This cannot be undone."), `delete_all_confirm_cta` (e.g. "Delete all"). Put Messages keys under `overview.messages_view`, Human Review under `overview.review`, Memories under `overview.memories`. After editing en.json, regen types (`node scripts/i18n/gen-types.mjs`) so tsc sees them. Translator note in commit: destructive bulk-delete button + confirm, keep short.

## Doc sync
Editing `src/features/overview/**` triggers the doc-sync Stop hook → update `docs/features/overview/README.md` (add a line about the per-module "delete all" affordance) in the same turn, or dismiss if internal.

## Verification gate
- `cargo build --lib --features desktop --manifest-path src-tauri/Cargo.toml` EXIT 0; repo unit tests pass.
- `npx tsc --noEmit` EXIT 0.
- `node scripts/i18n/check-coverage.mjs` no EXTRAS.
- `git show HEAD` greps: 3 commands registered in lib.rs (grep each `delete_all_*` ≥1), 3 api wrappers present, 3 buttons present (grep `deleteAll`/`Trash2` in each module header), commandNames.generated.ts has the 3 names.
- Atomic commits; per-file `git add`; leave leonardo + `docs/test/` untouched; commit messages via heredoc, end with the Co-Authored-By line.
