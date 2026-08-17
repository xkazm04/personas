# Golden path — the trigger wiring surface

> Situation node: `backend-runtime/scheduling-and-triggers/trigger-wiring-surface`
> ("Event subscription: armed in the UI, matched in the engine") ·
> [situation spine](../situation-spine.md) · recurrence **14** · risk **medium** ·
> sides **client** (**tested — inverted at the point of damage, §12.1**) ·
> convergence **mixed** (**tested — UPHELD, and the fleet converged on the disease, §12.2**) ·
> dimensions: **function · ui · resilience**
> `mergedFrom`: *Per-entity event subscription* + *Marketplace feed wiring* + *Route composer* +
> *Event to subscriber matching*
> Composed 2026-08-17 against `master` @ `6c97502d3`.
>
> **Subject.** The surface where a **human wires a trigger up** — the add-trigger form, the Trigger
> Studio canvas, the template-adoption chronology, the natural-language parser, the quick templates,
> the rate-limit and active-hours drawers — and **the gap between what that surface can express and
> what the engine reads.** The *firing* of a schedule is
> [scheduled-trigger-firing](./scheduled-trigger-firing.md); the *publication* of the event is
> [domain-event-publication](./domain-event-publication.md). This path owns everything between the
> click and the row.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/` and all **963** `.rs` under `src-tauri/`
> (walker agreed with the census engine's `walked` at **5,792** for the union). Read in full:
> `configs/buildTriggerConfig.ts`, `TriggerAddForm.tsx`, `TriggerTypeSelector.tsx`,
> `TriggerStatusSummary.tsx`, `TriggerListItem.tsx`, `triggerArmState.ts`, `triggerConstants.ts`,
> `eventTypeTaxonomy.ts`, `ActiveHoursSection.tsx`, `RateLimitControls.tsx`,
> `stores/slices/pipeline/triggerSlice.ts`, `sub_studio/routing/layouts/{buildEventRows,useRoutingState}.ts`,
> `sub_studio/libs/studioCommit.ts`, `ChronologyAdoptionView.tsx`, `useCasePickerShared.ts`;
> on the Rust side `core/src/models/trigger.rs` (1,078 lines), `core/src/validation/trigger.rs`,
> `db/src/repos/resources/triggers.rs`, `db/src/repos/communication/events.rs`,
> `db/src/migrations/schema.rs`, `engine/src/bus.rs`, `src/engine/polling.rs`,
> `src/engine/background.rs::event_bus_tick`, `src/commands/tools/triggers.rs`,
> `src/commands/design/build_sessions.rs`, `engine/src/design.rs`.
>
> **Measured by EXECUTING, not by reading.** Six things were run:
>
> 1. A read-only **copy** of the operator's live `personas.db` (347,054,080 bytes, copied
>    2026-08-17 14:52 with its `-wal`/`-shm`; the live file was never opened for write) supplied
>    every row figure: **351 triggers, 102 event subscriptions, 4,972 `persona_events`, 2,188
>    executions, 78 personas.** **The copy was deleted at the end of composition.**
> 2. **The live `CREATE TABLE persona_triggers` DDL was lifted out of the copy and replayed into an
>    in-memory SQLite database, and one INSERT was attempted per trigger type.** That is §0.1, and
>    it is not a reading of the schema — it is the schema's own answer.
> 3. **`TriggerConfig::from_raw`'s match arms were parsed out of the Rust source mechanically** and
>    joined, **per `(trigger_type, key)`**, against every key present in all 351 live configs and
>    against every key `buildTriggerConfig.ts` can write. That join is §0.2. My first pass did it
>    **key-level instead of (type,key)-level and got three verdicts wrong** — §12.5.
> 4. **The real `buildEventRows.ts`** (the Trigger Studio's row model) was executed under Node's
>    type stripping over the live triggers, the live subscriptions and the Studio's own
>    `listEvents(1000)` window, and every `subscription` cable it produced was pushed through a
>    verbatim replay of `delete_subscription`'s cascade SQL. That is §0.3.
> 5. **`bus::canonical_event_type` was transcribed** (gated against `bus.rs`'s own `#[cfg(test)]`
>    separator cases) and used to pair every wiring row against the 186 distinct event-type
>    spellings in the live table. That is §0.4 and §0.5.
> 6. The §9 rule was built, counted by **two structurally independent implementations** (the census
>    engine and a private walker with its own traversal and its own regex assembly) which agree at
>    **6 files / 9 matches**; all 9 were opened by hand; overlap was measured **at site level against
>    the FINAL pattern** across all **163** baselined `.ts`/`.tsx`/`.rs` rules in the registry; the
>    rule was exercised through **twelve** fail-loud modes; then **re-extracted from this finished
>    document and re-run — identical**. **The full registry was NOT run**, per the doctrine.
>
> **`cargo` was NOT run** (the operator's app is in daily use). Every Rust claim is static, or
> replayed in transcribed JavaScript gated against that file's own tests, or replayed as SQL against
> the copy. **No trigger was created, enabled, or fired.** **No secret value, prefix or length
> appears below.**
>
> **Nothing here was applied.** Per the campaign's no-destructive-applies rule, §7 is a fix backlog.

---

## 0 The headline: the surface is wider than the store, wider than the reader, and it says "armed" either way

`getTriggerArmState` (`src/features/triggers/sub_triggers/triggerArmState.ts:87`) has three answers —
`disabled`, `sleeping`, `armed` — and the docstring above it says `armed` means *"enabled and
currently eligible to fire."* Replayed over the operator's 351 rows against each type's **actual**
dispatch predicate:

| | rows |
| --- | ---: |
| triggers the UI badges **`armed`** | **325** |
| triggers the UI badges **`disabled`** | 26 |
| triggers the UI badges **`sleeping`** | **0** (0 of 351 configure an `active_window`) |
| triggers that can reach a dispatch predicate at all | **227** |
| …of which need a human to press Run (`manual`) | 68 |
| …of which fire only when another persona finishes (`chain`) | 55 |
| **triggers that can fire unattended** | **104** |
| **rows badged `armed` that can never fire** | **98** |
| rows `get_due` returns right now | **0** |
| rows `get_due` would return with the time bound removed entirely | **0** |
| `persona_executions` carrying a `trigger_id` | **0 of 2,188** |

**Of the operator's 351 triggers, 104 can ever fire on their own, and the UI says 325 are armed.**
Not one execution in the entire history of this install is attributable to a trigger.

The reasons the other 124 cannot fire, replayed row by row:

| reason | rows |
| --- | ---: |
| `listen_event_type` names a type never published in 4,972 events | **82** |
| `next_trigger_at IS NULL` — invisible to `get_due` forever | 37 |
| `config.url` absent, and `polling.rs:243` reads **only** `url` | 7 |
| owning persona is disabled | 7 |

Every one of those 124 renders identically to a healthy one, except the 26 that render *worse* than
healthy (§0.6). The three sections below are why.

### 0.1 — Four of the ten trigger types the surface offers cannot be stored. Executed.

`VALID_TRIGGER_TYPES` (`src-tauri/core/src/validation/trigger.rs:3-14`) admits **ten**.
`TriggerConfig::from_raw` (`core/src/models/trigger.rs:578-717`) has a match arm for **ten**.
`TRIGGER_TYPE_OPTIONS` (`src/lib/utils/platform/triggerConstants.ts:102`) offers **ten**, in three
categories, each with its own React config panel wired at `TriggerAddForm.tsx:229-236`.

The column admits **six**. Lifted verbatim from the live database and replayed in memory, one INSERT
per type:

```
ACCEPTED : manual   schedule   polling   webhook   chain   event_listener
REJECTED : file_watcher   clipboard   app_focus   composite
           -> CHECK constraint failed: trigger_type IN
              ('manual','schedule','polling','webhook','chain','event_listener')
```

This is **not** a migration artifact on one machine: the fresh-install schema
(`src-tauri/db/src/migrations/schema.rs:87`) carries the same six-value `CHECK`, and so do both
incremental copies (`incremental.rs:472`, `:1074`). **No install of this app has ever been able to
store a `file_watcher`, `clipboard`, `app_focus` or `composite` trigger**, and the live table
confirms it: 351 rows, five distinct types, none of the four.

What the user gets instead:

- **`TriggerQuickTemplates`** — the one-click strip above the form — has **6 templates, and all 6
  target an unstorable type** (3 `file_watcher`, 3 `clipboard`; `triggerConstants.ts:381-450`).
  The entire quick-start strip is dead.
- **`nlTriggerParser.ts`** — "run this whenever I copy a URL" — can resolve to `file_watcher`
  (`:186`, `:201`), `clipboard` (`:219`, `:236`) and `app_focus` (`:256`, `:264`).
- **`normalize_trigger_type`** (`core/src/validation/trigger.rs:29-39`) *manufactures* two of them
  from aliases: `watcher | fs_watcher | watch → file_watcher`, `focus | window_focus → app_focus`.
  Its hand-written TypeScript mirror (`useCasePickerShared.ts:26-32`) does the same, and its own
  comment says it is the *"Single source of truth for both adoption surfaces … previously duplicated
  and had drifted."*
- **Trigger Studio** lists all four in `FORM_COMMITTABLE_SOURCE_TYPES` (`studioCommit.ts:33-42`).

And the failure is anonymous. `create_trigger` propagates the `rusqlite` error; no rule in
`src/lib/errors/errorRegistry.ts` matches `CHECK constraint failed`, so `resolveError` falls to
`GENERIC_FALLBACK` (`:620-623`) and `TriggerAddForm.tsx:174` renders:

> **Something went wrong.** *Try again. If the problem persists, restart the app or check your
> connection.*

**Six vocabularies, no two the same.** Counted by hand from the tree:

| declaration | admits | where |
| --- | ---: | --- |
| `VALID_TRIGGER_TYPES` | **10** | `core/src/validation/trigger.rs:3` |
| `TriggerConfig::from_raw` arms | **10** + `Unknown` | `core/src/models/trigger.rs:578` |
| `TRIGGER_TYPE_OPTIONS` (the menu) | **10** | `triggerConstants.ts:102` |
| `FORM_COMMITTABLE_SOURCE_TYPES` (Studio) | **8** | `studioCommit.ts:33` |
| **the `CHECK` constraint** | **6** | `db/src/migrations/schema.rs:87` |
| `design.rs:339` `valid_types` (design review) | **4** | `engine/src/design.rs:339` |
| `n8n_transform/confirmation.rs:154` `valid_types` | **4** | — |

`design.rs:339` is worth its own sentence: the design-review validator reports
*"Unknown trigger type 'event_listener'"* for the type that is **189 of the operator's 351 rows** and
the one the adoption view itself emits (`ChronologyAdoptionView.tsx:324`). A repo-wide scan for
hand-written copies of this vocabulary (≥3 distinct types, ≥2 storage-admitted, within 120 chars)
finds **37 non-test sites in 26 files**, at arities 3, 4, 5, 6, 7, 8 and 10. **None of them imports a
shared declaration, because there is none to import**: `PersonaTrigger.trigger_type` is `String` in
the ts-rs binding, so no generated union exists on the client at all.

### 0.2 — The form can write 23 config keys. The engine reads 8.

`buildTriggerConfig.ts` is the Add-trigger form's whole write path — 70 lines, one `if/else if`
chain, one `Record<string, unknown>` out. Joining every key it can emit against
`TriggerConfig::from_raw`'s match arms **per `(trigger_type, key)`**:

| verdict | keys |
| --- | ---: |
| written and read | **8** |
| written into a `trigger_type` the table rejects (§0.1) | **13** |
| **written, stored, and never read by anything** | **2** |

The two are both on `polling`, and they are the whole polling form:

**`config.endpoint` (`buildTriggerConfig.ts:75`) — the engine reads `url`.**
`TriggerConfig::Polling` (`core/src/models/trigger.rs:593-607`) has a `url` field and no `endpoint`.
The poller destructures it and bails:

```rust
// src/engine/polling.rs:243-259
crate::db::models::TriggerConfig::Polling { url, headers, content_hash, .. } => …
let url = match cfg_url {
    Some(u) if !u.is_empty() => u,
    _ => {
        tracing::warn!(trigger_id = %trigger.id, "Polling trigger missing 'url' in config");
        …
```

The form has **never** written `url` — `grep 'config.url' src/` returns nothing. And the sharpest
part is *which* readers do accept `endpoint`: **the two that tell the user it is fine.**

| reader | accepts `endpoint`? | what it does |
| --- | :---: | --- |
| `core/src/validation/trigger.rs:262` — the SSRF guard | **yes** (`.or(v.get("endpoint"))`) | passes the URL to `validate_url_safety` |
| `commands/tools/triggers.rs:418-421` — the **Test** tab | **yes** (`.or_else(\|\| config.get("endpoint"))`) | HEAD request, renders **"Reachable"** |
| `src/engine/polling.rs:243` — **the poller** | **no** | logs `missing 'url'`, advances the pointer |
| `TriggerStatusSummary.tsx:24-26` — the row summary | **yes** | renders the hostname |

So the user types a URL, the form accepts it, the validator vets it, the Test tab says *Reachable*,
the row displays the hostname — and the poller never fetches it. `triggerConstants.ts:241` calls
`endpoint` a *"Legacy field: endpoint URL (alias for url)"*. It is not legacy; it is the only thing
the current form writes.

The live consequence is the one the brief primed: **7 polling triggers, 0 with a `url`, so
`validate_url_safety` has never run on this path in production.** The guard is correct and has never
had a candidate.

**`config.event_id` (`:72`)** — the "Credential event" dropdown at `PollingConfig.tsx:22-38`, offered
whenever `credentialEventsList` is non-empty and **suppressing the URL field entirely** when chosen
(`:39`). No Rust reads `$.event_id` on a trigger config. (A mechanical scan flagged
`commands/tools/triggers.rs:1823` as a reader; opening it shows an `event_id` parsed out of a
**webhook replay HTTP response body** — an unrelated identifier. Hand-verification, §12.5.)

**A third orphan comes from the detail drawer.** `TriggerListItem.tsx:43-49` writes
`raw.rate_limit = {max_per_window, window_seconds, cooldown_seconds, max_concurrent}` into the config
and persists it. **No Rust reads `$.rate_limit`.** The engine's only ceiling is a global
per-persona-hour setting (`background.rs:2411 schedule_executions_per_persona_hour`). The client-side
enforcer that *would* read those four numbers, `recordTriggerFiring`
(`stores/slices/pipeline/triggerSlice.ts:198`), has **zero call sites** — so the Speed Limits
dashboard (`RateLimitDashboard.tsx:25`, reading `triggerRateLimits`) renders an empty state
permanently, and a "Throttled" badge exists that nothing can raise.

And on the live rows, the same shape from the other direction. Of **16 distinct `(trigger_type, key)`
pairs** across all 351 configs, **6 are never read for that type** — **50 of 687 key-instances
(7.3%)**:

| n | type | key | verdict |
| ---: | --- | --- | --- |
| 23 | `schedule` | `cadence` | **no reader — and no writer either.** `"daily"`/`"weekly"` on 23 of 32 schedules; nothing in 5,792 files reads or writes it. It is sediment from a deleted path. |
| 7 | `polling` | `cron` | `TriggerConfig::Polling` has no `cron` field |
| 7 | `polling` | `timezone` | same |
| 6 | `event_listener` | `event_type` | the `EventListener` arm reads `listen_event_type` only |
| 6 | `manual` | `filter` | `{"decision":"accepted"}` — no reader |
| 1 | `event_listener` | `filter` | **the routing one.** `{"decision":"accepted"}` on a live listener for `dev-clone.backlog.triaged`; the bus has no payload-filter concept, so it fires on **every** such event, accepted or rejected. |

Nothing rejects an unknown key: `from_raw` is a hand-written `val.get("…")` walk over a
`serde_json::Value`, not a deserialization, and `serde(deny_unknown_fields)` appears **0 times** in
the tree. The struct's own doc comment (`core/src/models/trigger.rs:263-267`) says each variant
*"carries only the fields that trigger type needs, making invalid states unrepresentable."* At the
boundary it is a **projection**, not a parse: it silently drops what it does not name, so an invalid
state is perfectly representable in the column and merely invisible in the enum.

### 0.3 — One click in the Trigger Studio deletes an average of 1.7 listeners. Executed.

`update_subscription` and `delete_subscription` both propagate to "the paired trigger" with a `WHERE`
clause that **does not name the event type**:

```rust
// db/src/repos/communication/events.rs:1795-1802  (delete_subscription)
DELETE FROM persona_triggers
 WHERE persona_id = ?1
   AND trigger_type = 'event_listener'
   AND COALESCE(use_case_id, '') = COALESCE(?2, '')
```

`update_subscription` (`:1721-1735`) is the same predicate with
`SET config = {"listen_event_type": <this subscription's type>, …}`. So editing **one** subscription
rewrites **every** event listener the persona has under that capability to listen for **one** event.

Running the real `buildEventRows` over the live data and pushing each cable through that SQL:

| measured | value |
| --- | ---: |
| Studio rows | 134 |
| connections: `subscription` / `trigger-listener` / `chain` | **46** / 70 / 55 |
| `event_listener` triggers deleted across the 46 subscription cables | **77** |
| cables whose Disconnect deletes **more than the cable named** | **26 of 46** |
| worst single Disconnect | **5 listeners** |
| subscription **edits** that would clobber another listener's `listen_event_type` | **49 of 102**, **71 rows** |

Worked example from the live data: the capability `uc-a68da8e0-…` holds five listeners —
`dev-clone.backlog.triaged`, `dev-clone.pr.created`, `dev-clone.pr.updated`, `dev-clone.pr.merged`,
`review_decision.approved`. Disconnect any **one** cable in the Studio and all five rows are deleted.
Edit any one subscription and all five become copies of that one event type.

Two design choices make it reachable rather than theoretical. First, `buildEventRows.ts` processes
subscriptions (step 4, `:113-129`) **before** listeners (step 5, `:131-153`), and the step-4 dedupe
is persona-wide (`:120`) while step 5's is `(persona, useCaseId)`-scoped (`:143`) — so where a pair
exists, the Studio shows the **subscription** cable, which is the one routed to `deleteSubscription`
(`useRoutingState.ts:131-132`). Second, **every one of the operator's 102 subscriptions has a
paired `event_listener` trigger for the same `(persona, canonical event_type)` — 102 of 102.**

The pairing itself is correct and deliberate (`create_subscription_with_trigger`, `events.rs:1557`,
writes both in one transaction), and `prefer_capability_scoped` (`bus.rs:266-291`) dedupes the merge
on `(persona_id, use_case_id)`, so **the dual write does not double-dispatch** — a cleared claim
(§7 D12). What is wrong is only that the *repair* half of the pairing addresses rows by capability
instead of by identity.

### 0.4 — Two `enabled` flags, and the dispatcher reads neither of the ones the user touches

The brief primed this as a toggle defect. **The toggle is not the defect** (§12.3): every writer of
`persona_triggers` in the tree keeps `enabled` and `status` in sync — `create` (`triggers.rs:121-122`),
`update`'s `derived_status` (`:380-386`), `set_enabled` (`:1862`), `set_status` (`:1882`), the
use-case cascade (`use_cases.rs:100-107`), the backfill migration (`incremental.rs:2180`). The
drifted rows were written by something that is not in this tree: **26 rows at `enabled=0,
status='active'`, every one stamped `updated_at = '2026-06-10 08:13:14'`** — SQLite's
`datetime('now')` shape, which no Rust path here produces (they all use `to_rfc3339()`).

The defect is that **three consumers read three different columns**, and the one the human looks at
is the one the engine ignores:

| consumer | reads | for the 26 drifted rows |
| --- | --- | --- |
| `getTriggerArmState` (`triggerArmState.ts:88`) → the badge | `trigger.enabled` | **"disabled"** |
| `get_due` (`triggers.rs:1581-1595`) → the scheduler | `t.status = 'active'` **and** `p.enabled = 1` | **dispatchable** |
| `get_enabled_by_type` (`triggers.rs:1560-1571`) → the event bus | `status = 'active'` | **dispatchable** |
| `ParsedTrigger::is_eligible` (`bus.rs:130-148`) | *neither* — type match only | — |

Note the third row's name. A function called **`get_enabled_by_type` filters on `status`**, and the
trigger-side `is_eligible` — unlike the subscription-side one 70 lines above it, which does check
`self.enabled` (`bus.rs:65`) — never looks at `enabled` at all. So **for the 189 event-listener
triggers, `trigger.enabled` is read nowhere in the dispatch path.**

The hazard is currently inert only because of a *second* defect: all 26 drifted rows also have
`next_trigger_at IS NULL`, so `get_due` skips them anyway. **A row that reads "off" in the UI and is
"on" for the engine exists in the operator's database today**; the thing stopping it from firing is
that it is broken in a different way.

The same disagreement runs through the subscription surface, where it is **not** latent. Seven
subscriptions are `enabled = 0`. All seven have a paired `event_listener` trigger at
`status='active', enabled=1` listening for the same type, and the trigger's `is_eligible` does not
check `enabled`. **Disabling one of those subscriptions is a no-op; the persona still runs.**

### 0.5 — The event-type picker's menu is 97% dead and misses 95% of what is live

The listener form (`configs/EventListenerConfig.tsx:26-49`) is a free-text `<input>` with a
`<datalist>` fed by `EVENT_TYPE_REGISTRY` (`src/lib/eventTypeTaxonomy.ts:51`), whose file header
calls it *"the single source of truth for all known event types in the system. New event types MUST
be registered here."* Paired against the live bus through `canonical_event_type`:

| | value |
| --- | ---: |
| entries in the TS picker menu | **34** |
| …never published once in 4,972 events | **33** |
| entries in the Rust `BUILTIN_EVENT_TYPES` | 47 |
| …never published once | 39 |
| canonical names the two menus share | **11** |
| **live canonical event types in neither menu** | **165 of 174** |

`webhook_received`, `schedule_fired`, `file_changed`, `execution_completed`, `trigger_fired`,
`persona_action` — the menu is a catalogue of the *concepts* the system has, and it is nearly
disjoint from the *names* it emits. This extends
[domain-event-publication](./domain-event-publication.md) §0.1 (which measured the registry against
the **publishers** and found 3% coverage) to the **subscriber** side, and the answer is the same
defect seen from the other end: **39 live listeners wait on `trigger_fired`, which the picker
offers, the registry blesses, and nothing has ever published.**

### 0.6 — What the surface tells the user: `armed`, and one refusal

`TriggerRow.tsx:21` renders exactly one health signal, and `armed` is its default. It does not
consult `next_trigger_at`, `status`, `persona.enabled`, whether the type is storable, whether the
event is ever published, or whether the polling URL exists. **`armed` means "the user has not
switched it off."**

The repo has the right instinct and applies it once. `TriggerAddForm.tsx:181-187`:

```ts
// Schedule triggers silently never fire if neither cron nor interval is set
// (scheduler.rs::compute_next_from_config returns None). Disable Create until
// the user has supplied a non-empty value for the chosen mode.
const isScheduleInvalid = triggerType === 'schedule' && …
```

That is the whole prescription — a preflight, named after the engine function that would return
`None`, wired to the submit button — implemented for **one of ten types and one of its several
failure modes.** It is §6's exemplar.

The one durable "why is this dead" channel, `schedule_missed_runs.status_reason`, is rendered by
`ScheduleRow.tsx:159-166` on the Schedules page (a different page). It has **0 rows**.

### Sibling boundaries, settled in prose

[**scheduled-trigger-firing**](./scheduled-trigger-firing.md) owns *becoming due* and everything
after: `get_due`, the CAS, backfill, the zone evaluator. **This path owns what the human typed and
whether the engine can see it.** Its P0 (`timezone: "local"`, 16 dead rows) has been fixed at the
writer since it was published — `ChronologyAdoptionView.tsx:268-278` now carries a comment naming the
incident — and **9 schedule + 7 polling rows still carry the sentinel** because nothing repaired the
data (§7 D9). Its 37-NULL figure and my 124-cannot-fire figure are the same population seen at two
depths.

[**domain-event-publication**](./domain-event-publication.md) owns the durable row, the bus verdict
and `EventGateReason`. **This path owns the two lists the bus compares** — the picker the human
chooses from and the emit surface — and measures them against each other (§0.5). Its D3 (39
listeners on an unpublished `trigger_fired`) is confirmed here from the wiring side and extended:
**82 of 189 listeners** wait on a name the bus has never carried.

[**client-rule-mirroring**](./client-rule-mirroring.md) owns *one decision, two languages*. Its D3
(`triggerArmState.ts:72` vs `ActiveWindow::is_active_at`, 90.9% of overnight windows) is **confirmed
still latent — 0 of 351 triggers configure an `active_window`**, and this path adds the reason it
will *stay* latent: `ActiveHoursSection.tsx` is a third parse of the same block, reachable only from
an expanded row's drawer, and its `enabled` defaults to `false`. **The correction it is owed:** the
badge's real defect is not the overnight branch — it is `:88`, `if (!trigger.enabled) return
'disabled'`, which reads a column no dispatch predicate reads (§0.4).

[**schema-driven-form**](./schema-driven-form.md) owns *a form generated from a declaration*.
`buildTriggerConfig.ts` is the opposite and that is the boundary: it is a **hand-written
`if/else if` chain with no declaration at all**, so its rule (`field.type === 'literal'`) matches it
zero times. **The clause both paths need is in §6.**

[**entity-picker**](./entity-picker.md) owns *choosing an existing entity*. The listener form is a
free-text input with a `<datalist>`, so it is not a picker — and §0.5 is what that costs. Its
`missing-current-entity-rendered-as-unset` rule shares **0 sites** with mine.

The **Deviations** section is a fix backlog and contains **two P0s** (D1, D2).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count, so an adopting repo can tell physics from local calibration. Each clause names its
warrant.

> **P1 — physics, and the whole subject.** *An authoring surface is a promise, and the only thing
> that can keep it is the code that reads what it wrote.* Every widget on the form is a claim that
> the value it collects reaches a decision. Where it does not, the surface is not merely useless —
> it is a lie the user has no way to detect, because a form that saves successfully looks the same
> as one that works.
> *Warrant: measured in every repo in the cohort that has a rich automation form. Where the config
> is a small closed set of columns the two agree; where it is an assembled object, both repos with
> one have keys the runtime never reads — 7 trigger kinds offered and 1 read in one sibling, 23
> keys writable and 8 read here.*
>
> **P2 — physics. Derive the menu from the narrowest gate, not the widest.** The set of things a
> user may choose must be computed from the most restrictive layer that will see the choice —
> usually the storage constraint, not the validator and never the renderer. A menu assembled from
> the capabilities of the layer nearest the user will always be a superset of what the system can do.
> *Warrant: the one repo in the cohort where the option list, the server validator and the dispatch
> filter are the same exported constant has zero drift across all three; the two where the list is
> re-typed per layer both offer members the layer below rejects.*
>
> **P3 — physics. One fact, one column, and the dispatcher's column is the fact.** Where an
> on/off decision is stored in more than one place, the authoritative one is whichever the dispatch
> predicate reads, and the surface must read *that* one. If they can disagree, they eventually will,
> and the disagreement is invisible precisely because the surface is showing the other value.
> *Warrant: the strongest convergent result in the sweep — 2 of 3 independent siblings INVERTED on
> this, each in a different way, and in both the UI displays the column the runtime ignores. Where a
> scheduler stores a next-run timestamp beside an enabled boolean, the timestamp quietly becomes the
> real switch.*
>
> **P4 — physics. Address a row by its identity, never by its category.** A repair, cascade or
> propagation whose `WHERE` clause names the group rather than the row will one day run against a
> group with more than one member, and the extra members are silently rewritten or deleted.
> *Warrant: every repo in the cohort that reaps or cascades does so by identity or by an explicitly
> scoped pair; the one place here that addresses by capability destroys 77 rows across 46 one-click
> paths.*
>
> **P5 — physics. Refuse at the door, in the form, before the write.** A configuration that cannot
> work should be unsubmittable, not merely un-fireable. The distance between "the user pressed Save"
> and "the user finds out" is the whole cost of this situation, and the check is nearly always
> cheap — the condition is already written down somewhere in the engine.
> *Warrant: the two siblings that surface a "this will never run" state both built it after shipping
> the backend headless, and both put it at submit time against the real precondition; the repos
> without it have no way for a user to distinguish a working automation from a dead one.*
>
> **P6 — ergonomics, and it is the cheap half of P5.** *An unrecognised key must be refused, not
> dropped.* A reader that ignores what it does not understand converts every typo, every rename and
> every removed feature into silence. Storage that accepts anything needs a parser that accepts only
> what it names.
> *Warrant: the two repos in the cohort whose automation config is a real column set cannot express
> this failure at all; both repos whose config is an assembled blob read it with a hand-written
> get-by-name walk and silently drop the rest. It is a property of the storage shape, not of
> discipline.*
>
> **P7 — ergonomics. A suggestion list must be derived from what has happened, not from what was
> once imagined.** An autocomplete over a vocabulary nobody validates against reality decays into a
> museum, and it decays invisibly because every entry still *looks* like a valid choice.
> *Warrant: local, one measurement, stated because it is unambiguous — 33 of 34 menu entries never
> emitted once in 4,972 events, and 165 of 174 real names absent from the menu. No sibling has a
> comparable list to compare against, so this is flagged as a house observation, not doctrine.*
>
> **Scale condition.** P1, P2, P4 are correctness on day one. P3 bites the first time two writers
> disagree. P5 and P7 bite continuously but silently — they cost user trust rather than data. P6
> bites the first time a field is renamed.

---

## 1 Trigger

- "Add a trigger to this persona." / "Make this agent run when X happens."
- "I wired it up and nothing happened." / "It says armed but it never runs."
- "Why is there a File Watcher option if it doesn't work?"
- "I turned this off — why did it still fire?" / "I disabled the subscription and the agent ran."
- "I disconnected one cable in the Studio and my other automations vanished."
- "What can I put in this event-type box?"
- "I'm adding a new field to the trigger config."

**If you are about to type** `buildTriggerConfig`, `config.<newKey> =`, a new arm in
`TRIGGER_TYPE_OPTIONS`, `trigger_type: '…'` in a create payload, `createTrigger(`,
`linkPersonaToEvent`, `EVENT_TYPE_REGISTRY`, `getTriggerArmState`, or a `WHERE persona_id = ? AND
trigger_type = 'event_listener'` — **you are in this situation.**

**Not this path:** *evaluating cron and publishing the fire* is
[scheduled-trigger-firing](./scheduled-trigger-firing.md); *the durable event row and who it wakes*
is [domain-event-publication](./domain-event-publication.md); *rendering a form from a declaration*
is [schema-driven-form](./schema-driven-form.md); *the badge's colours and tone tokens* are
[status-and-severity-badges](./status-and-severity-badges.md).

## 2 The one way

**Derive the menu from the narrowest gate, write only keys the engine names, refuse at the door what
the engine cannot run, and address every repair by row id.** Concretely: **(a)** before adding a
choice to any wiring surface, find the **narrowest** layer that will see it — for a trigger that is
the `CHECK` on `persona_triggers.trigger_type` (`db/src/migrations/schema.rs:87`), not
`VALID_TRIGGER_TYPES` and not `from_raw`'s arms — and either widen that layer in the same commit or
do not offer the choice. **(b)** Write config keys that `TriggerConfig::from_raw`
(`core/src/models/trigger.rs:578`) **names for that exact `trigger_type`**; the arm is the contract,
and a key outside it is discarded without a word. When in doubt, open the arm — `polling` reads
`url`, not `endpoint`. **(c)** Refuse before you write: copy `TriggerAddForm.tsx:181-187`, which
disables Create for a schedule with neither cron nor interval **and names the engine function that
would otherwise return `None`**. Every unrunnable configuration you can name deserves that treatment,
and the condition is already written in the engine. **(d)** Read the column the dispatcher reads:
`get_due` and `get_enabled_by_type` both test `status`, so a badge, filter or count that tests
`enabled` is answering a different question — and if two columns encode one fact, collapse them
rather than mirroring them. **(e)** Address by identity: a cascade, repair or propagation over
`persona_triggers` takes an `id`, never `(persona_id, use_case_id)`; the pairing already records the
identity it needs (`_auto_for_trigger`, `triggers.rs:1049`) and the delete path already uses it
(`delete_auto_listeners_for`, called at `commands/tools/triggers.rs:240`). **(f)** Offer event names
derived from what the bus has actually carried, not from a hand-maintained list — and if you keep a
list, register the name in `BUILTIN_EVENT_TYPES` (`engine/src/event_vocabulary.rs:59`) **and**
`EVENT_TYPE_REGISTRY` (`src/lib/eventTypeTaxonomy.ts:51`) in the commit that first publishes it.
**(g) Then stop.** Do not add a seventh trigger-type list; do not add a config key without opening
the arm that would read it; do not write a second `enabled`-like column; and do not ship a control
whose only consumer is a function nobody calls.

If you must get one right first: **(b)**. (a) and (c) fail loudly the moment someone tries the
feature; (b) fails silently forever, and every one of §0.2's orphans is a (b) failure that shipped
under a green `npm run check`.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src-tauri/db/src/repos/resources/triggers.rs:97` `create(pool, CreateTriggerInput)` | **the door.** Normalizes the type, validates, detects chain cycles, encrypts, computes `next_trigger_at` from the parsed config, INSERTs `enabled` **and** `status` from one boolean (`:121-122`), auto-pairs an `event_listener` in the same transaction, and records an invalid-zone issue after commit. Every other write path is a downgrade |
| `src-tauri/core/src/models/trigger.rs:578` `TriggerConfig::from_raw` | **the contract.** The arm for your `trigger_type` is the complete list of keys the engine will read. **Open it before you name a key.** It is a projection, not a parse — what it does not name, it drops |
| `src-tauri/core/src/validation/trigger.rs:71` `validate_config` + `:210` `validate_schedule_has_cron_or_interval` + `:254` `validate_polling_url` | the three door-side validators. The third is the SSRF guard and it accepts `endpoint` as well as `url` — which is exactly why the mismatch survived |
| `src/features/triggers/sub_triggers/TriggerAddForm.tsx:181-187` `isScheduleInvalid` | **the one site to copy.** A submit-time preflight, named after the engine function whose `None` it prevents, wired to the button's `disabled`. Three lines |
| `src/features/triggers/sub_triggers/configs/buildTriggerConfig.ts:42` `buildTriggerConfig(state, t) -> BuildResult` | the single write path for the Add-trigger form, and the right shape: a **discriminated result** (`{ok:true, config} \| {ok:false, error}`) so a refusal is a value, not a thrown string. Keep the shape; fix the keys |
| `src-tauri/db/src/repos/resources/triggers.rs:1049` `_auto_for_trigger` + `:1090` `delete_auto_listeners_for` | **the identity-addressed pairing.** The advisory key records exactly which source a listener belongs to, and the delete path uses it. This is the primitive `delete_subscription` should have used |
| `src-tauri/engine/src/team_handoff.rs:57` `handoff_event_type` + `:63` `wire_team_handoff` | mint the name once, write it into the emitter and the receiver in the same pass. [domain-event-publication](./domain-event-publication.md) measured its service record: **94% of names minted this way have a live consumer, against 13% for everything else** |
| `src-tauri/engine/src/bus.rs:76` `canonical_event_type` | the comparison. Use it any time you compare two event names — including when you check whether a name a user typed has ever been seen |
| `src-tauri/db/src/repos/resources/triggers.rs:1856` `set_enabled` / `:1876` `set_status` | the two writers that keep `enabled` and `status` in step. Never write one of those columns with raw SQL |
| `src-tauri/db/src/repos/resources/triggers.rs:2005` `set_schedule_status_reason` | the durable "why is this dead" channel the UI already renders (`ScheduleRow.tsx:159`). **0 rows.** Write to it |

**Do NOT build:** a seventh trigger-type list; a second `enabled`-like column; a client-side rate
limiter (there is one and nothing calls it); a payload-`filter` concept the bus does not have; a
parallel subscription table (there are already two mechanisms and 102 of 102 rows use both); a
"Test" path that accepts a key the runtime does not.

## 4 Steps

1. **Find the narrowest gate first.** For a trigger type that is the `CHECK` at
   `db/src/migrations/schema.rs:87`. For a config key it is the `from_raw` arm. For an event name it
   is what has actually been published. Write the number down; it is the size of your menu.
2. **If the narrowest gate is narrower than the feature you are shipping, widen it in the same
   commit** — a migration for the `CHECK`, a field on the arm — or do not put the control on screen.
   A disabled control with a reason beats an enabled one that fails.
3. **Name your config keys from the arm, not from the form's variable names.** `endpoint` vs `url`
   is one identifier and it cost the polling feature entirely.
4. **Add the submit-time refusal.** Copy `isScheduleInvalid`: the condition, the `disabled`, and a
   comment naming the engine function that would otherwise fail silently.
5. **Route the write through `triggers::create`.** If you cannot, you owe `enabled` **and** `status`
   from the same boolean, `next_trigger_at` computed from the parsed config, and a
   `schedule_missed_runs.status_reason` when it comes out `None`.
6. **Read `status` wherever you display armed-ness**, and reconcile against the same predicate the
   dispatcher uses. If your badge cannot answer "will this fire", give it a fourth state rather than
   collapsing into `armed`.
7. **Make every repair address a row.** If your `WHERE` names a category, count how many rows are in
   the largest category on real data before you ship it. Here that number was 5.
8. **Register the event name in both registries in the commit that first publishes it**, and then
   **stop** — the bus, `prefer_capability_scoped` and the gate ledger own everything downstream.

### Can the type make the wrong call impossible? — asked before §9

**Split answer, and the split is the finding. Yes for the trigger type. No for the config keys, and
the doctrine's fifth "where types cannot reach" is exactly why.**

**T1 — make `trigger_type` a `#[derive(TS)]` enum whose variants are the six the column admits.**

Today it is `String` on `PersonaTrigger` (`core/src/models/trigger.rs:441`), `String` on
`CreateTriggerInput` (`:498`), `TEXT` in the column, and a hand-written list in 37 places. Held
against the corpus's seven qualifications:

- **Q1 — a required prop carries only what it encodes.** A `TriggerKind` enum encodes *"one of the
  six the store accepts"* and nothing more. It would make §0.1 impossible — 4 unstorable options, 6
  dead quick templates, 3 NL-parser branches and 2 alias maps all stop compiling — and it would
  touch **none** of §0.2, because the config is a `String` of JSON on the other side of the enum.
- **Q2 — requiredness is orthogonal to closedness.** `trigger_type` is already required and always
  has been. **Closedness is the entire win.**
- **Q3 — a type nobody constructs constrains nothing.** Counted: **37 non-test hand-written
  vocabulary copies across 26 files**, plus 351 live rows and every create path. It is on the hot
  path in both languages. ts-rs already emits **89** string-literal unions in this repo, so the
  mechanism exists and is proven; this vocabulary simply never used it.
- **Q4 — a type anyone can construct authenticates nothing.** True and irrelevant here: `TriggerKind`
  is not asked to authenticate, only to be **inhabited by exactly the storable six**. There is no
  `TriggerKind::FileWatcher` to reach for.
- **Q5 — withholding beats requiring.** This adds nothing. It removes a freedom: the freedom to name
  a type the table will reject.
- **Q6 — withhold the dangerous freedom, not the answer.** Every legitimate authoring intent stays
  expressible. What is withheld is only the ability to offer a type that cannot be stored.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.**
  Applies to the *sibling* proposal and is why it fails: see T2.

**And does it reach the code?** Yes — `trigger_type` crosses as a struct field on
`CreateTriggerInput`, through `create_trigger`'s signature, into `validate_trigger_type` and
`from_raw`, all of which `rustc` checks; on the client it would arrive as a generated union that
`TRIGGER_TYPE_OPTIONS` could be typed `Record<TriggerKind, …>` against, making the menu **total**.
**The commit that adds the enum should widen the `CHECK` to whatever the enum names**, so the two
are decided in one place; leaving them to be reconciled later is how six vocabularies happened.

**T2 — the config keys cannot be typed, and this is the doctrine's fifth unreachable place in its
purest form.** `config` is `Option<String>` — encrypted JSON in a `TEXT` column. The client assembles
a `Record<string, unknown>` and `JSON.stringify`s it (`triggerSlice.ts:149`); Rust `JSON.parse`s it
and walks it by name. **No type spans that**: a newtype on the Rust side is downstream of where the
value entered, and a TypeScript interface on the client is upstream of a `stringify` that erases it.
Making `TriggerConfig` `Deserialize` with `deny_unknown_fields` would make an unknown key an *error*
rather than a type error — better (P6), and still not a type. And per **Q7**, widening or narrowing
`Record<string, unknown>` is inert: nothing *forces* `buildTriggerConfig` to write `endpoint`; its
author volunteered it. The thing to withhold is the **construction** — `buildTriggerConfig` should
not be handed an untyped bag to fill.

**So: ship the enum for the type, and treat the keys as a parse problem (§9's second instrument), not
a type problem.**

## 5 Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| **Offering an option the storage layer rejects** | The control renders, the panel collects config, Create fails with a generic error, and the user cannot tell a broken feature from their own mistake. **Measured: 4 of 10 types, 6 of 6 quick templates, 3 NL-parser branches.** |
| **Naming a config key from the form's variable instead of the reader's field** | The value is stored, displayed, validated and tested — and never read. **Measured: `endpoint` vs `url`, and the SSRF guard on that path has never executed once.** |
| **A reader that drops unknown keys** | Every rename, typo and removed feature becomes silence. **Measured: 6 of 16 live `(type,key)` pairs unread, including a `filter: {decision:"accepted"}` on a live listener that therefore fires on rejections too.** `deny_unknown_fields` appears 0 times in the tree. |
| **A badge whose word is stronger than its evidence** | `armed` is asserted for 325 rows and true for at most 227. A three-state badge that can only see one of the six preconditions is worse than a two-state one, because the third state implies the others were checked. |
| **Two columns for one fact, with the surface reading the one the dispatcher ignores** | The user's mental model and the engine's diverge with no error anywhere. **Convergent: 2 of 3 independent siblings INVERTED on exactly this.** |
| **A cascade addressed by category** | Runs correctly for months on capabilities with one member, then destroys four siblings on the first capability with five. **Measured: 77 listener deletions across 46 one-click Studio paths; worst case 5.** |
| **A control whose enforcement function has no callers** | Renders, persists, badges "Active" and does nothing. **Measured: `rate_limit`'s four fields written by the drawer, `recordTriggerFiring` called 0 times, `RateLimitDashboard` permanently empty.** |
| **An autocomplete over an aspirational vocabulary** | The picker teaches the user names the bus does not carry, and hides the ones it does. **Measured: 33 of 34 offered names never emitted; 165 of 174 emitted names not offered.** |
| **Validating in a place the runtime does not read** | The Test tab and the SSRF guard both accept `endpoint`; the poller does not. Every instrument that could have caught the defect had been taught the wrong spelling. |
| **`default: return { type: 'manual' }`** | `parseTriggerConfig` (`triggerConstants.ts:553`) turns any unrecognised type into a manual trigger for display, so a row the client cannot model renders as the one type that needs no configuration and looks fine. |

## 6 Evidence

**The one site to copy: `src/features/triggers/sub_triggers/TriggerAddForm.tsx:181-187`.**

```ts
// Schedule triggers silently never fire if neither cron nor interval is set
// (scheduler.rs::compute_next_from_config returns None). Disable Create until
// the user has supplied a non-empty value for the chosen mode.
const isScheduleInvalid =
  triggerType === 'schedule' &&
  ((scheduleMode === 'cron' && !cronExpression.trim()) ||
    (scheduleMode === 'interval' && !interval.trim()));
```

Four things to copy: (1) the check is **at the door**, not in the list afterwards; (2) it is wired to
`disabled` on the submit button (`:249`), so the bad state is unreachable rather than reported;
(3) the comment **names the engine function** whose `None` it prevents, so a reader can verify the
claim; (4) it is three lines. Its limitation is the deviation backlog: it covers one of ten types and
one of that type's several ways to be born dead.

**Supporting exemplars, each for one property:**

| site | the property to copy |
| --- | --- |
| `configs/buildTriggerConfig.ts:38-40` | **a refusal as a value.** `BuildResult = {ok:true, config} \| {ok:false, error}` — the caller cannot use the config without handling the failure. The right shape, wrong keys |
| `db/src/repos/resources/triggers.rs:97-180` | the create door: normalize → validate → cycle-check → parse once → compute → INSERT `enabled` **and** `status` from one boolean → pair the listener in the same transaction → explain after commit |
| `db/src/repos/resources/triggers.rs:1014-1049` + `:1090` | **identity-addressed pairing.** `_auto_for_trigger` records the source row's id, and `delete_auto_listeners_for` deletes by it. This is the shape `delete_subscription` needs |
| `engine/src/team_handoff.rs:57-181` | mint the name once and create both sides from it; 94% consumer rate against 13% |
| `db/src/repos/communication/events.rs:1557-1640` | `create_subscription_with_trigger` — one transaction, both mechanisms, `INSERT OR IGNORE` for idempotence. The *creation* half of the dual write is right |
| `engine/src/bus.rs:57-92` | a tolerant comparison whose doc comment states what it merges **and what it must not** |
| `commands/tools/triggers.rs:398-470` | the Test tab: per-check `{label, passed, message}` rows, an SSRF-safe DNS resolver, HEAD-not-GET with the reason written down. **Excellent, and pointed at the wrong key** |
| `TimezoneSelect.tsx:69` | the empty case spelled as absence (`value=""`), not as a word. The template-adoption path invented `"local"` instead and cost 16 schedules |

### Convergence — 5 checkouts opened, effective independent cohort **3**

Swept read-only against `../personas-web` (1,056 files), `../brainiac` (605), `../personas-cloud`
(48 + dist), `../vibeman` (2,047), `../ascent` (923). **All five exist and all five were opened.**

**Two are excluded, and they are excluded together as ONE observation, not two.**
`personas-cloud` self-declares as a port at four separate sites —
`packages/orchestrator/src/triggerScheduler.ts:87` *"Ported from desktop
engine/background.rs::trigger_scheduler_tick()"*, `eventProcessor.ts:30` *"Ported from desktop
engine/background.rs::event_bus_tick()"*, `packages/shared/src/bus.ts:5,53` *"Ported from
engine/bus.rs"*, `types.ts:2` *"mirroring desktop Tauri models"* — and `personas-web` is its
**client**, re-declaring this repo's row shape (`src/lib/types.ts:75-86`) and reading the synced
tables. A port plus its consumer agreeing with the original is one data point wearing three coats.
**Cohort 5 → 3** (`brainiac`, `vibeman`, `ascent`).

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **A UI surface exists where a human arms an automation** | **PHYSICS 3/3** | `brainiac` `console/src/ops/SweepControl.tsx:74-192` (toggle + cadence + run-now + next-run readout). `vibeman` `LifecycleConfigPanel.tsx:132-491` (the richest form in the cohort: 7 trigger kinds, gates, thresholds) and `ScanInitiator.tsx:126-164`. `ascent` `ScheduleSelect.tsx:17-82`, `RepoRow.tsx:66-80`, plus an alert-webhook composer at `AlertsControl.tsx` — **transfer, not ignorance: ascent answers clauses 4 and 5 better in the alert component than in the scheduler.** |
| 2 | **The config the form writes is a closed/typed shape, not an assembled blob** | **PHYSICS 2/3, and the blob has NO independent corroboration** | `brainiac`: two scalars in real columns (`migrations/0018_sweep_schedules.sql:15-25`, `enabled boolean` + `cadence_secs bigint`) with a serde struct (`sweeps.rs:83-88`) — no blob to drift. `ascent`: `scanSchedule` is a closed 4-value string single-sourced from `installationRepoTypes.ts SCHEDULES`. `vibeman` is INVERTED in an instructive way — the **table** is more typed than the app (`lifecycle_configs`, 24 columns, `lifecycle_cycles` even carries `CHECK (trigger IN (…))`) and **nothing writes it**; the form goes to `lifecycleOrchestrator.ts:50 private config: LifecycleConfig \| null` on an in-memory singleton. **The only free-form `config TEXT` blob in the sweep is in the excluded Personas lineage.** |
| 3 | **Something reconciles the keys the form writes against the keys the runtime reads** | **1 of 3 — Personas is on the majority side of a bad majority** | `ascent` PHYSICS: `SCHEDULES` is the option list, the server validator (`api/org/schedule/route.ts:9,14`) and, transitively, the dispatch filter (`org-watch.ts:168 scanSchedule: { not: "off" }`). `brainiac` MINORITY: an OpenAPI-generated client type in one direction, behavioural round-trip tests (`tests/console_pg.rs:664-712`), and **no `deny_unknown_fields`** on `UpdateSweepBody`. `vibeman` NO TRACE, and it is this leaf's condition at full strength: of **7 trigger kinds the form offers**, `lifecycleOrchestrator.ts:447` reads exactly **one** — `this.config.triggers.includes('scheduled')`. `git_push`, `git_commit`, `scan_complete`, `idea_implemented`, `code_change` are checkboxes that reach no reader, and the form says nothing. |
| 4 | **The surface tells the user the automation will never fire** | **2 of 3, and both built it AFTER shipping the backend headless** | `ascent` PHYSICS, submit-time, both surfaces: `ScheduleSelect.tsx:47-54` surfaces the server's rejection inline and rolls the optimistic value back; `api/org/alerts/route.ts:66-88` **test-sends to the candidate URL the admin is still typing**, with a comment (`:60-63`) that testing the *stored* sink instead *"would falsely report a typo'd new URL as delivered ✓"* — the exact defect §0.2 documents here, anticipated and refused. And `org-watch.ts:98-105` reads the affected names **before** the update so the client can un-paint rows the server never saved, against *"'schedule success theater' where a row shows a cadence the server never saved."* `brainiac` PHYSICS but list-time: a real next-run readout, a status dot, `"never run"`, and a run-now dry run. `vibeman` NO TRACE: no validation, no preview, no test, and the whole config evaporates on restart with no indication. **The pattern is: engine first, wiring UI second, "will it fire?" third or never** — both repos that have it say so in their own file headers. |
| 5 | **A target that no longer exists is reaped or badged** | **1 of 3, and the repo with NO foreign keys is the one that does it** | `ascent` PHYSICS: `relationMode = "prisma"` means zero FK constraints in the database, so it compensates in code at the orphaning event — `installations.ts:59-66`, on GitHub App uninstall, sets `{ watched: false, scanSchedule: "off", nextScanAt: null }` with a comment naming the dispatch function it is protecting. `vibeman` MINORITY: FKs enforced and *verified* (`sqlite.driver.ts:114-117` warns if `PRAGMA foreign_keys` did not take — the most careful FK handling in the cohort) protecting a table nothing writes. `brainiac` NO TRACE **by design** — a sweep names no external target. **Personas has the FK and the cascade and no badge**; measured, it currently has **0 dangling references of any kind** (0 orphan personas, 0 missing chain sources, 0 orphan auto-listeners, 0 unresolvable `source_filter`s of 93). |
| 6 | **One toggle, and the dispatcher reads the column the UI writes** | **INVERTED — 2 of 3 independents, and this is the strongest result in the sweep** | `brainiac`: the module doc says the scheduler claims on *"(`enabled` + `next_run_at <= now()`)"* (`sweeps.rs:7-8`); the SQL's `WHERE` (`:240-253`) tests `next_run_at` and **never `enabled`** — `enabled` appears only in the `CASE` computing the *next* slot. And `sweep_update` (`:173-181`) arms `next_run_at` on enable and **leaves it untouched on disable**. So a sweep switched off still fires once, the button reads *"schedule off"*, and the next-run hint is hidden precisely because `enabled` is false. Its test suite (`console_pg.rs:664-712`) covers enable→armed and **never disable→disarmed**. `vibeman`: three enabled-ish flags (`config.enabled` in memory, `_isRunning` from separate start/stop actions, `lifecycle_configs.enabled` permanently 0 in the DB), one read, none persisted. `ascent` MINORITY: `watched` and `scanSchedule` jointly gate dispatch and are written by two different controls; it closes the gap in the **UI** — the schedule select is `disabled` while the watch write is in flight, *"which would orphan the cadence"* (`RepoRow.tsx:26-28`), plus a defense-in-depth guard at `useInstallationRepos.ts:238-240`. |

**The clause-6 result is the one to carry away, and it is the doctrine's "converged on the disease"
shape with a twist.** Two of three independent repos put the operator's on/off switch on a column
the dispatcher does not consult, and in both the UI displays the wrong one. That is not a solved
problem the fleet agreed on; it is a **failure mode that recurs independently**, which makes it
physics about the *hazard* rather than about any answer. The generalisation, stated by the evidence:
**where a scheduler stores a next-run timestamp beside an enabled boolean, the timestamp quietly
becomes the real switch.** Personas is the third instance — `get_due` reads `status` **and**
`next_trigger_at`, the badge reads `enabled`, and 26 live rows disagree.

**The most valuable sibling results are two written refutations of this repo's current design.**
`ascent`'s `api/org/alerts/route.ts:60-63` refuses to test the stored value instead of the typed one
because that *"would falsely report a typo'd new URL as delivered ✓"* — which is precisely what the
Test tab does here for `endpoint`. And `org-watch.ts:98-105` names *"schedule success theater"* as a
thing to engineer against; §0's 325-armed-104-fireable is that theater at scale.

**`vibeman` supplies the empirical cost, as siblings usually do,** and it is this leaf's condition in
its purest form: **7 trigger kinds offered, 1 read.** It is worth noting that `vibeman` is not
careless — it has the closed union, the `CHECK` constraint, the FK pragma verification, and a
correctly-persisted sibling surface (`file_watch_config`, re-read at boot). It shipped a form whose
options reach no reader anyway. **A closed vocabulary makes the value safe; it does not make anyone
read it.**

### The composition defect with a neighbouring path — offered upward

**With [schema-driven-form](./schema-driven-form.md).** Its §2 prescribes deriving the control from
the declaration and its §9 ratchets `field.type === 'literal'` chains. Followed literally on this
leaf you would replace `buildTriggerConfig`'s `if/else if` with a declaration-driven builder — and
**that is the right move for the widgets and the wrong move for the keys**, because the thing that
must not drift here is not the control-kind vocabulary but the **key names the Rust arm reads**, and
a declaration on the client is one more place to spell `endpoint` wrong. **The clause both paths
need:** *derive the control from a declaration; derive the key from the reader.* A schema-driven form
whose field `name`s are authored on the client has replaced a visible `if/else if` with an invisible
one.

## 7 Deviations

Every entry is live on `master` @ `6c97502d3`, verified against a read-only copy of the operator's
database. All shipped under a green `npm run check` and a green census. **Nothing was applied.**

### D1 (P0) — Four of ten offered trigger types cannot be stored, and the failure is anonymous · executed

Full replay in §0.1. `TRIGGER_TYPE_OPTIONS` (`src/lib/utils/platform/triggerConstants.ts:102-113`)
offers `file_watcher`, `clipboard`, `app_focus`, `composite`; `TriggerAddForm.tsx:233-236` renders a
config panel for each; `db/src/migrations/schema.rs:87`'s `CHECK` rejects all four on every install.
**All 6 `TRIGGER_TEMPLATES` (`triggerConstants.ts:381-450`) target an unstorable type.**

**Fix, in order of preference:** (a) **widen the `CHECK`** with a `12-step` table rebuild to the ten
`VALID_TRIGGER_TYPES` — the engine already has full `from_raw` arms, a `polling`-style loop for
`clipboard`/`app_focus` in `engine/src/ambient_context.rs`, and validation for `composite`'s window,
so this is the smallest change that makes the menu true; or (b) filter `TRIGGER_TYPE_OPTIONS`,
`TRIGGER_CATEGORIES`, `TRIGGER_TEMPLATES`, `FORM_COMMITTABLE_SOURCE_TYPES`, `nlTriggerParser` and
both alias maps down to six. **Either way, add a rule to `errorRegistry.ts` matching
`CHECK constraint failed: trigger_type`** so the interim failure says what happened. *Noted, not
applied: (a) is a migration and (b) removes controls the operator can see.*

### D2 (P0) — Disconnecting one cable in Trigger Studio deletes every listener in the capability · executed, 46 cables → 77 deletions

Full replay in §0.3. `db/src/repos/communication/events.rs:1795-1802` (`delete_subscription`) and
`:1721-1735` (`update_subscription`) address `persona_triggers` by
`(persona_id, trigger_type='event_listener', use_case_id)`. Reached from the UI at
`useRoutingState.ts:131-132`.

**Fix:** address by identity. `create_subscription_with_trigger` (`events.rs:1557`) already knows the
`trigger_id` it minted; persist it (a `trigger_id` column on `persona_event_subscriptions`, or the
existing `_auto_for_trigger` advisory key written the other way round) and make both statements
`WHERE id = ?`. The pattern is already in the tree at `triggers.rs:1090`
(`delete_auto_listeners_for`). Until then, the minimal containment is adding
`AND json_extract(config,'$.listen_event_type') = ?` to both `WHERE` clauses, which is a one-line
change to each and takes the blast radius from 5 to 1 on the live data. *Noted, not applied: it
changes a delete path the operator uses.*

### D3 — The polling form writes a key the poller does not read · executed, 7 of 7 live rows

`configs/buildTriggerConfig.ts:75` writes `config.endpoint`; `src/engine/polling.rs:243-259` reads
`url` and logs `"Polling trigger missing 'url' in config"`. The SSRF guard
(`core/src/validation/trigger.rs:262`), the Test tab (`commands/tools/triggers.rs:418-421`) and the
row summary (`TriggerStatusSummary.tsx:24-26`) all accept `endpoint`, so every instrument that could
have caught it had been taught the wrong spelling.

**Fix: one word** — `config.url = s.endpoint` at `buildTriggerConfig.ts:75`, and keep the
`.or(endpoint)` fallbacks so the 0 legacy rows that might exist elsewhere still validate. *Noted, not
applied: it changes what a live form writes.*

### D4 — `config.event_id` has no reader anywhere · measured

`buildTriggerConfig.ts:71-73` writes `config.event_id` when the user picks a Credential Event, and
`PollingConfig.tsx:39` **hides the URL field entirely** in that case — so choosing it produces a
polling trigger with neither `url` nor `endpoint`. No Rust reads `$.event_id` on a trigger config.
**Fix:** either wire it (resolve the credential event to a URL at create time) or remove the
dropdown. The dropdown only renders when `credentialEventsList` is non-empty, which is why no live
row carries the key.

### D5 — The rate-limit drawer persists four numbers nothing reads, and badges them "Active" · measured

`TriggerListItem.tsx:43-49` writes `config.rate_limit`. No Rust reader.
`RateLimitControls.tsx:38-41` renders an **Active** badge whenever any of the four is non-zero. The
client-side enforcer `recordTriggerFiring` (`triggerSlice.ts:198`) and its partner
`recordTriggerComplete` (`:258`) have **zero call sites** in 4,829 files, so
`triggerRateLimits` is never written and `RateLimitDashboard.tsx:25` renders empty forever.
**Fix:** the honest minimum is to read `$.rate_limit` in `background.rs`'s existing hourly-cap gate
(`:2722`) as a per-trigger override of `schedule_executions_per_persona_hour`. Failing that, remove
the drawer. *Noted, not applied.*

### D6 — `getTriggerArmState` reads the one column no dispatch predicate reads · executed, 26 rows

`triggerArmState.ts:88` — `if (!trigger.enabled) return 'disabled'`. `get_due`
(`triggers.rs:1583-1595`) and `get_enabled_by_type` (`:1569-1573`) both test `status`;
`ParsedTrigger::is_eligible` (`bus.rs:130-148`) tests neither. 26 live rows are `enabled=0,
status='active'`.

**Fix:** read `status` in the badge, and add the two states the badge cannot currently express —
`unschedulable` (a `schedule`/`polling` row with `next_trigger_at IS NULL`) and `unheard` (an
`event_listener` whose type has no emitter). Longer-term, collapse the two columns:
`TriggerStatus::from_enabled` (`core/src/lifecycle.rs`) already exists as the bridge, and `enabled`
is now pure duplication.

### D7 — The event-type picker is nearly disjoint from the bus, in both directions · executed

Full measurement in §0.5. `src/lib/eventTypeTaxonomy.ts:51` `EVENT_TYPE_REGISTRY` — 34 entries, 33
never published; 165 of 174 live canonical types absent from it; 11 canonical names shared with the
Rust `BUILTIN_EVENT_TYPES` (47). Its own header claims to be *"the single source of truth for all
known event types in the system."*

**Fix:** the datalist should be **the union of the registry and what the bus has actually carried**
(`get_event_skipped_stats`'s sibling query already groups `persona_events` by type), with a marker on
names that have never been seen. That is a read-only addition to an existing command and it makes
§0.5 visible to the person choosing.

### D8 — Six vocabularies for one closed set, none of them imported · measured, 37 sites / 26 files

Full table in §0.1. The narrowest (`CHECK`, 6) and the widest (`VALID_TRIGGER_TYPES` / `from_raw` /
`TRIGGER_TYPE_OPTIONS`, 10) differ by 4; `design.rs:339`'s 4-value list flags `event_listener` — 189
of 351 live rows — as *"Unknown trigger type"*. **Fix:** the enum in *Prefer a type over a gate*;
until then §9's rule is the ratchet. `design.rs:339` and `n8n_transform/confirmation.rs:154` can be
pointed at `VALID_TRIGGER_TYPES` today, which is a two-line change each and is the only part of D8
that is safe to apply without a migration.

### D9 — The `"local"` sentinel is fixed at the writer and unfixed in the data · executed, 16 rows

[scheduled-trigger-firing](./scheduled-trigger-firing.md) §7 P0 identified
`ChronologyAdoptionView.tsx` emitting `timezone: "local"`. The writer is fixed — `:268-278` now
carries a comment naming the incident and the four branches omit the key. **The data was never
repaired: 9 `schedule` and 7 `polling` rows still carry `"local"`, and all 16 still have
`next_trigger_at IS NULL`.** This is the wiring-side half of that path's P6 (a detector that only
runs at create/update time): **there is no surface anywhere in the app from which the operator can
see, let alone fix, these 16 rows** — the Triggers page badges them `armed` or `disabled`, and
`schedule_missed_runs` (which `ScheduleRow.tsx:159` would render) has 0 rows.

### D10 — Template adoption creates event listeners with the wrong key · latent

`ChronologyAdoptionView.tsx:324-328` emits `{ trigger_type: "event_listener", config: { event_type } }`.
`TriggerConfig::EventListener` (`core/src/models/trigger.rs:639-648`) reads **`listen_event_type`**
and `source_filter` only; `ParsedTrigger::is_eligible` (`bus.rs:142-145`) returns `false` when
`listen_event_type` is `None`. A listener minted this way can never match.

**Latent, not live:** all 189 live listeners carry `listen_event_type` (0 with an empty one), because
`build_sessions.rs:2185-2196` patches the config on the way in and the 2026-05 migration
(`incremental.rs:1107-1132`) back-filled the rest — the **6 rows carrying both keys are the scar**.
The writer is still wrong, and the next path that does not go through that patcher inherits it.
**Fix: rename the key at `:326`.**

### D11 — `parseTriggerConfig` renders an unknown type as `manual` · measured

`triggerConstants.ts:553` — `default: return { type: 'manual', event_type: … }`. Any `trigger_type`
the client does not model displays as a manual trigger: no config summary, no schedule, no warning.
Combined with D1 this is the only way an unstorable type could ever be *shown*, and it would be shown
as the one type that needs no configuration. **Fix:** return `{ type: 'unknown', raw }` and render it
as such — the Rust side already has a `TriggerConfig::Unknown` arm (`:713-717`) with no client
counterpart.

### D12 — Cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"The dual write double-dispatches."** It does not. `prefer_capability_scoped`
  (`bus.rs:266-291`) dedupes the merged match set on `(persona_id, use_case_id)` after
  `background.rs:1273-1275` concatenates subscription and listener matches, and the comment at
  `:1268-1272` says exactly why. 102 of 102 subscriptions have a paired listener and none can fire
  twice.
- **"Triggers point at entities that no longer exist."** Measured across four reference kinds and the
  answer is **zero**: 0 triggers whose persona is gone (the FK cascade holds and the pragma is set),
  0 chain triggers whose `source_persona_id` is missing, 0 `_auto_for_trigger` keys naming a deleted
  trigger, and of 93 non-wildcard `source_filter`s, 39 resolve to a live trigger id and **0 dangle**.
  The referential half of this leaf is in good health; the *semantic* half (does the name refer to
  anything that happens) is not, and nothing checks it.
- **"The UI toggle writes only `enabled`."** It writes both, and so does every other writer in the
  tree (§0.4). The drift came from outside this codebase. The defect is on the **read** side, and
  a correct-looking toggle is what made it invisible. §12.3.
- **"`cadence` is read by nobody."** True, and stronger than primed: **no code in 5,792 files writes
  it either.** It is sediment on 23 of 32 schedules from a path that no longer exists — which means
  a census rule keyed on the writer would score zero while the condition sits in the data.
- **"0 of 351 configure `max_backfill`."** Confirmed. The form *can* write it —
  `buildTriggerConfig.ts:64-66`, exposed by `CronConfig`'s `maxBackfill` prop — so unlike the other
  orphans this is a wired control nobody has used, not a broken one.
- **A defect I looked for and did not find.** The rate-limit drawer's `window_seconds` and the
  composite trigger's `window_seconds` share a name, and `validate_config:118` clamps the top-level
  one to 1..86,400 for **every** trigger type. They do not collide: the drawer nests its copy under
  `rate_limit`. Recorded because the collision is one refactor away and the validator is type-blind.

## 8 Gaps

**Gap 1 — There is no client-side type for `trigger_type`, because ts-rs was never asked for one.**
`PersonaTrigger.trigger_type` is `String` (`core/src/models/trigger.rs:441`), so the generated
binding gives `string`. ts-rs emits **89** real string-literal unions in this repo — the mechanism
works and is proven — but a `String` field cannot produce one. Every one of the 37 hand-written
copies is untethered **by construction**, not by neglect. This is upstream of D1, D8 and the §9 rule.

**Gap 2 — No type reaches a config key, in either direction.** `config` is encrypted JSON in a
`TEXT` column, assembled client-side as `Record<string, unknown>` and read server-side by
`val.get("…")`. This is the doctrine's fifth *"where types cannot reach"* — a serialization boundary
with an untyped bag on one side and a hand-written projection on the other. The reachable answer is
not a type but a **parse**: `#[derive(Deserialize)] #[serde(deny_unknown_fields)]` on
`TriggerConfig`, which turns D3, D4 and the six live orphan keys into loud errors. That is a
behaviour change on the operator's live rows (six of his configs would start failing to parse), so
it needs a migration-and-repair pass, not a flag.

**Gap 3 — The census cannot express "the form writes a key the engine never reads."** It is a
**join** across two languages and a JSON blob: a TS string-literal key against a Rust match arm's
`val.get("…")` set, scoped by `trigger_type`. The engine is a regex over one file's content. §9
specifies the instrument instead of pretending it into a pattern.

**Gap 4 — Nothing anywhere can answer "will this trigger ever fire?"** The information exists and is
scattered across four places (`next_trigger_at`, `status` + the persona join, `from_raw`'s arm, and
the set of event types the bus has carried). No command, view or query composes them. Every deviation
in §0 is invisible for this reason, and `armed` is what fills the vacuum. This is the highest-value
missing instrument in the leaf and it is an **absence**, which the census cannot express.

**Gap 5 — A trigger has no "why is this dead" channel that the Triggers page reads.**
`schedule_missed_runs.status_reason` exists, is well designed, is rendered on the *Schedules* page
(`ScheduleRow.tsx:159-166`), covers only `schedule` rows, is written only from create/update, and has
**0 rows**. An `event_listener` whose event nobody publishes has no equivalent at all.

**Gap 6 — The census cannot see whether the six vocabularies agree.** It counts occurrences of a
literal; it cannot compare a Rust `const` slice to a SQL `CHECK` list to a TS array. §9's rule is a
proxy that keys on the **symptom** (a copy naming an unstorable member) rather than the condition
(six copies exist). If someone widens the `CHECK` without touching the copies, the rule correctly
goes to zero — and if someone adds a seventh copy of the *narrow* six, the rule cannot see it.

## 9 The missing gate

**Condition, stated stack-free:** *an authoring surface enumerates the members of a closed vocabulary
that a layer beneath it narrows, and nothing compares the two lists.* An adopting repo must derive
its own proxy — this one keys on the four literal type names this storage layer happens to reject,
and would report green forever in a repo whose narrowing lives in a different word list.

**Existing rules checked for overlap before writing this**, by reading each definition rather than
its title: `declared-field-type-literal-chain` ([schema-driven-form](./schema-driven-form.md) — the
nearest *conceptual* neighbour: it owns *a control chosen by comparing a declaration's own type to a
literal*; mine owns *a menu wider than its column*), `comment-kept-cross-language-mirror`
([client-rule-mirroring](./client-rule-mirroring.md) — requires an obligation phrase, which none of
my sites carries), `ipc-payload-typed-inline` ([bridge-type-contract](./bridge-type-contract.md) —
owns payload shapes), `constraintless-table-declaration`, `untyped-lifecycle-transition`,
`partial-terminal-status-set`, `inline-minted-event-name`, `unverifiable-catalog-lookup`,
`asserted-definition-blob`, `missing-current-entity-rendered-as-unset`, `undeclared-tier-branch`,
`silent-row-skip`, `discarded-timezone-parse`. **None covers a vocabulary copy that is wider than its
storage constraint.** Proposing a new one.

**Overlap measured at SITE level (`file:line`) against the FINAL pattern**, by running **all 163**
baselined `.ts`/`.tsx`/`.rs` rules in the registry with their own roots, extensions and
`ignoreCommentLines` settings, and intersecting `file:line` sets:

| | value |
| --- | ---: |
| registry rules compared | **163** |
| rules sharing ≥1 **site** with mine | **0** |
| rules sharing ≥1 **file** with mine | 5 (`untranslatable-token-label`, `typo-token-overpainted`, `frozen-ui-copy-constant`, `native-title-tooltip`, `unmeasurable-metric-tile` — each matching 55–2,005 sites repo-wide; any rule keyed on component code shares a file with something) |
| sites shared with my own positive control | **0** |

**Verified by a second independent implementation.** The verifier is a private walker with its own
directory traversal, its own comment-only detection and its own regex assembly, importing nothing
from `scripts/census/lib/`. Both agree at **6 files / 9 matches**, and — per the doctrine's warning
that agreement on *what* is not agreement on *where* — the two also agree on all **9 `file:line`
sites**. All nine were opened by hand:

| site | what it is | true positive? |
| --- | --- | :---: |
| `src-tauri/core/src/validation/trigger.rs:4` | `VALID_TRIGGER_TYPES` — 10, the widest declaration | ✔ |
| `src-tauri/core/src/validation/trigger.rs:33` | `normalize_trigger_type` — *manufactures* `file_watcher`/`app_focus` from aliases | ✔ |
| `src/lib/utils/platform/triggerConstants.ts:56` | `TRIGGER_CATEGORIES` "Pull (Watch)" — the menu | ✔ |
| `src/lib/utils/platform/triggerConstants.ts:74` | `TRIGGER_CATEGORIES` "Compose" — the menu | ✔ |
| `src/lib/utils/platform/triggerConstants.ts:264` | the client config union's arms | ✔ |
| `src/features/triggers/sub_studio/libs/studioCommit.ts:34` | `FORM_COMMITTABLE_SOURCE_TYPES` — the Studio's commit list | ✔ |
| `src/features/shared/glyph/triggers.ts:43` | `prettyTriggerType` — labels for unstorable types | ✔ |
| `src/features/templates/sub_generated/adoption/useCasePickerShared.ts:28` | `TRIGGER_TYPE_ALIASES` — the TS mirror of `normalize_trigger_type` | ✔ |
| `src/features/templates/sub_generated/design-preview/EventsSection.tsx:32` | the design-preview summary switch | ✔ |

**Precision 9/9.** Each names ≥1 trigger type the `CHECK` rejects.

### The discriminator, and why the first pattern was wrong

The obvious pattern — *≥3 distinct trigger-type literals within a window* — returns **59 non-test
sites in 12+ files** and is **wrong**, because `{app_focus, clipboard, file_watcher}` is *also* the
complete membership of a **different** closed vocabulary: the ambient-context / sensory-signal
sources (`engine/src/ambient_context.rs`, `context_rules.rs`, `commands/companion/sensory.rs`,
`ContextEvent.ts`, `ContextPattern.ts`). **Two unrelated vocabularies share three literals**, and a
naive scan merges them — 25 of 59 sites, in 12 files, none of them about triggers. Requiring **at
least one of the six storage-admitted names in the same window** excludes every one of them, because
no ambient-context site can contain `manual`, `schedule`, `chain`, `webhook`, `polling` or
`event_listener`. Executed: dropping that half takes the rule from 6 files to **34**.

This is the doctrine's *"a vocabulary-based signal's recall is bounded by its author's word list"*
arriving from the precision side — and the word list here is **derived from the tree** (the `CHECK`
at `schema.rs:87` for the admitted six, `VALID_TRIGGER_TYPES` minus the `CHECK` for the rejected
four), never invented.

**Fail-loud properties** — not asserted, **executed** against the working tree with exit codes
captured:

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified, baseline 6/9) | **0** | `census OK` |
| baseline deflated (a rise) | **1** | `[drift] files rose 2 -> 6 (+4)` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 40 -> 6 (-34) without the baseline moving` |
| `floor` raised above the tree | **1** | `[structural] walked 5792 files but floor is 99000` |
| pattern → a token appearing nowhere | **1** | `[structural] matched zero files anywhere` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 3000` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 3000` |
| `goldenPath` removed | **1** | `missing grounding — a rule needs "goldenPath"` |
| `exclude` path renamed | **1** | `[structural] exclude … matched no file. The exemption is stale` |
| control given a baseline | **1** | `must NOT carry a baseline — it exists to fail` |
| **POSITIVE CONTROL swap** (violating rule → compliant prose) | **1** | `[drift] files rose 6 -> 9 (+3)` |
| **DISCRIMINATOR dropped** (rejected half only) | **1** | `[drift] files rose 6 -> 34 (+28)` — the ambient-context vocabulary flooding in |

**Where this runs.** `npm run census:check` is a **pre-push job** (`lefthook.yml`,
`golden-path-census`) and a step of `npm run check`; both execute on the developer's machine. Per the
campaign's §9 calibration this matters: `ci.yml` is red on pre-existing failures, so a CI-only gate
would run nowhere.

**On severity.** This is a census ratchet, not an ESLint `"error"`. No argument from warning volume
is made or intended — per the doctrine, a warn-level rule enforces nothing at either gate at any
count, which is why this is not proposed as one. **The correct end state is 0**, reached either by
widening the `CHECK` or by narrowing the menus; at that point the rule must be **deleted**, not
baselined at zero, because a zero-match rule fails structurally by design.

### The rule

```json
{
  "rules": [
    {
      "id": "vocabulary-wider-than-its-column",
      "goldenPath": "docs/concepts/golden-paths/trigger-wiring-surface.md",
      "title": "A wiring surface enumerates trigger types its own storage column CANNOT hold — the menu is wider than the table",
      "roots": ["src", "src-tauri"],
      "extensions": [".ts", ".tsx", ".rs"],
      "signal": {
        "pattern": "(?:[\"'](?:file_watcher|clipboard|app_focus|composite)[\"'][\\s\\S]{0,120}?[\"'](?:manual|schedule|polling|webhook|chain|event_listener)[\"']|[\"'](?:manual|schedule|polling|webhook|chain|event_listener)[\"'][\\s\\S]{0,120}?[\"'](?:file_watcher|clipboard|app_focus|composite)[\"'])",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A hand-written trigger-type vocabulary that names at least one type the persona_triggers.trigger_type CHECK constraint REJECTS, beside at least one it admits. PROXY FOR the stack-free condition: an authoring surface enumerates the members of a closed vocabulary that a layer beneath it narrows, and nothing compares the two lists. BOTH HALVES ARE LOAD-BEARING. The four rejected names (file_watcher, clipboard, app_focus, composite) are ALSO the complete membership of an unrelated closed vocabulary in this repo — the ambient-context / sensory-signal sources (engine/src/ambient_context.rs, engine/src/context_rules.rs, commands/companion/sensory.rs, bindings/ContextEvent.ts, bindings/ContextPattern.ts). Requiring one of the SIX storage-admitted names in the same 120-char window excludes every one of those, because no ambient-context site can contain manual/schedule/chain/webhook/polling/event_listener; executed, dropping that half takes the rule from 6 files to 34. BOTH WORD LISTS ARE DERIVED FROM THE TREE, never invented: the admitted six are the CHECK list at db/src/migrations/schema.rs:87 (identical in incremental.rs:472 and :1074, so this is not machine-dependent), the rejected four are VALID_TRIGGER_TYPES (core/src/validation/trigger.rs:3-14, ten) minus that CHECK. MEASURED 2026-08-17 at 6c97502d3 by two structurally independent implementations that agree on the count AND on all nine file:line sites: 6 files / 9 matches, ALL NINE OPENED BY HAND, precision 9/9 — validation/trigger.rs:4 (VALID_TRIGGER_TYPES, the widest declaration) and :33 (normalize_trigger_type, which MANUFACTURES file_watcher and app_focus from user/template aliases), triggerConstants.ts:56 and :74 (TRIGGER_CATEGORIES, the actual menu) and :264 (the client config union), studioCommit.ts:34 (FORM_COMMITTABLE_SOURCE_TYPES, the Trigger Studio's commit list), glyph/triggers.ts:43, useCasePickerShared.ts:28 (the hand-written TS mirror of normalize_trigger_type), EventsSection.tsx:32. LIVE CONSEQUENCE, executed by lifting the live CREATE TABLE into an in-memory database and attempting one INSERT per type: manual/schedule/polling/webhook/chain/event_listener ACCEPTED, file_watcher/clipboard/app_focus/composite REJECTED with 'CHECK constraint failed'. All 6 TRIGGER_TEMPLATES (the form's one-click quick-start strip) target a rejected type; three nlTriggerParser branches resolve to one; no rule in errorRegistry.ts matches a CHECK-constraint failure, so the user sees 'Something went wrong. Try again.' SIX independent copies of this one vocabulary exist at arities 10/10/10/8/6/4 and none imports a shared declaration, because PersonaTrigger.trigger_type is String in the ts-rs binding and no generated union exists to import. THE REAL FIX is a #[derive(TS)] enum whose variants are the storable set, decided in the same commit as the CHECK — see the path's 'Prefer a type over a gate'; this rule is the RATCHET that holds the line until it lands. CORRECT END STATE IS ZERO, at which point DELETE this rule rather than baselining it at zero. PRECONDITION (re-derive per repo, do NOT port): the two word lists are specific to this storage layer. An adopting repo must derive its own from its own narrowest gate — a CHECK list, an enum, a migration — and will get a different pattern for the same condition."
      },
      "baseline": { "files": 6, "matches": 9 },
      "floor": 3000
    }
  ]
}
```

### Positive control (evidence, NOT merged)

Same territory, pointed at the **compliant** form: the vocabulary consulted **by reference** rather
than re-listed. It returns **9 files / 37 matches** — `TriggerTypeSelector.tsx`,
`TriggerCategorySelector.tsx`, `TriggerQuickTemplates.tsx`, `TriggerStatusSummary.tsx`,
`NlTriggerInput.tsx`, `design-preview/helpers.ts`, `triggerConstants.ts`,
`core/src/validation/trigger.rs`, `db/src/repos/resources/triggers.rs` — and shares **0 sites** with
the violating rule. A near-zero result here would have meant the repo has no compliant form at all
and the violating rule was measuring house style rather than a choice; **37 compliant references
against 9 re-lists says the two forms genuinely coexist and the rule separates them.**

Note what the control does **not** certify, and this is why it partitions rather than blesses:
`TriggerTypeSelector.tsx` is counted here — it imports `TRIGGER_TYPE_OPTIONS` and
`TRIGGER_CATEGORIES` rather than re-listing, exactly as prescribed — and it is nonetheless **the
component that puts four unstorable options on screen**, because the constant it imports is one of
the six over-wide copies. *Arriving at the shared declaration is not the same as the declaration
being right.* A rise in this control is not by itself progress.

```json
{
  "id": "vocabulary-wider-than-its-column-positive-control",
  "goldenPath": "docs/concepts/golden-paths/trigger-wiring-surface.md",
  "title": "POSITIVE CONTROL — the trigger-type vocabulary consulted by reference instead of re-listed",
  "roots": ["src", "src-tauri"],
  "extensions": [".ts", ".tsx", ".rs"],
  "signal": {
    "pattern": "(?:VALID_TRIGGER_TYPES|TRIGGER_TYPE_OPTIONS|TRIGGER_TYPE_META|TRIGGER_TYPE_I18N|TRIGGER_CATEGORIES)\\b",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL, deliberately carrying NO baseline. The same vocabulary as `vocabulary-wider-than-its-column`, reached the compliant way — by naming the shared declaration instead of re-spelling its members. Measured 2026-08-17 at 6c97502d3: 9 files / 37 matches, sharing ZERO file:line sites with the violating rule, so the two partition the territory rather than overlapping it. If a refactor renamed these constants, or a walk/engine change broke identifier matching, this control drops to zero and the run fails structurally — which is the liveness half the violating rule cannot provide for itself, since its own correct end state IS zero. IT MUST NEVER BE GIVEN A BASELINE. And note what it does NOT certify: TriggerTypeSelector.tsx is counted here, imports TRIGGER_TYPE_OPTIONS exactly as prescribed, and is still the component that renders four options the storage column rejects — because the constant it imports is itself one of the over-wide copies. Arriving at the shared declaration is not the same as the declaration being correct, so a RISE in this control is not by itself progress."
  },
  "floor": 3000
}
```

### Two conditions I am refusing to gate by counting, with the measurement that justifies each — and a specification for the instrument each actually needs

1. **"The form writes a config key the engine never reads for that `trigger_type`."** This is the
   leaf's central condition and the census cannot express it: it is a **join** between a TypeScript
   string-literal key and a Rust `match` arm's `val.get("…")` set, scoped by a third value. Measured
   here as **23 form-writable keys / 8 read / 13 unstorable / 2 stored-and-unread**, and on the live
   rows as **6 of 16 `(type,key)` pairs unread**, none of which a regex over one file can see.
   **The instrument: a `check:trigger-config-keys` script** (~60 lines) that parses `from_raw`'s
   arms out of `core/src/models/trigger.rs` — the parse is mechanical, they are `"<type>" =>
   TriggerConfig::` blocks containing `val.get("<key>")` — parses `buildTriggerConfig.ts`'s
   `config.<key> =` assignments and their enclosing `s.triggerType === '<type>'` branch, and fails on
   any `(type, key)` the form writes and the arm does not name. **Precondition: exit 2 if it resolves
   fewer than 6 arms or fewer than 15 written keys**, so a refactor that breaks the parse fails
   loudly instead of reporting clean. Wire it into `npm run check` beside `census:check`. It would
   have caught `endpoint`, `event_id` and `rate_limit` on the commit that introduced them.
2. **"A trigger exists that can never fire, and nothing says so."** This is an **absence** and a
   property of the **database**, not of any file — the census cannot express it by construction, and
   cannot express "must be zero" either. Measured: **124 of 351**, with `armed` on 98 of them.
   **The instrument: a boot-time reconcile plus a fourth badge state.** The reconcile walks every
   `status='active'` row, re-runs the type's own reachability predicate (`compute_next_from_config`
   for `schedule`/`polling`; "has this `listen_event_type` ever appeared in `persona_events`" for
   `event_listener`; `source_persona_id` resolves for `chain`), and writes
   `schedule_missed_runs.status_reason` — the existing, well-designed, **0-row** channel — for every
   row that fails. The badge then reads it. This is the counterpart to
   `reconcile_orphaned_kb_records` (`vector_kb.rs:1410`), which does exactly this shape of repair for
   a different table and already runs from `src/lib.rs:1092`. It is the single highest-value missing
   instrument in this leaf.

---

## 12 Corrections to the brief

**12.1 — `sides: "client"` is INVERTED at the point of damage, and the correction is not "it was
both".** The brief and the spine scope this leaf to the client, and the *symptoms* are all
client-visible: a menu with four dead options, a badge that says `armed`, a Test button that says
Reachable. But **every one of the three worst defects is decided in server SQL or a Rust match
arm** — `delete_subscription`'s category-addressed `WHERE` (D2), `TriggerConfig::Polling`'s field
name (D3), and the `CHECK` constraint (D1). The **census rule that survived spans both roots**, and
2 of its 9 sites are Rust. The one thing that genuinely is client-only is the badge (D6), and it is
the *mildest* of the six. So this is the corpus's **eighth** `sides: "client"` contradiction, and it
matches the seventh's shape rather than the earlier ones: a client-scoped brief would have found the
form and missed the SQL. The honest label is **`both`, with the authoring half on the client and
every load-bearing decision on the server.**

**12.2 — `convergence: mixed` is UPHELD, and it is the second spine convergence label the corpus has
confirmed.** Tested clause by clause against an independent cohort of **3** (not 5; §6 excludes
`personas-cloud` as a declared four-site port and `personas-web` as its client — one observation, not
two). The result genuinely splits: clause 1 **physics 3/3**, clause 2 **physics 2/3 with the blob
having zero independent corroboration**, clause 4 **2/3**, clause 3 **1/3**, clause 5 **1/3**, and
clause 6 **inverted in 2 of 3**. That is `mixed` in the precise sense — not "we could not tell", but
*different clauses of one leaf landing on opposite sides with evidence for each*. Worth saying
loudly, given thirteen prior failures.

**And clause 6 is the doctrine's "the fleet converged on the disease" pattern in a new costume.**
Two of three independent repos put the on/off switch on a column the dispatcher does not read, in two
different ways, and in both the UI displays the wrong one. An oracle counting agreement would read
that as strong confirmation of *something*; what the siblings agreed to *do* is get it wrong.
`brainiac`'s case is worth carrying: its module doc claims the claim predicate is
*"(`enabled` + `next_run_at <= now()`)"* and the SQL tests only `next_run_at` (`sweeps.rs:240-253`
vs `:7-8`), its disable path leaves `next_run_at` armed (`:177-179`), and its test file covers
enable→armed and never disable→disarmed. **Personas is the third instance of the same shape.**

**12.3 — "What does the toggle in the UI actually write?" — the brief's framing pointed at the wrong
half, and the answer is more interesting than the question.** The toggle writes **both** `enabled`
and `status`, and so does every writer in the tree (`create:121`, `update:380`, `set_enabled:1862`,
`set_status:1882`, `use_cases.rs:100`, `incremental.rs:2180`). The 26 drifted rows carry
`updated_at = '2026-06-10 08:13:14'` — SQLite's `datetime('now')` shape, which **no Rust path here
produces**; they were written by something outside this codebase. **The defect is entirely on the
read side**: three consumers read three different columns, and the badge reads the only one no
dispatch predicate consults. A brief hunting the writer would have found six correct writers and
concluded the ledger was clean.

**12.4 — "0 of 351 configure `max_backfill`, so the repo's best backfill instrument has never had a
candidate" is right, and the reason is not the one implied.** The instrument is not unreachable — the
form *can* write it (`buildTriggerConfig.ts:64-66`, exposed through `CronConfig`'s `maxBackfill`
prop, capped at 100). It is a **wired control nobody has used**, which puts it in a different class
from `rate_limit` (written, never read) and `endpoint` (written, read by the wrong things). Three
superficially identical zeroes, three different causes; only one of them is a defect in the wiring
surface.

**12.5 — Two corrections to my own measurements, both of the kind that hides.**
**(a) My first key-level join was scoped wrongly and agreed with my thesis anyway.** I joined the
live config keys against the *union* of every key `from_raw` reads, and got "polling.cron: read",
"polling.timezone: read", "event_listener.event_type: read". All three are **false**: `from_raw` is a
`match` on `trigger_type` and those keys are absent from those arms. Re-running the join **per
`(trigger_type, key)`** — the scope the code itself uses — moved the unread count from 3 pairs to
**6**, and 50 of 687 key-instances. This is the doctrine's *"a `GROUP BY` that omits the scope key
the code scopes by"*, and it is worth recording that the wrong version was **less** alarming than the
truth, which is the direction that gets published.
**(b) A mechanical reader-scan produced a plausible false positive that only hand-verification
caught.** It reported `config.event_id` as read at `commands/tools/triggers.rs:1823`. Opening it
shows an `event_id` parsed out of a **webhook replay HTTP response body** — a different `event_id`,
in a different function, about a different thing. Same-name collisions are exactly what a
grep-shaped reader scan cannot resolve, and the tell was that the "reader" was in a `replay_webhook_request`
async fn with no trigger config in scope.

**12.6 — A vocabulary-collision trap in my own census pattern, caught before publication.** The
natural pattern for this leaf — *three or more trigger-type literals near each other* — returns 59
non-test sites, and **25 of them in 12 files are a different vocabulary entirely**: the
ambient-context sensory sources, whose complete membership is `{app_focus, clipboard, file_watcher}`.
Both my implementations reproduced the inflated number, because both were asking the same wrong
question. Only reading the matched sites revealed that a third of them had nothing to do with
triggers. The fix (requiring a storage-admitted name in the same window) is now the load-bearing half
of the shipped pattern, and the executed proof is in §9's fail-loud table: dropping it takes the rule
from 6 files to 34. **Two closed vocabularies in one repo can share most of their members; a
literal-based signal cannot tell them apart, and agreement between two implementations will not
warn you.**

**12.7 — Three primed leads confirmed with sharper numbers, and one that changed shape.**
`triggerArmState.ts:72`'s 90.9% disagreement is **confirmed still latent** (0 of 351 configure a
window) — but the badge's *live* defect is at `:88`, not `:72`, and it is affecting 26 rows today
(§0.4). "39 listeners on an unpublished `trigger_fired`" is confirmed and is the **tip**: 82 of 189
listeners wait on a name never published, and the picker that suggested those names is 33-of-34 dead.
"`cadence` set on 23 of 32 and read by nobody" is confirmed and stronger — **nothing writes it
either**, in 5,792 files. And `triggerConstants.ts:552` is `:553` at this HEAD; the fallback is
`default: return { type: 'manual', … }`, and its consequence (an unstorable or unknown type rendering
as a configured-looking manual trigger) is D11.
