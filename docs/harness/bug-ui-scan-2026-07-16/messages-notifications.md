# Messages & Notifications — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Relay tick unconditionally clears `last_error` and always emits `connected: true` — persistent poll failures are invisible
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/shared_event_relay.rs:184-189 (and 234-243, 82-91)
- **Scenario**: A user subscribes to shared-event feeds, then the cloud endpoint starts failing (auth expiry, network, 5xx). Every tick hits the `Err(e)` branch in step 2's poll loop (line 173-179), which records the error per-subscription via `repo::set_error` — but step 5 then sets `st.last_error = None`, bumps `last_poll_at`, and `emit_status` hardcodes `connected: true`. Separately, when `list_enabled_subscriptions` itself fails (line 82-91), `last_error` IS set but the function returns without ever calling `emit_status`, so the frontend never learns of it either.
- **Root cause**: `last_error` is only meant for the subscriptions-query failure, but that path doesn't emit; the success path wipes it and asserts connectivity regardless of per-feed outcomes. `connected` is a constant, not a measurement.
- **Impact**: The relay status indicator reports a healthy, freshly-polled, connected relay indefinitely while zero events flow. Users have no signal that their feeds are dead until they notice missing events; the per-subscription `error` column is written but the emitted status contradicts it.
- **Fix sketch**: Track poll failures in the loop (e.g. `failed_feeds: Vec<slug/error>`); at step 5 set `st.last_error` from the first/aggregated failure instead of `None`, derive `connected` from "at least one poll succeeded", and call `emit_status` in the early-return error branch too.

## 2. `get_thread_summaries` SELECT omits `pm.use_case_id`, and the mapper's `unwrap_or(None)` silently masks it
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/communication/messages.rs:284-292 (mapper at :28)
- **Scenario**: Any message created with a `use_case_id` (Phase C5 capability attribution) is listed via `get_thread_summaries` (the threads inbox). The CTE's outer SELECT enumerates `pm.id … pm.thread_id` explicitly but never selects `pm.use_case_id`; `row_to_message` does `row.get::<_, Option<String>>("use_case_id").unwrap_or(None)`, converting the InvalidColumnName error into `None`.
- **Root cause**: Column list drifted when `use_case_id` was added, and the defensive `unwrap_or(None)` in the shared mapper turns a schema/query mismatch into silent data absence instead of an error. Bonus edge in the same query: the parent join is `pm.created_at = ta.first_at`, so two thread messages sharing an identical `created_at` string produce duplicate summary rows for that thread.
- **Impact**: Every thread parent returned to the UI has `use_case_id: null`, so capability attribution (chips/filters keyed on it) is always empty in the thread list even though the data exists in the row — a silent, hard-to-notice feature outage.
- **Fix sketch**: Add `pm.use_case_id` to the SELECT list; change the mapper to a real `row.get("use_case_id")?` (or keep tolerance only where the column can genuinely be absent). Dedupe parents with `MIN(pm.id)` or `ROW_NUMBER()` on the tie.

## 3. Same-day dedup in `messages::create` silently swallows legitimate repeat alerts and returns the stale (possibly read) row
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/communication/messages.rs:174-203
- **Scenario**: A monitor persona sends "Service down — API unreachable" at 09:00 UTC; the incident is resolved, the user reads the message. At 21:00 UTC the same day a NEW outage produces an identical title+content. `create` finds the morning row via `persona_id + title + content + date(created_at) = date(now)` and returns the old, already-read message; no insert, no unread badge, no OS notification, no delivery dispatch for the new incident. The `date()` comparison is also UTC-day based, so the dedup window is skewed for non-UTC users (two firings 5 minutes apart across UTC midnight are NOT deduped, while 12 hours apart within one UTC day are).
- **Root cause**: The dedup was designed for cascade storms (7 duplicates within 5 minutes) but the key has no time-proximity bound — "same UTC calendar day" conflates rapid-fire duplicates with genuinely distinct recurrences, and returning the existing row means the caller cannot distinguish "created" from "suppressed".
- **Impact**: Silent loss of real notifications for any agent that emits deterministic message text (health checks, threshold alerts); the second incident of a day is unreachable to the user. Callers chaining delivery off the returned message may also re-attach deliveries to the old message id.
- **Fix sketch**: Bound the dedup to a rolling window (e.g. `created_at > datetime('now','-15 minutes')`) instead of `date()`, and only suppress when the existing row is still unread; optionally return a `deduped: bool` so dispatch can skip re-delivery knowingly.

## 4. Catalog "refresh" swallows both cloud-fetch and upsert failures — always returns Ok with stale cache
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/communication/shared_events.rs:34-71 (upsert discard at :62)
- **Scenario**: User clicks "Refresh catalog" while offline, while the cloud client isn't configured (`cloud == None`), or when Supabase errors. All three paths fall through to `repo::list_catalog` and return Ok — the UI shows a successful refresh with stale entries (`subscriber_count`, `status`, new feeds missing). Even when the fetch succeeds, `let _ = repo::upsert_catalog_batch(...)` discards a DB write error, so a failed persist still "succeeds" and the returned list won't contain what the user just saw fetched. Additionally, `upsert_catalog_batch` loops per-entry without a transaction, so a mid-batch failure leaves a partially-updated catalog.
- **Root cause**: "Refresh" was implemented as best-effort cache warming with no channel to report staleness/failure; errors are demoted to `tracing::warn!` that desktop users never see.
- **Impact**: Success theater — users cannot tell a live catalog from a weeks-old cache; a persistent cloud/auth problem is undiagnosable from the UI.
- **Fix sketch**: Return a struct like `{ entries, refreshed: bool, error: Option<String> }` (or propagate `AppError` when the user explicitly requested a refresh), stop discarding the upsert result, and wrap the batch in a single transaction.

## 5. EventBlock conveys run status by icon color only — no accessible name, no tooltip, conflict state hidden on past events
- **Severity**: Low
- **Category**: ui
- **File**: src/features/schedules/components/EventBlock.tsx:42-66
- **Scenario**: A screen-reader user tabs through the Week/Month calendar: each event announces only the (truncated) agent name — success/failure/unknown status (10px icons with no `aria-label`/`title`) and time are not announced, and there is no visible tooltip for sighted users either, even though the label truncates at 9-10px in dense cells. Separately, when a past-failure event also has a schedule conflict, the amber conflict styling is entirely overridden by the failure styling (lines 26-40), so the conflict is invisible in that cell.
- **Root cause**: Status is encoded purely in decorative SVG color/border with no text alternative; the bg/border ternaries treat kind and conflict as mutually exclusive.
- **Impact**: WCAG 1.1.1/1.4.1 gaps (status by color alone, no non-text alternative); keyboard/AT users cannot distinguish a failed run from a successful one; conflicting past-failure events lose their conflict cue.
- **Fix sketch**: Add `aria-label`/`title` composing agent name + kind + time (e.g. "Reporter — failed, 09:00") and `aria-hidden` on the icons; keep a small conflict indicator (dot or ring) that renders independently of `event.kind`.
