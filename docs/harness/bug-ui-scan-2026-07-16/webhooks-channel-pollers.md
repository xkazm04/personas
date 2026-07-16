# Webhooks & Channel Pollers — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)

## 1. One transient post failure permanently drops a channel reply — no retry ever
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/discord_poller.rs:339 (same pattern: src-tauri/src/engine/slack_poller.rs:341)
- **Scenario**: A user messages a persona in Discord; the persona execution finishes; when the reply pass POSTs it, Discord returns a 429 (routine rate limit under burst), a 5xx, or the request hits a network blip / the 8s timeout. `post_reply` errors and the row is stamped with `mark_reply_error`.
- **Root cause**: `list_pending_replies` filters `AND error IS NULL` (discord_poller.rs:618, slack_poller.rs:715), and `mark_reply_error` writes `error` for *transient* transport failures exactly the same as for permanent ones. There is no retry counter, no error classification, and nothing ever clears the column — the design assumes "post failed once" ⇒ "post will never succeed".
- **Impact**: The persona did the work, the execution shows `completed`, but the user in the channel gets silence — permanently. Under any burst (Discord 429s are expected behavior, not an anomaly) a fraction of replies is silently lost with zero surfacing anywhere in the UI.
- **Fix sketch**: Distinguish transient (429/5xx/timeout/connect) from permanent (4xx like unknown channel, missing perms) failures. For transient ones leave `error` NULL and add a `reply_attempts` counter with a cap (and honor Discord's `Retry-After`); only stamp `error` when attempts are exhausted or the failure is clearly permanent.

## 2. Setting PERSONAS_SMEE_WEBHOOK_SECRET verifies HMAC over re-serialized JSON — legitimate GitHub events are near-always rejected
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/smee_relay.rs:423
- **Scenario**: An operator follows the module's own guidance ("Set PERSONAS_SMEE_WEBHOOK_SECRET to the GitHub webhook secret to enable HMAC verification") and sets the env var to the correct secret. Every real GitHub delivery relayed through smee is then dropped with "HMAC verification failed".
- **Root cause**: GitHub signs the *raw request bytes*, but the relay hashes `serde_json::to_vec(&body)` — a re-serialization of smee's already-re-parsed body. The project's serde_json has no `preserve_order` feature (verified: absent from src-tauri/Cargo.toml), so `Map` is a BTreeMap and keys come out alphabetically sorted; GitHub payloads are not alphabetized, whitespace/escaping also differ. The hashed bytes essentially never equal what GitHub signed, and the gate fails closed (line 428: `continue`). The code comment ("operators enabling verification should expect strict matching") acknowledges byte drift but treats a deterministic mismatch as an edge case.
- **Impact**: The opt-in security feature is a kill switch in disguise: enabling it silently bricks the relay (every event dropped, only a `tracing::warn` per event), so operators either lose all webhook-driven automation or turn verification back off and run unauthenticated — the worst of both worlds.
- **Fix sketch**: smee forwards the raw body only via its own re-serialization, so byte-exact verification is impossible at this hop; either verify a canonical form on both ends is not an option — instead drop the body-HMAC pretense and verify something stable (e.g., require `x-github-delivery` + replay a HEAD/GET against GitHub, or a per-relay shared token header), or document loudly that this env var cannot work with smee and gate it out. At minimum, surface repeated verification failures in the relay's UI status instead of a per-event log line.

## 3. Cloud webhook trigger delete is one unconfirmed click, and every error in the tab is silently swallowed
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:117-123 (also 76, 80, 112, 201)
- **Scenario**: A user aims for the copy-URL button and clicks the adjacent Trash icon instead — the cloud trigger is deleted immediately, no confirmation, no undo. Separately: if `cloudCreateTrigger`, `cloudDeleteTrigger`, or the initial load fails (cloud offline, auth expired), the handler's `silentCatch` swallows the error — the create form just closes-or-doesn't and the list shows nothing, with no toast.
- **Root cause**: The sibling DeadLetterTab routes every destructive action through `ConfirmDestructiveModal` and toasts failures; this tab uses neither — `handleDelete` fires straight into `cloudDeleteTrigger` and all four catch sites are `silentCatch`. Bonus dead code at line 201: `personas.filter((p) => !deployedPersonaIds.has(p.id) || true)` — the `|| true` makes the filter a no-op, so undeployed personas are offered in the create picker (creating for them then fails… silently, per the above).
- **Impact**: Accidental destruction of a live external integration endpoint (third parties POST to it) with zero friction; and every failure mode in the tab is success theater — the user cannot tell "no webhooks exist" from "the load failed".
- **Fix sketch**: Wrap delete in `useConfirmDestructive` like DeadLetterTab; replace the `silentCatch` sites in user-initiated handlers with `useToastStore` error toasts; delete the `|| true` (or the whole filter, if listing all personas is intended).

## 4. Dead-letter "Select all"/"Select visible" select exhausted rows whose checkboxes are disabled — they can't be individually deselected
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/triggers/sub_dead_letter/DeadLetterTab.tsx:265-274 (also 242-248)
- **Scenario**: A group contains events at the retry cap (`retry_count >= maxManualRetries`). User clicks the group's "Select all" (or list view's "Select visible"), then tries to uncheck one exhausted row to exclude it from a bulk discard — its checkbox is `disabled={exhausted}` (line 634/786), so the click does nothing; the only escape is "Clear selection" and starting over.
- **Root cause**: `selectGroup` contains a give-away dead branch — `if (evt.retry_count < maxManualRetries) next.add(evt.id); else next.add(evt.id);` — both arms identical, so the intended "skip exhausted" filter was written and then neutralized; `selectVisible` likewise adds all `filtered` ids while the header checkbox's checked-state (`allFilteredVisibleSelected`) is computed from `selectableFilteredIds` only, so the two disagree about what "all selected" means.
- **Impact**: Selection state the user cannot edit row-by-row; the count banner includes rows the row UI presents as unselectable; the select-visible header checkbox can read unchecked while every checkbox it controls is checked (whenever exhausted extras are selected). Bulk retry quietly drops them (pre-filter at line 302) while bulk discard includes them — inconsistent semantics for the same selection.
- **Fix sketch**: Decide one semantic: exhausted rows are selectable (then remove `disabled` from their checkboxes) or not (then make `selectGroup` keep only `eligibleIds` and `selectVisible` use `selectableFilteredIds`). Either way delete the dead `else` branch.

## 5. Cloud webhook relay fetches only the 20 newest firings per trigger — a burst beyond 20 between polls is silently lost forever
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/cloud_webhook_relay.rs:200
- **Scenario**: A third party POSTs 25 webhooks to a cloud deployment between two relay polls (retry storm from the sender, or the desktop app was closed/asleep for a while and the trigger kept firing). On the next tick `list_trigger_firings(&trigger_id, Some(20))` returns only the 20 newest; the tick processes them and advances the watermark to the newest `fired_at`.
- **Root cause**: The careful oldest-first, hold-watermark-on-failure logic (lines 246-352) assumes the fetched page *contains* every unprocessed firing. There is no pagination: firings older than the newest 20 but newer than the watermark are never in `ordered`, so the watermark leaps over them the moment the visible 20 commit.
- **Impact**: Silent event loss with no error, no log line, no DLQ entry — the exact failure mode the file's own bug-hunt comment ("advancing past it would lose it forever") was written to prevent, reintroduced through the fetch limit. Worst after downtime, which is precisely when a desktop app must catch up.
- **Fix sketch**: Page `list_trigger_firings` (by cursor or since-watermark parameter if the cloud API supports it) until a firing at/older than the watermark is seen, with a bounded page count like slack_poller's `MAX_DRAIN_PAGES`; if the API can't filter, at least detect the "all 20 fetched firings are newer than the watermark" condition and warn that a gap was skipped.
