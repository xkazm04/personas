# Bug Hunter — creative-productivity-plugins
> Total: 5
> Severity: 1 critical, 3 high, 1 low

## 1. Push-sync overwrites user's vault edits with no conflict check (one-way clobber)
- **Severity**: critical
- **Category**: state-corruption
- **File**: src-tauri/src/commands/obsidian_brain/mod.rs:513-609 (memories); 614-675 (personas); 679-731 (connectors)
- **Scenario**: A persona memory is pushed to the vault, creating `<note>.md` and a sync-state row. The user opens that note in Obsidian and edits it (fixes wording, adds context). Later the app-side memory changes (a run updates it, or the user edits it in the app), so `compute_content_hash(app_md) != stored hash`. They click "Push to vault" (SyncPanel.tsx:99) — or, with `autoSync` enabled (SetupPanel.tsx:62), it fires automatically. Push takes the `existing.vault_file_path` and does `atomic_write(&file_path, md_content)` unconditionally (mod.rs:565), blowing away every edit the user made in Obsidian. The pull path runs a full `three_way_compare` (mod.rs:803) and surfaces conflicts; the push path does not — it only compares app-content-hash vs last-pushed-hash and never reads the current vault file.
- **Root cause**: Conflict detection was implemented on exactly one of the two write directions. Push assumes the vault note is still byte-identical to what was last pushed; it never re-reads the on-disk file to detect that the vault side moved. The hash gate (`es.content_hash == new_hash`) only suppresses redundant writes — it provides zero protection against a diverged vault file.
- **Impact**: data loss — silent, irreversible destruction of user edits made directly in their Obsidian vault, the exact "clobbering user edits (no conflict handling)" failure mode this surface must avoid. Reported as success ("Push: N updated") — success theater over data loss.
- **Fix sketch**: Make every vault write go through one mediator that reads the current on-disk file first and runs `three_way_compare(base=stored_hash, app=new_md, vault=current_file)`. Push then becomes symmetric with pull: `AppChanged`→write, `VaultChanged`→skip+warn (or pull), `Conflict`→emit a `SyncConflict` into the result instead of overwriting. Reuse the existing `conflict::three_way_compare` and `result.conflicts` plumbing.

## 2. Daily-note / meeting-note authoring corrupts files and loses concurrent appends (non-atomic read-modify-write)
- **Severity**: high
- **Category**: race-condition
- **File**: src-tauri/src/commands/obsidian_brain/graph.rs:501-523 (append_daily_note); 588 (write_meeting_note)
- **Scenario**: `obsidian_graph_append_daily_note` is a registered connector tool (lib.rs:2418; builtin_connectors.rs), so multiple personas can invoke it concurrently. It does `read_to_string` → mutate string in memory → `std::fs::write` (graph.rs:501→522). Two appends interleave: both read the same base, both append their own line, the second write overwrites the first — the first persona's journal entry vanishes. Separately, `std::fs::write` truncates-then-streams, so a crash/kill mid-write leaves a truncated or empty daily note (the rest of the day's journal gone). `write_meeting_note` (graph.rs:588) additionally never checks for an existing file: two meetings titled the same on the same day produce identical `YYYY-MM-DD - title.md` and the second silently overwrites the first.
- **Root cause**: The sync layer added `atomic_write` (mod.rs:59) specifically to avoid torn writes, but the graph authoring commands were written independently with raw `std::fs::write` and no read/modify/write serialization or collision check.
- **Impact**: data loss + corruption of user-authored vault notes.
- **Fix sketch**: Route these writes through the same `atomic_write` (temp+rename) used by sync, and serialize per-file mutation behind a path-keyed mutex (or append via `OpenOptions::append` instead of read-rewrite). For meeting notes, disambiguate on collision with a numeric suffix like `vault_note_filename` already does, instead of overwriting.

## 3. Google Drive pull clobbers local vault files with no conflict detection (and torn writes)
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/commands/obsidian_brain/drive.rs:626-645
- **Scenario**: `pull_from_drive` only skips a download when the local file's hash equals the manifest entry (drive.rs:630-635). On the very first pull (manifest empty) or whenever a local edit hasn't been pushed, the local hash won't match the manifest, so it falls through to `std::fs::write(&local_path, &content)` (drive.rs:642), overwriting whatever the user has locally with the Drive copy — no three-way compare, unlike the local-vault pull. The write is also non-atomic, so a crash mid-pull truncates the local note.
- **Root cause**: Cloud sync reused the local sync's hash-gating idea but dropped the three-way merge; "local hash != manifest hash" is treated as "stale, download" rather than "local diverged, possible conflict." Module is currently dormant (`#![allow(dead_code)]`, commands unwired in lib.rs), which is the only reason this isn't critical — but it ships behind a "free Obsidian cloud sync" feature that will be turned on.
- **Impact**: data loss when the feature is enabled — local edits overwritten by an older/other-device Drive copy.
- **Fix sketch**: Before activating, give pull the same `three_way_compare` treatment (base = manifest hash, local = on-disk, remote = downloaded) and surface conflicts instead of writing; switch the local write to atomic temp+rename.

## 4. Claude-CLI OCR has no timeout or cancellation — a stuck CLI hangs the operation indefinitely
- **Severity**: high
- **Category**: resource-leak
- **File**: src-tauri/src/commands/ocr/mod.rs:575-617 (run_claude_ocr); 420-470 (callers)
- **Scenario**: The Gemini OCR core registers a `CancellationToken` and wraps the request in `tokio::select!` so the UI can cancel and so a hung request resolves (mod.rs:233-272). The Claude-CLI core has neither: it spawns the CLI, writes base64 to stdin, then `child.wait_with_output().await` (mod.rs:614) with no timeout and ignores any `operation_id`. If the Claude binary hangs (network stall, auth prompt, huge PDF), the await never returns. `cancel_ocr_operation` can't help — the Claude path never registers a token. The spawned child also isn't `kill_on_drop`, so even dropping the future leaves the process running. Compare the creative-session CLI path, which uses a 600s `tokio::time::timeout` and `kill_on_drop(true)` (artist/mod.rs:588,649).
- **Root cause**: The two OCR backends were given different lifecycle guarantees; the CLI variant (added later) skipped the timeout/cancel/kill-on-drop that the HTTP variant has.
- **Impact**: UX degradation — "Extract text" spins forever with no cancel; an orphaned `claude` process leaks per stuck call.
- **Fix sketch**: Wrap the spawn+wait in `tokio::time::timeout`, set `.kill_on_drop(true)`, and thread `operation_id` through `run_claude_ocr` so it registers a `CancelGuard` in the shared `OCR_CANCEL_TOKENS` registry like the Gemini path.

## 5. Goal-tree frontmatter built with unescaped string interpolation (YAML round-trip breakage)
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/commands/obsidian_brain/mod.rs:1429-1441 (goal_to_markdown); graph.rs:568-574 (meeting note); also push_competition_insight_to_vault mod.rs:1778-1797
- **Scenario**: `goal_to_markdown` emits frontmatter via `format!("status: \"{}\"\n", goal.status)` etc., and a goal title/description containing a `"` or newline produces malformed YAML (e.g. a target_date or status field is fine, but the same raw-interpolation pattern is used for user-controlled `project_id`/dates and the meeting-note `title`/`attendees` only do `.replace('"', "'")`, which still breaks on `\n`, `\\`, or `:` inside a value). The codebase already solved this exact bug for memory/persona/connector frontmatter with `yaml_quote` (markdown.rs:17, with round-trip tests), but the goal/meeting/competition emitters bypass it.
- **Root cause**: A correct YAML-escaping helper (`yaml_quote`) exists and is enforced in the `*_to_markdown` family, but three newer emitters hand-roll `"{}"` interpolation and don't call it — the guarantee isn't centralized at the only place frontmatter is produced.
- **Impact**: corruption of generated note frontmatter for edge-case titles; downstream `extract_yaml_field` mis-parses, breaking pull-side field extraction.
- **Fix sketch**: Replace every hand-rolled `"{}"` frontmatter line in goal/meeting/competition emitters with `yaml_quote(value)` so all frontmatter goes through the one escaper that has round-trip tests.
