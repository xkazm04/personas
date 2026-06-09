# Bug Hunter — templates-and-build-sessions
> Total: 6
> Severity: 1 critical, 3 high, 2 medium

## 1. Dry-run simulation permanently clobbers a promoted persona's real design_context
- **Severity**: critical
- **Category**: state-corruption
- **File**: src-tauri/src/commands/design/build_simulate.rs:181-244
- **Scenario**: User finishes a build, promotes it (session phase → `Promoted`, `personas.design_context` now holds the final, UUID-keyed use cases the runtime depends on). Later they re-open the draft and click "Dry run / preview" on a capability. `simulate_build_draft` allows phase `Promoted` (line 186) and then unconditionally runs `UPDATE personas SET design_context = ?1` with the *simulation snapshot* (lines 240-243). The snapshot is a stripped, `_simulation_snapshot: true` shape with re-fabricated `uc_idx_N` ids — it overwrites the production design_context.
- **Root cause**: The code's safety argument (doc comment lines 156-159: "The snapshot persists on the row but is overwritten by `promote_build_draft` when the user finalises the build") only holds for the *pre-promote* flow. For an already-`Promoted` session promote will never run again, so nothing ever restores the real design_context. The allowed-phase set includes `Promoted` but the overwrite logic assumes a future promote.
- **Impact**: data loss / corruption — a live, scheduled/triggered persona now reads a simulation snapshot as its capability definition. Trigger→use_case linkage by UUID breaks (snapshot ids are `uc_idx_*`), notification channels and per-UC policies vanish, and real executions silently misbehave or no-op. Survives restart; not recoverable without rebuild.
- **Fix sketch**: Never mutate the canonical `design_context` for simulation. Either (a) drop `Promoted` from the allowed-phase set, or (b) write the snapshot to a dedicated `simulation_design_context` column / scratch row and have `execute_persona_inner` read it only when `is_simulation=true`, then never touch the production column.

## 2. Concurrent / double test_build_draft leaves the session in a non-deterministic phase
- **Severity**: high
- **Category**: race-condition
- **File**: src-tauri/src/commands/design/build_sessions.rs:582-777; src-tauri/src/db/models/build_session.rs:84
- **Scenario**: The UI auto-fires a test on `draft_ready` (see comment at build_sessions.rs:1280-1281 "outer auto-test path (UI useEffect on draft_ready)") and the user can also click "Test" manually — or two Glyph tabs are open on the same session. Both invocations call `test_build_draft`. Each does `validate_transition(Testing)` then `update(phase=Testing)`. `BuildPhase::Testing` explicitly permits `Testing → Testing` (build_session.rs:84) and `DraftReady → Testing` is allowed, so both pass. Both spawn the real tool-test LLM run. Whichever finishes last wins the phase: one may write `TestComplete` while the other's error path writes `DraftReady` + `error_message` (lines 754-776).
- **Root cause**: There is no atomic compare-and-set guard ("only I may start a test"). Phase validation is a read-then-write TOCTOU, and the state machine treats `Testing` as re-entrant, so the command is not idempotent under concurrency.
- **Impact**: UX degradation + state corruption — a session that actually passed can be left in `draft_ready` with a stale error message; duplicate real-API test traffic; the persisted `last_test_report` flip-flops. The user sees "test failed" on a build that passed.
- **Fix sketch**: Make the transition atomic: `UPDATE build_sessions SET phase='testing' WHERE id=? AND phase IN ('draft_ready','test_complete')` and bail if `rows_affected == 0`. Or hold a per-session in-flight flag in `BuildSessionManager` keyed by session_id.

## 3. send_answer uses try_send on a bounded channel — answers silently rejected, never re-queued
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/engine/build_session/mod.rs:304-315 (channel created at :133 with capacity 32)
- **Scenario**: The build runner pauses on a question and the user (or the Companion / external MCP wrapper that can poll + answer) submits answers. `send_answer` uses `input_tx.try_send(answer)`. The mpsc channel has capacity 32. Between the runner emitting a question and actually reaching `input_rx.recv().await`, the runner is busy in a long CLI turn (tens of seconds) and is NOT draining the channel. If a client retries an answer, or a batch flow pushes more than 32 unconsumed messages (e.g. a webhook-driven answer loop, or rapid double-clicks across the gate fan-out), `try_send` returns `Full` and the answer is converted to an `AppError::Internal` returned to the caller — but the *build* never sees it.
- **Root cause**: `try_send` is non-blocking and fails when the buffer is full or when the receiver was dropped (runner already exited after MAX_TURNS or cancel). The error surfaces to the IPC caller as a generic "Failed to send answer", with no retry, no phase reconciliation, and the session sits in `awaiting_input` forever. There is no detection of "receiver gone vs buffer full".
- **Impact**: UX degradation / stuck session — a build hangs at `awaiting_input` with the user believing they answered. On the next launch BuildWatcher sees a non-terminal row and may attempt to resume a session whose in-memory handle is gone.
- **Fix sketch**: Distinguish `TrySendError::Closed` (session already terminal — surface a clear "session no longer active, restart the build" and finalize the row) from `TrySendError::Full` (apply backpressure: `send().await` with a timeout, or reject with an explicit "answer in progress, retry"). Don't leave the DB phase at `awaiting_input` after a failed delivery.

## 4. Codebase-pin SQL silently mis-resolves when the answer matches multiple projects
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/commands/design/template_adopt.rs:1031-1046
- **Scenario**: A team preset adoption pins every member to a codebase via an adoption question whose answer is a project *name* or *root_path*. The resolver query is `SELECT id FROM dev_projects WHERE id = ?1 OR name = ?1 OR root_path = ?1 ORDER BY (id = ?1) DESC, (status = 'active') DESC LIMIT 1`. If two dev_projects share a name (common: two clones / re-imports of the same repo) and neither is the literal id, the `ORDER BY` is fully satisfied by the first two keys and `LIMIT 1` picks an arbitrary one of the duplicates.
- **Root cause**: Name/root_path are not unique keys, but the query treats a name match as authoritative and resolves to a single row with no ambiguity handling. The `.ok()` at line 1039 also swallows any query error into "leave unpinned" without distinguishing "no match" from "DB error".
- **Impact**: UX degradation / wrong-data — an adopted persona (and every team member pinned to it) reads the *wrong* repository at runtime via `PERSONAS_DEV_PROJECT_ID`; code analysis / impact tools operate on the wrong codebase with no error shown to the user.
- **Fix sketch**: Detect multiplicity (`SELECT id ... LIMIT 2`, error/flag when 2 rows return for a non-id match) and surface a "could not uniquely resolve codebase" review item instead of silently pinning. Prefer an exact id match; only fall back to name when exactly one row matches.

## 5. URL workflow import fetches an arbitrary user-supplied URL from the renderer (SSRF surface)
- **Severity**: medium
- **Category**: security
- **File**: src/features/templates/sub_n8n/steps/upload/useUrlImport.ts:24-90
- **Scenario**: The "import from URL" affordance takes any `http(s)` URL the user pastes and does `fetch(rawUrl, ...)` directly from the Tauri webview (line 46). Unlike the build-session *reference* fetch path (which the buildSession API docstring at src/api/agents/buildSession.ts:57-62 says is resolved "server-side (SSRF-safe URL fetch, size cap, content-type guard)"), this import path performs no host/IP validation. A malicious or social-engineered link (e.g. `http://169.254.169.254/...`, `http://localhost:PORT/...`, or an internal service URL) is fetched with the app's network position; the response body is shown back in the preview (status text, content) and can be imported.
- **Root cause**: The frontend trusts the workflow-import URL and fetches it inline rather than routing through the SSRF-guarded server-side fetcher used elsewhere. `http:` is explicitly permitted (line 35), enabling plaintext internal endpoints.
- **Impact**: security — internal-network/metadata-endpoint probing and limited data exfiltration via the desktop app's network context; content from internal services rendered in-app.
- **Fix sketch**: Route URL imports through the same server-side SSRF-safe fetcher the reference path uses (block private/loopback/link-local ranges, enforce content-type + size cap), or at minimum reject non-public hosts and `http:` before fetching.

## 6. Webhook-source validation accepts any path under smee.io (open-redirect-style trust)
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/commands/design/build_sessions.rs:402-414
- **Scenario**: When answering a webhook-capable clarifying question, the only check on the attached channel URL is `url.starts_with("https://smee.io/")` (line 404). That prefix check passes for `https://smee.io/` (empty channel), `https://smee.io/../foo`, `https://smee.io.attacker.com/...`? — no: the latter fails the prefix, but `https://smee.io/` with no channel, and `https://smee.io/anything` regardless of being a real proxy channel, both pass and are appended verbatim into the answer and later auto-create a `smee_relays` row at promote.
- **Root cause**: Prefix-only validation does not verify there is a non-empty channel segment or a well-formed channel id; `https://smee.io/` (bare) yields a relay bound to an invalid/empty channel that silently never delivers events.
- **Impact**: UX degradation / silent failure — a promoted persona's webhook trigger is wired to a dead/empty smee channel and never fires, with no error surfaced at build or promote time; user believes the integration works.
- **Fix sketch**: Parse the URL and require a non-empty path segment matching smee's channel id format (host == `smee.io` exactly, single non-empty path segment), rejecting bare `https://smee.io/` and malformed channels at the trust boundary.
