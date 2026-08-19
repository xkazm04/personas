---
layer: application
subject: outbound-notifications
technique: inbound-counterparts
stack: rust
---

# Inbound counterparts — the chat pollers, the bridge, and `is_echo` (Personas)

The technique's poller shape, reply correlation, echo guard, and one-binding
bridge as implemented in `src-tauri/src/engine/slack_poller.rs`,
`src-tauri/src/engine/discord_poller.rs`, `src-tauri/src/engine/slack_bridge.rs`,
and `src-tauri/src/engine/team_slack_relay.rs`.

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| Poll first, push as an upgrade path | both pollers' module docs say why polling and name the swap point: "swap this module's `fetch_new_messages` for a WSS consumer that pushes onto the same dispatch path" (`discord_poller.rs:23-30`; `slack_poller.rs:38-48`) |
| Durable per-channel cursor | `slack_poll_state.last_ts` / `discord_poll_state.last_message_id`, read at `slack_poller.rs:1051`, written `:1068`/`:1081`; advanced only after the drained set is recorded |
| Bounded fetch, arithmetic in the comment | `FETCH_LIMIT = 50` sized against the per-route rate budget, with the budget stated (`discord_poller.rs:48-60`, `slack_poller.rs:69-80`) |
| Bounded burst drain | `MAX_DRAIN_PAGES = 20` (`slack_poller.rs:82-88`); the drain loop (`:940-965`) walks `latest` backward so the newest page's ts cannot strand the gap — the silent-loss shape the comment names — and warns loudly when the cap is hit (`:967-975`) |
| Author filtering at the source | `should_ingest` (`:540-553`) — pure, four drop reasons testable without HTTP: any bot, system subtypes, *our own user id when posting as a user*, empty text; dedup deliberately excluded ("needs the DB") |
| Reply correlation | `slack_inbound_messages` rows keyed by `(channel_id, message_ts)` with `execution_id` + `replied_message_ts`; pass 2 (`:212`) finds finished-unanswered rows via `list_pending_replies` bounded by `MAX_REPLIES_PER_TICK = 25` (`:736`), posts in-thread, records the reply ts (`:1171-1178`) |
| Reply size cap with headroom | `SLACK_TEXT_LIMIT = 39000` chars, truncated on char boundary (`:96`, `:1035-1040`) |
| Leader-only guard | both `run_poller`s gate on `state.leadership.is_leader()` with the double-reply reason stated (`discord_poller.rs:75-79`, `slack_poller.rs:108-112`) |
| The echo guard, named once | `slack_bridge::is_echo(author_kind)` (`slack_bridge.rs:114-121`) — "kept as a named function … so the guard has exactly one definition and one test"; `should_mirror_message` checks it **first and unconditionally** before any flag (`:130-141`); test `echo_guard_rejects_slack_authored_rows` sets every outbound flag on and asserts the guard still wins (`:361-371`) |
| Opt-in by author kind | `MESSAGE_AUTHOR_KINDS` / `DIRECTIVE_AUTHOR_KIND` allowlists (`:59-63`); unknown kinds "rejected too, so a future writer has to opt in here deliberately" (`:127-129`, test `:404-409`) |
| One binding, both directions, one parser | `parse_bridge` (`:164-196`) read by both `slack_poller` and `team_slack_relay`; the discriminator `teamBridge` is a strict fork — "wiring a bridge cannot change how existing notification channels behave" (`:29-32`, regression test `:264-278`) |
| Bridge identity is the pair | `TeamBridgeSpec::key()` = `team_id:slack_channel_id` (`:99-107`): two specs on different personas naming the same pair are one bridge for cursor / rate / breaker |
| Acting identity declared on the binding | `persona_id` + `credential_id` parsed from the spec (`:76-97`), never inferred from the message |
| Decided rows advance the cursor | in the relay, rows the bridge does not mirror (echoes, muted kinds) still move the watermark — "decided, not deferred" (`team_slack_relay.rs:412-416`) |

## Judgment calls worth copying

- **The drain comment states the loss it prevents.** Not "page backward"
  but *why* advancing to the newest page's ts strands the gap — the
  reader can verify the fix against the failure.
- **Echo is checked before flags, and the test proves it.** Every future
  flag combination is already covered by one assertion.
- **`should_ingest` is pure and says what it does not decide.** Splitting
  the HTTP-free drop reasons from the DB-dependent dedup keeps both
  testable and neither pretending to be the other.

## Gaps against the technique (reported, not fixed)

- **Two pollers, one shape, no shared skeleton.** `slack_poller` and
  `discord_poller` re-implement cursor / fetch / dedup / reply passes in
  parallel (the Slack file calls itself "the Slack analogue of"
  the Discord one). The technique's fetch-mechanism/dispatch-path split
  is honored *within* each; the dispatch path itself exists twice.
- **The bridge is one-platform.** `parse_bridge` requires
  `ChannelSpecV2Type::Slack` (`slack_bridge.rs:168`); the Discord poller
  has no bridge fork and no echo guard because it has no outbound mirror
  — fine today, but the moment a Discord relay ships it needs the same
  named guard, and nothing structural makes it reuse `is_echo`.
- **Config key drift is tolerated in three spellings** (`config_str` over
  `channel` / `channelId` / `channel_id`, `:143-151`) rather than
  normalized at a write door — lenient read without a strict write, so
  the fourth spelling arrives silently.
- **Reaping is not wired.** Removing a channel spec from a persona's
  `notification_channels` JSON leaves `slack_poll_state` /
  `slack_inbound_messages` / `discord_poll_state` rows and the in-memory
  bridge breaker entries in place; there is no on-remove hook because the
  spec lives in a JSON column, not a table with a delete path
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)).
- **Breaker triplication** — the poller's per-bridge breaker is the third
  copy (registered under channel-health-tracking).
