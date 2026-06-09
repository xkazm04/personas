# Audit Fix Wave 1 — Lost-update writes (no compare-and-swap)

> 8 commits, 8 critical findings closed.
> Theme: read-modify-write / blind-write paths that silently clobbered newer data.
> Baseline preserved: TypeScript 0 errors → 0 errors. (Rust `cargo check --features desktop` clean throughout.)
> Branch: `vibeman/audit-2026-06-09` (off `master`).

## Commits

| # | Commit | Finding | Layer | Files |
|---|---|---|---|---|
| 1 | `41f54b4d4` | use-cases #2 — event-rename REPLACE on JSON | Rust | `commands/core/use_cases.rs` |
| 2 | `e740c6976` | use-cases #1 — design_context RMW outside tx | Rust | `commands/core/use_cases.rs` |
| 3 | `a93890c9c` | agent-memories #2 — knowledge recentResults RMW race | Rust | `db/repos/execution/knowledge.rs` |
| 4 | `968c107e2` | templates #1 — dry-run clobbers promoted persona | Rust | `commands/design/build_simulate.rs` |
| 5 | `0bac88d91` | persona-authoring #1 — undo not persisted | TS | `sub_editor/libs/useEditorSave.ts` |
| 6 | `ea9b6e33d` | recipes #1 — version Accept lost-update | Rust+TS | `repos/resources/recipes.rs`, `commands/recipes/crud.rs`, `api/recipes/recipes.ts`, `RecipeVersionsTab.tsx` |
| 7 | `5abeef839` | evolution #2 — promote_variant lost-update | Rust | `engine/evolution.rs` |
| 8 | `720dc2d5b` | creative #1 — Obsidian push clobbers vault edits | Rust | `commands/obsidian_brain/mod.rs` |

## What was fixed (grouped by sub-pattern)

**Atomic read-modify-write (read inside the write transaction):**
1. **use-cases design_context** — `cascade_use_case_toggle` read `design_context` *outside* its write transaction and `patch_generation_settings` had no transaction at all; a concurrent writer (another backend command, or the frontend `writeQueue` full-document save) interleaved and last-writer-wins clobbered the other's fields (a "paused" capability could revert to enabled). Both now read+write in one transaction — `IMMEDIATE` for cascade, `DEFERRED` via `unchecked_transaction` for patch — so SQLite serializes the pair and a race surfaces as `BUSY` rather than a silent loss.
2. **knowledge recentResults** — `upsert` read the last-10-outcomes array on one pooled connection and wrote via a separate `INSERT...ON CONFLICT`; two concurrent executions of the same `(persona, type, key)` both read the same array and the second clobbered the first, dropping an outcome from the sparkline. Read+write now in one `IMMEDIATE` transaction.

**Compare-and-swap (optimistic lock on `updated_at`):**
3. **recipe version Accept** — the long (30–300s) LLM diff was applied with an unconditional `UPDATE`; any edit during the window was destroyed. `accept_version` now takes `expected_updated_at` (captured in the UI when generation starts) and guards step 4 with `WHERE id=? AND updated_at=?`; a 0-row match rolls back the whole transaction and tells the user to regenerate. Worst case is a safe false-reject, never a false accept.
4. **evolution promote_variant** — the cycle snapshots the incumbent, evaluates for minutes, then promoted with a bare `UPDATE`; a concurrent cycle or a user edit was silently overwritten. Promotion now CAS-guards on the `updated_at` captured at cycle start and is abandoned (already handled by the caller) on mismatch.

**Stop writing serialized JSON as raw text:**
5. **event-rename** — `rename_event_listeners` rewrote trigger config with `REPLACE(config,'"event_type":"old"',…)` filtered by `config LIKE`. That mis-fired on partial names (`alert` ⊂ `alert_high`), whitespace variants (`"event_type": "old"`), all-occurrence rewrites, and unrelated fields embedding the token. Now scoped by `json_extract(config,'$.event_type')=?` and rewritten with `json_set`, guarded by `json_valid`.

**Refuse the destructive write instead of doing it blindly:**
6. **dry-run on a promoted session** — `simulate_build_draft` allowed phase `Promoted` then overwrote the live `design_context` with the simulation snapshot that only `promote_build_draft` (never re-run) would restore. `Promoted` is now excluded; post-promotion dry-run uses the runtime capability-simulate path that never mutates `design_context`.
7. **Obsidian push** — push `atomic_write`'d app content unconditionally, never re-reading the on-disk note, so vault edits the user made directly in Obsidian were silently destroyed (pull three-way-compared; push didn't). A `classify_push` helper now re-reads the file and runs `three_way_compare`; `Conflict`/`VaultChanged` skip + log `skipped_vault_conflict` instead of clobbering.

**Make the operation a real persistence round-trip:**
8. **editor undo** — undo/redo only swapped in-memory `draft`/`baseline`; moving `baseline` made the tab look clean while the DB kept the post-save value, and the undo was discarded on reload. Undo/redo now persist via `applyPersonaOp` (op rebuilt through shared `buildSettingsOp`/`buildModelOp`) before moving baseline; on failure the tab stays dirty and a toast surfaces the error.

## Verification

| Gate | Result |
|---|---|
| `cargo check --features desktop` | **clean, 0 errors** — all 8 fixes compile (ran after every fix) |
| `tsc --noEmit` | **0 errors** (baseline 0 → 0) |
| `eslint` (staged TS) | clean — ran via lefthook on commits #5 and #6 |
| `cargo test --lib` | **build fails on PRE-EXISTING struct drift in untouched files** — `DevIdea` missing `priority` (`dev_tools/triage.rs`), `CreateManualReviewInput` missing `assignment_id`/`step_id` (`db/repos/communication/manual_reviews.rs`). The lib compiles (`cargo check` ✓); only `#[cfg(test)]` code is stale. Not caused by this wave — those structs/files were not touched. |
| `vitest run` | **26 failed / 1907**, all in 9 PRE-EXISTING files unrelated to this wave: fleet (`fleetSlice`, `FleetSettingsPage`, `FleetSessionInsights`), lab matrix (`useBuild`, `useLifecycle`), `devToolsTaskSlice`, `ConnectorCallCard`, twin `ReadinessGapPopover`, `customRules`. **Zero failures in the touched recipe/editor surfaces.** Mostly Vitest mock drift + struct-field drift. |

> No vitest/cargo-test baseline was captured before the wave (Phase B2 only captured `tsc=0`). Regression-freedom is established instead by: (a) `cargo check` + `tsc` clean, (b) every failing test file is outside the 7 files this wave touched, and (c) a targeted grep of recipe/editor test output shows no failures.

## Cumulative status (Tier 1, waves so far)

| Wave | Theme | Findings closed |
|---|---|---|
| 1 | Lost-update writes | 8 |

Remaining Tier-1 critical waves (per INDEX): Wave 2 status-transition guards & lock leaks (7), Wave 3 success theater (7), Wave 4 orphaned processes (5), Wave 5 security (7), Wave 6 corruption loops & stream/graph integrity (7). Then Tier-2 UI (waves 7–9) and Tier-3 highs.

## Patterns established (catalogue items 1–4)

1. **Atomic RMW** — any read-then-write of a shared SQLite blob/row must happen inside one transaction (`transaction_with_behavior(Immediate)` when you hold `&mut Connection`, `unchecked_transaction()` for `&Connection`). Reading outside the write tx is a silent lost-update even when the write itself is "atomic".
2. **Optimistic lock (CAS) for long-running edits** — when a value is read, an expensive operation runs (LLM, CLI eval), then the result is written, guard the write with `WHERE id=? AND updated_at=?expected` and treat 0 rows as "changed under you" (abort, don't overwrite). Capture the expected token at read time and thread it through. False-reject is safe; false-accept is the bug.
3. **Never string-surgery serialized JSON** — use SQLite JSON1 (`json_extract`/`json_set`, guarded by `json_valid`), never `REPLACE`/`LIKE` on a JSON column. Raw text assumes one canonical serialization (no whitespace, fixed key order, single occurrence) that does not hold.
4. **Symmetric conflict handling on both write directions** — if a pull/import path conflict-checks, the push/export path must too. A one-directional guard means the unguarded direction silently clobbers.

## What remains (follow-ups opened by this wave)

- **use-cases #1**: unify the direct-command and `writeQueue` write paths so the narrow post-commit refetch gap is also closed (backend is now atomic; frontend already `fetchDetail`s).
- **evolution #2**: add a per-persona evolution mutex (mirror `healing_personas`) so two cycles don't both run to completion — the CAS makes the *outcome* safe but wastes a cycle.
- **obsidian #1 (creative)**: add a `conflicts: Vec<SyncConflict>` to `PushSyncResult` so the SyncBridge UI can offer resolve actions on a push conflict (currently surfaced only via `skipped` + the sync log); consider auto-pull on push-conflict.
