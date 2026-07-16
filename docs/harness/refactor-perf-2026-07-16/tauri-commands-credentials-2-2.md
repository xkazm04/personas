# tauri:commands/credentials [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 3 medium / 1 low)
> Context group: Backend Data & Commands | Files read: 10 | Missing: 0

## 1. Duplicated binary-allowlist block with a self-referential `or_else` fallback in `execute_desktop_bridge`
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/credentials/desktop_bridges.rs:46
- **Scenario**: The vscode and docker arms carry byte-for-byte identical manifest/allowlist checks (lines 46–55 vs 62–71). Worse, the fallback is dead logic: `connector_name` is built as `format!("desktop_{}", bridge)`, so `get_manifest(&connector_name).or_else(|| get_manifest("desktop_vscode"))` inside the `"vscode"` arm looks up the exact same key twice (same for `"desktop_docker"`).
- **Root cause**: The check was copy-pasted per bridge, and the `or_else` was presumably added defensively without noticing the two keys are always equal.
- **Impact**: Confusing dead fallback invites a future bug (someone edits one lookup and not the other); adding a fifth bridge means pasting the block a third time.
- **Fix sketch**: Extract `fn check_binary_allowed(connector_name: &str, binary: &str) -> Result<(), AppError>` that does one `get_manifest(connector_name)` lookup and the `is_binary_allowed` check, and call it from both arms. Drop the `or_else` entirely. Also replace the fully-qualified `crate::engine::desktop_security::get_manifest` in the terminal arm with the already-imported `desktop_security::get_manifest` for consistency.

## 2. Two competing auth idioms in the same command family (`require_auth_sync` vs `#[requires(privileged)]`)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src-tauri/src/commands/credentials/credential_recipes.rs:7
- **Scenario**: Every other file in this module (`connectors.rs`, `resources.rs`, `mcp_gateways.rs`, `mcp_tools.rs`, `intelligence.rs`, `discovery.rs`, `negotiator.rs`) gates commands declaratively with the `#[requires(privileged)]` macro; `credential_recipes.rs` alone calls `require_auth_sync(&state)?` manually inside each of its four command bodies. `connectors.rs` also documents its one public command (`list_connectors`) while `get_connector` is ungated with no comment explaining why.
- **Root cause**: `credential_recipes.rs` predates (or was written independently of) the `personas_macros::requires` attribute and was never migrated.
- **Impact**: On a credential/security surface, two idioms for the same guard make audits harder — a reviewer grepping for `requires(privileged)` misses these four commands, and a new command copied from this file will silently inherit the older, easier-to-forget pattern. If `get_connector` is meant to be public, that intent is undocumented.
- **Fix sketch**: Convert the four recipe commands to `#[requires(privileged)]` (or whichever `requires(...)` level `require_auth_sync` corresponds to) and drop the manual calls. Add a one-line comment to `get_connector` stating whether its lack of a gate is intentional, mirroring the `list_connectors` comment.

## 3. `get_negotiation_step_help` runs an untracked 120s CLI child with no cancellation path
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src-tauri/src/commands/credentials/negotiator.rs:141
- **Scenario**: A user asks a step-help question, then closes the help popover or the whole negotiation dialog. Unlike `start_credential_negotiation` (which registers the run in `process_registry` so `cancel_credential_negotiation` can kill the PID), `run_claude_prompt` here is invoked with no registry domain and no track_pid — the spawned Claude CLI process keeps burning CPU/tokens for up to 120 seconds, and rapid repeat questions stack multiple concurrent CLI children.
- **Root cause**: The step-help path was built as a fire-and-await helper without wiring it into the process registry used by the sibling negotiation flow in the same file.
- **Impact**: Orphaned CLI processes (each a full Claude invocation with real token spend) accumulate per abandoned question; there is no way for the UI to abort one. Bounded per call by the 120s timeout, but unbounded across calls.
- **Fix sketch**: Register step-help runs under a `"negotiation_help"` domain via `registry.begin_run` before spawning (killing the previous help PID like line 71–74 does), or thread a cancellation token / tracked PID through `run_claude_prompt`. At minimum, kill the previous in-flight help process when a new question is asked so at most one child exists.

## 4. Unused `state` parameters on `healthcheck_mcp_preview` and `get_mcp_pool_metrics`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/commands/credentials/mcp_tools.rs:44
- **Scenario**: `healthcheck_mcp_preview` (line 44) and `get_mcp_pool_metrics` (line 52) accept `state: State<'_, Arc<AppState>>` but never touch it — `ping(&fields)` and `snapshot_pool_metrics()` take no state (the `#[tauri::command]` macro expansion suppresses the unused-variable warning, so the compiler never flags it).
- **Root cause**: Parameter copied from the sibling commands' signature when these wrappers were added.
- **Impact**: Cosmetic only, but it misleads readers into thinking these commands read app state, and pads the DI surface. Note: if the `#[requires(privileged)]` macro inspects `state` to enforce the gate, the parameter is load-bearing — verify the macro before removing.
- **Fix sketch**: If the `requires` macro does not need the `state` binding, drop the parameter from both signatures (Tauri injects only declared params, so callers are unaffected). Otherwise rename to `_state` with a comment noting it exists for the privilege gate.
