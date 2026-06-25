# Webhooks & Channel Pollers — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: webhooks-and-channel-pollers | Group: Triggers & Events
> Total: 5 | Critical: 0 | High: 3 | Medium: 2 | Low: 0

## 1. Smee relay `allowed_repos` origin gate is forgeable and HMAC is absent — anyone with the channel URL can inject arbitrary events
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Authentication / unauth event injection
- **File**: src-tauri/src/engine/smee_relay.rs:384 (gate), :636-669 (default allow-all + warn-only)
- **Scenario**: An attacker who learns a smee.io channel URL (a third-party-hosted bearer secret that is also logged, shared, and visible in the UI) POSTs `{"x-github-event":"push","body":{"repository":{"full_name":"acme/allowed-repo"},...}}` directly to smee.io. The relay reads `body.repository.full_name` **from the attacker-controlled JSON**, finds it in `allowed_repos`, and publishes a `PersonaEvent` that targets `target_persona_id` and spawns an LLM execution. With the default config (`allowed_repos` = None) every event is accepted with only a one-time WARN.
- **Root cause**: There is no signature verification of the inbound payload at all (the code comment concedes HMAC is a deferred follow-up), and the only origin control compares an attacker-supplied field against the allowlist. The in-code claim that the allowlist is a "defense-in-depth check that only events from expected GitHub repos reach the local event bus" is false because the matched field is part of the untrusted body.
- **Impact**: Forged external events drive persona executions (LLM cost, prompt-injection vector, side effects via emit_event/agent actions). Meets the Critical "signature bypass / unauth event injection" bar; rated High only because possession of the channel URL is a (weak) precondition. Bus rate-limiting caps volume but not the first malicious event.
- **Fix sketch**: Stop advertising `allowed_repos` as a security control. Verify GitHub's `x-hub-signature-256` (forwarded in the smee envelope) against the configured webhook secret over the canonicalized body, or — since smee re-serializes JSON and byte-exact HMAC is unreliable — require a shared secret token in a header/path that smee forwards, and fail-closed when neither the secret nor a verifiable signature is present. At minimum, document that a smee channel URL is a full bearer credential.
- **Value**: impact=8 effort=5

## 2. Concurrent webhook deliveries to the same trigger return 500 and drop the event (optimistic-version conflict conflated with publish)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Race condition / dropped event
- **File**: src-tauri/src/engine/webhook.rs:578 (trigger_rows==0 → Validation), :499-510 (→ 500)
- **Scenario**: A repo bursts several webhooks at once (e.g. GitHub `push` + `check_run` + `status`) to the same `/webhook/{trigger_id}`. Axum runs the handlers concurrently; both read `trigger.trigger_version = N` in step 1, then both run `UPDATE persona_triggers ... WHERE id=? AND trigger_version = N`. SQLite serializes the writes: the first commits (version→N+1), the second matches **0 rows**, returns `Validation("Trigger version conflict")`, and `process_webhook` returns HTTP 500 with the event **never inserted**.
- **Root cause**: The optimistic-concurrency check (meant to stop orphan trigger-metadata advancement vs. the scheduler) is fused into the same transaction that publishes the event, so a benign metadata race silently discards a legitimately-received external event.
- **Impact**: Lost inbound events on bursty triggers. GitHub retries on 5xx (latency + possible repeat conflicts), but generic/once-only senders drop the event permanently. The webhook log records a 500, but no event is published and no DLQ entry is created.
- **Fix sketch**: Always insert the `persona_event` (the durable record of "we received this"). Update trigger bookkeeping best-effort with `WHERE id=?` (last-writer-wins on `last_triggered_at`), or move the version guard to only the scheduler's `next_trigger_at` path. Never let a metadata-row conflict abort event publication.
- **Value**: impact=7 effort=3

## 3. Slack poller skips messages on a burst larger than FETCH_LIMIT (cursor jumps to newest page, gap lost forever)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Cursor/offset skip — data loss
- **File**: src-tauri/src/engine/slack_poller.rs:352-365 (fetch), :289-291 (cursor advance), :415-427 (has_more warning)
- **Scenario**: More than 50 user messages land in a channel between two 5s ticks. `conversations.history?oldest={cursor}&limit=50` returns the **newest** 50 in `[cursor, now]` with `has_more=true`. The loop sets `newest_ts` to the newest of that page and writes it as the cursor. Next tick fetches with `oldest=newest_ts`, so every message older than this page but newer than the previous cursor is never fetched — permanently skipped.
- **Root cause**: `oldest` returns the most-recent page, not the oldest-unseen page; advancing the cursor to the page maximum strands the gap. (Unlike Discord's `after`, which drains oldest-first and self-heals.) The code acknowledges this with a WARN but does not prevent the loss.
- **Impact**: Inbound Slack messages silently dropped during traffic spikes — persona never sees them, user gets no reply. The only signal is a log line.
- **Fix sketch**: When `has_more` is true, page backward with `latest`/`next_cursor` to drain the full range before advancing, or advance the cursor only to the **oldest** ts in the returned page and re-fetch so subsequent ticks walk forward without a gap. The durable fix is Socket Mode / Events API (noted in module docs).
- **Value**: impact=6 effort=5

## 4. Inbound Discord/Slack message is permanently dropped (never retried) when `execute_persona_inner` fails
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Silent failure / no retry path
- **File**: src-tauri/src/engine/discord_poller.rs:258-283 (log error, advance cursor), :615-621 (pending-reply filter excludes errored rows); mirror in slack_poller.rs:264-291, :626-636
- **Scenario**: A user message dispatch fails (executor busy, validation, transient error). The poller writes a `discord_inbound_messages` row with `execution_id = NULL, error = Some(...)`, then advances the cursor past the message. The reply pass selects only rows with `execution_id IS NOT NULL AND error IS NULL`, and `message_already_logged` now returns true, so the message is never re-dispatched.
- **Root cause**: A failed dispatch is recorded as terminal with no retry/backoff and no surfacing — `discord_inbound_messages` errors are not shown in the DeadLetterTab (which only lists `persona_events`).
- **Impact**: The user's message is silently lost; no execution, no reply, no operator-visible queue entry. Bounded by how often dispatch hard-fails, but each loss is a dead-end conversation.
- **Fix sketch**: Treat dispatch errors as retryable: leave the cursor able to re-pick (or add a bounded `attempts` column with backoff), and either surface errored inbound rows in the UI or route them to the dead-letter queue. Don't both record an error and advance past it.
- **Value**: impact=6 effort=3

## 5. Cloud webhook relay fetches only the 20 most-recent firings per trigger per poll — a burst >20 strands the oldest
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: Magic constant / cursor skip
- **File**: src-tauri/src/engine/cloud_webhook_relay.rs:200 (`list_trigger_firings(&trigger_id, Some(20))`)
- **Scenario**: A cloud webhook trigger fires more than 20 times between two relay polls. The API returns the newest 20; the loop processes them oldest-first and advances the per-trigger watermark to the newest processed `fired_at`. Firings newer than the previous watermark but older than this page of 20 are never fetched, and once the watermark passes them they are excluded by the `fired_at > cutoff` check — lost.
- **Root cause**: The page size `20` is an undocumented magic constant with no relation to the poll interval, and there is no `has_more`/pagination handling — the watermark logic assumes the page always covers the full unseen range. Same class of skip as finding #3, here masked by a hard-coded limit.
- **Impact**: Relayed cloud firings dropped during bursts; the desktop persona misses events that the cloud orchestrator recorded. Silent (no equivalent of the Slack `has_more` warning).
- **Fix sketch**: Document the cap and its interval assumption; detect a full page (count == limit) and paginate (or raise the limit) to drain all firings newer than the watermark before advancing it. Add a WARN on a full page so the skip is diagnosable.
- **Value**: impact=5 effort=3
