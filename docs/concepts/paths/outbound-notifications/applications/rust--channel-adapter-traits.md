---
layer: application
subject: outbound-notifications
technique: channel-adapter-traits
stack: rust
---

# Channel adapter traits — `EventProcessor` and the two outbound stacks (Personas)

The technique's one-seam rule as implemented in
`src-tauri/src/engine/webhook_notifier.rs`, plus the counter-example
sitting one directory up in `src-tauri/src/notifications.rs`, which is a
second, older outbound stack serving the same five channel classes through
its own switch statements.

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| The trait | `EventProcessor` (`webhook_notifier.rs:124-136`): `process(pool, sub, event, event_ctx) -> DispatchOutcome` + `kind()`. The doc comment names the model it mirrors (OpenHands' `EventCallbackProcessor`) and states the bookkeeping obligation in caps: implementations MUST call `record_delivery` on both paths |
| Structured outcome, not exception | `DispatchOutcome { ok, status_code, response_excerpt, error }` (`:408-414`); the response excerpt is bounded to 256 chars at `dispatch_to_url` (`:438`) |
| The selection seam | `processor_for_subscription(_sub) -> Box<dyn EventProcessor>` (`:142-144`) — one arm today (`WebhookProcessor`), with the future arms named in its comment ("chat titler, audit logger, third-party push … keyed off a future `processor_kind` column") |
| Closed channel vocabulary, typed | `NotificationProvider { Slack, Discord, Teams, Generic }` with `as_str` / `FromStr` / `Display` (`:69-108`) |
| Lenient read | `FromStr` is `Infallible`; unknown strings → `Generic` (`:88-102`), with the reason in the comment: rows written before the enum existed, or future typos, still dispatch |
| Strict write | `validate_provider` in `src-tauri/db/src/repos/resources/notification_subscriptions.rs:71-79` rejects anything outside `slack | discord | teams | generic` at create and update |
| Endpoint resolution, ordered | `resolve_webhook_url` (`webhook_notifier.rs:352-380`): inline URL wins → credential lookup → four tolerated field aliases in declared order (`webhook_url`, `url`, `incoming_webhook_url`, `endpoint`) → `Validation` error naming what was missing |
| One transport door | `dispatch_to_url` (`:416-463`) uses the shared `personas_core::http_clients::SSRF_SAFE_HTTP` client, an 8 s `DELIVERY_TIMEOUT`, and identifying `User-Agent` / `X-Personas-Provider` headers |
| Body shape per class | `providers::build_body` (`:285-299`) — text field / content field / MessageCard envelope / summary + full event for generic |

## Judgment calls worth copying

- **The bookkeeping obligation is in the trait's doc, not in the caller.**
  The `tick` loop trusts `process` to have written the ledger; a processor
  that forgets is a contract violation the doc names, not a silent gap the
  loop papers over.
- **Two postures from one vocabulary, both explained in place.** The
  infallible parse says *why* it is infallible ("forward-DB-compat
  surprises"); the validator says *what* it accepts. A reader can see the
  lenient-read/strict-write split without reading this document.
- **The seam exists before it is needed.** `processor_for_subscription`
  with one arm is the cheapest possible investment in the technique's
  main claim, and it is already the named place where the next kind goes.

## Gaps against the technique (reported, not fixed)

- **Two outbound stacks serve the same five channel classes.**
  `notifications.rs` delivers per-persona `ChannelSpecV2` channels through
  `deliver_v2_channels` (`:435-515`) and a legacy loop
  (`deliver_to_channels`, `:528-593`) — *both* switch on channel-type
  strings and call `deliver_slack` / `deliver_telegram` / `deliver_email` /
  `deliver_discord` / `deliver_teams`, each of which owns its own body
  shape, its own client usage, and its own error string. `webhook_notifier`
  renders three of the same classes again in `providers::build_body`. That
  is three switch statements and two body-shape implementations per class
  — the exact copy-growth the seam exists to prevent. Health accounting
  sees them separately (below).
- **Three vocabularies for one concept.** `NotificationProvider`
  (4 members) in the notifier, `ChannelSpecV2Type` (7 members incl.
  `BuiltIn`/`Titlebar`) in the persona-channel stack, and the string match
  in `validate_provider` — hand-synchronized, no shared authority
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
  Adding a channel class today is a four-file change and nothing checks
  that all four moved.
- **The seam's future is a column that does not exist.** The comment names
  `processor_kind`; the schema has `provider` only. Fine as a placeholder;
  worth stating so nobody assumes the second arm is one match-arm away.
- **`notifications.rs` unknown-type arms return `Ok(())`** (`:493-496`,
  `:559-562`) — a channel of unrecognized type is a debug log and a
  *successful* delivery in the metrics. The technique wants the lenient
  read to land on the generic class *and deliver*, or fail visibly; a
  logged success that sent nothing is the empty-success lie.
