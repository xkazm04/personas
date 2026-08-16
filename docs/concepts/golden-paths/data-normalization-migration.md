# Golden path — Data normalization migration

> Situation node: `data-persistence/migrations/data-normalization-migration` ·
> [situation spine](../situation-spine.md) · recurrence 9 · risk **HIGH** ·
> sides: **server** · `twoSided: true` · convergence: **mixed** ·
> dimensions: function · resilience · performance ·
> merged from *Closed-vocabulary value migration* · *Dedupe then add a unique index*
> Composed 2026-08-16 against `master` @ `c47cd36fa`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri` (exactly `rust.files`
> in [`shared-facts.json`](../shared-facts.json)). Every `run_step` in the
> migration chain was enumerated and its guard classified (**122** steps); every
> row-rewriting statement in the chain was enumerated and located
> (**67**: 30 `UPDATE`, 18 `INSERT … SELECT`, 19 `DELETE`); every `INSERT` site
> for the three tables carrying a backfilled column was opened by hand
> (**19** for `personas`, **21** for `persona_triggers`, **14** for
> `persona_memories`). All 14 locale files were parsed.
>
> **Measured by execution, not by reading.** Read-only copies of the live
> `personas.db` (347 MB) and `personas_data.db` (17 MB) were taken and queried;
> a separate throwaway copy was used to time the chain's unconditional
> statements. **Every backfill predicate in the chain was replayed verbatim
> against the copy to count the rows still in the pre-migration shape.** The
> copies were deleted.
>
> **`cargo` was not run** (the operator's app is running, and this is the leaf
> where a mistake is unrecoverable). No migration was run against any live file.
> Every Rust claim is static and traces to a file opened during composition.
>
> ## The headline: the chain has 122 steps and exactly ONE of them can tell whether its rows are correct
>
> **113 of 122 steps guard on schema** (`has_column` 62, `has_table` 49,
> `has_index` 2). **One** guards on the rows it is about to change — a
> `COUNT(*)` over the pre-migration row shape (`incremental.rs:7048`,
> `dev_milestones.backfill_cut_at`). One is `|_conn| Ok(false)`. The remaining
> seven read `sqlite_master` DDL text.
>
> That ratio *is* the leaf. A schema probe answers "does the column exist"; a
> data migration's question is "are the rows right", and those diverge the
> moment the write path is not total. Three results, all executed:
>
> 1. **A column's `DEFAULT` outlives its own backfill, and 26 rows have already
>    drifted.** `persona_triggers.status` was added `NOT NULL DEFAULT 'active'`
>    and backfilled from `enabled` (`incremental.rs:2175-2181`). **5 of 10
>    production `INSERT` sites omit `status`**, so the `DEFAULT` fills it. Live:
>    **26 rows carry `enabled = 0` AND `status = 'active'`** — and `get_due`
>    (`triggers.rs:1590`) dispatches on `status`, not `enabled`. Zero rows drift
>    the other way. The backfill was a one-shot repair against a permanent
>    generator.
> 2. **A backfill whose predicate cannot match, and a tier with zero rows in it.**
>    `UPDATE persona_memories SET tier = 'core' WHERE importance >= 8`
>    (`incremental.rs:2214`) — but `importance` is bounded to **1..=5** by two
>    `BEFORE INSERT/UPDATE` triggers (`helpers.rs:426-447`), and the live maximum
>    is **5**. The predicate has matched **0** rows and always will. Of **6,535**
>    memories, **1,259 sit at the maximum importance and 0 are in `core`** — the
>    tier the MEMORY CONTRACT calls always-injected-and-never-decaying is empty
>    on the operator's machine.
> 3. **The migration chain does ~10 ms of row-normalization work every launch and
>    changes 0 rows — and the cost is not the problem.** Eleven statements run
>    unconditionally; timed on a copy of the live database they total **9.6 ms**
>    warm / 33.7 ms first-touch, **0 rows changed**. The 186 ms `DROP COLUMN`
>    pair that got removed was expensive *and* wrong; these are cheap *and*
>    wrong, which is why nothing has flagged them. Cheapness is not convergence.
>
> **Sibling boundaries, settled in prose.** [`schema-change`](./schema-change.md)
> owns landing a new table/column; [`destructive-schema-change`](./destructive-schema-change.md)
> owns the create-copy-drop-rename and the **mechanics** of widening a CHECK;
> [`boot-migration-step`](./boot-migration-step.md) owns the guard contract and
> already states the rule this path is the proof of — *"for a data migration with
> no schema footprint, the postcondition is a row count … that is always
> derivable"*. This path owns what happens when the schema half and the data half
> are **the same step**: which guard the step must carry, what a partially-applied
> backfill leaves, and why a backfilled column with a `DEFAULT` never converges.
> `persona_tombstones` is owned end-to-end by
> [`sync-reconciliation-and-conflicts`](./sync-reconciliation-and-conflicts.md)
> D1 and is cited here, not re-litigated. The `tool_steps` remainder is the
> backfill [`secret-and-pii-redaction`](./secret-and-pii-redaction.md) §3
> explicitly declines to own (*"a backfill for anything already written — not for
> the 1,921 `tool_steps` rows"*); this path sizes it.
>
> The **Deviations** section is a fix backlog. **Nothing in it was applied.** Per
> the campaign's standing rule, a leaf whose first run rewrites rows is a note,
> never an edit — and this is that leaf.
>
> ---

## 1 Trigger

You are in this situation when you say, or are about to type, any of these:

- *"The write path is fixed — but what about the rows already on disk?"*
- *"Add the column, then backfill it from `<other column>`."*
- *"We're widening this enum / CHECK / status vocabulary — the old rows use the
  old spelling."*
- *"Dedupe the table first, then add the unique index."*
- *"This column caches / denormalizes `<something>` so we don't have to
  recompute it."*
- *"It's idempotent — the `UPDATE` just matches nothing on the second run."*
- If you are about to write `UPDATE <t> SET <c> = …` or
  `INSERT INTO <t> … SELECT` inside `db/src/migrations/**`, or an
  `ALTER TABLE … ADD COLUMN … DEFAULT` followed anywhere below by an `UPDATE`
  of that same column — you are here.

The distinguishing question against [`schema-change`](./schema-change.md): does
the step change what a **row holds**? If yes, this path. A step that only adds a
column and lets it be `NULL` is a schema change; the moment you write a value
into an existing row, the rules below apply.

## 2 The one way

**Guard the step on the rows, not on the schema — a `COUNT(*)` over the
pre-migration row shape that returns `Ok(count == 0)` — and then close the door
the rows came through, because a backfill without a closed write path is a
repair against a generator that is still running.** Concretely: **(a)** put the
whole step in ONE `ddl_step` transaction so the `ALTER` and the `UPDATE` commit
or roll back together; two `ddl_step` calls behind a `has_column` guard means a
crash between them leaves the column present, the guard satisfied and the
backfill permanently unreachable (`incremental.rs:6691-6727` is that shape;
`:4670-4676` is the same job done in one). **(b)** Write the guard as
`SELECT COUNT(*) FROM t WHERE <the pre-migration shape>` → `Ok(pending == 0)`
(`incremental.rs:7044-7054`). This is strictly stronger than a schema probe and
costs the same — measured, **0.20 ms vs 0.20 ms** on the live database — because
it is *self-healing*: if the write path regresses and re-creates a row in the old
shape, the next launch repairs it, and the step is simultaneously the backfill
and the drift detector. **(c)** Make the backfill's predicate name the
pre-migration shape and nothing else (`WHERE cut_at IS NULL`,
`WHERE status = 'pending'`), never a positional or historical assumption — that
is what makes re-running it free, and it is the only reason the unguarded
statements in this chain are survivable. **(d)** If you are adding a column and
backfilling it, **add it with NO `DEFAULT`.** A constant `DEFAULT` and a backfill
are two different answers to "what should this hold", and the `DEFAULT` is the
one every future `INSERT` that omits the column will take; ship the backfill and
you have fixed the past while leaving the factory running (§9's census rule
counts exactly this, and it is how 26 trigger rows drifted). If the column must
have a default, then **bind it in every `INSERT` from a closed type** the way
`personas.rs:863-885` binds `lifecycle` through `PersonaLifecycle` — that, not
the backfill, is what makes the value converge. **(e)** Report what you could not
map, to a surface a human sees, before you constrain — `normalize_goal_statuses_in_place`
(`incremental.rs:8314`) writes a `dev_goal_signals` row carrying the original
value for every status nothing recognised, then the rebuild adds the CHECK. A
migration that silently coerces an unknown value has destroyed the only evidence
of the writer that produced it. **(f)** Then **close the vocabulary at the
boundary** — a CHECK constraint generated from the same Rust constant the
normalizer uses (`CANONICAL_GOAL_STATUSES`, `incremental.rs:8404-8412`) — so the
shape you just repaired cannot recur. **(g)** And because this leaf is
`twoSided`: widening a stored vocabulary is not done until the **display** side
has learned the new arm. A 6-arm SQL CHECK against 5 arms in all 14 locale files
renders the raw machine token to the user (§7 D5).

**And if the value you are backfilling already has a runtime writer, call that
writer.** `sla_daily`'s backfill (`incremental.rs:4097-4102`) does not re-derive
the rollup in SQL; it invokes `upsert_sla_daily_conn` — the same function the
execution-completion path uses — with the comment *"so backfilled and
live-written rows share one definition."* Two definitions of one value is the
whole defect class this leaf describes; reusing the writer deletes it at the
root, and it is the strongest single answer in this repo **or any of its five
siblings**.

If you must pick one to get right first: **(b)**. It is the only one that makes
the question "did this backfill finish?" answerable at all — and today, across
122 steps, exactly one step can answer it.

## 3 Mandated primitives

These exist. Use them; do not build a second one.

| primitive | what it gives you |
| --- | --- |
| `db/src/migrations/incremental.rs:12` `run_step` | the step wrapper: `id`, `description`, `already_applied`, `apply`. **The `id` is a log field only — there is no ledger** (`schema_migrations` / `PRAGMA user_version` / `applied_migrations` appear 0 times in 963 files), so the guard is the whole mechanism |
| `…:7044-7054` `dev_milestones.backfill_cut_at`'s guard | **the one site to copy.** `SELECT COUNT(*) … WHERE status='active' AND cut_at IS NULL` → `Ok(pending == 0)`. The only row-shaped postcondition in the chain |
| `…:33` `ddl_step(conn, sql)` | wraps a multi-statement batch in one transaction. Put the `ALTER` **and** the backfill in a single call — `…:4672-4676` is the reference |
| `…:8314` `normalize_goal_statuses_in_place` | the reference **closed-vocabulary** migration: strict mapper, per-row `UPDATE`, unmappable rows reported to `dev_goal_signals` **and** `tracing::warn!`, never bailed on (it runs at boot; a bail bricks the install) |
| `db/src/repos/dev_tools.rs:1216` `canonical_goal_status` / `:1204` `CANONICAL_GOAL_STATUSES` | the strict twin of the runtime normalizer, **with the catch-all removed**, plus the constant the CHECK is generated from. One vocabulary, two consumers, no drift |
| `…:8376` `constrain_goal_status_to_canonical_set` | the follow-through: after normalizing, rebuild with `CHECK(status IN (<the same constant>))` so the shape cannot recur |
| `db/src/migrations/helpers.rs:330` `reconcile_idea_category_vocabulary` | the same discipline for a table that may not exist yet: `sqlite_master` existence check, per-value `UPDATE`, and a **forensic scan of survivors** logged at `warn!` rather than blanket-overwritten |
| `helpers.rs:34` `migrate_blob_credentials_to_fields` | **the reference for a partially-applicable backfill.** Per-entity transaction (`unchecked_transaction`), `INSERT OR IGNORE` so a re-run fills gaps, and the source is left intact on any failure |
| `helpers.rs:189` `clear_legacy_credential_blobs` | the completeness gate: the source is destroyed **only** after every key it encodes is confirmed present in the destination |
| `helpers.rs:271` `assert_credential_blob_invariant` | **the only post-migration invariant assertion in the repo.** Runs every boot, `tracing::error!` on breach, never crashes. This is the shape every backfill in §7 is missing |
| `initial.rs:74-89` | the reference **dedupe-then-unique-index**: the index's own existence is the marker that the full-table dedupe already ran, turning a scan into one `sqlite_master` lookup |
| `personas.rs:863-885` + `core/src/lifecycle.rs` `PersonaLifecycle` | the write-path half: a validated closed type bound into the canonical `INSERT`, so the column cannot take a value the vocabulary does not contain |
| `helpers.rs:396` `install_persona_memory_invariants` | range invariants SQLite cannot express as an added CHECK, as `BEFORE INSERT/UPDATE` triggers that `RAISE(ABORT)` — and the guard that skips the DROP+CREATE when both already exist |
| `incremental.rs:4097-4102` `sla_daily` backfill → `upsert_sla_daily_conn` | **the backfill that calls the runtime writer.** One definition of the value, used by both the historical pass and every live write. The single best answer to derived-column drift found in this repo or its five siblings |
| `src/i18n/__tests__/chainStopReasons.parity.test.ts` | **the vocabulary-parity primitive, and it already exists.** A set-equality Vitest between a mirrored Rust const list (`db/src/chain.rs:45-81`, 13 arms) and `en.status_tokens.chain_stop`. Its header names the exact failure mode: *"a new Rust `stop_reason` const ships to production as an untranslated raw token in all 14 locales, with no build signal."* §9 extends this rather than proposing a new script |

**Do not exist — this path names them:**

- **A ledger.** Nothing records that a step ran. Every "has this backfill
  happened" question is answered by re-deriving it from the data, or not at all.
- **Any assertion that a backfill completed.** `assert_credential_blob_invariant`
  is the single post-migration check in the tree; the other 66 row-rewriting
  statements assert nothing.
- **Any bound, chunk, cursor, or resume point on a backfill.** Every one is a
  single unbounded `UPDATE`. There is no `LIMIT`, no batch loop, no progress row.
- **A rows-affected log for a migration `UPDATE`.** Four statements report a
  count (`incremental.rs:2233`, `helpers.rs:313`, `:358`, `:167`); the rest
  discard it, so "0 rows normalized because the predicate is wrong" is
  indistinguishable from "0 rows needed it".
- **Anything relating a stored vocabulary to its display vocabulary.** The CHECK
  arms and the `en.json` arms are two hand-maintained lists with nothing between
  them.

## 4 Steps

1. **Decide whether you are changing rows.** If the answer is yes, everything
   below applies and [`schema-change`](./schema-change.md) alone is not enough.

2. **Write the pre-migration shape as a `SELECT COUNT(*)` before you write the
   `UPDATE`.** That expression is your guard, your test assertion and your
   `WHERE` clause — all three. If you cannot express it, you do not yet know what
   the migration is for.

3. **Put the guard in `already_applied` as `Ok(pending == 0)`.** Not
   `has_column`. Prefix it with `if !has_table(conn, t)? { return Ok(true); }` so
   a database that never had the table is "applied", not an error
   (`:7045-7047`).

4. **Put the `ALTER` and the backfill in ONE `ddl_step`.** One transaction. If
   the step needs two, the guard must observe the state the *second* one creates
   — otherwise you have built the `unresumable-migration-step` shape that
   [`boot-migration-step`](./boot-migration-step.md) §9 already counts 15 of.

5. **Add the column with no `DEFAULT` if you are going to backfill it.** If it
   must have one, go to step 6 — you now owe the write path.

6. **Close the write path in the same change.** Enumerate every `INSERT` into the
   table (`INSERT\s+(?:OR\s+\w+\s+)?INTO\s+<table>` over `src-tauri`, then read
   each column list) and make each one bind the column from a closed type. **This
   is the step that is skipped**, and skipping it is what turns a migration into
   a treadmill: 5 of 10 for `persona_triggers.status`, 3 of 4 for
   `persona_memories.tier`, 18 of 19 for `personas.lifecycle` (of which one, the
   duplicate-persona path at `personas.rs:1595`, is live).

7. **Report what you could not map, then constrain.** A `dev_goal_signals`-shaped
   row on the entity itself, plus a `tracing::warn!`. Then add the CHECK,
   generated from the same constant the normalizer uses. Do not bail the
   migration — it runs at boot and a bail bricks the install.

8. **If the vocabulary is user-visible, widen the display side in the same
   change.** Add the arm to `src/i18n/locales/en.json` and translate all 14
   locales (`node scripts/i18n/translate-extract.mjs` → subagents →
   `translate-merge.mjs`), and make the lookup exhaustive — a
   `Record<TheUnion, string>` that fails to compile, not
   `as Record<string, string>` with a `?? rawToken` fallback.

9. **Check who is listening.** `boot-migration-step` §4 step 6 owns this and it
   applies to every statement here: migrations run on a pooled connection with
   the CDC `update_hook` and the change-journal `preupdate_hook` already
   registered, and their consumers are spawned ~676 lines later. **Twelve DML
   statements in the chain already target hooked tables.** A large backfill fills
   both bounded channels (512 / 2048) and logs a permanent gap in the
   reversibility ledger. Say in the step's comment whether yours does.

10. **Then stop.** Do not add a `verify_backfill_done` boolean column — the row
    shape already is the marker. Do not write a second normalizer for the same
    vocabulary. Do not `let _ =` the statement.

## 5 Anti-patterns

- **Guarding a data migration on `has_column`.** *Failure:* the guard latches
  true the instant the schema half lands, and the data half becomes permanently
  unreachable — not just on a crash, but for any row that enters the old shape
  afterwards. `personas.lifecycle` (`:6689`) is this: `has_column` guard, two
  `ddl_step` transactions, backfill in the second.

- **Adding a column with a constant `DEFAULT` and then backfilling it.**
  *Failure:* the `DEFAULT` is the migration's competitor and it wins every future
  race. The backfill fixes 351 rows once; the `DEFAULT` fixes every row forever,
  wrongly. This is §9's census rule, and it is the mechanism behind all 26 drifted
  trigger rows.

- **Assuming "the second run matches nothing" means the migration converged.**
  *Failure:* it also matches nothing when the predicate was wrong. `WHERE
  importance >= 8` against a 1..=5 contract has matched nothing on every launch
  since it was written, and reads identically to success. **A migration that
  cannot distinguish "done" from "never applicable" has no postcondition.**

- **Discarding a migration `UPDATE`'s row count.** *Failure:* the affected-row
  count is the only observation the statement produces. `research_lab_align_columns`
  (`:7869-7883`) runs 7 backfills as `let _ = ddl_step(…)` inside a function that
  returns `()` — it is structurally incapable of reporting that any of them ran,
  errored, or was needed.

- **Normalizing a vocabulary without constraining it afterwards.** *Failure:* you
  have cleaned the rows and left the door open. `dev_tasks.status` (`:4504`) folds
  `pending` → `queued` on **every** launch precisely because nothing stops a
  writer from producing `pending` again. The comment calls that idempotency; it
  is an unclosed vocabulary being swept nightly.

- **Widening a stored enum without widening the display vocabulary.** *Failure:*
  the user sees the machine token. `dev_kpi_measurements.source` gained
  `'ai-compose'` in the CHECK; all 14 locale files still carry 5 arms;
  `KpiDetailModal.tsx:302` does `t.kpis.measurement_source as Record<string, string>`
  and `?? m.source`. The cast is what disarms the exhaustiveness the generated
  i18n type already had.

- **Using `init_test_db()` alone to test a data migration.** *Failure:* the
  fixture builds the *post*-migration shape, so the test proves nothing about the
  population the migration exists for. Hand-write the legacy table **with rows in
  the old shape**, run the step twice, and assert (i) the rows converged and
  (ii) the second run changed **0** rows. **This repo already does this well and
  it is worth saying so**: of 20 tests in `incremental.rs`'s test module,
  **10 seed rows and then run a migration**, 9 of them constructing legacy DDL by
  hand — `legacy_goal_status_aliases_migrate_to_their_canonical_form`,
  `an_unmappable_goal_status_is_reported_rather_than_quietly_defaulted`,
  `re_running_the_goal_status_migration_changes_nothing` (the second-run
  assertion, done right), `widening_the_measurement_source_preserves_rows_and_later_columns`,
  `legacy_mcp_gateway_members_fk_is_repaired_without_losing_rows`. Measured
  against the five sibling repos, only one has anything comparable. Copy the
  `legacy_goals_table` helper (`:8929`) shape.

- **Backfilling a column read by a hot query without checking the query's
  predicate.** *Failure:* `get_due` (`triggers.rs:1590-1594`) requires
  `next_trigger_at IS NOT NULL`. 37 of 39 time-based triggers are NULL, no code
  anywhere contains the predicate `next_trigger_at IS NULL`, and the only
  recompute site (`triggers.rs:452`) fires on update, not on boot. The write path
  was fixed and the rows were not, so the schedules are inert and nothing says so.

## 6 Evidence

**Copy this one:** `db/src/migrations/incremental.rs:7039-7064` —
`dev_milestones.backfill_cut_at`. Ten lines. A `has_table` early-return, a
`COUNT(*)` over the pre-migration row shape as the guard, a single `ddl_step`
whose `WHERE` clause is the same shape, and a comment that says *"is naturally
idempotent — after one pass no active row has a NULL cut"* and is correct. It is
the only step in the chain whose `already_applied` observes what the step is
actually for, and its test (`:8419` `backfill_cut_at_repairs_uncut_active_milestones`)
constructs the legacy rows by hand rather than trusting the fixture.

Supporting sites, each earning its place:

| site | what it demonstrates |
| --- | --- |
| `incremental.rs:4670-4676` | `ALTER` + backfill in **one** `ddl_step`. `COALESCE(completed_at, started_at, created_at)` — the same expression the readers use, so a historical row gets its real stamp instead of a fake `now`. No `DEFAULT`, so nothing competes. Live: 0 of 9 rows still NULL |
| `incremental.rs:8314-8374` | closed-vocabulary normalization done completely: strict mapper, per-row update, unmappable rows written to `dev_goal_signals` **and** logged, migration never bails. Live: 188 rows, all 5 canonical values, **0 outside the set** |
| `incremental.rs:8376-8452` | the follow-through — CHECK generated from `CANONICAL_GOAL_STATUSES` itself, with a `create_sql.matches("DEFAULT 'open'").count() != 1` bail. Vocabulary and constraint cannot drift because they are one constant |
| `helpers.rs:34-175` | the only **partially-applicable** backfill: per-credential transaction, `INSERT OR IGNORE`, source preserved on failure, so a crash mid-way leaves a recoverable state rather than a half-written secret |
| `helpers.rs:189-262` + `:271-292` | destroy-the-source gated on proven completeness, then **assert the invariant on every boot**. Live: 25 credentials, 42 fields, **0 legacy blobs, 0 camelCase survivors** — a fully converged normalization, and the only one with a standing checker |
| `helpers.rs:330-386` | the forensic tail: after remapping, `SELECT … WHERE category NOT IN (<canonical>) GROUP BY category` and `warn!` each survivor. Live: 236 ideas, **0 legacy, 0 unknown** |
| `initial.rs:74-89` | dedupe-then-unique-index with the index as its own marker. The comment names the cost it removed: *"previously it re-ran on every launch"* |
| `personas.rs:863-885` | the write-path half — `input.lifecycle.as_deref()` parsed through `PersonaLifecycle`, bound into the `INSERT`. **1 of 19 `INSERT INTO personas` sites does this**, and it is the canonical one |
| `incremental.rs:4090-4104` | **the write-path half solved at the root**: the `sla_daily` backfill calls `upsert_sla_daily_conn`, the runtime rollup writer, instead of re-deriving the rollup in migration SQL. One definition, two populations |
| `KPIDashboard.tsx:161-170` | the display half done right, after being got wrong: *"testing a closed union by naming the members you distrust is the failure mode … the durable form is to name the members that ARE measurements, so a new arm defaults to 'not measured'"* |
| `src/i18n/__tests__/chainStopReasons.parity.test.ts:31-41` | the vocabulary-parity assertion that already ships: `expect(Object.keys(en.status_tokens.chain_stop).sort()).toEqual([...RUST_STOP_REASONS].sort())`. 13 arms, set equality, fails the Vitest suite — which runs at `npm run test`, not only in CI |

**Executed, on a copy of the live database.** Every backfill predicate in the
chain, replayed as a `COUNT(*)`:

| normalization | rows still in the pre-migration shape | verdict |
| --- | ---: | --- |
| `dev_ideas.category` legacy vocabulary | 0 of 236 | converged |
| `dev_goals.status` non-canonical | 0 of 188 | converged **and closed** |
| `credential_fields` camelCase keys | 0 of 42 | converged |
| `persona_credentials` legacy blobs | 0 of 25 | converged **and asserted** |
| `dev_tasks.status = 'pending'` | 0 of 9 | converged, **not closed** — swept every launch |
| `dev_tasks.updated_at IS NULL` | 0 of 9 | converged |
| `research_*` NULL timestamps | 0 of 1 | converged (1 live row across 7 tables) |
| `personas.lifecycle` draft predicate | 0 of 78 | converged, **write path 1/19** |
| `persona_memories.tier = 'core'` | **0 promoted, ever** | predicate unsatisfiable |
| `persona_triggers.status` vs `enabled` | **26 of 351 drifted** | **diverging** |
| `persona_triggers.next_trigger_at` | **37 of 39 NULL** | never attempted |
| `persona_events.source_type` | **4,166 of 4,972 (83.8%)** | never attempted |

The top half of that table is the case for §2. Six normalizations written in this
discipline have fully converged and stayed converged. The bottom half is what
happens without it.

## 7 Deviations

Every entry is a **note**. Nothing here was applied — the operator uses this app
daily and the first run of any of these fixes rewrites rows.

### D1 — `persona_triggers.status` has drifted from `enabled` on 26 live rows

`incremental.rs:2175-2181` adds `status TEXT NOT NULL DEFAULT 'active'` and
backfills `CASE WHEN enabled = 1 THEN 'active' ELSE 'disabled' END`. Live:
**26 rows `enabled = 0` AND `status = 'active'`**, 0 rows the other way. The
generator is the `DEFAULT`: **5 of 10 production `INSERT` sites name `enabled`
and omit `status`** — `personas.rs:1669` (persona duplicate),
`data_portability.rs:6126` (import), `n8n_transform/confirmation.rs:169`,
`commands/tools/triggers.rs:1720`, `engine/platforms/deploy.rs:308`. The three
`UPDATE` paths (`triggers.rs:435` via `derived_status`, `:1862` `set_enabled`,
`:1882` `set_status`) all keep the pair in sync, which is why the drift is
`INSERT`-only and why it was invisible.

**Why it matters:** `get_due` (`triggers.rs:1590`) filters on
`t.status = 'active'` and never reads `enabled`. A trigger the user switched off
through any of those five paths is still dispatchable.

**A repair would have to be careful about:** direction. `UPDATE persona_triggers
SET status = CASE WHEN enabled = 1 THEN 'active' ELSE 'disabled' END` is
**wrong** — `status` is a four-state lifecycle (`active`/`paused`/`errored`/
`disabled`, `core/src/lifecycle.rs`) and `enabled` is a boolean, so rebuilding
`status` from `enabled` would flatten every `paused` and `errored` row into
`active`. The safe predicate is the strictly narrower
`WHERE enabled = 0 AND status = 'active'` → `'disabled'` (26 rows), which only
touches rows where the boolean is unambiguous. Check the 26 rows' `updated_at`
first: any row whose `status` was set *after* its `enabled` may be a deliberate
`set_status` and not drift at all. And the durable fix is step 6, not the
`UPDATE` — closing the five `INSERT` sites, otherwise the count regrows.

### D2 — the `core` memory tier has never had a row, because its backfill tests a scale that does not exist

`incremental.rs:2214`: `UPDATE persona_memories SET tier = 'core' WHERE
importance >= 8`. `helpers.rs:426-447` installs
`persona_memories_importance_insert` / `_update`, which `RAISE(ABORT)` on
`importance < 1 OR importance > 5`, per the MEMORY CONTRACT
(`core/src/models/memory.rs`). Live maximum importance: **5**. Rows at 5:
**1,259**. Rows in `tier = 'core'`: **0** of 6,535 (3,132 `active`, 1,377
`archive`, 2,026 `working`).

Two independent defects in one statement: the predicate is on a 1–10 scale the
column never used, **and** 3 of 4 production `INSERT` sites
(`memories.rs:339`, `:498`) omit `tier` and take `DEFAULT 'active'`.

**Why it matters:** `core` is the tier the contract says is always injected and
never decays, reachable at runtime only through `set_tier`
(`memories.rs`, bound to an explicit user action). The migration was supposed to
seed it from existing high-importance memories and seeded nothing.

**A repair would have to be careful about:** choosing the threshold. There is no
correct mechanical translation of `>= 8` onto a 1..=5 scale — `>= 5` would
promote **1,259** memories into a tier that is injected into *every* execution
for that persona, which is a prompt-size and cost change, not a data cleanup.
This one should probably not be backfilled at all; the honest fix is to delete
the dead statement and let `core` stay user-curated. If it is backfilled, it must
be scoped per persona (an unbounded promotion changes every future prompt) and
the `tier` column's `DEFAULT` closed at the two `INSERT` sites first.

### D3 — 37 of 39 time-based triggers have no next fire time, and no code can repair one

`persona_triggers.next_trigger_at` is NULL on **37 of 39** `schedule`/`polling`
triggers (20 of 20 disabled `schedule`, 10 of 12 enabled `schedule`, 6 of 6
disabled `polling`, 1 of 1 enabled `polling`). **11 are `enabled = 1` and
`status = 'active'`** — live schedules that cannot fire. `get_due`
(`triggers.rs:1592`) requires `next_trigger_at IS NOT NULL`. The predicate
`next_trigger_at IS NULL` appears **0 times** in 963 `.rs` files. The only
recompute site is `triggers.rs:449-457`, reached when `trigger_type` or `config`
changes on an update — so the value can only ever be created by editing the
trigger.

**Why it matters:** this is the leaf's premise in its purest form. The write path
learned to stamp `next_trigger_at` (`triggers.rs:155` binds it on create); the
existing rows were never given one; and there is no step, sweep, or startup pass
whose job is to notice.

**A repair would have to be careful about:** the missed-fire cascade. Stamping
`next_trigger_at` on 11 enabled schedules makes them all due **immediately** if
the computed time is in the past, and `get_due` returns everything `<= now`
ordered ascending — so a naive backfill dispatches 11 executions at once on the
next tick. `compute_next_trigger_at` (`core/src/scheduler.rs:157`) returns the
*next* occurrence from `now`, which is the right function; a backfill must use it
rather than deriving from `last_triggered_at` (populated on only 2 of the 39
rows). It must also skip rows whose cron/timezone is invalid — `record_invalid_timezone_issue`
(`triggers.rs:485`) exists precisely to explain a NULL, and overwriting those
NULLs erases the diagnosis. And it must not touch the 26 rows in D1 until D1 is
resolved, or it will arm schedules the user believes are off.

### D4 — `persona_events.source_type` carries a slugified display name on 83.8% of rows

**4,166 of 4,972** rows have `source_type LIKE 'persona:%'` —
`persona:T:_Dev_Clone`, `persona:T:_QA_Guardian`, `persona:Dev_Clone_3` — against
a vocabulary that is otherwise 4 values (`chain`, `manual_review`, `system_op`,
`findings`). **`source_id` resolves to a live persona on 4,166 of 4,166**, so the
name is pure redundancy: 15 distinct `source_type` values collapse to **5** under
normalization.

It is also already lossy. `persona:Dev_Clone_3` is the slug of `Dev Clone (3)`;
the parentheses are gone and cannot be recovered — the denormalized copy has
*already* diverged from its source and the encoding is one-way.

**Why it matters:** every consumer that groups or filters on `source_type` sees a
vocabulary that grows by one value per persona created, and a persona rename
silently forks its own history into two buckets.

**A repair would have to be careful about:** the readers. `source_type` is not a
private column — it is matched against by event routing and by
`persona_event_subscriptions`. `UPDATE persona_events SET source_type = 'persona'
WHERE source_type LIKE 'persona:%'` is a 4,166-row rewrite of a **CDC-hooked and
journal-hooked** table (`db/src/cdc.rs`), so per `boot-migration-step` §4 step 6 it
must not run in the migration window where the consumers are not yet spawned —
4,166 rows against bounded channels of 512 and 2,048. Every `LIKE 'persona:%'`
and every equality on the composite form has to be found first (a substring
search for `"persona:"` across `src-tauri` and `src`), or routing that currently
matches will silently stop. This is the largest single row rewrite in the
backlog and the one most likely to be better left alone with a read-side
normalizer instead.

### D5 — a 6-arm CHECK against 5 arms in all 14 locales, and a cast that erased the type that would have caught it

`dev_kpi_measurements.source` was widened to
`CHECK(source IN ('evaluator','manual','scan','health_snapshot','simulation','ai-compose'))`
(`incremental.rs:8232-8296`, verified against the live DDL). `kpis.measurement_source`
holds **exactly 5 keys in every one of the 14 locale files** — `ai-compose` has
no label in any language. `KpiDetailModal.tsx:302` reads
`t.kpis.measurement_source as Record<string, string>` and renders
`sourceLabels[m.source] ?? m.source`, so such a row displays the raw token
`ai-compose` to the user, in all locales, indefinitely.

The generated i18n type (`src/i18n/generated/types.ts:19170`) *is* an exhaustive
object type over the 5 arms. **The `as Record<string, string>` cast is what
disarmed it** — without the cast, `sourceLabels[m.source]` would not compile
against a widened union, which is exactly the signal wanted. The same file does
it again at `:315` for `env_labels`.

`MeasureSetupModal.tsx:76` already writes `'ai-compose'`, so the writer is live;
**0 of 41 live measurements carry it today**, which is why nobody has seen it.
Note the near miss: `KPIDashboard.tsx:161-170` was fixed for this exact widening,
with a comment explaining the lesson — and the label consumer 200 files away was
not. Fixing every instance of a defect is not the same as covering every place
that needs the behaviour.

**A repair would have to be careful about:** nothing on the data side — there is
no backfill here, only a display gap. That makes it the cheapest item in this
section and the only one that is purely additive: add
`kpis.measurement_source.ai_compose` to `en.json`, translate 14 locales through
the pipeline, and replace the cast with a keyed lookup. **The key name cannot be
`ai-compose`** — locale keys are `snake_case` and the stored token is
kebab-case, so the lookup needs an explicit map, which is itself the argument for
a `Record<Source, string>` rather than an index into the raw i18n object.

### D6 — 7 backfills that cannot report anything, in a function that cannot fail

`incremental.rs:7869-7883`, inside `research_lab_align_columns(conn: &Connection)`
— which returns `()`. Seven `UPDATE … SET created_at = COALESCE(…) WHERE
created_at IS NULL` statements, each `let _ = ddl_step(sql)`, run unconditionally
on every launch. The function is structurally incapable of propagating a failure
(`boot-migration-step` Deviations already names the `()` return; this path names
what it costs a **data** step specifically: the affected-row count is the only
evidence a backfill produces, and here it is discarded seven times).

Live: 1 row across all 7 tables, 0 NULL. Cost: **1.08 ms per launch**. The
statements are harmless today and would be silent if they were not.

**A repair would have to be careful about:** nothing — changing the signature to
`Result<(), AppError>` and propagating is a pure code change with no data effect.
It is the safest item here. The judgement call is whether to *abort* the boot on
failure; per the same sibling path, `report_failed_group_id_drop`'s
log-loudly-and-continue shape is the right downgrade for a step that runs at
every launch.

### D7 — an unguarded window-function rewrite 220 lines below the guard that exists for exactly that reason

`initial.rs:300-313`: `UPDATE persona_prompt_versions SET tag = 'experimental'
WHERE tag = 'production' AND id NOT IN (SELECT id FROM (SELECT id, ROW_NUMBER()
OVER (PARTITION BY persona_id ORDER BY version_number DESC) …))`. It runs
unconditionally on every boot, immediately before a `CREATE UNIQUE INDEX IF NOT
EXISTS` that makes it unnecessary after the first pass.

Its sibling at `initial.rs:74-89` does exactly this job correctly — the same
dedupe-then-unique-index shape, guarded on the index's own existence, with the
comment *"previously it re-ran on every launch"*. The lesson was learned in the
same file and not carried 220 lines down.

Measured: **1.05 ms, 0 rows** on 25 versions. Harmless at this size; it is a
full-table window scan and it scales with the table.

**A repair would have to be careful about:** matching the sibling exactly —
guard on `SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND
name='idx_ppv_one_production'`, not on a row count, because the row count is
already 0 and would make the guard vacuously true on a database where the index
does not exist yet.

### D8 — the unconditional set, in full

Eleven statements normalize rows on **every** launch with no guard of any kind.
Timed on a throwaway copy of the live database, all eleven together:

| site | statement | ms | rows |
| --- | --- | ---: | ---: |
| `initial.rs:302` | `persona_prompt_versions` tag dedupe (window fn) | 1.05 | 0 |
| `incremental.rs:2233` | `n8n_transform_sessions` failed+string → `interrupted` | 0.33 | 0 |
| `incremental.rs:4504` | `dev_tasks` `pending` → `queued` | 0.27 | 0 |
| `incremental.rs:5267` | `dev_ideas.dedup_key` null-out (correlated `GROUP BY`) | 1.24 | 0 |
| `helpers.rs:355` | `dev_ideas.category` remap ×6 + forensic scan | 1.9–24.0 | 0 |
| `helpers.rs:306` | `credential_fields` key rename ×5 (anti-join) | 1.48 | 0 |
| `incremental.rs:7871` | `research_*` timestamp backfills ×7 | 1.08 | 0 |
| `helpers.rs:45` | `migrate_blob_credentials_to_fields` candidate scan | 0.75 | 0 |
| `helpers.rs:199` | `clear_legacy_credential_blobs` candidate scan | 0.51 | 0 |
| `helpers.rs:272` | `assert_credential_blob_invariant` EXISTS scan | 0.30 | 0 |
| `incremental.rs:8316` | `normalize_goal_statuses_in_place` full read of `dev_goals` | 2.68 | 188 read |
| | **total** | **9.6 warm / 33.7 first-touch** | **0 changed** |

**The finding is the shape of that table, not its total.** Every one of these
matches zero rows and every one of them is cheap, so no cost signal will ever
surface them — while `persona_triggers.status`, sitting in the same chain with
26 wrong rows, is equally invisible. Contrast the guarded shape at
`incremental.rs:7048`: **0.20 ms**, and it *answers a question*.

The one to watch is `helpers.rs:355` — 24.0 ms on first touch, 1.9 ms warm, on
236 rows. It is six unguarded full-table `UPDATE`s plus a `GROUP BY` scan against
a table that grows with every idea scan.

### D9 — 41 credential-shaped values are already persisted in `persona_executions.tool_steps`

`secret-and-pii-redaction.md` §3 lists *"a backfill for anything already written
— not for the 1,921 `tool_steps` rows"* under **do not exist**. Sized here, since
this leaf owns the history half.

Sweeping **1,921** non-empty `tool_steps` columns (of 2,188 executions;
**33,484** array elements) against 17 credential shapes: **41 raw matches across
28 executions and 29 elements**. Classified by placeholder-detection and Shannon
entropy: **18 placeholder or already-redacted, 1 low-entropy, 22 live-shaped
across 11 executions** — of which 7 are 39-character `AIza…` Google API keys at
4.7 bits/char, 1 a 40-character `ghp_…`, and 11 labelled `refreshToken` /
`accessToken` / `apiKey` pairs. Two independent implementations (Node over raw
column text; CPython over both raw text and a parsed-JSON leaf walk) agree
exactly at 41 / 28 / 33,484. The sibling columns are effectively clean:
`output_data` 0, `error_message` 0, `business_outcome` 0, `input_data` 1.

**A repair would have to be careful about:** `tool_steps` is a JSON array of tool
invocations, and the secrets sit **inside string values**, not under a
recognisable key — which `secret-and-pii-redaction.md` §6 already establishes is
the case neither JSON walker handles. A key-based redactor would rewrite 33,484
elements and mask 4 of them. A value-based pass has to re-serialize each array,
which risks corrupting the column that `useReplayTimeline` and the Pipeline tab
read. And the same rows are the subject of an active, separate defect
(2,638 of 39,729 steps unclosed) — two rewrites of one column by two owners is
worse than one. **This should be scoped with the redaction path, not executed
from here**, and it should almost certainly be a targeted rewrite of the 11
named executions rather than a table pass.

### D10 — structural: 113 of 122 guards are the wrong kind

Not a site, a distribution. `already_applied` across the chain:
**62 `has_column`, 49 `has_table`, 2 `has_index`, 7 `sqlite_master` DDL-text
reads, 1 `|_conn| Ok(false)`, 1 `COUNT(*)` over rows.** Ten steps carry inline
row-rewriting DML; **nine of those ten are guarded on schema**. Separately,
**54 of the 67 row-rewriting statements in the chain sit outside any `run_step`
at all** — no id, no description, no declared guard.

> Correction to a sibling, earned here: `boot-migration-step.md` Deviations and
> `schema-change.md` §7 both list **two** `|_conn| Ok(false)` steps
> (`groups_to_teams_data_migration` and `retire_persona_groups`). At `c47cd36fa`
> there is **one**. `retire_persona_groups` (`incremental.rs:3518`) now carries
> `Ok(!has_table(conn, "persona_groups")? && !has_column(conn, "personas",
> "group_id")?)`. Its line number also moved from `:3408` to `:3518`. The
> `unresumable-migration-step` census rule is unaffected (it never matched either).

## 8 Gaps

1. **SQLite cannot express "this column's default must agree with that column".**
   The `persona_triggers.status` drift is a two-column invariant with no
   declarative home: `CHECK` clauses can reference sibling columns, but SQLite
   cannot `ALTER` a CHECK in, and the table would need a rebuild
   (`destructive-schema-change`) to gain one. The reachable form is a
   `BEFORE INSERT/UPDATE` trigger — the shape `install_persona_memory_invariants`
   (`helpers.rs:396`) already uses for a range bound and nothing uses for a
   cross-column bound.

2. **A backfill has no resumability primitive, and cannot get one from the row
   shape alone.** The guard shape in §2 is idempotent but not *resumable*: an
   interrupted 4,166-row `UPDATE` inside `ddl_step` rolls back entirely (correct),
   but a backfill too large for one transaction has nowhere to record where it
   stopped. Nothing in the chain is chunked, and the largest candidate (D4) is
   4,166 rows against CDC channels bounded at 512/2,048. A `LIMIT`-and-repeat loop
   needs a stable cursor; `rowid` would serve, and no step uses one.

3. **Nothing can distinguish "the backfill converged" from "the predicate never
   matched".** Both produce `changes() == 0` on every subsequent run — and
   `conditional-write.md` §5's executed result is the reason: a matched row that
   writes an identical value still counts 1, so `0` means *the predicate failed*,
   never "already right". D2 is the case where those two readings differ and no
   instrument in the repo can tell them apart. The only known separator is a
   **row-shape count taken before the first run** and compared after — i.e. the
   guard from §2, which is why it is the prescription.

4. **The census cannot assert that a stored vocabulary and its display
   vocabulary have the same arity.** That is a relation between a Rust string
   literal inside a SQL string and a set of JSON keys in 14 files. It cannot be
   counted; it has to be *computed*, which puts it in the same class as
   `check-csp-hosts.mjs` — see §9's second instrument. `conditional-write.md`
   §8 Gap 6 names the same gap from the write side and also declines it.

5. **There is no migration ledger, so "has this backfill ever run" is
   unanswerable in principle, not just in practice.** `boot-migration-step` Gap 1
   establishes that a schema probe is *stronger* than a ledger for DDL because it
   survives a restore. For **data** the relation inverts: the row shape after a
   successful backfill is indistinguishable from the row shape of a database that
   never needed it, so a ledger would carry information the data cannot. This is
   the one place in the corpus where the ledger is the better instrument, and it
   does not exist.

6. **Types do not reach any of this.** Per the doctrine's three places: the
   backfill predicate lives **inside a SQL string literal** (`WHERE importance >= 8`
   compiled fine against a 1..=5 contract for as long as it has existed); the
   `DEFAULT` lives in another string literal in a different statement; and the
   display vocabulary lives in JSON. The only point where a type genuinely
   reaches is the **write path** — `PersonaLifecycle` at `personas.rs:863` — which
   is precisely why §2(d) routes the fix there instead of to the migration.

## Prefer a type over a gate

**Where a type reaches here, it reaches the `INSERT`, not the migration** — and
that is the whole prescription, held against the doctrine's seven
qualifications.

The candidate: make the derived column's value **unconstructible without its
source**. Not `status: String` beside `enabled: bool`, but a single
`TriggerState` that the row is built from, with the boolean derived on read.

- **Q1 (a required prop carries only what it encodes)** — passes, narrowly.
  Making `status` required at the `INSERT` sites does not encode the *relation*
  to `enabled`; two required fields can still disagree. The type has to own both.
- **Q2 (requiredness ≠ closedness)** — this is the sharp one. `status` is
  *already* `NOT NULL DEFAULT 'active'`: required in the strongest sense SQLite
  offers, and 26 rows are wrong anyway. **The `DEFAULT` is what converts
  "required" into "silently supplied".** A `NOT NULL` column with a constant
  default is not a required field; it is an optional field with a hidden answer.
- **Q3 (a type nobody constructs constrains nothing)** — passes. There are 10
  production construction sites for `persona_triggers` and 4 for
  `persona_memories`; they are enumerable and small.
- **Q4 (a type anyone can construct authenticates nothing)** — binds. A
  `TriggerState(String)` newtype with a public field is a comment. It must be
  constructible only through `TriggerStatus::as_str()` /
  `is_enabled()` (`core/src/lifecycle.rs`), which already exist and are already
  the right shape — `set_status` (`triggers.rs:1877-1890`) derives *both* columns
  from one `TriggerStatus` argument and is the model.
- **Q5 (withholding beats requiring)** — this is the win, and the repo has
  already run the experiment. Three sibling write paths on one axis:
  `set_status(pool, id, TriggerStatus)` withholds the boolean entirely and derives
  it — **1 of 1 correct**. `set_enabled(pool, id, bool)` hands back both and
  remembers to sync — **1 of 1 correct, by author discipline**. The ten raw
  `INSERT`s permit either column independently — **5 of 10 wrong**. Same
  invariant, three doors, and the failure is entirely at the permissive one.
- **Q6 (withhold the dangerous freedom, not the answer)** — the dangerous freedom
  is *naming one column without the other*. Withholding `status` from callers
  (server-derived) is right; withholding the notion of enabled/disabled would
  break the feature.
- **Q7 (withholding a requirement only helps when the requirement forced the bad
  value)** — passes. Here the caller does not supply a bad value; it supplies
  **no** value and the `DEFAULT` supplies a bad one. Removing the `DEFAULT` is
  therefore load-bearing and not inert: it converts a silent wrong answer into a
  `NOT NULL` constraint failure at the five sites that need changing.

**So the type change is: drop the constant `DEFAULT` from any column a migration
backfills, and give the pair one constructor.** That is one edit at the schema
and five at the call sites, and it removes the deviation class permanently —
where the census rule below only counts it. It is also the only fix in this
document that is *not* a data change, which on this leaf matters more than usual.

The same argument, one layer up, is why §2(d) is written as a prohibition rather
than a preference: **a constant `DEFAULT` and a backfill in the same migration is
the type-level statement that the column has two owners.**

## 9 The missing gate

### What the signal is a proxy for

**The condition:** a migration repairs existing rows while something else keeps
manufacturing the shape it repaired. **The proxy, in this stack:** an
`ALTER TABLE … ADD COLUMN <c> … DEFAULT <constant>` followed, inside the same
migration block, by an `UPDATE … SET <c> = …`. The two statements are two
answers to one question, and the step only exists because they disagree.

That proxy is **manifestation-layer** and does not travel. A repo with a
migrations ledger, or generated columns, or a framework that forbids defaults on
backfilled columns, will wear this defect differently — an adopting repo should
re-derive a signal for *"a value written by a migration that a later write can
re-break"* against its own idiom, not port this regex.

### Rules I checked for overlap

Of the **140** rules in `scripts/census/rules.json`: `unresumable-migration-step`
(guard observes one object, body commits ≥2 DDL transactions — `personas.lifecycle`
matches both it and mine, but it keys on the *count of `ddl_step` calls* and is
blind to whether any row is written); `handwritten-rebuild-shape` (replacement
shape written in source); `discarded-guard-verdict` (single-row `UPDATE … WHERE
id = ? AND …`, structurally disjoint — a backfill has no `id = ?`);
`discarded-sync-watermark-write`; `nullable-default-column`;
`constraintless-table-declaration`; `deferred-read-then-write`;
`unatomic-sequence-rewrite`; `blind-identity-write`; `hand-rolled-fixture-ddl`;
`silent-row-skip`; `retention-delete-by-status-allowlist`;
`partial-terminal-status-set`. **None matches on the `DEFAULT`-plus-backfill
pair.** `schema-change.md` publishes no census rule at all.

### The rule

Validated standalone in a composer-private scratch registry
(`rules-dnm-scratch.json`), then re-extracted from this document and re-run —
identical results both times. **3 matches / 1 file, 963 files walked, 1.6 s for
rule + control.** The full registry was **not** run, per doctrine.

```json
{
  "rules": [
    {
      "id": "default-contradicted-by-backfill",
      "goldenPath": "docs/concepts/golden-paths/data-normalization-migration.md",
      "title": "A column added with a constant DEFAULT and then backfilled to something else in the same migration block — the backfill repairs the rows that exist while the DEFAULT keeps manufacturing the pre-migration shape for every row written afterwards",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "ADD\\s+COLUMN\\s+[\"'\\x60]?([A-Za-z_]\\w*)[\"'\\x60]?[^;\"]{0,120}?\\bDEFAULT\\s+(?:'[^']*'|\"[^\"]*\"|-?\\d+)(?:(?!run_step\\()[\\s\\S]){0,2600}?\\bUPDATE\\s+[\"'\\x60]?[A-Za-z_]\\w*[\"'\\x60]?\\s+SET\\s+[\"'\\x60]?\\1\\b",
        "flags": "gi",
        "description": "ADD COLUMN <c> ... DEFAULT <constant>, followed inside the same migration block by an UPDATE assigning that same <c>. The two statements are two different answers to 'what should this column hold' -- the DEFAULT answers it for every row written from now on, the backfill answers it for the rows already on disk -- and the step only exists because they disagree. Nothing carries the backfill's rule into the write path, so a later INSERT that omits the column silently re-creates the pre-migration shape the backfill was written to remove: the backfill is a one-shot repair against a permanent generator. The backreference (\\1) is load-bearing -- it requires the UPDATE to assign the SAME column that was just defaulted, which is what removes 95.2% of the anchor. The `(?!run_step\\()` temper stops a match crossing into the next migration step. Precision 3/3, every match hand-read and replayed against a read-only copy of the live 347 MB personas.db: incremental.rs:2175 persona_triggers.status (26 live rows drifted from `enabled`; 5 of 10 production INSERT sites omit the column), :2200 persona_memories.tier (backfill predicate `importance >= 8` against a 1..=5 trigger-enforced contract -- 0 rows promoted, ever; 0 of 6,535 memories in the `core` tier), :6693 personas.lifecycle (condition present, write path closed at personas.rs:880 via PersonaLifecycle, 0 rows drifted -- the in-file exemplar of the fix the other two need). Compliant shapes: add the column with NO default and backfill it (incremental.rs:4672, dev_tasks.updated_at), or bind the column in the canonical INSERT from a closed type. Fix = drop the DEFAULT, not add a second backfill. Anchor (every ADD COLUMN with a constant DEFAULT) = 63 across 4 files; this selects 3.",
        "$measured": "2026-08-16 @ c47cd36fa — 963 .rs files walked; two independent implementations (a standalone brace-matched Rust scanner and the census engine) returned 3/3 identically and disagreed on the ANCHOR by exactly 2 (61 vs 63), traced to fk_hygiene.rs:959,960 sitting inside a #[cfg(test)] module the census engine cannot exclude. Validated in a composer-private scratch registry, then re-extracted from the published document and re-run with the same result. Rule + control together: 1.6 s."
      },
      "baseline": { "files": 1, "matches": 3 },
      "floor": 900
    },
    {
      "id": "default-contradicted-by-backfill-positive-control",
      "goldenPath": "docs/concepts/golden-paths/data-normalization-migration.md",
      "title": "CONTROL: every ADD COLUMN carrying a constant DEFAULT — the anchor the rule selects 3 of 63 from",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "ADD\\s+COLUMN\\s+[\"'\\x60]?([A-Za-z_]\\w*)[\"'\\x60]?[^;\"]{0,120}?\\bDEFAULT\\s+(?:'[^']*'|\"[^\"]*\"|-?\\d+)",
        "flags": "gi",
        "description": "The anchor: 63 matches across 4 files (incremental.rs 48, db/src/lib.rs 8, initial.rs 5, fk_hygiene.rs 2 — the last two inside a #[cfg(test)] module the engine cannot exclude, so 61 production). A control at 63 against a rule at 3 is the discrimination evidence: the backfill clause is doing the selecting, not the ADD COLUMN. Adding a column with a default is overwhelmingly normal and correct here — 60 of 63 sites have no competing backfill and are not defects."
      },
      "floor": 900
    }
  ]
}
```

**Why the control is the anchor rather than the complement.** The intended
control — the anchor plus a negative lookahead excluding the backfill — returns
**63, identical to the anchor**, because a backreference inside a negative
lookahead does not exclude these matches under this engine (verified directly:
the lookahead form still reports lines 2175, 2200 and 6693). Rather than ship a
control that silently proves nothing, the anchor is published as the control and
the partition is stated arithmetically: **3 violating of 63, so the discriminating
clause removes 95.2%**. This is the weaker of the two control forms the doctrine
describes; it is reported as such rather than dressed up.

**How it fails loudly if its own precondition is absent.** The census engine
supplies this: `floor: 900` fails the run if fewer than 900 files are walked
("the matcher is broken, not the codebase clean"); a rule matching zero files
anywhere fails structurally; a rise fails; a **drop without `--update` fails**,
which is the relevant direction here, since the intended end state is 0.

**End of life.** This rule is designed to reach zero. When it does, **delete
it** — do not baseline it at 0; the census cannot express "must be zero" and a
0-baselined rule fails structurally.

### Gates I measured and refused, with numbers

| candidate | violating | compliant | why refused |
| ---: | ---: | ---: | --- |
| a row-rewriting migration statement whose `Result` is discarded | **47** | 614 | Scoped to `src-tauri` the matches are overwhelmingly **runtime** code (`companion/`, `commands/design/`, `engine/`), not migrations — 26 files, and the leaf's territory is 2 of them. Scoped to `db/src/migrations/` it drops to **2**, both `INSERT OR IGNORE` dedupes where discarding is defensible. `destructive-schema-change` D5 refused the neighbouring form for a related reason; this one fails on *domain*, not on precision. Carried as D6 |
| a schema probe guarding a row-rewriting `apply` body | 9 | 1 | **Fires on 90% of the population.** Nine of the ten steps carrying inline DML guard on `has_column`/`has_table`; a gate that flags almost everything is a re-description of the codebase, not a ratchet. It is the right *finding* (D10) and the wrong instrument. The `DEFAULT`-pair rule is the sharp subset of the same concern |
| a migration `UPDATE` with no rows-affected log | 26 | 4 | 87% violating — same objection, and the compliant four are not obviously better (a log is not a postcondition) |
| a backfill predicate that can never match | 1 | n/a | **Not expressible.** `WHERE importance >= 8` is only wrong because a *trigger installed in a different file* bounds the column to 1..=5. No matcher relates a SQL predicate to a constraint declared elsewhere. This is D2, and it needs the second instrument below |
| a stored vocabulary whose arity differs from its display vocabulary | 1 | 1 | **The census cannot assert this class at all** — it is a computed relation between CHECK arms inside a Rust string and JSON keys across 14 files, not a count of a present shape |

### The second instrument — extend the parity test that already exists

Two of the five refusals above are the same shape: a relation between two
declarations in different languages. The corpus's usual answer is "write a check
script". **Here it is not, because the repo already built the right primitive and
pointed it at one vocabulary.**

`src/i18n/__tests__/chainStopReasons.parity.test.ts` asserts set equality between
a mirrored Rust const list and `en.status_tokens.chain_stop`, and its header
states the failure mode verbatim: *"a new Rust `stop_reason` const ships to
production as an untranslated raw token in all 14 locales, with no build
signal."* That is exactly D5, one vocabulary earlier. It runs under `npm run test`
— not CI-only, which matters, because `ci.yml` has never passed and a CI-only
gate runs nowhere.

**The instrument is a second file in the same directory, not a new mechanism.**
`src/i18n/__tests__/measurementSource.parity.test.ts`, same 30-line shape:

- A `SQL_CHECK_ARMS` const mirroring
  `CHECK(source IN (…))` from `incremental.rs:8232-8296`, with the file:line in
  the comment, exactly as `chainStopReasons` mirrors `chain.rs:45-81`.
- `expect(Object.keys(en.kpis.measurement_source).sort()).toEqual(...)` — which
  **fails today**, 5 keys against 6 arms.
- A length assertion first (`expect(SQL_CHECK_ARMS).toHaveLength(6)`), copying
  the existing test's `toHaveLength(13)` — that line *is* the fail-loud
  precondition: it turns "somebody emptied the mirror list" from a silent pass
  into a failure, which is precisely the no-op-gate hazard.
- And the token↔key normalization the existing test does not need: the stored
  arm is `ai-compose`, locale keys are `snake_case`, so the parity assertion must
  compare through the same map the renderer uses — which forces the renderer to
  *have* a map instead of `as Record<string, string>`.

**Then generalize, once there are three.** A `vocabularyParity` helper taking
`(rustArms, localeObject, normalize)` and a table of the vocabularies covered,
so the fourth costs four lines. **Do not build the generalized version first** —
the convergence sweep found that *six independent codebases* hand-maintain
between three and four copies of a constrained vocabulary and **not one has a
general solution**; the two-instance version that exists here is already ahead of
all five siblings, and the risk in generalizing early is building a matcher
nobody points at a new vocabulary either.

Coverage note, measured rather than assumed: `persona_triggers.trigger_type` is a
6-arm CHECK and **all 6 arms have labels in all 14 locale files**
(`triggers.type_manual` … `triggers.type_chain`). It is not a gap; it is the
second data point that the parity assertion would be asserting something true,
which is what makes it worth writing for the case where it is false.

**And the gate this leaf most wants, which is a test, not a script.** A Rust test
next to `migration_chain_is_idempotent_on_rerun` (`incremental.rs:8566`):
`a_second_run_of_the_chain_writes_no_rows`, using `conn.total_changes()` around
the whole chain on an already-migrated fixture. `boot-migration-step` §9 Half 2
specified this instrument and it is still unbuilt; that path measures *statements
re-prepared*, and **this** half — rows actually written — is the one that belongs
to data normalization. Its load-bearing line is the precondition:
`assert!(total_changes_first_run > 0, "the fixture was already migrated — this
test is measuring nothing")`. Today the answer would be **0 rows on the second
run**, which is the correct result and also the exact number a completely broken
probe returns; without the first-run assertion the test is a no-op that looks
like a pass.

## 10 Convergence

Swept against all five sibling checkouts — `personas-web`, `brainiac`,
`personas-cloud`, `vibeman`, `ascent` — all of which exist. The spine labels this
leaf `mixed`; the measurement agrees, and the shape of the mix is the finding.

**There is no clause on which all five siblings converge, and no sibling
converges on all six clauses checked.** That is reported as-is rather than
smoothed.

**Converged — treat as physics.**

- **A data migration needs a postcondition stronger than a schema probe, and
  three siblings independently reinvented one — each by a different mechanism.**
  `vibeman` guards on the row shape itself (`217_knowledge_layer.ts:29`, a
  self-retiring `WHERE … layer = 'cross_cutting'` predicate — the same idea as
  §2(b), arrived at with no shared document). `personas-web` guards on **the
  constraint the backfill installs** (`scripts/setup-voting-db.sql:56-71`:
  `if not exists (select 1 from pg_constraint where conname = …) then` dedupe,
  then `add constraint`) — stronger than either, because guard and goal become
  one fact. `brainiac` makes completeness a **queryable column**:
  `embedding_versions.is_active` (`migrations/0001_init.sql:96`), flipped only
  after the backfill loops drain, and refused loudly at both serve doors
  (`memories.rs:204-209`: *"is not fully backfilled — run `reembed` to
  completion"*). **Three repos, three mechanisms, one conclusion: a column probe
  can tell you a column exists and can never tell you it is populated.** §2(b)
  is doctrine, not house convention.

- **The dedupe-then-unique-index half converges twice** — `personas-web`'s
  `pg_constraint` guard and `brainiac`'s `0042_divergence_identity.sql:29-35`
  pre-index dedupe are the same shape as `initial.rs:74-89`.

- **Refusing to denormalize beats syncing well.** The two siblings with the least
  drift got there by not creating the surface: `personas-web` has **0 triggers,
  0 generated columns**, computes vote tallies at read
  (`src/app/api/votes/route.ts:53-57`) and **deliberately has no `vote_count`
  column**; `ascent`'s `TeamStandingSnapshot` is append-only with a read path that
  uses it *only to stamp when it was captured* (`team-standings.ts:59-62`), so a
  stale snapshot degrades a timestamp and never a value. `brainiac` has a
  migration whose entire content is a **written refusal** to add a derived title
  column (`0023_memory_title.sql:10-17`). Held against D1/D2/D4, this is the
  clause that should change behaviour: the question before "how do I keep this in
  sync" is "why does this column exist".

**Local calibration — labelled as such.**

- The **`DEFAULT`-contradicted-by-backfill** defect is a SQLite/`ALTER`-shaped
  hazard. Siblings on a migration DSL cannot easily express the pair, and no
  independent rediscovery was found. §9's census rule is house calibration, which
  is why §9 states that an adopting repo must re-derive its own proxy.
- **No ledger** is near-specific to Personas among the six: `vibeman` has
  `_migrations_applied` (with `status` / `error_message`, so a **failed** step
  retries rather than latching — `migration.utils.ts:216-221`), `brainiac` a
  **checksummed** `_sqlx_migrations`, `ascent` `_prisma_migrations`,
  `personas-cloud` a bespoke `migration_version`; only `personas-web` also has
  none. Gap 5's claim that a ledger is the better instrument *for data* is
  supported — and `vibeman` also prices the retrofit: `index.ts:140-157`
  pre-seeds four destructive migrations as `applied` **without running them**, and
  `145_fix_ideas_effort_constraint_retry.ts` exists because that assumption was
  wrong once.
- **Boundedness and resumability have exactly one converged implementation**, and
  it is worth copying wholesale:
  `brainiac/crates/brainiac-pipeline/src/reembed.rs` — chunked `LIMIT` loop,
  tunable batch size, per-batch rows-affected, terminal stats, and the design
  statement at `:16-19`: *"the 'missing embedding' query IS the resume point, and
  each batch autocommits (no wrapping transaction), so an interrupted run simply
  continues where it stopped."* That is Gap 2's answer, built. Nothing in
  Personas is chunked.

**Convergence on the problem, not the solution — the strongest result in the
sweep.** Clause C5 (a widened stored vocabulary vs its display vocabulary) is
`absent` or `different-mechanism` in **all six repos including Personas**. Six
independent codebases hand-maintain three to four copies of a vocabulary the
database constraint already knows, and nothing connects them: `vibeman` keeps a
5-arm list in four places with a `default:` swallow at the dispatch site
(`scanNotifications.ts:50-52`); `personas-cloud` carries a doc comment claiming
*"adding a new worker status produces a compiler error here"* directly above
`function toDbStatus(workerStatus: string)` with `default: return 'failed'`;
`brainiac` has the casualty written into a migration header
(`0041_okf_publish_target.sql:1-11`: *"nobody widened the constraint … the entire
OKF export path was unreachable in production while its unit tests stayed
green"*); `ascent` has **0 Prisma enums, 0 zod, 0 `assertNever`**. **Personas is
the only one of the six with any instrument at all** — the `chainStopReasons`
parity test — pointed at one vocabulary of several. That asymmetry is the whole
argument for §9's second instrument, and it is why the prescription there is
*extend the file that exists*, not *write a script*.

**Where Personas leads, reportably.**

- **Testing a migration against old-shape rows.** **10 of 20** tests in
  `incremental.rs`'s test module seed rows and then run a migration (9 building
  legacy DDL by hand). Only `vibeman` has a comparable case
  (`tests/unit/cascade-delete-evidence-junction.test.ts:236-277`, which drops
  triggers, manufactures an orphan, re-runs the migration, asserts cleanup).
  `personas-web` 0, `ascent` 0 — and `ascent`'s CI has **no database at all**.
- **A pre-migration snapshot on every boot** (`db/src/backup.rs`). No sibling
  snapshots before migrating.
- **Reusing the runtime writer as the backfill** (`incremental.rs:4097-4102`).
  Not found anywhere in the five. §2's closing clause rests on it.

**The port regression, this leaf's sharpest negative evidence.**
`personas-cloud` mirrors these tables by name (`types.ts:2`: *"mirroring desktop
Tauri models"*) and dropped the vocabulary on the way: `trigger_type` **6 arms →
5** (`event_listener` has zero occurrences in that repo), execution `status`
**6 → 5** (`incomplete` likewise), and the desktop's three FTS-sync triggers →
**zero `CREATE TRIGGER` anywhere**, while the derived search data was kept. It
compounds: an execution the desktop calls `incomplete` is coerced by that
`default: return 'failed'` and lands in the success-rate rollups as a failure.
**The derived column survived the port; the mechanism that kept it true did
not** — D1's failure mode, reproduced in another repo by a careful engineer, and
the best available argument that this belongs in a type rather than a convention.

> **Provenance.** This section is a subagent sweep of the five checkouts,
> spot-verified against this repo before publication. **One of its claims did not
> survive that check and was removed** — see 12.8. Sibling `file:line` references
> are from the sweep and were not re-opened here; treat them as leads with an
> address, not as first-hand reads.

## 12 Corrections to the brief

The brief is the orchestrator's hypothesis. Five of its claims did not survive
measurement, and two of the corrections changed what this document says.

**12.1 — "37 `next_trigger_at` rows are still NULL." Correct, and only under one
of five readings.** The table has **351** rows and **349** are NULL. The brief's
37 is the count for `trigger_type IN ('schedule','polling')` — time-based
triggers — regardless of `enabled`. The operationally interesting figure is
neither: **11** rows are `enabled = 1 AND status = 'active' AND next_trigger_at
IS NULL`, i.e. live schedules that cannot fire. `event_listener` (189),
`manual` (68) and `chain` (55) triggers are *supposed* to have no next fire time,
and **0** non-time-based rows have one — so the write path is not merely "fixed",
it is correctly discriminating. The finding survives; the denominator was doing
a lot of work.

**12.2 — "114 credential-shaped values already persisted in `tool_steps`." Did
not reproduce under any of three classifications.** Raw shape matches: **41**.
Surviving placeholder-and-entropy classification: **22**. And
`secret-and-pii-redaction.md`, which classified against the literals the vault
actually holds, reports **6**. Two independent implementations (Node raw-text;
CPython raw-text *and* a parsed-JSON leaf walk) agree exactly at 41 / 28
executions / 33,484 elements. **114 is not any of these numbers under any
threshold I could construct.** The finding is real and smaller than briefed, and
the useful shape of it is that 7 of the 22 survivors are 39-character Google API
keys — a single provider accounts for a third of the remainder.

**12.3 — "`tool_steps`" is not a table.** It is a JSON `TEXT` column on
`persona_executions`. There is no `tool_steps` table in either database, and the
literal `tool_steps` appears **zero** times in `src-tauri/`. This is already
recorded as a correction in `.claude/active-runs.md:111`; it cost a full
repository grep to re-derive, which is an argument for the brief carrying the
column name rather than a table name.

**12.4 — "`persona_events.source_type` holds a slugified display name for 83.8%
of rows, while `source_id` resolves 4,166/4,166." Exactly right, and understated.**
4,166 of 4,972 is 83.79%, and all 4,166 resolve. What the brief did not say is
that the encoding is **already lossy**: `persona:Dev_Clone_3` is the slug of the
live persona `Dev Clone (3)`, and the parentheses cannot be recovered from the
slug. The column is not a stale copy that could be refreshed — it is a one-way
hash of a mutable name, which is what makes the read-side normalizer the better
fix than the rewrite.

**12.5 — "A 6-arm SQL CHECK on a measurement-source column against 5 arms in
every locale file." Correct in every particular, and the interesting part is one
layer below.** 6 arms live (`…,'simulation','ai-compose'`), 5 keys in all 14
locale files, `ai-compose` absent from every one. But the repo **already had** the
type that catches this: `src/i18n/generated/types.ts` declares
`measurement_source` as an exhaustive object type. It was defeated by
`as Record<string, string>` at `KpiDetailModal.tsx:302`. A cast, not a missing
type — which moves this from "add a gate" to "delete a cast", and is why it is
the cheapest item in §7. The repo also already owns the assertion that would
have caught it, one vocabulary over (§9's second instrument).

**12.6 — "A migration drop/re-add pair was removed for costing ~186 ms and two
table rewrites per launch — check what else runs unconditionally on every
launch." Answered, and the answer inverts the implied hypothesis.** Eleven
data-normalization statements run unconditionally: **9.6 ms warm, 33.7 ms
first-touch, 0 rows changed**, timed on a copy of the live database. **Nothing
here is a 186 ms problem, and that is the finding.** The removed `DROP COLUMN`
pair was caught *because* it was expensive; these are cheap, and cheapness is
exactly why nothing has ever surfaced them — while `persona_triggers.status`,
sitting in the same chain with 26 wrong rows, costs nothing at all and is wrong
anyway. **Cost was the wrong instrument for this leaf**, and looking for another
186 ms would have found nothing while the real defects sat in the same file. The
one statement worth watching on cost grounds is `helpers.rs:355` (24.0 ms cold,
six unguarded full-table `UPDATE`s over a table that grows with every idea scan)
— and it has converged, so it is a latent cost, not a live one.

**12.7 — the brief's framing "`persona_tombstones` has no writer, so no local
delete has ever propagated" is correct and is not this leaf's.** It is
`sync-reconciliation-and-conflicts` D1, measured there at 0 rows, 0 `INSERT`
sites, 78 personas + 22,508 child rows of exposure. Confirmed unchanged at
`c47cd36fa` (0 rows) and deliberately not re-litigated. A brief that primes a
lead already owned by a published sibling risks buying the same finding twice.

**12.8 — a correction to my own convergence sweep, caught by spot-checking it.**
The sweep reported that `persona_triggers.trigger_type` is a 6-arm CHECK covered
by only **4 of 6** arms in the locale files, and that `chain` "has no key anywhere
in `en.json`". Both are false. Measured directly across all 14 locale files, all
**6/6** arms have keys, and `triggers.type_chain = "Chain"` exists. Had it been
taken on trust it would have shipped a second fabricated deviation next to a real
one — and it is the more dangerous kind of error, because it agreed with the
document's thesis. **An oracle result that confirms your argument gets the same
verification as one that contradicts it.** The same sweep's genuinely
load-bearing findings — `chainStopReasons.parity.test.ts`, the `sla_daily`
writer-reuse backfill, and the 10-of-20 old-shape test count — were each
re-derived here before being used, and all three held.

**12.9 — the brief's framing "compose one golden path" undersold what the corpus
already had, twice.** §9's second instrument was drafted as a new
`check-vocabulary-arity.mjs` script; the repo already ships that exact
instrument, pointed at a different vocabulary
(`src/i18n/__tests__/chainStopReasons.parity.test.ts`, set equality against a
mirrored Rust const list, with the failure mode written in its header). And §2's
strongest clause — reuse the runtime writer as the backfill — was found at
`incremental.rs:4097-4102` with a comment already stating the principle. Both
were missed on the first pass and found on the second sweep the contract asks
for. **The corpus's rule "prefer the primitive that exists" applies to gates as
much as to components**, and a composer's first draft of a §9 is the likeliest
place to violate it.

**One methodological note, paid for in a wrong number.** My own `INSERT`-site
scanner truncated each column list at 400 characters and reported that
`personas.rs:880` does not name `lifecycle`. It does — the column sits at
position 18 of 20, past the window. The count it produced (6 production sites, 0
naming the column) was internally consistent, plausible, and wrong, and it would
have promoted `personas.lifecycle` from "the exemplar of the fix" to "the third
defect". It was caught only by opening the file the tool had already summarised.
This is the doctrine's *measurement truncated by its own display limit*, and the
lesson it re-teaches is narrower than the general one: **a window that clips a
column list produces a false NEGATIVE, which no amount of hand-verifying the
positives will find.**
