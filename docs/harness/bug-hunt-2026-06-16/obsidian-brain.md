# Bug Hunter — Obsidian Brain

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: obsidian-brain | Group: First-Party Plugins

## 1. Graph commands accept absolute paths and the containment guard silently disables itself on canonicalize failure
- **Severity**: Critical
- **Category**: Trust boundary / path traversal (silent guard bypass)
- **File**: `src-tauri/src/commands/obsidian_brain/graph.rs:236` (guard) + `:300`, `:342` (callers)
- **Scenario**: `obsidian_graph_outgoing_links(note_path)` and `obsidian_graph_backlinks(note_path)` take a caller-supplied path and pass it through `ensure_within_vault` before `std::fs::read_to_string`. The guard is:
  ```rust
  let canonical_root = vault_root.canonicalize().unwrap_or(vault_root.to_path_buf());
  let canonical_target = target.canonicalize().unwrap_or(target.to_path_buf());
  if !canonical_target.starts_with(&canonical_root) { return Err(...) }
  ```
  Two defects compound. (a) On Windows `canonicalize()` yields a `\\?\` verbatim prefix; if the root canonicalizes but the target does not (or vice-versa), the `unwrap_or` falls back to the *non-canonical* path and `starts_with` compares a `\\?\C:\vault` root against a `C:\vault\..\..\secret` target — mismatched prefixes make containment checks unreliable and `..` is never normalized in the fallback branch. (b) Unlike `resolve_vault_subpath` in `mod.rs` (which rejects absolute paths and `..` segments outright), this guard does neither — it relies entirely on canonicalize+prefix, which it then makes optional via `unwrap_or`. A caller passing an absolute path to a sibling vault, or a path whose canonicalize fails for any transient reason, can read arbitrary files. The frontend already routes absolute filesystem paths back into these commands (search/orphan/MOC results expose `n.path.to_string_lossy()` — the absolute path — and `GraphPanel` feeds them to `openNoteInObsidian` and link lookups), so absolute input is the *normal* path, not an attack-only edge.
- **Root cause**: `unwrap_or(<original path>)` turns a canonicalization failure into a guard *bypass* instead of a rejection, and the guard omits the explicit absolute/`..` rejection that the hardened `resolve_vault_subpath` sibling has. The two path-validation implementations diverged.
- **Impact**: Arbitrary file read outside the vault (any `.md`/text file the process can read) via a crafted `note_path`, and unreliable containment on Windows even for benign input. This is exactly the "guard diverged between siblings" class the team fixed once in `mod.rs` (bug-hunt 2026-06-07 #2) but never back-ported to `graph.rs`.
- **Fix sketch**: Delete `ensure_within_vault` and route every graph command's caller path through the shared `resolve_vault_subpath(vault_base, Some(rel))`. Make canonicalize failure a hard error (never `unwrap_or` to the raw path). Have graph results return vault-*relative* paths so the round-trip never carries absolute paths.

## 2. Daily-note / meeting-note writers are non-atomic with a read-modify-write race
- **Severity**: High
- **Category**: Race condition / latent data loss
- **File**: `src-tauri/src/commands/obsidian_brain/graph.rs:497`, `:501`, `:522` (append_daily_note); `:588` (write_meeting_note)
- **Scenario**: `obsidian_graph_append_daily_note` does `read_to_string(file)` → mutate string in memory → `std::fs::write(file, ...)`. Between the read and the write the user (or Obsidian's own sync, or a second concurrent append from another app surface) can write the same daily note; that intervening edit is silently overwritten by the stale in-memory copy. Worse, `std::fs::write` truncates-then-streams, so a crash/OOM/taskkill mid-write leaves a truncated or zero-byte daily note — destroying the entire day's journal. The mirror path in `mod.rs` was deliberately rewritten to use `atomic_write` (temp+rename) precisely to prevent this, but the graph writers were never migrated.
- **Root cause**: Two un-synchronized writers to the same file with no lock and no atomic replace; `std::fs::write` used directly instead of the existing `atomic_write` helper.
- **Impact**: Lost journal/meeting content under concurrent edits or external Obsidian activity; full-file corruption on a mid-write kill. High-value user data (free-form notes) with no recovery.
- **Fix sketch**: Use the `atomic_write` helper for the final replace. For append semantics, re-read immediately before the rename and reject/retry if the on-disk content changed since the read (compare a hash), or hold a per-vault write lock for the read-modify-write critical section.

## 3. Drive pull overwrites local edits with no conflict check and skips all nested folders
- **Severity**: High
- **Category**: Silent failure / data loss + incomplete sync
- **File**: `src-tauri/src/commands/obsidian_brain/drive.rs:604` (subfolder skip), `:627`-`:645` (overwrite + non-atomic write)
- **Scenario**: `pull_from_drive` downloads each Drive file and, whenever the local content hash differs from the manifest, calls `std::fs::write(&local_path, &content)` — blindly clobbering the local copy. The local sync engine (`obsidian_brain_pull_sync`) carefully does a three-way compare and refuses to overwrite divergent edits; the Drive pull path does none of that. If the user edited a note locally since the last Drive sync, those edits are destroyed with no conflict surfaced. Separately, `if df.mime_type == "...folder" { continue; }` skips every subdirectory ("Skip subdirectories for now"), so any note not at the top level of a synced folder is *never* downloaded — a silent partial sync that the result counters report as success (the missing files simply don't appear). The non-atomic `std::fs::write` also re-introduces the torn-write corruption that `atomic_write` exists to prevent.
- **Root cause**: Drive pull treats Drive as authoritative and local as disposable (last-writer-wins toward Drive), bypassing the three-way conflict machinery; recursive descent was stubbed out and never implemented; atomic write not used.
- **Impact**: Local note edits silently lost on pull; entire nested-folder hierarchies silently never synced while the UI reports a clean sync. (The Drive commands are currently unwired in `lib.rs`, so this is latent — but it ships the moment the feature is enabled.)
- **Fix sketch**: Run the same `three_way_compare` against the manifest's last-synced hash before overwriting; surface conflicts instead of clobbering. Recurse into Drive subfolders (mirror the local `walk_dir_recursive`). Replace `std::fs::write` with `atomic_write`.

## 4. Every graph operation re-walks and reads the entire vault into memory, with no size cap, on the UI's critical path
- **Severity**: Medium
- **Category**: Latent failure / huge-vault freeze
- **File**: `src-tauri/src/commands/obsidian_brain/graph.rs:96` (`walk_vault`) + all callers (`:272`, `:313`, `:362`, `:387`, `:419`, `:440`)
- **Scenario**: `walk_vault` recursively reads the full text of *every* `.md` file (`read_to_string`) into a `Vec<NoteEntry>` on each invocation, and TF-IDF (`tfidf_scores`) tokenizes every document body again per search. `obsidian_graph_outgoing_links`/`backlinks` walk the entire vault just to resolve a single note's links. `GraphPanel` fires `obsidianGraphStats` + `obsidianGraphListOrphans` + `obsidianGraphListMocs` in parallel on mount (three full walks) and repeats the stats walk on every debounced `vault-changed` event. For a real Obsidian vault (10k+ notes, hundreds of MB), this loads the whole corpus into RAM and saturates a thread on every interaction; the graph commands are synchronous `#[tauri::command] fn` (not async), so they block. No cap on note count or file size exists.
- **Root cause**: "Phase 1 deliberately keeps it simple" full-rescan model with no caching, no index, no file-size/count ceiling, invoked redundantly from the UI and the file-watcher callback.
- **Impact**: UI jank to multi-second freezes on medium vaults; potential OOM / unresponsive plugin on large vaults. A single malformed/huge `.md` (e.g. a multi-GB file) is read wholesale into a `String`.
- **Fix sketch**: Build the note index once and cache it (invalidate on the watcher event), cap per-file read size and total note count, and run the walk off the command thread (async/`spawn_blocking`). Have the UI request stats/orphans/MOCs from one shared cached walk rather than three.

## 5. test_connection note count is shallow and availability ignores a deleted vault — success theater
- **Severity**: Low
- **Category**: Silent failure / success theater (stale state)
- **File**: `src-tauri/src/commands/obsidian_brain/mod.rs:155`-`176` (shallow count), `:260`-`274` (`resolve_availability`); also `:1636` (goal sync stores absolute path)
- **Scenario**: `obsidian_brain_test_connection` counts `.md` files only at the top level and exactly one directory deep ("non-recursive for speed"), so a vault that organizes notes under nested folders reports a misleadingly low `note_count` (often 0) even though connection succeeded — the user sees "valid: true, 0 notes" and assumes the vault is empty/broken. Separately, `resolve_availability` returns `available: true` whenever a non-empty `vault_path` string is stored, with no existence check — so a vault that was moved or deleted on disk still reports the integration as available; the failure only surfaces later as a sync error. Tangentially, `obsidian_brain_push_goals` stores `vault_file_path: file_path.to_string_lossy()` — the *absolute* path — whereas every other sync entity stores a vault-relative path; this breaks portability (moving the vault orphans goal sync state) and is inconsistent with the relative-path contract the pull/Drive layers assume.
- **Root cause**: Counting heuristic capped at depth 1 for speed; availability resolves from config presence, not filesystem reality; goal sync omitted the `strip_prefix(vault_base)` relativization every other writer performs.
- **Impact**: Misleading connection feedback (looks empty/broken when it isn't), integration advertised as available against a vanished vault, and goal sync state that can't survive a vault move.
- **Fix sketch**: Make the count recursive (or label it "approx, top-level only"); add a lightweight `path.exists()` check to `resolve_availability` (or expose a separate "configured but missing" state); relativize the goal `vault_file_path` via `strip_prefix(vault_base)` like the memory/persona writers.
