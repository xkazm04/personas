# Test Mastery — Companion Runtime & Chat
> Total: 7 findings (1 critical, 3 high, 3 medium)

Context scope: Athena companion chat panel + the CLI session runtime that drives
it. Files read: `src-tauri/src/companion/{session.rs, dispatcher.rs, prompt.rs,
mod.rs}`, `src-tauri/src/commands/companion/chat.rs`, `src/api/companion.ts`,
`src/features/plugins/companion/{Bubble.tsx, ChatSearch.tsx}`.

Honest coverage baseline: `dispatcher.rs` has 43 Rust unit tests — but every one
of them covers an *auto-fire UI chat-card* op (`show_*`, `point_at`,
`compose_walkthrough`, PROGRESS beats). The **write/action grammar** of the same
function — `use_connector`, `continue_autonomously`, `open_route`, `write_fact`,
`update_identity`, TTS/QR parsing, the residual leak guard — has **zero** tests.
The frontend has ~28 companion test files (Bubble, ActivityTray, extractStreamPhase,
etc.), so the display layer is well exercised; the backend authority is not.
`session.rs`, `prompt.rs`, and `chat.rs` have no `#[cfg(test)]` at all.

## 1. `use_connector` dispatch — connector-call gating & approval routing is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/dispatcher.rs:1335-1507
- **Current test state**: none
- **Scenario**: `use_connector` is the op that fires *real outbound API calls* with the user's stored credentials. The dispatcher decides whether the call (a) is rejected because the connector is not pinned / disabled, (b) is rejected because the capability isn't in the registry, (c) routes to an **approval card** (`cap.requires_approval` — writes: post message, send email), or (d) **auto-fires** straight to the background-job worker (read-only `list_*`/`get_*`). A regression that flips a write capability's `requires_approval` to false, or that lets an unpinned/disabled connector through the gate, or that drops a capability from validation, would silently execute an unauthorized external action — exactly the "success-theater / silent prod no-op" class this codebase keeps hitting (note the in-code reference to the 2026-05-27 stress run). None of these four branches has a test.
- **Root cause**: the test module (added by a /friend chat-card session) was scoped only to the new `show_*` card variants; the pre-existing action ops were never backfilled. `is_always_active_builtin`, the pin/enable check via `connectors::list`, and `capabilities_for` are all real functions exercised only in production.
- **Impact**: an unauthorized external write (email/message/mutation) auto-fires without an approval card, or a legitimate read is wrongly gated; either erodes the credential-consent contract that is the app's core safety promise.
- **Fix sketch**: add a focused test group seeding `companion_connector` + a stub capability registry: (1) unpinned connector → no job, warning + `note_dispatcher_rejection` System episode written; (2) pinned-but-disabled → same; (3) always-active builtin (e.g. `codebase`) bypasses pin gate; (4) read-only cap → enqueues a `connector_use` job, `cleaned_text` has the OP stripped; (5) `requires_approval` cap → one `companion_approval` row, no job. Assert the invariant: **a write capability NEVER enqueues a job without an approval row, and an ungated connector NEVER enqueues a job.** Verify via row counts in the in-memory pool (`test_pool` already exists).

## 2. `continue_autonomously` flag + chain-cap is untested (runaway-loop guard)
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/dispatcher.rs:1514-1525; src-tauri/src/companion/session.rs:928-955 (chain math), 155-171 (generation cancel)
- **Current test state**: none
- **Scenario**: the `continue_autonomously` arm sets `out.requests_continuation`, which is the single gate that schedules the next autonomous tick (capped at `MAX_AUTONOMOUS_CHAIN = 20`). The chain-index math (`User|Proactive|External` → 1, `Autonomous{i}` → i+1) decides when the hard ceiling fires. The generation-token cancellation (`cancel_pending_autonomy` / `autonomous_superseded`) is documented as a fix for a real 2026-06-07 bug where a user "stop" failed to halt a chain. None of this is tested — a regression re-opens the runaway-loop / un-stoppable-chain defect, which burns subscription tokens and ignores the user.
- **Root cause**: `requests_continuation` parsing lives in dispatcher (testable today); the chain math + generation logic live in `send_turn`/`schedule_autonomous_tick`, which are `!Send` and CLI-spawning, so they were treated as "not unit-testable" and skipped entirely.
- **Impact**: a regression resurrects the un-cancellable autonomous loop (token burn + user-ignored), or the chain cap stops firing.
- **Fix sketch**: (a) dispatcher-level: assert `continue_autonomously` sets `requests_continuation=true` and strips the directive from `cleaned_text`; a turn without it leaves the flag false. (b) Extract the chain-index→next math and the ceiling check into a small pure helper (`next_chain_index(origin)` / `is_over_ceiling(n)`) and unit-test the boundary (19→20 schedules, 20→21 stops). (c) Generation logic is already a free function pair — test `cancel_pending_autonomy()` advances the gen so a captured `my_gen` becomes `autonomous_superseded`.

## 3. Action-op allowlist & anti-hallucination gates (`open_route`, `write_fact`, `update_identity`, unknown action) are untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/dispatcher.rs:1526-1543 (open_route), 1721-1780 (allowlist + write_fact source-gate + update_identity diff-validate)
- **Current test state**: none
- **Scenario**: these guards are security/integrity boundaries. `open_route` rejects routes not in `ALLOWED_ROUTES` so a hallucinated route can't crash navigation. `write_fact`/`write_procedural` are rejected when `sources` is empty (the anti-hallucination provenance contract — facts must be cited). `update_identity` structurally validates the anchored-diff batch (1..=MAX_DIFFS) before it becomes an approval card. Unknown actions not in `ALLOWED_ACTIONS` must be rejected (the `build_oneshot`-missing-from-list comment shows how a single dropped entry silently breaks a whole feature). All untested.
- **Root cause**: same scoping gap as #1 — pre-existing action arms never backfilled.
- **Impact**: a sourceless (hallucinated) fact gets written to long-term memory; a malformed identity diff reaches the approval card and corrupts identity.md on approve; a dropped allowlist entry silently kills an op.
- **Fix sketch**: LLM-generatable batch — these are pure validate-then-route arms. Assert: `open_route` with a non-allowlisted route → no navigation, warning; `write_fact` with empty/missing `sources` → no approval, warning containing "sources"; valid `write_fact` → one approval row; `update_identity` with 0 or >MAX diffs → rejected; unknown `action:"frobnicate"` → warning "rejected unknown action". Invariant to assert: **no memory-write or identity approval row is ever created from an input that fails its provenance/structure gate.**

## 4. TTS / QR parsing + the residual machine-grammar leak guard are untested at the backend authority
- **Severity**: high
- **Category**: missing-assertion
- **File**: src-tauri/src/companion/dispatcher.rs:356-399 (TTS/QR), 1802-1829 (residual OP/`{"op"` strip + trailing-trim)
- **Current test state**: exists-but-weak (only the *frontend* `Bubble.tsx` display-layer strip is tested; the backend `dispatch` — the persistence authority — is not)
- **Scenario**: `dispatch` is what produces the *persisted* `cleaned_text` (the episode the user sees AND that re-enters future-turn recall). The TTS arm parses `TTS: "..."` (JSON-string-or-bare, first-wins, multiple→warning), QR parses a JSON array (capped at 6, empties skipped). The residual safety net at the end strips any `OP:`/`{"op"` line that a rejection branch re-admitted via `cleaned_lines.push(line)`. The frontend Bubble test (`Bubble.test.tsx`) guards the *display* layer, but if the backend leaks a directive into the persisted episode it pollutes recall and the model re-reads its own machine grammar. Backend has no test for any of this.
- **Root cause**: the leak guard was added defensively but never paired with a test; TTS/QR predate the chat-card test session.
- **Impact**: a raw `OP:`/`{"op"` directive persists into an episode → renders to the user AND degrades the next turn's prompt; or a malformed QR/TTS crashes/mis-parses silently.
- **Fix sketch**: dispatcher tests: (1) `TTS: "hi"` → `tts_text == Some("hi")`, stripped from `cleaned_text`; bare `TTS: hi` also parses; second TTS line → warning "keeping first". (2) `QR: ["a","b"]` → `quick_replies == [a,b]`, >6 truncated, empties dropped, bad JSON → warning + line kept-but-stripped. (3) **Leak-guard invariant**: feed a `use_connector` op that hits a rejection branch (re-admits the line) and assert `cleaned_text` contains neither `OP:` nor `{"op"` — closes the silent-leak-into-recall path.

## 5. Pure helpers `clean_segment_for_display` and `is_stale_session_error` are untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src-tauri/src/companion/session.rs:1122-1135 (clean_segment_for_display), 1478-1483 (is_stale_session_error)
- **Current test state**: none
- **Scenario**: `clean_segment_for_display` strips `OP:`/`QR:`/`TTS:`/`PROGRESS:`/`{"op"` from each interim multi-step segment so non-final agentic-step prose can be shown as its own bubble — it must mirror the frontend `stripModelDirectives` or interim bubbles leak directives. `is_stale_session_error` matches the CLI's "no conversation found" / "session id not found" messages to drive the one-shot self-heal `--resume` retry; if its pattern-match drifts from CLI wording, every stale-session turn hard-errors instead of recovering.
- **Root cause**: both are private pure fns in a CLI-spawning module that was treated as un-unit-testable wholesale.
- **Impact**: interim bubbles leak machine grammar; OR stale-session turns stop self-healing and surface a hard error to the user after a CLI session expires.
- **Fix sketch**: LLM-generatable. `clean_segment_for_display`: assert each directive prefix is removed, real prose survives, result trimmed. `is_stale_session_error`: assert it matches the documented phrasings (case-insensitive, "no conversation found", "session id ... not found/does not exist") and does NOT match unrelated errors (e.g. "rate limit", "spawn claude: ..."). Invariant: **only resume-specific failures trigger the session-clear-and-retry.** Make both `pub(crate)` (or test in-module) to exercise.

## 6. `TurnOrigin` → persisted-episode / effective-message mapping (autonomous marker must never leak verbatim) is untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/companion/session.rs:387-463 (open_role/open_content + effective_user_message)
- **Current test state**: none
- **Scenario**: the opening episode and the text actually piped to the CLI both branch on `TurnOrigin`. User turns persist as `User` with raw text; Autonomous persists as `System` `[autonomous continuation #n]` and the CLI receives a crafted directive — the `AUTONOMOUS_CONTINUATION_MARKER` sentinel must NEVER reach the model or persist verbatim (the code comments call this out twice, including on the stale-session retry path). Proactive/External have their own provenance framing. A regression that sends the sentinel as the prompt, or persists it as a user turn, breaks both the transcript readability and the model's behavior.
- **Root cause**: the mapping is inline in the large async `send_turn`; never extracted or tested.
- **Impact**: the `<<athena-autonomous-continuation>>` sentinel leaks to the model (confusing it) or shows in the transcript as if the user typed it; External-source provenance framing is dropped (model treats an automated request as the operator speaking).
- **Fix sketch**: extract two pure helpers — `opening_episode(origin, user_message) -> (EpisodeRole, String)` and `effective_message(origin, user_message) -> String` — and unit-test the matrix. Invariant: **for every non-User origin, `effective_message` never equals the raw marker and carries the documented framing; the opening episode for Autonomous is a System `[autonomous continuation #n]`, never the sentinel.**

## 7. `ChatSearch` result filter (system episodes excluded, case-insensitive) is untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/plugins/companion/ChatSearch.tsx:40-48
- **Current test state**: none (no ChatSearch.test.tsx among the ~28 companion frontend tests)
- **Scenario**: the search overlay filters the transcript to `role === 'user' || role === 'assistant'` AND case-insensitive substring on content. The role filter is a deliberate exclusion — system/fleet/autonomous-marker episodes must NOT appear in user-facing search results (mirrors the backend `companion_list_recent_messages` `fleet-event` filter). A regression that drops the role guard would surface machine-log / fleet-event / autonomous-marker episodes in search.
- **Root cause**: ChatSearch is newer UI; the pure filter was never split out or tested.
- **Impact**: internal machine episodes (autonomous markers, fleet events, proactive system turns) leak into user search results — confusing and a minor information-leak.
- **Fix sketch**: extract the filter to a tiny pure `filterChatResults(messages, query)` and unit-test: case-insensitive match; empty query → []; a `system`-role message containing the query is excluded; user+assistant matches included in order. Low effort, closes a real exclusion invariant. (Alternatively a render test asserting a system message with a matching term yields no result bubble.)
