# Test Mastery — Google Drive
> Total: 8 findings (1 critical, 4 high, 2 medium, 1 low)

## 1. drive_copy / drive_move overwrite-guards & "folder inside itself" have no test
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/drive.rs:1187-1284 (drive_move, drive_copy), 1019-1107 (drive_delete / move_to_trash)
- **Current test state**: none (the `#[cfg(test)] mod tests` at :1449 only covers `resolve_safe`, `rel_path_targets_root`, `validate_basename` — none of the mutating commands)
- **Scenario**: A persona export or a UI paste targets an existing path. The `if dst.exists()` guard in `drive_copy` (:1243) and `drive_move` (:1199) is the only thing standing between "safe paste" and "irrecoverably overwrite a user's file" — the comment at :1239-1242 explicitly records this was a real data-loss bug (a destination file was overwritten in place, not even soft-deleted, while a success toast fired). The "cannot move/copy a folder inside itself" guards (:1209, :1254) prevent an infinite recursive copy. None of these are tested, so a refactor that reorders the `exists()` check after `std::fs::copy`, or drops the `starts_with(&src)` self-containment check, silently reintroduces destructive overwrite / runaway recursion with green CI.
- **Root cause**: The Rust test module was seeded only with the path-sandboxing helpers; the actual filesystem-mutating commands were never exercised because they take an `AppHandle`. But the core logic (overwrite refusal, self-containment) is reachable by factoring the guard into a pure helper or by testing through a temp-root harness that bypasses `managed_root`.
- **Impact**: Silent, unrecoverable user/agent data loss on paste-over-existing; or a folder-into-itself copy that fills the disk. This is the highest-blast-radius regression in the context.
- **Fix sketch**: Add Rust integration tests against a `temp_root()` (the helper already exists at :1454): (a) copy/move onto an existing dst returns `Validation` and leaves the original byte-for-byte intact; (b) move/copy a folder into its own descendant returns `Validation`; (c) a successful copy duplicates content and leaves src intact. Assert the *business invariant* "no mutating op ever overwrites or loses existing bytes without an explicit destination-clear" — not just the return type.

## 2. drive_delete soft-delete → trash → hard-delete lifecycle is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/drive.rs:1019-1064 (drive_delete), 1082-1107 (move_to_trash), 1113-1150 (purge_old_trash)
- **Current test state**: none (only `rel_path_targets_root` is tested, which is the *guard*, not the delete behavior)
- **Scenario**: `drive_delete` is a two-stage recycle bin: first delete moves an item to `.trash/<stamp>-<name>`; a second delete of an item already in `.trash` hard-deletes it (`path_lives_in_trash`, :1069). `move_to_trash` disambiguates same-second collisions with a numeric suffix (:1094-1104) so a double-delete of two same-named files doesn't clobber the first one's trash entry. `purge_old_trash` parses the timestamp prefix and only purges entries strictly older than 7 days, and refuses to purge a hand-placed file whose name doesn't match the stamp format (:1127-1133). All untested. A regression in the collision counter, the trash-detection segment split, or the stamp parser turns "recoverable delete" into "permanent delete" or "purge an arbitrary user file."
- **Root cause**: Same as #1 — mutating commands skipped because of `AppHandle`; the trash helpers (`move_to_trash`, `purge_old_trash`, `path_lives_in_trash`) are free functions and directly testable against a temp root.
- **Impact**: A user trusts the trash to be recoverable for 7 days; a silent regression makes deletes permanent or purges the wrong files.
- **Fix sketch**: Temp-root tests: (a) deleting a file moves it under `.trash/` with the original name as suffix and leaves it readable; (b) two same-second deletes of identically-named files produce two distinct trash entries (collision counter); (c) `purge_old_trash` deletes an entry stamped 8 days ago and keeps one stamped today; (d) a non-stamped file in `.trash` is never purged. `path_lives_in_trash` is a pure-string LLM-generatable batch (invariant: only a first segment of exactly `.trash` counts).

## 3. resolve_safe symlink-escape branch (the not-yet-existing tail) is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/drive.rs:396-454 (resolve_safe, symlink probe at :406-419)
- **Current test state**: exists-but-weak — :1461-1486 cover absolute-path / `..` / nested-new / empty-root, but **not** the symlink-traversal rejection, which the code comment (:399-405) flags as a previously-exploited escape (bug-hunt 2026-06-07 creative #3).
- **Scenario**: The dangerous case is a path whose final (not-yet-existing) component sits behind a symlink that points outside the managed root — the textual `starts_with(root)` check would pass, so the explicit `symlink_metadata` probe (:410-417) is the *only* defence. There is no test that creates a symlink inside the root pointing outside and asserts `resolve_safe` returns `Forbidden`. A refactor of the ancestor-walk loop can quietly remove this defence and every existing sandbox test still passes.
- **Root cause**: The original tests were written for the textual-traversal cases; the symlink branch was added later as a security fix without a regression test pinning it.
- **Impact**: Sandbox escape — an agent (or prompt-injected tool call) could read/write outside the managed drive (e.g. `~/.ssh`), defeating the plugin's core security boundary.
- **Fix sketch**: Unix-gated test (`#[cfg(unix)]`): inside a temp root, `std::os::unix::fs::symlink("/etc", root.join("evil"))`, then assert `resolve_safe(&root, "evil/passwd")` returns `Err(Forbidden)`. Add a positive control: a symlink *within* the root behaves per policy. Invariant: no resolved path may traverse a symlink.

## 4. google_oauth credential resolution (compile-time → env → .env precedence) has zero tests
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/google_oauth.rs:5-152 (env_var_first_nonempty, dotenv_var_first_nonempty, resolve_env_value, resolve_google_desktop_oauth_credentials)
- **Current test state**: none
- **Scenario**: This module resolves the Google OAuth client ID/secret that gate *all* Drive/Google connector auth (initial authorization + token refresh, per the error text at :91-99). The precedence — compile-time embed, then runtime env, then `.env` file — and the Desktop-then-Web fallback (:112-131) are pure, deterministic, and security-relevant. `env_var_first_nonempty` must skip empty/whitespace-only values (:8-12); `dotenv_var_first_nonempty` strips surrounding quotes and `#` comments (:30-40). A regression that returns a blank secret, picks the wrong key precedence, or fails to trim quotes produces silent `redirect_uri_mismatch`/auth failures that are hard to diagnose in the field.
- **Root cause**: Env/dotenv parsing is awkward to test because of global process env, but the `.env` parser takes a path-relative read and `env_var_first_nonempty`/`resolve_env_value` are pure given their key list — they can be tested with scoped env mutation (serialized) or by extracting the line-parse into a `parse_dotenv(&str)` helper.
- **Impact**: Broken Google OAuth = the entire Drive plugin's external-account integration silently fails; mis-resolved secrets are a credential-handling correctness risk.
- **Fix sketch**: Refactor the `.env` line loop into a pure `parse_dotenv(content: &str) -> HashMap` and test: comment lines skipped, `KEY="quoted"` and `KEY='quoted'` unquoted, whitespace trimmed, blank values not returned, first-nonempty-key-wins ordering. For `resolve_google_desktop_oauth_credentials`, a serial test with `std::env` set/unset asserting Desktop creds beat Web creds and that a missing pair returns `Validation`.

## 5. designTokens pure helpers (visualForEntry / trashEntryInfo / kindBucketWeight) — LLM-generatable batch, currently untested
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/plugins/drive/designTokens.ts:227-253 (visualForEntry), :329-340 (trashEntryInfo), :182-184 (kindBucketWeight), :266-311 (formatRelativeTime)
- **Current test state**: none (drive plugin has 0 TS tests; repo otherwise has 189 test files and a clear `__tests__/` convention)
- **Scenario**: These are the classic high-value pure-function targets. `visualForEntry` maps mime/extension → file-kind bucket; its ordering matters (`.sig.json` must win over `json`→data; `image/` before generic) — a reorder of the if-chain silently re-buckets files and breaks the sort-by-kind grouping and the OCR-eligibility-adjacent visuals. `trashEntryInfo` parses the backend's `<stamp>[-counter]-<name>` trash-name format into the original name + purge epoch — it MUST stay in lockstep with the Rust `move_to_trash` format (:1090-1097 in drive.rs); a drift means the trash UI shows mangled names and wrong purge countdowns. `kindBucketWeight` is a total ordering. All are deterministic and trivial to batch-test.
- **Root cause**: The plugin shipped without unit tests; these helpers look "obvious" so were skipped, but each encodes a cross-boundary contract (TS trash-name regex ↔ Rust trash-name format).
- **Impact**: Mis-bucketed file types, wrong/garbled trash display, broken purge countdown — UX-visible and a TS/Rust contract that can drift undetected.
- **Fix sketch**: LLM-generatable `designTokens.test.ts`. Invariants to assert (not snapshots): (a) `.sig`/`.sig.json` → signature regardless of mime; (b) `image/png` → image, `application/pdf` → pdf, `application/json` → data, `text/csv` → sheet, unknown → generic; (c) `trashEntryInfo("20260101T120000-report.pdf")` returns `originalName: "report.pdf"` and `purgeAt === Date.UTC(2026,0,1,12,0,0) + TRASH_TTL_MS`, and the counter form `...T120000-2-report.pdf` strips the counter; (d) a non-stamped name passes through with `purgeAt: null`. Add a guard test pinning `TRASH_TTL_MS === 7*24*60*60*1000` so the TS side can't silently diverge from Rust's `TRASH_TTL_SECS`.

## 6. api/drive.ts client-side path validators (validateRelPath / validateNonRootRelPath / validateRenameTarget) untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/api/drive.ts:11-56
- **Current test state**: none
- **Scenario**: These validators are explicitly described (comments :1-9, :36-39) as the *first-line trust boundary* against prompt-injected persona tool calls — they must throw before a bad path crosses IPC, independent of the backend's policy. They reject NUL bytes, absolute paths, drive letters (`C:`), `..` segments, over-length, and (for delete) any root-addressing path. They are pure string functions, perfectly LLM-generatable, and security-relevant — yet have no test, so loosening a regex (e.g. dropping the drive-letter check) would silently widen the attack surface with green CI.
- **Root cause**: Validators were added inline with the API wrappers and never given a dedicated test file; the rest of `src/api/__tests__/` tests IPC-call shape, not input validation.
- **Impact**: A regression in the client-side guard removes defence-in-depth against path traversal / sandbox escape from a compromised/injected agent.
- **Fix sketch**: LLM-generatable `src/api/__tests__/drive.test.ts`. Assert each validator *throws* on: `"\0"`, `"/etc/passwd"`, `"C:\\x"`, `"a/../b"`, a 1025-char string; and *accepts* `""` (root), `"a/b.txt"`, `"a\\b.txt"`. For `validateNonRootRelPath` assert it throws on `""`, `"."`, `"./."`, `".\\."` and accepts `"foo"`. For `validateRenameTarget` assert it rejects names with `/`, `\`, NUL, and empty. Pair a couple of happy-path IPC tests (mockInvoke convention from `credentials.test.ts`) so `driveDelete` is shown to route through `validateNonRootRelPath`.

## 7. isOcrEligible OCR gate is untested (drives a billable Gemini call surface)
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/plugins/drive/ocr/useOcr.ts:58-63 (isOcrEligible); also geminiCredential most-recent selection :35-42
- **Current test state**: none
- **Scenario**: `isOcrEligible` decides whether the "Extract text" affordance appears (DriveContextMenu :207, DriveDetailsPane :227) and therefore whether a user can trigger the Gemini OCR IPC (`ocrDriveFileGemini`, a 180s billable call). It accepts image mimes, `application/pdf`, and a fixed extension allowlist. A regression that accepts, say, `text/plain` would surface OCR on files it can't process (wasted/failed Gemini calls); one that drops `tiff` silently removes a capability. The `geminiCredential` selection (:38-42) deterministically prefers the most-recently-updated credential — important when a user has personal+work keys — and is also untested.
- **Root cause**: Hook + helper shipped without tests; the eligibility predicate looks trivial but gates a paid external call.
- **Impact**: Wrong OCR affordance → failed/wasted billable Gemini calls or a silently-lost capability; nondeterministic credential pick if the sort regresses.
- **Fix sketch**: LLM-generatable test for `isOcrEligible`: true for `image/png`, `application/pdf`, ext `tiff`/`jpeg`; false for `text/plain`, `application/json`, null/empty. Optional: extract the most-recent-credential sort into a pure helper and assert it picks the newest `updatedAt` and is stable on ties.

## 8. No per-area quality gate / coverage floor on the drive sandbox + validators
- **Severity**: low
- **Category**: quality-gate
- **File**: vitest.config.ts:10-18 (no coverage thresholds); src-tauri/src/commands/drive.rs (security-critical, partially tested)
- **Current test state**: n/a (no gate exists)
- **Scenario**: The drive path-sandbox (`resolve_safe`) and the TS path validators are the security boundary for the whole plugin, but nothing prevents a future PR from deleting a sandbox test or shipping a new mutating command with no test — the existing tests are advisory only. Given findings #1–#3, this surface warrants a new-code ratchet rather than a big-bang backfill.
- **Root cause**: The project tests by convention, not by enforced threshold; no per-file/per-area floor on the highest-risk modules.
- **Impact**: Security/data-loss regressions can land without a failing gate.
- **Fix sketch**: Lightweight, bypass-resistant: (a) a CI check that `drive.rs` and `api/drive.ts` each have an associated test file (presence gate, not %); (b) once #1–#3 land, a Rust test asserting every mutating command refuses an overwrite/root-target — a single "policy" test that future commands must extend. Avoid a global line-% threshold (would invite assertion-free filler); prefer a new-code ratchet on these two files.
