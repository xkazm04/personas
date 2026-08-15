# Golden path — Post-write side effects

> Situation node: `data-persistence/write-consequences/post-write-side-effects` ·
> [situation spine](../situation-spine.md) · recurrence 41 · dimensions:
> function · resilience · code-quality · performance
>
> Composed 2026-08-15 against `master` @ `a385c159d`. Sweep: **963 `.rs` files**
> and **4,829 `.ts`/`.tsx` files** (counts cited from
> [`shared-facts.json`](../shared-facts.json), not re-derived); **two independent
> implementations** of the transaction-span scan reconciled against each other;
> **a 3-arm controlled experiment executed on SQLite 3.53.0** (the version this
> repo links); and **four read-only queries against the operator's live
> `personas.db`** (347 MB, 244 tables, 2,188 executions) — copied to a scratchpad,
> never opened for write. `target/**` and `.claude/worktrees/**` excluded
> everywhere.
>
> **Sibling leaves, read them for their halves:**
> [`transaction-boundary.md`](./transaction-boundary.md) owns **what happens
> inside the transaction**; this path owns **what happens after it commits**.
> The seam is settled in prose at [§0](#0-the-boundary-with-transaction-boundarymd).
> [`backend-to-frontend-events.md`](./backend-to-frontend-events.md) owns the
> *transport* (naming, registry, subscription lifecycle); this path owns
> *whether an effect should have been dispatched at all, and when*.
> [`repository-crud-surface.md`](./repository-crud-surface.md) owns the write
> function's own signature. [`delete-semantics.md`](./delete-semantics.md) owns
> what a delete must reach; this path owns what must *learn* that it reached.
>
> **§7 Deviations is a fix backlog.** It is long on purpose.

---

## 0. The boundary with `transaction-boundary.md`

`transaction-boundary.md` settles which writes land together, on which
connection, under which lock, and who calls `commit`. Everything it governs ends
at the instant `commit()` returns `Ok`.

**This path starts there.** Its subject is the second half of a write: the event
that must be emitted, the cache that must be invalidated, the store that must be
refreshed, the rollup that must be updated, the subscriber that must be woken.
Its question is:

> **When a row changes, what else has to change — and what guarantees it did?**

The two paths meet at exactly one clause, and they agree on it: **an effect that
is not part of the invariant does not belong inside the transaction.**
`transaction-boundary.md` says it as "hold the lock for writes only"; this path
says it as "the transaction owns durability, not notification." Where they would
appear to conflict — a cache-dirty flag written *inside* the transaction — see
[Steps §5](#steps) and [Gaps #4](#8-gaps): that flag is a write, not a
notification, and the distinction is the whole design.

---

## Principle

> *Every clause is tagged with its warrant — **[physics]** (a property of the
> storage engine, of concurrency, or of causality itself), **[ergonomics]** (a
> design that makes the physics hard to get wrong), or **[local]** (calibration
> to this repo). Only the first two travel. Tagging is
> [`research/portability-test.md`](../research/portability-test.md)
> recommendation #2, applied — and the tags below were checked against three
> sibling repos, not asserted (see [§10](#10-convergence-what-three-siblings-independently-rediscovered)).*

1. **An effect dispatched before the commit is a lie that may never be
   retracted.** A rollback un-writes the row; it cannot un-send the
   notification. Any channel that carries an effect *out* of the transaction
   before `COMMIT` — a queue push, a channel send, an in-memory registry, an
   HTTP call — has already told a listener something that may become false.
   **[physics]** — measured, [§Evidence E1](#e1-the-3-arm-rollback-experiment).
2. **An effect dispatched from inside the transaction is dispatched about a row
   nobody else can read yet.** Under WAL, a concurrent reader sees nothing until
   commit. A listener that reacts by *reading back* will read the old row, or no
   row, and cache that. **[physics]** — measured, same experiment.
3. **A derived value must be able to represent the disappearance of its source.**
   An aggregate maintained only by `INSERT … ON CONFLICT DO UPDATE` can grow and
   can be corrected, but it has no arm for "the rows this bucket summarised are
   gone." It therefore drifts in exactly one direction — upward — forever.
   **[physics]**
4. **Re-derive beats accumulate.** `SELECT … GROUP BY` from the source is
   idempotent, self-healing, and cannot double-count. `SET c = c + 1` is a
   second copy of the truth that can only be repaired by a backfill nobody
   runs. **[physics]** — the single most convergent clause in this document;
   all three siblings rediscovered it, one of them twice inside a single file.
5. **A derived value that deliberately outlives its source must say so.** If a
   rollup is kept past retention on purpose, "frozen because the source was
   pruned" and "live" must be distinguishable in the row, or every consumer must
   guess — and consumers that sum both populations will double-count.
   **[ergonomics]**
6. **The effect must not be able to fail the write.** Bookkeeping that can
   return an error to the caller will eventually turn a successful write into a
   failed response. Make the effect's return type incapable of carrying an
   error. **[ergonomics]** — the strongest artifact found in any sibling.
7. **An effect whose dispatch result is discarded is an effect with no
   guarantee.** "It probably fired" is the same value as "it never fired," and
   the failure is usually *permanent and per-call-site* (an unserialisable
   payload), not transient. **[ergonomics]**
8. **One event name, one producer shape.** If two producers emit the same name
   with different payload shapes, every consumer must defensively discriminate,
   and the day one producer is "fixed" the consumer breaks. **[physics]** — this
   is a contract property, not a style preference.
9. **A dispatched effect nobody consumes is not free.** It costs an allocation,
   a channel slot, and an IPC frame on every write, and it competes for the same
   bounded capacity as the effects that matter. **[ergonomics]**

---

## 1. Trigger

You are in this situation if you would say, or type, any of these:

- "The row saved but the list still shows the old value." / "I have to refresh
  to see it."
- "Fire an event when this changes." / "Notify the frontend after the write."
- "Bump the counter." / "Keep a daily rollup so the chart survives retention."
- "Invalidate the cache after the mutation."
- "The total is wrong — it says more than actually happened."
- "This listener never fires." / "Why is this event arriving with no fields?"
- "One click causes three fetches."

**The "if you are about to write X" test.** You are in this situation if you are
about to type any of: a second statement after a repo write in the same
function; `.emit(` / `emit_event(` anywhere near a write; `SET <col> = <col> +`;
`INSERT INTO <table> … SELECT … GROUP BY`; a new entry in `cdc.rs`'s
`table_to_event`; `await someWrite(...)` followed by `await someFetch(...)` in a
React handler; or a `CREATE TRIGGER`.

---

## 2. The one way

**Name the effect, then place it by what it is.** Every post-write effect is
exactly one of three kinds and each has one correct placement, so classify
first and the placement follows. **(a) A DERIVATION** — a value that is a pure
function of rows that now exist (an aggregate, a search index, a denormalised
counter). Do not accumulate it; **re-derive it from the source**, either inside
the same transaction where the storage engine can do it for you (a `CREATE
TRIGGER` that maintains a shadow index — measured at **2,188 / 2,188 rows, zero
drift**, [§E2](#e2-the-controlled-experiment-inside-this-repo)) or in an
idempotent recompute (`INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE`,
`sla.rs:636-664`); and if the derived table is deliberately allowed to outlive
its source, **give it a column that says so** and make every consumer read that
column, because without one the frozen rows are indistinguishable from live ones
and callers will sum both (measured: **$820.75 and 697 executions of pure ghost
in the operator's live database**). **(b) A NOTIFICATION** — telling something
outside the transaction that a fact is now true. Dispatch it **strictly after
`commit()` returns `Ok`**, from the caller that owns the boundary, never from a
row-level hook and never from inside the transaction body; give the dispatch
helper a **return type of `()`** so it physically cannot fail the write, and
have it **log its own delivery failure internally** (`emit_event_bus`,
`event_registry.rs:44-47`, is the shape — `emit_event` at `:36-38` is not, see
§7 D1); and before you add the notification at all, **check that something
consumes it** — 8 of this repo's 12 change-data-capture events reach nobody.
**(c) AN INVALIDATION** — marking that a downstream artifact must be rebuilt.
This one **belongs inside the transaction**, because it is a *write*, not a
message: set a dirty flag on the row in the same transaction as the change, and
let a separate worker drain it (brainiac's `mark_dirty_for_memory`,
`governance.rs:216-222`, placed in the mutator "so there is no way to change a
memory's standing through the governance path and forget the wiki"). Then
**stop**: do not also emit an event for the same fact (one write, one effect —
§7 D6 costs three round-trips per star-toggle); do not add a table to
`cdc.rs:211-251` (that map is closed, see §8 Gap 1); and on the frontend,
**refresh through the store action that owns the entity**, never with a bespoke
`await write(); await fetch();` pair at the call site — 73 call sites already
hand-roll that pair and 94 more do something worse.

---

## 3. Mandated primitives

**Rust — dispatch**

- **`engine/src/event_registry.rs:44-47` — `emit_event_bus(app, event)`.** The
  only emitter in the repo that is correct by default: it returns `()`, so it
  cannot fail a write, **and** it logs its own delivery failure
  (`tracing::warn!(event_id, error, …)`). **Copy this shape for any new
  emitter.**
- **`engine/src/event_registry.rs:36-38` — `emit_event(app, name, payload)`.**
  The generic typed emitter, 20 call sites. Its body is
  `let _ = app.emit(event, payload.clone());` — it returns `()` correctly and
  **discards the delivery result**. Use it, but read §7 D1: fixing this one line
  corrects all 20 call sites at once.
- **`engine/src/event_registry.rs:52-58` — `try_emit_event`.** The propagating
  variant. **Zero callers**, carries `#[allow(dead_code)]`. It is the wrong
  default (an emit failure must not fail a write) and its existence is why
  `emit_event` was allowed to swallow. See §8 Gap 2.
- **`core/src/events.rs` — `event_name::*`.** Every event name, one registry.
  Owned by [`backend-to-frontend-events.md`](./backend-to-frontend-events.md);
  never emit a literal.
- **`db/src/cdc.rs:266-274` — `CdcHooks { notify_cloud_dirty, wake_event_bus }`.**
  Two injected `fn()` effects the drain task fires. **The comment at `:379-387`
  is the doctrine of this entire path, already written down in this repo**:
  the wake is "signalled from HERE (the drain consumer) rather than the update
  hook so the writing transaction has effectively committed by the time the
  tick's `claim_pending` runs."

**Rust — derivation**

- **`db/src/repos/communication/sla.rs:631-666` — `upsert_sla_daily_conn`.** The
  reference idempotent recompute: `INSERT … SELECT … GROUP BY … ON CONFLICT DO
  UPDATE SET <every column> = excluded.<column>`. Recomputes the full day from
  source rows, so running it twice is running it once. **Measured exact on live
  data: 403 of 403 buckets whose source survives agree to within 1e-9 on both
  count and cost.** Copy the recompute; do not copy its missing DELETE arm.
- **`db/src/migrations/schema.rs:141-152` — the `executions_fts_ai/ad/au`
  triggers.** The in-transaction derivation. Three triggers, one per action,
  including the DELETE arm. **Measured exact on live data: 2,188 / 2,188 rows,
  zero missing, zero orphan.**
- **`db/src/repos/core/memory_claims.rs:104` + `:139-143` —
  `open_claim_count`.** The only accumulator in the repo with a real reset arm:
  `+ 1` on file, `= 0` on resolve-all. Live check: **0 mismatched memories**
  (small sample — 2 claims total; see §8 Gap 5).

**Frontend**

- **`src/hooks/utility/data/useSettings.ts:16` + `:118` — `useSettings`.** The
  invalidation primitive this repo already built, already unit-tested, and
  **never wired to anything**. It subscribes to `settings-changed` so "a change
  made in one mounted panel refreshes every other mounted reader live, without
  polling." **Zero callers.** See §7 D8 — this is the single highest-leverage
  item in the backlog.
- **`src-tauri/src/commands/infrastructure/settings.rs:42-43` —
  `broadcast_settings_changed`.** The producer half, already shipped and already
  compliant (`if let Err(e) = app.emit(…) { tracing::warn!(…) }`).
- **A store action that writes and then refetches** — e.g.
  `stores/slices/network/networkSlice.ts:243-273`,
  `stores/slices/pipeline/recipeSlice.ts:52-77`,
  `stores/slices/vault/rotationSlice.ts:119-153`. Not a primitive, a convention
  — but it is the convention. Call the store action; never call `@/api` directly
  from a component.
- **`stores/slices/pipeline/teamSlice.ts:360-373` — optimistic-with-rollback.**
  Snapshot → optimistic `set` → `await` → restore snapshot in `catch`. **24
  sites across 6 store files; the only idiom in the codebase that handles write
  failure correctly.**
- **`lib/eventBridge.ts:820-838`.** The app-level subscription that turns a
  backend event into a debounced refetch. The shape to copy when an event
  *should* drive a refresh.

---

## 4. Steps

1. **Write the effect down as a sentence** in the form *"after this write
   commits, X must also be true."* If you cannot, you do not have a post-write
   effect — you have a second write, and it belongs in the transaction
   ([`transaction-boundary.md`](./transaction-boundary.md) owns it).
2. **Classify it: derivation, notification, or invalidation.** These are the
   only three. The placement follows mechanically and there is no judgement left
   after this step.
3. **If it is a DERIVATION — try to make it not exist.** Can the consumer just
   `SELECT … GROUP BY` at read time? If yes, stop; you have no post-write effect
   at all. brainiac states this as schema doctrine —
   `migrations/0025_document_reads.sql:3-5`, *"a log, not a counter, because
   every question worth asking is windowed … and a counter cannot answer a
   windowed question"* — and `0032_skill_proposals.sql:12`, *"no separate counter
   to drift."*
4. **If it must be materialised, prefer the storage engine.** A `CREATE TRIGGER`
   maintaining a shadow table is transactional for free: it rolls back with the
   write, it cannot be forgotten by a caller, and it cannot drift.
   **Write all three arms (INSERT / UPDATE / DELETE) or none.**
   `schema.rs:141-152` is the shape. A trigger pair with an accumulating column
   and no UPDATE arm is vibeman's migration 227 — its accumulating column needed
   a `MAX(0, count - 1)` clamp and its re-derived columns needed nothing, in the
   same file.
5. **If it is an INVALIDATION, write the flag inside the transaction and drain
   it outside.** A `dirty_at` column set in the same statement-batch as the
   change is atomic with it, survives a crash, and needs no message bus. Clear
   it with a compare-and-swap so a re-dirty during a long rebuild is not lost.
   This is the only effect that belongs inside the boundary, and it belongs
   there because it is a write.
6. **If it is a NOTIFICATION, place it after `commit()` in the function that
   called `commit()`.** Not in a repository function, not in a row-level hook,
   not in a helper that might be called from inside a transaction.
7. **Make the dispatcher's signature refuse the mistake — do this before you
   write the gate.** *(The contract's "prefer a type over a gate", answered
   explicitly.)* Three things a signature can make unrepresentable, all three
   found in a sibling and all three cheap here:
   - **Return `()`.** brainiac's `record_retrieval_quietly`
     (`crates/brainiac-server/src/demand.rs:32`) writes down exactly why: *"its
     own transaction, warn on failure, return nothing. A caller cannot
     accidentally propagate an error from it because it has no error to
     propagate."* Personas already has this (`emit_event` returns `()`); what it
     lacks is the "warn on failure" half.
   - **Withhold the handle until after commit.** personas-cloud's
     `AuditRecorder` (`packages/orchestrator/src/eventProcessor.ts:164-167`)
     holds **no database reference at all**; its 14 `record*` methods only
     `push()`, and the sole writing method is `flush(database)`. During the
     transaction it is *physically incapable* of writing.
   - **Make the in-transaction channel a sink.** brainiac's read-scope
     transaction is deliberately never committed
     (`crates/brainiac-server/src/http.rs:444-447`: *"`tx` above is never
     committed by this handler, so a write into it would be dropped"*). An
     in-transaction effect is not discouraged — it is discarded.
8. **Check that something consumes it.** Grep for the event name in `src/`
   before you add the emit. If the answer is zero, you are adding cost with no
   benefit; write the consumer in the same change or do not add the producer.
   **8 of this repo's 12 CDC events fail this check today.**
9. **On the frontend, refresh through the store action that owns the entity.**
   The component calls `store.updateThing(...)`; the store action does the write
   *and* the refetch (or the optimistic patch *with* rollback). A component that
   imports from `@/api` and hand-rolls the pair is the deviation, not the norm.
10. **And then stop.** If the store action refreshes, do not also subscribe to a
    CDC event for the same entity, and do not also poll. One write, one effect.

---

## 5. Anti-patterns

1. **Dispatching from a row-level database hook.** SQLite's `update_hook` /
   `preupdate_hook` fire *during statement execution*. A rollback does not
   un-call them. **Measured**: in the 3-arm experiment ([§E1](#e1-the-3-arm-rollback-experiment)),
   the escaping-callback arm fired **1 event for a transaction that rolled
   back**; the outbox and after-commit arms fired **0**. *Failure mode:* a
   listener refetches a row that does not exist, or the durable change journal
   records a before-image for a change that never happened — and the Reversible
   Agent will later offer to "undo" it, applying a stale before-image over live
   data.
2. **Emitting inside the transaction body.** *Failure mode:* the listener reacts
   by reading back, and under WAL no other connection can see the row yet.
   Measured in the same experiment: the callback had fired for **1** row while a
   concurrent reader could see **0**. Personas is clean here (0 of 328 explicit
   effect sites sit inside a transaction span); personas-cloud is not —
   `eventProcessor.ts:711` calls `dispatchMatch` from inside
   `database.transaction(…)`, and `dispatcher.submit` (`:542`) pushes onto a
   non-transactional in-memory queue, so a rollback leaves a persona execution
   already running with its idempotency row gone.
3. **An accumulator standing in for an aggregate.** `SET c = c + 1` is a second
   copy of the truth. *Failure mode:* every lost update is permanent, and if
   there is no source table the value is not merely wrong but **unrepairable** —
   personas-cloud's `cloud_deployments.invocation_count` (`db.ts:1440`) has no
   invocation table, no decrement anywhere, and therefore no possible backfill.
4. **A rollup with no DELETE arm.** *Failure mode:* it drifts monotonically
   upward and the drift is invisible, because the rollup looks internally
   consistent. **Measured live**: `sla_daily` holds **97 ghost buckets (19.4% of
   500)** summarising **697 executions** and **$820.75** that no longer exist.
5. **A derived table that outlives its source with no marker.** *Failure mode:*
   worse than #4, because it is *correct by design* and still wrong in use.
   Nothing in the row distinguishes "frozen because retention pruned the source"
   from "live", so any consumer that adds the rollup to a live recompute
   double-counts. This is the actual mechanism behind the `llm-spend-accounting`
   over-report; see §11.
6. **`let _ =` on a dispatch.** *Failure mode:* `app.emit` fails when the payload
   cannot be serialised — a **permanent, per-call-site** failure, not a
   transient one. `let _ =` makes "this event has never once been delivered"
   look identical to "delivered". **162 sites across 60 files.**
7. **Two producers, one event name, two payload shapes.** *Failure mode:* every
   consumer grows a defensive discriminator, and the day someone "fixes" the
   broken producer the consumer breaks. Live in this repo twice — see §7 D2 and
   D3. `MessageList.tsx:116-118` is the defensive guard, shipped with a comment
   explaining it.
8. **Adding a table to `cdc.rs`'s `table_to_event` map.** *Failure mode:* three
   at once. The name is a string that no compiler checks against the schema (2
   of 12 are wrong today); the emitted payload is `{action, table, rowid}`, which
   matches no declared TypeScript contract; and nothing verifies a consumer
   exists (8 of 12 have none).
9. **`await write(); await fetch();` at a component call site.** *Failure mode:*
   the refresh target is named literally at 73 different places, so nothing can
   verify it is the right one, and the ones that get it wrong are invisible.
   Worse variants: refreshing only UI flags (`setShowForm(false)`) — 14 sites —
   and refreshing nothing at all — 15 sites.
10. **Optimistic update with no rollback.** *Failure mode:* the write fails, the
    screen keeps the optimistic value, and the user believes it saved. **65
    sites across 26 files** patch state optimistically after the `await`; only
    **24 sites in 6 store files** snapshot and restore on error.
11. **Refreshing twice for one write.** *Failure mode:* not just waste — a race.
    An optimistic patch and a debounced CDC refetch both land, the later one
    wins, and which is later depends on timing. §7 D6 is a triple fetch.
12. **Assuming the poll will catch it.** `usePolling` has 12 call sites; none
    covers settings, credentials, design conversations, or triggers. For the
    surfaces in §7 D8–D12 there is no poll — the data is stale until remount.

---

## 6. Evidence

### The ONE site to copy

**`src-tauri/db/src/cdc.rs:376-390`** — the `wake_event_bus` dispatch. It is the
only place in the repo where the *timing* of a post-write effect is reasoned
about explicitly, and the reasoning is exactly this path's thesis:

> Signalled from HERE (the drain consumer) rather than the update hook so the
> writing transaction has effectively committed by the time the tick's
> `claim_pending` runs; in the rare case the tick still races the commit and
> claims nothing, the retained poll heartbeat picks the event up next interval.

Two things make it exemplary. It moves the dispatch **out of the hook and into
the consumer** — the correct placement for a notification. And it keeps the poll
as a **heartbeat under the push**, so the push is an optimisation and the poll is
the guarantee. Copy both halves.

### E1 — the 3-arm rollback experiment

Executed against **SQLite 3.53.0**, WAL, `foreign_keys = ON` — the engine and
pragmas this repo runs. A user-defined SQL function invoked from an `AFTER
INSERT` trigger stands in for `sqlite3_update_hook`: it fires at the same point
in statement execution and, like the hook, pushes into a structure outside the
transaction.

| | commits | rolls back | verdict |
| --- | --- | --- | --- |
| **A — escaping row callback** (the `cdc.rs` / `journal.rs` shape) | 1 | **1** | **false positive: a listener is told about a write that never happened** |
| **B — transactional outbox** (row written in the same tx) | 1 | 0 | safe — the effect rolled back with the write |
| **C — after `commit()`** | 1 | 0 | safe |

Second arm of the same run, the visibility window: with the transaction open, the
callback had already fired for **1** row while a second connection on the same
file could see **0**. **The effect is dispatched one row before any other reader
can observe it.**

### E2 — the controlled experiment inside this repo

The strongest form the convergence oracle takes is a controlled experiment inside
one codebase. This repo contains one, and it is the sharpest evidence in this
document because **both arms derive from the same source table**.

Source: `persona_executions`, **2,188 rows** in the operator's live database.

| Arm | Mechanism | Placement | Measured |
| --- | --- | --- | --- |
| **1 — `executions_fts`** | 3 × `CREATE TRIGGER` (`schema.rs:141-152`) | **inside** the transaction | **2,188 / 2,188 rows · 0 missing · 0 orphan** |
| **2 — `sla_daily`** | `INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE` on a maintenance poller (`sla.rs:636-664`, driven from `background.rs:3045-3055`) | **outside**, on a tick | **500 buckets · 97 ghosts (19.4%) · 697 phantom executions (+32.6%) · $820.75 phantom spend (+40.3%)** |

The arms differ on exactly one property: **arm 1 has a DELETE arm and arm 2 does
not.** `grep -rn "DELETE FROM sla_daily" src-tauri --include=*.rs` returns
**zero results in the entire tree.**

And the recompute itself is not the problem. At the correct local-day offset
(`+120 minutes`, the offset `server_offset_minutes()` returns on this machine),
**403 of 403 buckets whose source rows survive agree with a live recompute to
within 1e-9 on both count and cost, and zero source buckets are missing from the
rollup.** 100% of the discrepancy is buckets whose source is gone. Offsets were
swept to prove the alignment is the day-key and not luck:

| offset | exact buckets | mismatched |
| --- | --- | --- |
| `+0 min` | 223 | 152 |
| `+60 min` | 249 | 137 |
| **`+120 min`** | **403** | **0** |
| `-480 min` | 130 | 223 |

### Measured populations

| What | Count | Method |
| --- | --- | --- |
| Transaction openers in `src-tauri/**.rs` | **153** across 65 files | both implementations agree |
| … spans writing a table watched by an escaping hook | **45** across **19 files** | both implementations agree |
| … with ≥1 fallible statement after the write, before commit | **34** (104 such statements) | impl #2 after reconciliation |
| Explicit effect call sites (`emit` / `publish` / `notify` / hook wake) | **328** | tokenised scan |
| … lexically inside a transaction span | **0** | **cleared claim** |
| … with the dispatch result discarded (`let _ =`) | **162** across 60 files | census rule |
| … with the dispatch result checked (`if let Err(e) = …`) | **39** across 20 files | positive control |
| `emit_event(...)` call sites inheriting the helper's discard | **20** | grep |
| `try_emit_event(...)` call sites | **0** | grep |
| `let _ =` overall | **1,128** across 249 files | grep |
| Accumulating `SET c = c + …` updates | **14** | grep, all read |
| Live `CREATE TRIGGER`s in `personas.db` | **5** (3 FTS + 2 CHECK-style guards) | `sqlite_master` |
| Frontend write call sites outside `src/api` | **181** | Node scan |
| … write → explicit refetch | **73** (36 files) | |
| … write → parent callback only | **14** (10 files) | |
| … write → optimistic `set`, no rollback | **65** (26 files) | |
| … write → **UI-flag only** (`setShowForm(false)`) | **14** (10 files) | |
| … write → **nothing** | **15** (11 files) | |
| … optimistic **with rollback** | **24** (6 files, all in `src/stores`) | |
| TanStack Query / SWR call sites | **0** | not a dependency |
| Invalidation registry / `useMutation` wrapper | **none** | searched, absent |

### The CDC map, audited row by row

`db/src/cdc.rs:211-251` maps 12 tables to event names. Checked against the **244
tables in the operator's live `personas.db`** and against every frontend
subscriber:

| Table in the map | Exists? | Event | Frontend listeners | Verdict |
| --- | --- | --- | --- | --- |
| `persona_events` | ✔ 4,972 | `event-bus` | 1 singleton → 3 consumers | **works** — and it is the only branch that re-fetches the full row (`:392`) |
| `persona_executions` | ✔ 2,188 | `execution-status` | 5 registrations | fires; listeners correlate on `execution_id`, which the lightweight payload lacks |
| `persona_messages` | ✔ 0 | `message-created` | 1 → `MessageList.tsx:113` | **fires and is explicitly discarded** — `:116-118` |
| `persona_memories` | ✔ 6,535 | `memory-updated` | **0** | dead |
| `persona_credentials` | ✔ 25 | `credential-updated` | **0** | dead |
| `personas` | ✔ 78 | `persona-health-changed` | 1 (`eventBridge.ts:820`) | **works** — debounced refetch |
| `persona_triggers` | ✔ 351 | `trigger-updated` | **0** | dead |
| **`healing_issues`** | ✘ **NO SUCH TABLE** | `healing-issue-updated` | 1 (`healingSlice.ts:103`) | **can never fire** — real table is `persona_healing_issues` |
| `persona_event_subscriptions` | ✔ 102 | `subscription-updated` | **0** | dead |
| `persona_automations` | ✔ 0 | `automation-updated` | **0** | dead |
| **`audit_log`** | ✘ **NO SUCH TABLE** | `audit-entry-created` | **0** | **can never fire**, and nobody wanted it |
| `persona_tool_definitions` | ✔ 170 | `tool-updated` | **0** | dead |

**3 of 12 mappings do useful work.** Seven have no listener at all; one has a
listener that filters it out; two name tables that do not exist.

---

## 7. Deviations — the fix backlog

### D1 — `emit_event` discards delivery, and 20 call sites inherit it *(highest leverage in Rust)*

`engine/src/event_registry.rs:36-38`:

```rust
pub fn emit_event<P: Serialize + Clone>(app: &AppHandle, event: &str, payload: &P) {
    let _ = app.emit(event, payload.clone());
}
```

Its sibling four lines below (`:44-47`) already does it right — `if let Err(e) =
app.emit(...) { tracing::warn!(event_id, error = %e, …) }`. **One edit to this
body corrects 20 call sites.** This is the contract's §9 "gate pointing at a
broken destination" in miniature: the census rule below routes callers *to* a
concentrating primitive, and the primitive swallows. **Fix the default before
counting the callers.**

### D2 — `healing_issues`: a live consumer waiting on a producer that can never fire, and the obvious fix breaks it

`cdc.rs:235` maps `"healing_issues"`. The live database has **`persona_healing_issues`**; `healing_issues` is not among its 244 tables. The
update hook therefore never matches and the CDC producer has never fired once.

`stores/slices/overview/healingSlice.ts:103-128` subscribes to
`HEALING_ISSUE_UPDATED` and does a careful selective re-fetch with correct
`NotFound` semantics and a transient-failure fallback.

**It works anyway** — `src/engine/mod.rs:4192` emits the same name explicitly with
the right payload (`HealingIssueUpdatedEvent { issue_id, persona_id,
execution_id, new_status, transition }`).

**So the trap is that the obvious fix is the wrong fix.** Rename the CDC table
string to `persona_healing_issues` and it starts firing the *lightweight*
`{action, table, rowid}` payload under a name whose TypeScript contract
(`eventRegistry.ts:402-408`) declares `{issueId, personaId, …}`. The subscriber
would call `getHealingIssue(undefined, undefined)` on every healing write. **The
fix is to delete `cdc.rs:235`, not to correct the string.**

### D3 — `message-created`: two producers, one name, and a shipped defensive guard

`cdc.rs:220` emits `message-created` on every INSERT, UPDATE **and** DELETE of
`persona_messages` (no action filter), carrying `{action, table, rowid}`. The
protocol dispatcher emits the same name carrying a full `PersonaMessage`. The one
consumer, `MessageList.tsx:113-118`, opens with:

```ts
// The 'message-created' event fires from BOTH the protocol dispatcher (full
// PersonaMessage) AND the CDC layer (lightweight { action, table, rowid }).
// Ignore CDC notifications — they lack message fields and would render as
// ghost "Unknown" entries.
if (!raw.id || !raw.persona_id) return;
```

The workaround is correct and well-commented; the contract violation it works
around is the defect. **Fix: delete `cdc.rs:220`.**

### D4 — `audit_log` does not exist either

`cdc.rs:244` maps `"audit_log"` (INSERT only). No such table; the real ones are
`credential_audit_log`, `settings_audit_log`, `tool_execution_audit_log`,
`healing_audit_log`, `provider_audit_log`, `api_key_audit`, `audit_incidents`,
`cli_session_read_audit`. There are also **zero** frontend references to
`audit-entry-created`. **Fix: delete the line.** Nothing is owed a consumer.

### D5 — six more CDC mappings with no consumer

`memory-updated`, `credential-updated`, `trigger-updated`,
`subscription-updated`, `automation-updated`, `tool-updated`: **zero references
anywhere in `src/`** — the names are not even present in `EventName` (150
entries). Every write to those six tables allocates a `String`, takes a slot in
the 512-capacity bounded channel (`src/lib.rs:650`) shared with `event-bus`, and
dispatches an IPC frame to nobody. `persona_memories` alone carries 6,535 rows
and an `access_count` sum of **109,142**, i.e. ~109k recall updates each
producing one dead event.

**Honest counter-evidence, and it clears part of the claim.** A sweep of 2,999
log files in the operator's app-data directory found **zero** `"bounded channel
full"` warnings and exactly one startup-blackout replay (`count=1`). So the dead
traffic has **not** been observed to cause a drop. The cost is real; the harm is
so far theoretical. **Fix: delete the six lines** — cheap, and it removes the
headroom question rather than answering it.

### D6 — one star toggle, three fetches

`features/overview/sub_director/useDirector.ts:146-158`: `setPersonaStarred`
(writes `personas`) → `await fetchPersonas()` (#1) → `finally { refresh() }`
(#2) → the same write fires `persona-health-changed` → `eventBridge.ts:833`
debounced `fetchPersonaSummaries()` (#3). Two of three are redundant, and the
optimistic patch races the debounced refetch. Note `executionSlice.ts:669`
already carries a comment showing this was consciously de-duplicated *in one
place* — the pattern is known and unevenly applied.

### D7 — `resolveHealingIssue` fetches a row it has already removed

`stores/slices/overview/healingSlice.ts:75-76` writes, then filters the row out
of local state. The write fires `healing-issue-updated`, whose subscriber
(`:103-113`) issues a fresh `getHealingIssue` IPC and `.map()`s the result into
a list that no longer contains the id. **One wasted round-trip per resolve whose
result is provably unused.**

### D8 — app settings never propagate, and the fix is shipped, tested, and dead *(highest leverage overall)*

`hooks/utility/data/useAppSetting.ts:72`/`:74` write a setting and refresh
nothing. Every other mounted reader of the same key —
`ProviderCredentialField.tsx:37,39`, `LimitsSettings.tsx:42,43`,
`EngineCapabilityBadge.tsx:24`, `NotificationSettings.tsx:45,89` — keeps its
stale value until remount, and no poll covers settings.

The backend **already broadcasts** `settings-changed` on every settings write
(`commands/infrastructure/settings.rs:20,31,42-43`). `hooks/utility/data/useSettings.ts:16`
already declares the matching constant with a doc comment promising exactly the
missing behaviour. `__tests__/useSettings.test.ts` already has two tests for it.
**`useSettings` has zero callers.** The three modules that import from that file
pull only `getAppSettingCoalesced`.

**Fix: make `useAppSetting` subscribe to `settings-changed` for its key** (or
route it through `useSettings`). One hook, and D9 and D11 disappear with it.

### D9 — BYOM key panel

`features/settings/sub_byom/components/ByomApiKeyManager.tsx:165,167,180` write
settings and patch only their own local `entries` array (`:169`, `:181`).
Consumers (`EngineCapabilityBadge`, `ProviderCredentialField`, model routing)
never learn. `:281`/`:295` are UI-flag-only. Downstream of D8.

### D10 — credential remediation moves nothing on screen

`lib/credentials/remediationExecutor.ts:21` (`rotateCredentialNow`) and `:45`
(`updateRotationPolicy`) are module-level functions with no store handle and no
callback. `persona_credentials` CDC emits `credential-updated` — zero listeners
(D5). Contrast `stores/slices/vault/rotationSlice.ts:119-153`, where the same
four operations *do* refetch: the remediation path bypasses the slice that
already solves this.

### D11 — Mastermind layout/scene persistence is fire-and-forget

`features/teams/sub_mastermind/lib/layoutStore.ts:255` and
`lib/scenePublish.ts:151` both `setAppSetting` from outside the React tree.
Downstream of D8.

### D12 — four more surfaces that refresh nothing

- `hooks/design/core/useDesignConversation.ts:109` and `:304` —
  `updateDesignConversationStatus`, no refetch, no `set`; `design_conversations`
  is not a CDC table, so no fallback exists.
- `features/plugins/companion/decision/useDecisionQueue.ts:314` —
  `markMessageRead`; the natural catch-up (`message-created`) is the one D3
  discards.
- `lib/credentials/credentialRecipeRegistry.ts:96` — `upsertCredentialRecipe`,
  module-level, no notification, no CDC table.
- `features/agents/components/matrix/useLifecycle.ts:322` — the persona
  "promoted" write; partially rescued by `persona-health-changed`, but that
  refetches *summaries*, not the `personas` list, so name/description edits made
  in the same call stay stale.

### D13 — `prune_storage` deletes executions and leaves the rollup standing

`commands/infrastructure/system/storage.rs:125-129` is a **user-initiated,
IPC-exposed** `DELETE FROM persona_executions`. Nothing anywhere deletes from
`sla_daily`. The retention freeze in `sla.rs:614-621` is deliberate and
documented; **this is not retention.** A user who prunes to reclaim disk keeps
every SLA bucket and every dollar of spend forever, indistinguishable from the
frozen tail. `db/src/repos/execution/executions.rs:1360-1366` (`delete` by id) has
the same shape.

### D14 — the change journal records rolled-back writes as durable history

`db/src/journal.rs:147` registers a `preupdate_hook` on every pooled connection,
capturing before-images into `change_journal` through a channel and a writer
thread. Per [§E1](#e1-the-3-arm-rollback-experiment), that capture escapes the
transaction: **a rolled-back UPDATE leaves a durable journal row asserting the
change happened.** The Reversible Agent can then offer to undo it, and "undoing"
means applying a before-image over a row that was never changed. Exposure: **45
transaction spans across 19 files** write a journaled or CDC-watched table, **34
of them with at least one fallible statement still to run.** Worst spans:
`db/src/repos/core/personas.rs:1590` (15 further fallible statements),
`commands/infrastructure/context_consolidate.rs:620` (15),
`db/src/repos/resources/triggers.rs:1290` (11).

### D15 — no `rollback_hook` or `commit_hook` is registered anywhere

`grep -rn "rollback_hook\|commit_hook" src-tauri --include=*.rs` (excluding
`target/`) returns **zero**. `rusqlite`'s `hooks` feature is already enabled
(`db/Cargo.toml:45`) and `transaction-boundary.md` flagged the same absence
independently. Registering `rollback_hook` is the minimum viable fix for D14: it
lets the journal writer discard captures for a connection that rolled back.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **`cdc.rs`'s `table_to_event` is a `match` on `&str` and nothing can check
   it.** The table name is a string literal in `db/src/cdc.rs`; the schema is a
   string literal in `db/src/migrations/schema.rs`. There is no shared constant,
   no enum, no test that iterates the map against `sqlite_master`. Two of twelve
   entries have been wrong for the life of the feature and every gate in the
   repo stayed green. **This is the root cause upstream of D2, D3 and D4 — one
   gap, three deviations.** The fix is a type: a `const TRACKED_TABLES: &[(&str,
   &str)]` asserted against `sqlite_master` in a `#[test]`, which turns a silent
   miss into a failing test. (Adding that test is blocked on nothing; this
   composition could not run it because `cargo` is out of scope here.)
2. **`try_emit_event` is the wrong shape, which is why nobody uses it.** Per
   Principle 6, a notification must not be able to fail the write — so a
   `Result`-returning emitter has no correct call site, and its zero adoption is
   the design working. The gap is that its existence *justified* `emit_event`
   swallowing. What is actually needed is a **third** shape: return `()`, log
   internally. `emit_event_bus` is that shape and is not generic. Generalising it
   is D1.
3. **SQLite has no after-commit callback that carries the changed rows.**
   `commit_hook` fires at commit but receives nothing about *what* changed;
   `update_hook` receives the rows but fires too early. The two cannot be joined
   without buffering per-connection state — which is precisely why the
   transactional-outbox shape (arm B of E1) exists. Personas has **no outbox
   table**; nor does any sibling (see §10). This is a genuine gap in the storage
   layer, not laziness.
4. **`transaction-boundary.md` and this path give opposite advice about
   in-transaction work, and both are right.** That path says "hold the lock for
   writes only — compute, parse, encrypt, call the network all happen outside."
   This path says an *invalidation flag* belongs inside. The reconciliation is
   Steps §5: a dirty flag is a **write** (cheap, local, part of the invariant),
   not **work** (slow, external). If your "invalidation" involves I/O, it is a
   notification and it goes outside. Anyone reading only one of the two documents
   will get this wrong.
5. **The `open_claim_count` result is a weak positive.** Zero mismatched
   memories, but the live database holds only **2** `memory_claims` rows. The
   reset-arm design is sound; the evidence that it *stays* sound is thin. Do not
   cite it as proof that accumulators are fine.
6. **The rollup freeze cannot be marked without a schema change.** `sla_daily`
   has no column that could carry `sealed_at` / `source_pruned`
   (`persona_id, day, total, successful, failed, cancelled, timed_count,
   duration_sum_ms, cost_sum_usd, updated_at`). Principle 5 is therefore
   currently unimplementable for this table without a migration
   ([`schema-change.md`](./schema-change.md) owns that).
7. **The frontend has no invalidation primitive to route people to.** Unlike
   every other frontend path in this corpus, "prefer the primitive that exists"
   has no answer here: no TanStack Query, no SWR, no registry, no
   `useMutation`-like wrapper. The two caches that exist
   (`lib/async/createCachedFetch.ts`, `lib/utils/staleWhileRevalidate.ts`) are
   read-side TTL caches, not write-side invalidation. The best available answer
   is a convention (the store action), and a convention is what §9 cannot gate.

---

## 9. The missing gate

**What a machine can key on.** The condition this path most needs enforced —
"an effect was dispatched before its write committed" — is **not** countable
here, and saying so is a finding: every instance of it in this repo comes from
**two lines** (`cdc.rs:166` and `journal.rs:147`) that register hooks on every
pooled connection. A census rule would match 2 files forever and teach nobody.
The exposure is real (45 spans / 19 files, §E-populations) but it is a
consequence of an architectural choice made once, not a habit repeated 45 times.
**That condition wants the type from Gap 3 (an outbox) or the hook from D15 (a
`rollback_hook`), not a ratchet.** Recorded as a deliberate refusal to gate.

The condition that *is* countable, and that this path uniquely owns, is
**Principle 7: a dispatch whose delivery result is discarded.**

### Signal, mechanism, allowlist

- **Signal** — `let _ =` binding a Tauri `.emit(` / `emit_event(` /
  `emit_event_bus(` call. **Proxy for the stack-free condition**: *a post-write
  notification is dispatched with no path by which a permanent delivery failure
  could ever be observed.*
- **Mechanism** — a `scripts/census/rules.json` entry, ratcheting. Not a new
  script; not an ESLint rule (the signal is lexical, not AST-shaped, and there
  is no autofix — the correct replacement depends on whether the site should log
  or should route through a fixed `emit_event`).
- **Allowlist** — **none, deliberately.** The obvious candidate,
  `event_registry.rs:37` (the shared helper's own body), is *not* excluded: it is
  the single most important match in the set, because fixing that one line
  corrects 20 call sites (D1). An exclusion there would be the allowlist hiding
  the finding.
- **How it fails loudly if its own precondition is absent** — inherited from the
  runner: `floor: 700` fails the run if the walk sees fewer than 700 `.rs` files
  ("the matcher is broken, not the codebase clean"); a zero-match run is fatal; a
  silent drop without a baseline update is fatal.

### What makes the destination correct by default

Per the contract's fifth failure mode — *a gate on reaching a destination is only
as good as the destination's defaults* — the destination here is **not**
`try_emit_event` (Gap 2: a `Result`-returning emitter has no correct call site
and has zero callers for that reason). It is **`emit_event_bus`'s body shape**:
return `()`, log the `Err` internally. **Applying that shape to `emit_event`
(D1) makes the primitive correct by default and drops the count by 20 in one
edit.** Prefer that over migrating call sites.

### The rule

Publish as JSON; the orchestrator merges it into `scripts/census/rules.json`.
**Validated standalone at HEAD `a385c159d`: `unverified-effect-dispatch` = 162
matches across 60 of 963 walked files; the positive control = 39 matches across
20 files.**

```json
{
  "rules": [
    {
      "id": "unverified-effect-dispatch",
      "goldenPath": "docs/concepts/golden-paths/post-write-side-effects.md",
      "title": "A post-write notification dispatched with its delivery result discarded, so a permanently undeliverable effect is indistinguishable from a delivered one",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\blet\\s+_\\s*(?::[^=;\\n]{0,60})?=\\s*[^;\\n]{0,140}?(?:\\.\\s*emit(?:_to|_filter)?\\s*\\(|\\bemit_event(?:_bus)?\\s*\\()",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a `let _ =` binding whose right-hand side reaches a Tauri emit on the SAME statement (the fill class excludes `;` and newline, so a match can never run past its own statement into the next one). PROXY FOR the stack-free condition: a post-write notification is dispatched with no path by which a permanent delivery failure could ever be observed. Tauri's `emit` returns Err when the payload cannot be serialised — a PERMANENT, per-call-site failure, not a transient one — so `let _ =` makes 'this event has never once been delivered' look exactly like 'delivered'. Measured 2026-08-15 at HEAD a385c159d: 162 matches across 60 of 963 .rs files. TWO INDEPENDENT IMPLEMENTATIONS RECONCILE TO ONE DISAGREEMENT, AND THE DISAGREEMENT IS A FALSE POSITIVE IN THE LOOSER ONE: a line-oriented grep (`let _ = .*emit_event`) reports 163 because it matches src/engine/webhook_notifier.rs:601, `let _ = app; // reserved for future per-delivery emit_event` — a discard of an unrelated binding whose trailing COMMENT contains the token. This pattern excludes it by construction because `[^;\\n]` cannot cross the `;` after `app`; that is why the fill class is punctuation-bounded rather than a plain `.{0,140}?`. The COMPLIANT sibling form is used 39 times in 20 files (`if let Err(e) = app.emit(...) { tracing::warn!(...) }` — see the paired positive control), so this is a majority deviation from an in-repo convention that already exists and works, not a migration with no destination. NO EXCLUDE ENTRY EXISTS, DELIBERATELY: the shared helper's own body at engine/src/event_registry.rs:37 is the single most valuable match in the set, because it is `let _ = app.emit(event, payload.clone())` inside `emit_event`, and 20 further call sites inherit the discard through it — excluding the primitive would be the allowlist hiding the finding. PRECONDITION (must be re-derived per repo): this repo dispatches frontend notifications through a fallible `emit` whose Result is discardable with Rust's `let _ =` idiom, and its compliant form spells the check `if let Err`. A repo whose emitter returns void (personas-cloud's in-memory dispatcher.submit returns a bool; vibeman's eventBus.emit returns void) has the SAME condition wearing markup where there is no result to discard, and this pattern scores ZERO against it while the condition is present — there, the proxy has to become 'the emitter cannot report failure AT ALL', which is a signature property, not a call-site one. LEGAL FIX, in order: (1) change the shared helper's body to the `emit_event_bus` shape at engine/src/event_registry.rs:44-47 — return (), log the Err with tracing::warn! — which corrects 20 call sites in one edit and is the fix this rule most wants; (2) at a direct call site, `if let Err(e) = app.emit(name, &payload) { tracing::warn!(event = name, error = %e, \"...\"); }`. Do NOT silence a match by switching to try_emit_event and adding `?` — a failed notification must never fail the write that caused it (Principle 6), which is why try_emit_event has zero callers and should stay that way. Do NOT silence a match by deleting the emit."
      },
      "baseline": { "files": 60, "matches": 162 },
      "floor": 700
    },
    {
      "id": "verified-effect-dispatch-positive-control",
      "goldenPath": "docs/concepts/golden-paths/post-write-side-effects.md",
      "title": "POSITIVE CONTROL — the same emit anchors pointed at the COMPLIANT form, which must also be found",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\bif\\s+let\\s+Err\\s*\\(\\s*[A-Za-z_]\\w*\\s*\\)\\s*=\\s*[^;\\n]{0,140}?\\.\\s*emit(?:_to|_filter)?\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "CONTROL, NOT A GATE — carries no baseline by design and must never be ratcheted. Identical anchors to `unverified-effect-dispatch` (the same `.emit(` token, the same punctuation-bounded fill class, the same roots and extensions) pointed at the CORRECT shape: `if let Err(e) = <receiver>.emit(...)`. It exists to prove the main rule discriminates on the DISCARD SHAPE rather than on the token `emit` — if the main rule were really keying on `emit`, these 39 sites in 20 files would appear in its match set too, and they do not. Measured 2026-08-15 at HEAD a385c159d: 39 matches across 20 files, disjoint from the main rule's 162/60. Largest holders: src/companion/session.rs (15), src/commands/companion/fleet_bridge.rs (3), db/src/cdc.rs (3, at :394/:424/:564 — the CDC drain task checks every emit it makes, which is exactly the shape the main rule routes callers to). A run in which this control drops toward zero means the compliant form is being abandoned, and a run in which it matches nothing means the anchors themselves stopped working — either way the main rule's number should not be trusted that day."
      },
      "floor": 700
    }
  ]
}
```

### What this gate does NOT catch

Stated so the next repo can re-derive a different proxy rather than trusting
this one:

- **The frontend half entirely.** 15 sites that refresh nothing, 14 that refresh
  only a UI flag, and 65 optimistic updates with no rollback are all *absences*,
  and an absence has no token. Gating them needs a positive convention to key on
  first — which the repo does not have (Gap 7).
- **`.ok()` and `drop(...)` as discard idioms.** Only `let _ =` is counted, so
  the number is a floor.
- **Dispatch through a helper that swallows internally.** The 20 `emit_event(…)`
  call sites do not match; only the helper's own body does. That is correct
  (fixing 1 fixes 20) but means the rule under-reports exposure by 20.

---

## 10. Convergence — what three siblings independently rediscovered

Checked against `../brainiac` (Rust + Postgres + Next.js console),
`../personas-cloud` (TypeScript orchestrator, SQLite), `../vibeman` (Next.js +
SQLite). **A clause reinvented independently is physics; a clause with no trace
anywhere should be suspected of local calibration.** With the refinement earned
this week: *convergence measures who audits, not who needs it* — so a clause
found only in the repo with the most reviewers is discoverability, not truth.

### Convergent — treat as doctrine

| Clause | brainiac | personas-cloud | vibeman |
| --- | --- | --- | --- |
| **Re-derive beats accumulate** (Principle 4) | **exclusive** — every aggregate is `GROUP BY` over an append-only log, and the reason is written into the migrations: *"a log, not a counter"* (`0025_document_reads.sql:3-5`), *"no separate counter to drift"* (`0032:12`) | all analytics re-derive (`db.ts:1603,1622-1627,1644-1646,1679`); the one accumulator has no source table and is unrepairable | **both, in one file** — migration 227's accumulating `signal_count` needed `MAX(0, count - 1)` and its re-derived `velocity_7d`/`risk_level` needed nothing |
| **The effect must not fail the write** (Principle 6) | **strongest artifact anywhere**: 3 helpers returning `()` — *"a caller cannot accidentally propagate an error from it because it has no error to propagate"* (`demand.rs:11-12`) | `AuditRecorder` holds no db handle until `flush(database)` (`eventProcessor.ts:164-167,343-347`) | `crudRouteFactory.ts:317-318` wraps `afterDelete` in `try {} catch {/* must never break main flow */}` |
| **Dispatch strictly after commit** (Principle 1) | 7 after-commit call sites; read-scope tx is never committed so an in-tx write is *discarded* (`http.rs:444-447`) | stated at `eventProcessor.ts:610-616`, applied to audit, **violated for dispatch** (`:711`, `:542`) | 12 emits, all outside transactions — by convention, nothing prevents otherwise |

**Vibeman's migration 227 is the single best piece of evidence in this
document**, because it is a controlled experiment with the arms one line apart:
same trigger pair, same table, and only the accumulating column needed a clamp
against going negative. That clamp is an admission written in SQL.

### Divergent — mark as local, not doctrine

- **The transactional outbox.** **No sibling has an outbox table.** Not brainiac
  (0 hits), not personas-cloud (mentioned only in a plan doc), not vibeman.
  Arm B of E1 proves it *works*, but four independent codebases declined to build
  one. The nearest real thing is brainiac's `dirty_at` flag written in-transaction
  and drained by a separate worker with a compare-and-swap clear
  (`documents.rs:389,555-558`) — an outbox in effect, with no outbox table.
  **This path therefore prescribes the dirty-flag shape (Steps §5) and does NOT
  prescribe an outbox.** Had I written "use a transactional outbox," the oracle
  would have contradicted me, and it is worth saying plainly that it nearly did.
- **Frontend invalidation.** Three mutually exclusive answers — brainiac console
  11 × `revalidatePath` / 0 everything else; vibeman 36 × `invalidateQueries` /
  0 everything else; personas-cloud has no frontend; Personas has none of the
  above. There is no convergent mechanism, only a convergent *requirement*.
  Principle: "the write must refresh what it affects." Mechanism: local.

### The refinement, demonstrated

brainiac's console contains a second controlled experiment that is the cleanest
statement of *convergence measures who audits*: `revalidatePath` reached two ways
— a named module-level helper holding a **constant** path (3 helpers, 16 call
sites) vs inline at the mutation site (8 sites). **Both historical bugs were in
the inline arm, and both were fixed by hoisting to a helper**, with the postmortems
committed as comments:

> "revalidating a route that does not exist is a silent no-op: every
> approve/reject left the decided row sitting in the rail"
> — `reviews/actions.ts:56-60`

> "the old `/console/disputes` target matched nothing and the answered row never
> actually left the queue, tempting a second (no-op) adjudication."
> — `disputes/actions.ts:32-35`

Residual risk survives only in the inline arm, where `sweep-actions.ts:18` takes
the revalidation path as a **caller-supplied string**. The helper arm cannot
express that mistake because the path is a `const`. **This is Principle 9 of the
frontend half — the refresh target must be owned by one module, not named
literally at each call site — and it is exactly the defect shape Personas has 73
instances of.**

### Where convergence contradicts a claim in this document

**It does not contradict Principle 3, but it reframes it.** The brief framed
`sla_daily` as *"an upsert rollup that cannot represent deletion"*, implying an
accumulator. It is not one — it **re-derives**, which is the convergent-correct
side of Principle 4, and it does so exactly (403/403). Personas is on the right
side of the most convergent clause in this path. Its defect is a *third*
category that no sibling exhibits: **a correctly re-derived rollup with a
deliberate retention freeze and no marker for it.** No sibling has this because
no sibling keeps a rollup past its source at all. That makes Principle 5
**[ergonomics], not [physics]** — a real requirement with no independent
rediscovery, and I have tagged it accordingly rather than inflating it.

---

## 11. Where this brief was wrong

Recorded prominently, per the standing rule.

1. **"`sla_daily` over-reports $820.75 (40%) … an upsert rollup that drifted
   from its source."** The *number* is confirmed to the cent — ghost buckets hold
   **$820.75** and **697** executions, and the rollup's $2,857.01 exceeds the
   live source's $2,036.26 by **40.3%**. The *mechanism* is not drift. Where the
   source survives, the rollup is **exact in 403 of 403 buckets** on both count
   and cost, and **zero** source buckets are missing from it. 100% of the
   discrepancy is buckets whose source rows were pruned by the 60-day execution
   retention — which `sla.rs:614-621` documents as **deliberate** ("the trend
   survives beyond the raw-execution retention window"). The defect is not that
   the rollup drifted; it is that a **deliberately frozen row is
   indistinguishable from a live one**, so any consumer summing both
   double-counts (Principle 5, §7 D13). This matters for the fix: adding a
   `DELETE` arm would *destroy the feature*. The fix is a marker column plus a
   consumer that respects it.
2. **"2,870 executions where 2,173 exist."** Today's live numbers are **2,865
   rollup / 2,188 actual / 2,168 matched**. The figures moved because the
   database moved; the shape is identical. Cite the shape, re-measure the
   number.
3. **"is any effect emitted *before* the commit … ?" — for explicit emits, no.**
   **0 of 328** explicit effect call sites sit lexically inside a transaction
   span. The repo's hand-written discipline on this is perfect and better than
   its own cloud sibling's, which does have exactly that defect
   (`eventProcessor.ts:711`). The hazard is real but it lives entirely in the two
   lines that register row-level hooks — a structural property, not a habit. This
   reframing is why §9 refuses to gate it.
4. **"1,149 `let _ =` sites / 250 files" (inherited from `structured-logging.md`).**
   Re-measured at HEAD `a385c159d`: **1,128 across 249 files**. The
   event-discarding subset reconciles exactly at **163** by grep and **162** by
   the census rule, and the one-site disagreement is a false positive in the grep
   (a comment containing the token `emit_event`). The "~396 discarding DB writes"
   figure did not reproduce under a narrower definition — I measure **69**
   discarding `.execute(`/`.execute_batch(` and **208** discarding a
   write-verb-shaped repo function, **277** total. Different definitions, not a
   contradiction; stated so the next composer picks one.
5. **"two live-update CDC events that never fired" — confirmed, and it is worse
   than two.** `healing_issues` and `audit_log` are absent from all **244**
   tables in the live database, so those two can never fire. But six *more*
   mappings fire correctly into **zero listeners**, and a seventh
   (`message-created`) fires into a listener that discards it by construction.
   **3 of 12 mappings do useful work.** The brief's "swallowed by `let _ =`" is
   also not the mechanism for these two — they are swallowed by
   `table_to_event` returning `None`, which is not an error at all, which is why
   nothing anywhere could have noticed.
