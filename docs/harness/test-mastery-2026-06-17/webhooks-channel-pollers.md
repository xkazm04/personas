# Test Mastery — Webhooks & Channel Pollers
> Total: 8 findings (2 critical, 4 high, 1 medium, 1 low)

## 1. Webhook HMAC enforcement & rejection paths are entirely untested above the byte-compare
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/webhook.rs:268-512 (process_webhook); 514-539 (verify_hmac_sha256)
- **Current test state**: exists-but-weak
- **Scenario**: `process_webhook` is the public, internet-reachable entry point and the whole auth gate for inbound webhooks. The only tests (`test_hmac_verification_valid/invalid`, lines 613-637) exercise the private `verify_hmac_sha256` primitive. NOTHING tests that `process_webhook` actually rejects: a request with NO signature header (→401), a trigger with no/empty secret (→403 "no HMAC secret configured"), a disabled trigger (→403), a non-webhook trigger (→400), or a valid signature → 200 + published event. A refactor that, say, flips the `match webhook_secret` arm, drops the `&& hex_valid` guard, or short-circuits the `None => return 401` branch would let unsigned/forged payloads spawn persona executions — and every existing test would still pass.
- **Root cause**: HMAC verification was unit-tested at the leaf function; the actual policy decisions (which status for which condition) live in `process_webhook`, which takes `WebhookState`/`HeaderMap`/`Bytes` and was never given a DB-backed harness. `test_pool()` helpers + `create_test_persona` fixtures already exist, so this is wirable.
- **Impact**: An auth bypass in the one externally-reachable surface ships silently — forged webhooks trigger arbitrary persona runs (cost, side effects, data writes) with no signature.
- **Fix sketch**: Add a `#[cfg(test)]` harness that builds a test pool, inserts a webhook trigger (enabled, with secret), and drives `process_webhook` directly. Assert the full status matrix: missing-sig→401, bad-sig→401, no-secret→403, disabled→403, wrong-type→400, valid-sig→200 with `accepted=true` and a real `event_id`. Add a regression test pinning that `verify_hmac_sha256` returns false when `hex_valid` is false even if the (dummy) MAC would compare equal — the invariant is "invalid-hex signatures are always rejected, in constant time."

## 2. `mark_triggered_and_publish` optimistic-concurrency (CAS) + atomic publish has no test
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/webhook.rs:544-607
- **Current test state**: none
- **Scenario**: This function does two business-critical things in one SQLite transaction: (a) a compare-and-swap on `trigger_version` (`WHERE trigger_version = ?expected`, rows==0 → Validation "version conflict"), and (b) inserts the `persona_events` row with an encrypted payload. The comment explicitly says it exists "to prevent orphan trigger advancements." There is no test that a stale `expected_version` is rejected, that a successful call increments `trigger_version` and nulls `next_trigger_at`, that the event row is created with `status='pending'`, or that the payload is encrypted (`payload_iv` set) when non-empty. A regression that drops the `AND trigger_version = ?3` clause (re-introducing the double-fire race) or commits the trigger update without the event insert would pass CI.
- **Root cause**: Transactional/CAS logic was added for a concurrency bug but never pinned with a test; it requires a DB pool, which the unit tests in this file avoid.
- **Impact**: Silent regression to double-firing triggers (duplicate paid executions) or orphaned trigger advances (events lost). This is the data-integrity guarantee for the whole webhook path.
- **Fix sketch**: DB-backed test: seed a trigger at version N; call with N → assert Ok, version now N+1, exactly one event row, `payload_iv IS NOT NULL` for a non-empty payload; call again with stale N → assert `Err(Validation)` and NO new event row. Invariant: "trigger-fire and event-publish are all-or-nothing, and a version mismatch aborts both."

## 3. smee_relay fail-closed parsing of `event_filter` / `allowed_repos` is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/smee_relay.rs:617-657 (filter/allowlist parse); 364-403 (filter + origin gate)
- **Current test state**: none (no `#[cfg(test)]` module in the file)
- **Scenario**: The comments scream that this is a security fix: a present-but-malformed `event_filter`/`allowed_repos` must FAIL CLOSED (skip the relay), because the old `.ok()` turned a restrictive relay into allow-all → "unbounded fan-out / execution storm." An explicit `[]` allowlist must stay permissive (warn-only); `None` (missing column) stays permissive; invalid JSON must disable the relay and record an error. None of this branching is tested, and it's pure-ish logic buried in an async task. Equally untested: the `allowed_repos` origin gate (drop events whose `repository.full_name` isn't allowlisted) and the `event_filter.contains(&event_type)` drop. A regression to `.ok()` reopens the exact storm this code was written to prevent.
- **Root cause**: The fail-closed decision is inline inside `run_smee_relay`'s task spawn, not a testable function; nothing was extracted.
- **Impact**: Re-opening fail-open turns a scoped relay into a firehose — every webhook from every repo fans out to persona executions (cost + side-effect blast radius). Origin-allowlist regression lets a leaked smee URL inject arbitrary repo events.
- **Fix sketch**: Extract the two parse blocks into a pure fn `parse_relay_routing(event_filter: Option<&str>, allowed_repos: Option<&str>) -> Result<(Option<Vec<String>>, Option<Vec<String>>), RoutingError>` and unit-test: invalid JSON → Err (fail closed); `None` → permissive None; `[]` → None (permissive); valid list → Some(list). Also extract the origin/event-type gate into a pure predicate and table-test allowed vs dropped. Invariant: "malformed routing config disables the relay; it never widens it."

## 4. webhook_notifier `tick` watermark-hold-on-failure has no test
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/webhook_notifier.rs:449-535
- **Current test state**: exists-but-weak (pattern/templating/provider helpers are well covered; the orchestration is not)
- **Scenario**: `tick` carries a subtle, business-critical invariant documented in a 15-line comment (lines 504-528): the watermark must advance to the newest event but NEVER past the earliest event that had a failed delivery this tick, so a transient endpoint outage doesn't permanently drop every event due during it. It also splits the composite `created_at|id` watermark and uses tuple-max for tiebreaking. None of this is tested. A regression that advances the watermark to the global max regardless of failure silently drops outbound notifications during any endpoint blip — a "success theater" failure where the tick returns Ok and nothing looks wrong.
- **Root cause**: `tick` needs a DB pool + a mockable processor; the suite only tested the leaf helpers (`pattern_matches`, `templating::render`, `providers::build_body`) that are easy to call without a pool.
- **Impact**: Lost notifications on every transient outbound failure, undetectable in production (watermark already advanced past the lost events).
- **Fix sketch**: Either inject a test `EventProcessor` (the trait already exists — add a `#[cfg(test)]` impl that fails for event #2) over a seeded events table, then assert the watermark held at event #1's `created_at|id`; or extract the watermark-selection (filter `created_at < earliest_failed`, then tuple-max) into a pure fn over `(events, earliest_failed)` and table-test it. Invariant: "watermark never advances past an undelivered event."

## 5. cloud_webhook_relay watermark / dedup / fail-closed-on-publish-error is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/cloud_webhook_relay.rs:225-373 (firing loop); 383-439 (publish_and_upsert_watermark)
- **Current test state**: none
- **Scenario**: Mirrors finding #4 for the cloud path, with extra integrity logic: firings are processed oldest-first; on a publish error it `break`s to hold the watermark at the last contiguous success (cited bug "cloud-sync #4"); `publish_and_upsert_watermark` does the event-insert + watermark-upsert in one transaction so they can't diverge after restart; and `last_seen`/DB watermarks are pruned for triggers that vanished. The cutoff comparison parses RFC3339 with a string-compare fallback. None of: oldest-first ordering, hold-on-failure break, atomic publish+watermark, or RFC3339-vs-string cutoff comparison has a test. A regression that advances the watermark past a failed firing loses that firing forever.
- **Root cause**: Heavy reliance on `CloudClient` (network) made the whole tick look untestable, so nothing was carved out.
- **Impact**: Duplicate cloud-relayed events after restart (watermark/event divergence) or silently-dropped firings (watermark over-advance) — both corrupt the event stream that drives persona runs.
- **Fix sketch**: DB-backed test for `publish_and_upsert_watermark`: assert one event row + watermark upserted on success; on a forced insert failure (e.g. duplicate id) assert NEITHER persists (rollback). Extract the cutoff/`is_newer` timestamp comparison into a pure fn and table-test RFC3339, equal, and unparseable inputs. Invariant: "event and watermark commit together or not at all; the watermark only moves to firings actually published."

## 6. Discord/Slack poller reply extraction & guard logic relies on shared helper tests that miss key branches
- **Severity**: high
- **Category**: missing-assertion
- **File**: src-tauri/src/engine/channel_reply.rs:112-166 (build_reply_text); src-tauri/src/engine/slack_poller.rs:216-224 + discord_poller.rs:212-222 (skip guards)
- **Current test state**: exists-but-weak
- **Scenario**: `channel_reply.rs` tests cover `extract_reply_from_output` nicely, but `build_reply_text` — the function that decides what (if anything) to post back to a user — has NO test for its status branches: `completed` with empty output → "_(persona produced no reply text)_", `failed` → "_(persona run failed: …)_" truncated to 200 chars, `cancelled` → Err (must NOT post), `queued/running` → Ok(None) (try next tick), missing row → Err. These map directly to "do we post a reply, post an apology, or stay silent." A regression that returns Ok(Some) for `cancelled`/`running` would post garbage or duplicate replies into a real Slack/Discord channel. Separately, the pollers' bot/self/subtype/empty-content skip guards (which prevent reply loops) are inline in `poll_channel` and untested.
- **Root cause**: Only the easy pure parser was tested; the status state-machine and the loop-prevention guards weren't extracted/asserted.
- **Impact**: Reply-loops (bot replying to its own messages), posting on cancelled runs, or premature posting on still-running executions — all visible to end users in their chat channels.
- **Fix sketch**: DB-backed test of `build_reply_text` across all five statuses (seed `persona_executions` rows). Extract the "should this message be dispatched" predicate (`!is_bot && !has_subtype && !text.is_empty()` for Slack; `!author_is_bot && !content.is_empty()` for Discord) into a pure fn and table-test it. Invariant: "a reply is posted only for finished runs; bot/system/empty messages never dispatch."

## 7. DeadLetter clustering + filtering (clusterByErrorPattern, jaccard, age filter) — pure logic, no test
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/triggers/sub_dead_letter/DeadLetterTab.tsx:63-124 (tokenizeError/jaccard/clusterByErrorPattern); 183-212 (age filter)
- **Current test state**: none
- **Scenario**: `clusterByErrorPattern`, `jaccard`, and `tokenizeError` are pure functions with a tuned threshold (0.55) that decide how operators triage a dead-letter backlog — grouping "connection refused …:5432" with "…:4.3.2.1:5432" while splitting genuinely different traces. The `old` age filter has off-by-one risk (`age <= 24h → exclude`). None tested. A regression in tokenization (e.g. dropping the digit-strip) shatters groups into singletons, making bulk-retry useless; a flipped jaccard comparator over-merges unrelated failures into one bulk action.
- **Root cause**: Logic lives inline in a `.tsx` component; no test file exists for the triggers feature UI.
- **Impact**: Mis-grouped DLQ → operators bulk-retry the wrong cluster or can't triage at scale. Moderate blast radius (operational, not data-loss).
- **Fix sketch**: LLM-generatable batch (vitest). Export the three helpers (or test via a thin re-export) and assert: identical-modulo-numbers errors cluster together; dissimilar traces stay separate; empty/empty → similarity 1; groups sorted by descending size with a stable `key`. For the age filter, assert the `old` boundary (exactly-24h-old is NOT "old"). Invariant to assert: "errors differing only in volatile tokens (ids/ports/timestamps) land in the same group; structurally different errors do not" — assert the business rule, not the current output snapshot.

## 8. CloudWebhooksTab `webhookUrl` construction & not-connected gate — no test; one dead filter expression
- **Severity**: low
- **Category**: test-structure
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:49-99,128-138,200-201
- **Current test state**: none
- **Scenario**: The URL string built for each row (`${url}/api/deployed/${dep.slug}` vs `'N/A'`) is what the user copies and pastes into a 3rd-party webhook config — if it regresses, every configured webhook silently points at the wrong place. The component also has a self-cancelling filter `(p) => !deployedPersonaIds.has(p.id) || true` (line 200) that always returns true — dead code that signals the intended "hide already-deployed personas" rule was lost; worth pinning whatever the intended behavior is.
- **Root cause**: All logic is inline in the component; no extracted helper and no render test.
- **Impact**: Low — cosmetic/copy correctness, not data integrity; but a wrong webhook URL is a quietly broken integration.
- **Fix sketch**: Extract `buildWebhookUrl(baseUrl, slug)` and unit-test the present/absent-base-url branches. Optionally a small RTL render test asserting the not-connected `EmptyState` shows only when `!relay.connected && !isLoading`. Either fix the `|| true` to express the real rule or add a comment + test documenting that all personas are intentionally selectable.
