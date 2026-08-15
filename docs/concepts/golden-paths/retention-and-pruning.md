# Golden path — Retention and pruning

> Situation node: `data-persistence/query-performance/retention-and-pruning` ·
> [situation spine](../situation-spine.md) · recurrence 22 · risk **HIGH** ·
> sides: **server** · convergence: **diverged** ·
> dimensions: **performance · function · cost · resilience · security**
> Composed 2026-08-15 against `master` @ `2a874e692`.
>
> **Sweep size.** 963 `.rs` files (the full `src-tauri` tree, walked by the census
> engine and by an independent brace-matched scanner that agreed on the file
> count), plus the operator's live data directory: two SQLite databases
> (331.0 MB + 16.7 MB), a 996 MB `backups/` directory and 2,999 log files
> totalling 410.7 MiB.
>
> **Measured by execution, not by reading.** Every load-bearing number was taken
> twice by two independent implementations and is reported only where the two
> agreed; the census rule in §9 was validated in a standalone scratch registry,
> then re-extracted from this finished document and re-run — 3/3, 10/10 and
> 101/307, identical. Beyond agreement, **all 13 sites in the §9 partition were
> hand-read** (their SQL is quoted in §7), because two implementations of the
> same misconception agree perfectly.
>
> The live databases were **copied** and opened read-only; every destructive
> replay ran against a scratch copy. `cargo` was not run (PreToolUse guard — the
> operator's app is running).
>
> ---
>
> ## The headline, up front: this app has two retention settings, both wired, and today they delete zero rows
>
> Not "too few". **Zero.** Both cleanup functions were replayed verbatim against
> the live database.
>
> | control | default | wired? | rows it deletes today | table |
> | --- | --- | --- | --- | --- |
> | `event_retention_days` | 30 | yes — `background.rs:2974` | **0** of 4,972 | `persona_events` |
> | `event_retention_max_count` | 10,000 | yes — `background.rs:2996` | **0** (max **31**, ever) | `persona_events` |
> | `execution_retention_days` | 60 | yes — `background.rs:3063` | **0** of 2,188 | `persona_executions` |
> | `execution_retention_months:<persona>` | — | **no Rust reader exists** | **0**, by construction | — |
> | `draft_retention_days` | 0 (opt-in, off) | yes — `background.rs:3128` | 0 (disabled by design ✔) | `personas` |
>
> Each row of that table fails for a *different* reason, and no two share a fix.
> That is the shape of this leaf: retention here is not one broken mechanism, it
> is **five independent predicates that each default to RETAIN**, and a tick that
> is silent by construction when a predicate matches nothing.
>
> ### 1 — `events::cleanup` deletes the status only tests write, and keeps the one production writes
>
> `PersonaEventStatus` (`core/src/models/event.rs:16`) has 8 variants. The
> cleanup allowlist (`db/src/repos/communication/events.rs:595`) names four:
> `('completed', 'skipped', 'failed', 'discarded')`. It omits **`Delivered`** —
> documented at `event.rs:21` as *"Successfully dispatched to subscriber
> executions"*, the normal terminal success state, written by production at
> `background.rs:1765`. `Completed`, which the allowlist *does* name, is
> documented at `event.rs:23` as *"General-purpose success terminal state (used
> by mocks/tests)"* — and appears **0 times** in the live table.
>
> | live `persona_events` | rows | age |
> | --- | --- | --- |
> | `delivered` | **4,941** (99.4%) | 2026-06-03 → 2026-06-26 (**50–73 days**) |
> | `skipped` | 31 (0.6%) | 2026-08-10 → 2026-08-14 (within the window) |
> | `completed` / `failed` / `discarded` | **0** | — |
>
> Replaying `cleanup(30)` verbatim: **0 rows deleted.** Every row the allowlist
> can reach is newer than the cutoff; every row older than the cutoff has a
> status the allowlist cannot reach. The 4,941 `delivered` rows are 20–43 days
> past a 30-day policy and are **permanently immortal** — not slow to expire,
> *unreachable*.
>
> **The designed backstop shares the identical blind spot.** `enforce_count_cap`
> (`events.rs:625`) exists precisely because *"age-only cleanup lets the table
> balloon inside a single retention window"* — and it repeats the same four-status
> literal. Replayed with `max_keep = 0`, the most aggressive value the cap can
> ever take, it deletes **31** rows and leaves **4,941**. A ceiling that cannot
> bound its table is not a ceiling. (With the shipped default of 10,000 against
> 31 eligible rows, it has never fired at all.)
>
> ### 2 — `cleanup_old_executions` is disarmed by its own safety floor
>
> `cleanup_old_executions(pool, 60, 50)` (`executions.rs:1827`) keeps *"at least
> 50 most-recent records for each persona"*. Replayed against the live database:
>
> - 59 personas have terminal executions older than the 60-day cutoff.
> - For **59 of 59**, `LIMIT 1 OFFSET 50` returns `NULL` — no persona has more
>   than 50 terminal rows (the live maximum is exactly **50**).
> - Every persona hits `None => continue` (`executions.rs:1877`).
> - **Rows deleted: 0. Rows past the cutoff still present: 1,776.**
>
> The floor is per-persona, so its *effective* value is `50 × persona_count` =
> **2,950** against a table of **2,188**. The floor grows every time a persona is
> created; the table does not. **A per-entity minimum silently becomes a global
> minimum that outruns the data**, and the retention window never binds.
>
> ### 3 — a retention dial with a UI and no reader
>
> `execution_retention_months:<persona_id>` is written and read by the persona
> settings UI (`PersonaSettingsTab.tsx:65` reads, `:73` writes), is key-validated
> (`settings_keys.rs:1175`), and is audit-categorised as `"retention"`
> (`settings_keys.rs:1176`). Its complete set of Rust references is: the constant
> declaration, those two validation branches, and two tests. **No code reads its
> value.** `cleanup_old_executions` takes a single global `retention_days` and has
> no per-persona concept. The user can set a per-persona retention period, the
> app persists it, the settings audit log records the change — and nothing
> anywhere consumes it.
>
> ### 4 — the biggest table in the database is not the one anyone is watching
>
> The brief pointed at execution logs and at `persona_events`. Measured via
> `dbstat`, per table **including its indexes**:
>
> | table | MB | % of file | rows | pruned by |
> | --- | ---: | ---: | ---: | --- |
> | **`workspace_practice_context_state`** | **111.09** | **33.7%** | **253,752** | nothing (see below) |
> | `persona_executions` | 58.42 | 17.7% | 2,188 | a cleanup that deletes 0 |
> | `persona_memories` | 37.13 | 11.3% | 6,535 | tier-scoped deletes only |
> | `execution_traces` | 31.48 | 9.6% | 2,942 | **no DELETE exists anywhere** |
> | `persona_events` | 15.78 | 4.8% | 4,972 | a cleanup that deletes 0 |
> | `executions_fts` | 14.45 | 4.4% | 2,188 | trigger-synced ✔ |
>
> `workspace_practice_context_state` is a **materialised cartesian product**:
> 1,164 adopted practices × 218 contexts = 253,752 cells, seeded by
> `seed_practice_context_cells` (`dev_workspaces.rs:2377`). Of those cells:
>
> | state | rows | share |
> | --- | ---: | ---: |
> | `unverified` | 176,380 | 69.51% |
> | `na` — computed at seed time to be **not applicable** | 77,289 | 30.46% |
> | `adopted` | 74 | 0.029% |
> | `violating` | 9 | 0.004% |
>
> **83 rows (0.033%) carry a verdict**; 83 have `evidence`; 83 have `verified_at`.
> The other 253,669 are the absence of information, stored at ~460 bytes each
> across four b-trees. Its only DELETE removes cells whose practice left
> `adopted` — there is no age, count or size bound. It is the single largest
> object in the file and it is outside the retention system entirely.
>
> ### 5 — 406 MB of execution logs, 40% of it unreachable, with credentials in it
>
> | measured on disk | value |
> | --- | --- |
> | execution log files (`<uuid>.log`) | **2,991** |
> | total size | **406.6 MB** (410.7 MiB incl. the 8 rolling/crash files) |
> | oldest | **2026-04-06** (131 days) |
> | referenced by a live `persona_executions.log_file_path` | 1,479 |
> | **orphans — file exists, execution row is gone** | **1,512 (163.3 MB, 40.2%)** |
> | **dangling — row exists, file is gone** | **595 of 2,074 (28.7%)** |
>
> Both directions are broken at once. Nothing deletes an execution's log when the
> row goes; nothing notices when the file goes. `prune_orphan_personas_logs`
> (`logging.rs:194`) exists and is wired (`:118`) — but it matches only
> `personas.*.log` rolling files and *explicitly* preserves *"execution logs named
> with UUIDs"* (`:193`). The 2,991 UUID logs have no retention owner at all.
>
> **These files contain credential material.** Scanning all 2,998 (408.7 MB of
> text) for token *shapes* — never values:
>
> | shape | files | occurrences | token length |
> | --- | ---: | ---: | --- |
> | `gh[pousr]_…` GitHub PAT | 10 | 25 | 40 |
> | `AIza…` Google API key | 13 | 58 | 39 |
> | `Bearer <token>` header | 5 | 10 | 47 / 57 |
> | JWT (`eyJ….eyJ….`) | 1 | 2 | 165 |
> | `-----BEGIN … PRIVATE KEY-----` | 1 | 3 | header only |
> | `(api_key\|secret\|token\|password) = <16+ chars>` | 215 | 772 | 32–48 |
>
> No Anthropic (`sk-ant-`), OpenAI, AWS or Slack key shapes were found. But 25
> GitHub-PAT-shaped and 58 Google-API-key-shaped tokens sit in plaintext files up
> to 131 days old, **1,512 of which the application can no longer even enumerate**
> because their owning row is gone. A retention failure on a log directory is a
> credential-exposure window, and this one has been open since April.
>
> ### 6 — nothing ever gives space back
>
> `VACUUM` appears **nowhere** in the codebase. The only three matches in 963
> `.rs` files are a guard at `db_query.rs:2596` that *rejects* `VACUUM INTO`, and
> two comments. `PRAGMA auto_vacuum` is **0** on both live databases; there is no
> `incremental_vacuum`, no `PRAGMA optimize`, no scheduled checkpoint-and-shrink.
>
> Replayed on a scratch copy — deleting the 4,941 immortal events, the 1,776
> executions past retention, and the 253,669 verdict-less join cells:
>
> | stage | file size | freelist | WAL |
> | --- | ---: | ---: | ---: |
> | start | 331.0 MB | 359 pages (1.4 MB) | 0 |
> | after the three deletes | **331.0 MB** | **44,258 pages (172.9 MB)** | 60.2 MB |
> | after `wal_checkpoint(TRUNCATE)` | **331.0 MB** | 44,258 pages | 0 |
> | after `VACUUM` (6.3 s) | **153.1 MB** | 0 | 0 |
>
> **177.9 MB — 54% of the file — is recoverable by a 6.3-second operation the app
> never performs.** Today the freelist is only 1.4 MB, which is not health: it is
> the arithmetic consequence of retention deleting nothing. Fix §1–§4 without
> adding §6 and the database does not shrink by a single byte; it just carries
> 173 MB of dead pages instead of 173 MB of dead rows.
>
> ### 7 — one missing index turns a retention sweep into a 26-second stall
>
> Deleting the 1,776 past-retention executions took **26.0 seconds**. Attribution
> by ablation on identical scratch copies:
>
> | configuration | time |
> | --- | ---: |
> | as shipped | 31,767 ms |
> | FTS delete/update triggers dropped | 30,237 ms (**5%** of cost) |
> | `PRAGMA foreign_keys = OFF` | 903 ms (**97%** of cost) |
> | both | 490 ms |
>
> Seven tables carry an FK to `persona_executions`. Six have an index on
> `execution_id`. **`team_assignment_steps.execution_id` does not** — and it holds
> an `ON DELETE SET NULL`, so SQLite must scan all 1,488 rows of a 5.67 MB table
> once per deleted parent. Adding the index (17 ms) and re-running the identical
> delete:
>
> > **26,016 ms → 1,066 ms. A 24× speedup from one index.**
>
> This is latent today only because the sweep deletes nothing. The moment §2 is
> fixed, the hourly cleanup tick acquires a ~26-second write-lock hold on a WAL
> database — during which every writer in the app blocks and every reader is
> served from a WAL that grew to 14.2 MB mid-statement.
>
> ### 8 — the rollup is idempotent in value and unstable in key
>
> `upsert_sla_daily` (`sla.rs:631`) runs on **every** hourly cleanup tick and
> re-reads the full history of `persona_executions` with no watermark. Its write,
> however, is `total = excluded.total` — an overwrite. Verified by running it
> three times and diffing the full table: **run1 ≡ run2 ≡ run3.** It is genuinely
> idempotent, and therefore *not* the corruption shape the brief warned about
> (see §12).
>
> But its **key** is `DATE(created_at, <server's current UTC offset>)`, and
> `server_offset_minutes()` (`sla.rs:603`) reads `chrono::Local::now().offset()` —
> the offset *at tick time*, not at row time. When the machine's offset changes
> (DST, travel), the same execution re-buckets under a new `day` and the old
> bucket is never deleted. There is **no DELETE on `sla_daily` anywhere**.
>
> | live `sla_daily` | value |
> | --- | --- |
> | rows | **500** |
> | buckets the current offset (+120) produces | **403** — all present |
> | buckets with no raw rows within ±1 day | **79** (15.8%) |
> | `SUM(total)` | **2,865** |
> | raw terminal executions it summarises | **2,168** |
> | **inflation** | **+697 (+32.1%)** |
>
> `load_daily_trend` (`sla.rs:692`) merges the rollup with a fresh recompute
> **max-by-total per day**, so an inflated stale bucket deterministically *wins*
> over the correct value. The dashboard's durable tail over-reports by a third.
>
> ### 9 — upstream of all of it: a tick that is silent exactly when it fails
>
> Every cleanup in `cleanup_tick` (`background.rs:2967`) logs through the same
> arm shape:
>
> ```rust
> Ok(n) if n > 0 => tracing::info!("Cleaned up {} old events …", n),
> Ok(_) => {}                                   // ← 13 of these in one function
> Err(e)  => tracing::error!(…),
> ```
>
> **13 `Ok(_) => {}` arms; 0 arms that report a zero result.** A cleanup that has
> deleted nothing for 73 days and a cleanup with nothing to delete emit byte-identical
> output: none. The only observable difference between "working" and "structurally
> incapable of ever working" is a table that grows — and **nothing in this codebase
> reads its own size.** `freelist_count`, `page_count` and `dbstat` appear zero
> times outside unrelated `kb_documents.page_count` columns.
>
> That is why all eight findings above coexisted, undetected, under a green
> `npm run check`. **Retention is expressed here as N independent "may delete"
> predicates and never once as a bound**, so every failure is a silent no-op, and
> a silent no-op is indistinguishable from success.
>
> ### Sibling boundaries, settled in prose
>
> [**Delete semantics**](./delete-semantics.md) owns *the user-initiated delete* —
> its blast radius, its receipt, its confirmation. **This path owns the delete
> nobody asked for**: the scheduled, unattended one whose defining property is
> that no human is present to notice it did nothing. Its §9 refused to gate and
> publishes zero census rules; §9 here supplies one that does not overlap it.
>
> [**Foreign-key policy**](./foreign-key-policy.md) owns the FK graph and the
> `ON DELETE` declaration. **This path owns the FK's cost at scale**: §7 above is
> the first measurement in the corpus of what a declared cascade costs when a
> child lacks its index (97% of 31.8 s), and the orphan counts below are what an
> *undeclared* one costs.
>
> [**Index design**](./index-design.md) owns which indexes to create. **This path
> supplies the missing-index case that only a bulk delete can reveal** — an index
> nothing needs for reads and everything needs for a cascade.
>
> [**Second database**](./second-database.md) owns the two-store topology and the
> cross-store reference. **This path adds the backup asymmetry** (§7 P6) and one
> confirming negative: the cross-store embedding GC works — **0 orphans**.
>
> [**Background loop**](./background-loop.md) owns the tick's scheduling. **This
> path owns what the tick does when it wakes**, and the reason its logs cannot
> tell you.
>
> [**Scheduled trigger firing**](./scheduled-trigger-firing.md) established that
> the trigger pipeline has not fired in 79 days and used `events::cleanup`'s status
> list to prove the zeroes were not a retention artifact. **That argument is
> confirmed here and strengthened**: not only does `cleanup` omit `delivered`, it
> deletes *nothing at all* today, so the event table is a complete record back to
> 2026-06-03.
>
> [**Query latency instrumentation**](./query-latency-instrumentation.md) owns
> `timed_query!`. Note that every cleanup here is already wrapped in it — and it
> did not help, because a query that deletes 0 rows in 0.2 ms is *fast*.
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "This table is getting big — how do I bound it?"
- "How long do we keep executions / events / logs / traces?"
- "Add a retention setting for X." / "Make the cleanup window configurable."
- "The database is 300 MB and I deleted a bunch of rows — why didn't it shrink?"
- "I need a nightly job that summarises yesterday and drops the raw rows."
- "Deleting this parent should clean up its children too, right?"
- "Why is the app freezing for half a minute every hour?"

If you are about to type `DELETE FROM … WHERE created_at <`, `retention_days`,
`older_than`, `cutoff`, `_RETENTION_`, `ON CONFLICT … DO UPDATE` over an
aggregate, `MAX_BACKUPS`, or to add an arm to `cleanup_tick` — you are in this
situation.

**Not this path:** *what a user-initiated delete must do* is
[delete-semantics](./delete-semantics.md); *which `ON DELETE` to declare* is
[foreign-key-policy](./foreign-key-policy.md); *how the tick is scheduled* is
[background-loop](./background-loop.md).

## 2 The one way

**Write the bound before you write the predicate, and make the predicate fail
toward deletion.** A retention rule is a statement about how large something is
allowed to get; if you cannot say the number, you are not writing retention, you
are writing a delete. So: **(a) state the bound** — days, rows, or bytes — as a
single named default in `settings_keys.rs` next to the key that overrides it, and
**never** as a per-entity floor that multiplies by entity count (§7 P2 is what
that costs). **(b) Express eligibility negatively.** Name the statuses you will
*protect* (`status NOT IN ('pending','processing')`), never the ones you will
delete: an allowlist silently grants immortality to every value added after it
was written, and that is exactly how 99.4% of `persona_events` became permanent
(§7 P1). Where the protected set is a Rust enum, do not hand-write it into SQL at
all — derive it from the enum so a new variant is a compile error, not a leak
(see *Prefer a type over a gate*). **(c) Batch every delete** — `SELECT … LIMIT
N` then `DELETE … WHERE id IN (…)` in a loop, because one statement that removes
1,776 rows holds the single WAL writer for 26 seconds and blocks the entire app
(§7 P7). **(d) Delete the row's satellites in the same breath** — the log file on
disk, the vector in the other store, the trace with no FK — because nothing else
will (§7 P5, P8). **(e) Log every outcome, including zero**, and log the table's
size next to it; a retention job that cannot say "I examined 4,972 rows and
deleted 0" is unobservable by construction and will fail silently for months.
**(f) Reclaim the space**: deletes return pages to a freelist, not to the user —
schedule a `VACUUM` behind an idle gate or the file never shrinks (§7 P9). And
**(g) default destructive sweeps to OFF** — `draft_retention_days = 0` is the one
control in this table that is correct, and it is correct because it is opt-in.

If you must pick one to get right first: **(b)**. It is the only one whose
failure is *invisible and permanent* rather than merely expensive.

## 3 Mandated primitives

| primitive | what it gives you |
| --- | --- |
| `db/src/settings_keys.rs` — `<X>_RETENTION_DAYS` + `<X>_RETENTION_DAYS_DEFAULT` | the bound, named, with a compiled-in default and a `validate_value` branch (`:899`) that rejects `"30d"` / `" 30 "` / negatives. Add the key to the `ALL` list (`:731`) and to `audit_category` (`:1205`) so a change is audited |
| `engine/background.rs` — `parse_retention_setting(pool, key, default)` (`:2944`) | reads the setting, falls back on absent **or unparseable**, and `warn!`s on corrupt values instead of silently reverting |
| `engine/background.rs` — `cleanup_tick` (`:2967`) | the one hourly home for scheduled retention. `CleanupSubscription::interval()` = 3600 s (`subscription.rs:437`) |
| `core/src/types.rs` — `ExecutionState::TERMINAL` / `::ACTIVE` (`:40`, `:47`) | the closed, exhaustively-tested terminal set. `terminal_plus_active_covers_all_variants` (`:800`) **fails the build** when a new variant is unclassified — this is the mechanism that would have caught §7 P1 |
| `db/src/journal.rs` — `prune_journal` (`:422`) | the two-window retention shape: different cutoffs for attributed vs unattributed rows, in one statement |
| `db/src/repos/resources/team_memories.rs` — `evict_excess` (`:431`) | the count-cap shape (keep N newest per scope) |
| `db/src/backup.rs` — `rotate_backups` (`:153`) + `MAX_BACKUPS` (`:28`) | count-based file rotation that deletes sidecars (`-wal`, `-shm`) with the file — the only correct on-disk retention in the tree |
| `db/src/lib.rs` — `cleanup_orphan_rows` (`:447`) | the boot-time orphan scrub. **Extend its `ORPHAN_TABLES` list** rather than writing a new sweep |
| `timed_query!` | per-query latency attribution; already wraps every cleanup here |

**Do not reach for:** `enforce_count_cap` as a model (`events.rs:625`) — it is
the count-cap shape wired to the wrong status set, and copying it propagates the
defect. Use `evict_excess` instead.

## 4 Steps

1. **Name the bound and its default** in `settings_keys.rs`, beside the key.
   Register it in `ALL` (`:731`) and `audit_category` (`:1205`).
2. **Ask whether the type can carry it.** If eligibility depends on an enum
   (status/state/phase), stop and add `TERMINAL`/`is_terminal()` to that enum
   with the coverage test from `types.rs:800` — *then* generate the SQL fragment
   from it. Do not hand-write the variant list into a string. (See *Prefer a type
   over a gate*; this is step 2, not step 9, deliberately.)
3. **Write the predicate negatively** — protect, don't enumerate. `status NOT IN
   (<in-flight>)` beats `status IN (<terminal>)` because the failure mode of the
   first is deleting slightly too much, once, loudly; the failure mode of the
   second is retaining everything, forever, silently.
4. **Batch it.** `SELECT id … LIMIT 500` → `DELETE … WHERE id IN (…)` → repeat
   until fewer than `LIMIT` came back. Bound the loop by a time budget as well as
   a batch size, and break *between* batches so a long sweep yields cleanly.
5. **Index every child's FK column** before the first bulk delete ships. Verify
   with `EXPLAIN QUERY PLAN` on a copy, and time the delete — 97% of a bad one is
   cascade scanning (§7 P7).
6. **Enumerate the satellites.** For each row you delete, list what else names its
   id: a file on disk, a row in the other database, a table with no FK, an FTS
   shadow. Delete or sweep each one in the same function, and add the table to
   `cleanup_orphan_rows`'s list if a boot-time scrub is the honest answer.
7. **Wire it into `cleanup_tick`** — one arm, calling one repo function.
8. **Log all three outcomes**, with the denominator:
   `info!(examined, deleted, table, retention_days, "retention swept")` on every
   run, not only when `deleted > 0`.
9. **Schedule the reclaim.** If the sweep can free meaningful space, add a
   `VACUUM` behind an idle gate (or `PRAGMA incremental_vacuum` with
   `auto_vacuum=INCREMENTAL` set at creation). Deletes alone never shrink the file.
10. **Then stop.** Do not write a bespoke scheduler, a second settings namespace,
    or a per-entity override — `cleanup_tick` + one settings key is the whole
    surface, and the one per-entity override that exists has never been read (§7 P3).

## 5 Anti-patterns

- **The status allowlist.** `WHERE status IN ('completed','skipped','failed','discarded')`.
  *Failure mode:* the enum grows a variant, nobody updates the string literal,
  and every row in the new state is retained forever. Not a bug you can see —
  the query succeeds, returns 0, and the tick logs nothing. **Measured cost:
  4,941 rows (99.4% of a table) permanently immortal, undetected for 73 days.**
- **Copying the allowlist into the backstop.** The count-cap that exists to catch
  the age-cleanup's failure was given the same four-status literal, so both doors
  are shut against the same 4,941 rows. *A backstop that shares the primary's
  assumption is not redundancy, it is the same failure twice.*
- **A per-entity floor as a safety net.** `min_keep_per_persona = 50` reads like
  "never leave a persona empty" and behaves like "never delete anything until
  some persona exceeds 50". *Failure mode:* the effective floor is
  `50 × entity_count` and grows with adoption. **Measured: 59/59 personas skipped,
  0 rows deleted, 1,776 past-retention rows retained.**
- **The unbatched sweep.** One `DELETE` over a retention window, on the
  assumption that "it's only a few thousand rows". *Failure mode:* SQLite has one
  writer; 26 seconds of cascade scanning freezes every write in the app and
  inflates the WAL mid-statement, while a UI query reads through it.
- **Shipping a setting before its reader.** A dial in the UI, validated,
  audited, persisted — and no consumer. *Failure mode:* the user believes they
  configured retention. Worse than no control, because it suppresses the support
  question that would have found the bug.
- **Logging only success.** `Ok(n) if n > 0 => info!(…), Ok(_) => {}`. *Failure
  mode:* the observable signature of a structurally-broken cleanup is identical
  to a healthy idle one. This is the meta-anti-pattern: it is what allowed every
  other item in this list to survive.
- **Deleting the row and leaving its file.** *Failure mode:* 1,512 orphan logs,
  163 MB, with GitHub PATs in them, that the app can no longer enumerate.
- **Assuming a declared cascade cleans up.** `ON DELETE CASCADE` fires only if
  the connection has `foreign_keys = ON` *and* the parent is actually deleted.
  Tables with **no** FK (`execution_traces`) are never cleaned by anything.
  **Measured: 880 orphaned traces (29.9%) and 980 orphaned tool-usage rows
  (17.1%) on the live database.**
- **A rollup keyed on a locally-derived value.** `DATE(created_at, <offset now>)`
  is not a stable key. *Failure mode:* every DST transition mints a parallel
  generation of buckets that nothing deletes. **Measured: 79 stale buckets, total
  inflated 32%, and the merge picks the inflated one.**
- **Treating `VACUUM` as optional because the freelist is small.** The freelist is
  small *because* retention is broken. Fixing retention without scheduling a
  reclaim converts 173 MB of dead rows into 173 MB of dead pages.

## 6 Evidence

**The ONE site to copy: `db/src/journal.rs:422` `prune_journal`.**

```rust
"DELETE FROM change_journal
 WHERE (execution_id IS NOT NULL AND created_at < datetime('now', ?1))
    OR (execution_id IS NULL     AND created_at < datetime('now', ?2))"
```

It is the only retention statement in the tree that (a) is driven purely by a
time cutoff so no status can escape it, (b) encodes two different policies for
two row classes without an enum literal, (c) uses named `RETENTION_DAYS_*`
constants rather than magic numbers, and (d) logs its result. It is not batched —
that is its one gap, and `change_journal` is small enough today that it has not
bitten.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `core/src/types.rs:40-60` + tests `:800-834` | `TERMINAL`/`ACTIVE` consts with a **coverage test that fails when a variant is unclassified**, and an exact-set test that names the TS constant to update in the same breath. This is the mechanism §7 P1 lacked |
| `db/src/backup.rs:148-196` `rotate_backups` | count-based rotation that deletes `-wal`/`-shm` sidecars alongside the file, sorts lexicographically *because the name embeds the timestamp*, and treats every failure as non-fatal ("rotation debt is disk usage, never a boot blocker") |
| `db/src/repos/resources/team_memories.rs:431` `evict_excess` | the correct count-cap: keep N newest **per scope**, computed over the eligible set |
| `db/src/repos/core/personas.rs:1885` `sweep_stale_drafts` | destructive sweep **defaulting to disabled** (`retention_days <= 0` returns 0 at `:1886`), routing every candidate through the same `delete_draft_if_safe` guard the interactive path uses. Convergent with brainiac and ascent (see *Convergence*) |
| `db/src/repos/core/memories.rs:1978` `spawn_gc_archived_memory_embeddings` | the cross-store sweep that **works**: 0 orphaned embeddings across 5,158 vectors in the second database, verified by an `ATTACH`ed join |
| `executions_fts_ad` trigger (live schema) | satellite cleanup done right — an external-content FTS index kept exactly in step through insert/update/delete triggers. **2,188 rows, 2,188 FTS entries**, and it costs only 5% of a bulk delete |
| `engine/background.rs:2944` `parse_retention_setting` | the settings read that warns on corruption instead of silently defaulting |

## 7 Deviations

Every entry is live on `master` @ `2a874e692` and measured against the operator's
running database.

### P0 — `events::cleanup` and `enforce_count_cap` cannot reach 99.4% of their table

`db/src/repos/communication/events.rs:595` and `:622`,`:625`.
Both name `('completed','skipped','failed','discarded')`; `PersonaEventStatus`
also has `Delivered` (terminal, production-written) and `Completed` (terminal,
test-written). Live: 4,941 `delivered` / 0 `completed`. `cleanup(30)` → **0 rows**;
`enforce_count_cap(0)` → **31 rows, 4,941 survive**.

**Fix**, in order:
1. Add `is_terminal()` / `TERMINAL` to `PersonaEventStatus`
   (`core/src/models/event.rs:35`), mirroring `types.rs:40-60`, plus the
   `terminal_plus_active_covers_all_variants` coverage test from `types.rs:800`.
   `DeadLetter` is deliberately **not** terminal-for-retention (it is the DLQ);
   encode that as its own `is_retention_eligible()` so the distinction is in the
   type, not in a comment.
2. Generate the SQL fragment from it; delete both literals.
3. One-time backfill: the 4,941 rows are 50–73 days old and will be removed by
   the first corrected tick — but see P7 first, or that tick will stall.

### P1 — `cleanup_old_executions` deletes 0 rows because its floor outgrew its table

`db/src/repos/execution/executions.rs:1827`, called at `background.rs:3063` with
`min_keep_per_persona = 50`. 59/59 personas skip at `:1877`. 1,776 rows past a
60-day window retained.

**Fix:** make the floor global, not per-entity — or bound it
(`min(50, total_rows / persona_count)`), or drop it in favour of the retention
window alone. Whatever the choice, add a test asserting the sweep deletes >0 on a
fixture where rows exist past the cutoff **and** every entity is under the floor;
that is the case with no coverage today.

### P2 — `execution_retention_months:<persona_id>` has a UI and no reader

`settings_keys.rs:111`; written by `PersonaSettingsTab.tsx:73`, read by `:65`;
validated at `:1175`; audited at `:1176`. Zero Rust consumers.
**Fix:** either thread a per-persona override into `cleanup_old_executions`, or
remove the key and the UI control. Shipping neither is the current state.

### P3 — `workspace_practice_context_state`: 111 MB, 33.7% of the file, 0.03% informative

`db/src/repos/dev_workspaces.rs:2377` seeds 1,164 × 218 = 253,752 cells; only 83
ever acquire a verdict. No age, count or size bound exists.
**Fix:** stop materialising `unverified`/`na`. Both are computable — `na` from
`envelope_context_state()` (`dev_workspaces.rs:2340`) at read time, `unverified`
as the absence of a row. Persist only `adopted`/`violating`, i.e. the 83 rows
that carry evidence. Reclaims ~111 MB and removes three indexes
(`sqlite_autoindex` 24.96 MB + `idx_wpcs_project` 23.86 MB + `idx_wpcs_practice`
15.50 MB) whose only job is to make the absence of information queryable.

### P4 — `execution_traces` has no DELETE, no FK, and 880 orphans

31.48 MB, 2,942 rows, of which 28.15 MB is the `spans` column. `pragma
foreign_key_list(execution_traces)` returns `[]`; there is no `DELETE FROM
execution_traces` anywhere in 963 files. **880 rows (29.9%)** already reference a
`persona_executions.id` that no longer exists.
Likewise **`persona_tool_usage`: 980 orphans (17.1%)** — despite a declared
`ON DELETE CASCADE`, because the parents were removed on a connection or path
where the cascade did not run.
**Fix:** add `execution_traces` (and the trace-adjacent tables) to
`cleanup_orphan_rows`'s `ORPHAN_TABLES` (`db/src/lib.rs:449`) keyed on
`execution_id`, and give `execution_traces` an FK so future deletes cascade.

### P5 — 1,512 orphan log files (163 MB) and 595 dangling `log_file_path`s

`logging.rs:194` deliberately preserves UUID logs; nothing else owns them.
Credential shapes present (counts in the headline). Oldest 2026-04-06.
**Fix:** delete `log_file_path`'s file inside the execution-retention sweep
(same function, same batch), and add a boot-time reconciliation both ways —
file with no row → delete; row with no file → null the column so the UI stops
offering a broken link.

### P6 — backups: 993 MB of one database, zero of the other, horizon ≈ 3 boots

`backup::backup_before_migrations` is called once (`db/src/lib.rs:296`), for
`personas.db` only. `init_user_db` (`:495`) never calls it. Live `backups/`:
three sets, **331 MB each (996 MB)**, all created **today** (14:11, 17:41,
18:33). `MAX_BACKUPS = 3` (`backup.rs:28`) is a count, and the backup fires on
**every boot** — so three boots in one afternoon evicted every older snapshot.
`personas_data.db` (16.7 MB — the vector KB and the entire companion brain) has
**no backups at all**.
**Fix:** (a) back up the user database too; (b) make the horizon time-based, or
skip the copy when the schema version is unchanged, so the safety net survives
longer than an afternoon; (c) two stray 73 MB `personas-cleanbak-*.db` files from
June sit in the data root, outside `backups/`, and are matched by no rotation
rule — delete or adopt them.

### P7 — `team_assignment_steps.execution_id` is unindexed under `ON DELETE SET NULL`

The retention delete costs **26.0 s**; with the index, **1.07 s** (24×). 97% of
the unfixed cost is cascade scanning.
**Fix — one line, in a new `incremental.rs` step:**
```sql
CREATE INDEX IF NOT EXISTS idx_tas_execution ON team_assignment_steps(execution_id);
```
Land this **before** P0/P1, or fixing them converts a silent no-op into a
26-second app-wide write stall every hour.

### P8 — `sla_daily` accumulates a bucket generation per UTC offset

`sla.rs:637` keys on `DATE(created_at, ?1)` where `?1` comes from
`server_offset_minutes()` (`:603`) evaluated at tick time. No DELETE exists on
`sla_daily`. Live: 500 rows, 403 current, **79 stale**, `SUM(total)` **+32.1%**
over the raw truth; `load_daily_trend` (`:692`) merges max-by-total and so
prefers the inflated bucket.
**Fix:** key on UTC (`DATE(created_at)`) and apply the display offset at read
time only — the read path already accepts an explicit offset. Then delete the
buckets that no offset regime can reproduce.

### P9 — nothing ever runs `VACUUM`

Zero occurrences in 963 files; `auto_vacuum = 0` on both databases. 177.9 MB
(54%) is reclaimable in 6.3 s once P0/P1/P3 land.
**Fix:** an idle-gated `VACUUM` (the `ipc_gauge` at `core/src/ipc_gauge.rs:4`
already exists to identify *"a quiet moment for maintenance work (checkpointing,
vacuum)"* — it names this job and nothing calls it for this purpose). Guard on
`freelist_count * page_size > threshold` so it is a no-op when there is nothing
to reclaim.

### P10 — every cleanup is silent when it does nothing

13 `Ok(_) => {}` arms in `cleanup_tick`; 0 arms that report a zero outcome.
**Fix:** log `examined` and `deleted` on every run. This is the cheapest item in
the list and it is the one that would have surfaced P0, P1, P3, P4 and P8.

### P11 — one unreachable cleanup command

`companion_prune_low_value_facts` (`src/commands/companion/consolidate.rs:237`)
carries `#[tauri::command]`, is **absent from `generate_handler!`**, and is
referenced by no TS file. It cannot be invoked.
*(Method note: a naive "no Rust caller" scan flagged 11 functions; 7 were Tauri
commands reached over IPC, 1 an axum route registered by string
(`dev_tools_http.rs:88`), and 2 were test functions in `dev_tools_backlog_tests.rs`
— a file with **no `#[cfg(test)]` attribute anywhere in it**, so brace-matched
range exclusion cannot see it and only a filename rule can. **1 of 11 survived
verification.** That 91% false-positive rate is why this deviation is one line
and not a table.)*

## 8 Gaps — what the primitives genuinely cannot do

1. **No type can reach inside a SQL string literal.** `PersonaEventStatus` is an
   exhaustive Rust enum with a compiler-checked `match` in `as_str` — and the
   retention predicate is `"… status IN ('completed', …)"`, a sequence of
   characters. Adding `Delivered` compiled cleanly everywhere. The gap is real
   and general; the only closure is to *generate* the fragment (see below), which
   is a discipline, not a guarantee.
2. **SQLite has one writer.** No amount of batching makes a retention sweep
   concurrent with the app's writes; batching only bounds how long each block
   lasts. There is no `DELETE … LIMIT` in stock SQLite either (it needs
   `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`), which is why step 4 prescribes
   select-then-delete-by-id rather than a one-liner.
3. **`VACUUM` cannot run inside a transaction, needs up to 2× the file size in
   free disk, and takes a full-database lock** — 6.3 s here, and it will grow.
   `auto_vacuum` cannot be enabled on an existing database without a full
   `VACUUM` anyway, so the incremental option is not available retroactively.
4. **An FK cannot cross a database file**, so `personas_data.db`'s vectors can
   never be cascaded from `personas.db`. `spawn_gc_archived_memory_embeddings` is
   a compensating sweep, and it is the pattern — but it must be written by hand
   for every cross-store edge. See [second-database](./second-database.md).
5. **`PRAGMA foreign_keys` is per-connection**, so a declared `ON DELETE CASCADE`
   is only as reliable as every path that opens a connection. The 980 orphaned
   `persona_tool_usage` rows are the residue of that, and no `foreign_key_check`
   will report them as violations *after* the fact.
6. **`cleanup_orphan_rows` only understands `persona_id`.** Its DELETE is
   formatted as `WHERE persona_id NOT IN (SELECT id FROM personas)`
   (`db/src/lib.rs:451`), so a child keyed on `execution_id` cannot be added
   without generalising the helper to take (column, parent table) pairs.
7. **The census cannot join two files.** The property that makes
   `executions.rs:1882`'s allowlist safe and `events.rs:595`'s unsafe is a
   `CHECK(status IN …)` constraint in a migration — a different file from the
   DELETE. No regex-based gate can see that relationship, which is why §9 gates
   the *shape* and this document supplies the audit.
8. **Nothing measures the app's own footprint.** There is no primitive for "how
   big is this table / this database / this log directory", so a bound cannot be
   asserted even where it is known. `LogDirectoryStats` (`logging.rs:378`) is the
   only size-reporting struct in the tree and it covers only the log directories.

## Prefer a type over a gate

Held against all seven qualifications.

**The type exists. It has a coverage test. It reaches zero SQL strings.**

`ExecutionState::TERMINAL` (`core/src/types.rs:40`) is exactly the primitive this
leaf needs: a `const &'static [ExecutionState]`, guarded by
`terminal_plus_active_covers_all_variants` (`:800`) which fails the build when a
new variant is neither TERMINAL nor ACTIVE, by `terminal_and_active_are_disjoint`
(`:811`), and by `terminal_set_matches_expected` (`:824`) which names the TS
constant to update in the same commit. It is the strongest small piece of design
in this territory.

Its production call sites: **zero.** All five references to
`ExecutionState::TERMINAL` and `::ACTIVE` in 963 files are inside its own
`#[cfg(test)]` module. Meanwhile the terminal set is hand-copied into SQL string
literals — **106 production `status IN (…)` literals across the tree, in 57
distinct spellings**, of which the execution terminal set alone wears three:
`('completed','failed','incomplete','cancelled')` (9×),
`('completed','failed','cancelled')` (5×), `('completed','failed')` (7×). The
const that would settle which is right is test-only.

Now the qualifications:

1. **A required prop carries only what it actually encodes.** ✔ `TERMINAL` encodes
   exactly "no further transitions". It does *not* encode "safe to delete" —
   `DeadLetter` is terminal and must never be swept. So the retention type is
   **not** `is_terminal()`; it is a second, narrower `is_retention_eligible()`.
   Conflating them would have the type carry a claim it cannot support.
2. **Requiredness is orthogonal to closedness.** ✔ The decisive difference between
   the safe allowlist and the rotten one is not that anyone was *required* to
   write it — both were hand-written. It is that `persona_executions.status`
   carries `CHECK(status IN ('queued','running','completed','failed','incomplete','cancelled'))`
   in the schema, a **closed** domain, while `persona_events.status` has **no
   CHECK constraint at all** — verified against the live `sqlite_master`. The
   open domain is the one that rotted. Closedness did the work; requiredness did
   none.
3. **A type nobody constructs constrains nothing.** ✔ This is the finding.
   `TERMINAL` is constructed by nobody outside its tests, so it constrains
   nothing — and the one enum with no such const (`PersonaEventStatus`) is
   precisely the one that failed. The const's existence has been *inert*.
4. **A type anyone can construct authenticates nothing.** ✔ Any `&str` can be a
   status in a SQL literal; the string `'delivered'` and the string `'delvered'`
   are equally valid to the compiler and equally invisible to `foreign_key_check`.
5. **Withholding beats requiring.** ✔ — and this is where the answer lands.
   Requiring a retention function to take a status list changes nothing, because
   callers supply it happily and wrongly.
6. **Withhold the *dangerous freedom*, not the answer.** ✔ The dangerous freedom
   is **writing a status set as text**. Withhold *that*: make the retention
   predicate un-hand-writable by having the repo layer accept a
   `RetentionScope` that owns the fragment —
   ```rust
   pub struct RetentionScope { sql: String }          // no public field, no From<&str>
   impl RetentionScope {
       pub fn eligible<S: RetentionStatus>() -> Self { /* derives from S::RETENTION_ELIGIBLE */ }
       pub fn all_rows() -> Self { Self { sql: "1=1".into() } }
   }
   ```
   with `cleanup(pool, days, scope: RetentionScope)`. There is no constructor
   that takes a string, so the only way to obtain one is through the enum, and
   adding a variant fails `S`'s coverage test.
7. **(2026-08-15.) Withholding a requirement only helps when the requirement was
   forcing the bad value; where the caller supplies it voluntarily, withhold the
   *construction*.** ✔ Exactly this case. Nobody forced `events::cleanup` to
   filter by status — it has no status parameter at all; the list is welded into
   a `prepare_cached` literal inside the function body. Relaxing any signature is
   inert. **The construction is what must be withheld**, which is why the
   proposal above removes the string constructor rather than adding a parameter.

**Does the type reach the code?** Honestly: **partially, and only if the
statement is assembled rather than written.** `prepare_cached` takes `&str`, so
`RetentionScope` can interpolate its fragment — but nothing stops the next author
from typing the literal directly, and no type can stop them. **The gate in §9 is
therefore not a fallback; it is the half of the answer the type cannot supply**,
and it keys on precisely the residue: a hand-written status list inside a
retention predicate. Type for new code, census for the literal.

Cost of the type change: `PersonaEventStatus` gains ~20 lines and two tests;
`RetentionScope` is ~30 lines in `db/src/repos/utils.rs`; three call sites change.
It removes P0 permanently and makes P0's recurrence a compile error.

## Convergence

Checked against `../personas-web`, `../brainiac`, `../personas-cloud`,
`../vibeman`, `../ascent`. **All five exist**; nothing is reported by omission.

| # | clause | vibeman | brainiac | personas-web | personas-cloud | ascent | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | any retention concept | 23 entry points, **12 dead** | 5-kind sweep framework | ring-buffer trim only; DB **silence** | **SILENCE** | daily hardened cron purge | **physics** (4/5) |
| 2 | cutoffs configurable | 1 env var, ~30 hardcoded | env + **per-sweep DB cadence** | hardcoded | **SILENCE** | **per-org DB columns** | diverged |
| 3 | batched deletes | **1 of 18** | unbounded (soft-expire) | n/a | **SILENCE** | **all**, batch 500 + time budget | **rare** (1/5) |
| 4 | rollup watermark | none — **and accumulating** | none — append-only (safe) | n/a | no rollup | no rollup | reframed ↓ |
| 5 | **VACUUM** | **no trace** | **no trace** | **no trace** | **no trace** | **no trace** | **SILENCE 5/5** |
| 6 | backup rotation | **no backup writer at all** | `RETENTION_DAYS=14`, `find -mtime -delete` | **SILENCE** | **SILENCE** | **SILENCE** | **SILENCE 4/5** |
| 7 | log-file retention | **no trace** — 1 log/run forever | **no trace** | **SILENCE** | **SILENCE** | **no trace** | **SILENCE 5/5** |
| 8 | destructive sweep defaults OFF | n/a | seeded **disabled** (`0024_raw_ttl_sweep.sql:17`) | n/a | n/a | **`0` = disabled** (`retention.ts:71`) | **physics** (3/3) |

**Physics — independently reinvented, keep as doctrine:**

- **§2(g) destructive sweeps default to off.** brainiac seeds its `raw_ttl` sweep
  disabled with a migration comment that *"a janitor that turns itself on… would
  be deleting-adjacent behaviour"*; ascent defaults both retention knobs to `0 =
  disabled` and documents retention as opt-in; personas' `sweep_stale_drafts`
  returns 0 when `retention_days <= 0` with the same reasoning in its doc comment.
  **Three codebases, three stacks, no shared document.**
- **§2(c) batching**, on the strength of ascent's design rather than a count:
  batch size 500 clamped to 5000, a time budget checked *between* batches so a
  long sweep yields cleanly rather than being killed mid-delete
  (`retention.ts:95-117`). vibeman independently built the same
  `SELECT … LIMIT 500 → DELETE … WHERE id IN (…)` loop
  (`behavioral-signal.repository.ts:357`) — and then failed to apply it to its
  own highest-volume table, which is itself the evidence that the pattern is
  correct and the discipline is what's missing.
- **§2(e) "defining a policy is not enforcing one."** vibeman's strongest
  negative result: **234,957 of 235,366 `obs_xray_events` rows (99.8%) are older
  than its declared 7-day policy**, because `cleanupOlderThan` is reachable only
  from a manual `DELETE /api/xray` endpoint. A 7-day policy over 99.8%
  out-of-policy data is the same failure as personas' two settings that delete
  zero — *different mechanism, identical signature*. Two repos, independently.

**Silence — report as silence, do not dress as consensus:**

- **`VACUUM`: 5 of 5, no trace.** This is a universal blind spot, not
  independent confirmation, so §2(f) and P9 are **not** convergence-validated —
  they rest on the local measurement (177.9 MB, 6.3 s) alone. The sharpest
  version of the shared blindness is vibeman, which **reads `freelist_count` in
  two places** (`storage-analytics/route.ts:79`, `misc_cmds.rs:67`) and has no
  mechanism to act on it: it measures bloat it cannot reclaim. Personas does not
  even measure it.
- **Log-file retention: 5 of 5, no trace.** vibeman mints one timestamped `.log`
  per execution with no cap — the same design as personas' 2,991 UUID logs.
  Personas is not an outlier here; the whole family is.
- **Backup rotation: 4 of 5 silence.** brainiac's `backup.sh:90`
  (`find -mtime +$RETENTION_DAYS -delete`, `0 = keep all`) is the only
  counterexample — and it is **time-based**, which is exactly the fix P6 needs.
  **Personas is ahead of four siblings here**: `rotate_backups` exists and works.
  Its defect is the *count-based* horizon, and the one repo that solved it chose
  time.

**The clause the oracle overturned — and the local refinement.**

The brief primed me with vibeman's *"watermark-less rollup reading 80,817,237 API-call rows for a localhost app"*, and asked whether this repo has that shape. It does not, and the primed framing is wrong in a way that matters:

- **80,817,237 is the rollup's *output*, not its input.** `SELECT SUM(call_count)
  FROM obs_endpoint_stats` reproduces it exactly (3,733 rows). The source table
  `obs_api_calls` holds **342 rows**, pruned to 24 h by the same cycle.
- **The real defect is `SET call_count = call_count + ?`**
  (`observability.repository.ts:144`) — an *accumulating* upsert fed by a
  re-scanning source, so every raw row is counted once per 5-minute cycle for its
  entire 24-hour life: **up to 288×**. The corroboration is in the data: one
  endpoint shows 872,949 calls in a single hour (242 req/s on a localhost dev
  server) and another shows `call_count == error_count` exactly.

So the correct rule is **not** "a rollup needs a watermark". It is:

> **A rollup needs a watermark if and only if its write is not idempotent — and
> idempotency requires a stable key, not merely an overwriting write.**

The second clause is this repo's contribution, and it is a shape neither sibling
exhibits. `upsert_sla_daily` **overwrites** (`total = excluded.total`), and I
verified true idempotency by running it three times and diffing the whole table:
`run1 ≡ run2 ≡ run3`. By vibeman's rule it is safe. It is nonetheless **inflated
by 32%**, because its *key* — `DATE(created_at, <offset at tick time>)` — is not
stable across DST. Value-idempotence with key-instability produces the same
inflated totals as vibeman's value-accumulation, by a different route, and a
watermark would not have prevented either.

Its remaining cost is waste rather than corruption, and it is worth stating
plainly: 400 day-buckets, immutable since 2026-06-26, are rewritten every hour —
**~9,600 pointless row-writes per day, ~480,000 since the last execution ran** —
each stamping a fresh `updated_at` into the WAL. That is a cost argument for a
watermark, not a correctness one.

**One more sibling negative worth carrying:** ascent has **zero database foreign
keys** (`relationMode = "prisma"`, forced by Aurora DSQL), so its cleanup cannot
lean on cascade and deletes children explicitly in dependency order
(`retention.ts:164-168`). It is the only cleanup in the six-repo sample that is
correct. vibeman is the mirror image: a cross-database cascade trigger that
**cannot fire in production** because its two tables live in different SQLite
files, with a passing unit test that puts both in one in-memory database. *A test
that proves a cascade works in a topology production does not have* is the
sharpest single artifact the oracle returned, and it is the reason §5 lists
"assuming a declared cascade cleans up" as an anti-pattern rather than trusting
`ON DELETE CASCADE` — personas' own 980 orphaned `persona_tool_usage` rows sit
under a declared cascade.

## 9 The missing gate

**The condition, stack-free:** *a scheduled retention predicate whose row
eligibility is a hand-written enumeration of the states it may delete, rather
than of the states it must protect.* Such a predicate grants permanent
immortality to every state added after it was written, and fails silently — the
statement succeeds and returns 0.

**The proxy, for this stack:** a `DELETE` whose SQL text reaches both a
`(status|state|phase|lifecycle) IN (…)` membership test **and** a time-column
`<` comparison. The time comparison is what makes it *retention* rather than a
scoped delete; the positive membership test is the defect.

### Existing rules checked first

I read `scripts/census/rules.json` (90 rules) and `lib/engine.mjs` before
authoring, and checked these by name:

- **`blind-identity-write`** (`repository-crud-surface.md`, 35 files / 82 matches,
  `roots: ["src-tauri/db/src/repos"]`) — the nearest neighbour and the one real
  overlap risk. **It cannot collide by construction:** it requires the predicate
  to end `WHERE id = ?N`, a single-row primary-key write, and its own description
  records that scope-keyed bulk deletes are *deliberately excluded* by that
  requirement. A retention predicate (`WHERE created_at < ?1`) can never match it.
  Measured file overlap with my rule: `events.rs` and `executions.rs` appear in
  both rules' file sets, but **zero matches coincide** — the two key on disjoint
  predicate shapes in the same files, which is exactly why a file-level signal
  would be wrong here.
- **`optional-store-handle`** (`second-database.md`, 5/17) — about pool-handle
  optionality in signatures; no DELETE, no SQL. No overlap.
- **`unatomic-sequence-rewrite`** (`drag-reorder.md`, 1/3) — structurally the
  closest template (a `for` loop issuing `conn.execute` instead of `tx.execute`),
  but its verb is `UPDATE … SET <ordering column>`. No overlap. I considered
  reusing its shape for "a retention loop issuing N deletes on a pooled `conn`"
  and **rejected it**: `cleanup_old_executions` is the only such loop, giving a
  1-match rule that would fire on the very site P1 tells you to rewrite.
- **`undeclared-parent-fate`** / **`constraintless-table-declaration`** — the two
  partitioning positive controls in the corpus; used as the structural model
  below, not overlapped (they key on `REFERENCES` and `CREATE TABLE`).
- **`untimed-repo-query`**, **`silent-row-skip`**, **`unverifiable-conflict-clause`**
  — all match inside `db/src/repos`, none keys on `DELETE` or on a time cutoff.

**Zero of the 90 existing rules mention** `VACUUM`, retention, cleanup, prune,
purge, cutoff, rollup or watermark. Only three mention `DELETE` at all. The
territory is open.

### The rule

```json
{
  "id": "retention-delete-by-status-allowlist",
  "goldenPath": "docs/concepts/golden-paths/retention-and-pruning.md",
  "title": "A retention DELETE whose row eligibility is a hand-written positive status list — it silently retains every status the literal does not name.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "DELETE\\s+FROM\\s+[A-Za-z_][A-Za-z0-9_]*(?:(?!DELETE\\s+FROM)[^;\"])*?\\b(?:status|state|phase|lifecycle)\\s+IN\\s*\\((?:(?!DELETE\\s+FROM)[^;\"])*?\\b(?:created_at|updated_at|last_seen_at|verified_at|processed_at|started_at|finished_at|completed_at|expires_at|last_used_at|timestamp|occurred_at|fired_at|exited_at)\\s*<",
    "flags": "gi",
    "ignoreCommentLines": true,
    "description": "PROXY FOR the stack-free condition: a scheduled retention predicate that enumerates the states it MAY delete instead of the states it MUST protect. An allowlist grants permanent immortality to every state added to the enum after the literal was written, and fails SILENTLY - the statement succeeds and returns 0, and the caller logs only when n>0. MEASURED 2026-08-15 at 2a874e692: 3 files / 3 matches, all three hand-read. events.rs:594 is a PROVEN production failure - its list omits PersonaEventStatus::Delivered (the terminal success state production writes, core/src/models/event.rs:21) while including Completed (documented at :23 as used by mocks/tests), so 4941 of 4972 live rows (99.4%) aged 50-73 days are unreachable by a 30-day policy; replayed verbatim against the operator's database the statement deletes 0 rows. executions.rs:1882 and companion/jobs/mod.rs:199 carry the same shape with lists that are complete TODAY; they are reported because completeness is unverifiable at the DELETE and is not enforced anywhere - the only reason executions.rs is safe is a CHECK(status IN (...)) constraint in a DIFFERENT FILE (migrations), which no regex can join to. PRECISION ANCHOR: requiring a time-column '<' comparison in the same statement is what makes this retention rather than a scoped delete - without it the anchor admits 307 matches across 101 files, nearly all legitimate entity-scoped deletes; with it, 13. The second anchor, the status membership test, splits those 13 into 3 violating and 10 compliant. Median matched span 135 chars, max 177, against an implicit bound of one SQL string literal ([^;\"] forbids crossing a statement or a string boundary). CONTAMINATION: zero of the 3 matches sit inside a #[cfg(test)] module, verified by an independent brace-matched range scanner - the census engine cannot express that exclusion, so the anchors were chosen to avoid needing it (test modules in this repo build fixtures with INSERT, not with time-bounded DELETE). POSITIVE CONTROL: retention-delete-by-status-allowlist-positive-control, the identical head with the membership test forbidden in the fill, matches 10 files / 10 matches with ZERO match overlap by construction; 3 + 10 = 13 accounts for the time-bounded anchor exactly, and the shape anchors reject 294 of the 307 raw DELETE tokens. LEGAL FIX, in order: (1) give the status enum a TERMINAL const plus the coverage test at core/src/types.rs:800, which fails the build when a new variant is unclassified; (2) derive the SQL fragment from it instead of typing the list; (3) where no enum exists, invert the predicate to 'status NOT IN (<in-flight states>)' so a new state is swept by default rather than retained forever. Do NOT silence a match by splitting the statement across two Rust string literals or by moving the list into a const &str - both preserve the defect exactly and merely hide it from this signal; the honest fix always removes the hand-written list. END OF LIFE: this rule is designed to reach zero. When it does the runner fails structurally on zero-matches, BY DESIGN - DELETE the rule then, do not baseline it at 0. CONVERGENCE: no sibling repo (personas-web, brainiac, personas-cloud, vibeman, ascent) gates this; vibeman exhibits the same family of failure by a different mechanism - a 7-day retention policy whose only caller is a manual HTTP endpoint, leaving 234957 of 235366 rows (99.8%) out of policy.",
    "$measured": "2026-08-15 @ 2a874e692 — 963 .rs files walked; two independent implementations (a standalone Node scanner and the census engine) returned 3/3 identically."
  },
  "baseline": { "files": 3, "matches": 3 },
  "floor": 900
}
```

### The positive control (evidence, NOT a gate — carries no baseline)

```json
{
  "id": "retention-delete-by-status-allowlist-positive-control",
  "goldenPath": "docs/concepts/golden-paths/retention-and-pruning.md",
  "title": "POSITIVE CONTROL — not a gate. The compliant form of retention-delete-by-status-allowlist, which the rule must NOT report.",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "DELETE\\s+FROM\\s+[A-Za-z_][A-Za-z0-9_]*(?:(?!DELETE\\s+FROM|(?:status|state|phase|lifecycle)\\s+IN\\s*\\()[^;\"])*?\\b(?:created_at|updated_at|last_seen_at|verified_at|processed_at|started_at|finished_at|completed_at|expires_at|last_used_at|timestamp|occurred_at|fired_at|exited_at)\\s*<",
    "flags": "gi",
    "ignoreCommentLines": true,
    "description": "NOT A GATE - the shape-discrimination control for retention-delete-by-status-allowlist. IDENTICAL head (DELETE FROM <table> ... <time column> <), compliant tail: the fill from the table name to the time comparison is TEMPERED so it cannot cross a status/state/phase/lifecycle membership test. The two patterns are therefore mutually exclusive BY CONSTRUCTION, not merely empirically. MEASURED 2026-08-15 at 2a874e692: 10 files / 10 matches versus the rule's 3 / 3. PARTITION: 3 + 10 = 13, which is EXACTLY the count of the shared time-bounded anchor (a DELETE reaching a time-column '<' with no constraint on how eligibility is expressed), so there is no third population - every time-bounded delete in the tree is classified. Overlap by match: 0. Overlap by file: 0. Against the bare token anchor (DELETE FROM <table>, 101 files / 307 matches) the shape anchors reject 294 of 307, i.e. 95.8% of raw DELETE tokens are entity-scoped deletes that are not retention at all. The 10 compliant sites are: journal.rs:425 (two time windows, no status gate), messages.rs:519 and mdns.rs:470 (gated on a BOOLEAN - is_read = 1, is_connected = 0 - a closed two-valued domain that cannot acquire a third member, which is the precise property the enum case lacks), circuit_breaker.rs:68, audit_log.rs:221, exposure.rs:77, oauth_token_metrics.rs:202, triggers.rs:2099, turn_ledger.rs:387, project_tracking/events.rs:86 (time cutoff alone decides). Its purpose is to demonstrate the rule keys on the PRESENCE of an open-enum membership test and not on the words DELETE or created_at, both of which the compliant population also carries. A NOTE ON THE ABSENT THIRD FORM: a predicate expressed negatively (status NOT IN (...)) - the form section 2 prescribes - matches ZERO times in this repo today, which is why it could not be used as the control; when the fix lands, the control's pattern must be re-derived to include it. Deliberately carries no baseline; the registry merge skips ids containing 'positive-control'.",
    "$measured": "2026-08-15 @ 2a874e692 — validated standalone in a scratch registry, then re-extracted from this document and re-run; 10/10 both times."
  },
  "floor": 900
}
```

### Verification of this gate's own preconditions

- `floor: 900` against **963** files actually walked. A typo'd root walks 0 files
  silently and trips both `floor` and the zero-match structural failure.
- **The rule must reach zero and then be deleted**, not baselined at 0 — the
  census cannot express "must be zero", and a rule pinned at 0 is a gate that can
  never fail. P0's fix removes one match; P1 and P11's fixes remove the other two.
- **Re-extraction check performed.** Both blocks above were pasted back out of
  this document into a scratch registry and re-run: `3 / 3`, `10 / 10`,
  token-anchor `101 / 307` — identical to the standalone run.
- Do **not** run `npm run census -- --update` against a registry containing the
  positive control; `updateBaselines` dereferences `baseline.files`
  unconditionally and throws.

### Gates I rejected, with numbers

Refusing to gate is first-class, so here are the four candidates I measured and
declined:

| candidate | violating | compliant | why rejected |
| --- | ---: | ---: | --- |
| **unbounded `DELETE` with no `LIMIT`/batch** | 13 | **0** | *Every* retention delete in the repo is unbounded. A gate that fires on 100% of the population and has no compliant form to point at is a to-do list, not a ratchet — and its positive control would match zero, which fails the runner structurally. Prescribed in §2(c), enforced by review. |
| **rollup with no watermark** | 1 (`sla.rs:637`) | 0 | One match. A single-match rule is one refactor away from a structural zero-match failure, and per the oracle's reframing the watermark is not even the correctness property — idempotency is, and that is not regex-expressible. Carried as P8 instead. |
| **`VACUUM` never called** | n/a | n/a | The census counts occurrences of a pattern; it **cannot assert the absence** of a call across a repo. The condition "no scheduled VACUUM exists" has no signal. Carried as P9. |
| **cleanup arm that logs only on `n > 0`** | 44 tree-wide | — | The pattern `Ok(n) if n > 0` is idiomatic and correct almost everywhere it appears (44 sites); it is only a defect inside a *retention* function, and no regex separates those two populations without a function-name heuristic that would have collapsed on the 91% false-positive rate documented in P11. Carried as P10. |

The third row is the most important and worth stating plainly as a limit of this
mechanism: **the census can ratchet a condition that is present, and can say
nothing at all about one that is absent.** Every one of this document's largest
findings — no VACUUM, no retention on a 111 MB table, no DELETE on
`execution_traces`, no backup of the second database, no reader for a shipped
setting — is an **absence**, and none of them is gateable by counting. They are
findable only by measuring the running system, which is how they were found.
