# Test Mastery — Triggers & Event Registry
> Total: 8 findings (2 critical, 3 high, 2 medium, 1 low)

## 1. Dead-Letter Queue retry/recovery path has zero tests
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/communication/events.rs:603-961 (publish_dead_letter, move_to_dead_letter, retry_dead_letter, discard_dead_letter, bulk_retry_dead_letter, bulk_discard_dead_letter, increment_retry_or_dead_letter, get_dead_letter_events, count_dead_letter, get_retry_eligible)
- **Current test state**: none (the 38-test module covers publish/search/subscriptions but NOT a single DLQ function)
- **Scenario**: An event whose subscriber executions fail must retry up to a cap, then land in the DLQ where a user can manually retry (bounded by `MAX_MANUAL_RETRIES = 5`) or discard. The retry-cap predicate is enforced purely in SQL (`retry_count < ?2`) and the three failure modes (`not_found` / `wrong_status` / `retry_exhausted`) are distinguished by a post-UPDATE re-read. A regression in the SQL `CASE` of `increment_retry_or_dead_letter` (the `retry_count + 1 >= ?3` boundary), or in the `WHERE status = 'dead_letter'` guard, slips through TODAY — silently dropping events or letting them retry forever.
- **Root cause**: DLQ was added after the original test sweep; the TOCTOU-hardening comments describe the intent but no test exercises the atomic guards.
- **Impact**: Event-driven triggers are the product's automation backbone. A broken retry cap means either infinite retry storms (cost + load) or events that vanish without ever reaching a persona — automations silently stop firing with no error surfaced.
- **Fix sketch**: Add `#[cfg(test)]` cases using `init_test_db()`: (a) `increment_retry_or_dead_letter` flips `failed`→`dead_letter` exactly at `max_retries` and not before; (b) `retry_dead_letter` succeeds from DLQ, bumps `retry_count`, resets to `pending`, and returns `RetryExhausted` once `retry_count == MAX_MANUAL_RETRIES`; (c) `retry_dead_letter` on a non-DLQ id returns `NotFound`; (d) `move_to_dead_letter` rejects a non-`failed` event with a Validation error; (e) `discard_dead_letter` rejects non-DLQ. Invariant to assert: an event can never exceed `MAX_MANUAL_RETRIES` manual retries regardless of call ordering.

## 2. Bulk DLQ partial-failure semantics + batch cap untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/communication/events.rs:790-913 (bulk_retry_dead_letter, bulk_discard_dead_letter); src-tauri/src/commands/communication/events.rs:224-253 (MAX_BULK_DLQ_BATCH guard)
- **Current test state**: none
- **Scenario**: An operator selects "Retry selected" on a mixed batch (some in DLQ, some already retried, some exhausted, some missing). The contract is: each id is evaluated independently, the whole thing commits atomically, and each failure is bucketed into `succeeded` vs `failed{id,reason}` with reason tokens `not_found`/`wrong_status`/`retry_exhausted` that the frontend maps to labels. The command layer also rejects batches > 200. None of this is verified — a regression that aborts the whole batch on the first bad id, or mislabels a `reason` token (breaking the UI's `tokenLabel` mapping), ships undetected.
- **Root cause**: Per-id outcome accounting and the transaction boundary are intricate but were never pinned by a test; the 200-item `MAX_BULK_DLQ_BATCH` validation in the command has no test at all.
- **Impact**: A stuck or mislabeled bulk operation strands dead-lettered automations; an unbounded batch can blow the IPC payload / SQLite txn / CDC emit burst the cap was added to prevent.
- **Fix sketch**: Repo test: seed a 4-id batch (1 valid DLQ, 1 `failed`-status, 1 missing, 1 at retry cap) and assert `succeeded == [valid]` and the exact `failed` reason tokens; assert the batch is atomic (all-or-nothing visible). Command test (or repo-level helper): assert `bulk_retry_dead_letter` of 201 ids returns a Validation error and writes nothing. Invariant: `succeeded.len() + failed.len() == ids.len()` and every reason ∈ the three documented tokens.

## 3. PersonaEventStatus state machine (can_transition_to / from_db / as_str) has no unit tests
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/models/event.rs:35-94 (whole `impl PersonaEventStatus`; file has no `#[cfg(test)]` module)
- **Current test state**: none — the lifecycle rules are only exercised indirectly and partially via `update_status` happy-path tests
- **Scenario**: `can_transition_to` is the single source of truth for the event lifecycle (Pending→Processing→terminal, Failed→DeadLetter, DeadLetter→Pending/Discarded, plus direct-terminal shortcuts for mock/seed). `update_status` and `move_to_dead_letter` both depend on it being exactly right. A regression that, e.g., allows `Delivered→Processing` (re-processing a delivered event) or forbids `Failed→Pending` (breaking auto-retry re-queue) would not be caught — the existing tests only check Pending→Completed and Pending→Failed.
- **Root cause**: The matrix is a pure function ideal for exhaustive testing, but it lives in the model file which was never given a test module.
- **Impact**: Wrong transitions corrupt the event lifecycle: double-dispatch (duplicate persona runs / duplicate side effects) or stuck events that never retry. Highest blast radius for the lowest test cost.
- **Fix sketch**: This is **llm-generatable**. Generate a table-driven test over all (from, target) pairs asserting `can_transition_to` matches the documented lifecycle exactly (assert the full allow-list AND that everything else is rejected — not just spot checks). Invariants to assert: terminal states (`Delivered`/`Completed`/`Skipped`/`Discarded`) have no outgoing transitions; `from_db` round-trips every variant via `as_str` and falls back to `Pending` (not panic) on garbage input; `Display` == `as_str`.

## 4. Payload encryption-at-rest round-trip + decrypt-failure handling untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/communication/events.rs:92-149 (encrypt_optional_payload, row_to_event decrypt branch)
- **Current test state**: exists-but-weak — `test_publish_and_get_event` asserts a payload round-trips, but it never asserts the stored value is actually ciphertext, and the decrypt-failure path (return `None` payload + surface error in `error_message`, never leak ciphertext) is completely untested
- **Scenario**: Event payloads can carry sensitive data and are AES-encrypted at rest (`payload_iv` present). On decrypt failure the code deliberately returns `payload = None` and appends `[Decryption failed: …]` to `error_message` so ciphertext is never leaked to the frontend. A regression that returns the raw ciphertext (or panics) on a bad IV would leak encrypted blobs into the UI / live stream and is invisible today.
- **Root cause**: The security-relevant failure branch (lines 117-129) has no negative test; the happy-path test can't tell encryption from plaintext storage because it reads back through the same decrypt path.
- **Impact**: Silent ciphertext leak to the frontend, or a panic in `row_to_event` that takes down `list_events`/live stream. Data-confidentiality regression.
- **Fix sketch**: (a) Publish with a payload, then read the raw `payload` + `payload_iv` columns directly via SQL and assert the stored payload != plaintext and `payload_iv` is non-empty. (b) Corrupt the stored `payload_iv` (or ciphertext) with a direct UPDATE, then call `get_by_id` and assert `payload.is_none()` and `error_message` contains "Decryption failed" — proving no ciphertext leaks. Invariant: a row that fails to decrypt yields `None` payload, never ciphertext, never a panic.

## 5. publish_event rate limiting is unverified at the command layer
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/communication/events.rs:59-86 (publish_event), 144-180 (test_event_flow)
- **Current test state**: none for the rate-limit branch (rate_limiter.rs has its own 8 unit tests, but the wiring — per-source key `event:{source_type}`, `event_source_max` from tier config, `EVENT_SOURCE_WINDOW`, and the `AppError::RateLimited` with retry-after — is never tested together)
- **Scenario**: A misbehaving or malicious external source firing thousands of events/min must be throttled per `source_type`. The throttle key is built as `event:{source_type}`; if a refactor changed the key composition (e.g. dropped the source_type, or shared one bucket across all sources), one noisy source could either starve all others or bypass the limit entirely. The error must carry a usable `retry_after`.
- **Root cause**: Command-layer rate-limit wiring sits above the unit-tested limiter and below the IPC boundary, in an untested seam.
- **Impact**: A broken per-source key turns the abuse guard into either a global denial-of-service (one source blocks everyone) or a no-op (no protection) — directly affects platform stability and cost.
- **Fix sketch**: Add a test that drives `RateLimiter::check("event:src-a", max, EVENT_SOURCE_WINDOW)` up to and past `event_source_max` and asserts the (N+1)th call returns `Err(retry_after)`, while a *different* `event:src-b` key in the same window still succeeds — pinning the per-source isolation. If the command needs `AppState`, assert at minimum the key-composition + error mapping via a thin helper. Invariant: throttling is per-`source_type`, and exceeding the cap yields `RateLimited` with `retry_after > 0`.

## 6. LiveStreamTab event-ingest reducer (dedup, batching, pause/resume, cap) is pure logic with no test
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/triggers/sub_live_stream/LiveStreamTab.tsx:73-202 (CDC ingest reducer, pause queue replay, 200-row cap, eventIdIndex maintenance, filteredEvents/resolveSourcePersona)
- **Current test state**: none — no frontend test exists for the triggers feature; api/events.test.ts only covers thin invoke wrappers
- **Scenario**: This is the densest pure logic in the context: it rejects CDC `{action,table,rowid}` notifications lacking `id`/`event_type`, dedups by id, replaces status updates in place vs. prepending new events, replays the paused queue in original order on resume, and trims to 200 while keeping `eventIdIndex` consistent. A regression — e.g. dropping events that share the cap boundary, leaving stale ids in `eventIdIndex` after trim (so a later re-emit is wrongly deduped), or losing paused events on resume — corrupts the operator's live view of automation health with no test to catch it.
- **Root cause**: The logic is entangled with React refs/rAF inside one component, so it was never extracted or tested; reviewers can't reason about correctness without one.
- **Impact**: An untrustworthy live event stream during incidents — events appear missing or duplicated, undermining the primary observability surface for triggers.
- **Fix sketch**: Extract the ingest/merge step (current list + incoming batch + id index → next list, capped at 200) into a pure helper and unit-test it: (a) a non-event CDC blob is rejected; (b) a status update on an existing id replaces in place (length unchanged); (c) a new id prepends; (d) at 201 events the oldest is evicted AND its id removed from the index; (e) pause→queue→resume replays in original order with no loss. `resolveSourcePersona`/`sanitizeName` are separately **llm-generatable** (invariant: `source_type` "persona:<safe_name>" resolves by `source_id` first, then sanitized-name match).

## 7. No quality gate ratcheting coverage on the events repo / event-registry parity
- **Severity**: medium
- **Category**: quality-gate
- **File**: src-tauri/src/engine/event_registry.rs:21-273 (ALL_EVENT_NAMES, Rust↔TS parity); src-tauri/src/db/repos/communication/events.rs (no per-area threshold)
- **Current test state**: exists-but-weak — there is a healthy repo test suite, but DLQ/lifecycle gaps (findings 1-3) prove coverage isn't gated; the registry's documented "Rust<->TS parity gate" and `ALL_EVENT_NAMES` exhaustiveness have no automated check in this context's files
- **Scenario**: The registry comments promise a Rust↔TS parity gate ("the TypeScript side picks up the new name from src/lib/eventRegistry.ts") and dynamic events are "registered here for the Rust<->TS parity gate." If that gate isn't actually wired, a developer adding `INCIDENT_RESOLVED` on one side but not the other ships a silently dead event subscription — exactly the failure the registry was built to prevent.
- **Root cause**: Advisory intent documented in comments without an enforced check; no new-code coverage ratchet on the highest-risk repo so DLQ/lifecycle code merged untested.
- **Impact**: Drift between Rust emitters and TS listeners → events fired into the void (automations never trigger) with no compile error and no test failure.
- **Fix sketch**: (a) Add a test asserting `ALL_EVENT_NAMES` has no duplicates and that every name parses as a safe type string. (b) Verify (or add) a parity test that reads `src/lib/eventRegistry.ts` and asserts the name sets match `ALL_EVENT_NAMES`. (c) Apply a new-code coverage ratchet (e.g. cargo-llvm-cov diff gate, blocking) scoped to `repos/communication/events.rs` so future DLQ/lifecycle changes can't merge assertion-free. Calibrate as advisory first, flip to blocking once findings 1-3 land.

## 8. Composite-cursor pagination tiebreaker (same-millisecond ordering) not asserted
- **Severity**: low
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/communication/events.rs:353-437 (get_in_range, get_recent_after composite-cursor branches)
- **Current test state**: exists-but-weak — `test_search_pagination` checks `has_more`/limit but never the `(created_at, id)` tiebreaker that the doc comments call out as the correctness-critical part
- **Scenario**: Many events can share a `created_at` (same millisecond under burst). The composite `(created_at, id)` cursor in `get_recent_after` exists so the webhook notifier admits same-timestamp siblings exactly once. A regression to a bare `created_at > cursor` would drop boundary events (missed outbound deliveries) or, with `>=`, re-deliver them. The legacy `after_id = None` fallback path is also untested.
- **Root cause**: Pagination tests assert counts, not ordering stability across identical timestamps.
- **Impact**: Outbound webhook deliveries silently skipped or duplicated under load — moderate but real, bounded to the notifier's drain path.
- **Fix sketch**: Insert ≥3 events with an identical hand-set `created_at` and distinct ids (direct INSERT), then page `get_recent_after(Some(ts), Some(id_k), limit)` and assert exactly the siblings with `id > id_k` are returned, none dropped, none duplicated; cover the `after_id = None` legacy branch too. Invariant: every event is returned exactly once across a full cursor walk, even when timestamps collide.
