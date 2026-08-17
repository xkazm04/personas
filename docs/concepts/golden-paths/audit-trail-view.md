# Golden path — Audit trail: recorded and read back

> **Topic path:** `product-surfaces` › `monitoring-surfaces` › `audit-trail-view`
> [situation spine](../situation-spine.md) · recurrence **23** · risk **medium** ·
> sides: **client** (the spine also carries `twoSided: true` **and**
> `fusedAcrossSides: true` in the same node — see [§12.1](#12-corrections-to-the-brief)) ·
> convergence: **mixed** · dimensions: **ui · security · function**
> `mergedFrom`: *Run history log* + *Entity audit trail view* + *Settings change audit* +
> *Audit logging a sensitive command*
> Composed 2026-08-16 against `master` @ `2a874e692`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` under `src/` and all **963** `.rs` under
> `src-tauri/` walked by the census engine; the Rust half walked **twice more** by a second,
> independently-written implementation. Every table in the operator's live schema was
> enumerated (**244** in `personas.db`, **71** in `personas_data.db`) and the **27** whose
> name or shape makes them a recorded history were counted and profiled. Twelve audit-ish
> surfaces were read in full (`AuditLogTable`, `ExecutionsTab`, `SettingsHistoryTab`,
> `ApiKeyAuditDrawer`, `ByomAuditLog`, `EventLogList` + `useEventLog`, `ActivityModals`,
> `ReviewDetailPanel`, `AutoResolvedBadge` + `reviewHelpers`, `PersonaChangeHistory`,
> `GitOpsVersionHistory`, `DataDiffSection`), together with their Rust read paths
> (`audit_log.rs`, `settings_audit_log.rs`, `api_key_audit.rs`, `provider_audit.rs`,
> `tool_audit_log.rs`, `healing.rs`, `persona_change_log.rs`, `fleet_decisions.rs`,
> `team_assignments.rs`, `change_journal.rs`) and their **writers**
> (`subscription.rs`, `manual_reviews.rs`, `dispatch.rs`, `bus.rs`, `settings.rs`).
> All **44** committed census rules rooted in `src-tauri` were re-run to measure overlap;
> all 44 reproduced their committed baselines exactly.
>
> **Measured by execution, not by reading.** Read-only **copies** of the operator's live
> `personas.db` (347 MB) and `personas_data.db` (17.5 MB) were taken 2026-08-16 22:20 UTC
> with the app running; the live files were never opened for write and **the copies were
> deleted at the end of composition**. Three things were then replayed verbatim against
> those rows: `detectAutoResolution`'s two regexes over all **194** manual reviews;
> `EventLogList`'s persona-column resolution (`raw.slice('persona:'.length)` → `getPersona`)
> over all **4,972** `persona_events`; and `AuditLogTable`'s detail-cell expression over all
> **9,803** `credential_audit_log` rows. **§0 publishes what the view says beside what the
> record says.** `cargo` was not run. No secret value, prefix or partial appears anywhere in
> this document.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It produced this document's sharpest
> negative result (§6 clause 2), **inverted one clause of the brief** (§12.4), and confirmed
> that two of this repo's audit habits are ahead of the whole fleet.
>
> **Settles:** what a read-only history surface may claim, where the actor comes from, what
> renders when the actor / timestamp / token is missing, and whether the order you see is
> the order it happened.
>
> Cross-reference, not overlap. [`aggregate-count-display`](./aggregate-count-display.md)
> owns *what a rendered number counts* — its §0 delete-confirmation (100 shown, 6,535
> destroyed) is **cited, never re-derived**.
> [`selective-per-item-verdicts`](./selective-per-item-verdicts.md) owns the **verdict
> being made**; this path owns the **record of it being read back**.
> [`timestamp-display`](./timestamp-display.md) owns *how* a time is formatted; this owns
> whether one is shown at all.

---

## 0. The headline

**Of the 194 human-review decisions on this install, 168 (86.6%) were made by a machine —
and every surface in the app renders them as a human's.** The badge built specifically to
stop that, whose docstring says *"so the silent bypass of the human queue is no longer
invisible in the UI"*, fires on **0 of the 168**.

The whole failure is four lines apart. The writer, `src-tauri/src/engine/subscription.rs:2041,2045`:

```rust
"[auto-triaged — high-severity technical-status item: matched the safe-technical allowlist …]"
"[auto-triaged — unattended review policy: routine (low/medium) severity auto-approved; …]"
```

The reader, `src/features/overview/sub_manual-review/libs/reviewHelpers.ts:79-80`:

```ts
if (/\btrust_llm\b/i.test(notes))  return { kind: 'trust_llm',  reasoning: null };
if (/\bauto_triage\b/i.test(notes)) { … }
```

`auto_triage` has an underscore. The writer emits `auto-triaged`. Replayed over the real
table:

| `reviewer_notes` family | rows | writer | `detectAutoResolution` verdict |
|---|---:|---|---|
| `[auto-triaged — unattended review policy: …]` | **142** | `subscription.rs:2045` | **null** — no badge |
| `Auto-resolved: stale > GC threshold` | **20** | `manual_reviews.rs:583` | **null** — no badge |
| `[auto-triaged — high-severity technical-status item: …]` | **6** | `subscription.rs:2041` | **null** — no badge |
| `Chose action: …` (a real human pick) | 21 | `dispatch_review_action` | null — correct |
| empty | 5 | — | null — correct |
| **rows a machine decided** | **168 / 194 (86.6%)** | | **0 detected** |

`persona_manual_reviews` has **no `resolved_by` column, no `resolver_kind`, no actor of any
kind** — so "who decided this" is not recorded at all, and the one surface that tries to
answer it infers the answer from a free-text field that a human is also allowed to type
into. The bit that establishes accountability is forgeable by the party it holds accountable.

> **Placed upstream 2026-08-17 by
> [ai-draft-preview-apply](./ai-draft-preview-apply.md).** This section reads the missing column
> as a *reader-side* defect. It is not — **no apply path in the repo has ever stamped an actor**,
> so there is nothing for the reader to read. Measured across the whole schema: **24 surfaces write
> a model-authored artifact and 4 record that a model wrote it.** `companion_approval` is a second
> store with the identical shape (120 rows, no actor column, `human_review_id` NULL on all 120,
> **65 of 106 resolved within 2 seconds**, median 0). The two tables that *did* add one column —
> `dev_ideas.model` at 214/236 and `workspace_knowledge.provenance` at **1,304 of 1,306** — answer
> the question completely. **Attribution has no primitive in this repo, and no backfill can
> recover it.**

### And the record the app learns from says the opposite of the record it stores

`manual_reviews::update_status` writes a team memory on every resolve
(`db/src/repos/communication/manual_reviews.rs:347`):

```rust
format!("Human {verdict} the review \"{}\"{}.{} Apply this decision to future work.", …)
```

`Human` is a hardcoded literal, and `reviewer_notes` is interpolated straight in. Live:
**236** human-review team memories, and **186 of them (78.8%) contain the string
`auto-triaged` inside a sentence that begins `"Human approved the review …"`.** The record
contradicts itself inside one string, and the memory row's `member_id` is `None`, so nothing
beside it disambiguates. ([`selective-per-item-verdicts` §12.4](./selective-per-item-verdicts.md)
established that this memory write is correct and load-bearing; what is new here is *whom it
names*.)

### "Who did it", measured across every audit surface in the app

| surface | table | live rows | how it answers *who* | verdict |
|---|---|---:|---|---|
| `EventLogList.tsx:198-217` | `persona_events` | 4,972 | slices a **slug** out of `source_type` and looks it up as a persona **id** | **0 of 4,166 resolve** |
| `AuditLogTable.tsx:106` | `credential_audit_log` | 9,803 | `personaName ? \`by ${personaName}\` : detail` | actor **replaces** the detail on 5,883 rows |
| `SettingsHistoryTab.tsx:207` | `settings_audit_log` | 15 | `{entry.actor && <badge>}` | **actor NULL on 14 of 15**; nothing rendered |
| `ApiKeyAuditDrawer.tsx:108-136` | `api_key_audit` | 1 | its own docstring promises a persona column | **never rendered** |
| `ByomAuditLog.tsx:56` | `provider_audit_log` | 4,001 | `entry.persona_name` — a **snapshot beside the id** | **correct, and rare** (§6 clause 1) |
| `ActivityModals.tsx:139` | `persona_manual_reviews` | 194 | free-text `reviewer_notes`, in italics, headed *"Reviewer notes"* | 168 machine notes shown as a reviewer's |
| `PersonaChangeHistory.tsx` | `persona_change_log` | **0** | `source` → a labelled chip | correct, and has never run |
| — | `fleet_decisions` | 46 | *(no surface exists)* | see D8 |

### The event log names its actor with a string that means seven different agents

`EventLogList.tsx:199-201` — the whole defect in three lines:

```ts
const personaId = raw.startsWith('persona:')
  ? raw.slice('persona:'.length)   // ← the SLUG
  : event.source_id;               // ← the real id, used only where it isn't needed
const persona = getPersona(personaId ?? null);   // personas.find(p => p.id === id)
```

Replayed against the live table:

| | value |
|---|---:|
| `persona_events` rows | **4,972** |
| …whose `source_type` starts with `persona:` | **4,166 (83.8%)** |
| …whose slug matches **any** persona id | **0** |
| …whose `source_id` **does** resolve to a live persona | **4,166 / 4,166 (100%)** |
| rows whose slug maps to **7 distinct persona ids** | **4,118 (82.8%)** |

`T: Solution Architect`, `T: Dev Clone`, `T: QA Guardian` and five more names each exist as
**seven** separate personas on this install. `engine/dispatch.rs:355-374` sanitises the
*name* into `source_type` (spaces → `_`, parentheses dropped, colons kept — so
`Dev Clone (3)` → `Dev_Clone_3` and `T: Dev Clone` → `T:_Dev_Clone`) while putting the real
id in `source_id` one field away. The view reaches past the id, fails the lookup on every
row, and falls into the branch that renders the slug **in `font-mono`** (`:212`) — styled
exactly like an unresolvable database id. A reader sees what looks like a precise identifier
and is looking at a label that is ambiguous seven ways.

### Then look at what the same rows say for *status*

**All 4,972 rows render a raw machine token** (`EventLogList.tsx:251`, and again in two
detail-modal subtitles at `:479` and `EventDetailModal.tsx:17`). Not because the label table
is short — because **nothing calls the resolver**: `tokenLabel(t, 'event', …)` has **zero
call sites in 4,829 files**, so `status_tokens.event` (5 keys × 14 locales = 70 translated
strings) is dead. And it would not have helped: the section's five arms are
`pending, processing, processed, failed, retrying`, of which **`processed` and `retrying`
are not `PersonaEventStatus` variants at all**, while the two statuses this install actually
holds — `delivered` (4,941) and `skipped` (31) — are **both absent**. Coverage would have
been **0 of 4,972**.

The contrast is inside the same feature and is the cleanest type-over-gate result in this
document. Colour and icon for the same field are `Record<PersonaEventStatus, …>`
(`lib/design/eventTokens.ts:111,134`) — **exhaustive by compile error, 8 of 8, with the
reason in the doc comment** (*"adding a new Rust variant is a compile error until this map
covers it"*). The **label** is a plain JSON object reached by a runtime `in` check with a
`?? token` fallback. Same concept, two channels, one type-linked and complete, one untyped
and 5/8 wrong — and the status **filter dropdown** built from the same untyped vocabulary
(`EventLogList.tsx:62-70`) offers `processed`, which cannot occur, and omits `delivered`,
which **99.4% of the rows have**.

### The compliance trail with no *when*

`ByomAuditLog.tsx` renders six columns for 4,001 provider-audit rows. Its header reads
*"Compliance trail showing which provider handled each execution"*. The sixth column is
labelled **`audit_time` = "Time"** (`en.json` → `settings.byom.audit_time`) and its cell is
`formatDuration(entry.duration_ms)` (`:63`) — **a duration**. `entry.created_at` exists on
every row, is `#[ts(export)]`ed into the binding, and is **rendered nowhere in the
component**. The compliance trail does not say when anything happened, and the column that
looks like it does is measuring something else.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path,
primitive name or count. Each clause names its warrant.

> **P1 — physics, and the one everything else follows from.** **An audit view may only
> render what the record contains.** The moment a surface computes an audit fact — who,
> when, whether it was automatic — from something that is not the field recording it, the
> view has become a second, unversioned writer whose output nobody reviews and whose
> failures are silent by construction.
> *Warrant: measured here at 168 of 194 machine decisions rendered as human ones, by a
> two-regex inference over a free-text notes column; independently reinvented in a sibling
> repo, which regex-classifies a free-text rejection reason into categories and renders them
> as labelled percentage bars with no disclosure that they were inferred.*
>
> **P2 — physics.** **Identity is a foreign key; a display name is a caption.** Record the
> stable id, and if you also want the name it had at the time, record **both**. A name is
> not unique, is not stable, and — once slugified for transport — is not even reversible.
> *Warrant: executed here — 4,118 of 4,972 rows name their actor with a string that maps to
> seven different agents, while the correct id sits in the adjacent column and resolves
> 100% of the time. Independently: **0 of 5 sibling repos store both**, and the one that
> stores only a mutable handle documents that a rename silently rewrites its history.*
>
> **P3 — physics, and the most replicated.** **"Unknown actor" is a value, not an absence.**
> A trail whose attribution element simply disappears when the field is null cannot be read:
> *unattributed*, *system-initiated* and *this row type has no actor* become the same pixels,
> and the reader has no way to ask which.
> *Warrant: **3 of 3** sibling surfaces that render an actor render an explicit null state —
> `"—"`, `"system"`, `"policy (auto)"` — and **not one lets the element vanish**. This repo
> lets it vanish, on a table whose actor is NULL on 14 of 15 rows.*
>
> **P4 — physics.** **A recorded time is part of the record.** A history row without a
> rendered timestamp is not a history row; and a column labelled with a time-word that
> carries something else is worse than an absent one, because it stops the reader looking.
> *Warrant: measured here on a 4,001-row surface whose header says "compliance trail", whose
> "Time" column holds a duration, and which never renders `created_at` at all.*
>
> **P5 — physics.** **The order must be determined by the data, not by the query plan.** A
> clock is not a key. If two records can share a timestamp — and at second granularity they
> routinely do — the read needs a unique tiebreaker, or the sequence you show is an artifact.
> *Warrant: measured here at 2,287 tie groups over 7,431 of 8,486 rows in one table, read
> back with no tiebreaker by the query the UI calls — while two other reads of the same
> table, in the same file, have one. Independently: 2 of 4 siblings add the tiebreaker and
> one wrote down why ("`at` alone isn't unique, so the id tie-breaker guarantees a stable,
> gap-free page boundary"); the other two do not, so this is a *minority answer to a
> universal condition*, not a house convention.*
>
> **P6 — physics.** **A vocabulary rendered to a human needs a total function.** Every
> action, operation and status a writer can emit must have a label, and the label table must
> be *linked to the writer's type* — not maintained beside it. An untyped label map drifts to
> exactly the values nobody thought of, which are the interesting ones.
> *Warrant: measured here three times — an operation map with 5 arms against a live
> vocabulary of 10; a status label section with 5 arms against an 8-variant enum, two of
> which are not variants and none of which covers the 99.4% case; and, in the same feature, a
> colour map typed `Record<Enum, …>` that is 8 of 8 correct. Independently: **3 of 3**
> siblings use `map[x] ?? x`, and the map is **narrower than the writer's vocabulary in 2 of
> 3** — one at 12 arms against ~24 emitted actions.*
>
> **P7 — ergonomics with teeth.** **A trail that is capped, filtered or trimmed must say so
> on the pixel.** "Newest 50" and "all of them" are different claims, and a reader auditing
> something needs to know which one they are looking at before they conclude an event did not
> happen.
> *Warrant: the sibling that discloses best renders `showing 1–50 of 1,204`; the one that
> discloses worst truncates twice (a SQL `LIMIT` and a `.slice(0, 20)`) and then labels the
> result with a count of the already-truncated array. Here: an audit tab labelled with the
> page size (500) sits beside a tile holding the true total (3,813) in the same component.
> Owned by [`aggregate-count-display`](./aggregate-count-display.md) — cited, not re-derived.*
>
> **P8 — physics, on the write side.** **A privileged action that proceeds without its audit
> row must count the gap.** Availability over auditability is a legitimate choice; making it
> silently is not.
> *Warrant: this repo has the best answer in the six-codebase cohort and it is one function —
> a failed credential-audit insert increments a process-wide counter surfaced on the vault
> status. The only comparable sibling makes the failure impossible instead, by writing the
> audit row on the same connection as the change it records. Two siblings trade the trail for
> latency with no counter.*
>
> **Scale condition.** P1, P2, P3, P4 and P6 are wrong on day one, at one row. P5 becomes
> observable the first time two records share a second — which, at machine write rates, is
> immediately. P7 bites at the first page boundary. P8 bites the first time a write fails,
> which is the one moment you needed the trail.

---

## 1. Trigger

- "Show the history for this thing." / "Add an activity feed." / "We need an audit log."
- "Who changed this setting?" / "Who approved that?" / "Was that me or the agent?"
- "Add a timeline to the detail panel."
- "Why is this row above that one — they happened the other way round."
- "It says the reviewer approved it, but I never saw it."
- "The log is empty, but I know it ran."

**If you are about to write** a `SELECT … ORDER BY created_at DESC LIMIT ?` over a table you
never `UPDATE`; a component that maps over rows and renders *what happened* + *who* + *when*;
a `Record<string, {label}>` for an action/operation/status token; `{row.actor && …}`; a
`.test()`, `.includes()` or `.match()` against a stored free-text column in order to decide a
**fact** about the row; or a column named `*_log`, `*_history`, `*_audit`, `*_events`,
`*_journal` — **you are in this situation.**

You are **not** in it for a live stream of a process still running
([`live-log-stream-view`](./live-log-stream-view.md)), for the queue where a decision is
*taken* ([`human-review-queue`](./human-review-queue.md)), or for the mechanics of paging a
list ([`paginated-list-query`](./paginated-list-query.md)). The discriminator is that this
surface is **read-only over rows nobody will edit**, which is exactly why the hazard is
fidelity rather than safety.

### Boundaries with the adjacent leaves

| Territory | Owner | Do not restate |
|---|---|---|
| What a rendered **number** counts — badges, `N of M`, a destructive confirm's count | [`aggregate-count-display`](./aggregate-count-display.md) | It owns §0's *"delete 100"/6,535 destroyed*. This path cites it for D3's `Audit Log (500)` beside a `3,813` tile and adds nothing. |
| The **verdict being made** — per-item maps, the collapse rule, the commit signature | [`selective-per-item-verdicts`](./selective-per-item-verdicts.md) | It owns `ReviewDetailPanel.tsx:319-336`'s `"Decisions:\n+ label"` flatten and the measurement that it yielded **0 durable verdicts in 47 batches**. **This path owns what an audit surface does with that string afterwards** — see D1. |
| The **queue**, the CAS, `rowWrites`, the resume seam | [`human-review-queue`](./human-review-queue.md) | The write door is correct; this path never re-litigates it. |
| **How** a timestamp is formatted, locale, relative-vs-absolute | [`timestamp-display`](./timestamp-display.md) (rules `host-locale-date-render`, `english-elapsed-label`) | It owns the format. This owns whether the row has one and whether the header names it honestly (D4). |
| Which **shape** a timestamp is stored in, UTC-naive vs RFC3339 | [`timestamp-storage`](./timestamp-storage.md) | This path uses the storage shape only as the *reason* P5's ties exist. |
| Whether the trail is **trimmed**, and by what | [`retention-and-pruning`](./retention-and-pruning.md) | It owns the sweep. This owns whether the view discloses the cap. |
| The label vocabulary for a status/severity token | [`status-and-severity-badges`](./status-and-severity-badges.md) (rule `untranslatable-token-label`, 38 files) | It owns *"a token reached the DOM untranslated"*. This owns the narrower question of a label map **narrower than its writer's vocabulary** — a superset condition it does not measure. |
| Whether the audit **write** can be forged or skipped by an unauthorised caller | [`ipc-command-authorization`](./ipc-command-authorization.md) · [`ownership-verification`](./ownership-verification.md) | `#[requires(privileged)]` on the audit read commands is theirs. |
| Whether a stored blob can be parsed back at all | [`json-blob-column`](./json-blob-column.md) | Its wall — *no type reaches inside a `TEXT` column* — is why D1 exists. |

---

## 2. The one way

**Decide what the row will say about *who*, *when* and *what happened* before you write the
first `INSERT`, put all three in columns, and let the view render columns and nothing else.**
Concretely: (a) **record the actor as a stable id, and — if the surface will show a name —
record the display name it had at the time, in a second column**; `provider_audit_log`
(`persona_id` + `persona_name`) and `credential_audit_log` (`persona_id` + `persona_name`) are
the shape, and no sibling repo in the cohort has it. (b) **Give the actor a total rendering**:
`id` present → the entity; `id` absent → an explicit `System` / `—` / `Automatic`, never a
vanished element; and if the same trail carries both human and machine rows, give it a
**`kind`** column (`human | policy | schedule | migration`) rather than making the reader
infer it. (c) **Never derive an audit fact from a free-text field** — not the actor, not
whether it was automatic, not the category. If you find yourself writing a regex against a
`notes`/`rationale`/`detail` column in order to decide something, the thing you are deciding
needs a column. (d) **Render the recorded time on every row**, relative with the absolute in
`title=` (`SettingsHistoryTab.tsx:212-217` is the pattern), and **never label a column with a
time-word unless it holds a time**. (e) **Order by the clock and then by the primary key**,
and page with a keyset cursor over that composite — `team_assignments.rs:392` is the reference;
a clock is not a key and `datetime('now')` is a second. **Qualified 2026-08-17 by
[findings-triage-queue](./findings-triage-queue.md): …for a HISTORY. A queue a human works
through ranks by NEED first.** That path's positive control certifies
`dev_tools.rs:3841` — `ORDER BY created_at DESC, id DESC LIMIT` — which is `triage_ideas`, the
flagship findings queue in this repo, **54 deep with a 131-day tail** while `impact` is populated
on 236 of 236 rows. Correct by this clause and wrong for its purpose: following both paths
naively makes a stale queue *tidier*. (f) **Type the label map against the
writer's enum** so a new variant is a compile error, the way `EVENT_STATUS_COLORS` is
`Record<PersonaEventStatus, …>`; if the label lives in the i18n catalog and cannot be typed,
add the catalog-vs-enum check as a test, and **never build a filter dropdown from a
hand-written list** — build it from the same total map. (g) **Say what the view is showing**:
"newest 50", "since Monday", "this credential only". A cap the reader cannot see turns
"nothing happened" and "nothing loaded" into one sentence. (h) **Write the audit row through
one chokepoint that sanitizes and counts its own failures** — `db/src/repos/resources/audit_log.rs:22-51`
is the model and its comment is the doctrine. (i) **Keep the trail append-only in code, not
just in intent**: no `update_*`/`delete_*` functions in the repo module (both audit repos say
so in a header comment), and if retention trims it, the view must disclose the cap. Then
stop: do not add a second free-text channel, do not infer, and do not render a column the
record cannot fill.

If you must get one right first: **(c)**. (a), (b) and (f) are schema and typing work that
pays off over months; (c) is the one that makes a surface actively lie today, and §0 is what
that costs.

---

## 3. Mandated primitives

**Exist today — use them.**

| primitive | what it gives you |
|---|---|
| `src-tauri/db/src/repos/resources/audit_log.rs:22-51` — `insert` | **The write chokepoint to copy, and the best audit-write in a six-codebase cohort.** One entry point for every credential audit write; `sanitize_secrets` on `detail` before persistence; and on failure it increments a process-wide `credential_audit_write_failures` counter surfaced on `vault_status`, so *"a decrypt can never occur with a silently-missing audit trail — callers stay free to treat the returned error as non-blocking (availability over auditability), but the gap is COUNTED and surfaced"*. Copy the comment as much as the function. |
| `.../audit_log.rs:9-11` and `.../settings_audit_log.rs:28-30` — the header `// Insert (append-only -- no update or delete functions)` | **Append-only enforced by module surface**, not by convention. There is no `update` and no `delete` to call. |
| `src-tauri/db/src/repos/core/settings.rs:11-56` — `audit_setting_change` | **Audit at the repo layer, not the command layer**, *"so INTERNAL Rust callers (engine subscriptions, companion ticks that flip a toggle, the management HTTP API) are audited too — not only the Tauri command surface"*, with a documented no-op list, a no-op on unchanged values, and a **structural** `[redacted]` for the `api_keys` category on top of the pattern-based sanitizer. `:50-53` also writes down *why* `actor` is `None` — the clearest honest-gap comment in this territory. |
| `src-tauri/db/src/repos/orchestration/team_assignments.rs:388-393` | **The ordering reference.** `ORDER BY e.created_at ASC, e.id ASC` behind the keyset predicate `(e.created_at > ?2 OR (e.created_at = ?2 AND e.id > ?3))` — the only paging form in the repo that cannot skip or repeat a row across a timestamp tie. |
| `src-tauri/db/src/repos/execution/change_journal.rs:215-216` | **`ORDER BY id DESC` over an `INTEGER PRIMARY KEY`** — the trail whose order cannot be ambiguous because the sort key is the sequence. 216 of its 221 live rows share a `created_at` with another row and it does not matter. |
| `src-tauri/db/src/repos/resources/persona_change_log.rs:1-31` | **The field-level diff writer**: one row per changed field, computed from the already-loaded `existing` row (no extra SELECT), secret-bearing fields stored as `"(changed)"`, same-field edits inside 30 s **coalesced** into the prior row, and a per-entity retention cap. Wrapped in the same transaction as the `UPDATE` (`repos/core/personas.rs:1176-1191`). Read this before writing any new change trail. |
| `src/features/settings/sub_history/components/SettingsHistoryTab.tsx` | **The view to copy.** Module-scoped session cache keyed by filter; ghosts only into genuine emptiness (`loading && entries === null`); `RevealItem` + `useRevealTracker` cascade; expandable before/after `<pre>` blocks; a `categoryLabel()` that **humanises an unknown token instead of printing snake_case**; relative time with `title={formatTimestamp(...)}`; and a `showing_max` notice when the page is full. Its one defect is D5. |
| `src/features/vault/shared/playground/tabs/ExecutionsTab.tsx:70-82` | **The compliant actor/detail row** — and the direct A/B against D3, over the *same table*: it renders the persona **and** the detail joined by `·`, an explicit italic `--` when both are absent, and a timestamp per row. |
| `src/features/agents/sub_editor/components/PersonaChangeHistory.tsx:53-62` | **Three total functions in nine lines**: `fieldLabel` falls back to the raw field, `sourceLabel` falls back through `map.other` to `'other'`, `displayValue` renders `labels.empty_value` for `null` **or** `''`. This is P3 and P6 done correctly, in the one surface that has never had a row to render. |
| `src/lib/design/eventTokens.ts:107-143` | **The typed token map**: `Record<PersonaEventStatus, …>` for colour and for icon, *"typed against the generated `PersonaEventStatus` binding so adding a new Rust variant is a compile error until this map covers it"*, plus a dev-only `console.warn` naming the file to edit. Do this for the **label** too. |
| `src/features/shared/components/display/UnifiedTable.tsx` + `display/RelativeTime` + `display/RevealItem` | The list body, the timestamp and the row cascade. `EventLogList` composes all three correctly; the defects there are all in the cell contents. |

**Do NOT build:** a second inference over a notes column; a `by {name}` cell that replaces the
detail; a filter dropdown hand-listed beside a token map; an audit table without an actor
column *and* a surface that pretends there is one; a history read ordered by a clock alone;
a `*_audit_log` table with no reader.

---

## 4. Steps

1. **Write the row shape before the surface.** Name the four fields out loud: *what happened*
   (a closed token), *to what* (an id), *by whom* (an id + a name snapshot + a kind), *when*
   (one timestamp, one shape). If any of the four is "we'll put it in the notes", stop.
2. **Give the actor a `kind`.** `human | policy | schedule | migration | unknown`. This is
   the column §0 is missing, and it is the difference between a trail you can audit and one
   you can only read.
3. **Write through one chokepoint** that sanitizes, and **count its failures**
   (`audit_log.rs:22-51`). Put the write in the same transaction as the thing it records if
   the store allows it — `repos/core/personas.rs:1176-1191` does.
4. **Ask whether the type can make the wrong render impossible — before you write the gate.**
   Here it can, for the token half; see below.
5. **Read it back ordered by `(clock, primary key)`**, and page with a keyset cursor over
   that pair. Never by the clock alone.
6. **Render every column the record has, and nothing it doesn't.** If the actor is null,
   render the null state; if there is no actor column, do not put an actor heading on the
   panel.
7. **Resolve every token through a total map keyed off the writer's type**, and build the
   filter options from that same map so the dropdown cannot offer a value that cannot occur
   or omit one that dominates.
8. **Show the scope.** "Newest 50 of 4,001", "this credential", "last 7 days" — per
   [`aggregate-count-display`](./aggregate-count-display.md) §2(g).
9. **Never infer.** If the surface needs a fact the row does not carry, add the column and
   backfill `unknown`; do not regex the prose. Search your own diff for `.test(`, `.match(`,
   `.includes(` against a `notes`/`reason`/`detail`/`rationale` field.
10. **And then stop.** No second trail for the same events, no derived badge, no free-text
    channel "for now".

### Can the type make the wrong call impossible? — asked before §9

**Split answer. YES for the token half, in one edit that is already proven in this repo
15 lines away. NO for the actor half, and the reason is instructive.**

**T1 — the token map. Yes, and it is a copy-paste.** The bad state is *a value the writer can
emit that the reader has no label for*. `lib/design/eventTokens.ts:111` already solves it for
the same field:

```ts
export const EVENT_STATUS_COLORS: Record<PersonaEventStatus, EventStatusColor> = { … }; // 8/8
```

The label lives instead in `en.json` → `status_tokens.event`, reached by
`tokenLabel(t, category, token)` whose signature is `(…, token: string)`. **`string` is the
defect**: it accepts every value including the five that are wrong. Two edits close it —
type the resolver per category (`tokenLabel(t, 'event', s: PersonaEventStatus)`), and add a
structural test asserting `Object.keys(en.status_tokens.event)` equals the binding's union.
Held against the seven qualifications:

- **Q1 (a type carries only what it encodes).** It encodes *"this token is a member of the
  writer's enum"*. It does **not** encode that the label is good, or translated, or short
  enough for the badge. Those stay §2(f)'s problem.
- **Q2 (requiredness ≠ closedness).** Making `token` required changes nothing — it already is.
  **Closedness is the entire win**, and this is the same shape
  [`scheduled-trigger-firing`](./scheduled-trigger-firing.md) earned on `Option<Tz>`.
- **Q3 (a type nobody constructs constrains nothing).** **Survives, and it decides the
  scope.** `PersonaEventStatus` is constructed by ts-rs on every event payload and consumed at
  three render sites; the map that would be typed is 3 lines from one that already is. This is
  *"route the second consumer"*, not *"invent a type"*. It does **not** generalise to all ten
  `tokenMaps` categories in one edit — `execution`, `severity` and `rotation` have working
  call sites and different enums, and forcing them all at once is a refactor.
- **Q4 (a type anyone can construct authenticates nothing).** Live and relevant: nothing stops
  a caller passing `String::from("processed")` on the Rust side. The type guarantees the
  *channel*, never that the writer only emits variants — which is why `from_db`'s
  unknown-value arm (`core/src/models/event.rs:47-53`) logs rather than silently defaulting.
- **Q5/Q6 (withhold the dangerous freedom, not the answer).** The dangerous freedom is
  **`token: string`**. The answer the feature needs is *"render this row's status"*, and that
  survives.
- **Q7 (relaxing a requirement is inert where the caller supplies the bad value
  voluntarily).** Sharpest here, and it is why the type is **necessary and not sufficient**:
  the three live render sites do not call `tokenLabel` **at all**. Typing the resolver does
  not reach a caller who never reaches the resolver. **Both edits or neither** — type the
  door *and* route the three sites through it.

**T2 — the actor. NO, and the honest answer is a column, not a type.** The bad state is *the
view answers "who" from something that is not the record of who*. No client-side type reaches
it, for three separate reasons, all measured:

- `persona_manual_reviews` **has no actor column at all**, so there is nothing to make
  required. Requiredness is orthogonal to a field that does not exist (Q2 from the other
  side).
- `persona_events.source_type` is a `TEXT` column holding `persona:<slugified name>`. Doctrine
  §1 item 1 — *inside a SQL string literal* — and
  [`selective-per-item-verdicts`](./selective-per-item-verdicts.md)'s fourth member — *inside
  a serialized blob* — both apply: the id and the name are **fused into one string by
  `format!`** at `dispatch.rs:309,374`, and no type on either side of the wire can
  un-fuse them.
- The one place a type *would* help — `getPersona(id: string)` accepting a slug — is Q4
  exactly: a newtype `PersonaId(String)` with a public field is a comment, and the caller
  would construct one from the slug without noticing.

**The fix is `source_id`, which is already there and already correct on 4,166 of 4,166 rows.**
That is a two-line client change, not a type. And the general lesson for this leaf:
**a type can close the vocabulary you render; it cannot supply an identity nobody recorded.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Deciding an audit fact by regex over a stored free-text field** | The inference and the writer drift and nothing fails. Executed: `/\bauto_triage\b/` vs a writer emitting `auto-triaged` — **0 of 168 machine decisions detected**, on a badge built to expose exactly those. §7 D1. |
| **Putting the actor's *name* on the wire instead of its id** | Names are not unique and slugs are not reversible. Executed: **4,118 of 4,972 rows (82.8%)** carry a slug that maps to **7 distinct personas**, while the id in the next column resolves 100%. §7 D2. |
| **Rendering the actor inside a truthiness guard** | *Unattributed*, *system*, and *this row has no actor* become one absence. `SettingsHistoryTab.tsx:207` — actor NULL on **14 of 15** live rows; `GitOpsVersionHistory.tsx:297` does it to the actor **and** the timestamp on the same line. §7 D5. |
| **A cell that shows the actor *or* the detail** | `personaName ? \`by ${name}\` : detail` — the column header says "Detail" and holds an actor on **5,883 of 9,803 rows (60.0%)**, a detail on 3,906, and neither on 14. No row shows both. §7 D3. |
| **A panel documenting a column it does not render** | `ApiKeyAuditDrawer`'s docstring promises *"method / path / status / persona / origin / time"*; `persona_id` appears nowhere in the JSX. The docstring is the spec a reviewer reads. §7 D6. |
| **A time-named column holding something that is not a time** | `audit_time = "Time"` over `formatDuration(duration_ms)`, on a 4,001-row surface headed *"Compliance trail"*, with `created_at` rendered nowhere. §7 D4. |
| **`ORDER BY <clock> … LIMIT` with no tiebreaker** | The sequence you show is an artifact of the plan. **141 such reads across 78 files**, including every dedicated audit table in the app; live tie rates up to **87.6%** of rows. §7 D7. |
| **A label map maintained beside a writer's enum rather than typed against it** | It drifts to the values nobody thought of. `status_tokens.event` has 5 arms; two (`processed`, `retrying`) are not variants; the two the install actually holds are absent — coverage **0 of 4,972**. Its colour sibling, typed `Record<PersonaEventStatus, …>`, is 8 of 8. §7 D2. |
| **A filter dropdown hand-listed beside the token map** | It offers values that cannot occur and omits the one that dominates. `EventLogList.tsx:62-70` offers `processed` (0 rows possible) and omits `delivered` (**99.4%** of rows). §7 D2. |
| **A history table with a writer and no reader** | It looks like accountability and is a `DELETE` waiting to happen. `fleet_decisions`: 46 rows, `recent()` documented *"for an observability surface"*, **zero callers, no Tauri command, no view** — and a component comment calls it *"the authoritative audit trail"*. §7 D8. |
| **Two writers for one concept in the same trail** | `credential_audit_log.operation` holds both `oauth_token_refreshed` (201) and `credential_oauth_refreshed` (1). Any filter, any count, any label map now needs both. §7 D9. |
| **An audit surface whose emptiness is indistinguishable from its absence** | `persona_change_log`, `deployment_history`, `tool_execution_audit_log`: **0 rows each**, correct writers, live views. Nothing tells the reader whether the feature never ran or the write path is broken. §7 D8. |
| **Interpolating a machine's own note into a sentence that begins "Human …"** | `manual_reviews.rs:347`. Live: **186 of 236** team memories say `"Human approved the review …"` and contain `auto-triaged`. §0. |

---

## 6. Evidence

**The ONE site to copy: `src-tauri/db/src/repos/resources/audit_log.rs:22-51`, together with
`src-tauri/db/src/repos/core/settings.rs:11-56`.** Between them they answer every write-side
question this leaf has, and they say why:

```rust
/// This is the single chokepoint for ALL credential audit writes (decrypt at
/// injection, healthcheck, CRUD ops). A failed write increments the
/// process-wide `credential_audit_write_failures` counter (see
/// `engine::crypto`) so a decrypt can never occur with a silently-missing
/// audit trail — callers stay free to treat the returned error as
/// non-blocking (availability over auditability), but the gap is COUNTED and
/// surfaced on `vault_status`.
pub fn insert(pool, credential_id, credential_name, operation,
              persona_id: Option<&str>, persona_name: Option<&str>, detail: Option<&str>)
```

Six things to copy: (1) **one chokepoint**, so there is one place to add a field;
(2) `sanitize_secrets(detail)` **before** persistence, so the trail cannot become a leak;
(3) **`persona_id` *and* `persona_name`** — the stable key and the caption it had at the
time, which **no repo in the six-codebase cohort does**; (4) the failure **counted and
surfaced**, not swallowed and not fatal; (5) the module header
`// Insert (append-only -- no update or delete functions)` — append-only as a module surface,
not a promise; (6) `settings.rs:11-56`'s decision to emit the audit **at the repo layer**, so
internal engine callers are audited too, with the actor gap and its trade-off written down at
`:50-53` instead of left implicit.

**Also exemplary:**

| site | the property to copy |
|---|---|
| `db/src/repos/orchestration/team_assignments.rs:388-393` | `ORDER BY e.created_at ASC, e.id ASC` behind a keyset predicate. The only read in the repo that cannot skip or repeat across a tie. |
| `db/src/repos/execution/change_journal.rs:215-216` | `ORDER BY id DESC` over an `INTEGER PRIMARY KEY` — the sort key **is** the sequence. 97.7% of its rows are in a `created_at` tie and it does not matter. |
| `db/src/repos/resources/persona_change_log.rs:1-31` | Coalescing, redaction, retention and the reasoning for each, in a 16-line module header. |
| `db/src/repos/core/personas.rs:1176-1191` | The change-log rows and the `UPDATE` in **one transaction**, with *"Never let an audit failure sink a real edit"* as the explicit trade-off on the surrounding `if let Err`. |
| `src/features/settings/sub_history/components/SettingsHistoryTab.tsx:45-54` | `categoryLabel()` — an unknown token is **humanised**, never printed as `snake_case`. Three lines, and it is P6's fallback done right. |
| `.../SettingsHistoryTab.tsx:212-217` | Relative time with the absolute in `title=`, and `dateFallbackDays: 30`. |
| `src/features/vault/shared/playground/tabs/ExecutionsTab.tsx:70-82` | Actor **and** detail, joined, with an explicit `--` for the both-absent case, and a per-row timestamp. Over the same table as §7 D3. |
| `src/features/agents/sub_editor/components/PersonaChangeHistory.tsx:53-62` | Three total functions — field label, source label, empty value — in nine lines. |
| `src/lib/utils/formatters.ts:24-34` — `normalizeTimestamp` | *"SQLite `datetime('now')` returns … UTC, but with NO timezone marker, which `new Date()` misreads as LOCAL time"*. **Executed and confirmed**: `Date.parse('2026-08-16 12:30:41')` yields `10:30:41Z` in the operator's zone. The repo found this and fixed it at the formatter; **8,899 live rows across four tables carry that shape** and every one routed through `formatRelativeTime`/`formatTimestamp` is correct. |
| `src/lib/design/eventTokens.ts:107-143` | The typed token map, its exhaustiveness rationale, and the dev-only warn that names the file to edit. |

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** Two absences are structural and are
reported as such rather than counted as choices: **`personas-cloud` has zero `.tsx`** (a
headless Python facade + TS orchestrator; it has an audit *table* and no view), and
**`personas-web` has no recorded trail at all** — its `Changelog.tsx` / `PolicyChangelog.tsx`
render authored static content from `src/data/changelog.ts`, with no actor and no events. So
**3 of 5 have a real audit-trail view.** `vibeman/src/lib/contexts/audit.ts` is a **name
collision, not a mechanism** — it is an advisory grader for context granularity, and is
excluded.

**Lineage checked: no shared audit prose among the five.** The three relative-time helpers
are textually independent (day-bands vs 90s/5400s/129600s bands vs a try/catch wrapper), and
the comment voices differ. The agreements below are independent reinvention, not a port
agreeing with its original.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **The actor is stored as a stable id *and* a name-at-the-time** | **PERSONAS IS ALONE (0 of 5), and it is a strength** | `ascent` stores `actor String? // GitHub login who made the change (null = system / anonymous)` — a **mutable handle**, neither FK nor snapshot, so a rename silently rewrites history; `actorId String?` has no FK either. `brainiac` stores `actor_id: Option<Uuid>` — stable, but of a **token**, not a person (see its quote below). `personas-cloud` and `vibeman` have **no actor column at all** on their trails. **Not one sibling stores both.** `credential_audit_log` and `provider_audit_log` do. |
| 2 | **⚠ THE SHARPEST — an unknown actor is a rendered state** | **PHYSICS (3 of 3), and PERSONAS IS BEHIND** | `ascent/AuditLogViewer.tsx:224` `{e.actorId ?? "—"}`; `ascent/BacklogItemRow.history.tsx:21` `{ev.actor ? \`@${ev.actor}\` : "system"}`; `brainiac/audit-data.ts:96` `if (!actorId) return "policy (auto)";`. **Zero of three let the element disappear.** `SettingsHistoryTab.tsx:207` and `GitOpsVersionHistory.tsx:297` both do — the latter for the timestamp as well. |
| 3 | **An audit view renders a *derived* value as if it were recorded** | **PRESENT (1 of 3) — and the mitigation is disclosure** | `vibeman/preferenceLearning.ts:102-114` regex-classifies a free-text `rejection_reason` into categories rendered as labelled % bars under *"Why you reject candidates"* with **no disclosure it was inferred**; `GoalLifecyclePanel.tsx:241` renders an `inferredProgress` as `{progress}%` under *"Autonomous Progress"*. `brainiac` regex-classifies outcomes **only to pick a colour** and says so. `ascent`: none. This repo's §0 is the same defect deciding *who*, which is the higher-stakes half. |
| 4 | **A label map narrower than the writer's vocabulary** | **PHYSICS (3 of 3 use `map[x] ?? x`); narrower in 2 of 3** | `ascent/AuditLogViewer.tsx:39` `ACTION_META[action] ?? { label: action }` — **12 arms against ~24 distinct writer actions**, plus a dynamically-built `` `org_skill.${status}` ``; 13 actions unlabeled. `vibeman` — 7 icon arms against 8 `GoalSignalType` values, `standup_risk_alert` unmapped, label falls through to the raw token. `brainiac` — 3 arms against `AUDIT_KINDS[3]`, exactly aligned. Ours: 5 vs 10 (credential ops) and 5 vs 8 (event status). |
| 5 | **The read has a unique tiebreaker** | **MINORITY (2 of 4) — a minority answer to a universal condition** | `ascent/scans-audit.ts:266` `orderBy: [{ at: 'desc' }, { id: 'desc' }]` + a keyset cursor, with the rule written down (quote below). `personas-cloud/db.ts:1348` `ORDER BY id ASC` over an `INTEGER PRIMARY KEY AUTOINCREMENT` — and it is **load-bearing**, because `batchAppendEventAudit` stamps one identical `now` on every row of a batch. `brainiac/console.rs:1681` `ORDER BY at DESC LIMIT $1 OFFSET $2` over a 3-way `UNION ALL` **with OFFSET paging** — the worst combination available. `vibeman` `ORDER BY created_at DESC LIMIT ?`. |
| 6 | **Absolute time reachable from the row** | **MINORITY (1 of 3)** | `ascent/AuditLogViewer.tsx:217-219` `title={e.at}` + `{timeAgo(e.at)}`. `brainiac/AuditLedger.tsx:64` relative only, no `title`. `vibeman` relative only, and past 7 days it drops to `{month, day}` — **the year is discarded** (`formatDate.ts:31`). Ours is correct on `SettingsHistoryTab` and `ApiKeyAuditDrawer`, absent entirely on `ByomAuditLog`. |
| 7 | **Truncation disclosed on the pixel** | **MIXED** | `brainiac/AuditLedger.tsx:158-161` renders `showing ${offset+1}–${offset+events.length} of ${total}` — the best in the cohort. `ascent/AuditLogViewer.tsx:189` shows only `{entries.length} shown`, no total; its **CSV export**, by contrast, is exemplary (a `-PARTIAL` filename, an `x-ascent-truncated` header, a row-cap header). `vibeman` truncates **twice** (SQL `LIMIT` **and** `.slice(0, 20)`) and labels the result with a count of the already-truncated array. |
| 8 | **A failed audit write is counted, or made impossible** | **PERSONAS AND BRAINIAC LEAD (2 of 4)** | `brainiac` writes the audit row on the **same `PgConnection`** as the status change, so it cannot fail separately. Ours counts the gap on `vault_status`. `ascent` built the mechanism (`recordAudit` returns a boolean) and wired **4 of ~24 call sites**; `org/plan/route.ts:48` appends an explicit `.catch(() => {})`. `personas-cloud` flushes the audit **after** the transaction commits, so a crash in between loses it. `vibeman` is fire-and-forget. |

**Physics — keep as doctrine:** clauses 2, 4 (as a condition).
**Reported as MINORITY / this-repo-alone:** clauses 1, 5, 6, 8.
**Personas is ahead** on two things worth defending — **storing the actor as id + snapshot**
(unique in six codebases) and **counting a failed audit write** — and **behind** on clause 2,
which is the only unanimous result in the sweep.

> **The four sentences the cohort wrote that this leaf should be judged against.**
>
> `brainiac/console/app/console/modules/audit/audit-data.ts:88-94` — **the actor is a token,
> not a person, and say so:**
> *"The honest actor label — the one piece of copy this module exists to get right. …the
> console gate is ONE shared passcode per deployment, so the server stamps every human
> decision with the SAME principal. `actor_id` therefore names which token decided, never
> which person — do not render it as though it were a name."*
>
> `ascent/src/lib/db/scans-audit.ts:208-209` — **P5, stated as a constraint:**
> *"Keyset cursor over the composite sort key (at desc, id desc). `at` alone isn't unique, so
> the id tie-breaker guarantees a stable, gap-free page boundary."*
>
> `ascent/src/app/api/audit/route.ts:58-62` — **P7, and the sharpest framing of why:**
> *"TRUNCATION HONESTY: the loop also exits at CSV_MAX_ROWS (newest-first, so the OLDEST
> evidence is dropped). The SHA below signs whatever bytes we emit, so a truncated file would
> otherwise be filed as complete compliance evidence with a valid integrity hash — false
> confidence."*
>
> `brainiac/crates/brainiac-server/src/console.rs:1593-1598` — **why one action can be two
> rows:** *"A deprecation reached through a dispute appears twice, deliberately: once as the
> `feedback_resolution` decision and once as the `promotion_review` status transition it
> applied. …the decision and the transition are separate facts, and an audit trail that
> collapsed them could not show a decision whose transition never landed."*

**One technique worth importing wholesale:** `ascent/src/lib/db/audit-integrity.ts`'s
`withAuditSignature` folds an HMAC into each row's `meta`, and its CSV export adds `orgId`
specifically so the signature is reconstructable from the exported file alone. **Nothing in
this repo carries per-row tamper evidence.**

### Composition defects with the neighbouring paths — offered upward

**(i) with [`selective-per-item-verdicts`](./selective-per-item-verdicts.md).** That path
prescribes flattening per-item verdicts into `reviewer_notes` as an **anti-pattern** and
measures it yielding zero durable verdicts. This path finds the *other* cost of the same
column: because `reviewer_notes` is the only free-text field on the row, it has become the
carrier for **three unrelated concerns** — the reviewer's prose, the per-item verdict
flatten, and (by inference) the machine-vs-human attribution. Fixing either one in isolation
leaves the other reading the same column. **The joint prescription is that `reviewer_notes`
should carry prose and nothing else**, and both of the other two need columns.

**(ii) with [`aggregate-count-display`](./aggregate-count-display.md).** Its §2(c) says *type
an unmeasured count as absent, not zero, and render a neutral affordance rather than a hidden
badge*. That is exactly this path's P3 with `number` swapped for an identity — the same shape,
one axis apart, discovered independently on two leaves. The two compose without conflict and
the generalisation is worth stating once: **for any field an audit surface renders, `unknown`
is a third value and it needs pixels.** Where they *could* collide: following its §2(g)
("mark a count that is over a partial set") on an audit trail is necessary but not sufficient
— a `50+` on a trail also needs to say **which end** was dropped, because for a history the
oldest rows are the evidence (ascent's truncation-honesty quote above).

**(iii) with [`timestamp-display`](./timestamp-display.md).** Its `host-locale-date-render`
rule (53 files) counts raw `toLocaleString()` calls. It cannot see D4 — a column *labelled*
with a time-word that holds a duration — because there is no date call to find. Complementary,
not overlapping: it gates the format, this gates whether a time is there at all.

---

## 7. Deviations

Every entry is live on `master` @ `2a874e692` and was verified by reading the file, by replay,
or against a read-only copy of the operator's database. **Per the campaign's
no-destructive-applies rule these are notes, not asks** — the operator uses this app daily and
every fix below changes a schema, a live surface, or what a stored record says.

### D1 — the "was this automated?" badge is inferred from prose, and misses 168 of 168 · **executed**

`src/features/overview/sub_manual-review/libs/reviewHelpers.ts:75-87` →
`components/AutoResolvedBadge.tsx:16-33` and `ReviewDetailPanel.tsx:104`.

`detectAutoResolution` tests `/\btrust_llm\b/i` and `/\bauto_triage\b/i` against
`reviewer_notes`. The two live writers emit **`[auto-triaged — …]`**
(`src-tauri/src/engine/subscription.rs:2041,2045`, 148 rows) and
**`Auto-resolved: stale > GC threshold`** (`db/src/repos/communication/manual_reviews.rs:583`,
20 rows). Neither matches. Replayed over all 194 reviews: **trust_llm 0, auto_triage 0, no
badge 194.** The badge has never rendered on this install.

Three defects, in increasing order of depth:

1. **The vocabulary drifted** — a hyphen and a tense. `dispatch.rs:653` *does* write
   `"auto-approved by trust_llm policy"`, so the `trust_llm` arm was correct against *its*
   writer; the `auto_triage` arm was written against a writer that no longer exists, and the
   sweep at `subscription.rs` was added later with different wording.
2. **The inference is over a field a human can write.** A reviewer who types the words
   "auto_triage" into their own notes is recorded as a machine; a machine whose note shape
   changes is recorded as a human. The bit establishing accountability is controlled by the
   party it holds accountable.
3. **`persona_manual_reviews` has no actor column at all** — no `resolved_by`, no
   `resolver_kind`. The inference exists because there is nothing to read.

And the consequence compounds: `manual_reviews.rs:347` writes
`"Human {verdict} the review …"` for every resolve, so **186 of 236 human-review team
memories (78.8%) assert a human decision in a sentence that contains the machine's own
`auto-triaged` marker**, at importance 7, as a team `decision` the fleet reads back.

**Fix (note):** add `resolver_kind TEXT NOT NULL DEFAULT 'human'` and `resolved_by TEXT` to
`persona_manual_reviews`; set them at the three writers; make the badge read the column and
delete `detectAutoResolution`; and make `manual_reviews.rs:347` interpolate the kind instead
of the literal `Human`. *(A schema migration on the app's most-used verdict table plus a
change to what a live surface asserts — a note.)*

### D2 — the event log answers "who" with an ambiguous slug and "what happened" with a raw token · **executed**

`src/features/overview/sub_events/components/EventLogList.tsx`. Five defects on one surface,
over 4,972 live rows.

| line | defect | live |
|---|---|---|
| `:198-217` | `raw.slice('persona:'.length)` is used as a persona **id**; `event.source_id` — which holds the real id — is consulted only in the branch that persona-sourced rows never take. | **0 of 4,166** slugs resolve; `source_id` resolves **4,166 of 4,166**. The failure renders the slug in `font-mono` (`:212`), styled as an id. |
| `:198-217` | the slug is the **sanitised display name**, and names are not unique | **4,118 rows (82.8%)** carry a slug shared by **7 distinct persona ids** |
| `:251` (+ `:479`, `EventDetailModal.tsx:17`) | `{event.status}` — the raw machine token, never through `tokenLabel` | **4,972 of 4,972**; `tokenLabel(t,'event',…)` has **0 call sites in 4,829 files** |
| `:62-70` | `STATUS_OPTIONS` is hand-listed, in hardcoded English | offers `processed` (not a `PersonaEventStatus` variant); **omits `delivered`, which 99.4% of rows have** |
| `:35-58,:159-177` | `TRIGGER_ICON_MAP` has 15 keys and `SOURCE_TYPE_LABELS` has 4; the trigger is rendered **only** as a 7×7 icon with a `title` | **770 rows** (`chain` 727, `system_op` 28, `findings` 15) render a `HelpCircle` — a question mark where "who" should be |

The column headers themselves (`'Trigger'`, `'Persona'`, `'Event Name'`, `'Status'`,
`'Created'`, `:149-262`) are hardcoded English in a 14-locale app, as are the seven
`STATUS_OPTIONS` labels.

**Fix (note):** use `event.source_id` for the persona lookup and keep `source_type` for the
icon only; route the status through `tokenLabel` and complete `status_tokens.event` against
`PersonaEventStatus`; build `STATUS_OPTIONS` from that map. *(Changes what a live surface
shows.)*

### D3 — the credential audit's "Detail" column holds the actor 60% of the time · **executed**

`src/features/vault/sub_credentials/components/features/AuditLogTable.tsx:106`:

```tsx
{entry.personaName ? `by ${entry.personaName}` : entry.detail ?? ''}
```

Replayed over all 9,803 live rows:

| | rows | what the "Detail" column shows |
|---|---:|---|
| actor **and** detail present | **5,883 (60.0%)** | `by <persona>` — **the detail is discarded** |
| detail only | **3,906 (39.8%)** | the detail — and no sign that the actor is unknown |
| neither | **14 (0.1%)** | an empty cell |
| **both shown together** | **0** | — |

Two more on the same file: `OP_LABELS` (`:14-20`) has **5 arms against a live vocabulary of
10**, so **210 rows** (`oauth_token_refreshed` 201, `oauth_completed` 3, `oauth_initiated` 3,
`field_update` 2, `credential_oauth_refreshed` 1) render the raw token; and `AUDIT_FILTERS`
(`:22`) offers the same 5, so those 210 rows are reachable only under "All". `'All'`,
`'{n} entries'` and `'Page {n}/{m}'` (`:78,:81,:130`) are hardcoded English.

**The repo already has the right answer for the same table**:
`src/features/vault/shared/playground/tabs/ExecutionsTab.tsx:70-82` renders actor · detail
with an explicit `--` and a per-row timestamp.

**Fix (note):** render both cells, add the null-actor state, and derive `OP_LABELS` and
`AUDIT_FILTERS` from one map. *(Changes a live surface.)*

### D4 — a compliance trail with no timestamp, and a "Time" column that is a duration

`src/features/settings/sub_byom/components/ByomAuditLog.tsx`. Header
`s.audit_hint` = *"Compliance trail showing which provider handled each execution"*; six
columns; the last is `s.audit_time` = **`"Time"`** and its cell is
`formatDuration(entry.duration_ms)` (`:63,:118`). **`entry.created_at` is on the binding and
rendered nowhere in the file.**

Also here: `{entry.status}` raw (`:59`) with a 2-arm `STATUS_CLASSES` — **122 of 4,001 live
rows are `incomplete`** and get the neutral style plus the raw token; and
`listProviderAuditLog(50)` (`useByomSettings.ts:129`) fetches **50 of 4,001 (1.25%)** with no
pagination and no scope notice, which is [`aggregate-count-display`](./aggregate-count-display.md)'s
§2(g) unmet.

**Fix (note):** add a `created_at` column, rename the duration column, and route `status`
through `tokenLabel(t,'execution',…)` (its map already covers `completed`/`failed`; add
`incomplete`).

### D5 — an unattributed record renders as an attributed one minus a badge

- `src/features/settings/sub_history/components/SettingsHistoryTab.tsx:207-211` —
  `{entry.actor && <span …>{entry.actor}</span>}`. Live: **`actor` is NULL on 14 of 15 rows**;
  the one non-null value is `"ui"`.
- `src/features/plugins/gitlab/components/GitOpsVersionHistory.tsx:297-298` —
  `{version.createdBy && <span>…</span>}` **and** `{timeAgo && <span>…</span>}` on adjacent
  lines: on a version-history row, both *who* and *when* can vanish silently.
- `src/features/plugins/research-lab/sub_findings/FindingsPanel.tsx:107` and
  `sub_hypotheses/HypothesesPanel.tsx:162` — `{f.generatedBy && …}`: the provenance of a
  generated finding disappears when unset.

The *gap* is deliberate and argued — `db/src/repos/core/settings.rs:50-53` states that the
repo layer cannot attribute a caller surface and that auditing every internal caller is worth
more than an origin tag. **That reasoning is right and the rendering does not honour it**: a
reader cannot tell "unattributed" from "attributed, badge just not there". The convergence
sweep is unanimous against us here (§6 clause 2, 3 of 3).

**Fix:** render `t.…system` / `—` in the else branch at all four sites. *(Small, and it
changes a live surface — a note, but the cheapest one in this document.)*

### D6 — a panel documents a column it does not render

`src/features/settings/sub_api_keys/components/ApiKeyAuditDrawer.tsx:1-6`:

> *"shows the recent management-API requests a key made (method / path / status / **persona** /
> origin / time)"*

`persona_id` is on the row, on the binding, and **appears nowhere in the JSX** (`:108-136`).
`origin` renders only when present, with no null state (D5's shape). The docstring is what a
reviewer reads to decide the panel is complete.

**Fix:** render the persona (with a null state), or correct the docstring. One of the two must
move.

### D7 — 141 history reads order by a clock with no tiebreaker, and the fix is 30 lines away · **executed**

Census-measured (§9): **141 matches across 78 of 963 `.rs` files**, 139 of them production.
**Every dedicated audit table in the app is in the population** — `credential_audit_log`
(`audit_log.rs:112,235`), `settings_audit_log` (`:91,:101`), `api_key_audit` (`:52,:74`),
`provider_audit_log` (`:52,:94`), `tool_execution_audit_log` (`:77,:181`), `healing_audit_log`
(`:823,:828`), `persona_change_log` (`:245,:275,:301`), `deployment_history`
(`:71,:115,:161,:267`), `credential_rotation_history` (`rotation.rs:293,:377`),
`audit_incidents` (`:533`), `fleet_decisions` (`:123`).

The ties are real, and they follow the writer, not the reader: **60 tables in
`db/src/migrations/schema.rs` default their timestamp to `datetime('now')`** — second
granularity, no timezone marker — while the repos that call `chrono::to_rfc3339()` get
nanoseconds. Measured on the live copy:

| table | rows | rows sharing a timestamp | order key |
|---|---:|---:|---|
| `team_assignment_events` | 8,486 | **7,431 (87.6%)** in 2,287 groups | `created_at DESC` (`team_assignments.rs:362`) |
| `change_journal` | 221 | 216 (97.7%) in 50 groups | **`id DESC`** — correct |
| `persona_design_reviews` | 113 | 111 (98.2%) in 1 group | `created_at DESC` (`reviews.rs:86,93`) |
| `fleet_decisions` | 46 | **31 (67.4%)** in 5 groups | `created_at DESC` (`fleet_decisions.rs:123`) |
| `credential_audit_log` | 9,803 | 10 (0.1%) | `created_at DESC` — RFC3339, so latent |

`db/src/repos/orchestration/team_assignments.rs` is the whole finding in one file: **`:392`
and `:412` add `, e.id ASC` / `, e.id DESC`, and `:362` — the read `list_team_assignment_events`
serves to the UI — does not.**

**Fix (note):** `, id DESC` on the read; keyset paging where the read pages. Mechanical, and
it changes the row order on live surfaces.

### D8 — four recorded histories with no reader, and no way to tell "never happened" from "never wired"

| trail | live rows | reader |
|---|---:|---|
| `fleet_decisions` | **46** | **none.** `fleet_decisions::recent(pool, limit)` is documented *"Recent decisions, newest first — for an observability surface"* and has **zero callers**; no Tauri command registers it; the only two mentions in `src/` are comments calling it *"the authoritative audit trail"* (`AthenaActionsStrip.tsx:17`, `useFleetCompanionBridge.ts:150`). |
| `tool_execution_audit_log` | **0** | no list surface — only aggregate panels and the incident promoter. |
| `persona_change_log` | **0** | `PersonaChangeHistory.tsx` is live in the editor (`EditorBody.tsx:202`) and well-built; it has never had a row. |
| `deployment_history` | **0** | `UnifiedDeploymentHistory` renders behind a connection check. |

And the 46 `fleet_decisions` rows are themselves thin: **35 of 46 (76%) carry no `rationale`,
no `confidence` and no `decision_class`** — the three columns that would say *why*. **10 of 46
have an empty `session_id`**, and of the 36 non-empty ones **0 resolve**, because
`fleet_sessions` holds **0 rows** on this install (see §12.5 — the brief's numbers here were
close but the shape is different).

**Fix (note):** either build the surface or delete the write; an unread trail is a `DELETE`
waiting to happen. For the three empty tables, the cheap honest move is an empty state that
distinguishes *"nothing has happened yet"* from *"this has never been recorded"* — today they
are the same sentence.

### D9 — one concept, two operation tokens, in the same trail

`credential_audit_log.operation` holds both **`oauth_token_refreshed` (201)** and
**`credential_oauth_refreshed` (1)**. Any filter, count or label map now needs both, and
`OP_LABELS` has neither (D3). Same family as
[`status-and-severity-badges`](./status-and-severity-badges.md)'s vocabulary drift, arriving
on an operation rather than a status.

### D10 — cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"The UTC-naive `datetime('now')` timestamps are rendered as local time."** They are
  **not**. `src/lib/utils/formatters.ts:24-34` — `normalizeTimestamp` — appends `Z` to a bare
  datetime, and its doc comment states the exact hazard (*"which `new Date()` misreads as
  LOCAL time (so a row written 'now' can read '2h ago' for a UTC+2 viewer)"*). I confirmed the
  underlying skew by execution (`Date.parse('2026-08-16 12:30:41')` → `10:30:41Z` in the
  operator's zone) and then confirmed the repo already closes it at the formatter, for all
  **8,899** rows across four tables that carry that shape. A strength.
- **"The event-status colour map is narrower than the enum."** It is not: `EVENT_STATUS_COLORS`
  and `EVENT_STATUS_ICONS` are `Record<PersonaEventStatus, …>` — **8 of 8, exhaustive by
  compile error**, with the rationale in the comment. Only the *label* is short, and only the
  label is untyped. This is the sharpest type-over-gate evidence in the document and I set out
  to file it as a defect.
- **`SettingsHistoryTab` is the best audit view in the repo** and I expected it to be a
  deviation source. Its loading choreography, its module-scoped cache, its unknown-token
  humaniser and its relative-with-absolute-on-hover are all correct; the one gap is D5's else
  branch.
- **`AuditLogTable`'s page-reset effect (`:41-43`) is correct**, with the reason in the
  comment (*"the current page can point past the new last page, rendering a blank table with
  no obvious 'go back' affordance"*). I went looking for a pagination bug and found the guard.
- **The `credential_audit_log` write path is not a deviation** — it is the exemplar (§6), and
  the convergence sweep says it is the best in six codebases.

---

## 8. Gaps

1. **There is no actor on the app's most-used verdict table.** `persona_manual_reviews` has
   `status` and `reviewer_notes` and nothing else about *who*. Every defect in D1 is
   downstream. This is a genuine limitation and not laziness: the column has to exist before
   any type, gate or render can reach it.
2. **`persona_events` fuses identity and label into one `TEXT` column.**
   `format!("persona:{}", safe_name)` (`dispatch.rs:374`) is a lossy encoding done at the
   writer, and doctrine's *"where types cannot reach"* covers it twice — inside a SQL string
   and across a serialization boundary. The un-fused id **is** in `source_id`; nothing forces
   a consumer to prefer it, and no type can.
3. **The repo has no shared audit-row primitive.** Six surfaces each hand-roll a row
   (`AuditLogTable`, `ExecutionsTab`, `SettingsHistoryTab`, `ApiKeyAuditDrawer`,
   `ByomAuditLog`, `PersonaChangeHistory`), and the two over the *same table* disagree about
   what a row means. `CATALOG.md` has no entry whose job is *what happened / who / when*, and
   neither does any of the five sibling repos — this is a component nobody in the fleet has
   built. A `<AuditRow actor={…} actorKind={…} at={…} action={…} detail={…} />` with a
   required `actorKind` would make D3 and D5 unrepresentable.
4. **`tokenLabel`'s signature is `(t, category, token: string)`.** The category is typed; the
   token is not, so no label map in the app can be checked against its writer's enum. The one
   category that *is* exhaustive got there by being a `Record<Enum, …>` in a different file
   (`eventTokens.ts`), i.e. by not using `tokenMaps` at all.
5. **Nothing distinguishes an empty trail from an unwired one.** Three tables have 0 rows and
   live views; the views render "no entries yet". There is no `first_recorded_at`, no
   writer-liveness probe, and no i18n key for *"this has never been recorded"*.
6. **No per-row tamper evidence anywhere.** `ascent` folds an HMAC into each audit row's
   `meta` and exports enough context to verify it from the file alone. Nothing here does, and
   the local-first threat model makes it *more* relevant, not less — the database is a file on
   the operator's disk.
7. **The census can count a statement; it cannot see an inference.** D1 — the headline — is a
   relationship between a regex in TypeScript and a string literal in Rust. §9 explains why
   the countable proxy for it scored 0/7 precision and was refused.
8. **`change_journal` is the only trail whose order cannot be ambiguous, and it got there by
   accident of type** — an `INTEGER PRIMARY KEY` rather than a designed sequence. No other
   audit table has a monotonic column, so the fix for D7 everywhere else is a composite sort
   key rather than a sequence.

---

## 9. The missing gate

**The condition, stated stack-free:** *an append-only record is read back in an order the
data does not determine — the sort key is a clock, two records can share a clock tick, and
nothing breaks the tie — so the sequence a reader is shown is an artifact of the query plan,
and a page boundary falling inside a tie can show a row twice or never.*

**The signal (a proxy, and stated as one):** a SQL read that sorts by a clock column and then
caps with `LIMIT`, with no second sort key. This keys on the shape the condition wears **in
this repo**, where SQL is written as Rust string literals. **An adopting repo must re-derive
its own proxy** — an ORM `orderBy` array, a query-DSL builder, a stored view. `ascent`'s
*compliant* form (`orderBy: [{ at: 'desc' }, { id: 'desc' }]`) would score zero against this
pattern, which is the portability failure the contract's §9 correction exists to prevent.

**The mechanism: a census rule.** The runner already exists (`scripts/census/`) and implements
the fail-loud contract, so this path writes no script.

**Where it executes:** two places, neither CI-only. `npm run census:check` is inside
`npm run check`, and it is the **`golden-path-census` pre-push job** in `lefthook.yml`. That
matters: `ci.yml` is red on 10 pre-existing failures, so **a gate that only runs in CI runs
nowhere.** This one fails the push.

**Precision, classified over all 141 matches** (not sampled): **2** sit inside a
brace-matched `#[cfg(test)]` module (`db_query.rs:3692`, `query_builder.rs:432`) and **1**
more is prose — a user-facing help string documenting SQL syntax (`db_query.rs:1082`). The
remaining **138 (97.9%)** are production reads. On the stricter question *"is this a defect
today"* the answer is data-dependent by construction and the rule says so: the tables written
with `datetime('now')` tie at up to 87.6% of rows, the ones written with `to_rfc3339()` tie at
~0.1%. **That is the condition's honest shape — the clause is unordered either way, and only
the probability of observing it differs.**

**Two independent implementations reconcile on file membership EXACTLY and differ by one
match — and chasing the disagreement found two bugs in mine, both silent.** Implementation #2
enters from the opposite end: it blanks comments, extracts Rust string literals (normal, raw
and raw-hash), finds every `LIMIT` and walks **leftwards** to the nearest `ORDER BY`, then
splits the key list on top-level commas and classifies it structurally.

- **Draft 1 reported 33 / 22 files** against the census's 141 / 78 — a 4× miss. Cause: its
  string-literal class excluded newlines (`[^"\\\n]`), so **every multi-line SQL literal in
  the repo was invisible**. It read as a clean codebase.
- **Draft 2 reported 104 / 63.** Cause: `\\.` after a backslash, where `.` does not match a
  newline — so a **Rust line-continuation** inside a SQL literal terminated the string early
  and split `ORDER BY` from its `LIMIT`. Same family as the CSP checker whose comment stripper
  ate every URL: *a stripper that eats the thing it was meant to preserve.*
- **Draft 3: 78 files / 140 matches vs the census's 78 / 141 — identical membership, zero
  files unique to either side**, and the control identical at 13 / 40. The three files still
  differing by one are all non-audit text: a help string, a `#[cfg(test)]` fixture, and a
  `push_str(" … LIMIT ")` whose bind value is appended by the next statement.

*Agreement was not what made this trustworthy. Both of my drafts were confident, quiet and
wrong, in the same direction, and only the disagreement with a differently-shaped instrument
surfaced them.*

**The population partitions, and the two halves must move in opposite directions:**

| | matches | files |
|---|---:|---:|
| **violating** — clock-ordered, `LIMIT`, no tiebreaker | **141** | 78 |
| **compliant** (the positive control) — clock-ordered **with** a unique second key | **40** | 13 |

They are mutually exclusive by construction: the violating pattern requires `LIMIT` to follow
the clock key directly, the control requires a comma and a second key. `team_assignments.rs`
appears in **both**, which is the finding.

**Existing rules checked for overlap first — measured by re-running each neighbour's own
committed pattern and intersecting line sets, not assumed. All 44 committed rules rooted in
`src-tauri` reproduced their committed baselines exactly** (which is also this instrument's
own liveness check).

| neighbour rule | its files / matches | file overlap with my 78 | **shared matches** | why it is a different condition |
|---|---:|---:|---:|---|
| `silent-row-skip` ([`row-to-struct-mapping`](./row-to-struct-mapping.md)) | 64 / 148 | 21 (27%) | **0** | Keys on the row **mapper** discarding a `Result`. Largest file co-occurrence in the registry and still zero shared lines — the two look at opposite ends of the same function. |
| `untimed-repo-query` ([`query-latency-instrumentation`](./query-latency-instrumentation.md)) | 36 / 245 | 15 (19%) | **0** | Keys on the absence of `timed_query!` around a query. It asks *is this query observable*; this asks *is its answer determined*. |
| `blind-identity-write` ([`repository-crud-surface`](./repository-crud-surface.md)) | 35 / 82 | 14 (18%) | **0** | Write-side. |
| `hand-rolled-emptiness-refusal` ([`command-input-validation`](./command-input-validation.md)) | 135 / 305 | 14 (18%) | **0** | Argument validation. |
| `persistence-handle-in-command-tree` ([`command-naming-placement`](./command-naming-placement.md)) | 46 / 134 | 10 (13%) | **0** | Where the pool lives. |
| `unqueryable-log-record` ([`structured-logging`](./structured-logging.md)) | 67 / 288 | 9 (12%) | **0** | `tracing` call shape. |
| `unverifiable-conflict-clause` ([`upsert`](./upsert.md)) | 40 / 71 | 9 (12%) | **0** | `ON CONFLICT`. The nearest by *idiom* — both read SQL text — and disjoint by clause. |
| `empty-sample-as-confident-zero` ([`metric-definition`](./metric-definition.md)) | 16 / 34 | 8 (10%) | **0** | A rate over an empty sample. |
| 36 further `src-tauri` rules | — | ≤10% each | **0 each** | — |

**Match-level overlap is 0% with every committed rule in the registry.** Largest file-level
co-occurrence is 27%, well under the 83% that correctly got a previous gate declined. And
**`paginated-list-query.md` and `timestamp-storage.md` have no census rule at all**, so the
condition is unowned rather than contested.

**How it fails loudly if its own precondition is absent — executed against the working tree,
exit codes captured directly, never through a pipe:**

| induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified, 78f/141m + control 13f/40m) | **0** | `census OK — 2 rule(s), 1926 file-visits, 181 surviving violation(s) across 91 file(s)` |
| `floor` raised to 2000 > 963 walked | **1** | `[structural] walked 963 files but floor is 2000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| pattern → a token appearing nowhere | **1** | `[structural] matched zero files anywhere` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 900` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 900` |
| baseline deflated (a rise) | **1** | `[drift] files rose 60 -> 78 (+18)` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 99 -> 78 (-21) without the baseline moving` |
| `goldenPath` removed | **1** | `missing grounding — a rule needs "goldenPath"` |
| stale `exclude` entry | **1** | `[structural] exclude "…/GONE.rs" matched no file. The exemption is stale` |
| `exclude` `reason` shortened to `"x"` | **1** | `needs a real "reason"` |
| **gate pointed at the COMPLIANT form** | **1** | `[drift] files dropped 78 -> 13 (-65)` |
| **control given a baseline** | **1** | `a positive control must NOT carry a baseline` |
| **control loses its population** (tiebreak vocabulary removed) | **1** | `[structural] matched zero files anywhere` |

**What the gate cannot do, stated so nobody trusts it further than it goes:**

- **It cannot see D1**, the headline — an inference in TypeScript against a string literal in
  Rust is a relationship between two trees, and the census matches within a file.
- **It cannot see whether the actor is right**, only whether the order is determined.
- **It cannot see an ORM.** SQL-as-text is the precondition; a repo whose reads go through a
  builder scores a structural zero while carrying the condition at scale.
- **It cannot tell a live tie from a latent one.** `credential_audit_log` (0.1% ties) and
  `team_assignment_events` (87.6%) are the same statement.
- **A tiebreaker is not a cursor.** A rule can be silenced by adding `, id DESC` while the
  read still pages with `OFFSET`, which is a different defect
  ([`paginated-list-query`](./paginated-list-query.md)'s).

```json
{
  "rules": [
    {
      "id": "clock-ordered-history-read-without-tiebreak",
      "goldenPath": "docs/concepts/golden-paths/audit-trail-view.md",
      "title": "A history read orders by a clock column and takes a LIMIT with no unique tiebreaker, so which rows the page contains — and the order they are read back in — is not determined by the data",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "ORDER BY\\s+(?:[A-Za-z_][\\w]*\\s*\\.\\s*)?(?:created_at|createdAt|updated_at|fired_at|adopted_at|resolved_at|decided_at|occurred_at|recorded_at|logged_at|at)\\s*(?:ASC|DESC)?\\s*(?:\\\\n)?\\s*LIMIT",
        "flags": "gi",
        "ignoreCommentLines": true,
        "description": "A SQL read that sorts a recorded history by a CLOCK column and then caps it with LIMIT, with no second sort key. PROXY FOR the stack-free condition: an append-only record is read back in an order the data does not determine, so two rows written in the same clock tick can swap places between reads, and a page boundary that falls inside a tie can show a row twice or never. MEASURED 2026-08-16 at 2a874e692: 141 matches across 78 of 963 .rs files under src-tauri; 2 of the 141 sit inside a brace-matched #[cfg(test)] module (db_query.rs:3692, query_builder.rs:432) and 1 more (db_query.rs:1082) is PROSE — a user-facing help string that documents SQL syntax to the operator — so production precision on the stated condition is 138/141 (97.9%). THE POPULATION IS THIS LEAF'S OWN SUBJECT: every dedicated audit table in the app is read this way — credential_audit_log (audit_log.rs:112,235), settings_audit_log (:91,:101), api_key_audit (:52,:74), provider_audit_log (:52,:94), tool_execution_audit_log (:77,:181), healing_audit_log (:823,:828), persona_change_log (:245,:275,:301), deployment_history (:71,:115,:161,:267), credential_rotation_history (rotation.rs:293,:377) and audit_incidents (:533). WHY IT IS A DEFECT AND NOT PEDANTRY, executed against a read-only copy of the operator's live 347 MB personas.db (copied 2026-08-16 22:20 UTC with the app running, never opened for write, deleted after): 60 tables in db/src/migrations/schema.rs default their timestamp to SQLite `datetime('now')`, which is SECOND granularity with no timezone marker, and the ties are not hypothetical — team_assignment_events has 2,287 tie groups covering 7,431 of 8,486 rows (87.6%), change_journal 50 groups over 216 of 221 (97.7%), fleet_decisions 5 groups over 31 of 46 (67.4%), persona_design_reviews one group of 111 over 113 rows (98.2%). The tables written with chrono to_rfc3339() (nanosecond) tie at ~0.1%, which is exactly why this cannot be decided from the statement: the same clause is safe over one table and unordered over another, and the discriminator is in the writer, not at the read. THE REPO ALREADY OWNS THE ANSWER, 30 LINES AWAY: db/src/repos/orchestration/team_assignments.rs has three reads of the SAME table — :392 `ORDER BY e.created_at ASC, e.id ASC` behind a keyset cursor `(created_at > ?2 OR (created_at = ?2 AND id > ?3))`, :412 `ORDER BY e.created_at DESC, e.id DESC`, and :362 `ORDER BY created_at DESC` with no tiebreaker — and :362 is the one `list_team_assignment_events` serves to the UI. TWO INDEPENDENT IMPLEMENTATIONS RECONCILE AT IDENTICAL FILE MEMBERSHIP (78 files both, 0 files unique to either) AND DIFFER BY ONE MATCH (141 vs 140): implementation #2 enters from the opposite end — it blanks comments, extracts Rust string literals (normal, raw and raw-hash), finds every LIMIT and walks LEFTWARDS to the nearest ORDER BY, then parses the key list by splitting on top-level commas and classifies it structurally. Its first two drafts were BOTH wrong and both wrong quietly: draft 1 excluded newlines from its string-literal class, so every multi-line SQL literal in the repo was invisible and it reported 33/22; draft 2 used `\\\\.` after a backslash, and `.` does not match a newline, so a Rust line-continuation inside a SQL literal terminated the string early and split ORDER BY from its LIMIT. Chasing the residual disagreement is what found both. The three files still differing by one are all non-audit text (a help string, a #[cfg(test)] fixture, and a `push_str(\" ... LIMIT \")` whose bind value is appended by the next statement). ZERO MATCH-LEVEL OVERLAP with every committed rule rooted in src-tauri — measured by re-running each neighbour's own committed pattern and intersecting line sets, not assumed; all 44 reproduced their committed baselines exactly. Largest FILE-level co-occurrence is `silent-row-skip` at 21 of my 78 files (27%) with 0 shared lines, then `untimed-repo-query` 15/78 (19%) and `blind-identity-write` 14/78 (18%) — all three key on the row-mapping and instrumentation of a query, never on its sort key. `paginated-list-query.md` and `timestamp-storage.md` have NO census rule at all, so this condition is unowned. LEGAL FIX: add the table's own primary key as the final sort key — `ORDER BY created_at DESC, id DESC` — and, where the read pages, move to the keyset form at team_assignments.rs:392 rather than OFFSET. DO NOT silence a match by deleting the LIMIT (that makes the read unbounded, which is worse), by sorting client-side after the fetch (JS Array.sort is stable, so it preserves whatever arbitrary order the database returned), or by switching the writer to a higher-resolution clock without adding the key (that shrinks the tie window, it does not close it). CONVERGENT AS A CONDITION, MINORITY AS AN ANSWER: swept read-only against personas-web, brainiac, personas-cloud, vibeman and ascent — ascent uses `orderBy: [{ at: 'desc' }, { id: 'desc' }]` with the rationale written down (`at` alone isn't unique, so the id tie-breaker guarantees a stable, gap-free page boundary) and personas-cloud orders by an INTEGER PRIMARY KEY AUTOINCREMENT, while brainiac (`ORDER BY at DESC LIMIT $1 OFFSET $2` over a 3-way UNION ALL, with OFFSET paging) and vibeman (`ORDER BY created_at DESC LIMIT ?`) do not — 2 of 4. PRECONDITION (must be re-derived per repo): this repo writes SQL as Rust string literals, so the signal is a text match on the SQL itself. A repo whose reads go through an ORM builder (`orderBy: [{ at: 'desc' }]`), a query DSL, or a stored view scores a structural zero here while carrying the condition at scale — ascent's own compliant form would not match this pattern."
      },
      "exclude": [],
      "baseline": { "files": 78, "matches": 141 },
      "floor": 900
    },
    {
      "id": "clock-ordered-history-read-without-tiebreak-positive-control",
      "goldenPath": "docs/concepts/golden-paths/audit-trail-view.md",
      "title": "POSITIVE CONTROL — the same clock-ordered history read WITH a unique tiebreaker",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "ORDER BY\\s+(?:[A-Za-z_][\\w]*\\s*\\.\\s*)?(?:created_at|createdAt|updated_at|fired_at|adopted_at|resolved_at|decided_at|occurred_at|recorded_at|logged_at|at)\\s*(?:ASC|DESC)?\\s*,\\s*(?:[A-Za-z_][\\w]*\\s*\\.\\s*)?(?:id|rowid|seq|sequence|ordinal)\\b",
        "flags": "gi",
        "ignoreCommentLines": true,
        "description": "POSITIVE CONTROL, deliberately carrying NO baseline. Same roots, same extensions, same walk, same anchor (ORDER BY a clock column); the ONLY difference is whether a unique key follows it. The two patterns are MUTUALLY EXCLUSIVE BY CONSTRUCTION — the violating one requires LIMIT to follow the clock key directly, this one requires a comma and a second key — so a query cannot be counted twice. MEASURED 2026-08-16 at 2a874e692: 40 matches across 13 files, against the violating rule's 141 across 78. The population partitions 141 unordered : 40 ordered, and the two counts MUST MOVE IN OPPOSITE DIRECTIONS as the codebase improves: if the violating count falls while this stays flat, a history read was DELETED rather than made deterministic, and the ratchet would otherwise have recorded that as progress. THE SITES, all opened: db/src/repos/communication/events.rs holds 13 of the 40 (the event log is the best-ordered history in the app); resources/team_channel.rs 4; commands/teams/team_channel.rs 4; companion/brain/episodic.rs 4; then dev_tools.rs, orchestration/team_assignments.rs, resources/recipe_suggestions.rs, resources/remote_jobs.rs, commands/companion/chat_cards.rs, commands/companion/observability.rs at 2 each, and manual_reviews.rs, policy_proposals.rs, companion/dev_mode.rs at 1. team_assignments.rs:392 is the reference implementation — `ORDER BY e.created_at ASC, e.id ASC` behind the keyset predicate `(e.created_at > ?2 OR (e.created_at = ?2 AND e.id > ?3))`, which is the only paging form in the repo that cannot skip or repeat a row across a tie. A MATCH HERE IS NOT A CERTIFICATE: team_assignments.rs is in BOTH populations — :392 and :412 are correct and :362, the read `list_team_assignment_events` actually serves to the UI, is not. It is also a LIVENESS PROBE for the walk: this control and the violating rule are two halves of one question over one anchor, so if the roots move, the extension list changes, or SQL stops being written as Rust literals, this drops to zero and the run fails structurally instead of quietly reporting a healthy ratchet."
      },
      "exclude": [],
      "floor": 900
    }
  ]
}
```

Validated standalone via `node scripts/census/run-census.mjs --rules <a composer-private
scratch registry, filename unique to this composer because siblings share the scratchpad>
--check`, never against the shared `rules.json`, and **the full registry was not run**
(doctrine §4). The runner reports **141 matches / 78 files** for the rule and **40 / 13** for
the control over **963** `.rs` files against a floor of 900, and `--check` exits **0** at the
declared baseline. **Re-extracted from this finished document and re-run, with identical
counts.**

### Two conditions I am refusing to gate, with the measurement that justifies each refusal

1. **An audit fact derived from a free-text field** — D1, the headline, and the one I most
   wanted. The census-legal form (a regex literal `.test()`ing an identifier named
   `notes`/`rationale`/`reason`/`detail`/`message`) returns **3 matches in 2 files**, of
   which one — `healingSlice.ts:122`, `/not found/i.test(message)` — is error classification,
   not an audit fact. **Precision 2/3 on a population of 3**, and a rule whose whole
   population is two lines fails structurally the moment either is edited. Widening the verb
   set to `.includes` / `.startsWith` / `.match` takes it to **28 matches / 17 files at
   roughly 25% precision** (a tour's `includes('message')`, a lint of `[SUMMARY` prefixes, a
   URL-protocol check). **A gate that fires on correct content is worse than no gate.** The
   instrument that reaches this condition is not a ratchet but a **column** — §7 D1's
   `resolver_kind`, after which the regex can be deleted rather than counted.
2. **An attribution rendered inside a truthiness guard** — D5, and the clause the convergence
   sweep says is unanimous physics (3 of 3). I built it and ran it: **4 matches / 4 files**
   (`SettingsHistoryTab.tsx:207`, `GitOpsVersionHistory.tsx:297`, `FindingsPanel.tsx:107`,
   `HypothesesPanel.tsx:162`), all four hand-read, **precision 4/4** — and then the **positive
   control returned 0 true positives out of 7**. The compliant form (`actor ?? fallback`)
   matched only `parsed.username || parsed.password` (two URL credential checks),
   `config?.username ?? ''` (a form field), `cfg.operator || 'AND'` (a *boolean* operator) and
   `values.username ?? ''`. **A control returning ~0 means the pattern is not discriminating
   on what I think**, and the cause is instructive in the doctrine's own terms: my actor
   vocabulary contained `username` and `operator`, which in this codebase are URL, form and
   logic nouns rather than actor nouns — *a vocabulary-based signal's precision is bounded by
   the same word list as its recall, and I wrote both halves from imagination before checking
   the bindings.* Recorded in D5 for a four-site fix instead.

### The type, alongside the ratchet

The gate counts a **statement**. Three things it cannot reach, in descending importance:

- **The actor column that does not exist** (§8 Gap 1). No signal on either side sees a missing
  column, and D1 is entirely downstream of it. **That is the fix that matters.**
- **The token map's link to its writer's enum IS available** (§4 T1) and it is a copy of a
  pattern already in the same feature — but it is inert without routing the three render
  sites through the resolver they currently bypass. **Both edits or neither.**
- **Fix the destination before ratcheting the callers** (contract: *a gate on reaching a
  destination is only as good as the destination's defaults*). Routing every history read to
  `, id DESC` is right; routing every audit surface to a shared `<AuditRow>` (§8 Gap 3) would
  be better and the component does not exist — in this repo or in any of the five siblings.
  Build it with `actorKind` **required**, or it will grow the same optional-prop hole that
  made D5 spellable.

---

## 12. Corrections to the brief

1. **`sides: "client"` is wrong, and the spine contradicts itself in the same node.** The leaf
   carries `twoSided: true` **and** `fusedAcrossSides: true` beside `sides: "client"`, plus an
   explicit `serverHalf` string (*"Writing the durable record that a privileged operation
   happened, by whom, to what"*). The evidence is decisive: the headline defect is a
   client-side regex against a **Rust** string literal; the single best artifact in the
   territory is a **Rust** write chokepoint; the missing actor is a **schema** fact; and the
   census rule that survived is **Rust-only**. A client-only sweep would have found none of
   them. **Recommend flipping `sides` to `both`.** I swept both halves anyway. (This is the
   third leaf to report the same `sides`/`twoSided` contradiction — see
   [`selective-per-item-verdicts` §12.1](./selective-per-item-verdicts.md) and
   [`aggregate-count-display` §12.1](./aggregate-count-display.md). The flag looks inherited
   from one of the four merged leaves rather than chosen.)

2. **"All 4,972 `persona_events` rows render a raw machine token for status, because the label
   table has 5 arms against an 8-variant enum" — the count is exact and the *because* is
   wrong.** The operative cause is that **`tokenLabel(t, 'event', …)` has zero call sites in
   4,829 files**: the three render sites (`EventLogList.tsx:251,:479`,
   `EventDetailModal.tsx:17`) print `event.status` directly and never consult the table at
   all. The narrow table is real and is a second, independent defect — `processed` and
   `retrying` are not `PersonaEventStatus` variants, and `delivered`/`skipped`, the only two
   statuses this install holds, are absent — so **coverage would have been 0 of 4,972 even if
   the resolver had been called.** Two failures pointing the same way, which is why §4 says
   *both edits or neither*.
   **And the corollary the brief did not anticipate, which is the document's best
   type-over-gate evidence:** the *colour* and *icon* maps for the same field are
   `Record<PersonaEventStatus, …>` (`eventTokens.ts:111,134`) and are **8 of 8 correct, by
   compile error, with the rationale in the comment**. Same concept, same feature, two
   channels — the type-linked one is complete and the untyped one is 5/8 wrong.

3. **"`persona_events.source_type` holds a slugified display name for 83.8% of 4,972 rows, and
   the encoding is already lossy" — confirmed exactly (4,166 / 83.8%), and the damage is worse
   than lossiness.** The slug is not merely un-reversible, it is **not unique**: eight distinct
   slugs each map to **7 different persona ids**, covering **4,118 rows (82.8%)**. And the
   sharper half the brief did not name: **`source_id` carries the true id on 4,166 of 4,166
   rows and resolves 100% of the time** — the correct answer is in the same row, one field
   away, and `EventLogList.tsx:199-201` reaches past it. This is a two-line client fix, not a
   schema problem.

4. **"258 per-item verdicts exist across three stores and 0 are recoverable… That string is
   what an audit view renders." — confirmed, credited to
   [`selective-per-item-verdicts`](./selective-per-item-verdicts.md), and the audit-side
   finding is a different one.** I verified independently that **0 of 194 `reviewer_notes`
   rows contain a `Decisions:` block**, so the flattened-verdict string that path measured has
   never reached an audit surface at all. What `ActivityModals.tsx:139` and
   `ReviewDetailPanel.tsx:288` *do* render, in italics, under a heading that says
   "Reviewer notes", is the **machine's own note** on **168 of 194 rows (86.6%)**. The brief
   pointed at a lossy string; the measurement found the field carrying a *different* payload
   entirely, and one that misattributes authorship rather than losing detail.

5. **"`fleet_decisions`: 10 of 46 rows have an empty `session_id`; 7 of 25 hold an id from
   another namespace." — the first clause is exact; the second understates it and the shape is
   different.** 10 of 46 empty: confirmed. But **`fleet_sessions` holds 0 rows**, so **0 of the
   36 non-empty `session_id`s resolve** — not 7 of 25. The more useful finding is next to it:
   **35 of 46 rows (76%) carry no `rationale`, no `confidence` and no `decision_class`**, and
   **the table has no reader at all** — `fleet_decisions::recent()`, documented *"for an
   observability surface"*, has zero callers and no registered command, while two component
   comments call the table *"the authoritative audit trail"*.

6. **"Read-only by nature — which makes the hazard fidelity, not safety." — confirmed as the
   right frame, and one measured qualification.** Fidelity is where every finding landed. But
   the *write* side has one safety property this leaf must keep in scope, because it is the
   thing the fleet is worst at and this repo is best at:
   `db/src/repos/resources/audit_log.rs:40-49` counts a failed audit write on a process-wide
   counter surfaced on `vault_status`. Two of four siblings lose the trail silently, one
   wired its own boolean-returning mechanism into 4 of ~24 call sites. **P8 is in the head
   because of that measurement, not because the brief asked for it.**

7. **A correction to my own instrument, offered because the doctrine asks for it — twice, and
   both errors were silent.** (a) My structural verifier's first draft excluded newlines from
   its Rust string-literal class, so **every multi-line SQL literal in the repo was
   invisible** and it reported 33 matches where the census found 141 — a 4× undercount that
   reads as a clean codebase. (b) Its second draft used `\\.` for an escaped character, and
   `.` does not match a newline, so a **Rust line-continuation inside a SQL literal**
   terminated the string early and split `ORDER BY` from its `LIMIT`; it reported 104. Only
   after both fixes did the two implementations reconcile at **identical file membership
   (78 = 78, zero files unique to either) and 141 vs 140 matches**. Neither error would have
   been visible with one implementation, and neither was visible from the numbers themselves —
   both drafts produced plausible, confident, wrong totals. **The disagreement was the
   instrument; the agreement was only the receipt.**

8. **A correction offered upward to a neighbouring path.**
   [`aggregate-count-display`](./aggregate-count-display.md) §2(c) prescribes typing an
   unmeasured count as `number | null` and rendering a neutral affordance rather than a hidden
   badge, and frames it as a *count* problem. Measured from this side it is not about counts
   at all — it is the general rule that **any field an audit-shaped surface renders has three
   states (unmeasured / recorded-as-empty / recorded), and the first needs pixels.** The same
   defect appears here on identity (`{entry.actor && …}`, 14 of 15 rows), on time
   (`{timeAgo && …}`), and on provenance (`{f.generatedBy && …}`), none of which its rule can
   see. Two leaves reached the same clause on different nouns without contact, which is the
   corpus's own definition of physics — and the convergence sweep independently returned
   **3 of 3** on the identity axis.
