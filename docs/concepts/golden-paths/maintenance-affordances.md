# Maintenance affordances

> Situation node: `client-runtime / mutations-and-editing /
> maintenance-affordances` · [situation spine](../situation-spine.json)
> `sides: "client"` · `twoSided: true` · `fusedAcrossSides: false` ·
> `recurrence: 4` · `risk: low` · `convergence: "mixed"`.
> Dimensions: **function · ui · code-quality**.
> Spine `why`: *"Dev-seed, garbage-collect and delete-all controls attached to a
> data surface."*
>
> **Short form** (Mode 2 tiering: `risk: low`). Prose is dropped; measurement is
> not.
>
> Composed 2026-08-17 against `master @ 29e28aa8f`. Sweep: a
> three-implementation inventory of every maintenance door
> (`src/api/**` invoke sites · `src-tauri/src/lib.rs`'s `generate_handler!` ·
> `src/lib/commandNames.generated.ts`), their 18 feature-layer call sites, the
> five whole-table wipes in `src-tauri/db/src/repos/**`, the five `seed_mock_*`
> commands and their release-build guards, the three `delete_all_*` confirms,
> and a 963-file Rust census with two independent matchers. Row counts replayed
> against the 2026-08-17 purge backup.
>
> **⚠ Row counts are historical as of 2026-08-17 and unreproducible** — from
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`, not the
> emptied live file.

---

## §0 — Headline

**Twenty-one maintenance doors. The three that say how much they will destroy
say a different number from the one that gets destroyed, the seeding controls
are the only class in the app with a correct double gate, and the single most
dangerous control in the group is a function called `prune` that empties the
whole table when its input list is empty.**

Three implementations, agreeing where they should and disagreeing informatively
where they do not:

| inventory | maintenance doors |
| --- | ---: |
| A — `invoke<…>("<cmd>")` sites in `src/api/**` | **21** |
| B — `generate_handler!` registrations in `lib.rs` | **22** |
| C — `commandNames.generated.ts` union | **22** |

B and C agree exactly. The one A misses is `clear_pending_oauth`, invoked
directly from `src/stores/authStore.ts:65,74` with a raw `invoke` that never
passes through the api layer — so **implementation A's recall is bounded by a
convention, not by the truth**, and the door it missed is the one that broke the
convention.

Of the 21 with a client wrapper, **3 have no call site in `src/features/**` at
all**: `cleanup_dead_trigger_events`, `clear_fired_alerts`,
`reset_quality_gate_config`. Wrappers exist, commands are registered, nothing
presses them.

The blast radius, per door class:

| class | doors | states a count **before** the click | preserves anything | returns a count |
| --- | ---: | --- | --- | --- |
| `seed_mock_*` | 5 | n/a | n/a | n/a — and **5/5 are DEV-gated on both sides** |
| `delete_all_*` | 3 | 3/3 — and **1 of the 3 is wrong** | 1 of 3, and it preserves **0 rows in practice** | 3/3 |
| `clear_*` / `gc_*` / `cleanup_*` / `prune_*` / `reset_*` | 13 | **1 of 13** in a confirm (`prune_storage`); 1 more as a header badge that is not in any dialog (`CrashLogsSection`) | varies | 3 of 5 whole-table wipes return **nothing** |

The wrong count is the memories confirm: the dialog reads *"This permanently
deletes all {count} memories"* with `count = memories.length`
(`MemoriesPageDense.tsx:388`) — the client's **filtered, loaded** array — while
the server runs `DELETE FROM persona_memories WHERE tier != 'core'`
(`repos/core/memories.rs:1055`). Measured against the backup: **6,535 memories,
of which `tier = 'core'` is 0** (3,132 `active`, 2,026 `working`, 1,377
`archive`). So the one preservation clause in the whole maintenance family
protected **zero rows**, and the number shown to the user was neither the number
deleted nor the total.

---

## §2 — The one way (compact)

**A maintenance control states, before the click, the number the server will
actually destroy — obtained from the server, by the predicate that will run —
and returns that number back so the receipt and the promise can be compared.**

1. **Compute the blast radius server-side, with the delete's own predicate.**
   One function, one flag: `fn prune(…, dry_run: bool)` that builds the plan and
   returns it before writing. Never `items.length`, never a narrower `WHERE`
   than the delete's. `prune_storage` is the model — the count comes from
   `storageUsage()` and the result comes back as `prunedExecutions`.

2. **Return a count, never `Result<()>`.** A wipe that cannot say how many rows
   it removed cannot feed a receipt, a log line, an undo, or a confirm. This is
   the leaf's cheapest rule and the one §9 gates.

3. **Preserve deliberately or not at all, and put the exception in the
   predicate *and* in the copy.** If the delete spares a tier, a pin, an unread
   flag, the confirm must say so. `memories::delete_all`'s `WHERE tier !=
   'core'` carries a nine-line comment explaining the exception and the dialog
   never mentions it.

4. **Separate "sweep" from "wipe" and never let one degrade into the other.** A
   `prune(active_ids)` whose empty-input branch is `DELETE FROM t` is a wipe
   wearing a sweep's name — §7 D3.

5. **Gate developer affordances twice: hide the control AND refuse the
   command.** `import.meta.env.DEV && <button>` plus
   `#[cfg(not(debug_assertions))] { return Err(…) }`. Five of five seed doors do
   exactly this; it is the only place in the app where a client gate and a
   server gate agree by construction, and it should be the template for every
   dev affordance.

6. **Put the maintenance controls where they act, and say what they act on.**
   `ManualReviewList.tsx:315-318` records the earned version of this: the GC /
   delete-all / seed actions were once shown over the backlog and knowledge tabs
   and *"implied they acted on whatever was on screen, which they never did"* —
   so they are now rendered only in the mode they belong to.

7. **Reachability by accident is a property of the control, not the dialog.**
   Three `delete_all_*` doors sit behind a `ConfirmDialog`; the two whole-table
   `clear_*` doors that the app actually renders (`CrashLogsSection`,
   `WebhookRequestInspector`) have **no confirm of any kind** — one click, and
   `CrashLogsSection`'s also clears a `localStorage` key in the same handler.

---

## §7 — Deviations

### D1 · The three `delete_all_*` confirms are three different counts, and one of them cannot be right

| door | confirm count expression | what the server deletes |
| --- | --- | --- |
| `delete_all_memories` | `memories.length` (`MemoriesPageDense.tsx:388`) — the client array, **after** `categoryFilters` narrowing (`:129-132`) | `DELETE FROM persona_memories WHERE tier != 'core'` — unscoped, workspace-wide, **6,535 rows** |
| `delete_all_messages` | `messagesTotal` (`MessageList.tsx:405`) — a server total | `DELETE FROM persona_messages` — unscoped |
| `delete_all_manual_reviews` | `reviewQueue.counts?.total ?? 0` (`ManualReviewList.tsx:509`) | `DELETE FROM persona_manual_reviews` — unscoped |

Two of the three are honest by accident (a server total happens to equal an
unscoped delete). The third is wrong in **both** directions at once: it
under-reports when a category filter is active, and it over-promises by naming
memories the predicate spares. All three interpolate into the same i18n string
shape (`overview.*.delete_all_confirm_body` = *"This permanently deletes all
{count} X. This cannot be undone."*), copied three times.

*(Already recorded, from the confirm's side, by
[`delete-semantics`](./delete-semantics.md) §5 and
[`aggregate-count-display`](./aggregate-count-display.md) D1. What is new here
is the third measurement: the `core` tier that the predicate exists to protect
is **empty**, so the divergence between promise and effect is not
hypothetical — it is 100% of the table either way.)*

### D2 · Three whole-table wipes return nothing at all

Five functions in `src-tauri/db/src/repos/**` execute a `DELETE FROM <table>`
with no `WHERE` clause. Three of them return `Result<(), AppError>`:

| function | table | return |
| --- | --- | --- |
| `alert_rules::clear_fired_alerts` (`:305`) | `fired_alerts` | `Result<()>` ❌ |
| `frontend_crashes::clear_all` (`:91`) | `frontend_crashes` | `Result<()>` ❌ |
| `cloud_webhook_watermarks::prune` (`:50`) | `cloud_webhook_watermarks` | `Result<()>` ❌ |
| `manual_reviews::delete_all` (`:243`) | `persona_manual_reviews` | `Result<usize>` ✅ |
| `messages::delete_all` (`:501`) | `persona_messages` | `Result<usize>` ✅ |

`conn.execute` returns the affected-row count in every case; three of the five
discard it at the point it is produced. The consequence at the surface:
`CrashLogsSection` deleted 84 crash records with no confirm, no count in the
button, and no count in the outcome — the only feedback is that the list
becomes empty.

This is the census rule in §9, and the split above is its positive control.

### D3 · A function named `prune` wipes the whole table when its input is empty

```rust
// repos/resources/cloud_webhook_watermarks.rs:50-58
pub fn prune(pool: &DbPool, active_ids: &[&str]) -> Result<(), AppError> {
    …
    if active_ids.is_empty() {
        let conn = pool.get()?;
        conn.execute("DELETE FROM cloud_webhook_watermarks", [])?;
        return Ok(());
    }
```

The empty-set branch is arguably correct in the intended case (*"keeps only rows
whose trigger_id is in `active_ids`"* — no active triggers means no watermarks).
It is wrong in the case that actually happens on a bad day: the caller's
enumeration of active triggers failing, returning empty, and this function
reading that as *"delete everything"*. A read failure resolving to an empty
value and then driving a delete is
[`partial-failure-read-envelope`](./partial-failure-read-envelope.md)'s exact
finding, arriving at a destructive door. Registered as deferred-fix **#123**;
not applied (it changes what a live function does).

### D4 · Two rendered `clear_*` controls have no confirmation, and one has a side effect the button does not name

- `CrashLogsSection.tsx:80-92` — one click clears **three** stores in one
  handler: `clearCrashLogs()`, `clearFrontendCrashes()` and
  `localStorage.removeItem(CRASH_STORAGE_KEY)`. No confirm. The visible count
  (`totalCount`, `:78`) is computed from the deduplicated union of all three, so
  the number the user sees is correct — and it is on the header badge, not on
  the button, and not in any dialog.
- `WebhookRequestInspector.tsx:215-224` — `clearWebhookRequestLogs(triggerId)`,
  no confirm. Correctly **scoped** to one trigger, which is why it ranks below
  the previous one.

Both swallow their failure through `silentCatch`, so a clear that fails leaves
the list rendered and says nothing. For a control whose only feedback is "the
list became empty", a failure is indistinguishable from a table that was already
empty.

### D5 · Three doors nobody can press

`cleanup_dead_trigger_events`, `clear_fired_alerts` and
`reset_quality_gate_config` are registered in `lib.rs`, present in
`commandNames.generated.ts`, and wrapped in `src/api/**` — with **zero** call
sites in `src/features/**`. `clear_fired_alerts` is one of the three
countless wipes in D2, so the app carries a registered, unauthenticated,
count-less whole-table delete that no surface reaches.

### D6 · `gc_stale_manual_reviews` is the best-behaved door in the group and is undiscoverable

`ManualReviewList.tsx:277-299`: an in-flight lock, a server-returned count, and
three distinct outcomes — *"{count} resolved"* / *"nothing to clear"* /
*"failed"* — each with its own toast and its own i18n key. It is the only
maintenance door in the app that distinguishes "did nothing" from "failed", and
the comment above it explains why the button exists at all (the same sweep runs
at startup; the button means the user need not restart). Its affordance is an
unlabelled icon button in a header action row.

### D7 · The seed doors are the exemplar, and they are the only double gate in the app

Five `seed_mock_*` commands. **5 of 5** are rendered behind
`import.meta.env.DEV &&` (`MessageList.tsx:279`, `ManualReviewList.tsx:367`,
`EventLogList.tsx:303`, `KnowledgeGraphDashboard.tsx:193`,
`CronAgentsPage.tsx:42`) **and** refuse server-side under
`#[cfg(not(debug_assertions))]` with an explicit
`AppError::Validation("… is only available in debug builds")`
(`commands/communication/messages.rs:144-149`,
`commands/design/reviews.rs:1696-1701` and `:1777-1782`,
`commands/execution/knowledge.rs:89-94`, `commands/core/memories.rs:1266-1270`).

Neither gate is load-bearing alone: the client gate is a bundle-time constant an
attacker cannot flip but a `--mode development` build can, and the server gate
is the one that actually holds. Together they mean **a release build cannot
seed, and a release build does not show a button that would fail.** That second
property — not shipping a control whose command will refuse — is the part most
dev affordances get wrong, and it is worth copying verbatim.

Two caveats measured: `seed_mock_memory` (`commands/core/memories.rs:1195`) has
no client wrapper at all, and `seed_mock_event` (`events.rs:334`) carries **no**
`#[cfg(not(debug_assertions))]` refusal — its client gate is the only gate. The
class is 4/5, not 5/5, on the server half.

### D8 · `prune_storage` is the model, and it is one screen away from the doors that need it

`StorageUsageSection.tsx` + `prune_storage`: the count comes from a **separate
server read** (`storageUsage()` → `report.prunableExecutions`), the confirm
interpolates that number (`:81`), the result renders `prunedExecutions`, and the
component's own docstring records that the backend additionally enforces *"a
dry-run default, a 24h floor, and a terminal-only allow-list"* — three
server-side safety properties that no client can disable.

Everything D1 and D2 need already exists, in this file, in this repo, in the
Settings pane. The deviation is that it did not travel: this is
[`entity-picker`](./entity-picker.md)'s *"a solved problem that did not cross a
component boundary"*, and the boundary here is between Settings and Overview.

---

## §9 — The rule

### Existing rules checked first

The four nearest existing rules were **run** and their sites intersected with
this one's at `file:line` — not at file level, and not against an intermediate
draft of the pattern:

| neighbour | rule | its sites | site overlap with `countless-table-wipe` |
| --- | --- | ---: | ---: |
| `retention-and-pruning.md` | `retention-delete-by-status-allowlist` | 3 | **0** |
| `repository-crud-surface.md` | `blind-identity-write` | 82 | **0** |
| `upsert.md` | `unverifiable-conflict-clause` | 71 | **0** |
| `query-latency-instrumentation.md` | `untimed-repo-query` | 245 | **0** |
| **total** | | **384 sites parsed** | **0/3, and 0/3 at file level too** |

The reasons are structural rather than lucky, which is what makes the zero
trustworthy: `retention-delete-by-status-allowlist` requires a `status IN (…)`
**and** a time-column `<` comparison in the same statement, so every one of its
sites has a `WHERE`; `blind-identity-write` requires `WHERE id = ?`;
`unverifiable-conflict-clause` matches `INSERT OR …`; and all three of this
rule's sites already go through `timed_query!`, so `untimed-repo-query` cannot
reach them. `unreconciled-selection-set` (`bulk-selection-actions.md`) is
client-side and was not run. **No existing rule reaches an unpredicated
`DELETE`.**

### Published: `countless-table-wipe`

**Signal, and the condition it is a proxy for.** The condition is *"a
maintenance door that cannot state its own blast radius"*. The proxy is the
narrowest observable form of it in this stack: a `pub fn` that executes
`DELETE FROM <table>` with **no predicate** and returns `Result<()>` — so the
row count SQLite already handed it is discarded at the point of production, and
no confirm, receipt, log line or undo downstream can recover it. An adopting
repo on another stack should re-derive its own proxy for the same condition
(the semantic core is *unpredicated destruction with a discarded count*, not the
`Result<()>` spelling).

```json
{
  "id": "countless-table-wipe",
  "goldenPath": "docs/concepts/golden-paths/maintenance-affordances.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "pub\\s+fn\\s+[A-Za-z_]\\w*(?:(?!\\bpub\\s+fn\\b)[^{]){0,240}->\\s*Result<\\s*\\(\\s*\\)\\s*,\\s*(?:personas_core::error::)?AppError\\s*>\\s*\\{(?:(?!\\bpub\\s+fn\\b)[\\s\\S]){0,1400}?\"DELETE\\s+FROM\\s+[A-Za-z_][A-Za-z0-9_]*\\s*\"",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A maintenance door that empties a whole table (DELETE FROM <t>, no WHERE) and returns Result<()> — it cannot tell its caller, the log, the confirm or an undo how many rows it destroyed."
  },
  "baseline": { "files": 3, "matches": 3 },
  "floor": 900
}
```

```json
{
  "id": "countless-table-wipe-positive-control",
  "goldenPath": "docs/concepts/golden-paths/maintenance-affordances.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "pub\\s+fn\\s+[A-Za-z_]\\w*(?:(?!\\bpub\\s+fn\\b)[^{]){0,240}->\\s*Result<\\s*(?:usize|u64|i64|u32)\\s*,\\s*(?:personas_core::error::)?AppError\\s*>\\s*\\{(?:(?!\\bpub\\s+fn\\b)[\\s\\S]){0,1400}?\"DELETE\\s+FROM\\s+[A-Za-z_][A-Za-z0-9_]*\\s*\"",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL: the compliant form — the same whole-table wipe returning the row count it destroyed."
  },
  "floor": 900
}
```

**Measured, 2026-08-17, 963 `.rs` files walked (floor 900):**

- violating **3 files / 3 matches** — `repos/communication/alert_rules.rs:305`,
  `repos/core/frontend_crashes.rs:91`,
  `repos/resources/cloud_webhook_watermarks.rs:50`.
- positive control **2 files / 2 matches** —
  `repos/communication/manual_reviews.rs:243`,
  `repos/communication/messages.rs:501`.
- **The control partitions the anchor.** 3 + 2 = 5 = every whole-table wipe in
  `src-tauri/db/src/repos/**`. There is no third bucket.

**Hand-verified precision: 3/3 (100%).** All three were opened and read in full
(§7 D2 and D3 quote two of them). No test fixture is among them.

**Two independent implementations, and the difference is explained rather than
averaged.** A bespoke walker with a brace-matched `#[cfg(test)]` stripper found
**6 files / 6 unpredicated wipes** across `src-tauri`; the census found **9 files
/ 10** for the same unpredicated-delete pattern. The four extra are all inside
`#[cfg(test)]` modules (`engine/db_query.rs:3082,3256` — string literals inside
`assert!`; `repos/communication/sla.rs:1664` and
`commands/core/data_portability.rs:12467` — fixture resets), which the census
engine has no facility to strip. Rather than baseline a 60%-precision rule or
add file-level excludes that would also hide production code in the same files,
the pattern was narrowed to the `pub fn … -> Result<()>` frame, which **excludes
every test site structurally** and lands both implementations on the same
five-site population: bespoke 6 = 3 (`Result<()>`) + 2 (`Result<usize>`) + 1
migration DDL batch (`migrations/incremental.rs:4498`, `DELETE FROM
skill_scan_state` inside a `ddl_step` string — not a `pub fn`, correctly outside
both rules).

**How it fails loudly.** The runner fails on a walk under `floor` (900 against
963 real files), on zero matches anywhere, on a stale `exclude` (there are none),
on a rise, and on a **silent drop** — which matters here because the population
is 5: a matcher regression would otherwise look like three fixes.

**What it does not catch, stated so a reader does not over-trust it:** a
`clear_*` command that returns a count and still shows no confirm (D4), a
confirm whose number is computed client-side (D1), and a predicated delete whose
predicate is wrong. Those are absences and client-side shapes; the census can
express none of them.

### Declined alongside it: a client-side confirm-coverage gate

Candidate: a destructive client call with no confirm token in the same file.
[`delete-semantics`](./delete-semantics.md) already measured the population —
**98 of 144 delete-API call sites in files containing no confirm token at all,
52 of them in UI** — and published **no rule**, correctly: the population is
~68% of all call sites, and "a confirm token somewhere in the file" is a
proximity heuristic, not a structural relationship. Adding a rule here would
duplicate that path's evidence at worse precision. Declined, and noted so the
next composer does not re-derive it.

---

## §12 — Corrections

### 12.1 · To this composer's brief

> *"the delete-all implementation is documented as preserving a core tier —
> verify"*

**Verified in the code and refuted in the data.** The predicate is real
(`repos/core/memories.rs:1055`), the nine-line comment above it is accurate, and
`test_delete_all_preserves_core_tier` (`:2839`) proves it. And *(backup)*
`persona_memories.tier` holds `active` 3,132, `working` 2,026, `archive` 1,377,
**`core` 0**. The preservation clause has never protected a row on this install,
so `delete_all_memories` and an unpredicated `DELETE FROM persona_memories` were
observationally identical for the whole life of the feature. The clause is still
right — the finding is that a preservation guarantee nobody exercises is
indistinguishable from its absence until the day it matters, which is an
argument for the *confirm* naming it, not against the predicate.

> *"A confirm dialog whose text does not name the count is the common defect."*

**Not the defect here.** 3 of 3 `delete_all_*` confirms interpolate a count.
The measured defect is one level in: **the count is right in two and wrong in
one**, and being right is an accident of `messagesTotal` and
`reviewQueue.counts.total` happening to describe unscoped deletes. Not one of
the three derives its number from the predicate that will run. The sharper rule
is not *"name a count"* but *"name the count the server will produce"* — §2(1).

> *"is it reachable by accident"*

**Yes, twice, and not where the brief expected.** The three `delete_all_*`
doors — the loudest and widest — are all confirm-gated. The two unguarded
one-click wipes are the quiet ones: `CrashLogsSection` (three stores, one
handler, 84 rows) and `WebhookRequestInspector` (scoped, so lower risk). The
danger ranked inversely to the label.

### 12.2 · To this composer's own inventory

Implementation A (`src/api/**` invoke sites) returned **21** against B and C's
**22**, and the honest reading is not "A is close enough". A's recall is bounded
by the repo's own convention that every command gets an `src/api` wrapper;
`clear_pending_oauth` violates it (`stores/authStore.ts:65,74`, raw `invoke`),
so the one door the client-side inventory could not see is the one that is
unusual — the doctrine's *"the words you forget to list are disproportionately
the interesting ones"*, in its structural form. The inventory that is correct by
construction is B/C, because a Tauri command that is not in `generate_handler!`
does not exist.

### 12.3 · The spine labels

- `convergence: "mixed"` — **untested, and deliberately so.** With `risk: low`
  and a short-form budget, the oracle sweep was not run for this leaf; reporting
  an untested label as confirmed would be worse than reporting nothing. What
  *can* be said from measurements already taken for its two batch-mates: no
  sibling in the cohort has a `seed_mock_*` family with a double gate, and none
  has a `delete_all` confirm of any kind. That is a silence, not a convergence
  verdict, and it is offered as a lead for whoever tests this label properly.
- `sides: "client"` — **contradicted, incompletely.** The confirms, the DEV
  gates and the reachability findings are genuinely client-side, so unlike most
  contradictions in this corpus the label is not inverted. But the published
  rule, its control, D2, D3 and D5 are all server-side Rust, and the exemplar
  (`prune_storage`'s dry-run default, 24h floor and terminal-only allowlist)
  is server-side. `both` is the honest value — which the same spine object
  already asserts via `twoSided: true`.

### 12.4 · To [`delete-semantics.md`](./delete-semantics.md) §7 — an extension, not a correction

That path names the three `delete_all_*` confirms as *"the same `ConfirmDialog`
+ interpolated-count shape, copied three times, for the three widest-blast
actions in the app"* and proposes one shared `useDeleteAllConfirm`. Both claims
hold. Two additions from this leaf's angle:

1. The three are **not** the three widest-blast actions. `clear_fired_alerts`,
   `frontend_crashes::clear_all` and `cloud_webhook_watermarks::prune` are also
   unpredicated whole-table deletes, and unlike the three named ones they return
   no count and (for the two that are rendered) have no confirm at all. The
   widest-blast *group* is five, not three.
2. A shared `useDeleteAllConfirm` would standardise the copy and **not** fix D1,
   because the defect is the count's *provenance*, not its formatting. The
   extraction is worth doing and its signature is the load-bearing part: it must
   take a server-computed count, not a `number`.
