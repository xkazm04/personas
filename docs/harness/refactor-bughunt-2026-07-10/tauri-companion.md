> Context: tauri:companion
> Total: 7
> Critical: 0  High: 1  Medium: 2  Low: 4

## 1. Byte-slice panic when truncating a persona failure message with multibyte UTF-8
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case
- **File**: src-tauri/src/companion/observability.rs:222-227
- **Scenario**: `format_for_prompt` truncates each recent failure's error via `&f.error[..120]`. If `error` is longer than 120 bytes AND byte index 120 lands in the middle of a multibyte char (any non-ASCII in a stack trace, path, or provider error — common), the slice panics: "byte index 120 is not a char boundary". `format_for_prompt` runs on every companion turn (prompt build in `prompt.rs::build_system_prompt`), so a single failed execution with a long unicode error message crashes the turn task instead of producing a reply.
- **Root cause**: raw byte slicing on a `String` for length capping. Every other module in this context truncates safely (`utils::text::truncate_on_char_boundary` in athena_reaction.rs; the `is_char_boundary` loop in `prompt.rs::first_paragraph`) — observability.rs is the lone outlier.
- **Impact**: crash / turn failure (denial of the chat reply) whenever a recent failure carries a >120-byte non-ASCII error.
- **Fix sketch**: replace `format!("{}…", &f.error[..120])` with `crate::utils::text::truncate_on_char_boundary(&f.error, 120)` (already imported/used elsewhere), or walk back to the nearest char boundary before slicing.

## 2. `companion_turn` prune over-deletes up to ~1 day past the 90-day window
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/companion/turn_ledger.rs:169-185
- **Scenario**: `prune_old_turns` deletes `WHERE created_at < ?1` where `created_at` is stored via `datetime('now')` (`"YYYY-MM-DD HH:MM:SS"`, space separator) but the cutoff is `chrono` RFC3339 (`"YYYY-MM-DDTHH:MM:SS+00:00"`, `T` separator). String comparison at index 10 sees `' '` (0x20) < `'T'` (0x54), so on the boundary day EVERY stored row (regardless of its time-of-day) compares `<` the cutoff and is deleted — even rows that are only ~89 days old at 23:59 of that day.
- **Root cause**: comparing two different timestamp encodings as strings; the comment claims the `YYYY-MM-DD` prefix "orders correctly" but ignores that the separator byte breaks same-day ordering.
- **Impact**: minor silent data loss — usage/cost analytics rows pruned up to a day early. Not correctness-critical, but the ledger's whole purpose is historical accounting.
- **Fix sketch**: compare on the date prefix only (`created_at < date(?1)`), or normalize the cutoff to the same `datetime('now')` shape (`strftime`/`.format("%Y-%m-%d %H:%M:%S")`).

## 3. `register` stores the Windows `\\?\` verbatim-prefixed path
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/companion/projects.rs:101-104
- **Scenario**: `register` runs `std::fs::canonicalize(path)` for dedupe. On Windows canonicalize returns an extended-length verbatim path (`\\?\C:\Users\...`). That verbatim string is what gets stored and later echoed into Athena's prompt (`prompt.rs::format_plugins` renders `p.path`) and returned to callers. Any code path that resolves a project by a *non*-canonical path (e.g. an `enqueue_dev_job` with `params.path`, or a human-typed path) will not string-match the stored `\\?\`-prefixed value, and the prompt shows users an ugly `\\?\` path.
- **Root cause**: `fs::canonicalize` on Windows emits the verbatim prefix; it's used for normalization without stripping that prefix.
- **Impact**: UX (verbatim paths surfaced to the model/user) and possible lookup misses / duplicate-ish registrations when matched against raw paths.
- **Fix sketch**: strip the `\\?\` / `\\?\UNC\` prefix after canonicalize (or use `dunce::canonicalize`) before storing.

## 4. Dead function `cli_text` — no callers; doc comment misattributes its use
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src-tauri/src/companion/athena_reaction.rs:419-421
- **Scenario**: `pub(crate) async fn cli_text` claims it is "kept for engine callers (`kpi_binding` / `kpi_derivation`)", but grep shows both engine callers use `cli_text_with_usage` (kpi_derivation.rs:322, kpi_binding.rs:489). `cli_text` itself has zero call sites. Verified via `Grep` for `cli_text(` and `athena_reaction::cli_text`.
- **Root cause**: the usage-returning variant superseded the plain one; the plain wrapper (and its now-incorrect comment) were left behind.
- **Impact**: maintainability — dead surface plus a misleading comment that would mislead the next reader about who calls what.
- **Fix sketch**: delete `cli_text`; if a text-only convenience is wanted, keep it but correct the doc to say "no current callers".

## 5. Repo-root resolution triplicated (`CARGO_MANIFEST_DIR/..`)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/companion/dev_mode.rs:25-31, src-tauri/src/companion/dev_session.rs:683-689, src-tauri/src/companion/projects.rs:155-160
- **Scenario**: three copies of the exact "manifest dir → parent → repo root, fall back to cwd" logic. `dev_mode::repo_root`, `dev_session::resolve_repo_root`, and the inline block in `projects::seed_default_project`. `dev_mode`'s own comment even notes it "mirrors `dev_session::resolve_repo_root`". Verified by reading all three.
- **Root cause**: each module grew its own helper rather than sharing one.
- **Impact**: maintainability — if the source layout ever changes (e.g. workspace restructure) three sites must move in lockstep; they can silently drift (dev_session's is described as "the retired wrench-send pipeline" yet still defines its own).
- **Fix sketch**: expose one `companion::dev_mode::repo_root()` (already `pub`) and have `dev_session` + `projects` call it; delete the two duplicates.

## 6. Id-generator helper copied across companion modules
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/companion/dispatcher.rs:1986, dev_session.rs:741, session.rs:2149, turn_ledger.rs:187, projects.rs:171
- **Scenario**: the same `uuid::Uuid::new_v4().simple().to_string().chars().take(N).collect()` helper (`short_random` / `short_uuid`) is redefined in ~16 companion files, 5 of them in this context. Verified via `Grep fn (short_random|short_uuid)`.
- **Root cause**: no shared id util; each file re-rolls it (with inconsistent truncation lengths: 10 vs 12).
- **Impact**: maintainability / minor inconsistency (differing id lengths). Low blast radius.
- **Fix sketch**: add a single `companion::util::short_id(len)` and replace the copies; standardize the length.

## 7. Two dead `#[allow(dead_code)]` accessors
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/companion/connectors.rs:394-405 (`has_any_enabled`), src-tauri/src/companion/plugins.rs:94-105 (`is_enabled`)
- **Scenario**: both are annotated `#[allow(dead_code)]` and have no call sites (Grep for `has_any_enabled(` returns only the definition; `plugins::is_enabled` similarly unused). The `has_any_enabled` doc even says it's "Used by the prompt builder", but the prompt builder calls `list_enabled_for_prompt`, not this.
- **Root cause**: helpers written ahead of a consumer that never materialized; the `allow(dead_code)` silences the warning that would otherwise flag them.
- **Impact**: maintainability — dead surface with an inaccurate "used by" comment.
- **Fix sketch**: delete both, or wire `has_any_enabled` into `format_connectors`/prompt gating if the empty-state skip is actually wanted.
