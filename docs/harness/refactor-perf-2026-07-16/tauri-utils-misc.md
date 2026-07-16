# tauri:utils (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 2 high / 0 medium / 1 low)
> Context group: Core Libraries & State | Files read: 2 | Missing: 0

## 1. `sanitize_secrets` recompiles 4 regexes on every call
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: repeated-regex-compile
- **File**: src-tauri/src/utils/sanitization.rs:20
- **Scenario**: Every audit-log write (settings_audit_log, audit_log, credentials), every settings change, and every engine error path (healthcheck, rotation, resource_listing — some in loops over resources) calls `sanitize_secrets`, which calls `Regex::new` four times (`re_auth`, `re_pairs`, `re_prefixes`, `re_bearer`) per invocation.
- **Root cause**: Only the email pattern got the `OnceLock` treatment (line 4-9); the other four patterns — including the large `re_pairs` alternation — are compiled inline inside the function body.
- **Impact**: Regex compilation is the expensive part (NFA construction, typically 100µs–1ms for the big alternation), dwarfing the actual matching on short log strings. Multiplied by 4 per call on every audit/error path, this is pure fixed-cost waste with a canonical zero-risk fix, and the file itself already demonstrates the right pattern.
- **Fix sketch**: Move all four patterns into `static … : OnceLock<Regex>` (or `std::sync::LazyLock<Regex>` since the crate is on a recent toolchain) alongside `EMAIL_PATTERN`, initialized once. No behavior change; existing tests cover the semantics.

## 2. `truncate_on_char_boundary` is duplicated verbatim in `engine/str_utils.rs` and hand-rolled at ~18 call sites
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/utils/text.rs:11
- **Scenario**: `engine/str_utils.rs::truncate_str` is a byte-for-byte reimplementation of `utils/text.rs::truncate_on_char_boundary` (same signature shape, same loop). Beyond that, the identical `while … !s.is_char_boundary(end) { end -= 1 }` loop is hand-inlined in ~18 more places (companion/brain/{dashboard,consolidation,cockpit,episodic,doctrine,goals,procedural,reflection,semantic}.rs, companion/prompt.rs, mcp_server/vault.rs, commands/design/n8n_transform/{cli_runner,prompt_sanitizer}.rs, commands/design/template_adopt.rs, engine/{memory_recall,verification_command}.rs, engine/prompt/runtime_safety.rs, engine/project_tracking/watchers/obsidian.rs, commands/infrastructure/cli_stderr.rs).
- **Root cause**: The helper was extracted after a panic incident (its own doc comment says it is "the safe replacement applied across the content-truncation sites") but the replacement was never actually applied — call sites kept their local copies and `engine/str_utils.rs` grew a second canonical helper.
- **Impact**: Two "canonical" helpers plus 18 inline copies means any fix (e.g., handling the forward-scan variants in `vault.rs`/`verification_command.rs`) must be found and repeated 20 times; the misleading doc comment actively tells readers the consolidation already happened. This is exactly the class of drift that caused the original panic.
- **Fix sketch**: Pick one home (utils/text.rs), delete `engine/str_utils.rs::truncate_str` in favor of a re-export or direct import, and mechanically replace the backward-scan inline loops with `truncate_on_char_boundary`. Add a small `ceil_char_boundary`-style forward variant for the two forward-scanning sites. Fix the doc comment to match reality until then. Cross-context change — verify with `cargo check --features desktop,ml`.

## 3. Email regex has a stray `|` in its character class and is duplicated in `ambient_context.rs`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/utils/sanitization.rs:8
- **Scenario**: The TLD class is written `[A-Z|a-z]{2,}` — the `|` is a literal pipe inside a character class, not alternation, so the pattern nominally accepts `|` in a TLD. Meanwhile `engine/ambient_context.rs:1007` compiles its own (correctly written) copy of the same email pattern instead of reusing `get_email_pattern`.
- **Root cause**: Classic `[A-Z|a-z]` typo (harmless in practice since `|` can't appear in a real hostname match given the preceding `[A-Za-z0-9.-]+\.`), plus an independent second compilation of the same intent elsewhere.
- **Impact**: Cosmetic correctness smell that invites copy-paste propagation; the two email patterns can silently drift (they already differ in escaping style).
- **Fix sketch**: Change the class to `[A-Za-z]{2,}`, make `get_email_pattern` (or the compiled `Regex`) `pub(crate)`, and have `ambient_context.rs` reuse it instead of compiling its own.
