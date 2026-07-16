# Companion Brain & Proactivity — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Budget-orphaned trigger nudges are stranded in `queued` forever and permanently dedupe-block their trigger
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/companion/proactive/mod.rs:123-133 (with :186-231, :303-312)
- **Scenario**: During an evaluation pass, `enqueue_if_new` inserts a nudge row as `queued`, then `budget.try_consume` fails (global ceiling or per-kind cap consumed — trivially reachable on a busy day, or by a concurrent pass taking the last unit). The loop `break`s, leaving the row `queued` with `scheduled_for = NULL`. The same happens when `mark_delivered` errors in `companion_evaluate_proactive_now` (proactive.rs:69 warns and moves on).
- **Root cause**: The comment says "leave the row queued and stop", assuming a later tick will release it — but no code path ever delivers non-scheduled `queued` rows. `deliver_due_scheduled` filters `scheduled_for IS NOT NULL`; the next `evaluate` pass hits the dedupe guard (`status IN ('queued','delivered')`) and returns `None`; the opportunistic expiry sweep only ages `delivered` rows; the retention prune skips `queued`.
- **Impact**: The nudge is never delivered (no Tauri event, no `delivered_at`), and because the `queued` row never expires, every future nudge for that `(trigger_kind, trigger_ref)` — e.g. "goal target approaching" for that goal — is dedupe-suppressed **forever**. Silent, permanent loss of a proactivity channel per affected trigger.
- **Fix sketch**: On `try_consume == false`, delete the just-inserted row (budget wasn't spent, so nothing is lost), or add a sweep that re-releases non-scheduled `queued` rows on later ticks. Also extend the expiry sweep to age stale `queued` rows with `scheduled_for IS NULL`.

## 2. Check-then-insert dedupe race lets concurrent passes create duplicate nudges
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/companion/proactive/mod.rs:186-219
- **Scenario**: The 5-minute scheduler tick runs `evaluate_with_extra_candidates` at the same moment the user clicks the UI's "evaluate now" debug button (or `enqueue_external` fires from the fleet reconciler / boot-time dev recovery in dev_mode.rs:481 for the same ref). Both connections execute the dedupe `SELECT` before either `INSERT` lands.
- **Root cause**: Dedupe is a non-atomic SELECT-then-INSERT across separate pooled connections, and `companion_proactive_message` has no UNIQUE index over `(trigger_kind, trigger_ref)`-while-unresolved. The budget claim was made atomic (bug-hunt 2026-06-07 #2) but the dedupe guard beside it was not.
- **Impact**: The user gets the same "Athena reached out" card twice (two rows, two events); resolving one leaves the twin unresolved, which then blocks re-nudging (compounding finding 1) and skews engagement-modulation stats.
- **Fix sketch**: Create a partial unique index `ON companion_proactive_message(trigger_kind, COALESCE(trigger_ref,'')) WHERE status IN ('queued','delivered')` and turn the INSERT into `INSERT ... ON CONFLICT DO NOTHING`, treating 0 rows changed as the dedupe hit.

## 3. Project registry path normalization produces `\\?\` verbatim paths and a baked-in build-machine seed path
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/companion/projects.rs:101-103, 154-168
- **Scenario**: (a) User registers `C:\repos\myapp` — `std::fs::canonicalize` on Windows returns the verbatim form `\\?\C:\repos\myapp`, which is stored, shown in the UI, and handed to scanners/CLI tools (several of which choke on the `\\?\` prefix). If the same directory was ever stored in the non-verbatim form (a row written before this normalization, or via the lexical fallback when the path didn't exist yet), `ON CONFLICT(path)` doesn't match and the repo registers twice — exactly the drift the normalization was meant to prevent. (b) On any install where the binary wasn't built on the user's machine, `seed_default_project` seeds `env!("CARGO_MANIFEST_DIR")`'s parent — a compile-time path from the build machine that doesn't exist locally, so canonicalize fails and a phantom "Personas" project pointing at a nonexistent directory is created (and its auto-subscription).
- **Root cause**: Assumes `fs::canonicalize` output is a stable, comparable, tool-friendly representation (on Windows it's UNC-verbatim), and that compile-time and runtime filesystems are the same machine.
- **Impact**: Duplicate/phantom project rows, duplicate tracking subscriptions, ugly `\\?\` paths in Dev Tools, and scans that fail against the seeded default project.
- **Fix sketch**: Strip the `\\?\` prefix after canonicalize (e.g. `dunce::canonicalize` or manual trim) and normalize casing consistently; skip `seed_default_project` (or verify `path.exists()`) when the compile-time repo root is absent at runtime.

## 4. Identity save/delete failure replaces the editor with a dead-end error panel, losing the user's draft
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/plugins/companion/BrainViewer.tsx:550-570 (render gate at :564)
- **Scenario**: User opens Identity → Edit, rewrites their self-model in the textarea, hits Save while `companion_save_identity` fails (file locked by an editor, disk error). `handleSave`'s catch sets `error`, and the component's `if (error) return <error card>` renders **instead of** the entire detail view — textarea, Save/Cancel bar, everything.
- **Root cause**: One terminal `error` state is shared by load, delete, and save failures; it was designed for "detail failed to load" but also fires mid-edit, and it offers no retry/back affordance.
- **Impact**: The user's unsaved identity rewrite becomes unreachable (the draft state still exists but nothing renders it); the only way out is navigating away, which unmounts and discards the draft. Delete failures similarly nuke a perfectly viewable detail. This is the app's single user-editable brain file — data-entry loss on the highest-trust surface.
- **Fix sketch**: Keep save/delete errors as an inline dismissible banner (toast or alert strip above the footer) while preserving the current view and draft; reserve the full-pane error state for the initial `companionGetBrainItem` load failure, and give it a Retry button.

## 5. TypesView counts are capped-list lies and fire ~13 full list IPCs (episodes = 200 disk reads) just to render numbers
- **Severity**: Low
- **Category**: ui
- **File**: src/features/plugins/companion/BrainViewer.tsx:260-273 (backend: src-tauri/src/commands/companion/brain.rs:266-307)
- **Scenario**: User opens the Brain root view on a mature install with 1,400 episodes and 800 facts. Each card's count comes from `companionListBrainItems(kind).length`, but the backend caps lists (episodes/goals/backlog 200, facts/procedurals 500) — so the cards permanently read "200 items" / "500 items" no matter how much memory actually exists. Meanwhile every visit to the root view runs 13 full list queries, and `list_episodes` additionally does one `fs::read_to_string` per row (200 file reads) solely to derive a role label the counts never use.
- **Root cause**: Reuses the list endpoint as a count endpoint; the cap that is fine for a scrollable list silently truncates when repurposed as a total, and the per-row frontmatter read is wasted work for counting.
- **Impact**: Misleading inventory numbers exactly when the brain grows large (the moment counts matter), plus a noticeable I/O burst on every Brain root render.
- **Fix sketch**: Add a `companion_count_brain_items` command (one `SELECT kind, COUNT(*)` pass over the backing tables) and use it in TypesView; render "200+" if a capped list must remain the source.
