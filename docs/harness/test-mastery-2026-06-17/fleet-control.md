# Test Mastery — Fleet Control
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

## 1. `companion_record_fleet_event` lifecycle dispatch + exit reconciliation is entirely untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/companion/fleet_bridge.rs:55-165, 446-457
- **Current test state**: none
- **Scenario**: This is the single chokepoint that turns every Fleet lifecycle event into an Athena episode + operative-memory update. `parse_state_token` (446-457) is a pure validator mapping seven snake_case tokens to `FleetSessionState`; a typo or a dropped variant silently returns `None`, which surfaces as a `Validation` error and the event is never recorded — Athena's "what happened" memory goes blank for that transition with no test catching the regression. The exit branch (126-156) is the highest-blast-radius path: it calls `synthesize_session_summary` BEFORE `record_fleet_event` (the Direction-4 ordering invariant), then runs `reconcile_if_dispatched` and returns early. If a refactor reorders those, the episode body reverts to the bare "exited code N" line and the cross-session wrap-up never fires — a silent data-quality regression. The `spawned`/`exited`/`state_changed` kind discriminator (63-85) has three error paths (unknown kind, unknown state token, missing state) with zero assertions.
- **Root cause**: The whole module is behind `#[tauri::command]` + `State`/`AppHandle`, so it reads as "untestable IPC glue" and was skipped — but `parse_state_token`, `format_proactive_wrap_up`, and the kind→`FleetEventKind` mapping are pure and trivially extractable.
- **Impact**: A breaking change to the state-token vocabulary or the exit ordering corrupts Athena's episodic + operative memory silently; the user sees an agent that "forgot" what the fleet did, with no failing test.
- **Fix sketch**: Add a `#[cfg(test)] mod tests` exercising `parse_state_token` over all seven valid tokens + an invalid one (assert exact variant mapping and `None`); table-test the kind discriminator builds the right `FleetEventKind` for spawned/exited/state_changed and `Err(Validation)` for the three bad shapes. LLM-generatable: invariant = "every `state_to_token` output in hooks.rs round-trips through `parse_state_token`" (a property test pinning the two enum-string maps together so they can't drift).

## 2. `resolve_session_id` cwd-fallback tiebreaker and `apply_hook` don't-downgrade-Exited guard are untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/fleet/hooks.rs:158-209, 213-306
- **Current test state**: none
- **Scenario**: `resolve_session_id` is the routing brain of the hook receiver. Pass 1 picks the *most-recently-created unbound* session for a cwd; pass 2 falls back to the *most-recently-active bound* session. With two parallel `claude` runs in one repo, a wrong tiebreaker binds a SessionStart's `claude_session_id` to the wrong tile — every later hook for that conversation then routes to the wrong session (state, "Needs you" banner, and Athena's send-input target all land on the wrong PTY). `apply_hook` has the safety guard at 269-273 ("don't downgrade an Exited session — process death is authoritative"); if that regresses, a late `Stop`/`Notification` hook resurrects a dead session to Idle/AwaitingInput, and the orchestrator may try to type into a closed PTY.
- **Root cause**: Logic is tied to the global `registry()` singleton and an `AppHandle` for emission, so it wasn't unit-tested — but the resolution algorithm only needs the session map and the state mutation is a pure function of (current_state, event_kind).
- **Impact**: Cross-session mis-binding in the most common real workflow (parallel runs on one project) and zombie-session resurrection — both silent, both user-visible as "Athena did something to the wrong terminal".
- **Fix sketch**: Extract the pure selection (`fn pick_session(map, csid, cwd) -> Option<id>`) and pure transition (`fn next_state(cur, event_kind, message) -> Option<(state, reason)>`) and unit-test: csid match wins over cwd; two unbound same-cwd → newest created; all-bound same-cwd → most-recently-active; Exited sessions excluded from cwd passes; `next_state(Exited, "stop")` → `None` (no downgrade) but `next_state(Exited, "sessionend")` allowed.

## 3. FleetBroadcastModal asserts only the all-success toast — the partial/total-failure branches it was built to fix are untested
- **Severity**: high
- **Category**: missing-assertion
- **File**: src/features/plugins/fleet/FleetBroadcastModal.tsx:84-114; test src/features/plugins/fleet/__tests__/FleetBroadcastModal.test.tsx
- **Current test state**: exists-but-weak
- **Scenario**: The component comment (96-101) calls the broadcast outcome toast "the single most important feedback in the feature" and documents a deliberate fix from "0 of N delivered shown as success" to three explicit outcomes (green all / amber partial / red none). The existing test only exercises a single session that resolves successfully and never asserts a toast at all — it checks `writeInput` was called and the seeded text. The exact regression the code was written to prevent (a partial or total failure rendering the wrong colour/text, or no feedback) would pass the suite today. Also untested: per-session failures do NOT abort the batch (the `try/catch` continues the loop), and the empty-text / no-selection / `sending`-guard early return.
- **Root cause**: Test scoped narrowly to the "Apply skill" `initialText` feature it shipped with; the send path's error accounting was treated as out of scope.
- **Fix sketch**: Mock `useToastStore.getState().addToast` (spy). With two targets where `writeInput` rejects for one, select both and send → assert `addToast('Sent to 1 of 2 sessions — 1 failed', 'warning')`. With all rejecting → assert `('Broadcast failed — 0 of 2 delivered', 'error')`. With all resolving → assert the success toast string + severity. Invariant: `sent + failed === total` and severity is `success` iff `failed === 0`.

## 4. `approvalsForSession` parses untrusted approval JSON to gate PTY writes — no test
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/plugins/fleet/fleetAttention.ts:87-110
- **Current test state**: none (sibling `sessionAttention`/`isNeverAttached`/`craftStalePrompt` ARE tested in fleetAttention.test.ts; this function is skipped)
- **Scenario**: This function decides which of Athena's pending approvals surface *on a specific session's tile* — i.e. which proposed PTY writes the operator sees attached to which terminal. It filters by action allowlist (`fleet_send_input`/`fleet_intervene`), `JSON.parse`es each approval's `paramsJson`, matches `params.session_id` against the tile, and extracts the text (`text` for send_input, falls back to `message` for intervene, else `''`). A regression in the `session_id` equality or the action gate would surface a write-into-PTY proposal on the *wrong* tile, or surface a non-fleet action that shouldn't appear there. Malformed `paramsJson` must be skipped silently (the `catch` continue) — untested, so a thrown parse error mid-list could drop later valid approvals.
- **Root cause**: The pure sibling helpers were tested but this one (the one touching untrusted serialized payloads and the security-relevant session match) was missed.
- **Fix sketch**: LLM-generatable table test. Invariants: only `fleet_send_input`/`fleet_intervene` survive the action filter; only approvals whose `params.session_id === sessionId` are returned; `text` resolves from `text`, else `message`, else `''`; a malformed `paramsJson` entry is skipped without dropping a valid entry that follows it; a valid entry with a non-matching session_id is excluded.

## 5. `format_proactive_wrap_up` headline truncation + outcome mapping are untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src-tauri/src/commands/companion/fleet_bridge.rs:379-407
- **Current test state**: none
- **Scenario**: Builds the user-facing chat card for a completed fleet operation. It maps `status_token` → outcome word (op_completed→"completed", op_failed→"failed", else "finished"), takes the first non-empty summary line as the headline, and truncates at 240 chars with an ellipsis. An off-by-one in the 240 boundary, a wrong outcome word, or a panic on multi-byte UTF-8 (it uses `chars().count()`/`chars().take()` — correct today, but a refactor to byte slicing would panic mid-codepoint) would ship a malformed or crashing notification. Pure function, no IO — cheap to pin.
- **Root cause**: Treated as cosmetic string formatting, but it's the only user-visible artifact of the reconciliation path and has real boundary logic.
- **Fix sketch**: LLM-generatable. Invariants: each of the three status tokens maps to its outcome word; a 300-char single-line summary yields a headline of exactly 240 chars + '…'; a multi-line summary uses the first non-empty line; an empty summary yields a card with no headline tail; a multi-byte summary at the 240 boundary does not panic and produces valid UTF-8.

## 6. `attention_throttle` 60s dedup depends on wall-clock `now_ms()` — not deterministically testable as written
- **Severity**: medium
- **Category**: flaky-nondeterministic
- **File**: src-tauri/src/commands/companion/fleet_bridge.rs:167-203
- **Current test state**: none
- **Scenario**: `orchestrate_on_awaiting` must not re-wake Athena about the same session more than once per 60s (a session bounces AwaitingInput↔Running, and Athena's own writes change state, so without the throttle an orchestration turn loops and burns tokens/triggers a feedback storm). The dedup compares `now_ms()` against a per-session last-fire map and GCs entries older than 10×. This is process-wide mutable static driven by real wall-clock — there is no seam to test the "second call within the window is suppressed, a call after the window is allowed, GC drops stale keys" behavior without sleeping, and the static state leaks between tests (the same hazard `registry()` tests avoid by using `FleetRegistry::default()`).
- **Root cause**: Time is read directly from `now_ms()` and state is a file-scoped `OnceLock<Mutex<HashMap>>` with no injectable clock or reset hook.
- **Fix sketch**: Extract the decision into a pure `fn should_fire(map: &mut HashMap<String,i64>, session_id, now: i64, min_interval: i64, gc_window: i64) -> bool` taking `now` as a parameter; unit-test suppression-within-window, allow-after-window, and that GC prunes keys past 10×. Leaves the static + `now_ms()` only as a thin wall-clock adapter. Avoids ever sleeping in a test.

## 7. No coverage ratchet on the Fleet area, and `_commands_compile` is a no-op assertion-free "test"
- **Severity**: low
- **Category**: quality-gate
- **File**: vitest.config.ts:10-18; src-tauri/src/commands/fleet/commands.rs:276-296
- **Current test state**: exists-but-weak
- **Scenario**: `vitest.config.ts` has no `coverage` block at all, so nothing prevents new Fleet UI logic (broadcast accounting, attention mapping, tile-preview reconciliation) from landing untested — a new-code ratchet would catch findings #3/#4 class regressions before review. On the Rust side, `_commands_compile` (commands.rs:280-288) is a compile-only "test" that constructs futures and drops them — it asserts nothing about behavior and reads as coverage it isn't. Honest, but it can mask the absence of real command tests if someone greps for "fleet command test".
- **Root cause**: No per-area coverage policy; the compile-guard pattern is fine as a build check but is mislabeled as a test module.
- **Fix sketch**: Add a vitest `coverage` block with a v8 provider and a modest new-code threshold scoped to `src/features/plugins/fleet/**` (advisory first, then blocking once #3/#4 land) rather than a global backfill mandate. Rename/comment `_commands_compile` so it's unmistakably a compile guard, not a behavioral test, and add at least one real behavioral test (e.g. `fleet_terminal_previews` clamps `lines` to 1..=200) so the module has genuine assertion coverage.
