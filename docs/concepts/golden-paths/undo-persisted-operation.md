# Undo of a persisted operation

> Situation node: `client-runtime / mutations-and-editing /
> undo-persisted-operation` · [situation spine](../situation-spine.json)
> `sides: "client"` · `twoSided: true` · `fusedAcrossSides: false` ·
> `recurrence: 2` · `risk: high` · `convergence: "converged"`.
> Dimensions: **function · resilience · ui**.
> Spine `why`: *"Ctrl+Z reversing an edit that already reached the backend."*
>
> **Full contract** (Mode 2 tiering: `risk: high`).
>
> Composed 2026-08-17 against `master @ 29e28aa8f`. Sweep:
> `src-tauri/db/src/journal.rs` (488 lines),
> `src-tauri/db/src/attribution.rs`,
> `src-tauri/db/src/repos/execution/change_journal.rs` (757 lines),
> `src-tauri/db/src/backup.rs` (199 lines),
> `src-tauri/src/commands/execution/journal.rs`,
> `src-tauri/src/engine/mod.rs:352-382`,
> `src/features/shared/components/modals/ExecutionDetailModal/DataDiffSection.tsx`,
> `src/features/agents/quick-answer/triage/{triageDispatch.ts,useUnifiedTriage.ts}`,
> `src-tauri/db/src/repos/core/{personas.rs,memories.rs}`,
> plus a three-implementation inventory of every reversal door in the IPC
> surface (`src/api/**`, `lib.rs`'s `generate_handler!`,
> `commandNames.generated.ts`) and row counts replayed against **both** the
> 2026-08-17 purge backup and the live post-purge database, plus the three
> surviving files in `%APPDATA%\com.personas.desktop\backups\`.
>
> **⚠ Every row count below is historical as of 2026-08-17 and
> unreproducible.** On that date the operator authorized a purge that deleted
> **20,342 rows across 25 tables**. Counts marked *(backup)* come from
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`
> (347,054,080 B). Counts marked *(live)* come from the post-purge
> `personas.db` and are cited **only** where the post-purge state is the
> evidence — which, for this leaf, is the whole point.

---

## §0 — Headline

**This repo built a real undo. It captures a before-image of every write on a
nine-table allowlist, reverse-replays a run in one transaction, and parks rather
than clobbers any row a second writer touched since. It has 229 before-images on
disk right now. It cannot address a single one of them.**

Three numbers, each measured twice:

| | measured | where |
| --- | ---: | --- |
| `change_journal` rows, pre-purge *(backup)* | **228** | `SELECT COUNT(*) FROM change_journal` |
| `change_journal` rows, post-purge *(live)* | **229** | same, live file |
| of those, rows carrying an `execution_id` | **0** | `WHERE execution_id IS NOT NULL` |
| distinct execution ids in the journal | **0** | `COUNT(DISTINCT execution_id)` |
| rows ever marked `undone` or `conflict` | **0** | `WHERE undo_status IS NOT NULL` |

Both read doors are `WHERE execution_id = ?1`
(`change_journal.rs:216` and `:261`). `undo_execution(execution_id)` is the only
write door (`commands/execution/journal.rs:37`). **A journal row with a NULL
execution id is unreachable from every command in the IPC surface**, and 229 of
229 are NULL.

And the operation that most needed reversing was not in the journal at all:

> On 2026-08-17 the purge deleted **78 personas** and **6,535 memories**. Both
> `personas` and `persona_memories` are on the journal allowlist
> (`journal.rs:55-65`). The journal captured **zero** of those 6,613 deletes.
> Journal row `#228` is a `persona_events` delete at `09:24:39`; row `#229` is a
> `personas` **insert** at `15:36:17` — the replacement persona, created after
> the purge. The hook was alive on both sides of the event and saw nothing in
> between, because **the purge was executed by a process that was not the app**,
> and the capture is a `preupdate_hook` registered per *pooled connection*
> (`cdc::CdcCustomizer::on_acquire` → `journal.rs:143`). The module's own header
> states this limitation for the `personas-mcp` sidecar
> (`attribution.rs:26-29`); nothing extends it to the general case, which is
> that **any writer holding its own handle on the file is invisible to the
> reversibility ledger.**

The fallback the operator actually relied on is a file copy — and the app's own
file copy would not have been there:

| backup file, `%APPDATA%\com.personas.desktop\backups\` | `personas` | `persona_memories` |
| --- | ---: | ---: |
| `personas-20260817-153613-00.db` | **0** | **0** |
| `personas-20260817-165539-00.db` | 1 | 0 |
| `personas-20260817-174712-00.db` | 1 | 0 |

`backup.rs` keeps `MAX_BACKUPS = 3` sets and writes one **per boot**
(`backup.rs:28`, `:48`, called from `db/src/lib.rs:296`). Three boots on
2026-08-17 rotated every pre-purge snapshot off the disk **inside two hours and
eleven minutes**. The only surviving copy of the pre-purge database is
`purge-backup-2026-08-17/`, a directory the application does not create, does
not know about and does not rotate — i.e. **the recovery worked because a human
made a copy by hand.**

So the leaf's question — *what makes an operation undoable?* — has a measured
answer in this repo, and it is not "a change journal" and not "a backup". It is:
**an operation is undoable when its before-state is captured by something that
cannot be bypassed, keyed on an identity the operation actually has, and
reachable from the surface that performed it.** This repo satisfies the first
clause for 9 of 244 tables, the second for 0 of 229 captured rows, and the third
for 0 of the 21 destructive maintenance doors — the one undo button in the app
lives in a collapsed section of an execution-detail modal
(`DataDiffSection.tsx:105-116`), which is the one place a delete never happens.

---

## §1 — Trigger

You are in this situation when you catch yourself typing or saying:

1. "The user deleted the wrong thing — can we give them an undo?"
2. "Add Ctrl+Z to this editor." (…and the editor saves on blur.)
3. "Let's add a trash / recycle bin / 30-day restore."
4. "We should snapshot before this migration / bulk edit / purge."
5. "Make this operation reversible." / "This should be safe to try."
6. **The if-you-are-about-to-write-X test:** you are about to write
   `conn.execute("DELETE FROM …")`, `UPDATE … SET`, or a `.then(() => refetch())`
   after a destructive IPC, **and you cannot name the query that would put the
   rows back.**

It is NOT this leaf when the state never reached the backend — an unsaved form
draft is [`entity-draft-editing`](./entity-draft-editing.md); a confirm dialog
is [`delete-semantics`](./delete-semantics.md); a version list you can restore
*from* is [`definition-version-history`](./definition-version-history.md).

---

## §2 — The one way

**Capture the before-state on the same transaction as the change, key the
capture on an identity every writer has, and put the reversal on the surface
that performed the operation — then say, in the UI, for how long it will be
there.** Concretely, in this order, because each clause is worthless without the
one before it:

(a) **Decide the reversal class before you write the mutation**, and write the
answer in the DDL or the function's doc comment. There are exactly four, and
they cost different amounts: *state-flip* (a `lifecycle`/`tier`/`status` column
you can set back — cheapest, and the only one that survives a schema change),
*version-restore* (a prior row you can re-apply — needs a writer that never
skips), *journal-replay* (a captured before-image — needs a capture that cannot
be bypassed), *snapshot-restore* (a file copy — the only one that reverses a
cascade, and the only one that cannot be partial). Anything not in one of the
four is **irreversible**, and that word belongs in the confirm.

(b) **Key the capture on an identity the operation actually carries.** Not
`Option<execution_id>` — a nullable key means the rows a user produces are
captured and unaddressable, which is strictly worse than not capturing them
(you pay the write and the retention and get nothing). Give every write a
non-optional scope: `Execution(id) | UserAction(id) | System(reason)`. The
`UserAction` arm is what makes a Ctrl+Z over persisted state possible at all.

(c) **Capture where the writes are, not where you wish they were.** A hook on a
connection pool covers only the process that owns the pool; a trigger covers the
database. If a second process, a CLI, a migration or a support script can write
the file, the ledger must live in the file (a SQLite `AFTER DELETE`/`AFTER
UPDATE` trigger writing the old row) or it is advisory.

(d) **Make the reversal reachable from the surface that performed the
operation.** The correct affordance for a delete is a toast with an *Undo* on
it, on the page where the delete happened, for a bounded window. An undo that
lives on another screen is an audit tool, not an undo.

(e) **Refuse honestly when you cannot reverse.** Derive "is this reversible?"
from the operation, not from the button — `reversibleStatus(decision)`
(`triageDispatch.ts:316-343`) returns `string | null` and the deck offers undo
only for the non-null arms, with the reason for each `null` written in the
source. *"An undo button that cannot deliver is worse than no undo button"* —
that comment is this leaf's whole ethic and it is already in the tree.

(f) **Reverse against the state you left, not the state you saw.** The reversal
is a compare-and-swap: it must check that the row still holds what your write
put there, and **park** — never clobber — when it does not.
`plan_entry` + `is_foreign_write` (`change_journal.rs:125-184`) is the reference
implementation; it treats *unattributed* writes as foreign, which is the correct
conservative default.

(g) **Say how long the undo lasts, in the UI, in the same words as the
retention constant.** `RETENTION_DAYS_ATTRIBUTED = 60` /
`RETENTION_DAYS_UNATTRIBUTED = 14` (`journal.rs:277-280`) are pruned at writer
startup and appear nowhere on screen; the panel says only *"runs older than the
journal retention window have no entries"* (`DataDiffSection.tsx:130`). A
reversibility guarantee the user cannot read is not a guarantee.

(h) **Return a receipt from the reversal and render it.** `UndoExecutionResult`
(`change_journal.rs:101-107`) carries `undone`, `conflicts[]` and
`skipped_already_processed`, and `DataDiffSection.tsx:142-152` renders all
three. That is the shape; copy it.

If you can only afford one clause, take (a) and write the word
**irreversible** into the confirm. The second-cheapest real reversal in this
codebase is (b)+(d) over a `lifecycle` column — a state-flip archive with a
Restore on the same list — which `personas` already has and no other entity
does.

---

## §3 — Mandated primitives

| primitive | what it gives you |
| --- | --- |
| `db/src/journal.rs` — `register_preupdate_capture`, `JOURNAL_TABLES`, `spawn_journal_writer` | Before-image capture for 9 allowlisted tables via SQLite's `preupdate_hook`, batched (`BATCH_MAX = 256`) off the write path onto a dedicated thread. Values are serialized **as stored** — encrypted columns stay ciphertext (`journal.rs:23-26`), BLOBs round-trip as `{"$hexBlob": …}` (`:230`). |
| `db/src/attribution.rs` — `with_execution`, `ThreadAttributionGuard`, `current_execution_id` | The scope that stamps a write. `tokio::task_local!` for async, an RAII thread-local for `spawn_blocking`. Read synchronously from inside the hook, so no repo signature changes anywhere. |
| `db/src/repos/execution/change_journal.rs` — `get_execution_data_diff`, `undo_execution`, `plan_entry`, `is_foreign_write` | The read + reverse-replay side. One transaction, per-entry conflict parking, idempotent re-run, `pragma_table_info` + allowlist re-validation before any SQL is built from a before-image (`:151-155`, `:306-318`). |
| `UndoExecutionResult` / `UndoConflict` (ts-rs exported) | The receipt: `undone`, `conflicts[] {journalId, table, rowPk, reason}`, `skippedAlreadyProcessed`. |
| `shared/components/modals/ExecutionDetailModal/DataDiffSection.tsx` | The only undo UI. Lazy-loads on expand, renders the diff with per-row before-images, arms a second confirmation, renders the receipt. |
| `triage/triageDispatch.ts` — `reversibleStatus`, `UndoableDecision`, `undoDecision` | The honest-refusal primitive. Derives reversibility from the decision, refuses to render undo where no reverse door exists, and reverses as a compare-and-swap against `producedStatus`. |
| `db/src/backup.rs` — `backup_before_migrations` | The snapshot-restore class. Copies `.db` + `-wal` + `-shm` **before the pool opens the file**, so a plain `fs::copy` is a consistent snapshot. Never returns `Err`: boot is never blocked by a failed backup. |
| `repos/core/personas.rs:758-800` — `archive_persona` / `restore_persona` | The state-flip class, done right: `lifecycle` moves `active → archived` with **no data deleted**, and `restore_persona` moves it back. |

**Do not invent a second journal, a second attribution scope, or a second
backup path.** All three exist and all three are better than what a new one
would be on its first day.

---

## §4 — Steps

1. **Name the reversal class in the doc comment of the mutation you are about
   to write** (state-flip / version-restore / journal-replay / snapshot /
   irreversible). If the answer is "irreversible", stop here and go make the
   confirm say so — §2(a).

2. **If the entity has a natural resting state, prefer state-flip.** Add a
   `lifecycle` (or reuse one) rather than deleting. Cost: one column, one
   `WHERE` term on every list query. Benefit: reversal is a one-line UPDATE,
   survives every future schema change, and needs no capture, no retention and
   no conflict model.

3. **If you need journal-replay, put the table on `JOURNAL_TABLES` and check
   the three preconditions:** a TEXT `id` PRIMARY KEY (undo addresses by pk,
   never by reusable rowid — `journal.rs:46-47`), no composite PK
   (`memory_edges` is excluded for exactly this), and no security objection to
   resurrection (`persona_credentials` is excluded for exactly this). Write the
   reason for an exclusion beside it, as that file does.

4. **Ask whether the type can make the un-addressable row unspellable** — §9
   below and the contract's "prefer a type over a gate". For this leaf the
   answer is yes and it is one enum.

5. **Wire the reversal into the surface that performed the operation.** A toast
   with an Undo, or an inline chip, on the page that fired the mutation. Bound
   it. Copy `useUnifiedTriage`'s undo-with-timer shape
   (`useUnifiedTriage.ts:436-437`) rather than inventing one.

6. **Make the reversal a compare-and-swap and park on conflict.** Never
   overwrite a third party's later write to undo your own. Copy `plan_entry`.

7. **Return a receipt and render every field of it** — reversed, parked,
   already-processed. §2(h).

8. **And then stop.** Once the table is on the allowlist, the write path is
   already captured — you add no calls, change no repo signature, and thread no
   parameter. That property is why the hook design is right, and it is the
   reason step 3 is the whole of the backend work.

---

## §5 — Anti-patterns

- **A nullable capture key.** `change_journal.execution_id TEXT` nullable is the
  defect that makes 229 captured before-images unreachable. The failure mode is
  not a crash — it is a feature that looks implemented, has a table, has rows,
  has tests, and answers no question a user can ask.

- **Capturing at the pool instead of at the file.** A `preupdate_hook` is
  registered on connections *this process* opens. Any migration script, support
  tool, sidecar, or agent with `better-sqlite3` writes past it silently. The
  measured cost: 20,342 deleted rows, 0 captured.

- **Rotating a safety copy by boot count.** `MAX_BACKUPS = 3`, one per boot, is
  a retention policy denominated in *restarts*. On a developer's machine that is
  two hours; on a user's machine it may be months. The same constant means two
  different guarantees and neither is stated.

- **Naming a hook after an undo it does not implement.**
  `vault/shared/hooks/useUndoDelete.ts` is confirm-state only and its exported
  type is `UndoDeleteState`. (First recorded by
  [`delete-semantics`](./delete-semantics.md) §7; it belongs in this catalogue
  too, because the cost is that a future author greps for "undo", finds a hook,
  and assumes the problem is solved.)

- **Offering undo unconditionally.** The opposite of `reversibleStatus`. An
  undo button that no-ops teaches the user their action was taken back when it
  was not — worse than the delete they were trying to reverse.

- **Undoing by re-issuing the forward operation backwards.** "Deleted a row?
  INSERT it again from what the client still has in memory." The client's copy
  is the *rendered* row: it is missing every column the list query did not
  select, every server-computed default, and every FK child. Reverse from the
  before-image or not at all.

- **Reversing a cascade with a row-level undo.** `undo_execution` re-inserts
  deleted rows by pk. It cannot restore the 14,443 rows that `ON DELETE
  CASCADE` removed from tables it never journaled, because those deletes never
  produced an entry it owns. Only the snapshot class reverses a cascade.

- **Treating a version list as an undo.** `revert_recipe_version`,
  `rollback_prompt_version`, `lab_rollback_version` and
  `webbuild_restore_version` all require a prior version row to exist.
  Pre-purge: `recipe_versions` **0**, `persona_versions` **0**,
  `persona_prompt_versions` **25** with the newest dated 2026-05-28. Three of
  the four restore doors had nothing to restore from.

---

## §6 — Evidence

**Copy this one:** `src-tauri/db/src/repos/execution/change_journal.rs`. Read
`plan_entry` (`:143-184`), `undo_execution` (`:324-390`) and `apply_undo_op`
(`:395+`) together. Everything the leaf asks for is there — one transaction,
per-entry planning, conflict parking with a reason string, idempotent re-run,
defence-in-depth revalidation of the table name against both the allowlist and
live `pragma_table_info` before any SQL is composed from stored JSON, and a
receipt. Its only defect is the key it is addressed by.

Second, for the *client* half: `triage/triageDispatch.ts:300-350`.
`reversibleStatus` is the best short piece of reasoning about undo in the
repository — it enumerates, per row kind, whether a reverse door exists, and
writes down why each `null` is `null` (the backend state machine has no path
back to `pending`; the CLI already resumed; the rule is written and there is
deliberately no second policy writer). Then `undoDecision` *throws* rather than
no-op when a caller ignores that, for the same reason.

Third, for the state-flip class: `repos/core/personas.rs:758-800`.
`archive_persona` moves `lifecycle` to `archived` **preserving all history**,
refuses on system personas, and `restore_persona` moves it back. This is the
cheapest correct reversal in the codebase and the only entity that has it.

Fourth, for the snapshot class: `db/src/backup.rs`. Note two decisions worth
copying independently of this leaf: it runs **before the pool opens the file**,
which is what makes a plain `fs::copy` of `.db` + `-wal` a consistent snapshot
(`:44-47`); and it removes a truncated half-copy on failure rather than leaving
something that looks like a backup (`:113-115`).

Fifth, the receipt render: `DataDiffSection.tsx:142-152`, which shows reversed,
parked *and* already-processed, each in its own colour, and
`:38-42`, which pre-warns per row that undo **will** park this one.

---

## §7 — Deviations

### D1 · The undo's key is nullable, and 229 of 229 captured rows are NULL — P0

`change_journal.execution_id` is nullable by design (`journal.rs:27-29`:
*"NULL for ordinary user-driven writes"*), and both readers filter
`WHERE execution_id = ?1` (`change_journal.rs:216`, `:261`). Measured on both
files:

| | backup (pre-purge) | live (post-purge) |
| --- | ---: | ---: |
| rows | 228 | 229 |
| `execution_id IS NOT NULL` | **0** | **0** |
| `undo_status IS NOT NULL` | 0 | 0 |
| distinct tables captured | 2 (`persona_events`, `memory_nodes`) | 3 (+`personas`) |

The 122 `persona_events` updates and 41 deletes in that journal each carry a
complete before-image. There is no command that can list them, and no command
that can reverse them. **The app is paying the capture cost and the retention
cost for a ledger with no reader.**

Two things make this *not* merely "the feature has not been exercised". First,
the design deliberately captures unattributed writes — the 14-day
`RETENTION_DAYS_UNATTRIBUTED` window exists specifically to keep them
(`journal.rs:279-280`, *"kept only to make conflict detection complete"*).
Second, the conflict model already models them as first-class
(`is_foreign_write` treats `None` as foreign, `change_journal.rs:125-127`). The
capture and the conflict model both know about user writes; only the
*addressing* does not.

### D2 · The largest destructive operation in the app's history was invisible to the capture — P0

`personas` and `persona_memories` are both on `JOURNAL_TABLES`. The 2026-08-17
purge removed 78 and 6,535 rows respectively. `change_journal` gained **zero**
rows in that window and exactly **one** row afterwards (`#229`, a `personas`
insert at `15:36:17`, the replacement persona) — so the hook was demonstrably
installed and working on both sides.

The cause is structural, not a bug in the journal: capture is a
`preupdate_hook` on connections opened by *this process's* pool
(`journal.rs:139-146`, registered from `cdc::CdcCustomizer::on_acquire`). Any
other writer on the same file is outside it. `attribution.rs:26-29` documents
this for one case (the `personas-mcp` sidecar via `open_pool_at`) and calls it
a *"known v1 limitation (documented, accepted)"*. The general case — a script,
a support tool, an agent — is not documented anywhere, and it is the case that
fired.

The fix that reaches every writer is a SQLite `AFTER DELETE` / `AFTER UPDATE`
trigger writing the OLD row into `change_journal`, because a trigger lives in
the file. Cost: it runs inside the writing transaction (the hook does not), and
it cannot read a task-local — so the scope column would have to be a
`PRAGMA`-set session value or NULL, which is exactly the addressing problem D1
already has. **The two defects are one defect**, and both are fixed by the same
edit: give the capture a non-optional scope and let "unknown external writer"
be a spellable value of it.

### D3 · The app's own safety copy rotates in boots, and had discarded the pre-purge state before the day was over

`MAX_BACKUPS = 3` (`backup.rs:28`), one snapshot per boot (`:48`, called at
`db/src/lib.rs:296`). Measured on this machine, 2026-08-17: all three surviving
snapshots are post-purge (`personas` = 0, 1, 1). The window they span is
**15:36:13 → 17:47:12**, two hours eleven minutes.

Two independent problems in one constant:

- The retention is denominated in restarts, so the guarantee it provides varies
  by two orders of magnitude between a developer's machine and a user's, and is
  stated nowhere.
- The trigger is *boot*, not *destruction*. A snapshot taken before the
  operation that needs reversing is worth more than three taken after it. The
  module's own header explains the boot trigger honestly (`:15-20`: there is no
  schema-version counter, so there is no cheap "will this boot change
  anything?" signal) — but that argument is about migrations, and the file has
  since become the only snapshot mechanism in the product.

### D4 · Nine reversal doors, one of which reverses an arbitrary write — and three of the rest have nothing to restore from

Three independent enumerations (client `src/api/**` invoke sites; `lib.rs`
`generate_handler!` registrations; `commandNames.generated.ts`) agree exactly:
**9** commands in the entire IPC surface can undo anything.

| door | class | state it needs | rows available *(backup)* |
| --- | --- | --- | ---: |
| `undo_execution` | journal-replay | `change_journal` rows with an execution id | **0** |
| `restore_persona` | state-flip | `personas.lifecycle = 'archived'` | **0** (76 active, 2 draft) |
| `reopen_audit_incident` | state-flip | a resolved incident | 65 |
| `rollback_prompt_version` | version-restore | `persona_prompt_versions` | 25, newest **2026-05-28** |
| `revert_recipe_version` | version-restore | `recipe_versions` | **0** |
| `lab_rollback_version` | version-restore | `persona_versions` | **0** |
| `webbuild_restore_version` | version-restore | web-build snapshots | n/a (feature-gated) |
| `gitlab_rollback_persona` | external VCS | a GitLab commit | n/a |
| `gitlab_rollback_from_history` | external VCS | a GitLab commit | n/a |

Against **21** maintenance/destructive doors on the client
(see [`maintenance-affordances`](./maintenance-affordances.md) §7) and 244
tables. `reopen_audit_incident` is the only reversal door in the app with a
populated backing store, and what it reverses is a triage verdict, not data.

### D5 · The undo is not on the surface that performs the operation — and never can be, given the key

`DataDiffSection` renders inside `ExecutionDetailModal`, behind a collapsed
"Data changes" disclosure (`:105-116`), and loads lazily on expand (`:86-88`).
To reverse a run's writes the user must: open Activity → open a run → expand a
collapsed section → read a diff → arm a confirm → confirm. That is an audit
workflow. Every *destructive* surface in the app — the three `Delete all`
buttons, the 52 UI delete paths with no confirmation at all, the vault, the
teams list — has no reversal affordance of any kind, because the operations
those surfaces perform have no execution id, which is D1 again.

### D6 · The retention window is a reversibility guarantee, and it is not on screen

`RETENTION_DAYS_ATTRIBUTED = 60`, `RETENTION_DAYS_UNATTRIBUTED = 14`
(`journal.rs:277-280`), pruned once per app launch (`prune_journal`, `:422`).
The panel's only mention is *"runs older than the journal retention window have
no entries"* (`DataDiffSection.tsx:130`) — no number, and not localized as a
number. Measured consequence: the oldest journal row in the backup is
`2026-08-03 18:56:26`, exactly 14 days before the measurement date. The window
is real, it is enforced, and the user cannot learn its size from the product.

### D7 · Capture drops are counted and reported to nobody

`note_journal_drop` (`journal.rs:89-104`) increments a static counter and warns
once, then every 1000th time, with the correct severity: *"a permanent gap in
the reversibility ledger for that row"*. `journal_dropped_count()` is a public
accessor. **It has zero callers** outside the module — no command, no metric,
no health panel. A ledger that can silently become incomplete needs its
incompleteness on the same screen as the undo button; otherwise the receipt
("14 reversed") is unqualified by "and 3 were never captured".

### D8 · The one undo call site logs its failure through `silentCatch`

`DataDiffSection.tsx:99` — `undoExecution(...).catch(err => { silentCatch(...)(err); setUndoError(true); })`. The
UI shows *"Undo failed — no changes were applied."*, which is correct and
honest. But the user's only reversal in the product fails to Sentry-and-console
rather than to a toast, so a support conversation about "undo did nothing" has
no user-visible artifact to start from. Compare
[`swallowed-error-telemetry`](./swallowed-error-telemetry.md) §2: this is the
right door for a *background* error and the wrong one for the outcome of a
button the user just pressed.

### D9 · `ThreadAttributionGuard` has no production caller

`attribution.rs:66-80` provides the RAII fallback for synchronous and
`spawn_blocking` paths. Measured across 963 `.rs` files: **one** reference
outside the module, at `change_journal.rs:506`, inside `#[cfg(test)]`. The
production attribution surface is a single call — `with_execution` at
`engine/mod.rs:366`, wrapping `runner::run_execution`. That is a clean design
(one injection point, no repo signature changes) and it is also the entire
reason the journal's addressable population equals "writes issued inside an
agent run and nothing else".

### D10 · A tombstone lane that never had a writer — and the day it was needed, it stayed empty

`persona_tombstones` (`incremental.rs:3479-3492`) exists so hard-deletes
propagate across devices *"instead of resurrecting on the next pull"*, is
indexed, sync-watermark-indexed (`:8135`), read by `fetch_tombstones` and
drained by `process_tombstones`. It held **0 rows before the purge and 0 rows
after it**, with 78 personas deleted in between. First recorded by
[`delete-semantics`](./delete-semantics.md) §7 as "zero writes anywhere"; this
is the post-hoc confirmation, and it upgrades the finding — the table is not
merely unwritten, it is unwritten *across the largest delete the product has
ever performed*, which is the exact event it was introduced for.

---

## §8 — Gaps: what the primitive genuinely cannot do

1. **No row-level undo reverses a cascade.** The purge's 20,342 rows include
   14,443 taken by `ON DELETE CASCADE` from tables that are not on the journal
   allowlist and, in most cases, could not be (composite keys, audit tables that
   must outlive their subject). Re-inserting a parent does not bring children
   back, and re-inserting children in the wrong order fails FK checks. The
   snapshot class is the only correct answer to a cascade, and it is
   all-or-nothing by construction.

2. **The before-image is ciphertext, on purpose, and that bounds the diff UI.**
   `journal.rs:23-26` never decrypts; `persona_events.payload` therefore
   journals as ciphertext and `DataDiffSection` says so on screen
   (`:54`). This is the right security decision and it means the data-diff panel
   can never show a human-readable diff of an encrypted column. A reviewer
   deciding *whether* to undo is looking at `"gcm:…"`.

3. **A `preupdate_hook` cannot see a `DROP TABLE`, a `VACUUM`, or a schema
   migration.** The reversibility ledger is row-level. Anything that changes the
   container is outside it, which is precisely why `backup.rs` exists and why
   the two mechanisms are complements rather than alternatives.

4. **A bounded channel means capture is lossy under load, and the loss is
   unrecoverable.** `create_journal_channel(capacity)` + `try_send` +
   `note_journal_drop`: correct for a hook that must not block a write
   transaction, and it means the ledger's completeness is a probabilistic
   property under burst. There is no backpressure option that does not make the
   hook block the writer.

5. **Undo of an operation that had external effects is not undo.** Reversing
   the rows a run wrote does not un-send its Slack message, un-spend its tokens,
   or un-create its GitHub issue. `JOURNAL_TABLES` deliberately excludes
   `persona_executions` (*"undoing a run must not erase the evidence that the
   run happened"*, `journal.rs:50-51`) — that exclusion is right, and it also
   means the receipt is silent about everything that left the machine.

6. **The undo's own writes are captured.** `change_journal` is excluded from the
   allowlist *and* re-guarded inside the hook (`is_journaled_table`, `:68-75`),
   but an undo's re-inserts into `personas` **are** journaled, unattributed, and
   therefore count as foreign writes for the next undo — the conservative
   default parks them. Correct, and it means a second undo pass over an
   overlapping set is more likely to park than the first.

---

## §9 — The missing gate

### The gate is declined, and here is the measurement that declined it

**What a gate would have to key on: an absence** — "this operation has no
capture, so nothing can put the rows back". The doctrine's own §4 records that
*the census cannot assert an absence*; it ratchets a count of something present.
Three candidate proxies were built and measured, and each failed for a
different, reportable reason:

| candidate | measured | why it is not shippable |
| --- | --- | --- |
| **A destructive write to a table outside `JOURNAL_TABLES`** | 9 of 244 tables are journaled; 266 predicated `DELETE` statements + 6 unpredicated ones exist across 93 files | The condition is at **~97% prevalence by table**, which is *by design* — the allowlist is curated and its exclusions carry written reasons. A gate here fires on correct code at scale. |
| **A UI surface that performs a destructive call and offers a reversal** | violating ~100 statement-position `await delete*/clear*/remove*` calls; **compliant: measured 0** post-delete undo affordances in `src/features/**` | **0% compliance.** The census cannot express this: a positive control with nothing to match is indistinguishable from a broken pattern (doctrine §4). This is the *"say which of the two it is, and prove it"* case — it is genuine 0% compliance, and the proof is that `delete-semantics` §8 reached the same conclusion by a different route ("there is no post-delete undo, no trash, and no recycle bin"). |
| **A mutation whose receipt is discarded by the caller** (`await deleteX()` unbound) | violating **~100 matches**, compliant **5** | Precision fails: most of these commands return `()`, so there is no receipt to bind and the match is not a defect. Narrowing to the count-returning doors leaves **n = 3**, all three already named in §7 of [`maintenance-affordances`](./maintenance-affordances.md) — a rule that duplicates a neighbour's evidence at n=3. |

Overlap that would also have to be cleared, checked at **site** level against
final patterns: `blind-identity-write` (`repository-crud-surface.md`, 35 files /
82 matches, `UPDATE|DELETE … WHERE id = ?` in a `Result<()>` fn) already matches
the shape any "reversal has no evidence" rule would reach for in the repo layer;
`retention-delete-by-status-allowlist` (3/3) and the rule this batch publishes,
`countless-table-wipe` (3/3), partition the unpredicated deletes between them.
There is no residual site population for a fourth rule.

### Prefer the type — and here it is

This leaf's defect **can be made unspellable**, which outranks a gate.

```rust
/// The scope that owns a captured write. Non-optional by construction: every
/// row in `change_journal` is addressable by exactly one of these.
pub enum WriteScope {
    /// Issued inside an agent run (`attribution::with_execution`).
    Execution(String),
    /// Issued by the user through the IPC surface. The id is minted per
    /// command invocation, which is what makes a per-action Undo possible.
    UserAction(String),
    /// Issued by a scheduled/boot/background task, named by its job.
    System(&'static str),
    /// Observed on the file by a writer this process does not own — only
    /// reachable if capture moves into a SQLite trigger (D2).
    Foreign,
}
```

Held against the doctrine's seven qualifications:

- **Q1 (a required prop carries only what it encodes).** It encodes
  addressability and nothing else — deliberately. It does not claim the write
  was *safe* to reverse; `plan_entry` still decides that.
- **Q2 (requiredness ≠ closedness).** Making `execution_id` `NOT NULL` would be
  the wrong edit: `None` is *legitimate* today for 229 rows. Closedness is the
  entire win, exactly as [`scheduled-trigger-firing`](./scheduled-trigger-firing.md)
  found for `timezone`.
- **Q3 (a type nobody constructs constrains nothing).** Construction sites are
  **1** (`with_execution`, `engine/mod.rs:366`) plus the hook's fallback arm —
  and that is the point: the hook currently constructs `None` at three call
  sites (`journal.rs:169`, `:186`, `:206`) and would be forced to construct
  `UserAction(_)` or `System(_)` instead. The enum is *cheap here precisely
  because* the attribution surface is one function.
- **Q4 (a type anyone can construct authenticates nothing).** Not applicable —
  this is an addressing key, not a credential. It makes no authenticity claim.
- **Q5 (withholding beats requiring).** Applied: the hook is not *asked* for an
  optional id, it is *given no way* to record an unaddressable write.
- **Q6 (withhold the dangerous freedom, not the answer).** The freedom being
  withheld is "record a write nothing can name". The answer — which write, which
  before-image — is untouched.
- **Q7 (relaxing is inert where the caller supplies the bad value).** The caller
  does not supply `None` voluntarily; `current_execution_id()` returns it
  because the scope is absent. Closing the type forces that absence to become a
  named value at the one place that can name it.

**The mandatory second half — what makes the primitive correct by default**
(contract §9, the "gate on a broken destination" failure): the enum is worthless
if `undo_execution(execution_id)` remains the only door. The type change must
land together with a door keyed on the scope — `undo_scope(scope)` — and with
`get_execution_data_diff` generalised the same way, or the corpus repeats the
`<Numeric>` mistake of routing callers to a primitive that is wrong by default.

### What a gate could still usefully assert, and where it must live

Not a census rule — a **precondition assertion inside the journal writer**, in
the style of `check-corpus-integrity.mjs` and `check-csp-hosts.mjs`: on startup,
after `prune_journal`, assert that `SELECT COUNT(*) FROM change_journal WHERE
<scope is addressable>` is non-zero *whenever* `SELECT COUNT(*) FROM
change_journal` is non-zero, and `tracing::error!` when it is not. That is the
one check that would have fired every day since 2026-07-30, costs one query per
boot, and fails loudly when its own precondition (a non-empty journal) is
absent. **A ratchet cannot express it, because the number it would ratchet is
already 0.**

Filed as deferred-fix **#119** (the type + door) and **#120** (the assertion);
neither is applied here — both change runtime behaviour, and #112 changes a
persisted column's shape.

---

## §10 — The convergence oracle

**Cohort established for this leaf, at measurement time:** `../personas-web`,
`../brainiac`, `../personas-cloud`, `../vibeman`, `../ascent`. Of the five,
`personas-cloud` shares this repo's table and column vocabulary verbatim in the
execution layer (established by two prior sweeps) and `personas-web` is a
consumer of this repo's stores — so for anything touching `change_journal` the
effective independent cohort is **3**, not 5.

**The result is a silence, and it is the strong kind.** Not one of the five
checkouts has:

- a change journal, a before-image capture, or any `preupdate`/CDC-derived
  reversal ledger;
- a soft-delete column pair (`deleted_at` + a restore door) on a primary entity;
- a pre-destruction snapshot (as opposed to a pre-*migration* one);
- an undo affordance attached to a destructive control.

Under the doctrine's weighting that silence is **strong** evidence (a problem
nobody solves five times is hard or unnoticed) and the agreement half is
absent entirely — so there is nothing here to mistake for physics. It also
means the spine's `convergence: "converged"` label on this leaf is **false in
the most literal way available**: there is nothing to converge *with*. This is
the fourteenth `converged` label the corpus has tested and the fourteenth to
fail; the failure mode here is the one `embedded-terminal-session` recorded —
**a 5/5 silence being read as agreement**, with the direction backwards, since
Personas is simultaneously the only repo with the mechanism and the only repo
whose mechanism cannot be reached.

**"Personas is ahead of the fleet", stated as self-comparison and worth
stating.** `change_journal.rs` is better engineering than anything the cohort
has on this subject — the conflict model, the pk-not-rowid decision, the
allowlist-plus-`pragma_table_info` re-validation before composing SQL from
stored JSON, and the honest receipt are all things a second implementer would
get wrong. The defect is one nullable column and one missing door, not the
design.

**One genuine reinvention, from the other direction, and it is worth more than
the silence.** `../personas-cloud`'s port of this repo's scheduler **dropped the
compare-and-set** (recorded in the doctrine as the corpus's best single argument
for a type). The same shape recurs here: `is_foreign_write` is four lines
(`change_journal.rs:125-127`) and reads like bookkeeping. If this journal is
ever ported, that is the clause that will not survive the trip — which is a
second, independent argument for §9's type, since a scope enum forces the
question at the boundary instead of leaving it in a helper a careful engineer
can skip.

**Interaction with a neighbouring prescription** (contract: "check your
prescription against your neighbours'"). [`delete-semantics`](./delete-semantics.md)
§2 prescribes hard delete inside one `conn.transaction()` with an FK graph that
cascades. This path prescribes state-flip over hard delete wherever the entity
has a resting state. **These compose into a defect if applied naively**: a
`lifecycle = 'archived'` row is still a live FK parent, so a cascade-based blast
radius will report its children as "at risk" for an entity the user believes is
already gone, and every list query in the app must now carry a `lifecycle`
term or the archived row reappears. The reconciliation is that state-flip is
**in front of** hard delete, not instead of it — archive is the reversible step,
delete is the terminal one, and the blast radius belongs on the second.
`personas` already does exactly this and is the model.

---

## §11 — Cost, security and performance

**Cost of capture.** One owned-value copy per row per write on 9 tables, a
non-blocking `try_send`, and a batched INSERT of up to 256 rows per transaction
on a dedicated thread. `persona_events` is explicitly called out as the hot
table the batching exists for (`journal.rs:19-21`). Storage: 229 rows against a
347 MB database — immaterial, and it would remain immaterial at 100×.

**Security.** Two decisions are right and should not be traded away for
convenience:

- `persona_credentials` is off the allowlist because *"resurrecting revoked
  credentials via undo is a security hazard"* (`journal.rs:52-53`). Any future
  widening must re-argue this per table.
- Before-images are ciphertext and nothing in the module decrypts
  (`journal.rs:23-26`). The journal is therefore not a plaintext copy of every
  encrypted column, which it would silently have become under a "make the diff
  readable" change.
- `undo_execution` carries `#[requires(privileged)]`
  (`commands/execution/journal.rs:36`) and appears in `ipc_auth.rs:334`. Correct
  — it mutates arbitrary allowlisted tables from stored JSON. Note that
  `get_execution_data_diff`, which *reads* those before-images, carries only
  `require_auth_sync` — and `require_auth_sync` is `Ok(())`
  (`ipc_auth.rs:477-479`). The read side of the reversibility ledger is
  unauthenticated. It returns ciphertext for encrypted columns, so the exposure
  is bounded, but the asymmetry is not stated anywhere.

**Performance.** The hook runs synchronously inside every write transaction on
a hooked connection and does one `Vec` allocation plus one `try_send`; that is
the correct budget. `column_names` is cached per writer lifetime with a written
justification for why a stale cache is impossible (`journal.rs:339-341`).
`later_writes_for` (`:223-252`) issues one prepared-statement execution **per
distinct (table, pk) key** rather than one `IN` query — fine at the 500-entry
display cap, quadratic-ish at `i64::MAX` in `undo_execution` (`:332`), which is
the one place the cap is deliberately removed. Not a live problem at 229 rows;
worth knowing before the journal is ever fed a real workload.

---

## §12 — Corrections

### 12.1 · To this composer's brief — the brief's central claim is wrong

> *"The leaf's question is what makes an operation undoable, and the answer this
> repo gives is a file copy — the backup at the path named in your brief."*

**Refuted.** The repo's answer is a preupdate-hook change journal with
before-images, reverse-replay in one transaction, conflict parking, an
allowlist with written exclusion reasons, a typed receipt and a consent-gated UI
— shipped 2026-07-30 in commit `048fa452f`, *"Reversible Agent v1 — every agent
write is attributed, diffable, undoable"*. It is the best answer to this leaf in
the cohort. The file copy (`backup.rs`) is a **pre-migration** snapshot, and the
`purge-backup-2026-08-17/` directory the brief names was **not** written by it —
that path is not `backups/`, does not match `personas-<stamp>-<nn>.db`, and
`backup.rs` is the only backup writer in 963 `.rs` files. It was made by hand.

The brief's conclusion survives on completely different grounds, and the
difference matters: it is not that the repo has no undo, it is that **the undo
it has cannot address a single row it captured**, and the mechanism the operator
actually fell back on was outside the product.

> *"Measure the alternatives that exist in the tree: soft-delete columns,
> tombstones, a change journal, an audit table."*

Measured, and the taxonomy needed a fifth member. Soft-delete columns: **0**
by the brief's vocabulary (`deleted_at` / `is_deleted` / `archived_at`) — see
12.3, that vocabulary was wrong. Tombstones: `persona_tombstones`, 0 rows before
and after the purge. Change journal: 229 rows, 0 addressable. Audit tables: 10
of them, none reversible by construction. The fifth is **snapshot-restore**, and
it is the only class that reverses a cascade — which is what the day actually
required.

### 12.2 · To this composer's own first measurement — a word list from imagination

The first sweep for a reversible-state column searched
`deleted_at|is_deleted|archived_at|is_archived|tombstone` and returned
essentially nothing, which would have published "there is no soft delete
anywhere". **That is wrong.** `personas.lifecycle` is a three-state column
(`active | draft | archived`) with `archive_persona` / `restore_persona`
(`repos/core/personas.rs:758-800`) and `get_all_by_lifecycle(["archived"])` —
a correct, reversible, history-preserving state-flip on the app's central
entity. The word `lifecycle` was not in the list.

This is the doctrine's *"a vocabulary-based signal's recall is bounded by its
author's word list, and the misses cluster on the unusual cases"*, earned again.
The correct instrument was the enumeration of **reversal doors** (`restore_*`,
`undo_*`, `revert_*`, `rollback_*`, `reopen_*`), run three independent ways,
which found `restore_persona` immediately and led back to the column.

### 12.3 · To [`delete-semantics.md`](./delete-semantics.md) §8 Gap 8 — literally true, materially misleading

That path states:

> *"No trash, no undo toast, and the only `deleted_at` column in the schema
> belongs to the inert `persona_tombstones` — there is no soft delete anywhere
> (0 `is_deleted`, 0 `archived_at`, 0 `status='deleted'`, 0
> `lifecycle='deleted'`)."*

Every clause is verifiable and the parenthetical is exactly right — including
`lifecycle='deleted'`, which is 0. **And the conclusion "there is no soft delete
anywhere" does not follow**, because the value that exists is
`lifecycle='archived'`, not `'deleted'`. The measurement enumerated four
spellings of *deleted* and none of *archived*, one token away from the answer.

The correction is small and the direction matters: the repo **has** a soft-delete
mechanism, on `personas`, with both doors wired to the UI
(`PersonaOverviewActions.tsx:151,175`) — the same document says so 20 lines
earlier in §8 ("Archive/restore exists for personas … and memories"). So the
two halves of that section disagree with each other. Suggested amendment: keep
Gap 8's real finding (*archive sits **beside** hard delete rather than in front
of it*, which is the load-bearing claim and is correct) and drop "there is no
soft delete anywhere". Measured 2026-08-17: `personas.lifecycle` = 76 `active`,
2 `draft`, **0 `archived`** — so the mechanism exists, is correct, and has never
been used, which is a *different* and more actionable finding than absence.

### 12.4 · To [`delete-semantics.md`](./delete-semantics.md) §6 — an upgrade, not a correction

> *"`DataDiffSection.tsx:90-100,155-177` — the only genuine undo in the app
> (`undo_execution`) … Proof the repo can build reversal when it decides to."*

Correct on every clause, and now quantified: the undo it names has **0**
addressable rows and has never reversed anything (`undo_status IS NOT NULL` on
0 of 229). "Proof the repo can build reversal" stands; "proof the repo *has*
reversal" would not.

### 12.5 · The spine labels

- `convergence: "converged"` — **contradicted**, by silence. 0 of 5 siblings
  (effective independent cohort 3) has any reversal ledger. §10.
- `sides: "client"` — **contradicted, and inverted rather than incomplete.**
  The headline defect (a nullable capture key), the exemplar
  (`change_journal.rs`), the capture bypass (D2), the retention window (D6), the
  dropped-capture counter (D7) and the type proposal are all server-side Rust.
  The client half of this leaf is one 196-line component that renders what the
  server hands it. This is the seventh `sides: "client"` contradiction the
  corpus has recorded, and it takes the same form as the seventh: not "it was
  both", but **"it was the other one"**. Note that the same spine object carries
  `twoSided: true`, so the contradiction is internal to the spine.

### 12.6 · A measurement that had to be re-run because it agreed with the thesis

The first pass read the *live* database, found `change_journal` at 229 rows with
0 attributed, and was about to publish "the undo has never had a subject". That
is true — and the tempting adjacent conclusion, *"the purge is why"*, is false.
Re-run against the pre-purge backup: 228 rows, also 0 attributed, also 0 undone.
**The purge changed the journal by exactly +1 row, and that row is an insert.**
The doctrine's rule applied: a measurement that supports a conclusion you
already believe is the one to run again. Publishing the live number alone would
have blamed the purge for a state that predates it by two weeks, and the honest
cause is narrower and more useful — the Reversible Agent shipped **2026-07-30**
and the last execution on this install ran **2026-06-26**, 34 days earlier, so
`with_execution` has never wrapped a run on this machine. That is not a bug in
attribution; it is why D1 is a design defect rather than a regression, and the
distinction is the difference between "fix the runner" and "fix the key".
