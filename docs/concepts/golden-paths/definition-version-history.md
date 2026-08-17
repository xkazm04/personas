# Definition version history

> Situation node: `product-surfaces/authoring-and-catalogs/definition-version-history` ·
> [situation spine](../situation-spine.md) · recurrence 3 · risk **high** ·
> dimensions: ui · function · resilience · `sides: "client"` · `twoSided: true` ·
> `convergence: "mixed"`
>
> *"Generating a new version, previewing it, and accepting or rolling back."*
>
> Composed 2026-08-17 from a ground-truth sweep of the Rust tree (963 `.rs` under
> `src-tauri/`, `target/` and `.claude/worktrees/` excluded), `src/` (4,801
> `.ts`/`.tsx`), the four-file migration chain (265 `CREATE TABLE` bodies parsed),
> and **two SQLite databases**: the pre-purge backup
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`
> (347,054,080 B) and the live post-purge file. Every number below was counted or
> executed, not estimated.
>
> **Every row count in this document is historical as of 2026-08-17 and
> unreproducible.** On that date the operator authorized a purge that deleted
> 20,342 rows across 25 tables, including all 78 personas. Where a count is from
> the backup it says so. Where the purge changed it, both numbers are given.

---

## §0 Headline

**This repo has three persona version-history mechanisms. Two of them have never
written a row, and the third stopped writing on 2026-05-28 — after which 68 of
its 78 subjects were edited and 26 more were created. Then, on 2026-08-17, all 25
rows it had ever written were deleted, correctly, by a `ON DELETE CASCADE` whose
migration comment explains why that is the right behaviour.**

Executed against the backup, 2026-08-17:

| mechanism | rows (backup) | rows (live, post-purge) | writers | readers |
|---|---:|---:|---:|---:|
| `persona_prompt_versions` — the one that works | **25** | **0** | 5 production + 2 test | 13 |
| `persona_versions` + `persona_version_tools` — declared its replacement | **0** | **0** | **0** | **0** |
| `persona_change_log` — the best-engineered one in the repo | **0** | **0** | 2 | 3 |

- `persona_versions` was created by `incremental.rs:1963` under the comment
  *"Create persona_versions table (replaces prompt-only versioning)"*, with a
  one-shot `INSERT OR IGNORE` backfill from the old table, a 110-line repository
  module (`db/src/repos/lab/versions.rs`, 3 `pub fn`), a core model
  (`core/src/models/lab.rs:644`), a ts-rs binding exported from
  `src/lib/bindings/index.ts:640`, and a boot-time orphan scrub that names it
  (`db/src/lib.rs:460`). **Two independent scans found zero call sites for all
  three functions and zero importers of the binding.** It has held zero rows in
  both databases. The old table it "replaces" gained five columns after the
  replacement shipped and is still the one every writer writes.
- `persona_change_log` is the right answer to this leaf and this repo already
  wrote it: one row per *changed field*, diffed from the already-loaded `existing`
  row (no extra SELECT), written **on the caller's transaction** so the audit
  commits atomically with the edit, secrets redacted to `"(changed)"`, a 30-second
  same-field coalescing window, a 200-row per-persona retention cap, five unit
  tests. It has zero rows because its writer landed on **2026-07-27** and the most
  recent `personas.updated_at` anywhere in the backup is **2026-07-14**. It is
  **unproven, not disproven** — and that distinction is the whole finding.
- `persona_prompt_versions`' 25 rows span **2026-05-25T22:25:22Z →
  2026-05-28T21:09:27Z**: four days, 81 days before this sweep. All 25 carry
  `tag = 'experimental'`; **not one row has ever been tagged `'production'`**,
  though six code paths read, write or flip that tag and one of them
  (`lab.rs:902`) uses it to decide which prompt is live.

And the two questions the brief said to ask, answered:

**Do the two versioning systems share a mechanism or a vocabulary?** Neither, and
neither of the two the brief named. The "matrix versioning" work did *not* build a
second system — it `ALTER TABLE`d five columns (`design_context`,
`last_design_result`, `resolved_cells`, `icon`, `color`) onto the *same*
`persona_prompt_versions` table, and they are visible in the stored DDL today. The
second system is `persona_versions`, and it shares only the word `version`: a
different table, a different repository, a different model, a different binding,
and no traffic. **The defect is not two vocabularies for one concept. It is one
vocabulary over two tables, of which the canonical-by-declaration one is dead.**

**What does the history NOT capture?** A system-prompt-only edit. The only
diff-gated door, `create_prompt_version_if_changed`
(`db/src/repos/execution/metrics.rs:148`), compares `structured_prompt` and
nothing else, and its sole caller guards the whole call behind
`if let Some(ref new_sp) = input.structured_prompt` (`personas.rs:935`) — so a
payload that carries only `system_prompt` never reaches the version writer at all.
The column proves it: **16 of the 25 rows have `system_prompt IS NULL`**, and one
writer (`lab.rs:632`) inserts the literal `NULL` into that column
unconditionally.

---

## §1 Trigger

You are in this situation when you catch yourself saying, or typing, any of:

1. *"We should keep the previous version of this so the user can roll back."*
2. *"Add a `version_number` column and bump it on save."*
3. *"Show the last N versions of this prompt / recipe / skill in a timeline."*
4. *"Where did this field's old value go? The user says they changed it back."*
5. *"Snapshot the entity before we apply the AI-generated draft."*
6. **The `if you are about to write X` test:** you are about to write
   `SELECT COALESCE(MAX(version_number), 0) + 1 FROM <table> WHERE <parent> = ?1`.
   There are **six** of those in this tree and five of them are in this leaf's
   blast radius.

You are **not** in this situation for: an audit trail of *who did what*
(→ [`audit-trail-view`](./audit-trail-view.md)), showing the delta between two
versions (→ [`version-diff-view`](./version-diff-view.md)), or a model-authored
draft awaiting acceptance (→ [`ai-draft-preview-apply`](./ai-draft-preview-apply.md)).
This leaf owns **what gets written, when, and what survives**.

---

## §2 The one way

**Write the history from the change, on the transaction that applies the change,
keyed on a constraint the schema enforces — and decide, out loud and in the DDL,
whether the history outlives its subject.** Concretely: (a) compute the delta from
the entity you have *already loaded* and the input you are *about to apply*, never
by re-reading the live row (a re-read makes the snapshot a race, and it records
what the row looks like now rather than what this edit did); (b) take the caller's
`&Connection`/`&Transaction`, never a `&DbPool` — a history writer that opens its
own connection commits independently of the edit, so a later validation failure
leaves a version of a value that was never applied; (c) write **one row per
changed field**, not one blob per save, because a per-save blob cannot answer *what
changed* without a diff engine and a per-field row answers it by projection; (d)
let the *schema* own the sequence — `UNIQUE(<parent>_id, version_number)` or
`PRIMARY KEY (<parent>_id, rev)` — and allocate the number **inside the INSERT**
(`VALUES (?1, (SELECT COALESCE(MAX(rev),0)+1 FROM t WHERE …), …)`) so there is no
window between the read and the write; (e) never make the version writer
fire-and-forget with `let _ =` unless you have decided, in a comment, that losing
history is preferable to failing the edit — and then *log* the loss; (f) bound the
history at write time (a per-parent row cap, pruned on insert) rather than hoping
a retention sweep will exist; and (g) **state the deletion contract in the DDL**:
`ON DELETE CASCADE` if the history is meaningless without its subject, no FK plus a
registered orphan sweep if it must outlive it. There is no third option — a
history table with neither is an orphan farm, and this repo has exactly one such
table and it is the good one.

If you are choosing between "snapshot the whole definition" and "log the changed
fields", **log the changed fields**. The snapshot is what this repo built first
and it is the one that stopped writing; the field log is what it built second and
it is the one that is correct. A snapshot is recoverable from a complete field log
by replay; a field log is not recoverable from snapshots without a diff engine you
then also have to keep honest ([`version-diff-view`](./version-diff-view.md)
measures what happens when you don't).

---

## §3 Mandated primitives

| primitive | `path:line` | what it gives you |
|---|---|---|
| **`persona_change_log::write_diff`** | `src-tauri/db/src/repos/resources/persona_change_log.rs:213` | **The one to copy.** Takes `conn: &Connection` (the caller's tx), computes `(field, before, after)` from `existing` + `input` with no extra SELECT, redacts secret-bearing fields, coalesces within 30 s, prunes to 200 rows per parent, returns the count written. |
| `persona_change_log::compute_changes` | `…/persona_change_log.rs:65` | The field-by-field diff. 19 fields, each an explicit `if let Some(ref v) = input.X { if *v != existing.X { … } }` — reconstruction, not reflection, so a field you did not think about cannot leak into history. |
| `persona_change_log::list_for_persona` | `…/persona_change_log.rs:280` | Newest-first read with `limit.clamp(1, 500)`. The clamp is at the repo, not the command. |
| `REDACTED` / `VALUE_MAX_CHARS` / `COALESCE_WINDOW_SECS` / `RETAIN_PER_PERSONA` | `…/persona_change_log.rs:25,27,29,31` | The four policy constants, named, at the top of the file. Copy this shape. |
| `recipes::create_version` | `src-tauri/db/src/repos/resources/recipes.rs:438` | The correct *schema* for a snapshot history: `UNIQUE(recipe_id, version_number)`, `ON DELETE CASCADE` to `recipe_definitions`, and a friendly mapper for the UNIQUE violation (`recipes.rs:470`) instead of leaking the raw SQLite error. |
| the `skill_revisions` INSERT | `src-tauri/src/commands/infrastructure/skill_usage.rs:200-201` | **The only race-free sequence allocation in the tree.** `VALUES (?1, (SELECT COALESCE(MAX(rev),0)+1 FROM skill_revisions WHERE skill_id = ?1), ?2, ?3)` — one statement, backed by `PRIMARY KEY (skill_id, rev)`. |
| `list_persona_change_log` | `src-tauri/src/commands/core/personas.rs:242` | The IPC surface. One command, `limit: Option<u32>`, defaults to 50. |
| `PersonaChangeHistory` | `src/features/agents/sub_editor/components/PersonaChangeHistory.tsx` | The client half: reads the server-computed deltas and renders columns. It computes nothing. |

**Do not use** `db/src/repos/lab/versions.rs` (any of its three functions), the
`PersonaVersion` model, or the `PersonaVersion` binding. See §7 D1.

---

## §4 Steps

1. **Decide the shape first: field log or snapshot.** Ask "will anyone ever need
   to answer *what changed* without loading two rows?" If yes — and for a
   user-editable definition it is always yes — write a field log. Only choose a
   snapshot when the whole artifact is the unit of rollback (a recipe's
   `prompt_template` + `input_schema` + `sample_inputs` move together; a persona's
   19 independently-editable fields do not).

2. **Write the DDL with the constraint, not without it.** A per-parent sequence
   column gets `UNIQUE(<parent>_id, version_number)` or is part of a compound
   `PRIMARY KEY`. Twelve tables in this repo declare such a column with neither
   (§9). Without it, `ORDER BY version_number DESC LIMIT 1` — which five call
   sites in this leaf use to mean *"the latest version"* — is not merely wrong on
   a duplicate, it is **unstable**: the row it returns depends on the query plan,
   so it reproduces on one machine and not another.

3. **Declare the deletion contract in the same DDL.** `REFERENCES parent(id) ON
   DELETE CASCADE` when the history is meaningless without its subject —
   `fk_hygiene.rs:414-417` states this case well and it is correct — or no FK plus
   an entry in `cleanup_orphan_rows`' `ORPHAN_TABLES` (`db/src/lib.rs:437-448`) when
   it must survive. Do not do what this repo did, which is to register the table
   that cannot orphan and omit the one that can.

4. **Give the writer the caller's connection.**
   `fn write_diff(conn: &Connection, …)` — not `pool: &DbPool`. This is the whole
   difference between §7 D3 (a version row that commits before the validation that
   rejects it) and the exemplar.

5. **Compute the delta from what you already have.** The caller of `update` has
   `existing` in scope because it read it to check the row exists. Pass it. A
   history writer that re-SELECTs is both slower and racier, and
   `lab/versions.rs:22` shows the worst form — `INSERT … SELECT … FROM personas p
   WHERE p.id = ?3`, which snapshots the row as it is *at insert time*, not the
   values this edit is applying.

6. **Allocate the sequence inside the writing statement.** Copy
   `skill_usage.rs:200-201`. If you cannot (the number is needed in the returned
   struct), take `BEGIN IMMEDIATE` around the read and the write —
   `metrics.rs:99` does this and says why — but understand that a *deferred*
   `conn.transaction()` does **not** close the window
   ([`transaction-boundary`](./transaction-boundary.md) §7 A owns that; two of
   this leaf's writers are in its match set).

7. **Bound the history on the insert.** `RETAIN_PER_PERSONA = 200`, pruned in
   `write_diff` itself. A retention rule that lives in a sweep you have not
   written yet is not a bound — [`retention-and-pruning`](./retention-and-pruning.md)
   replayed both of this repo's cleanup functions and both delete nothing.

8. **And then stop.** Do not add a `tag`/`status` column to the history unless
   something *writes every value of it*. This repo's `tag` has three legal values,
   six code paths that set or flip it, a UI badge map with three entries
   (`labPrimitives.ts:6-10`) — and 25 of 25 rows on the value it defaults to.

---

## §5 Anti-patterns

**A. Declaring a replacement table without retiring the original.** The failure
mode is not that the new table is unused — it is that the *backfill* is a one-shot
guarded by `if !has_persona_versions` (`incremental.rs:1959`), so it runs exactly
once, on the boot that creates the table, and every row written afterwards goes to
the old table only. The two tables diverge permanently and silently from that
moment, and no gate can see it: a diff-shaped check finds no diff, and a row-count
check finds a table that "just isn't used yet".

**B. A diff gate that reads one of the two payload columns.**
`create_prompt_version_if_changed` compares `structured_prompt` and passes
`system_prompt` straight through to the writer without looking at it. The bug is
not that it is wrong when it fires; it is that it silently *does not fire* for a
whole class of edit, and the absence of a row is indistinguishable from "nothing
changed".

**C. Writing the history on a different connection from the edit.**
`personas::update` calls the version writer at `:935` on the **pool**, and opens
the transaction that applies the edit at `:1176`. Between them sit eight
`validate_*` calls (`:942-972`), two encryption calls that can fail (`:975`,
`:979`), and a dynamic SET-clause build. Any of those returning `Err` leaves a
committed version row for a value the persona never took.

**D. `let _ =` on the history write.** Same line, `:935`. The audit is
best-effort by intent — which is defensible — but it is best-effort *silently*.
Compare `:1186`, where the same author wrapped the same concern in
`if let Err(e) = … { tracing::warn!(…) }`. Two history writers, one function
apart, one of which can fail invisibly.

**E. Snapshotting by re-reading the live row.** `lab/versions.rs:22` and `:30`
both `INSERT … SELECT` from `personas` and `persona_tools`. Even if the module
were wired, the version it records is "whatever the persona is when this runs",
which is only the same thing as "what this change produced" if nothing else is
writing. Contrast `compute_changes(existing, input)`.

**F. A per-parent sequence with no constraint.** See §9. Twelve tables.

**G. Letting the history's deletion semantics be decided by whoever wrote the
FK.** This is the one this repo got *right* by accident and wrong by omission:
`persona_prompt_versions` cascades (deliberate, documented, and it fired on
2026-08-17 taking all 25 rows), while `persona_change_log` — the newer, better
mechanism — has **no foreign key at all** and is **not** in `ORPHAN_TABLES`. The
same repo holds both answers and never wrote down which one is policy.

**H. Treating "zero rows" as "the feature works, nobody used it".** It is one of
four different things and they need different fixes: nobody used it; the writer is
unreachable; the writer landed after the last write; or the rows existed and were
deleted. This leaf contains **one instance of each** — §7 D1, D2, D6 and D5
respectively — and none of them is discoverable from the count alone.

---

## §6 Evidence

**The one site to copy: `src-tauri/db/src/repos/resources/persona_change_log.rs`.**
Read the whole file; it is 213 lines of writer plus 5 tests and every design
decision in §2 is visible in it. In particular `:213-217` (takes `&Connection`,
documents *"so the audit rows commit atomically with the UPDATE"*), `:65-208`
(reconstruction diff, one arm per field), `:180-207` (the two secret-bearing
fields, redacted by *mapping over* the value rather than testing it), `:239-256`
(coalesce keeping the original `before_value`), and `:259-270` (prune on insert).

Supporting evidence:

- `src-tauri/src/commands/infrastructure/skill_usage.rs:196-202` — the race-free
  sequence allocation, and the only one. Backed by
  `PRIMARY KEY (skill_id, rev)` at `incremental.rs:4429`.
- `src-tauri/db/src/migrations/incremental.rs:1415-1426` — `recipe_versions`, the
  only version table in the repo whose schema enforces its own sequence
  (`UNIQUE(recipe_id, version_number)`).
- `src-tauri/db/src/repos/resources/recipes.rs:470-505` — mapping the UNIQUE
  violation to a retryable user message instead of leaking `SQLITE_CONSTRAINT`.
  This is what a schema-enforced sequence buys you: a failure you can name.
- `src-tauri/db/src/repos/execution/metrics.rs:99-120` — `BEGIN IMMEDIATE` around
  `MAX+1` then `INSERT`, with the comment stating the race it closes. Second-best
  form; use it only when step 6's single statement is impossible.
- `src-tauri/db/src/migrations/fk_hygiene.rs:414-417` — the deletion contract,
  written down. *"Prompt version history is meaningless once the persona is gone.
  CASCADE matches the user's mental model."* Whether or not you agree, this is the
  form: a decision, in the migration, in prose.

---

## §7 Deviations

### D1 — P0. A version system declared canonical, fully built, and structurally unreachable

`persona_versions` and `persona_version_tools` were created by
`incremental.rs:1959-1993` with the comment *"Create persona_versions table
(replaces prompt-only versioning)"*. Shipped with them:

| artifact | `path:line` | state |
|---|---|---|
| DDL, 16 columns, 2 indexes, FK CASCADE | `db/src/migrations/incremental.rs:1963` | present |
| child table `persona_version_tools`, FK CASCADE + `UNIQUE(version_id, tool_id)` | `incremental.rs:1985` | present |
| one-shot backfill from `persona_prompt_versions` | `incremental.rs:1997-2011` | ran once |
| repository module, 3 `pub fn`, 110 lines | `db/src/repos/lab/versions.rs` | **0 call sites** |
| module registration | `db/src/repos/lab/mod.rs:11` (`pub mod versions;`) | present |
| core model `PersonaVersion` | `core/src/models/lab.rs:644` | **0 users outside the repo module** |
| ts-rs binding | `src/lib/bindings/PersonaVersion.ts`, exported at `index.ts:640` | **0 importers** |
| boot orphan scrub entry | `db/src/lib.rs:460` | present, over a table with no rows |

Two independent scans agree: a symbol scan for `create_version` / `get_versions` /
`get_version_tool_count` / `PersonaVersion` across `src/` + `src-tauri/`
(excluding `target/`) returns only the definitions themselves plus the unrelated
`recipes::create_version` and `GitLabPersonaVersion`; and a table-name scan for
`persona_versions` outside `migrations/` returns only `db/src/lib.rs:460` and the
repo module. Row count in both databases: **0**.

The backfill's guard is the defect's engine. `if !has_persona_versions` means the
copy happens on the boot that creates the table and never again. The 25 rows in
`persona_prompt_versions` were all written **2026-05-25 → 2026-05-28**; whichever
side of the migration they fell on, the two tables cannot converge, because five
production writers write the old table and none writes the new one.

**Fix (deferred — see §7 note):** delete `db/src/repos/lab/versions.rs`, the `pub
mod versions;` line, the `PersonaVersion` model and its binding, and drop
`"persona_versions"` from `ORPHAN_TABLES`. Leave the tables — dropping a table is
destructive and both are empty, so they cost nothing. Recorded in the
deferred-fixes register rather than applied, because deleting a `#[derive(TS)]`
model changes what `export_bindings` emits and this session cannot compile Rust.

### D2 — P0. The best history writer in the repo has never run, and cannot be shown to work

`persona_change_log` is wired end to end: `write_diff` is called from
`personas.rs:1186` inside the update transaction; `list_persona_change_log`
(`commands/core/personas.rs:242`) is registered at `lib.rs:1838`;
`PersonaChangeHistory.tsx` renders it. Row count: **0 in the backup and 0 in the
live file.**

The reason is dating, not breakage. `git log --diff-filter=A` puts
`persona_change_log.rs` at **2026-07-27** (commit `e13a9be3d`, the
`personas-db` crate extraction). The maximum `personas.updated_at` in the backup
is **2026-07-14T08:51:10Z**, and `SELECT COUNT(*) FROM personas WHERE updated_at
>= '2026-07-27'` returns **0**. **No persona has been updated since the writer
existed.** So the correct verdict is *unproven*, and the corollary is sharper than
a defect would be: **the repo's canonical answer to this leaf has zero production
evidence, and its five unit tests are the only thing that has ever exercised it.**
Two of those five (`coalesces_same_field_within_window`,
`retention_caps_history`) are the ones that would catch a real regression, and
`retention_caps_history` seeds its 205 rows by raw INSERT with `created_at` values
like `"2026-01-01T00:00:07Z-7"` — strings that do not parse as timestamps and sort
lexically. It asserts the cap holds; it cannot assert *which* rows survived.

### D3 — P0. The version row commits before the validation that can reject the edit

`personas::update` (`db/src/repos/core/personas.rs:922`):

```
:935   let _ = crate::repos::execution::metrics::create_prompt_version_if_changed(
:936       pool, id, new_sp.clone(), input.system_prompt.clone(),
:937   );
:942   if let Some(ref name) = input.name { validate_name(name)?; }
:945   if let Some(ref prompt) = input.system_prompt { validate_system_prompt(prompt)?; }
:948   if let Some(Some(ref sp)) = input.structured_prompt { validate_structured_prompt(sp)?; }
…
:1176  let tx = conn.transaction()?;
:1178  let persona = tx.query_row(&sql, …)?;      // the UPDATE
:1186  if let Err(e) = …persona_change_log::write_diff(&tx, …) { tracing::warn!(…) }
:1190  tx.commit()?;
```

`create_prompt_version_if_changed` takes `pool`, gets its **own** connection, and
runs its own `BEGIN IMMEDIATE`/`COMMIT` (`metrics.rs:99`, `:122`). It has therefore
committed by line 942. Eight validators, two encryption calls
(`encrypt_update_profile` `:975`, `encrypt_notification_channels` `:979`) and a
`PersonaLifecycle` parse (`:971`) all sit between it and the write, and every one
of them can return `Err`. On any of those paths the persona is unchanged and the
history contains a version of the rejected value.

The same function, 250 lines later, gets it right: `write_diff(&tx, …)`. **One
function, two history writers, opposite transaction discipline.**

### D4 — P1. The only diff-gated door reads one of two payload columns, and its caller gates on the same one

```rust
// personas.rs:929-941
if let Some(ref new_sp) = input.structured_prompt {          // ← outer gate
    let changed = match (&existing.structured_prompt, new_sp.as_deref()) { … };
    if changed {
        let _ = create_prompt_version_if_changed(pool, id, new_sp.clone(),
                                                 input.system_prompt.clone());
    }
}
```

`input.structured_prompt` is `Option<Option<String>>` and — per
[`entity-draft-editing`](./entity-draft-editing.md) §2, which this repo follows —
the client sends the **diff**, so a system-prompt-only edit omits the key and
`input.structured_prompt` is `None`. The outer gate fails, no version is written,
and the inner gate (`metrics.rs:167-176`, which also compares only
`structured_prompt`) never runs.

Measured consequence in the backup: **16 of 25 rows have
`system_prompt IS NULL`**, 0 have `structured_prompt IS NULL`. Split by writer
fingerprint:

| `change_summary` | rows | `system_prompt` NULL | carries `design_context` | carries `resolved_cells` |
|---|---:|---:|---:|---:|
| `Auto-saved` | 15 | 11 | 0 | 0 |
| `Promoted from PersonaMatrix build` | 10 | 5 | 10 | 10 |

No other `change_summary` value exists, which means the three doors that stamp
something else — `create_prompt_version` called from `ai_healing.rs:621` and
`lab.rs:1204` — have produced **zero rows on this install**.

### D5 — P0/informational. The history was deleted with its subject, by design, and the design is defensible

`persona_prompt_versions.persona_id` carries `REFERENCES personas(id) ON DELETE
CASCADE`, added deliberately by `fk_hygiene.rs:407-440` with the comment quoted in
§6. On 2026-08-17 the operator deleted all 78 personas. Measured:

| table | backup | live | mechanism |
|---|---:|---:|---|
| `persona_prompt_versions` | 25 | **0** | declared `ON DELETE CASCADE` |
| `persona_versions` | 0 | 0 | declared CASCADE; never held a row |
| `persona_change_log` | 0 | 0 | **no FK** — would have orphaned had it held rows |
| `skill_revisions` | 84 | **84** | parent `skill_registry` was not purged |
| `recipe_versions` | 0 | 0 | — |

**There is no live orphan population**, because the only table that could produce
one was empty. That is luck, not design: `persona_change_log` has no foreign key
*and* is absent from `ORPHAN_TABLES` (`db/src/lib.rs:437-448`, which lists 12
tables and includes `persona_versions` — the one that has never held a row). Had
`write_diff` landed two weeks earlier, the purge would have left every
change-log row pointing at a deleted persona, invisible to the boot sweep, with
`list_for_persona` still returning them for any id.

`skill_revisions` is the control that makes the point: it survived intact because
its parent was not in the purge, which shows the cascade is behaving exactly as
declared. **A history that is deleted with its subject is a policy, not a bug —
but it has to be the same policy for every history of that subject, and here it is
two policies for three tables.**

### D6 — P1. Recipe versioning: four writers, a full UI, an LLM prompt builder, zero rows

`recipe_versions` has the best *schema* of the three (`UNIQUE(recipe_id,
version_number)`, `ON DELETE CASCADE` to `recipe_definitions`), four INSERT sites
(`recipes.rs:453`, `:530`, `:548`, `:642`), a 330-line
`RecipeVersionsTab.tsx`, a `useRecipeVersioning` hook, and a dedicated LLM prompt
builder + extractor (`commands/recipes/recipe_versioning.rs`, 79 lines).

Backup: **0 rows**, against **316 `recipe_definitions`, 299 of which have
`updated_at > created_at`** and an `updated_at` range of
2026-05-09 → 2026-07-07. Every recipe write in this install's history went
straight to the definition with no version recorded. Unlike D2 this is not a
dating artifact — the writers predate the edits. The four INSERT sites are all on
the *AI re-versioning* flow (generate a new version from a change request);
ordinary recipe editing does not touch them.

### D7 — P1. A three-value tag with six writers and one observed value

`persona_prompt_versions.tag` is `TEXT NOT NULL DEFAULT 'experimental'` with no
CHECK. Code that reads or writes it: `metrics.rs:253` (set), `:289-296`
(demote-all-then-promote), `:329` (read the production version),
`prompt_lab.rs:112-118` (same pair), `lab.rs:902-918` and `:1018-1035` (two more
copies of the same demote/promote), `auto_rollback.rs:510-517` (rollback), and
`test_runner.rs:2006` (attribution — *"the `production`-tagged version is the
active one even when a later version has a higher number"*). Frontend: a
three-entry style map at `labPrimitives.ts:6-10`.

Backup: **25 of 25 rows are `'experimental'`.** `'production'` and `'archived'`
have never been written. So `lab.rs:902`'s *"which version is live"* query
(`WHERE tag = 'production' ORDER BY version_number DESC LIMIT 1`) has returned
nothing every time it has run, and `test_runner.rs`'s attribution rule has never
had an input that distinguishes it from "highest version number".

### D8 — P2. Two writers bypass all three repo doors

| site | door used | gate | notes |
|---|---|---|---|
| `commands/execution/lab.rs:625` | **none** — inline INSERT | its own `structured_prompt` comparison at `:615` | writes `system_prompt` as the literal `NULL` (`:632`); inside the caller's `tx`, which is correct |
| `commands/design/build_sessions.rs:2607` | **none** — `create_version_snapshot_in_tx` | **none** — unconditional | the only writer that fills all five matrix columns; inside `tx`, correct |
| `engine/src/test_runner.rs:2941` | none | — | `#[cfg(test)]` fixture |
| `commands/execution/lab.rs:1530` | none | — | `#[cfg(test)]` fixture |

The two production bypasses are not defective in themselves — both are inside the
right transaction, which the *door* is not (D3). But they mean the repo has **five
production writers of one history table and no single place that owns the
"when"**. The brief's lead — *"three composers this week found the defect in a
writer nobody had listed"* — held: the writer nobody would have listed from the
doors is `build_sessions.rs:2607`, and it is responsible for **10 of the 25 rows**,
identifiable by its `change_summary` fingerprint.

### D9 — P2. `persona_prompt_versions.version_number` has no uniqueness constraint

Neither `persona_prompt_versions` nor `persona_versions` constrains
`(persona_id, version_number)`. `recipe_versions` does; `skill_revisions` does via
its compound PK. Five call sites resolve "the latest version" with `ORDER BY
version_number DESC LIMIT 1` (`metrics.rs:167`, `:329`, `lab.rs:606`, `:902`,
`:1018`) and one resolves the whole list with `ORDER BY version_number DESC`
(`versions.rs:60`). On a duplicate, SQLite's choice among the tied rows is
plan-dependent — the same query returns different rows under different plans, so
the bug reproduces on one machine and not another. Backup: 0 duplicates today,
because five writers over four days never raced. §9 gates this.

### D10 — P2. The version history is never previewed before it is created

The leaf's `why` is *"Generating a new version, previewing it, and accepting or
rolling back."* There is no preview. Every one of the five production writers
writes on the same call that applies the change; `RecipeVersionsTab.tsx:78` is the
only surface in the family that shows a draft before applying it, and it is on the
recipe path that has never written a row (D6). Rollback exists for persona prompts
(`lab.rs:1204`'s caller restores a version) and for GitLab-deployed personas
(`GitOpsVersionHistory.tsx:334`) but not for `persona_change_log`, which is
append-only with no restore path at all — its `before_value` is truncated to 200
characters (`VALUE_MAX_CHARS`), so it is a *display* record and cannot be replayed.
**That is a real cost of choosing the field log, and it should be stated when you
choose it**: you get "what changed" and you lose "put it back".

---

## §8 Gaps

1. **A field log cannot restore.** `persona_change_log` truncates values to 200
   chars and redacts two fields entirely. It answers *what changed* perfectly and
   *what was it before* only approximately. If rollback is a requirement, you need
   both a field log and a snapshot, and the snapshot's retention is then a
   separate decision. This repo has both tables and uses neither together.

2. **`ON DELETE CASCADE` cannot express "keep the history, forget the subject".**
   Compliance and post-mortem use cases want exactly that, and SQLite offers only
   CASCADE / SET NULL / RESTRICT / NO ACTION. `SET NULL` on a `NOT NULL` column
   fails at delete time; dropping the FK moves the whole burden to a sweep. The
   honest answer is a decision, not a mechanism — which is why §2(g) makes it a
   written one.

3. **No type reaches the "did this writer run?" question.** This is the
   doctrine's item 4 (*"a thing that was never declared"*): no signature is short
   a parameter and no enum is short a variant. `persona_versions` has zero call
   sites and compiles; `persona_change_log` has two and compiles; both have zero
   rows. Only an **inventory of what should exist** — "every user-editable
   definition must have exactly one history writer, named here" — distinguishes
   them, and the repo has no such inventory.

4. **The census cannot assert this leaf's largest findings.** D1, D2 and D6 are
   all *absences of rows*, and per the doctrine the census ratchets a count of
   something present. A rule cannot say "`persona_versions` has no writer" without
   an inventory to compare against. §9 gates the one thing here that *is* countable
   and present.

5. **`write_diff`'s coalesce and prune both order by a bare `created_at`.**
   `…/persona_change_log.rs:230` (`ORDER BY created_at DESC LIMIT 1`) and `:263`
   (`ORDER BY created_at DESC LIMIT ?2`). With a 30-second window and RFC-3339
   timestamps at nanosecond precision this is unlikely to tie, but it is the exact
   condition [`audit-trail-view`](./audit-trail-view.md)'s
   `clock-ordered-history-read-without-tiebreak` rule exists for, and both sites
   are inside that rule's territory. Not re-gated here.

---

## §9 The missing gate

### What was declined, and why

**Declined: a gate on "a version writer that bypasses its repo door".** Two
production sites (D8). Below the threshold at which a ratchet means anything, and
both sites are *correct* about the thing that matters most (they are inside the
caller's transaction, unlike the door). A rule that fires on the better code is
worse than no rule.

**Declined: a gate on `let _ =` over a history writer.** One site
(`personas.rs:935`). `discarded-guard-verdict` (conditional-write) and
`discarded-lifecycle-write` (credential-rotation-and-revocation) already key on
`let _ =` over a named writer; a third would be vocabulary drift, and the doctrine
records that a vocabulary-derived word list distorts precision and recall at both
ends.

**Declined: a gate on `MAX(...) + 1` allocated outside its INSERT.** Measured: **6
violating / 1 compliant** across 963 `.rs` files. But three of the six
(`metrics.rs:104`, `lab.rs:619`, `build_sessions.rs:2601`) hold a transaction, and
two of those three are already in the match set of
[`transaction-boundary`](./transaction-boundary.md)'s `deferred-read-then-write`.
Precision against the real condition would be ~3/6, with site overlap on an
existing rule. Refused.

### Published: `unconstrained-sequence-column`

**The condition the signal is a proxy for:** *a per-parent monotonic sequence whose
uniqueness is asserted by the readers and enforced by nobody.* Twelve tables in
this repo order or identify rows by such a column with no schema constraint behind
it; six do it correctly. The proxy is the SQLite DDL text, which is where this
repo's schema lives — **an adopting repo on another stack must re-derive its own
proxy** (a Prisma `@@unique`, a Django `unique_together`, an
`ALTER TABLE … ADD CONSTRAINT`), because the *condition* travels and the syntax
does not.

**Why a type does not reach it.** Doctrine §1 item 1: the column name is a word
inside a SQL string literal. `version_number: i32` on the Rust struct is true of a
constrained and an unconstrained column alike, and `Option<Tz>`-style closing has
nothing to close — the value is a legal `i32` either way. The constraint is a
property of the *table*, and no Rust type names a table. Nothing in Q1–Q7 applies.

**Fail-loud.** `floor: 6` — the migration directory contains exactly six `.rs`
files (`fk_hygiene`, `helpers`, `incremental`, `initial`, `mod`, `schema`). If a
restructure moves the chain, the walk sees fewer files and the run fails rather
than reporting a clean zero.

**Two implementations, and they disagreed twice.**

| pass | violating | compliant | what the disagreement was |
|---|---:|---:|---|
| A — paren-matched `CREATE TABLE` body, constraint must *name* the column | 16 | 4 | — |
| B — regex over whole file content (census-shaped) | 13 | 1 | **vocabulary**: B's word list omitted `position`, `attempt`, `seq`, `rev`, `sequence` |
| B, vocabulary aligned to A | 16 | 2 | **mechanism**: B's negative lookahead listed `UNIQUE` and not `PRIMARY KEY (` — `skill_revisions` and `remote_job_notes` enforce theirs with a compound PK |
| B, both corrected | **12** | **5** | agrees with A on membership; A's extra 4 are `attempt`/`generation` columns I then removed from the vocabulary as retry counters, not sequences |

Both disagreements had a single cause each and both were mine. The first is the
doctrine's *"a vocabulary-based signal's recall is bounded by its author's word
list"* — three forgotten words hid three sites. The second is worth more: **I
would have shipped a rule that reported the two best-engineered sequence columns
in the repo as violations**, because I wrote the lookahead from the constraint I
was thinking about rather than from the constraints the tree uses.

**Hand-verified precision: 10/12.** I opened all twelve. Ten are genuine — a
per-parent ordinal or sequence with no constraint: `persona_prompt_versions`
(`schema.rs:434`), `persona_versions` (`incremental.rs:1966`),
`persona_prompt_versions_new` (`fk_hygiene.rs:427` — the FK-rebuild twin, which
faithfully reproduces the missing constraint), `dev_goals.order_index` twice
(`schema.rs:1127`, `incremental.rs:9082`), `dev_goal_items.order_index`
(`:6039`), `dev_milestones.order_index` (`:7128`), `dev_context_groups.position`
(`schema.rs:1182`), `shared_event_firings.seq` (`initial.rs:215` — the local
relay's delivery cursor, indexed on `(slug, seq)` but not unique),
`research_experiment_runs.run_number` (`initial.rs:490`). **Two are false
positives**: `lab_ab_results.version_number` (`schema.rs:844`) and
`lab_eval_results.version_number` (`incremental.rs:751`) carry a *foreign*
version's number as a denormalized attribute of a result row — not their own
sequence. 83%, above every refusal threshold the doctrine records (22%, 44%, 71%).

**Known recall miss, stated:** `dev_milestone_items.order_index`
(`incremental.rs:7156`) and `workspace_playbook_patterns.ordinal` (`:8329`) are
genuine violations the pattern cannot see, because each has a compound `PRIMARY
KEY` that does **not** include the sequence column. True population 14; the rule
sees 12. Closing that needs a backreference inside the lookahead, which the
doctrine's backtracking rule forbids.

**Positive control** points the same anchor at the compliant form — a table-level
constraint that *names* a sequence column — and returns **5 matches in 1 file**:
`recipe_versions` `UNIQUE(recipe_id, version_number)`, `skill_revisions`
`PRIMARY KEY (skill_id, rev)`, `remote_job_notes` `PRIMARY KEY (job_id, seq)`,
`lab_tool_calls` `UNIQUE(result_id, variant, sequence)`, and
`workspace_knowledge_evidence` `UNIQUE(result_id, variant, sequence)`.

**Site-level overlap against the final pattern: 0.** Checked against every rule in
`rules.json` that keys on DDL — `hand-rolled-fixture-ddl`,
`constraintless-table-declaration`, `handwritten-rebuild-shape`,
`nullable-default-column`, `boolean-column-index`, `nullable-text-primary-key`,
`undeclared-parent-fate`, `default-contradicted-by-backfill`. All eight anchor on
`CREATE TABLE`/`ADD COLUMN`/`REFERENCES`/`CREATE INDEX` **openings**; this rule
anchors on a *column declaration and the absence of a constraint after it*, so no
match position coincides. File-level co-occurrence in the migration directory is
high (4 of 6 files for two of them) and is not the measure.

```json
{
  "id": "unconstrained-sequence-column",
  "goldenPath": "docs/concepts/golden-paths/definition-version-history.md",
  "roots": ["src-tauri/db/src/migrations"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:version_number|order_index|run_number|ordinal|sequence|seq|rev|position|step_index)\\s+INTEGER(?:(?!CREATE\\s+TABLE|UNIQUE|PRIMARY\\s+KEY\\s*\\()[^;]){0,3000}?\\)\\s*;",
    "flags": "g",
    "description": "A per-parent monotonic sequence column (version_number, order_index, rev, seq, ordinal, position, sequence, run_number, step_index) declared in a CREATE TABLE whose remaining body contains no UNIQUE(...) and no table-level PRIMARY KEY(...). Readers resolve 'the latest' with ORDER BY <col> DESC LIMIT 1, which is not merely wrong on a duplicate but plan-dependent, so it reproduces on one machine and not another. Enforce the sequence in the schema and allocate it inside the INSERT (skill_usage.rs:200-201 is the reference)."
  },
  "baseline": { "files": 4, "matches": 12 },
  "floor": 6
}
```

```json
{
  "id": "unconstrained-sequence-column-positive-control",
  "goldenPath": "docs/concepts/golden-paths/definition-version-history.md",
  "roots": ["src-tauri/db/src/migrations"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "(?:UNIQUE|PRIMARY\\s+KEY)\\s*\\([^)]{0,120}\\b(?:version_number|order_index|run_number|ordinal|sequence|seq|rev|position|step_index)\\b[^)]{0,120}\\)",
    "flags": "g",
    "description": "POSITIVE CONTROL for unconstrained-sequence-column: the COMPLIANT form — a table-level UNIQUE or compound PRIMARY KEY that names the sequence column. 5 sites: recipe_versions, skill_revisions, remote_job_notes, lab_tool_calls, workspace_knowledge_evidence. Together with the violating rule this partitions the sequence-column population; a control near zero means the violating pattern is not discriminating on constraint presence."
  },
  "floor": 6
}
```

---

## §10 The convergence oracle

The spine labels this leaf `convergence: "mixed"`. **Tested and inverted, in a way
the label cannot express.**

Cohort established for *this* leaf, per doctrine: of the five sibling checkouts,
`personas-cloud` and `personas-web` share this repo's persona/execution vocabulary
and `personas-web` is a documented port on adjacent leaves, so they are not
independent witnesses on anything that touches the persona schema. The effective
independent cohort here is **`brainiac`, `vibeman`, `ascent` — three, not five.**

What the sweep found, and how to weigh it:

- **A version-history table with a schema-enforced sequence: not found anywhere in
  the cohort.** That is a **silence**, and silence stays strong under the
  one-author confound. It says the problem is unnoticed, not that the answer is
  wrong.
- **A field-level change log: not found anywhere in the cohort either.**
  `persona_change_log` is, on the reading, better than anything the fleet has.
  Stating that as self-comparison, per doctrine: **Personas is ahead of the fleet
  on this leaf's mechanism and behind its own artifact on this leaf's evidence** —
  it owns the fleet's best change-log design and has never run it once.
- The `mixed` label would be defensible if the leaf's clauses split cleanly. They
  do not split by *sibling*; they split by *artifact inside this repo* — three
  mechanisms, one working badly, two not working at all. **A single enum field
  cannot carry that**, which is the same structural objection recorded against the
  label in the doctrine's §5 ledger. Count this as the fourteenth tested
  `convergence` label and the fourteenth that does not hold.

`sides: "client"` is **contradicted**, and inverted rather than incomplete. The
exemplar (`persona_change_log.rs`), all ten deviations, the census rule, its
control and its floor are server-side Rust and SQLite DDL. The client's entire
contribution is `PersonaChangeHistory.tsx`, which renders columns and computes
nothing — correctly. A client-scoped brief on this leaf would have found a
75-line component and missed every finding above. This is the eighth
`sides: "client"` contradiction in the corpus and the second of the *inverted*
kind rather than the *incomplete* kind.

---

## §11 Interaction with neighbouring paths

- **[`entity-draft-editing`](./entity-draft-editing.md) §2 says "send the DIFF,
  never the draft". Following it is what disarms this leaf's diff gate.** Because
  the client sends only changed keys, `input.structured_prompt` is `None` for a
  system-prompt-only edit, and `personas.rs:935`'s outer guard — written to avoid
  redundant versions — silently drops a whole class of them (D4). Both paths are
  right about their own leaf and the pair loses history. **The reconciliation is
  §2(a):** compute the delta from `existing` + `input`, which is diff-shaped by
  construction and therefore immune to which keys the client sent.
- **[`delete-semantics`](./delete-semantics.md) §2 requires every parent-naming
  column to declare its fate in the DDL.** `persona_change_log.persona_id`
  declares none (D5). That is a deviation owed to *that* path's §7 as well as this
  one; naming it here so it is not lost.
- **[`transaction-boundary`](./transaction-boundary.md)** owns the
  deferred-vs-immediate half of §4 step 6. This path does not re-gate it.
- **[`audit-trail-view`](./audit-trail-view.md)** owns the tiebreak on
  clock-ordered history reads (§8 item 5).
- **[`retention-and-pruning`](./retention-and-pruning.md) §2 — "write the bound
  before you write the predicate"** — is satisfied by `RETAIN_PER_PERSONA = 200`,
  and this is the only history table in the repo that satisfies it.
  `persona_prompt_versions` and `recipe_versions` have no bound at all; at the
  observed write rate that has never mattered, which is exactly the reasoning that
  path warns about.

---

## §12 Corrections

**To the brief.**

1. *"This repo has two versioning systems that were built separately: persona
   snapshot versioning and matrix versioning."* — **Wrong on both halves.** The
   matrix work extended the *same* table (five `ALTER TABLE` columns, visible in
   the stored DDL: `design_context, last_design_result, resolved_cells, icon,
   color`); it is not a second system. The genuine second system is
   `persona_versions`, which the brief did not name, and it is dead (D1). And
   there is a **third** mechanism the brief did not anticipate,
   `persona_change_log`, which is the one this path prescribes.

2. *"Two systems that both call a column `version` and mean different things is
   the defect, and it is exactly the shape the trigger fix hit this morning."* —
   **Does not apply.** The trigger case was one concept with two vocabularies
   (a storage CHECK and a client menu) that a closed enum could unify. Here the two
   tables mean the *same* thing and one of them has no traffic; a closed enum has
   nothing to close. The fix is deletion, not unification. This is worth recording
   because the analogy was persuasive and led me to look for a vocabulary
   mismatch for the first hour.

3. *"If version rows survived while the thing they version did not, you have a
   live orphan population to measure."* — **They cascaded; there is no orphan
   population.** But the brief's framing found something better than the thing it
   asked for: the table that *would* have orphaned (`persona_change_log`) has no
   FK and is absent from the boot orphan sweep, while the table that is *in* the
   sweep (`persona_versions`) has never held a row (D5).

4. *"Establish, by reading the writers: is a version created on every save, on
   every publish, or on a diff being non-empty?"* — The right question, and the
   answer is **all three, in one table**: unconditional
   (`build_sessions.rs:2607`, `create_prompt_version`), diff-gated on one column
   (`personas.rs:935` → `create_prompt_version_if_changed`, `lab.rs:615`), with no
   single owner of the policy (D8).

5. *"Enumerate the writers first — three composers this week found the defect in a
   writer nobody had listed."* — **Held, twice.** The unlisted writer among the
   *doors* is `build_sessions.rs:2607` (10 of 25 rows). The unlisted *mechanism*
   entirely is `persona_change_log`, which I found only because
   `build-golden-path-index --prime` surfaced `audit-trail-view`'s citation of it.
   Priming paid for itself on this leaf.

**To my own first pass.** My initial census rule would have flagged
`skill_revisions` and `remote_job_notes` — the two best sequence columns in the
repo — as violations, because I wrote the negative lookahead from the constraint I
had in mind (`UNIQUE`) rather than from the constraints the tree actually uses
(`PRIMARY KEY (a, b)`). It was caught only because a second, differently-built
implementation disagreed. **A gate that fires on the exemplar is the failure this
whole section exists to prevent, and I committed it on the first try.**

**To published paths.** None contradicted. Two additions offered:

- [`delete-semantics`](./delete-semantics.md) §7 — `persona_change_log.persona_id`
  is a parent-naming column with no declared fate, and it is absent from
  `cleanup_orphan_rows`' `ORPHAN_TABLES` (`db/src/lib.rs:437-448`), while
  `persona_versions` — zero rows in both databases — is present.
- [`catalog-browse-and-apply`](./catalog-browse-and-apply.md) §7 — its headline
  concerns stamped install provenance; `recipe_definitions` (316 rows, 299 edited)
  has a full versioning subsystem alongside it that has recorded **0** of those
  edits (D6).

**Measurement provenance.** All row counts: `purge-backup-2026-08-17/personas.db`
(347,054,080 B), copied to scratch and opened read-only, 2026-08-17. Post-purge
counts: the live `personas.db` + WAL, copied, read-only, same date. Both are
point-in-time and neither is reproducible from the current live file.
