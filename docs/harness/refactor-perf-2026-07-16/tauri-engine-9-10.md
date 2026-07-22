# tauri:engine [9/10] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 2 high / 1 medium / 2 low)
> Context group: Backend Engine & Runtime | Files read: 18 | Missing: 0

## 1. Warm session reuse is a permanent no-op — offer/take hash different inputs
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: broken-cache
- **File**: src-tauri/src/engine/session_pool.rs:69 (mismatch between src-tauri/src/engine/mod.rs:2312 and src-tauri/src/commands/execution/executions.rs:398)
- **Scenario**: Every persona execution. The only `offer()` call site (engine/mod.rs:2312) computes `config_hash` by hashing `result.execution_config` alone; the only `take()` call site (executions.rs:398) hashes `system_prompt + structured_prompt + model_profile + tools.len() + capabilities fingerprint`. These hash disjoint inputs, so `session.config_hash != current_config_hash` on essentially every take.
- **Root cause**: Two independently hand-rolled inline hash blocks (the canonical helper `compute_config_hash` was never wired in — see finding 3) drifted apart, and nothing pins them together.
- **Impact**: `SessionPool::take` always hits the "config changed" branch, removes the cached session, and returns `None` — the `--resume` warm-start path never fires (`"Warm session reuse from pool"` is unreachable). Every run cold-starts: full prompt re-send cost, lost conversation context, plus all the pool bookkeeping (RwLock writes, invalidations in personas.rs/use_cases.rs) is pure overhead.
- **Fix sketch**: Define ONE hash function (extend `session_pool::compute_config_hash` to take the full field set incl. structured_prompt and capabilities fingerprint) and call it from both the offer site in engine/mod.rs and the take site in executions.rs. Add a test that offers with the helper and takes with the same helper to pin the round trip. Verify `execution_config` actually carries the same semantics before deciding which field set wins.

## 2. Verification command drains output only AFTER wait() — pipe-buffer deadlock on chatty commands
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: resource-deadlock
- **File**: src-tauri/src/engine/verification_command.rs:71
- **Scenario**: An operator sets `verification_command` to a real test suite (`npm test`, `cargo test`) that prints more than the OS pipe buffer (~64 KB on Windows/Linux). The child blocks writing to the full pipe; `child.wait().await` never resolves because nothing is reading; the whole run sits until the timeout, then gets killed and misreported as `timed_out: true` with an empty output tail.
- **Root cause**: The comment says "Drain stdout+stderr concurrently with the wait", but the `run` async block is sequential: it awaits `child.wait()` first and only then does `read_to_end` on stdout/stderr. Nothing reads while the child runs. Secondarily, `read_to_end` accumulates the ENTIRE output in `combined` even though only the last 4 KB (`MAX_TAIL_BYTES`) is ever used — a verbose suite holds hundreds of MB in RAM.
- **Impact**: Any verification command with non-trivial output falsely fails as a timeout (breaking the F7 fix-loop this module exists to feed), and memory usage is unbounded by output size in the cases that do complete.
- **Fix sketch**: Spawn two `tokio::spawn`ed reader tasks (or use `tokio::join!` on read futures alongside `child.wait()`) that stream stdout/stderr into a bounded ring buffer keeping only the last `MAX_TAIL_BYTES` (e.g. `VecDeque<u8>` truncated from the front). Join readers + wait under the single timeout. This fixes both the deadlock and the unbounded buffer, and makes the tail available even on timeout.

## 3. `compute_config_hash` is dead code hiding behind `#[allow(dead_code)]`
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/session_pool.rs:129
- **Scenario**: Grep across src-tauri/src shows zero callers of `compute_config_hash`; both real call sites (executions.rs:398, engine/mod.rs:2312) re-implement the hashing inline with different field sets. The `#[allow(dead_code)]` silences the compiler warning that would have exposed this.
- **Root cause**: The helper was written as the canonical fingerprint but never adopted; each caller grew its own copy, and the copies diverged (directly causing finding 1).
- **Impact**: Dead public function that misleads readers into thinking it is the fingerprint contract, while the actual contract lives (inconsistently) in two inline blocks — a live maintenance hazard, already realized as a defect.
- **Fix sketch**: As part of the finding-1 fix, make `compute_config_hash` the single canonical implementation with the full field set and drop the `#[allow(dead_code)]`; replace both inline blocks with calls to it. If finding 1 is fixed some other way, delete the function outright.

## 4. `TierConfig::pro` / `enterprise` / `from_plan` have no production callers
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/tier.rs:28
- **Scenario**: Repo-wide grep finds `pro()`, `enterprise()`, and `from_plan()` referenced only from tier.rs's own tests. Production code only ever constructs `TierConfig::default()` (= `free()`) in lib.rs:1076; webhook.rs / background.rs / tier_usage.rs consume the struct but never select a plan.
- **Root cause**: Tier machinery was built anticipating a subscription plan resolver that was never wired up in this desktop app — there is no code path that reads a plan string.
- **Impact**: ~40 lines of unreachable plan logic plus tests that pin behavior nothing uses; readers may assume tier switching works. Bounded cost, no runtime effect.
- **Fix sketch**: Either wire a real plan source into `from_plan` at AppState construction, or delete `pro`/`enterprise`/`from_plan` and their tests, leaving `free()`/`Default`. Verification needed: confirm no frontend/Tauri command passes a plan string (none found via grep) before deleting.

## 5. `google_oauth.rs` misnamed scope + error message names env vars the function never checks
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src-tauri/src/engine/google_oauth.rs:92
- **Scenario**: A user missing credentials calls the standard resolver `resolve_google_oauth_env_credentials`; its error tells them to set `GCP_DESKTOP_CLIENT_ID/GCP_DESKTOP_CLIENT_SECRET` "(preferred)", but that function only checks `GCP_CLIENT_ID`/`GOOGLE_*` keys — desktop keys are consulted only by the separate `resolve_google_desktop_oauth_credentials`. Meanwhile the module also hosts `resolve_microsoft_oauth_credentials` under the `google_oauth` name.
- **Root cause**: The desktop-credentials variant and the Microsoft resolver were bolted onto the Google module later; the error copy and filename were not revisited.
- **Impact**: Misleading remediation text can send a user down setting env vars that the failing code path never reads; the misnamed module makes the Microsoft resolver hard to discover. Polish-level, no runtime cost.
- **Fix sketch**: Move the generic pieces (`env_var_first_nonempty`, `dotenv_var_first_nonempty`, `resolve_env_value`) plus the Microsoft resolver into an `oauth_env.rs` (or rename the module `oauth_credentials.rs`), and tailor the error message per function so it lists exactly the keys that function checks.
