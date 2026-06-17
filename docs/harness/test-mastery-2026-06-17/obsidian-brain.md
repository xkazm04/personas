# Test Mastery — Obsidian Brain
> Total: 7 findings (2 critical, 3 high, 1 medium, 1 low)

## 1. `vault_note_filename` collision-safety has no test — the exact bug it fixes can silently regress
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/obsidian_brain/mod.rs:487-507
- **Current test state**: none
- **Scenario**: `vault_note_filename` was added specifically to stop two memories whose titles sanitize to the same name from clobbering each other's vault file (documented "bug-hunt 2026-06-07 creative #1" — silent data loss with success theater). It appends a stable, id-derived suffix so the on-disk name is injective per entity. There is no test asserting that two distinct entity ids with the same title produce distinct filenames, nor that the suffix is stable across calls for one id. A refactor that drops the suffix, shortens it to fewer chars, or changes the id slice would silently re-introduce data loss — push would overwrite one memory's note with another's and report `created`/`updated` success.
- **Root cause**: The fix shipped as a private helper with no `#[cfg(test)]` coverage; `mod.rs` has no inline test module (only `mirror_tests`, which covers the mirror primitive, not the push path).
- **Impact**: Two personas/memories that sanitize to the same title overwrite each other in the vault; the user loses one note while the sync log claims success. This is the headline data-loss bug the function was written to prevent.
- **Fix sketch**: Add a pure unit test (the function takes only `&str`s — no DB/FS needed). Invariant to assert: **injectivity under collision** — `vault_note_filename("Q3 Plan", "id-aaaa1111") != vault_note_filename("Q3 Plan", "id-bbbb2222")`, both ending `.md`; **stability** — same `(title, id)` yields the same name twice; **edge cases** — empty/non-alnum id falls back to a safe suffix (`x`), and an id with <8 alnum chars still produces a valid name. LLM-generatable batch.

## 2. Push/Pull/resolve-conflict sync engine (data-write path) has zero command-level coverage
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/obsidian_brain/mod.rs:509-813 (push), 848-1072 (pull), 1239-1354 (resolve)
- **Current test state**: none (only the lower-level `three_way_compare` and `mirror_write_note` primitives are tested; the orchestration that wires them to memories/personas/connectors, conflict-skip, and DB writeback is not)
- **Scenario**: `obsidian_brain_push_sync` decides created/updated/skipped, refuses to overwrite vault edits via `classify_push`, and advances sync state; `obsidian_brain_pull_sync` writes memory rows back into `persona_memories` from frontmatter (`UPDATE ... WHERE id`), imports brand-new vault notes as memories, and counts conflicts/converged. None of this end-to-end behavior is asserted against a real temp DB + temp vault (the pattern `mirror_tests.rs` already establishes with `init_test_db()`). Regressions that slip through today: push overwriting a user's direct Obsidian edit (the `ThreeWayResult::VaultChanged`/`Conflict` skip branch silently inverting), pull importing a note with the wrong persona, importance not being clamped to 1..5, or the "skip on write error, don't advance hash" guard (mod.rs:920-927) being removed — which the code comment itself flags as causing permanent app/vault divergence under success theater.
- **Root cause**: The whole `commands/obsidian_brain/mod.rs` command layer was shipped without an integration test module despite the infra (`init_test_db`, real temp-vault tests) already existing one file over in `mirror_tests.rs`.
- **Impact**: The core value of the plugin — bidirectional sync without losing user data — has no safety net. A silent data-loss regression in push/pull would not be caught by CI.
- **Fix sketch**: Add `#[cfg(test)] mod sync_tests;` modeled on `mirror_tests.rs`. Cases: (a) push new memory → file written, sync_state recorded, `created==1`; (b) push unchanged → `skipped==1`, no rewrite; (c) push after editing the vault file directly → `skipped` + `skipped_vault_conflict` log, app content NOT written (assert file bytes unchanged); (d) pull with vault-only edit → `persona_memories` row updated, importance clamped to 1..5; (e) pull import of a `type: persona-memory` note for an unknown persona → recorded in `errors`, no row created; (f) `resolve_conflict` with `"use_vault"` updates the row, `"use_app"` overwrites the file, bad resolution string → `AppError::Validation`.

## 3. `resolve_vault_subpath` path-traversal guard is untested security-critical code
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/obsidian_brain/mod.rs:1369-1402 (used by list_vault_files:1404 and read_vault_note:1504)
- **Current test state**: none
- **Scenario**: This is the containment guard that confines vault browsing/reading to the configured vault — it rejects absolute paths and `..` segments, canonicalizes both sides, and asserts `starts_with`. The doc comment ties it to "bug-hunt 2026-06-07 creative #2" where the listing command shipped without the read command's checks and enumerated arbitrary directories. There is no test that `..`-escape, an absolute path, or a symlink-out is rejected, nor that a legitimate in-vault relative path resolves. A refactor that weakens any branch (e.g. dropping the `ParentDir` check or the `starts_with` assertion) would re-open arbitrary local-file read via the `obsidian_brain_read_vault_note` IPC — a sandbox escape.
- **Root cause**: Security guard added as a private fn with no unit test; the sibling `path_safety` context likely has its own tests but this vault-specific guard does not.
- **Impact**: Regression silently turns a note reader into an arbitrary-file reader (read any file the app process can access). High blast radius for a desktop app holding credentials.
- **Fix sketch**: Unit test against a real temp vault dir. Invariants: `resolve_vault_subpath(vault, Some("../secret"))` → `Err`; `Some("/etc/passwd")` / `Some("C:\\Windows\\...")` → `Err`; `None`/`""` → vault root; a real in-vault `"Personas/x.md"` → `Ok` with canonical path `starts_with` vault. (Optionally a symlink-escape case, OS-gated.) Partly LLM-generatable; assert the **containment invariant**, not exact error strings.

## 4. TS `api/obsidianBrain` empty-array "don't nuke the vault" contract is undefended despite an established api-test pattern
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/api/obsidianBrain/index.ts:179-186 (push), 257-273 (drive push/pull), 152-160 (availability cache)
- **Current test state**: none (the repo has 189 TS tests and a clean `src/api/__tests__/*.test.ts` + `@/test/tauriMock` pattern — obsidianBrain is simply absent)
- **Scenario**: `obsidianBrainPushSync([])` and `obsidianDrivePushSync([])`/`obsidianDrivePullSync([])` deliberately short-circuit to a zero-count result *without an IPC round-trip*, because `[]` means "sync nothing" while `undefined` means "sync everything" — the doc comment warns callers must not collapse a cleared filter into `undefined` or they could nuke the vault. Nothing asserts this branch. A refactor that drops the `length === 0` guard or forwards `[]` as `null` to Rust would turn "user deselected every persona/folder" into "sync ALL" — a destructive, plugin-defining footgun. Separately, the `obsidianAvailable` 30s promise cache + reject-eviction (lines 152-159) is untested race-prone logic.
- **Root cause**: New api module added without a companion `__tests__` file; the contract lives only in a JSDoc comment.
- **Impact**: A silent regression here either fails to sync (annoying) or syncs everything when the user asked for nothing (data churn / potential overwrite) — exactly the scenario the contract was written to prevent.
- **Fix sketch**: Add `src/api/obsidianBrain/__tests__/index.test.ts` using `mockInvoke`/`mockInvokeError`. Assert: `obsidianBrainPushSync([])` resolves to `{created:0,updated:0,skipped:0,errors:[]}` **and** `invoke` was never called; `obsidianBrainPushSync(undefined)` forwards `personaIds: null`; `obsidianBrainPushSync(["p1"])` forwards the array; same matrix for both drive fns. Plus: `obsidianAvailable()` shares one in-flight promise on concurrent calls, and a rejected probe is evicted (next call re-invokes). LLM-generatable; invariant = the documented `undefined`/`[]`/`array` semantics.

## 5. `parseNote` frontmatter/wordcount parser is a pure function with no test
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/plugins/obsidian-brain/sub_browse/parseNote.ts:19-46
- **Current test state**: none
- **Scenario**: `parseNote` is the display parser for the Browse panel — it splits YAML frontmatter into properties, strips wrapping quotes, flattens `[a, b]` inline lists, and counts body words (CRLF-aware via `\r?\n`). It is pure, dependency-free, and exactly the kind of mapper that should be locked by tests. Today a regression in the frontmatter regex (e.g. CRLF handling, or the quote/list cleanup) would silently mis-render note properties and wordcount with no failing test. It is also a good place to pin behavior the backend `extract_yaml_field` round-trip depends on visually.
- **Root cause**: Helper extracted from the panel for testability but the test never followed.
- **Impact**: Low blast radius (display only), but high value-per-effort: cheap, pure, and currently zero coverage. Misparsed properties erode trust in the "external brain" view.
- **Fix sketch**: LLM-generatable batch asserting **behavioral invariants, not snapshots**: note with frontmatter → expected `properties` (quotes stripped, `[a, b]` → `a, b`), `body` excludes the fence, `wordCount` matches a known body; note with no frontmatter → `properties: []`, `body === content`; CRLF (`---\r\n...`) parses identically to LF; empty body → `wordCount: 0`; a non-`key: value` line is skipped.

## 6. `goal_to_markdown` / `push_competition_insight_to_vault` writers store an absolute vault path and embed unescaped user text — no test
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/obsidian_brain/mod.rs:1524-1576 (goal_to_markdown / push_goals), 1855-1912 (competition insight)
- **Current test state**: none
- **Scenario**: Two divergences from the well-tested memory/persona path go unasserted: (a) the goals push records `vault_file_path` as the **absolute** path (mod.rs:1636 `file_path.to_string_lossy()`), whereas every other entity stores a vault-relative path — a pull/portability inconsistency no test pins; (b) `goal_to_markdown` and `push_competition_insight_to_vault` interpolate user-controlled titles/labels/strategy directly into YAML frontmatter with raw `"{...}"` quoting, NOT the hardened `yaml_quote` used everywhere in `markdown.rs`. A goal titled `Ship "v2"` produces malformed frontmatter — the exact class of bug `yaml_quote` + its round-trip test fixed for memories. No test guards either property.
- **Root cause**: These two writers were added after the `markdown.rs` hardening and didn't adopt `yaml_quote`; no test compares them against the established escaping/relative-path invariants.
- **Impact**: Malformed vault notes for goals/competitions with quotes or colons in their titles; goal sync state that doesn't round-trip portably. Moderate — narrower entity types than memories.
- **Fix sketch**: Unit test `goal_to_markdown` with a title containing `"`/`:`/newline and assert the frontmatter is parseable by `parse_frontmatter` + `extract_yaml_field` (drives adoption of `yaml_quote`). Integration test `obsidian_brain_push_goals` (temp DB + vault) asserting the stored `vault_file_path` is vault-relative, matching the other entities' invariant.

## 7. `obsidian_brain_test_connection` note-count and detect-vaults parsing lack tests
- **Severity**: low
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/obsidian_brain/mod.rs:127-189 (test_connection), 77-125 (detect_vaults)
- **Current test state**: none
- **Scenario**: `test_connection` validates a vault (requires `.obsidian` dir) and reports a `note_count` via a top-level + one-level-deep `.md` scan that skips dotted dirs. `detect_vaults` parses `obsidian.json`. These shape the setup-panel UX. The counting logic (1-deep, dotted-dir skip) and the invalid-vault branches (missing path, missing `.obsidian`) have no test — a regression that miscounts or wrongly accepts a non-vault directory would surface only as confusing UX.
- **Root cause**: Setup/discovery commands shipped without coverage; lower priority than the data-write paths above.
- **Impact**: Low — read-only validation/UX, no data loss. Listed for completeness so a future suite reaches the documented `valid:false` branches.
- **Fix sketch**: Integration test against a temp dir: no `.obsidian` → `{valid:false, error: "Not an Obsidian vault..."}`; missing path → `{valid:false}`; a dir with `.obsidian` + N top-level + M one-deep `.md` files (plus a dotted subdir that should be ignored) → `valid:true`, `note_count == N+M`. Defer behind findings 1-5.
