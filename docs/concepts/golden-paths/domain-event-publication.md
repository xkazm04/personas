# Golden path — Domain event publication

> Situation node: `backend-runtime/eventing/domain-event-publication` ·
> [situation spine](../situation-spine.md) · recurrence 25 · risk **MEDIUM** ·
> sides: **server** · convergence: **mixed** ·
> dimensions: **function · ui · code-quality · resilience**
> Composed 2026-08-16 against `master` @ `b4a05049e`.
>
> **Sweep.** All **963** `.rs` files under `src-tauri` and all **4,828**
> `.ts`/`.tsx` under `src/` ([`shared-facts.json`](../shared-facts.json)). Read
> in full: `db/src/repos/communication/events.rs` (3,231 lines),
> `engine/src/bus.rs`, `engine/src/event_vocabulary.rs`,
> `engine/src/team_handoff.rs`, `core/src/models/event.rs`,
> `src/engine/background.rs::event_bus_tick` + `EventGateReason`,
> `src/engine/dispatch.rs`, `src/engine/webhook.rs::mark_triggered_and_publish`,
> `src/engine/cloud_webhook_relay.rs::publish_and_upsert_watermark`,
> `src/features/triggers/lib/eventReason.ts`. Every `events::publish` call site
> and every `CreatePersonaEventInput` construction in the tree was enumerated
> twice and each production hit opened by hand.
>
> **Measured by executing, not by reading.**
>
> 1. A **read-only copy of the live `personas.db`** (347 MB, copied 2026-08-16
>    22:27 with its `-wal`/`-shm`; the live file was never opened for write).
>    All 4,972 `persona_events` rows, all 102 `persona_event_subscriptions` and
>    all 189 `event_listener` triggers were read and **paired**.
> 2. **`bus.rs:76 canonical_event_type` and `events.rs:27 is_safe_type_string`
>    were transcribed into JavaScript, gated against the assertions in their own
>    `#[cfg(test)]` modules, and only then replayed against the live rows.** Both
>    reproduce their Rust tests exactly. That replay is what produced §0's two
>    headline numbers and it is the instrument nobody had run.
> 3. The §9 rule was measured by **two independent implementations** (a
>    brace-matching Rust scanner and the census engine) which agree at **73
>    `CreatePersonaEventInput` constructions** and **43 `::publish(` call sites**;
>    they **disagreed on the publish surface** and the disagreement was a finding
>    (§12). Validated in a composer-private scratch registry, then re-extracted
>    from this finished document and re-run — identical. **The full registry was
>    NOT run**, per the doctrine.
> 4. **`cargo` was not run** (the operator's app is running). Every Rust claim is
>    static and traces to a file opened during composition.

---

## 0 The headline: the app knows how to name an event and how to notice nobody listened. It does neither at the door.

`persona_events` is the durable domain bus: 4,972 rows, one door
(`events::publish`, `db/src/repos/communication/events.rs:168`), 33 production
publishers, a nine-state status machine, a dead-letter queue, a retry ladder, a
skip-reason ledger and a curated event-name registry. Almost all of it is good.
The measurements below are about the three seams where the good parts do not
touch each other.

### 1 — the registry exists, and it reaches 3% of the emit surface

`engine/src/event_vocabulary.rs` is a **known-vocabulary registry**: 47 curated
event types, a separator-insensitive membership test, a Levenshtein
nearest-neighbour suggester, and `validate_and_warn` (`:193`) whose doc comment
states the exact hazard — *"`persona_events.event_type` is a free-form,
LLM-emitted string. A subscription or trigger listening for a typo'd type
silently never matches — forever."*

| measured 2026-08-16 | value |
| --- | ---: |
| production `events::publish` call sites | **33** |
| …that call `validate_and_warn` first | **1** — `commands/communication/events.rs:86` |
| coverage of the emit surface | **3.0%** |

The one covered door is the **IPC command a human or the frontend calls**. The
LLM-emitted path the module was written for — `dispatch.rs:370`, the
`EmitEvent` protocol message — is not covered. Neither is the chain path, the
scheduler, the webhook, the relays or the reapers.

The registry cannot be moved into `publish` as it stands: `publish` lives in
`personas_db` and `event_vocabulary` lives in `personas_engine`, which depends
on `personas_db`. The validator is on the wrong side of a crate boundary from
the only place it would be unforgettable.

### 2 — 11 event names are typed at the emit site, and all 11 have never been heard

The 33 publishers split cleanly by where the name comes from. **12 sites type
the name into the `CreatePersonaEventInput` literal** (11 production + 1 test);
**20 take it from a named binding**. Scoring the 11 production literals against
the registry, the live table and the live consumer set:

| emit site | name | in the 47-entry registry | rows in 4,972 | live consumer |
| --- | --- | :---: | ---: | :---: |
| `background.rs:2163` | `schedule.missed.offline` | yes | 0 | no |
| `background.rs:2269` | `schedule.skipped.overlap` | yes | 0 | no |
| `context_rules.rs:341` | `context_rule_match` | yes | 0 | no |
| `scraper.rs:633` | `format!("shared:{}", …)` | **no** | 0 | no |
| `shared_event_local_relay.rs:71` | `format!("shared:{}", …)` | **no** | 0 | no |
| `alert_evaluator.rs:300` | `alert_fired` | **no** | 0 | no |
| `audit_incidents.rs:35` | `incident_resolved` | yes | 0 | no |
| `auto_rollback.rs:427` | `auto_rollback` | yes | 0 | no |
| `cloud_webhook_relay.rs:395` | `cloud_webhook` | **no** | 0 | no |
| `dispatch.rs:308` | `persona_action` | **no** | **0** | no |
| `mcp_server/tools.rs:1755` | `mcp_execute` | **no** | 0 | no |

**11 of 11: zero rows ever, zero consumers. 6 of 11 are not in the registry at
all.** Some of those zeroes are innocent (an alert that never fired). One is
not, and it is §7 D1.

### 3 — `persona_action` is unpublishable for 77 of 78 personas, and always was

Two arms of one `match` statement in `dispatch.rs`, 65 lines apart, build the
same field two different ways:

```rust
// :309  ProtocolMessage::PersonaAction
source_type: format!("persona:{}", ctx.persona_name),

// :357-374  ProtocolMessage::EmitEvent
// "Sanitize persona name for source_type: replace spaces with underscores, …"
let safe_name: String = ctx.persona_name.replace(' ', "_").chars().filter(…).collect();
source_type: format!("persona:{}", safe_name),
```

`source_type` is validated at the door by `is_safe_type_string`
(`events.rs:27`), which admits only `[A-Za-z0-9_.:/-]`. Replaying that function
verbatim against the operator's 78 personas: **77 produce a `source_type` the
validator rejects** — every name with a space, a parenthesis or an ampersand
(`QA Guardian (2)`, `Website & Market Intelligence Profiler`, `T: Dev Clone`).
`publish` returns `AppError::Validation`, and the caller's handler is
`ctx.logger.log("[EVENT] Failed to publish persona_action: …")` — a per-execution
log file, not `tracing`, not Sentry, not a row.

**`persona_action` appears 0 times in 4,972 events.** The sibling arm's comment
is the fix, already written, 60 lines away.

### 4 — the door takes a pool, so no publication is atomic with what it announces

`publish(pool: &DbPool, …)` (`:168`) does `let conn = pool.get()?` (`:179`).
`DbPool` is `Pool<SqliteConnectionManager>` (`core/src/pool.rs:14`) — r2d2. The
connection it publishes on is **not** the connection a caller's transaction is
open on, so **it is structurally impossible for any of the 33 sites to publish
inside the transaction that made the state change.** The event repo exposes
**zero** functions taking a `Transaction`; `db/src/repos/` holds **1,282
`pool: &DbPool` parameters against 6 `tx: &Transaction`**.

Two callers needed atomicity and got it by **not calling the door**:

- `engine/webhook.rs:573` `mark_triggered_and_publish` — INSERT the event and
  bump `trigger_version` in one `conn.transaction()`. Its doc comment (`:561-572`)
  is the best reasoning in the subject area: the event *"is committed
  unconditionally"* and a lost CAS is *"success-after-publish… we must never
  discard a legitimately-received external event over a benign metadata race."*
- `engine/cloud_webhook_relay.rs:488` `publish_and_upsert_watermark` — INSERT the
  event and the watermark together, explicitly to avoid *"an event persisted but
  the watermark not (which would cause duplicate events after an app restart)."*

Both are right, and both had to **re-implement `publish`**: the same INSERT, the
same column list, the same `encrypt_for_db` block, copied. There are **4
production `INSERT INTO persona_events` statements** in the tree (`events.rs:181`
the door, `events.rs:812` the DLQ door, `webhook.rs:602`,
`cloud_webhook_relay.rs:514`) and **3 of them are the same statement**. Any
change to the door — a new column, a validator, an encryption change — must now
be made three times, and nothing says so.

This is the clause the convergence oracle came back hardest on, and it inverted
what I expected: **3 of the 4 siblings with a database write the announcement
inside the state change's transaction, two of them after deliberately migrating
out of the shape Personas is in.** Worse for the local design, so does *this
engine's own port*: `personas-cloud` publishes into `persona_events` inside
`database.transaction(…)`, in the ported fire path, because its storage layer
hands out a transaction where this one hands out a pool. Full evidence in §6.

### 5 — what `skipped` means, and what it cannot distinguish

`Skipped`'s enum doc reads *"No matching subscribers — event was intentionally
skipped"* (`core/src/models/event.rs:25`). That is one of **nine** reasons the
bus writes it. `EventGateReason` (`background.rs:948`) has nine variants —
`no_subscriber`, `approval_held`, `persona_disabled`, `handoff_target_disabled`,
`cross_team_blocked`, `cascade_guard`, `dry_run`, `stuck_reclaimed`,
`stuck_retry_exhausted` — and the token lands in **`error_message`**, the column
that also carries free-form failure text.

`src/features/triggers/lib/eventReason.ts` handles that overload carefully and
its doc comment is worth reading: a value is a reason ledger **only** if every
comma-separated part is a known token, *"we never guess at a label for text we
did not emit."* The parse is correct. The **two token lists are not bound to each
other**: `EVENT_REASON_TOKENS` (TS, `:17`) and `EventGateReason::token` (Rust,
`:977`) are hand-maintained, each has its own test asserting its own list, and
**nothing compares them** (§7 D4).

The live 31 August rows are all `skipped`:

| event_type | reason | n | window |
| --- | --- | ---: | --- |
| `signal.raised` | `no_subscriber` | 15 | 2026-08-11 |
| `dev_tools.context_scan_started` | `no_subscriber` | 5 | 08-12 → 08-14 |
| `dev_tools.context_scan_completed` | `no_subscriber` | 5 | 08-12 → 08-14 |
| `dev_tools.context_scan_started` | **NULL** | 3 | 08-10 → 08-11 |
| `dev_tools.context_scan_completed` | **NULL** | 3 | 08-10 → 08-11 |

And the sharpest fact in the table is one the ledger cannot express:
**`dev_tools.context_scan_started` has 6 `delivered` rows and 8 `skipped` rows.**
The same name, the same publisher, unchanged — delivered in June, skipped in
August. Its consumer went away and **nothing anywhere recorded that it did**.
`no_subscriber` says "nobody listened *this time*"; it cannot say "somebody used
to."

Note also that two of those three August types are *supposed* to have no
consumer — `publish_context_scan_event`'s own doc comment (`system_ops.rs:312`)
says it *"dispatches to no persona — it just surfaces in the Live Stream"*, and
the registry marks `schedule.missed.*` as *"never listener-matched —
informational"*. So `no_subscriber` conflates **"correct by design"** with
**"the intended listener is gone"**, and today the correct case is the majority.

### 6 — pairing works, and it is measurable

The one place this repo mints the emitter's name and the receiver's name from
**one expression** is `engine/team_handoff.rs:57`:

```rust
fn handoff_event_type(target_persona_id: &str) -> String {
    format!("team_handoff.{target_persona_id}")
}
```

`wire_team_handoff` (`:63`) calls it once per edge and writes the result into
**both** the emitting `chain` trigger's config (`:133`) and the receiving
`event_listener`'s `listen_event_type` (`:161`). Pairing the live table against
the live consumer set:

| published event-type family | spellings | …with a live consumer | rate |
| --- | ---: | ---: | ---: |
| `team_handoff.<persona-id>` — minted by one function for both sides | 51 | **48** | **94%** |
| everything else | 135 | 17 | **13%** |

**A 7× separation, in one database, between names that were paired at creation
and names that were not.** That is the whole prescription, measured.

### 7 — the vocabulary is 186 spellings of 174 things, and the bus already pays for it

`event_type` is `TEXT NOT NULL` with **no `CHECK` constraint** (verified against
the live `sqlite_master`). 186 distinct spellings exist. Replaying
`canonical_event_type` collapses them to **174**: eight meanings wear two to four
spellings each.

| canonical | spellings found in the live table |
| --- | --- |
| `code.review.completed` | `code_review.completed` (199) · `code-review.completed` (10) · `code.review.completed` (4) |
| `ux.review.completed` | `ux.review.completed` (51) · `ux_review.completed` (34) · `ux-review.completed` (1) · `ux.review_completed` (1) |
| `goal.progress` | `goal.progress` (66) · `goal_progress` (8) |
| `qa.pr.review.noop` | `qa.pr.review.noop` (2) · `qa.pr.review_noop` (1) · `qa.pr_review.noop` (1) |
| …4 more | `dev.clone.security.scan.completed`, `qa.pr.gate.noop`, `release.publish.held`, `ux.review.changes.requested` |

The repo has **already paid for this and fixed it well**: `background.rs:1229-1249`
records that an exact `event_type IN (…)` SQL pre-filter *"silently dropped
subscriptions whose separator style differed from the emitted event… so
downstream steps starved"*, and the fix was to fetch the whole enabled set and
match canonically in `bus.rs`. Both `is_eligible` implementations carry the
reasoning. **Canonical matching is the strongest engineering in this subject
area and it should be said so.** It is also, deliberately, only a *separator*
reconciliation — the module says so — which is why the registry in §0.1 exists
and why it needs to reach the door.

### Sibling boundaries, settled in prose

[**backend-to-frontend-events**](./backend-to-frontend-events.md) owns the
**Tauri transport** — `event_name::`, `app.emit()`, the `listen` primitives, and
the two rules `unregistered-tauri-event-name` / `unmanaged-tauri-subscription`.
**This path owns the durable row in `persona_events` and who it wakes.** The two
meet at exactly one function, `emit_event_to_frontend` (`background.rs:3163`),
which mirrors a bus verdict onto the transport; that mirroring is that path's,
the verdict is this one's. The brief's "26 line-bearing channels, 13 with no
frontend subscriber" is a fact about **that** leaf's registry, not this table —
see §12.

[**scheduled-trigger-firing**](./scheduled-trigger-firing.md) owns *becoming
due*, and ends at `mark_triggered` → publish. **This path starts at the publish.**
Its Gap 2 and this path's D6 are the same wire seen from both ends: **39 live
`event_listener` triggers listen for `trigger_fired`, and it has been published
0 times in 4,972 events** — because that path's producer has not fired in 80
days. A perfectly-wired subscriber is worth nothing without a live emitter, and
neither half can see the other.

[**stall-watchdog**](./stall-watchdog.md) established that this table is the
proof the engine stopped: 4,941 `delivered` rows all ≥51 days old. **Confirmed
and sharpened here — there are 0 events between 2026-06-27 and 2026-07-31**, a
35-day hole with no row of any status, then 31 rows in August. **The correction
that path is owed:** it reads "the bus is ticking, receiving events, and has
delivered zero of them for 51 days." The bus is not *receiving* anything to
deliver; nothing is publishing. See §12.

[**retention-and-pruning**](./retention-and-pruning.md) owns why those 4,941 rows
are immortal (`events::cleanup`'s status allowlist omits `Delivered`).
**This path owns why they say `delivered` in the first place** — and confirms its
P0 from the emit side: `Completed` has 0 rows because only `mock_seed` writes it.

[**post-write-side-effects**](./post-write-side-effects.md) owns doing something
after a row lands, and its `unverified-effect-dispatch` rule keys on `let _ =`
around a **Tauri emit**. **This path owns the ordering question that rule cannot
ask: the effect here is a second durable write on a second connection**, so
"did the notification dispatch" and "did the announcement commit" are different
questions (§0.4).

[**transaction-boundary**](./transaction-boundary.md) owns which writes belong in
one transaction. **This path supplies the case where the boundary is unreachable
by construction** — a repo function that takes a pool cannot join one — and the
two callers who escaped by copying the statement.

[**upsert**](./upsert.md) and [**conditional-write**](./conditional-write.md) own
the claim. **This path owns the fact that `claim_pending` (`events.rs:239`) is
already the correct claim** — `UPDATE … SET status='processing' WHERE id IN
(SELECT … WHERE status='pending' LIMIT ?) RETURNING *`, one statement, no
check-then-act — and that it is the reason overlapping ticks cannot double-fire.

The **Deviations** section is a fix backlog and contains **one live P0** (D1) and
**one cross-language vocabulary that nothing pins** (D4).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no
file path, primitive name or count, so an adopting repo can tell physics from
local calibration. Each clause names its warrant.

> **P1 — physics, and the whole subject.** *An event's name is a contract between
> two pieces of code that never call each other.* Everything else in this
> document follows from that: the emitter and the receiver are joined by a string
> and by nothing else, so the string must come from somewhere both of them can
> point at. If the only place the name exists is inside the emit call, the
> contract has one party.
>
> **P2 — house convention, flagged, and it is the best answer in the family.**
> *Mint the name once, and create the emitter and the receiver from that one
> expression.* Not "use the same constant" — *create both sides in the same
> pass*, so a new emitter cannot exist without its receiver. **The oracle found
> no trace of this in four sibling repos** (§6 clause 4), so it must be labelled
> a house convention even though the local evidence is the strongest number in
> this document: where this repo does it, 94% of names have a consumer; where it
> does not, 13%. The sibling that came closest has the right *type* and still
> lost seven of its twenty-one events to a third hand-written list.
>
> **P3 — house convention, corroborated only by this engine's own fork.**
> *Record that nobody listened.* "Delivered to zero subscribers" and "delivered"
> must not be the same row. A publish-side success that means nothing happened is
> the defect this whole situation exists to prevent. Two codebases do this and
> they are one lineage; the one independent bus in the family silently drops the
> zero-consumer case and says so in a comment.
>
> **P4 — PHYSICS, and the one this repo is furthest from.** *Announce the fact in
> the same transaction that makes it true.* An announcement written on a second
> connection is a second, independent commit: the state can change without the
> world being told, or the world can be told about a change that rolled back.
> **Three of the four siblings with a database do this, two of them after
> migrating away from the best-effort-write-afterwards shape and writing down
> why** (§6 clause 1). Where the storage layer hands out pooled connections
> rather than transactions, this is not a discipline anyone can follow — it is
> unavailable, and that is Personas' position at all 33 publishers.
>
> **P5 — reasoned locally, not corroborated.** *A validated field must be built
> from validated parts.* If a door rejects values outside a character set, every
> expression that assembles a value for that door must be constrained by the same
> set, at the point of assembly. Otherwise the rejection is a runtime surprise at
> the one call site nobody exercised. No sibling validates an event-name
> character set at all, so there is nothing to compare against; this clause rests
> on one local measurement (77 of 78) and is stated because that measurement is
> unambiguous, not because the oracle confirmed it.
>
> **P6 — house convention, flagged.** *Compare names tolerantly across
> stylistic variants, and never across meanings.* Separator-insensitive matching
> rescued this repo from a real starvation bug — but it is a **treatment for a
> free-text name**, not an alternative to declaring one, and **no sibling has
> needed it because no sibling let the name be free text** (§6 clause 5, 0 of 4).
>
> **P7 — ergonomics.** *The reason a fact reached nobody is not an error.* Give
> it its own channel. Overloading the failure column with routing verdicts forces
> every reader to guess which kind of string it is holding.

---

## 1 Trigger

- "X just happened — how do I let the rest of the app know?"
- "I want persona B to run whenever persona A finishes."
- "My subscription never fires." / "The event shows as skipped and I don't know why."
- "Is anyone actually listening to this event?"
- "Should this go on the bus or is it just a log line?"
- "I need to record this and then trigger something — same transaction, right?"

If you are about to type `CreatePersonaEventInput`, `events::publish`,
`event_type:`, `source_type:`, `INSERT INTO persona_events`,
`persona_event_subscriptions`, `listen_event_type`, `PersonaEventStatus`,
`EventGateReason`, or to add an entry to `BUILTIN_EVENT_TYPES` — you are in this
situation.

**Not this path:** *pushing a change to the open window* is
[backend-to-frontend-events](./backend-to-frontend-events.md); *how a schedule
becomes due* is [scheduled-trigger-firing](./scheduled-trigger-firing.md);
*whether the loop that drains the bus is alive* is
[background-loop](./background-loop.md) and
[stall-watchdog](./stall-watchdog.md); *how long the rows live* is
[retention-and-pruning](./retention-and-pruning.md).

## 2 The one way

**Name the event in one function, call that function from both the publisher and
whatever creates the subscriber, and publish it in the same transaction as the
state change it describes.** Concretely: **(a) the name comes from a shared
declaration** — an entry in `BUILTIN_EVENT_TYPES`
(`engine/src/event_vocabulary.rs:59`), an `event_name::` constant
(`core/src/events.rs`), or a small `fn <thing>_event_type(…) -> String` beside
the wiring — **never a literal typed into the `CreatePersonaEventInput`**, because
a literal is by construction an expression no subscriber can reference. **(b)
Create both sides in one pass.** Copy `wire_team_handoff`
(`engine/src/team_handoff.rs:63`): one `handoff_event_type(target)` call feeds
the emitter's config and the receiver's `listen_event_type`, so they cannot
drift and a fan-in target needs exactly one receiver. If you cannot create the
receiver — because a human will — then **register the name in
`BUILTIN_EVENT_TYPES` in the same commit**, so the picker offers it and
`validate_and_warn` stops warning about it. **(c) Go through
`events::publish` (`db/src/repos/communication/events.rs:168`)**, which validates
the two type strings, caps the payload at 64 KB, encrypts it at rest and stamps
`status='pending'` for the bus to claim. **Do not hand-write the INSERT** — three
copies of that statement already exist and two of them are outside the repo
module. **(d) If the announcement must be atomic with the state change, say so
out loud in the code**, because the door cannot do it: `publish` takes a pooled
handle and commits independently. Today the only honest answer is to copy
`webhook.rs:573`'s shape and *document why*, the way it does. **(e) Build every
validated field from validated parts** — a persona name, a project title, a
user-supplied label going into `source_type` or `event_type` must be sanitised
at the point of interpolation (`dispatch.rs:357-369` is the code to copy). The
door will refuse it otherwise, at runtime, on whichever path you did not
exercise. **(f) Then stop.** Do not add a second bus, do not write a status
value the enum does not have, do not compare event names with `==` in new code —
`bus::canonical_event_type` is the comparison — and do not treat "published" as
"handled": the row says `pending` until a tick decides otherwise.

If you must get one right first: **(a)**. (b) is what makes (a) pay, but (a) is
the one whose failure is *silent, permanent, and invisible to every test* — a
typo'd or unshared name is a subscription that never fires, forever, with no
error anywhere.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `db/src/repos/communication/events.rs:168` `publish(pool, CreatePersonaEventInput)` | **the door.** Validates `event_type`/`source_type` against `is_safe_type_string` (`:27`) and `MAX_TYPE_LEN` 128, caps the payload at `MAX_PAYLOAD_BYTES` 64 KB (`:19`), encrypts it with `crypto::encrypt_for_db` (`:94`), writes `status='pending'`, returns the row. All 4,972 live payloads are encrypted — this door is why |
| `engine/src/team_handoff.rs:57` `handoff_event_type` + `:63` `wire_team_handoff` | **the one site to copy.** One name expression, written into the emitter's trigger config AND the receiver's `listen_event_type` in the same pass. Idempotent, feedback edges deliberately excluded, and the reason for each choice is in the module doc |
| `engine/src/event_vocabulary.rs:59` `BUILTIN_EVENT_TYPES` (47 entries) + `:193` `validate_and_warn` + `:169` `nearest_builtin` | the shared declaration and the typo detector. `validate_and_warn` **never rejects** — it warns with the nearest known name. **Add your event here in the same commit that publishes it** |
| `engine/src/bus.rs:76` `canonical_event_type` | the comparison. Lowercases and collapses `-`/`_`/`.` to `.`. **Use it for every event-name equality test.** Its doc comment states the boundary: it reconciles separator style and deliberately not meaning |
| `engine/src/bus.rs:161` `match_event` + `:266` `prefer_capability_scoped` + `:236` `is_cross_team_wildcard_bleed` | the routing decision: canonical type match, target pinning, self-scoping for `persona:`-sourced events, `source_filter` opt-in for cross-persona, capability-scoped beats persona-wide, and the wildcard cross-team suppression whose comment names the run it cost |
| `db/src/repos/communication/events.rs:239` `claim_pending(pool, limit)` | the claim. One `UPDATE … WHERE id IN (SELECT … WHERE status='pending' … LIMIT ?) RETURNING *`. No check-then-act, so overlapping ticks cannot double-dispatch. `:266` `claim_pending_headless` is the daemon's variant, and its doc comment records the claim-then-release ping-pong that motivated it |
| `db/src/repos/communication/events.rs:287` `update_status` | the only legal way to move an event. Reads the current status, checks `can_transition_to`, and closes the TOCTOU gap with `WHERE id = ? AND status = ?`. Rejects a stale transition rather than clobbering |
| `core/src/models/event.rs:16` `PersonaEventStatus` + `:71` `can_transition_to` | the closed, exhaustive status machine with an explicit transition table. `from_db` warns on an unknown value instead of guessing |
| `src/engine/background.rs:948` `EventGateReason` + `:996` `EventGateLedger` | the nine reasons a delivery did not happen, as tokens. **Use a variant; never write free text into `error_message` for a routing verdict** |
| `src/features/triggers/lib/eventReason.ts:53` `parseEventReasonTokens` | the reading side. Strict by design: a value is a ledger only if *every* part is a known token, else it renders verbatim |
| `db/src/repos/communication/events.rs:1222` `increment_retry_or_dead_letter` + `:885` `dead_letter_from_processing` + `:961` `reap_stuck_processing` | the failure ladder. Fully wired (`background.rs:1706`, `:1750`, `:1179`) and it has never fired: **0 rows in any of `failed`/`dead_letter`/`discarded`, `retry_count = 0` on all 4,972** |
| `src/commands/communication/events.rs:120` `get_event_skipped_stats` → `src/api/overview/events.ts:69` → `useEventLog.ts:112` | **the "did anyone listen" instrument, wired end to end.** This is the answer to the question, and it already exists |
| `src/engine/webhook.rs:573` `mark_triggered_and_publish` | the transactional shape, when you genuinely need one. Read the doc comment before copying the code (§0.4) |

**Do NOT build:** a second event table; a second name registry; a status string
the enum does not have; an `event_type` comparison with `==`; a bespoke
retry/dead-letter path (`increment_retry_or_dead_letter` is the ladder); an
in-memory subscriber map beside `persona_event_subscriptions` +
`event_listener` triggers; a fourth copy of the `INSERT INTO persona_events`
statement.

## 4 Steps

1. **Write the name down somewhere shared, before you write the publish.** An
   entry in `BUILTIN_EVENT_TYPES` with a category, or a `fn …_event_type()`
   beside the wiring code. If you cannot say where the name lives other than
   "inside this call", stop — you are about to create §0.2.
2. **Decide who will hear it, and create them in the same pass if you can.**
   `wire_team_handoff` is the pattern. If a human creates the subscriber later,
   the registry entry from step 1 is what makes the name discoverable in the
   picker.
3. **Build the payload and the two type strings from validated parts.** Anything
   interpolated into `event_type` or `source_type` that came from a name, title
   or label must be sanitised at the interpolation
   (`dispatch.rs:357-369`). The door will reject it otherwise, at runtime, on the
   one path you did not test.
4. **Ask whether the announcement must be atomic with the state change.** If the
   answer is yes — the row is the durable record of an external delivery, or a
   watermark advances with it — you cannot use `publish` today; copy
   `webhook.rs:573` and write down why, in the function's doc comment, the way it
   does. If the answer is no, use the door and move on. *Deciding this out loud
   is the step; either answer is fine, silence is not.*
5. **Call `events::publish` and handle the `Err`.** `AppError::Validation` means
   your name or your payload was refused — that is a bug in your call, not a
   transient. Log it at `tracing::warn!` with the event type as a **field**, not
   into a per-execution log file where no query can reach it.
6. **Let the bus take over — and then stop.** `event_bus_tick`
   (`background.rs:1162`) claims, matches, gates and dispatches. Do not poll for
   your own event, do not set `status` yourself, do not add a wake path;
   `event_bus_wake_signal()` already re-arms on a full batch (`:1199`).
7. **If you are writing a gate that ends an event without delivering it**, add a
   variant to `EventGateReason`, its token, its Rust assertion
   (`background.rs:4060`), its entry in `EVENT_REASON_TOKENS`
   (`eventReason.ts:17`) and its label under
   `status_tokens.event_reason` in `locales/en.json` — **four places, and nothing
   checks that you did all four** (§7 D4).
8. **Verify it landed.** Overview → Events shows the row, its status and its
   reason; `get_event_skipped_stats` gives the per-type skip rate. If your new
   event is 100% `no_subscriber`, either step 2 did not happen or the name in
   step 1 does not match what the subscriber declared.

## 5 Anti-patterns

- **Typing the event name into the publish call.** *Failure mode:* the name
  exists in exactly one expression, so no subscriber can reference it and no
  compiler, test or gate can compare the two. **Measured: 11 production sites, 0
  rows and 0 consumers between them, 6 of them absent from the registry** (§0.2).
- **Assembling a validated field from an unvalidated part.** *Failure mode:* the
  door rejects the whole publish at runtime, on one code path, for most inputs.
  **Measured: 77 of 78 live personas cannot publish a `persona_action`; the event
  has 0 rows ever, and the sibling arm 65 lines away already sanitises** (§0.3).
- **Publishing on a pooled connection and calling it atomic.** *Failure mode:*
  the state change and its announcement are two independent commits, so a crash
  between them silently drops the announcement — and because the door offers no
  transactional form, the callers who noticed had to **copy the INSERT**.
  **Measured: 3 copies of one statement, 1,282 pool-taking repo parameters
  against 6 transaction-taking** (§0.4).
- **Comparing event names with `==`.** *Failure mode:* `code_review.completed`
  and `code-review.completed` are different strings and the same event; an exact
  compare starves the subscriber and reports nothing. This repo already shipped
  that bug twice — once in a `WHERE event_type IN (…)` pre-filter and once in a
  `json_extract(…) IN (…)` one — and both fixes are recorded at
  `background.rs:1229` and `:1241`. **Measured: 8 canonical event types wear 2–4
  spellings each across 389 live rows.**
- **Letting the reason for "nothing happened" be free text.** *Failure mode:*
  the reader cannot tell a routing verdict from a failure message, so it either
  renders machine tokens to users or renders error text as a label.
  `EventGateReason` + `parseEventReasonTokens` solve this; a raw string in
  `error_message` reintroduces it.
- **Treating `delivered` as "it worked".** *Failure mode:* `delivered` means
  *at least one subscription matched*, nothing more. Recording a zero-match event
  as delivered was the previous behaviour and `background.rs:1293-1298` calls it
  what it was — *"success theater: it inflated the delivery stat and made a dead
  or misrouted trigger look like it was successfully handled."* Do not undo that.
- **Two hand-maintained copies of one vocabulary, each with its own test.**
  *Failure mode:* both suites pass while the lists differ, and the frontend
  silently renders a new backend token as raw error text. **Measured: 9 tokens in
  Rust, 9 in TypeScript, 0 cross-checks** (§7 D4). `brainiac` solved exactly this
  with one test (§6).
- **Putting a routing identity in a display name.** *Failure mode:* the
  dimension the UI filters and an index is built on changes when a user renames
  something. **Measured: `source_type` holds `persona:<slugified display name>`
  for 4,166 of 4,972 rows across 11 spellings, while `source_id` already holds
  the stable id and resolves 4,166/4,166.**
- **A doc comment as the vocabulary.** ascent declares its event kinds as
  `kind String // status | assignee | target_date`. *Failure mode:* the comment
  is the only definition, and nothing reads comments (§6).

## 6 Evidence

**The one site to copy: `src-tauri/engine/src/team_handoff.rs:57-181`.**

Read it as four decisions:

1. **The name is a function, not a literal** (`:57`). One expression, called
   once per edge at `:123`.
2. **Both sides are created from that one call** — the emitting `chain`
   trigger's `event_type` (`:133`) and the receiving `event_listener`'s
   `listen_event_type` (`:161`). They cannot drift because there is nothing to
   drift from.
3. **It is idempotent and says how** (`:29-31`): re-running matches on
   `json_extract` of the plaintext keys, so a repair pass creates only what is
   missing. `repair_team_handoff` (`commands/teams/teams.rs:50`) is that pass,
   exposed as a command.
4. **The exclusions are reasoned in the module doc, not discovered at runtime**:
   feedback edges are revision loops and are never wired; `chain` is excluded
   from the auto-listener policy because *"the upstream's listener owns the
   wakeup"*, which is precisely why the receiver has to be added explicitly.

Its service record is the measurement in §0.6: **48 of 51 (94%)** of the names it
minted have a live consumer, against **17 of 135 (13%)** for everything else.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `db/src/repos/communication/events.rs:168-200` | the door: validate → cap → encrypt → insert `pending`, in that order, in one function |
| `db/src/repos/communication/events.rs:239-256` | the claim as ONE statement, with the doc comment stating what it buys (`:235-238`) |
| `db/src/repos/communication/events.rs:287-342` | a status transition that reads the current value, checks a **transition table**, and still writes `WHERE id = ? AND status = ?` — belt and braces, and the comment says why (`:318-320`) |
| `engine/src/bus.rs:57-92` | a tolerant comparison whose doc comment names both what it merges **and what it must not** |
| `src/engine/background.rs:1287-1311` | refusing to call a zero-match delivery a delivery, with the reason written down |
| `src/engine/dispatch.rs:355-369` | sanitising an interpolated display name at the point of interpolation — **the fix for D1, already written** |
| `src/engine/webhook.rs:561-572` | the doc comment that decides publish-vs-bookkeeping ordering explicitly and justifies treating a lost CAS as success |
| `src/features/triggers/lib/eventReason.ts:1-57` | an overloaded column read safely: all-or-nothing token parsing, never guessing a label for text it did not emit |
| `engine/src/event_vocabulary.rs:1-19` + `:189-192` | a registry that **never rejects**, only warns with the nearest match — the right severity for a vocabulary that must stay open |

### Convergence — 5 sibling repos, all opened

Swept read-only against `../personas-web` (1,056 files), `../brainiac` (605),
`../personas-cloud` (32), `../vibeman` (2,055), `../ascent` (924). **All five
exist and all five were opened**; nothing below is reported by omission.
`personas-web` is a *client of this same backend* — it re-declares
`publishEvent(input: CreateEventInput)` and `eventType: string`
(`src/lib/api.ts:143,147`) — so it is **not independent evidence** for any clause
and is discounted throughout.

**The oracle inverted the two clauses I was most confident about** — §0.4 and
§0.6 — and both inversions are called out inline. `personas-web` has **no local
database and no transaction primitive at all** (0 hits for
`$transaction|db.transaction(|.transaction(` across its `src`; the dependency
list has no Prisma, no better-sqlite3, no drizzle — everything goes through the
Supabase REST client), so it is excluded from clause 1's denominator as well as
being discounted for lineage.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **The announcement is written in the SAME transaction as the state change** | **PHYSICS — 3 of the 4 repos with a database, and PERSONAS IS THE OUTLIER** | `ascent` `src/lib/db/scans-recommendations.ts:104` — one `prisma.$transaction` holding `tx.recommendation.updateMany` (`:121`), `tx.recommendationEvent.createMany` (`:127`) and `tx.auditLog.create` (`:131`), with the comment at `:128-130` recording the migration: *"Audit IN the same transaction (was a best-effort post-tx recordAudit that could leave a committed status change with NO audit row)"* — i.e. ascent moved **away from the shape Personas is in**. Two more at `scans-persist.ts:234` and `credits.ts:141`. `brainiac` `crates/brainiac-store/src/governance.rs:239` `apply_supersession(conn: &mut PgConnection)` — the `UPDATE memories … status` (`:289`) and the `INSERT INTO promotions` audit row (`:305`) on one handle, called with `&mut tx` from `console.rs:753`, whose comment reads *"Returning before the commit rolls the transaction back."* `vibeman` is the negative: **38 `db.transaction(` sites and not one contains an event insert**, because its bus is in-memory — `directionAcceptanceWorkflow.ts:253` commits, then emits at `:263`, and a crash between the two loses the event silently. |
| 1b | **…and the strongest single result: the PORT gained what the original cannot express** | **inverts a prior corpus finding** | `personas-cloud`'s `triggerScheduler.ts` is documented as *"Ported from desktop engine/background.rs::trigger_scheduler_tick()"*; [scheduled-trigger-firing](./scheduled-trigger-firing.md) §6 found that the port **dropped** the compare-and-set. It **gained** atomicity: `triggerScheduler.ts:190` opens `database.transaction(() => {` and inside it calls `db.publishEvent(…)` (`:193` → the raw `INSERT INTO persona_events` at `db.ts:702`) alongside `recordTriggerFiring` (`:203`), `updateTriggerHealth` (`:211`) and `updateTriggerTimings` (`:214`), run via `txn.immediate()` (`:229`). Same event table, same fire path, **one transaction** — because in the port the storage layer hands out a transaction and here it hands out a pool. That is the case for the type in *Prefer a type over a gate*, made by the same code in a different stack. |
| 2 | **The event name comes from a closed declaration** | **PHYSICS (2 of 4), and Personas is on the wrong side** | `brainiac`: `pub enum LibraryUsageEvent { Fetch, Check, Apply }` (`crates/brainiac-core/src/library.rs:257`) **plus** `CONSTRAINT lue_event_check CHECK (event IN ('fetch','check','apply'))` in the migration — type *and* database. `vibeman`: a discriminated union over `kind` with an `EventKind` type (`src/lib/events/types.ts`, 20 interfaces / 21 kind strings), doc comment *"Every emitter feeds into EventBus using these types; every subscriber filters by the `kind` discriminant."* `ascent` is the counter-example that proves the clause: `kind String // status \| assignee \| target_date` — the vocabulary in a trailing comment. `personas-cloud` inherits this repo's free `eventType: string` (`db.ts:696`) and its only guard, `validateTriggerEventType` (`triggerScheduler.ts:25-33`), checks length and a regex and rejects reserved prefixes — **it never checks that any subscription exists for the name.** **Personas' `event_type` is `TEXT` with no CHECK and no enum.** |
| 3 | **One test pins the code vocabulary to the storage vocabulary** | **`brainiac` alone — and it is the exact instrument D4 needs** | `library_vocabulary_round_trips_and_matches_migration_checks` (`crates/brainiac-core/src/library.rs:282`), whose comment reads *"Every string here must stay equal to the corresponding CHECK constraint list in migration 0028 — `parse()` and the database must reject the same values."* Same shape as this repo's `types.rs:824 terminal_set_matches_expected` (which names the TS constant to update) — a mechanism Personas already owns for execution states and has never pointed at an event vocabulary. |
| 4 | **Emitter and subscriber derived from ONE shared name expression** | **NO TRACE — 0 of 4. Personas is alone, and it works.** | I expected `vibeman` to corroborate this and it does not. Its `domainEmitters.ts` (5 exported emitters) and `domainSubscribers.ts` (1 exported registrar, 4 non-exported handlers) are paired *modules*, but **each side retypes the kind literal independently** (`domainEmitters.ts:36,60,84,116,150` vs `domainSubscribers.ts:31-34`). **4 of 20 kinds have both a named emitter and a named subscriber**, and one of those four (`onQuestionAnswered`, `:291`) is a documented no-op. The only thing preventing drift is a compile-time union, not a shared runtime name. **`wire_team_handoff` has no corroboration anywhere in the family and is the best answer in it** — report as silence, per the oracle's own rule, not as validation. |
| 5 | **Separator-tolerant name matching** | **NO TRACE — 0 of 4** | Searched for the mechanism (`toLowerCase`/`trim`/`replace` applied to an event/topic/kind/channel variable, `replace(/[-_.]/g`, `slugify`) **and** for the name (`canonical_event_type`, `canonicalEventType`, `normalizeEventName`). Every hit is unrelated: SEO metadata and org-slug lowercasing in `ascent`, insight-title hashing in `vibeman` (`src/lib/brain/insightId.ts:75`), `MemoryStatus::Canonical` in `brainiac`, markdown heading slugs in `personas-web`. Both real matchers are exact: `personas-cloud` `db.ts:955,958` `WHERE event_type = ?` (no `lower()`, no collation override) and `vibeman` `eventBus.ts:63` `kindListeners.get(event.kind)` on a `Map`. The one near-miss is instructive: `personas-cloud` `triggerScheduler.ts:28` computes `raw.toLowerCase()` **only** to test reserved prefixes and returns `raw` unchanged at `:32` — a reserved-word guard, not tolerant matching. **No sibling normalises an event name, because no sibling lets the name be free text.** Personas' `canonical_event_type` is a house convention with zero external corroboration, it is excellent, and it treats a problem the others designed away. |
| 6 | **Recording that an emitted event reached zero consumers** | **2 of 3 bus-having repos — but the two are ONE lineage, so: not physics** | I claimed Personas was alone. It is not. `personas-cloud` `eventProcessor.ts:697-703` does it **better**: `updateEventStatus(…, 'skipped')` (`:698`), `skipTriggerFiring` (`:700` → `db.ts:1543`, documented at `:1538` as *"no subscription matched"*), and `audit.recordSkipped` with `detail: {status:'skipped', reason:'No subscriptions matched'}` (`:212`) — **all three inside the transaction opened at `:627`**, and `'skipped'` is a first-class `CHECK(status IN (…))` value (`db.ts:411`). `vibeman` is the negative and is explicit about it: `eventBus.ts:63-68` is `if (kindSet) { … }` with no `else`, `emit()` returns `void` so a caller cannot learn the delivery count, and the Rust half carries the comment *"ignore send errors — no subscribers is OK"* (`src-tauri/src/runtime/mod.rs:64`). Because `personas-cloud` is a fork of this engine, treat this as **one design, two checkouts** — not independent reinvention. |
| 6b | **…and the fork records the number this leaf's D7 needs** | **Personas is behind its own port** | `personas-cloud` `eventProcessor.ts:662-666` calls `audit.recordSubscriptionsEvaluated(subs.length, matches.length, …)` on **every** event, so *"how many subscriptions were considered and how many matched"* is durable per event. That is exactly the signal that would make D7 (*an event type that used to have a consumer no longer does*) computable, and Personas records only the boolean outcome. |

**The most valuable sibling results are two written refutations of the current
design.**

`ascent`'s comment at `scans-recommendations.ts:128-130` is a repo that *was* in
Personas' position — a best-effort audit write after the transaction — and moved
out of it, naming the exact hazard: *"could leave a committed status change with
NO audit row."* Personas has 33 publishers in that position and cannot leave it
without a `publish_in_tx`.

`brainiac`'s `library_vocabulary_round_trips_and_matches_migration_checks` is the
instrument D4 needs, and Personas already owns the pattern —
`core/src/types.rs:800-834` fails the build when an `ExecutionState` variant is
unclassified and *names the TypeScript constant to update in the same commit*. It
has simply never been pointed at an event vocabulary, and the two this leaf owns
(`EventGateReason`'s 9 tokens; the 47 registry entries) are both hand-mirrored
across the language boundary with nothing comparing them.

**`vibeman` supplies the empirical cost, as siblings usually do — and it is a
cost paid by a repo that has the right type.** It rebuilt one `EventBus` to
*"replace 8 competing event systems"* and typed every event as a discriminated
union. Then: a **third** independent literal list appeared at
`src/hooks/useEventBus.ts:88-103` (`const allKinds: EventKind[] = [...]`)
enumerating **14 of the 21** kind strings. Because the array is typed
`EventKind[]` — and a subset of a union is a valid array of that union — **the
compiler cannot see the omission**, so seven kinds are pushed over SSE by
`eventBus.ts:263` with no client listener ever registered. That is this leaf's D3
and D7, in a codebase that did the type work. **A closed vocabulary makes the
name safe; it does not make the pairing exist.** It is the sharpest available
argument for §2(b), and for why *Prefer a type over a gate* here stops short of
claiming the newtype fixes the orphan problem.

## 7 Deviations

Every entry is live on `master` @ `b4a05049e` and measured against a read-only
copy of the operator's database.

### D1 (P0) — `PersonaAction` builds a validated field from an unsanitised name; 77 of 78 personas cannot publish one

`src-tauri/src/engine/dispatch.rs:309`

```rust
source_type: format!("persona:{}", ctx.persona_name),
```

`is_safe_type_string` (`db/src/repos/communication/events.rs:27`) admits only
`[A-Za-z0-9_.:/-]`. Replayed against the 78 live personas: **77 yield a rejected
`source_type`**. `publish` returns `AppError::Validation` and the handler
(`:327-329`) writes to the per-execution log file only. **`persona_action` has 0
rows in 4,972.**

The sibling arm at `:357-369` already computes `safe_name` with a comment
explaining exactly this. **Fix: use `safe_name` at `:309` too** — or better, hoist
the sanitiser into one helper both arms call, since two arms of one `match` is
precisely the distance at which a copy diverges. *Noted, not applied: this
changes what the app writes at runtime, and the operator is using it.*

### D2 — the vocabulary registry covers 1 of 33 publishers

`engine/src/event_vocabulary.rs:193` `validate_and_warn` has exactly **one**
production call site: `src/commands/communication/events.rs:86`, the
`publish_event` IPC command. The 32 others — including `dispatch.rs:370`, the
LLM-emitted path the module's own doc comment names as the risk — do not call it.

**Fix:** the validator cannot move into `publish` (`personas_db` cannot depend on
`personas_engine`). Two honest options: (a) move `event_vocabulary` down into
`personas_core` beside `core/src/events.rs`, which already holds the *other*
event-name registry, and call it from `publish`; or (b) accept that it is a
call-site discipline and make step 1 of §4 the enforcement. **(a) is the right
answer** — the module has no dependency on anything in `personas_engine` except
`bus::canonical_event_type`, which is a 20-line pure function that also belongs
in `core`.

### D3 — 39 live listeners wait on `trigger_fired`, which has been published 0 times

`triggers::create` auto-pairs an `event_listener` for the triggers it creates
(`db/src/repos/resources/triggers.rs:1014-1049`, marked with the
`_auto_for_trigger` advisory key). **39 such listeners exist, all
`status='active'`, all `enabled=1`, all listening for `trigger_fired`**
(`core/src/models/trigger.rs:414` — the default `event_type()`). The live table
contains **0** rows of that type.

This is not a defect in the pairing — the pairing is correct, and it is the
second instance of §2(b) in the tree. It is the **upstream producer**: per
[scheduled-trigger-firing](./scheduled-trigger-firing.md), no scheduled trigger
has fired since 2026-05-28. **Recorded here because it is the clean measurement
of what that outage cost this leaf**, and because 39 perfectly-wired subscribers
reporting nothing is exactly the state §2(b) is supposed to make visible and does
not.

### D4 — one 9-token vocabulary, two hand-maintained lists, zero cross-checks

`EventGateReason::token` (`src/engine/background.rs:977`) and
`EVENT_REASON_TOKENS` (`src/features/triggers/lib/eventReason.ts:17`) declare the
same nine strings. The Rust side asserts its own list (`background.rs:4060-4076`);
the TS side asserts its own (`eventReason.test.ts:11`). **Neither names the
other.** The TS comment says *"Keep in sync with `EventGateReason::token`"* — a
comment is the entire enforcement.

A tenth token added in Rust would ship green, and `parseEventReasonTokens` would
classify a row carrying it as `{kind: 'text'}` and render the raw machine token
to the user as if it were an error message.

**Fix:** the mechanism already exists in this repo —
`core/src/types.rs:824 terminal_set_matches_expected` asserts an exact set *and
names the TypeScript constant to update*. Copy it for `EventGateReason`. There is
a third copy of this vocabulary in `locales/en.json`
(`status_tokens.event_reason`, 10 keys) which the same test should cover.
`brainiac` does this against a SQL `CHECK` constraint (§6 clause 3).

### D5 — three copies of the publish INSERT, because the door has no transactional form

`db/src/repos/communication/events.rs:181` (the door),
`src/engine/webhook.rs:602`, `src/engine/cloud_webhook_relay.rs:514`. Same column
list, same `'pending'` literal, same preceding `encrypt_for_db` block. Both
copies exist for a good reason (§0.4) and both document it; neither is reachable
from the door.

**Fix:** add `publish_in_tx(tx: &rusqlite::Transaction, input) -> Result<PersonaEvent>`
to the events repo and have `publish` be `pool.get() → conn.transaction() →
publish_in_tx → commit`. Then both callers lose their copy and gain the
validation and the payload cap they currently skip. **This repo's own port
already has it**: `personas-cloud` `triggerScheduler.ts:190` publishes into
`persona_events` inside `database.transaction(…)` alongside three trigger
writes, because its storage layer hands out a transaction (§6 clause 1b). See
*Prefer a type over a gate*. *Noted, not applied — it changes a write path.*

### D6 — `source_type` is a routing dimension holding a mutable display name

`src/engine/dispatch.rs:309` and `:374` write
`persona:<slugified persona name>`. **4,166 of 4,972 rows (83.8%) carry it,
across 11 distinct spellings**, all derived from `personas.name`
(`persona:T:_Dev_Clone` ← `T: Dev Clone`). `idx_pev_source_type` indexes it, the
events UI filters on it, and `source_id` — which is already populated and
resolves to a live persona for **4,166 of 4,166** rows — carries the stable
identity.

Routing does not read the suffix (`bus.rs:183` only tests
`starts_with("persona:")`, and `source_filter_matches` compares against
`source_id`), so this is not a correctness bug today. It is a **history bug**:
renaming a persona partitions its own event history in the one column a human
filters by. Note also that `bus.rs:592`'s own test fixture writes
`format!("persona:{}", emitting_persona_id)` — **the id** — so the bus's tests and
the bus's production emitter disagree about what the suffix is.

**Fix:** write `source_type: "persona"` (a *type*) and let `source_id` carry the
identity; resolve the display name at read time. This is a data-shape change and
belongs behind a migration.

### D7 — a consumer can disappear and nothing records it

`dev_tools.context_scan_started` and `dev_tools.context_scan_completed` each have
**6 `delivered` rows (June) and 8 `skipped/no_subscriber` rows (August)**. The
publisher (`src/engine/system_ops.rs:314`) is unchanged and correct — it even
takes its name from an `event_name::` constant, the best form in the tree. What
changed is on the other side, and there is no row, log or health item for
"an event type that used to have a consumer no longer does."

`get_event_skipped_stats` can show the *rate*; nothing shows the *transition*.

**Fix:** the query is cheap and the instrument is nearly there — extend
`skipped_rate_by_type` (`events.rs:641`) with the last `delivered` timestamp per
type, so a type with `last_delivered_at IS NOT NULL AND skipped_rate = 100%` is
distinguishable from one that was never routed anywhere. That is a *lost
consumer*, and it is the only shape in this leaf worth paging on. **The fork
already records the richer version**: `personas-cloud`
`eventProcessor.ts:662-666` writes `recordSubscriptionsEvaluated(subs.length,
matches.length, …)` for **every** event, so "how many were considered, how many
matched" is durable per row rather than collapsed into a boolean (§6 clause 6b).

### D8 — the `Skipped` doc comment describes 1 of its 9 causes

`core/src/models/event.rs:25` — *"No matching subscribers — event was
intentionally skipped."* Six of the nine `EventGateReason` variants are not that:
`approval_held`, `persona_disabled`, `handoff_target_disabled`,
`cross_team_blocked`, `cascade_guard`, `dry_run`. **Fix: one comment**, listing
all nine or pointing at `EventGateReason`. *Not applied — this pass wrote only
this document — but it is the cheapest item in the list and carries no runtime
risk, so it is the one to take first.*

### D9 — the routing verdict lives in `error_message`

`update_status(pool, id, Skipped, Some(token))` writes the gate token into
`error_message`, which also carries free-form failure text and — when a payload
fails to decrypt — is **concatenated** with the decryption error
(`events.rs:126`: `format!("{existing}; {decrypt_err}")`). A skipped event whose
payload will not decrypt therefore reads `no_subscriber; [Decryption failed: …]`,
which `parseEventReasonTokens` correctly classifies as free text — so the reason
is lost exactly when there are two things worth knowing.

**Fix:** a `skip_reason TEXT` column. The reader
(`eventReason.ts`) is already written as if it existed.

## 8 Gaps — what the primitives genuinely cannot do

1. **The vocabulary registry is on the wrong side of a crate boundary.**
   `personas_db` cannot see `personas_engine`, so `publish` cannot validate the
   name it is storing. This is the single structural cause of D2, and it is why
   §9's gate is a call-site gate rather than a door.
2. **`event_type` cannot be an enum, and should not be.** The fleet emits
   LLM-authored names; the module says so and is right. So the closed-vocabulary
   answer that works for `brainiac` (`enum` + `CHECK`) is unavailable here in its
   strong form. The available form is a *known* vocabulary that warns — which is
   what exists, unreached.
3. **The census cannot assert that an event has a subscriber.** It is a property
   of the database and of two independently-authored strings, not of any file.
   §0.6's 94%-vs-13% was measurable only by opening the live rows.
4. **The census cannot assert an absence**, and this leaf's largest finding is
   one: *no code anywhere records that an event type lost its consumer* (D7).
   Likewise "39 listeners have no publisher" (D3) and "0 `persona_action` rows"
   (D1) — the last was findable in the source only because the *validator* is
   readable; the *consequence* needed the database.
5. **`is_safe_type_string` refuses but cannot repair.** It is called at the door,
   after the caller has already assembled the string, so its verdict is a runtime
   error at one call site rather than a constraint on the assembly. No Rust type
   at that boundary can express "a `String` that already passed this predicate"
   without a newtype the callers would have to opt into — which is the *Prefer a
   type* proposal, and it is genuinely a new type, not a tightening.
6. **`canonical_event_type` cannot rescue a misspelling**, only a separator, and
   the module says so at `:5-7`. `code_reveiw.completed` is a permanently dead
   subscription and only `nearest_builtin` would catch it — at publish time, in a
   warning, in a log with 7-day retention.
7. **Nothing can tell a deliberately-unconsumed event from an orphaned one.**
   `schedule.missed.offline` is marked *"never listener-matched — informational"*
   in the registry (`event_vocabulary.rs:117`) — in a **comment on a category
   tuple**, not in a field. Until that intent is data, `no_subscriber` on those
   rows is noise, and today it is most of the noise (16 of 31 August rows).

## Prefer a type over a gate

**Give `publish` a transaction-taking form and give the two type strings a
validated newtype: `publish_in_tx(tx: &Transaction, input: CreatePersonaEventInput)`
where `event_type: EventType` and `source_type: SourceType`.**

Held against all seven qualifications.

1. **A required prop carries only what it actually encodes.** ✔ and this is the
   qualification that shapes the design. `EventType` can encode *"a string that
   satisfies `is_safe_type_string` and is ≤128 bytes"*. It **cannot** encode *"a
   name some subscriber listens for"* — that is a fact about two rows in a
   database, not about a string. So the newtype closes D1 and closes nothing
   else, and the document must not claim otherwise. §0.2's eleven orphan names
   are all perfectly valid `EventType`s.
2. **Requiredness is orthogonal to closedness.** ✔ `event_type` is *already*
   required — it is a non-`Option` field on `CreatePersonaEventInput` and 33
   callers supply it. Requiredness has done nothing. What is missing is
   closedness, and the honest reading (Gap 2) is that **this field cannot be
   fully closed** — an LLM mints names at runtime. The reachable win is the
   *character-set* closure, which is exactly the constraint D1 violates.
3. **A type nobody constructs constrains nothing.** ✔ — and this decides the
   transaction half. `EventType` would be constructed at 33 sites, all on hot
   paths, none decorative. Contrast the parallel candidate in this repo:
   `ExecutionState::TERMINAL` is a beautiful closed const with **zero production
   constructors** ([retention-and-pruning](./retention-and-pruning.md)), and it
   has prevented nothing. Count the construction sites first; here they exist.
4. **A type anyone can construct authenticates nothing.** ✔ So
   `EventType(String)` with a public field is a comment. It must be
   `pub struct EventType(String)` with a **private** field and one constructor
   `EventType::new(&str) -> Result<Self, AppError>` that runs
   `is_safe_type_string`. Then `format!("persona:{}", ctx.persona_name)` no longer
   compiles into the field, and D1 becomes a compile error rather than a runtime
   validation that 77 of 78 personas trip.
5. **Withholding beats requiring.** ✔ — and this is where the *transaction* half
   lands. Requiring callers to pass a transaction would be a 33-site churn for a
   concern 31 of them do not have. **Withhold instead:** keep `publish(pool, …)`
   for the majority and *add* `publish_in_tx(tx, …)`, then have `publish` be
   implemented as `pool.get() → transaction() → publish_in_tx → commit`. What is
   withheld is the *reason to hand-write the INSERT*, which is the actual
   defect (D5). Nobody is required to do anything new.
6. **Withhold the dangerous freedom, not the answer.** ✔ The answer — "this
   event is named `qa.pr.approved`" — stays fully expressible. What is withheld
   is the freedom to put *arbitrary text* in a slot the door will reject, and the
   freedom to write the INSERT yourself. Getting this backwards would look like
   forbidding runtime-computed names, which would break `wire_team_handoff` —
   **the best code in the subject area computes its name at runtime**, and any
   proposal that outlaws that is withholding the wrong half.
7. **Withholding a requirement only helps when the requirement forced the bad
   value.** ✔ and it is why the newtype is the fix rather than a signature
   change. Nothing *forced* `dispatch.rs:309` to build a bad `source_type`; it
   volunteered one. Relaxing or tightening the field's `String` type is inert —
   `String` is already what it is. **The construction is what must be withheld**,
   which is why the proposal removes the `String` constructor rather than adding
   a parameter. Same shape as `buildMetadataWithTags`
   ([entity-draft-editing](./entity-draft-editing.md)).

**Does the type reach the code?** For `EventType`/`SourceType`: **yes, at every
site.** Both are struct fields on `CreatePersonaEventInput`, which is passed **by
value as a parameter** into `publish` — every one of the 33 callers crosses a
signature `rustc` checks, and the 11 literal sites in §0.2 would each need
`EventType::new("…")?`. For the transaction: **yes, and this is the
discriminating comparison.** `&Transaction` vs `&DbPool` is a compile error to
confuse — the same argument the contract already records from `brainiac`'s
`&mut PgConnection` vs `&PgPool`, where the type made a gate unnecessary, and
which `brainiac` uses on this exact concern at
`crates/brainiac-store/src/governance.rs:239` (`conn: &mut PgConnection`, the
status change and its audit row on one handle). The oracle supplies the control
experiment: **the same fire path, ported to a stack whose storage layer hands out
a transaction, publishes inside one** (§6 clause 1b). Nobody had to be
disciplined; the type was different.

What **cannot** reach the code, and must be said, is the thing this leaf most
wants: *whether anyone listens*. That lives in `persona_event_subscriptions` and
`persona_triggers.config`, is authored by a different pass at a different time,
and no type at any boundary can see it. `vibeman` is the proof that closing the
vocabulary does not close this: it has the discriminated union and still lost 7
of 21 kinds to a hand-written `EventKind[]` the compiler could not fault (§6).
**The newtype fixes D1 and nothing else; the pairing discipline in §2(b) is not
a type, and §9 is honest about that too.**

Cost: `EventType`/`SourceType` are ~30 lines in `core/src/models/event.rs` plus
33 call-site edits; `publish_in_tx` is a refactor of one function plus deleting
two copied INSERTs. It removes D1 permanently and makes D1's recurrence a
compile error.

## 9 The missing gate

**Condition, stated stack-free:** *the identifier that routes a published fact to
its consumers is authored inside the publishing call, so the producer's name and
the consumer's name are two independent strings that nothing compares.*

An adopting repo must derive its own proxy. This one keys on a Rust struct
literal; it would report green forever in a TypeScript codebase where the same
condition is spelled `bus.emit({ kind: 'task:change', … })` — and note that
`vibeman` writes exactly that and is *not* violating, because `kind` there is a
discriminant of a declared union. **The signal is "the name has no declaration
anywhere else", and its proxy differs per stack.**

**Existing rules checked for overlap before writing this**, by reading each
definition rather than its title:

- `unregistered-tauri-event-name` (`backend-to-frontend-events`) — the nearest
  neighbour by subject, and **measurably disjoint**. It anchors on
  `<appHandle>.emit(` and governs the Rust→JS transport; this rule anchors on
  `CreatePersonaEventInput` and governs the durable bus. Both patterns were run
  over the same 963-file walk and the match sets intersected: **0 shared files
  and 0 overlapping character ranges.** Not "different in principle" — measured.
- `unverified-effect-dispatch` (`post-write-side-effects`) — `let _ =` around a
  Tauri emit. Different anchor, different failure (a discarded result vs an
  unshared name). Same intersection run: **3 files hold matches of both, and 0
  match sites overlap** (`context_rules.rs`, `background.rs`,
  `cloud_webhook_relay.rs` each publish an event *and* separately discard an
  emit result, at different statements).
- `untranslatable-token-label` — a closed-vocabulary *label* authored beside its
  colour, TypeScript only.
- `settings-key-declared-outside-registry` — the closest *idea* (a name declared
  outside its registry) and the clearest precedent that this shape is
  gate-worthy; different subject (settings keys), different anchor
  (`const X_KEY: &str`).
- Also read and rejected as non-overlapping: `silent-row-skip`,
  `hand-rolled-fixture-ddl`, `blind-identity-write`, `discarded-guard-verdict`,
  `retention-delete-by-status-allowlist`, `partial-terminal-status-set`,
  `outcomeless-tick`, `unqueryable-log-record`, `unkeyed-billable-spawn`,
  `untyped-command-payload`.

**None covers an event name minted at its emit site.** Proposing a new one.

**Fail-loud:** inherited from the runner — a walk below `floor: 900` (the tree is
963 `.rs` files), a rule matching zero files, a stale `exclude`, a rise, or a
**silent drop** all exit non-zero.

### Precision, measured by hand

All **12** matches were opened. **11 are production** and each is listed with its
name in §0.2; **1** (`db/src/repos/resources/triggers.rs:3165`,
`"stock.alert.old_name"`) is a `#[cfg(test)]` fixture the census engine cannot
brace-match ([retention-and-pruning](./retention-and-pruning.md) Gap 6).
**Precision 11/12 = 92%.**

The pattern deliberately does **not** match the shorthand field
(`background.rs:2747`, `:2909` — `event_type,` from a binding), which is correct:
those take the name from the trigger's config, which is where
`wire_team_handoff` put it.

One exclusion is carried: `db/src/repos/communication/events.rs`, which holds
**29** of the raw 41 matches — all `#[cfg(test)]` fixtures — and is also the
module that defines the door, so any construction there is either a fixture or
the definition.

### The rule

```json
{
  "rules": [
    {
      "id": "inline-minted-event-name",
      "goldenPath": "docs/concepts/golden-paths/domain-event-publication.md",
      "title": "A domain event's routing name is typed at the emit site, so no subscriber declaration can reference the same expression",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "CreatePersonaEventInput\\s*\\{(?:(?!CreatePersonaEventInput)[\\s\\S]){0,200}?event_type\\s*:\\s*(?:\"|format!)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a persona_events publication whose event_type is a bare string literal or a format! assembled inside the CreatePersonaEventInput literal itself. The fill is bounded to 200 chars AND cannot cross into a second ctor (negative lookahead on the type name), so a match can never span two publications. PROXY FOR the stack-free condition: the identifier that routes a published fact to its consumers is authored inside the publishing call, so the producer's name and the consumer's name are two independent strings that nothing compares. It does NOT match the shorthand `event_type,` or a named binding -- taking the name from a variable, a const, or a trigger config is the compliant form and is what the positive control counts. MEASURED 2026-08-16 at b4a05049e: 12 matches in 11 files, ALL TWELVE OPENED (precision 11/12 = 92%; the one false positive is a #[cfg(test)] fixture at db/src/repos/resources/triggers.rs:3165, which the engine cannot brace-match). Scoring the 11 production names against the operator's live database: ALL 11 have 0 rows in 4,972 persona_events and 0 live consumers, and 6 of the 11 are absent from the 47-entry BUILTIN_EVENT_TYPES registry. By contrast the 51 event names minted by ONE shared function (engine/team_handoff.rs:57 handoff_event_type, which writes the same expression into both the emitter's trigger config and the receiver's listen_event_type) have a live consumer 48 of 51 times -- 94% vs 13% for everything else. The live consequence is dispatch.rs:308: `persona_action` is minted here and has never been published, because the sibling field on the same struct interpolates an unsanitised persona name that the door's validator rejects for 77 of 78 live personas. Overlap with the two nearest rules was measured, not asserted: 0 shared files and 0 overlapping match ranges with unregistered-tauri-event-name; 3 shared files and 0 overlapping ranges with unverified-effect-dispatch. RATCHET ONLY -- the fix is EventType/SourceType newtypes plus registering the name in event_vocabulary.rs (see the path's 'Prefer a type over a gate')"
      },
      "exclude": [
        {
          "path": "src-tauri/db/src/repos/communication/events.rs",
          "reason": "the publish primitive's own module. All 29 of its matches are #[cfg(test)] fixtures, which the census engine cannot exclude by brace-matched range (retention-and-pruning Gap 6); the module also defines the door itself, so a CreatePersonaEventInput here is either a fixture or the definition, never a call site."
        }
      ],
      "baseline": { "files": 11, "matches": 12 },
      "floor": 900
    }
  ]
}
```

### Positive control (evidence, NOT merged)

Same anchor, pointed at the **compliant** arm: `event_type` taken from a named
binding (a variable, a const, a struct field) rather than typed inline. Under the
same exclusion it returns **20 matches / 20 files** — including
`overnight.rs:492` (`NIGHT_DIGEST_EVENT_TYPE`), `system_ops.rs:331` (an
`event_name::` constant), `chain.rs:706` and `scheduler.rs:282` (the name read
back from the trigger config `wire_team_handoff` wrote), and
`dispatch.rs:373` (the aliased user-authored name).

**12 violating against 20 compliant on one anchor.** A near-zero control would
have meant the pattern was not discriminating on "the name is authored here" but
merely finding all event publishing; a 12/20 split says the two forms genuinely
coexist and the rule separates them. Note honestly that `dispatch.rs:373` is
compliant in *shape* only — the name it forwards is LLM free text — which is
precisely why the rule is a ratchet and D2 (routing every publisher through the
registry) is the real fix.

```json
{
  "id": "inline-minted-event-name-positive-control",
  "goldenPath": "docs/concepts/golden-paths/domain-event-publication.md",
  "title": "POSITIVE CONTROL — event_type taken from a named binding rather than typed at the emit site",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "CreatePersonaEventInput\\s*\\{(?:(?!CreatePersonaEventInput)[\\s\\S]){0,200}?event_type\\s*:\\s*[A-Za-z_]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "the compliant arm of the same anchor; measured 20 matches / 20 files at b4a05049e under the same exclusion. NO baseline by design — a control is evidence, not a ratchet."
  },
  "exclude": [
    {
      "path": "src-tauri/db/src/repos/communication/events.rs",
      "reason": "same exclusion as the rule it partitions against — the door's own module, whose constructions are fixtures or the definition."
    }
  ],
  "floor": 900
}
```

### Refused: a gate on unvalidated publishers — with the numbers

D2 (33 publishers, 1 validated) is the more valuable thing to gate and **I could
not build a rule worth shipping for it.** The signal would have to be "an
`events::publish` call not preceded by `validate_and_warn`", and:

| candidate | matches / files | verdict |
| --- | --- | --- |
| `(?:event_repo\|events\|repo)::publish\(` | **43 / 29** | fires on every publish, including the one correct site. **A gate that fires on correct content is worse than no gate** (contract §9). |
| the same, minus the validated site | — | requires a **variable-length lookbehind** to express "not preceded by `validate_and_warn(&input.event_type);`". Forbidden by the doctrine's mechanics, and the two statements are not even adjacent at the one compliant site. |

**Refused.** The condition is real and the fix is structural, not countable:
move `event_vocabulary` into `personas_core` and call it from `publish`, at which
point the count that matters is 0 and there is nothing to ratchet.

### What the census fundamentally cannot gate here

Three of this document's largest findings are **absences**, and none has a
textual signal:

- **D7 — an event type that used to have a consumer no longer does.** Two
  columns of one table, over time. Not a fact about any file. The instrument is
  `skipped_rate_by_type` extended with `last_delivered_at`, specified in D7.
- **D3 — a subscriber with no publisher.** 39 rows waiting on a name nothing
  emits. Joining `persona_triggers.config → listen_event_type` against the set of
  names any Rust file can emit is a cross-artifact query no regex can pose. The
  instrument is a boot-time reconcile that lists listener types with no
  registry entry and no historical row.
- **D4 — two token lists that agree today.** The census counts things that are
  present; "these two lists are equal" is an assertion, and the right host is a
  Rust test naming the TypeScript constant — the shape
  `core/src/types.rs:824` already uses.

## 12 Corrections to the brief

The brief's leads were checked before being used. Four were confirmed, two are
wrong, and one is right about the fact and wrong about the cause.

1. **"The bus ticks and delivers nothing… 31 rows written in August, all
   `status='skipped'`." — CONFIRMED, and sharpened.** All 31 are `skipped`; 25
   carry `no_subscriber` and 6 carry a NULL reason (they predate the ledger,
   which landed between 2026-08-11T11:41 and 2026-08-11T19:53). **But the framing
   inverts the cause.** The bus is not failing to deliver; **nothing is
   publishing.** There are **0 events of any status between 2026-06-27 and
   2026-07-31** — a 35-day hole — and 16 of the 31 August rows are two event
   types whose publisher's own doc comment says they are *supposed* to have no
   consumer. The correct statement is *"the producers stopped, and the two that
   remain are informational."* [stall-watchdog](./stall-watchdog.md)'s §0 carries
   the same inversion (*"the bus loop is ticking, receiving events, and has
   delivered zero of them for 51 days"*) and is owed the correction.

2. **"`events::cleanup`'s allowlist names a status only tests write and omits the
   production terminal state." — CONFIRMED**, and it is
   [retention-and-pruning](./retention-and-pruning.md)'s P0, already published.
   Confirmed here from the emit side: `Completed` has 0 rows because the only
   writer of it in the tree is `commands/communication/mock_seed.rs`.

3. **"0 of 4,972 events have `source_type` of `trigger` or `scheduler`." —
   CONFIRMED, but it is not the finding it looks like.** Those two values are not
   part of the vocabulary at all: the scheduler publishes with
   `source_type: "trigger"`-shaped values nowhere; the 15 live values are
   `chain`, `findings`, `manual_review`, `system_op` and **11 `persona:<name>`
   spellings**. The real finding under this stone is D6 — `source_type` is a
   *type* column holding a **slugified display name** for 83.8% of rows.

4. **"26 line-bearing channels exist and 13 have no frontend subscriber… several
   named events have 0 listeners (`EXECUTIONS_SILENT_DETECTED`,
   `subscription-crashed`, `queue-backpressure`)." — OUT OF SCOPE, and
   miscounted against this leaf.** Those three are **Tauri transport** names in
   `src/lib/eventRegistry.ts` / `src-tauri/core/src/events.rs`, not
   `persona_events` types — none of the three appears in the 186 spellings in the
   live table. They belong to
   [backend-to-frontend-events](./backend-to-frontend-events.md), which already
   owns two census rules over exactly that surface, and
   [stall-watchdog](./stall-watchdog.md) D-list already records
   `EXECUTIONS_SILENT_DETECTED` as listener-less. Noted, not re-derived. *(One
   observation worth handing over: `src-tauri/src/engine/mod.rs:960` emits
   `"queue-backpressure"` as a raw string literal rather than through
   `event_name::` — a live instance of that path's own
   `unregistered-tauri-event-name` condition.)*

5. **"`reap_stuck_processing_events` exists; the dead-letter table is perfect and
   has never fired (4,972 rows, `retry_count=0` on all, 0 dead-lettered)." —
   CONFIRMED on the numbers, WRONG on "table".** There is **no dead-letter
   table**: `DeadLetter` is one of the eight `PersonaEventStatus` variants on
   `persona_events` itself, reached by `move_to_dead_letter` (`events.rs:839`)
   and `dead_letter_from_processing` (`:885`). The distinction matters for
   retention — the DLQ shares a table with the live queue, and
   [retention-and-pruning](./retention-and-pruning.md)'s own fix note flags that
   `DeadLetter` must be excluded from retention eligibility for exactly that
   reason. Confirmed: `retry_count = 0` on all 4,972; **0 rows in `failed`,
   `dead_letter`, `discarded`, `pending` and `processing` combined.**

6. **"whether an event with no subscriber is detectable" — YES, and better than
   the question implies.** `no_subscriber` is a first-class token with a Rust
   test, a strict TypeScript parser, an i18n label, an IPC command
   (`get_event_skipped_stats`) and a live frontend consumer
   (`useEventLog.ts:112`). The gap is not detection, it is **direction**: the
   instrument reports a rate, and the thing worth knowing is a *transition* (D7).

7. **"whether publication is transactional with the state change it describes" —
   NO, and it is structurally unavailable, not merely unpractised.** `publish`
   takes `&DbPool` and calls `pool.get()`, so it commits on its own connection.
   0 of 33 sites are atomic with their state change; the 2 that needed to be
   copied the INSERT instead (§0.4, D5).

### A correction to my own first measurement

My first pairing run reported *"17 published types have a live consumer, 169 do
not"* because it read the listener's event name from `config.event_type` — the
key the **build prompt** uses. The key the **runtime matcher** uses is
`listen_event_type`, and `build_sessions.rs:2140-2148` translates between them at
the boundary precisely because they differ. Reading the wrong key silently
scored **183 of 189 listeners as unparseable** and would have published a
seven-fold overstatement of the orphan rate. The corrected figures are the ones
in §0.6. **The only thing that caught it was dumping the distinct config keys
instead of trusting the field name** — the same lesson
[scheduled-trigger-firing](./scheduled-trigger-firing.md) §9 records about
measuring the same quantity a second way.
