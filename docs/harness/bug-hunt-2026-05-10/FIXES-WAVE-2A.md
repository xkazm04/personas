# Bug Hunt Fix Wave 2A — Path validation & atomicity (external-integrations)

> 3 commits, 3 critical findings closed.
> Baseline preserved: tsc 0 errors → 0 errors; cargo check clean.
> Single mental model: vault-boundary path safety + crash-safe writes.

## Commits

| # | Commit       | Findings closed                                                | Severity   | Files                                                                   |
|---|--------------|----------------------------------------------------------------|------------|-------------------------------------------------------------------------|
| 1 | `f32554cf0`  | external-integrations #3 (Obsidian read absolute-path bypass)  | critical   | src-tauri/src/commands/obsidian_brain/mod.rs                            |
| 2 | `2dada15af`  | external-integrations #4 (Obsidian non-atomic vault writes)    | critical   | src-tauri/src/commands/obsidian_brain/mod.rs                            |
| 3 | `0b223c389`  | external-integrations #1 (Drive pull filename traversal)       | critical   | src-tauri/src/commands/obsidian_brain/drive.rs                          |

## What was fixed

### 1. Obsidian read sandbox check (Fix 1)

`obsidian_brain_read_vault_note` used `Path::starts_with` on the raw
input — which does string-segment matching only. It did *not*
normalise `..` segments and was case-sensitive on Windows where the
filesystem isn't. Three escape vectors:

- `C:\Users\x\Documents\Vault\..\..\.ssh\id_rsa` *textually* started
  with the vault prefix, so the check accepted it. The actual on-disk
  resolution was outside the vault.
- A case-mismatched but otherwise valid vault path was either
  incorrectly rejected (sometimes) or, with crafted casing, snuck past
  the check.
- A symlink inside the vault pointing at `/etc/passwd` resolved to the
  symlink target on read.

The fix is the standard FS-sandbox shape: reject absolute paths and
`..` segments up front, then `canonicalize()` both `vault_base` and
the joined target and check `starts_with` containment on the
canonicalised pair. Canonicalisation resolves symlinks, normalises
case on Windows, and turns `..` into the real parent — all three
escape vectors closed.

### 2. Obsidian atomic vault writes (Fix 2)

Every vault-touching write (memory push, profile push, connector push,
sync update, conflict resolve, dev-goal push, competition-insight
push — 7 sites in total) used `std::fs::write`, which truncates the
destination first and then streams bytes. A process kill mid-write
left a partial or zero-byte file on disk; because sync state was
recorded *after* the write returned, the corrupted bytes became the
new canonical state. Next pull treats the truncation as authoritative
and either propagates corruption back to the app DB or masks the loss
as "no change".

Fix: an `atomic_write` helper (write to `<path>.tmp`, then atomic
rename to `<path>`) replaces all 7 call sites. POSIX rename and
Windows MoveFileEx-equivalent guarantee the destination either
contains the old bytes or the full new bytes — never a torn write.
On rename failure, the `.tmp` is best-effort cleaned up.

### 3. Drive pull filename traversal (Fix 3)

`obsidian_drive_pull_sync` took `df.name` from the Drive API verbatim
and joined it against `local_folder` via `Path::join`. Drive doesn't
restrict the bytes a filename may contain, and `Path::join` doesn't
normalise `..`. A malicious file shared into the synced folder named
`..\..\..\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\evil.lnk`
resolved to a path outside the vault; the subsequent
`std::fs::write` landed attacker bytes there — arbitrary write
outside the vault, RCE on next Windows login via the Startup folder.

The `obsidian_drive_*` command surface is currently dormant in
`lib.rs`'s invoke_handler, so no production exploit path exists
today. The fix lands the safety check now so future re-enablement
doesn't silently re-introduce the hole.

Fix: `safe_drive_filename()` rejects names that contain `/`, `\`,
`:` (Windows drive/stream syntax), NUL, are absolute, or parse as
anything other than a single `Component::Normal`. Unsafe names land
in `result.errors` so the operator sees the rejection.

## Verification table

| Counter                              | Pre-Wave-2A | Post-Wave-2A | Delta |
|--------------------------------------|------------:|-------------:|------:|
| `cargo check` errors                 |           0 |            0 |   0   |
| `npx tsc --noEmit` errors            |           0 |            0 |   0   |
| Vault writes using `std::fs::write`  |           7 |            0 |  -7   |
| Critical findings closed (cumulative)|           7 |           10 |  +3   |

## Patterns established (additions to the catalogue, items 7-9)

7. **Canonicalise both sides before `starts_with` containment check.**
   `Path::starts_with` on un-canonicalised paths catches only the
   trivially-incorrect case. Real path-traversal exploits use `..`
   segments, symlinks, or Windows case-folding — all of which require
   canonicalisation to detect. The pattern: reject absolute + `..` up
   front, then canonicalise both sides, then `starts_with`. *When it
   bites*: any FS sandbox that accepts a relative-looking path from
   the user (vault notes, attachment names, plugin asset paths,
   configuration include paths, etc.).

8. **Atomic write via temp-file + rename when sync state advances on
   success.** A partial write that records "sync OK" in DB state is
   silent corruption: the next read treats the truncated file as
   authoritative. Pattern: write to `<path>.tmp`, then
   `std::fs::rename` (atomic on same FS). On rename failure, clean up
   the `.tmp` so we don't leave orphans. Most real damage from this
   pattern shows up *after* a crash — testing with kill-9 partway
   through is the only way to catch the bug. *When it bites*: any
   write whose success advances a sync watermark, content hash, or
   "last known good" pointer.

9. **Single-component validation for filenames sourced from external
   APIs.** When a third-party API returns a `name` field that you
   join with a local directory, validate it's a single
   `Component::Normal` (no separators, no NUL, no drive letters, not
   absolute, no `..`). `Path::join` is permissive: an absolute
   second-arg replaces the first, and `..` segments aren't
   normalised. *When it bites*: Drive sync, Dropbox sync, S3 download
   loops, GitHub release-asset fetches, npm tarball extraction
   (zip-slip / tar-slip), email-attachment auto-save.

## Cumulative status (waves 1 + 1B + 2A)

| Wave | Theme                                  | Closed | Notes                                       |
|------|----------------------------------------|-------:|---------------------------------------------|
| 1    | Privileged-IPC auth gates              |      5 |                                             |
| 1B   | TOCTOU + Smee origin allowlist         |      2 |                                             |
| 2A   | Path-handling (external-integrations)  |      3 | Single mental model: vault-boundary safety  |
| **Total** | **Closed in this run**            | **10** | All 10 visited via 3 themed waves           |

Pattern catalogue: 9 items.

## Remaining critical themes (handed off to fresh session)

The remaining ~38 criticals across the INDEX should be tackled in a
fresh conversation to avoid context-budget quality decay. Suggested
next-up by priority:

- **Wave 2B** — Subprocess argv-injection (artist #1, #3 + twin #1 +
  connector-catalog #1). 4 criticals, single mental model: shell-arg
  sanitisation and `--`-separator discipline.
- **Wave 3** — Execution-engine cancel/retry/tick (4 criticals). All
  in `engine/runner.rs` + `scheduler.rs`. Cancellation tokens,
  `MissedTickBehavior::Delay`, watchdog return-value disambiguation.
- **Wave 4** — Idempotency on CRUD & import (5 criticals).
  `confirm_n8n_persona_draft`, `instant_adopt_template`, Studio
  import IDs, `delete_persona`, composition cycle validation.
- **Wave 5** — Save-race in editing surfaces (5 criticals). Pipeline
  Canvas, Persona Editor, Chat & Lab.
- **Wave 6** — Async/concurrency in IPC + chat send + onboarding
  persistence (6 criticals).
- **Wave 7** — Silent-failure observability (10 criticals, paced
  across two sub-sessions).
