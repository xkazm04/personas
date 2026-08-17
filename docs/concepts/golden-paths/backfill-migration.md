# Golden path — Backfill migration

> Situation node: `data-persistence` › `migrations` › `backfill-migration` ·
> [situation spine](../situation-spine.md) · recurrence **21** · risk **medium** ·
> sides: **server** (upheld, with a caveat — see [§12.1](#121--sides-server-holds-and-it-is-the-third-upholding-but-the-clause-that-decides-the-leaf-is-a-string-in-enjson)) ·
> convergence: **diverged** (tested — see [§10](#10-convergence)) ·
> dimensions: **function · resilience · cost · ui**
> Composed 2026-08-17 against `master` @ `50d736f6c`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri/` walked **four** times — twice by the
> census engine (rule + positive control), once by an independent structural counter that
> brace-matches every `fn` declaration and parses its return type by paren-matching the argument
> list rather than by a spanning regex, and once by a scanner for destination-non-empty guards. All
> **4,829** `.ts`/`.tsx` under `src/` searched for each of the **8** registered `backfill_*` command
> names, their API wrappers and their consumers. Every one of the **45** fill-named `fn`
> declarations in the tree was classified by hand. `commands/execution/scheduler.rs`,
> `commands/infrastructure/skill_usage.rs`, `commands/design/reviews.rs:1840-2060`,
> `commands/obsidian_brain/mod.rs:405-470`, `companion/brain/embeddings.rs:180-360`,
> `db/src/repos/dev_workspaces.rs:1320-1500`, `db/src/repos/resources/triggers.rs:1410-1480`,
> `db/src/migrations/incremental.rs:7620-7790`, `db/src/migrations/helpers.rs:185-292`,
> `engine/background.rs:1895-2800` and `src/lib.rs:860-1110` read in full.
>
> **Measured by execution, not by reading.** Read-only **copies** of the operator's live
> `personas.db` (347,054,080 B, 244 tables) and `personas_data.db` (17,502,208 B, 71 tables) were
> taken 2026-08-17 12:42 with the app running; the live files were never opened for write. **Every
> backfill in the inventory below was replayed against the copies as a `COUNT(*)` over its own
> candidate predicate**, so "has this one converged" is a measurement and not an inference. The
> embedding backfill's per-batch scan was timed on the copy. The copies were deleted.
>
> **`cargo` was not run** and no migration, command or repair was executed against any live file.
> Every Rust claim is static or replayed in SQL.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened, lineage checked (§10). Effective independent
> cohort: **4**.
>
> **Settles:** what bounds a backfill, what it resumes from, what makes re-running it free, and how
> anybody — a caller, a user, a later session — learns that it finished.

---

## 0. The headline

**Fourteen backfill operations. Eight of them are buttons the user can press. Exactly one can tell
its caller that it finished — and that one has never run.**

Every backfill in the tree was replayed against a read-only copy of the operator's database. The
question asked of each is not "did it write the right value" (that is the neighbouring leaf) but
**"can anything distinguish *done* from *never started*?"**

| # | operation | `file:line` | bounded by | resume point | receipt | replayed today |
|---|---|---|---|---|---|---|
| 1 | `backfill_schedule` | `commands/execution/scheduler.rs:122` | `BACKFILL_MAX_SLOTS_PER_REQUEST = 100`, probed at cap **+1** | "run again with a later start" — **in the UI copy** | `BackfillResult { slots_enqueued, capped, failures, slot_times }` | **0 slots ever published** |
| 2 | auto catch-up | `engine/background.rs:2598-2790` | `BACKFILL_HARD_CAP` per trigger **and** `GLOBAL_BACKFILL_PER_TICK = 50` | `last_triggered_at` watermark | `schedule_missed_runs` row — a durable residue | **0 triggers configured; 0 rows** |
| 3 | `backfill_memory_embeddings` | `db/src/repos/core/memories.rs:2008` | `batch_limit` param (**64** at the call site) | the un-embedded set, re-derived each batch | `Result<usize>` — **successes only** | **5,158 / 5,158 converged** |
| 4 | `reembed_missing` (companion) | `companion/brain/embeddings.rs:290` | — none — | `reembed_candidates` **is** the resume point | `ReembedCounts{embedded,skipped}` → `ReembedResult{…,available}` | **373 vectors** — this cell read 349 until 2026-08-17, corrected by [derived-index-sync](./derived-index-sync.md): `_metadatatext00` omits every vec0 row whose text metadata fits inline (≤12 bytes), and the 24 missing are the 11-char episode ids. Confirmed twice, by `_rowids` and by a validity-bitmap popcount |
| 5 | `backfill_auto_listeners` | `db/src/repos/resources/triggers.rs:1416` | — none — | n/a (one transaction) | `(scanned, created)` | **39 / 39 converged** |
| 6 | `backfill_practice_ideas` | `db/src/repos/dev_workspaces.rs:1453` | — none — | the `to_process` join | `Result<u32>` — created only | **22 / 22 converged** |
| 7 | `backfill_use_cases_from_business_features` | `db/src/repos/dev_tools.rs:7674` | `MAX_BACKFILL_USE_CASES = 25` | existing-slug set | `Vec<DevUseCase>` — **the values** | 1 would-create across 14 projects |
| 8 | `backfill_review_categories` | `commands/design/reviews.rs:1851` | — none — | `category IS NULL` | `{ total, updated }` | 0 / 113 pending — converged |
| 9 | `backfill_service_flow` | `commands/design/reviews.rs:1880` | — none — | the shape test | `{ total, updated, skipped }` | **113 / 113 pending — never run** |
| 10 | `backfill_related_tools` | `commands/design/reviews.rs:1988` | — none — | the shape test | `{ total, updated, skipped }` | 0 pending (110 of 113 have no tools) |
| 11 | `dev_tools_backfill_qa_pr_review` | `commands/infrastructure/dev_tools.rs:158` | — none — | two absence tests | `{ personas_matched, use_cases_added, … }` | 8 / 8 converged · **0 UI callers** |
| 12 | `obsidian_mirror_backfill_execution_knowledge` | `commands/obsidian_brain/mod.rs:460` | — none — | per-note content compare | `Result<u32>` — written only | 2,343 rows × 78 personas |
| 13 | `backfill_lab_tool_calls` | `db/src/migrations/incremental.rs:7679` | — none — | **a latch, not a resume point** | `Result<()>` | 259 rows · **unverifiable, see below** |
| 14 | `spawn_pending_reembed` / `spawn_pending_kb_reindex` | `data_portability.rs:2043` / `:1998` | — none — | delegates | `()` — a log line | post-import |

**3 of 14 are bounded. 1 of 14 is chunked. 0 of 14 write down that they ran.** There is no ledger:
`schema_migrations`, `PRAGMA user_version` (**0** in both databases) and `applied_migrations` are
absent, exactly as [`data-normalization-migration`](./data-normalization-migration.md) §3 reports
for the chain — and the same is true one layer up, for the operation.

### The three results that make the leaf

**(a) The best-engineered backfill in the repo has never produced a row, and the second-best is
unreachable by configuration.** `backfill_schedule` is the only operation in the tree that carries a
cap probed at **cap + 1** so `capped` is a fact rather than a guess, a `trigger_version` CAS claim
taken *before* it reads anything, a duplicate set fetched from the destination, a per-persona hourly
ceiling that halts it, a `failures` counter, and the enqueued fire times themselves. Replayed:
**0 of 4,972 `persona_events` carry `backfill_slot`** and **0 carry `user_backfill`**. Its automatic
sibling is gated on `backfill_cap > 1` (`background.rs:2614`), and **0 of 351 triggers have
`max_backfill` in their config** — so the auto path has never had a candidate, and
`schedule_missed_runs` holds **0 rows**. The repo's answer to this leaf exists, is complete, and is
cold.

**(b) The one backfill whose completeness could have been checked destroyed the evidence one line
later.** `incremental.rs:5771` is:

```rust
backfill_lab_tool_calls(conn)?;
drop_legacy_tool_calls_columns(conn);
```

Two function calls, **not one transaction**, and the second is unconditional — its twelve
`ALTER TABLE … DROP COLUMN` statements are each `let _ = ddl_step(…)` (`:7663-7665`), so it cannot
fail and cannot report. The backfill's own guard is
`SELECT COUNT(*) FROM lab_tool_calls > 0 → return Ok(())` (`:7680-7685`): a **latch on the
destination being non-empty**, which is satisfied by the *first* row inserted, not the last. A crash
between the first insert and the end of the walk leaves the latch closed, the remaining legacy rows
unmigrated, and the next launch drops the columns that would have proved it. Live: **259
`lab_tool_calls` rows, all `result_kind = 'arena'`, covering 58 of 58 `lab_arena_results`, with 1
orphan `result_id` whose parent no longer exists — and `tool_calls_expected` / `tool_calls_actual`
are gone from all six source tables.** The pass looks complete and **the question is now
unanswerable in principle**. The same file, 7,400 lines earlier, does this correctly:
`clear_legacy_credential_blobs` (`helpers.rs:189`) destroys a credential blob **only after every key
it encodes is confirmed present in `credential_fields`**, and `assert_credential_blob_invariant`
(`:271`) re-checks it on every boot. Two destroy-the-source sites in one repo, opposite discipline,
and the gated one is the one whose data is recoverable.

**(c) The termination condition of the one chunked backfill is the value a total failure returns.**
`src/lib.rs:1084-1103` is the loop the corpus said did not exist here:

```rust
tokio::time::sleep(Duration::from_secs(90)).await;
loop {
    match memories::backfill_memory_embeddings(&bf_main, &bf_vec, &bf_emb, 64).await {
        Ok(0) => break,
        Ok(n) => { info!(embedded = n, "batch done"); sleep(10s).await; }
        Err(e) => { warn!(error = %e, "stopped (next launch retries)"); break; }
    }
}
```

`backfill_memory_embeddings` (`memories.rs:2008-2039`) counts **only successes**: a per-row
embedding failure is `warn!`-ed and skipped (`:2035`), never counted. So `Ok(0)` is returned both by
"every candidate already has a vector" and by "every candidate failed to embed" — and the loop
breaks on it either way, silently, with no error, at `warn!` level at most, 90 s after boot where
nobody is looking. Live the backfill has **converged: 5,158 recall-eligible memories, 5,158
embeddings, 0 missing, 0 orphan, id-exact across the two databases** — which is the good outcome and
also the outcome that a completely broken embedder is indistinguishable from. Its sibling one
directory away got this right: `reembed_missing` returns `ReembedCounts { embedded, skipped }`
(`embeddings.rs:178-184`) and the command wrapping it returns
`ReembedResult { embedded, skipped, available }` (`brain.rs:1126-1137`), where `available: false`
names the third state — *this build has no embedder* — so all three reasons for a zero are
separable. **One repo, one concept, two implementations, and they differ exactly on the question
this leaf asks.**

### What "run it twice" does — the whole inventory

The brief asked this of every backfill. It is the cheapest audit in the leaf and it is where the
population splits cleanly in two:

| operation | second run | why |
|---|---|---|
| `backfill_schedule` | **free** — republishes nothing | `backfill_slot_times_for_source` is read from the destination; duplicates counted into `skipped_duplicate` |
| auto catch-up | **free** | CAS claim + `last_triggered_at` watermark |
| `backfill_memory_embeddings` | **free**, ~392 ms | diffed against the vec table each batch |
| `reembed_missing` | **free** | delete-then-insert per node, candidate set re-derived |
| `backfill_auto_listeners` | **free** | `_auto_for_trigger` set read from the destination |
| `backfill_practice_ideas` | **free** | `create_finding`'s `(project_id, dedup_key)` gate |
| `backfill_use_cases_from_business_features` | **free** | existing-slug set; a slug race is `continue`, not an error |
| `backfill_review_categories` | **free** — and it happens, once per app session (`useGalleryQuery.ts:271`) | `category IS NULL` narrows to nothing |
| `backfill_service_flow` | **free** | `needs_backfill` shape test rejects the already-converted shape |
| `backfill_related_tools` | **free** | per-connector `related_tools` emptiness test |
| `dev_tools_backfill_qa_pr_review` | **free** | `has_uc` + `COUNT(*)` absence tests |
| `obsidian_mirror_backfill_execution_knowledge` | **free** — and returns **0**, indistinguishable from failure | `mirror_write_note` returns `Ok(false)` for unchanged |
| `backfill_lab_tool_calls` | **inert, and that is the defect** | the latch short-circuits before the walk; `INSERT OR IGNORE` would have made the walk safe, and never runs |
| `spawn_pending_*` | **free** | delegate to 3 / 4 |

**Idempotence is not this repo's problem: 13 of 14 are re-runnable and 12 of 14 achieve it the same
way — by querying the destination for what is already done.** That is a genuine, unforced,
repo-wide convention and §2 makes it doctrine. The problem is everything downstream of it:
**boundedness (3 of 14), a durable residue when the bound is hit (1 of 14), and a receipt that
separates *converged* from *never applicable* from *failed* (5 of 14).**

### Boundary with [`data-normalization-migration`](./data-normalization-migration.md) — settled

The brief asked whether these are two leaves or one. **They are two, and the measurement says so
sharply: the two populations overlap on exactly one member out of 14.**

That neighbour enumerated **122 `run_step`s** and **67 row-rewriting statements** in the migration
chain and asked, of each, *are the rows correct* — answering that **113 of 122 guard on schema** and
exactly **one** guards on the rows. Its unit is **the statement and its guard**. This leaf's unit is
**the callable operation and its receipt**, and its population is the 14 above, of which **exactly
one — `backfill_lab_tool_calls` — is inside the migration chain at all.** The other 13 are Tauri
commands, repo functions, boot tasks and scheduler ticks. The best answer to this leaf
(`skill_usage_scan`, §3) is not a migration and touches no legacy column; the best answer to that
leaf (`incremental.rs:7048`'s `COUNT(*)` guard) is a ten-line migration step with no caller, no
receipt and no bound.

Concretely, the seam:

| question | owner |
|---|---|
| does the `WHERE` clause name the pre-migration row shape; does a `DEFAULT` compete with the backfill; is the write path closed | **`data-normalization-migration`** — it measured the 26 contradicting `persona_triggers` rows and the unsatisfiable `importance >= 8` predicate, and this path does not re-derive either |
| how much may one pass do; what does it record when it stops early; how does the caller learn it stopped early; what does a crash mid-pass leave behind; who claims the work | **this path** |
| what the preview of a repair must show before it runs | [`dry-run-preview`](./dry-run-preview.md) §7 D6 — a count-shaped preview is not enough when values change |
| whether a boot step may run at all, and its guard contract | [`boot-migration-step`](./boot-migration-step.md) |
| the queue an un-drained backfill leaves behind for a human | [`findings-triage-queue`](./findings-triage-queue.md) — it owns the population waiting; this path owns the pass that was supposed to drain it |
| whether a long pass reports progress to a UI | [`long-running-job-progress`](./long-running-job-progress.md) — `kb_reindex` returns a job id and streams `kb:ingest_*`; that mechanism is cited here, not restated |

**The neighbour's Gap 2** — *"A backfill has no resumability primitive… Nothing in the chain is
chunked"* — is correct **as scoped to the chain** and is answered outside it. See §12.2 for the
sentence in the same document that generalised it too far, and what the measurement says.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) this head carries no file path,
primitive name or count, so a sibling project on another stack can adopt it. Each clause names its
warrant.

> **P1 — physics, and the leaf's centre.** **A backfill's completion is a claim about a population,
> and a count of what the pass did is not that claim.** The pass must report the population it
> found, the part it handled, the part it could not, and whether it stopped early — because
> "nothing to do", "already done", "not applicable", and "everything failed" all produce the same
> number of writes, and only the first of those is success.
> *Warrant: executed — a chunked backfill whose loop terminates on `Ok(0)`, a value its own
> total-failure path also returns; and 1 of 4 independent siblings is the only repo in the cohort
> where an incomplete pass can be observed by anything other than a human reading a log.*
>
> **P2 — physics.** **Derive "already done" from the destination, never from a record that the pass
> ran.** A ledger says a program executed; the destination says the work exists. The second survives
> a restore, a partial pass, a crash, and a second writer; the first survives none of them.
> *Warrant: 12 of 14 operations in this repo reached for the destination query unprompted, and it is
> also what the two siblings with real backfill machinery reached for — one of them stating it as
> its design principle in a comment.*
>
> **P3 — physics.** **The bound and the residue are one decision.** A pass that may stop early must
> leave, on the row or in a durable record, what it did not reach — otherwise the bound has silently
> converted a backlog into a loss. A bound without a residue is worse than no bound, because it
> looks finished.
> *Warrant: the one operation here that pairs a cap with a durable "missed N" row is also the only
> one whose UI can tell the user to run it again from where it stopped; and the sibling with the
> best receipt in the cohort is the one that returns both `stoppedEarly` and how many remain.*
>
> **P4 — physics.** **Do not destroy the source until the destination is proven complete, and prove
> it by reading the destination, not by having called the fill.** Sequence is not proof.
> *Warrant: 0 of 4 independent siblings gates a drop or prune on a proven-complete check; every one
> orders it after the fill. This repo contains both forms — one gated, one sequential — and the
> sequential one has already made its own completeness unknowable.*
>
> **P5 — ergonomics, and the one nobody gets right by accident.** **A zero must say which zero it
> is.** Surface the distinction to whoever pressed the button: converged, not applicable,
> unavailable, or failed. A success toast reading "0" is the most common lie a backfill tells.
> *Warrant: measured across eight user-pressable backfills in one app — one explains its zero in
> words, one reports a failure count, and the rest render a bare number as success.*
>
> **P6 — resilience.** **A per-row failure must not be able to look like the end of the work.** If
> the loop's terminator is "the pass changed nothing", then swallowing a row error converts a total
> outage into a clean exit.
> *Warrant: executed, on the only chunked backfill in this repo.*
>
> **P7 — cost.** **Bound the read, not only the write.** A batch limit that caps writes while each
> batch re-reads the whole population turns a linear job into a quadratic one, and keeps paying
> after it has converged.
> *Warrant: timed — 392 ms of scan per batch × 81 batches = 31.7 s of pure re-reading to fill 5,158
> rows, and 392 ms on every launch forever afterwards. The one sibling that bounds its read uses a
> `LIMIT` in the candidate query.*
>
> **Scale condition.** P1, P2, P5 and P6 are correctness on day one at any size. P3 bites the first
> time the population exceeds the bound. P4 bites once, permanently, and cannot be undone. P7 is
> invisible below a few thousand rows and grows with the square of the population.

---

## 1. Trigger

You are in this situation when you say, or are about to type, any of these:

- *"The rows that already exist need this too — write a one-off to fill them in."*
- *"Add a `backfill_*` command so the user can catch up the old data."*
- *"It's idempotent, so we can just run it on every boot."*
- *"Re-embed / re-index / re-derive everything for the existing corpus."*
- *"This'll be a big update — should we batch it?"*
- *"How do I know it worked? I'll log the count."*
- *"We can drop the old column now that the new table is populated."*

**If you are about to write** a function that reads an existing population, writes a derived value
per member, and returns how many it wrote — you are here. Likewise if you are about to add a
`LIMIT`/`batch_size` to a data pass, guard a pass on `SELECT COUNT(*) FROM <destination>`, or wire a
one-shot repair to app startup.

**The distinguishing question against [`data-normalization-migration`](./data-normalization-migration.md):**
*is your question what the rows should become, or whether the pass over them finished?* The first is
that path. The moment you write a bound, a batch, a retry, a "run it again", or a receipt — you are
here.

---

## 2. The one way

**Make the pass's own candidate query the resume point, bound what one pass may do, and return a
receipt that carries the population, the part handled, the part refused, and whether the bound was
hit — so a second run is free and a zero is legible.** Concretely: **(a)** write the candidate
query first — `SELECT … WHERE <the unfilled shape>` — because it is simultaneously your worklist,
your resume point, your idempotence gate and your postcondition; if you cannot express it you do not
yet know what "finished" means. **(b)** Derive "already done" **from the destination** and never from
a flag saying the pass ran (P2) — `backfill_slot_times_for_source` (`events.rs:507`) and
`embedded_memory_ids` are the shape; a `SELECT COUNT(*) FROM <destination>` that short-circuits the
whole walk is **not** this, it is a latch, and §5 explains what it costs. **(c)** Put the bound in
the *query*, not only in the loop — `LIMIT :batch` — so the read is bounded too (P7), and take the
bound as a parameter with a named constant at the call site rather than a literal in the body.
**(d)** Probe at **cap + 1** so `capped` is measured rather than assumed;
`scheduler.rs:213-224` is four lines of exactly that. **(e)** Return a struct, never a scalar: the
population found, the number handled, the number refused **with the reason separated**, and a
`capped`/`exhausted` flag. `SkillUsageScanSummary` (`skill_usage.rs:58-70`) and
`ReembedResult { embedded, skipped, available }` (`brain.rs:1126-1137`) are the two shapes to copy —
the first for a bounded pass, the second for a drain-to-completion pass. **(f)** When the bound is
hit, **write the residue down** (P3): a durable row naming what was not reached, cleared when
somebody catches up or dismisses it — `schedule_missed_runs` (`triggers.rs`, written at
`background.rs:2126`) is the repo's only implementation and it is right. **(g)** Never let a per-row
failure be silent *and* uncounted (P6): count it into the receipt's refused term, log it, and keep
going — bailing a boot-time pass bricks the install, and swallowing it invisibly is worse.
**(h)** If two things can run the pass — a user click and a background tick — take a **claim** on
the unit of work before you read anything, with a compare-and-set on a version the loser can detect;
`advance_schedule_pointer` (`triggers.rs:1750`) is reused for this at `scheduler.rs:190-209`
precisely because it is a CAS that does not move the schedule pointer. **(i)** Do **not** delete the
source until you have re-read the destination and confirmed every unit is present (P4);
`clear_legacy_credential_blobs` (`helpers.rs:189-262`) is the reference and it is 70 lines.
**(j)** And because the user is on the other end of eight of these: **render the zero in words**.
`uc_backfill_none` — *"No context label spans more than one context, so nothing was created. Use
Scan to propose features."* — is the only string in 19,000+ `en.json` leaves that does this, and it
is what P5 asks for.

If you must get one right first: **(e)**. Every other clause is discoverable from a receipt that
tells the truth, and none of them is discoverable from a `u32`.

---

## 3. Mandated primitives

Every one of these exists today. The adopter counts are the finding.

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`src-tauri/src/commands/infrastructure/skill_usage.rs` — `skill_usage_scan` / `mine_file`** | **The reference operation, and it is not a migration.** A per-file byte watermark in `skill_scan_state` (`:398`, `:488-493`) written **inside the same transaction as the rows it covers** (`:494`); a per-call read budget `MAX_BYTES_PER_SCAN = 48 MiB` (`:57`) whose exhaustion is reported as `exhausted: bool` with the doc line *"A call that exhausts it reports `exhausted: true`; watermarks make the next call resume where this one stopped"*; a **population** bound as well as a pass bound (`MAX_FILE_AGE_DAYS = 90`, `:54`); rotation/truncation handled (`stored_offset > len → 0`, `:409`); `INSERT OR IGNORE` underneath so a replayed byte range is free; and per-file failures warned and skipped, *"vital signs must not cost the caller its answer"*. Its receipt names the denominator (`files_scanned`), the residue (`files_skipped`), the numerator (`events_added`) and the bound (`exhausted`). | 1 |
| **`commands/execution/scheduler.rs:122-332` — `backfill_schedule`** | **The reference *user-initiated* backfill.** Cap probed at **+1** so `capped` is a measurement (`:213-224`); a `trigger_version` CAS **claim taken before anything is read** (`:190-209`) with the 14-line comment explaining exactly which double-dispatch it prevents; the duplicate set read from the destination (`:235`); the per-persona hourly ceiling honoured mid-pass with `capped = true` and a healing issue (`:259-275`); `failures` counted, never swallowed; and `slot_times` returned so the caller can show *what* was enqueued rather than how many. | 1 |
| **`db/src/repos/core/memories.rs:2008` + `src/lib.rs:1086-1101`** | **The chunked, resumable, gentle drain.** `batch_limit` parameter, 64 at the call site; loop until zero; 10 s between batches; 90 s after boot so it never competes with startup; *"each batch is diffed against the vec table, so restarts/repeat runs are safe"*. Copy the shape. **Do not copy the receipt** (§7 D3) or the unbounded read (§7 D4). | 1 |
| **`src/companion/brain/embeddings.rs:290` — `reembed_missing`** | **The candidate query as the resume point, stated.** `reembed_candidates` (`:205-216`) is a pure, unit-testable selection rule with its own doc comment about what it deliberately leaves alone; the pass deletes the old vector before inserting *"or a re-run would stack duplicate vectors"*; and the doc says the consequence out loud: *"a second run finds nothing to do and reports `embedded: 0`"*. | 1 |
| **`src/commands/companion/brain.rs:1126-1137` — `ReembedResult { embedded, skipped, available }`** | **The receipt shape for a drain-to-completion pass, and the third state named.** `available: false` when the build has no embedder — *"The call is a clean no-op in that case — never an error, so the UI can render an honest 'unavailable on this build' instead of a failure toast."* This is P5 as a type. | 1 |
| **`db/src/repos/resources/triggers.rs:1416` — `backfill_auto_listeners`** | **The denominator in the receipt.** `(scanned, created)`: 0 created of 39 scanned is convergence; 0 created of 0 scanned is an empty table. Also the one pass that puts all its writes in **one transaction** (`:1470-1477`), so a crash leaves nothing half-applied. | 1 |
| **`db/src/repos/communication/events.rs:507` — `backfill_slot_times_for_source`** | **The destination query, extracted as a named function returning a `HashSet`.** This is what P2 looks like when someone bothers to name it. | 1 |
| **`db/src/migrations/helpers.rs:189-262` + `:271-292`** | **Destroy-the-source, gated — and then asserted forever.** The blob is cleared only once every key it encodes is confirmed present in `credential_fields`; an undecryptable blob is *left in place* because completeness cannot be proven; and `assert_credential_blob_invariant` re-checks the invariant on every boot at `error!` without crashing. Live: 25 credentials, 42 fields, 0 legacy blobs, 0 violations. | 1 (of 2 destroy sites) |
| **`engine/background.rs:2122-2140` — `record_and_emit_missed_runs`** | **The residue as a durable row.** `schedule_missed_runs` accumulates across gaps and is cleared when the user backfills or dismisses; the accompanying event is deliberately *"not a listener-matched type, so it never spawns an execution — it is purely informational"*. The only implementation of P3 in the tree. | 1 |
| **`core/src/limits.rs` `BACKFILL_HARD_CAP` + `background.rs:1913` `GLOBAL_BACKFILL_PER_TICK = 50`** | **Two bounds, per-unit and aggregate, with the reason on the line**: *"a mass restart after long downtime with many backfill-enabled triggers could still emit (triggers × cap) catch-up events in one tick — a thundering herd."* | 1 |
| **`db/src/repos/dev_tools.rs:7674` `MAX_BACKFILL_USE_CASES = 25`** | A population bound whose comment names the failure it prevents: *"Backstop so a pathological map cannot flood the triage queue."* A bound on a backfill that feeds a **human queue** is a different concern from a bound on cost — see [`findings-triage-queue`](./findings-triage-queue.md). | 1 |
| **`src/i18n/locales/en.json` → `plugins.dev_tools.uc_backfill_none`** | **The zero, in words.** *"No context label spans more than one context, so nothing was created. Use Scan to propose features."* Backed by the comment at `useUseCases.ts:141-142`: *"Zero is the common, correct answer… Say so rather than look broken."* | 1 of 8 user-pressable backfills |
| **`en.json` → `schedules.backfill_result_capped`** | **The resume instruction in the UI**: *"Result was capped — narrow the window or run again from the last slot to continue."* P3's user-facing half. | 1 |

**Do NOT exist — this path names them:**

- **Any record that a backfill ran.** No ledger, no `backfilled_at`, no `PRAGMA user_version`
  (**0**), no per-pass row. Every "has this happened" question is re-derived from the data or
  unanswerable.
- **Any door that refuses to serve while a fill is incomplete.** The one sibling that has this
  (§10 clause 4) is the strongest external result in the sweep, and nothing here corresponds.
- **A shared receipt type.** Fourteen operations, **nine distinct return shapes** — `()`, `u32`,
  `usize`, `(u32,u32)`, `String`, `Vec<T>`, `serde_json::Value`, and three bespoke structs. There is
  no `BackfillOutcome` for a new pass to reach for, which is most of why five of them return a bare
  number.
- **A bounded read.** One operation bounds its writes (`batch_limit`); **zero** put the bound in the
  candidate query.
- **A claim on any pass except the scheduler's.** 1 of 14.
- **A test that a bounded pass reports being capped.** Of the 17 test-scope declarations naming a
  backfill, **6** assert cap/idempotence behaviour — all six are the scheduler's
  (`background.rs:3428-3608`) or `dev_tools.rs:8571`. None of the five bare-receipt passes has one.

---

## 4. Steps

1. **Write the candidate query before anything else.** `SELECT … FROM t WHERE <the unfilled shape>`.
   Give it a name and a return type (`reembed_candidates` is the model). It is your worklist, your
   resume point, your idempotence gate and your postcondition, and having it as a separate function
   makes the selection rule — the part with room to be wrong — unit-testable without the expensive
   half.
2. **Bound it in the query.** `LIMIT :batch`, with the batch size a parameter and a named constant
   at the call site. If you bound only the loop, you have bounded the writes and not the reads, and
   §7 D4 measures what that costs.
3. **Bound the population too, if the population has a natural horizon.** `MAX_FILE_AGE_DAYS = 90`
   is not the same decision as a batch size and both are worth making explicitly.
4. **Probe at cap + 1.** Ask for one more than you will take, so `capped` is a measurement.
5. **Take the claim before the read** if a background tick and a user can both start the pass. A CAS
   on a version the loser can detect. Reuse the existing one rather than inventing a lock.
6. **Design the receipt as a struct, now, not after the first bug.** Four terms minimum: population
   found, handled, refused (**with the reasons separated** — unavailable is not the same as failed
   is not the same as skipped-because-unchanged), and `capped`/`exhausted`. If the whole feature can
   be off, name that too — `available: bool` is the difference between an honest no-op and a
   failure toast.
7. **Write the residue down when the bound is hit.** A durable row per unit naming what was not
   reached, cleared by a catch-up or an explicit dismissal. If you cannot justify a table, you
   probably cannot justify the bound.
8. **Advance the watermark in the same transaction as the writes it covers.** `mine_file:488-494` is the
   pattern — commit the rows and the cursor together, or the cursor is a lie the next run believes.
9. **Count every per-row failure into the receipt.** Warn, continue, and never let the loop's
   terminator be a value that a total outage also produces.
10. **Do not delete the source in the same change.** Land the fill, let it converge, *then* write a
    separate step that re-reads the destination and proves every unit present before it drops
    anything — and leave a boot-time invariant assertion behind.
11. **Render the zero in words on whatever surface starts the pass.** Four sentences, one per state.
12. **And then stop.** Do not add a `backfilled_at` column — the candidate query is the marker. Do
    not write a second pass for the same population. Do not put the pass behind a
    `SELECT COUNT(*) FROM <destination>` latch.

### Can the type make the wrong call impossible? — asked before §9

**Yes for the receipt, and the seven qualifications all clear.** The bad state is a bulk fill whose
return type cannot express "I did not finish" or "I could not start".

- **Q1 (a required prop carries only what it encodes).** A single required `count: u32` encodes the
  numerator and nothing else — which is precisely how five of these got here. The type must be a
  **product** of numerator, denominator, residue and bound; requiring one number harder changes
  nothing. This is the qualification that dictates the *shape* of the fix.
- **Q2 (requiredness ≠ closedness).** `Result<u32, AppError>` is already required in the strongest
  sense the language offers, and it is wrong anyway. Requiredness is not the axis.
- **Q3 (a type nobody constructs constrains nothing).** **This is the qualification that says the
  edit lands.** There are **14** bulk-fill operations in 963 Rust files and **5** with a bare
  receipt. Five construction sites is reachable; a `Plan<T>` across all 104 mutating doors is not.
- **Q4 (a type anyone can construct authenticates nothing).** A `struct BackfillOutcome` with public
  fields is a comment — anyone can write `BackfillOutcome { capped: false, .. }` on a pass that
  stopped early. The constructor must take the bound and the candidate count and **derive** `capped`
  the way `scheduler.rs:221` does (`slots.len() > CAP`), not accept it.
- **Q5 (withholding beats requiring).** The repo has already run this experiment.
  `ReembedResult` withholds the possibility of a bare number — its two consumers
  (`SetupPanel`-shaped and `spawn_pending_reembed`) both report `embedded` **and** `skipped`, 2/2
  correct. `Result<u32>` permits a bare number — 0 of 5 call sites report anything else, and one of
  them renders it as a success toast. Same concept, two doors, and every failure is at the
  permissive one.
- **Q6 (withhold the dangerous freedom, not the answer).** The dangerous freedom is *returning a
  number without saying what it is a number of*. Withholding the count itself would break every
  caller; withholding the ability to return it **alone** is the whole fix.
- **Q7 (relaxing a requirement is inert where the caller supplies the bad value voluntarily).**
  Nobody forces `-> Result<u32>`; five authors chose it, and four of them computed the missing terms
  and then threw them away into a `tracing::info!`. So the type must **remove the option**, and it
  must be the only door — which is why §3 names the absence of a shared receipt type as the root.

**Where the type does not reach, and it is the leaf's own boundary.** Nothing in the type system
distinguishes `Ok(0)` meaning *converged* from `Ok(0)` meaning *every row failed* **once the author
has decided to count only successes** — that decision lives inside the loop body, in a `match` arm
that increments one counter and not another. A `BackfillOutcome` makes the omission *spellable* and
therefore visible in review; it cannot make it impossible. The reachable enforcement for the rest is
§9's ratchet plus the boot-time invariant assertion in §3.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Guarding a pass on `SELECT COUNT(*) FROM <destination> > 0`** | A **latch**, not a resume point: it closes on the *first* row written, so an interrupted pass is permanently "done". `backfill_lab_tool_calls:7680`. Its own doc comment already knows the walk is safe to re-run (`INSERT OR IGNORE` on a unique index) — the latch is what stops the safe walk from happening. |
| **Dropping the source in the statement after the fill** | Sequence is not proof (P4). `incremental.rs:5771-5772`: two calls, not one transaction, the drop unconditional and its twelve results all `let _ =`. The completeness question is now unanswerable on the operator's machine. |
| **A receipt that is a bare numerator** | The caller cannot separate converged / not-applicable / unavailable / failed. **5 sites**, §9's census rule. Four of the five compute the missing terms and log them instead of returning them. |
| **A loop that terminates on "the pass changed nothing"** | Whatever makes every row fail also makes the pass look finished. `lib.rs:1092` `Ok(0) => break` against `memories.rs:2034`'s swallowed per-row error. |
| **Batching the writes and not the reads** | Each batch re-reads the whole population: 5,158 rows × 81 batches = 417,798 row reads and 31.7 s of scanning for a 5,158-row fill — and 392 ms on every launch after it has converged. |
| **`SELECT *` in a candidate query that only needs an id** | The skip test (`already.contains(&m.id)`) runs *after* the full row is materialised, so the pass pays to load 5,158 memory bodies in order to discard 5,158 of them. |
| **A cap with no residue** | The bound silently converts a backlog into a loss. 3 of 14 passes are bounded; **1** writes down what it did not reach. |
| **Rendering a backfill's count as a success toast** | *"Mirrored {count} notes to your vault."* on a function returning `0` for four different reasons — mirror disabled, no vault, list query failed, every write failed. `SetupPanel.tsx:99-100`. |
| **Reporting `slots_enqueued == 0` as "nothing to do"** | The backend counted `skipped_duplicate` and did not return it, so the one pass that *knows* the difference discards it at the boundary. `scheduler.rs:229,247,318` vs `useScheduleActions.ts:292`. |
| **Awaiting a backfill and discarding its receipt** | `await backfillServiceFlow(); refresh();` — `{total, updated, skipped}` computed, returned, thrown away, no toast. `useGalleryActions.ts:220,227`. |
| **Firing a backfill on mount behind a session flag** | `backfillReviewCategories().catch(silentCatch(…))` runs once per app session, forever, with the receipt discarded into a promise nobody reads. It has been correct (0 of 113 pending) for as long as anyone can tell, and nothing would say if it stopped being. `useGalleryQuery.ts:271`. |
| **A `#[tauri::command]` + API wrapper with no consumer** | `backfillPracticeIdeas` and `backfillQaPrReview` are registered, typed, documented and called from **zero** components. A backfill nobody can start is indistinguishable from one that always converges. |
| **Two implementations of one fill in one repo** | `backfill_memory_embeddings` and `reembed_missing` are the same idea and disagree on boundedness, on the receipt and on whether a zero is legible. Neither knows the other exists. |
| **`Ok(0)` from a helper whose preconditions also return 0** | `mirror_execution_knowledge_for_persona` returns `0` for "disabled", "no vault", "list failed" and "all writes failed", and the command sums 78 of them into one `u32`. |
| **Bounding a pass with a constant nobody can configure** | `BACKFILL_MAX_SLOTS_PER_REQUEST = 100` is right and the doc says why ("if someone genuinely needs more they can run the command again with a later start"). `REEMBED_BATCH = 32` reads like a bound and is a **logging cadence** (`embeddings.rs:186-188`, used only at `:338`) — the same word for two things, in the same repo, one directory apart. |

---

## 6. Evidence

**The ONE site to copy: `src-tauri/src/commands/infrastructure/skill_usage.rs`, `mine_file` +
`skill_usage_scan`** — and copy the module header as much as the functions.

Six things to take: (1) the **watermark is durable and per-unit**, not per-run; (2) it is written
**in the same transaction** as the rows it covers (`:488-494`), so the cursor cannot outrun the data;
(3) the pass carries **two** bounds — a per-call byte budget and a population age horizon — and they
are different decisions with different comments; (4) exhausting the budget is a **returned fact**
(`exhausted: bool`) with the resume contract in its doc line; (5) the receipt names the denominator
(`files_scanned`), the residue (`files_skipped`) and the numerator (`events_added`), so no single
number has to carry a meaning it cannot; (6) the degenerate inputs are handled where they occur —
a truncated or rotated file resets its own watermark to 0 (`:409`) and `INSERT OR IGNORE` makes the
replay free.

It is worth saying plainly that **this is not a migration**. It is a transcript miner. The leaf's
best answer lives outside the leaf's obvious neighbourhood, and the migration chain — 122 steps —
contains none of the six.

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `commands/execution/scheduler.rs:213-224` | **The cap probed at +1.** `probe_cap = CAP + 1`, `capped = slots.len() > CAP`, `truncate(CAP)`. Four lines that turn a guess into a measurement. |
| `commands/execution/scheduler.rs:176-209` | **The claim, taken before the read**, reusing an existing CAS rather than a bespoke lock, with a comment naming the exact double-dispatch it prevents and why `advance_schedule_pointer` is the right primitive (*"it CASes on `trigger_version` without moving `last_triggered_at`, so the loser just gets told to retry"*). |
| `commands/execution/scheduler.rs:259-275` | **A mid-pass ceiling that halts and reports.** The hourly cap sets `capped = true`, logs a healing issue, and breaks — a partial pass the caller can see, not a silently truncated one. |
| `db/src/migrations/helpers.rs:189-262` | **Destroy-the-source, gated on proven completeness**, with the undecryptable case explicitly preserved because completeness *cannot* be proven for it. |
| `db/src/migrations/helpers.rs:271-292` | **The invariant re-asserted on every boot**, `error!`-loud, never fatal. The only standing completeness check in the repo. |
| `src/commands/companion/brain.rs:1126-1137` | **The three-state receipt.** `available: false` is the field that stops "this build has no embedder" from rendering as a failure. |
| `src/companion/brain/embeddings.rs:205-216` | **The candidate rule as a documented, testable, embedder-free function** — *"the selection rule — the part with actual room to be wrong — is unit testable without an ONNX model"* — including what it deliberately leaves alone and why. |
| `engine/background.rs:1899-1913` | **Two bounds with their reasons**: per-trigger amplification and the cross-trigger thundering herd, named separately. |
| `db/src/repos/resources/triggers.rs:1470-1477` | **One transaction for the whole fill**, so a crash leaves nothing half-applied — viable precisely because the pass is bounded by the table's size (39 rows) and known to be small. |
| `src/features/plugins/dev-tools/sub_context/useUseCases.ts:135-150` + `uc_backfill_none` | **The zero explained.** A dedicated result state, a sentence saying which zero it is, and a pointer to the other door (*"Use Scan to propose features"*). |
| `en.json` → `schedules.backfill_result_capped` | **The resume instruction as user copy**, not as a comment. |
| `background.rs:3428-3608` | **Six unit tests that assert a backfill's *bound* behaviour by name** — `test_backfill_hard_cap_protects_against_amplification`, `..._three_missed_drops_most_recent`, `..._returns_extras_only`. The property under test is the cap, not the value. |

**Executed, on a copy of the live database.** Every backfill's candidate predicate, replayed:

| pass | candidates remaining | verdict |
|---|---:|---|
| memory embeddings (`tier != 'archive'` without a vector) | **0 of 5,158** | converged, id-exact, 0 orphan |
| auto-listeners (source triggers with no `_auto_for_trigger`) | **0 of 39** | converged |
| practice ideas (`to_process` ∩ adopted ∩ actionable, no idea) | **0 of 22** | converged |
| review categories (`category IS NULL`) | **0 of 113** | converged |
| related tools (a connector missing `related_tools`) | **0 of 3 eligible** | converged (110 of 113 skip: no `suggested_tools`) |
| QA PR review (QA Guardian without `uc_pr_review`) | **0 of 8** | converged |
| executions FTS | **2,188 of 2,188 indexed** | converged |
| use cases from labels (per project, label spanning ≥2 contexts, no slug) | **1** (in `politicas`) | effectively converged |
| lab tool calls | **58 of 58 arena results covered** | converged-looking, **unverifiable** — source columns dropped |
| **service flow** (`design_result.service_flow` still `string[]`) | **113 of 113** | **never run** |
| **schedule backfill** (`backfill_slot` events) | **0 of 4,972 events** | **never run** |
| **auto catch-up** (`schedule_missed_runs` rows; triggers with `max_backfill`) | **0 rows; 0 of 351** | **unreachable by configuration** |

**Nine of twelve have converged and stayed converged, and the mechanism is the same in all nine: the
destination query.** That is the case for §2(a)/(b), and it is why this path's prescription is not
"add a ledger". The three that have not converged are the three nobody has pressed — which is the
case for §2(e)/(j), because in every one of those three the app's own surface says nothing is
wrong.

---

## 7. Deviations

Every entry is live on `master` @ `50d736f6c`, verified by reading the file and — where a number is
quoted — by replay against a read-only copy of the operator's databases. **Nothing here was
applied.** Per the campaign's standing rule, a leaf whose first run rewrites rows is a note.

### D1 — the lab-tool-calls backfill destroys the evidence of its own completeness, one line later · **executed**

`db/src/migrations/incremental.rs:5771-5772`. `backfill_lab_tool_calls(conn)?;` then
`drop_legacy_tool_calls_columns(conn);` — **not one transaction**, and the drop is unconditional,
returns `()`, and swallows all twelve `ALTER TABLE … DROP COLUMN` results with `let _ = ddl_step(…)`
(`:7663-7665`). The fill's guard is `SELECT COUNT(*) FROM lab_tool_calls > 0 → return Ok(())`
(`:7680-7685`) — satisfied by the first inserted row.

The window is real and narrow: a crash after the first `INSERT` and before the walk ends leaves the
latch closed and the rest of the legacy rows unmigrated; the *next* launch then drops the columns
those rows lived in. The function's own doc comment already documents having been bitten by an
adjacent version of this — `:7706-7722` explains a `column_exists` guard added because "the first
backfill found zero legacy rows (so `lab_tool_calls` stayed empty), then the drop step removed the
columns" and the next startup's `SELECT` panicked.

Live: **259 rows, all `result_kind = 'arena'`; 58 of 58 `lab_arena_results` have ≥1 row; 1 orphan
`result_id`; `expected` 245 vs `actual` 14; `tool_calls_expected` and `tool_calls_actual` are absent
from all six source tables.** The coverage looks total and **cannot be confirmed**, because the only
query that would answer it needs a column that no longer exists.

**A repair would have to be careful about:** there is no data repair available — the input is gone.
The *code* fix is three edits with no data effect: make the guard the candidate count
(`SELECT COUNT(*) FROM <source> WHERE tool_calls_expected IS NOT NULL`) instead of the destination
count; give the fill a receipt so the caller can see it; and move the drop into a **separate later
step** gated on `helpers.rs:189`'s shape — re-read the destination and prove every source unit
present before dropping. On a fresh install that ordering costs one extra launch and buys a provable
migration.

### D2 — five backfills return a bare numerator · **§9's census population**

`incremental.rs:7679` (`-> Result<(), AppError>`), `memories.rs:2008` (`-> Result<usize, …>`),
`dev_workspaces.rs:1453` and `commands/infrastructure/dev_workspaces.rs:544`
(`-> Result<u32, …>`), `obsidian_brain/mod.rs:460` (`-> Result<u32, …>`).

Four of the five **compute** the missing terms and discard them:
`backfill_lab_tool_calls` accumulates `total_inserted` and logs it (`:7697`, `:7768-7773`);
`backfill_practice_ideas` warns on each unreadable practice (`:1480`) and counts none;
`materialize_practice_ideas` warns per failed project (`:1396-1401`) and counts none;
`mirror_execution_knowledge_for_persona` distinguishes `Ok(true)` / `Ok(false)` / `Err` internally
(`obsidian/mod.rs:448-450`) and returns only the first. The information exists at the point of the
loop and dies at the `return`.

**Why it matters:** these are the four states P5 names, collapsed into one integer, and two of the
five are IPC doors whose numbers reach a user.

**A repair would have to be careful about:** the two `#[tauri::command]` signatures
(`dev_tools_workspace_backfill_practice_ideas`, `obsidian_mirror_backfill_execution_knowledge`) are
public IPC and have ts-rs consumers; widening `u32` → a struct is a binding change and needs
`cargo test --workspace --features desktop export_bindings`. `backfill_practice_ideas` also runs at
boot (`lib.rs:878`) where the caller only pattern-matches `Ok(n) if n > 0`, so it must keep a field
that answers "did anything happen". Purely additive; no data effect.

### D3 — the chunked backfill's terminator is what a total failure returns · **the sharpest one**

`src/lib.rs:1092` `Ok(0) => break`, against `memories.rs:2031-2036`:

```rust
match embed_and_store_memory(vec_pool, embedder, &m.id, &text).await {
    Ok(()) => embedded += 1,
    Err(e) => tracing::warn!(memory_id = %m.id, error = %e,
                             "memory embedding backfill: skipped one row"),
}
```

`embedded` counts successes; a failure increments nothing. If the embedder is unloadable, poisoned,
or rejecting every input, the first batch embeds 0, returns `Ok(0)`, and the loop breaks with **no
error, no `error!`, and no user-visible signal** — 90 seconds after boot. Recall then degrades to
the recency and importance lanes, which is exactly the silent degradation
`embeddings.rs:262-281`'s doc comment describes as the hole `reembed_missing` was written to close.

Live the pass has converged (**5,158 / 5,158**), so the defect is **latent** — and it is latent in
the way that matters: the healthy outcome and the total-outage outcome are byte-identical to every
observer.

**A repair would have to be careful about:** the terminator, not just the receipt. Returning
`{ embedded, skipped }` is necessary and not sufficient — the caller must break on
`embedded + skipped == 0` (nothing left to try) rather than on `embedded == 0`, or a batch of 64
permanent failures becomes an infinite loop. The correct pair is: return both terms, break when the
*candidate set* is empty, and stop after N consecutive all-skipped batches with an `error!`. No data
effect.

### D4 — the batch limit bounds the writes and not the reads · **timed on a copy**

`memories.rs:2016-2021` loads **every** recall-eligible memory with `SELECT *` and the full embedded
id set, once per call, before applying `batch_limit`.

| | median |
|---|---:|
| `SELECT * FROM persona_memories WHERE tier != 'archive'` (5,158 rows) | **382.70 ms** |
| `SELECT memory_id FROM persona_memory_embedding_meta` (5,158 ids) | **9.21 ms** |
| per-batch fixed cost | **391.91 ms** |

At `batch_limit = 64` a cold fill of 5,158 memories is **81 batches → 31.7 s of pure re-scanning**
and **417,798 rows re-read**, to write 5,158. Converged, as today, each launch still pays **391.91 ms**
for one scan that embeds nothing — **40× the 9.6 ms that
[`data-normalization-migration`](./data-normalization-migration.md) D8 measures for the migration
chain's entire unconditional set.** It is off the startup critical path (a 90 s delay and a spawned
task), which is why nothing has surfaced it.

The `SELECT *` compounds it: the skip test is `already.contains(&m.id)` and runs *after* the whole
row is materialised, so the pass loads 5,158 memory bodies in order to discard 5,158 of them.

**A repair would have to be careful about:** `LIMIT` needs a stable order or a batch can re-read the
same rows; the natural form is
`SELECT * FROM persona_memories WHERE tier != 'archive' AND id NOT IN (SELECT memory_id FROM …)` —
except the two tables are in **different databases** (`main_pool` vs `UserDbPool`), which is
precisely why the join is done in memory and is the real reason the read is unbounded. The reachable
fix is to select `id` only for the diff and fetch full rows for the ≤64 survivors — one extra query,
and it takes the per-batch cost to roughly the 9.21 ms line. No data effect. See
[`second-database`](./second-database.md) for why the cross-database join is not available.

### D5 — `backfill_service_flow` has never run, and the surface that offers it says nothing either way · **replayed**

`commands/design/reviews.rs:1880-1978`. Replayed over all **113** rows of
`persona_design_reviews` with a `design_result`: **113 of 113 still carry `service_flow` as a legacy
`string[]`** — `needs_backfill` is true for every one of them, so the pass has either never been
invoked or has never succeeded. `related_tools` is at 0 pending only because **110 of 113 reviews
carry no `suggested_tools` at all**, which the pass counts as `skipped`.

The button exists (`AdminToolsDropdown.tsx:56-76`, *"Backfill Pipelines"* / *"Backfill Tools"*), and
`useGalleryActions.ts:218-230` is:

```ts
try { await backfillServiceFlow(); refresh(); }
catch (err) { logger.error('Failed to backfill service flow', { err }); }
```

`{ total, updated, skipped }` is computed by the backend, returned over IPC, and **discarded**. No
toast on success, no count, no "0 of 113". The user cannot tell a run that converted 113 reviews from
one that converted none.

**A repair would have to be careful about:** this one rewrites a JSON blob in place
(`update_review_design_result`), and 113 of 113 rows are candidates, so its first successful run is
its largest — the situation [`dry-run-preview`](./dry-run-preview.md) exists for. It is also a
**value**-changing pass, so P5 there applies: a count preview would show 113 for a correct
conversion and for one that mangles `suggested_connectors`. Sequence: render the receipt first, then
press the button.

### D6 — the one pass that knows which zero it is throws the distinction away at the boundary

`scheduler.rs:229` declares `skipped_duplicate`, `:247` increments it, `:318` logs it — and
`BackfillResult` (`:94-107`) has no field for it. So `slots_enqueued == 0` reaches
`useScheduleActions.ts:290-293`, which renders `toast_backfill_none` — *"No missed slots in that
window"* — for **both** "the window contained no fire times" and "every fire time in the window was
already enqueued by a previous click or by the auto path".

That is P5's failure in the one implementation that had already done the hard part. It is also the
cheapest fix in this document: one `pub skipped_duplicate: u32` field, one binding regen, one
`en.json` key.

**A repair would have to be careful about:** nothing on the data side — no rows change. `BackfillResult`
is a ts-rs export, so the new field needs
`cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings` and
the committed `src/lib/bindings/BackfillResult.ts`. The new locale key needs all 14 locales through
`translate-extract` → subagents → `translate-merge`.

### D7 — two registered, wrapped, documented backfills with zero consumers

`dev_tools_workspace_backfill_practice_ideas` → `backfillPracticeIdeas` (`workspaces.ts:350`) and
`dev_tools_backfill_qa_pr_review` → `backfillQaPrReview` (`devTools.ts:136-142`). Both are in
`invoke_handler`, both have typed API wrappers with doc comments, and a search across all **4,829**
`.ts`/`.tsx` files finds **zero** call sites outside `src/api/`.

The practice-ideas one is harmless — the same repo function also runs at boot (`lib.rs:878`), so the
door being unreachable costs nothing. The QA one is not: it is a *retrofit* (*"Stage 3d backfill…
adopted personas have no template→instance sync"*) with no other trigger at all. It has converged
anyway (**8 of 8** QA Guardians carry `uc_pr_review`, 9 subscriptions exist), which means either the
template started shipping it or somebody ran the command once from a console — and **nothing in the
system can say which**, because no backfill records that it ran.

**A repair would have to be careful about:** nothing; wiring or deleting a door with no callers has
no data effect. The judgement is which — and the honest answer for the QA one is that a retrofit
with no surface and no ledger should be deleted once its population is provably converged, not left
as a button nobody can find.

### D8 — a success toast on a function that returns 0 for four different reasons

`SetupPanel.tsx:98-100` renders `mirror_backfill_done` — *"Mirrored {count} notes to your vault."* —
as a **success** toast, from `obsidian_mirror_backfill_execution_knowledge`'s `u32`. That number is
the sum over 78 personas of `mirror_execution_knowledge_for_persona`, which returns `0` when the
mirror is disabled (`:419-420`), when no vault is configured (`:422-423`), when the list query fails
(`:425-430`), and when every `mirror_write_note` fails (`:448-450`). Population: **2,343
`execution_knowledge` rows across 78 personas.**

It is also the pass a user is most likely to run exactly once — it fires on the *transition* of the
`executionKnowledge` toggle to on — so "0" is both the most confusing outcome and the one with no
second chance.

**A repair would have to be careful about:** the toast is fired inside the config-save handler, and
the pass runs synchronously over 78 personas × up to 2,343 notes on the UI's IPC call. Widening the
receipt to `{ personas, notes_written, unchanged, failed }` is additive, but the same edit should
make the pass bounded or at least awaited off the config write — a fill this size behind a toggle is
the shape §2(c) exists to prevent.

### D9 — a backfill fired on mount, once per session, whose receipt is a swallowed promise

`useGalleryQuery.ts:268-272`:

```ts
if (!backfillRanRef.current) {
  backfillRanRef.current = true;
  backfillReviewCategories().catch(silentCatch("galleryQuery:backfillCategories"));
}
```

`{ total, updated }` is returned and dropped; the failure path is `silentCatch` (Sentry + console,
no toast). Live it is correct — **0 of 113** reviews have a NULL category, and the candidate query
costs **0.07 ms** — so it is a genuinely cheap, genuinely converged pass. What it cannot do is ever
tell anyone that it stopped working: a permission error, a schema change, or a regression in
`infer_template_category` would produce the same silence as today's success, indefinitely.

This is the operation-layer twin of `data-normalization-migration` D8's eleven unconditional
statements — same "cheap, converged, unobservable" shape, one layer up, on a pass with a real
receipt that nobody reads.

**A repair would have to be careful about:** nothing on the data side. But note the composition with
that path: it prescribes making a migration's guard a row-shape count so the step is
self-healing — which is exactly what this pass is at runtime, and it inherits the same blind spot.
The fix is not to remove the pass but to log the receipt at `info!` when `updated > 0` and at
`warn!` when the call *errors*, rather than routing both into the same silence.

### D10 — one claim, thirteen unclaimed passes — and the claim is a race detector, not a lock

`scheduler.rs:190-209` is the only claim on any backfill in the tree, and it is well chosen. But
`advance_schedule_pointer` is a **CAS that bumps `trigger_version` once** — there is no held lease
and nothing to release. So the error message *"backfill is already in progress for this trigger"*
describes a state the schema cannot represent: the loser lost a version race, which is *correlated*
with a concurrent pass and is not the same fact. A pass that dies after claiming leaves the version
bumped, no marker, and the next request claims cleanly.

That is defensible here — the destination dedup (`:235-254`) is the real safety, and the claim only
narrows the window in which two passes compute the same missing set. It is worth stating because the
comment reads like a lock and a future author copying it into a pass **without** a destination dedup
would get no protection at all.

The other thirteen take nothing. Eleven are safe by re-runnability; two are not obviously so —
`backfill_service_flow` and `backfill_related_tools` do read-modify-write on the same
`design_result` JSON blob, so two concurrent invocations (two windows, or a double click through a
`disabled` prop that only guards one of the two buttons) can lose one of the two edits.

**A repair would have to be careful about:** the right answer for the two review passes is almost
certainly not a claim — it is to stop doing read-modify-write on a JSON blob from two commands. See
[`transaction-boundary`](./transaction-boundary.md) and its `deferred-read-then-write` rule, which
counts the same shape elsewhere.

### D11 — cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"`backfill_use_cases_from_business_features` has 9 eligible labels it has never promoted."**
  **False, and it was my own measurement.** Collapsing `business_feature` labels **across all 14
  projects** gives 9 labels spanning ≥2 contexts. The function is scoped
  `list_contexts_by_project(pool, project_id)`. Replayed **per project**: 13 of 14 projects have
  **zero** labels on more than one context, and the fourteenth (`politicas`) has exactly **one**
  (*"app shell & navigation"*, 2 contexts). So `useUseCases.ts:141`'s comment — *"Zero is the
  common, correct answer"* — is **correct**, and the deviation I nearly shipped was an artifact of
  my own aggregation. See §12.4.
- **"The 22 `to_process` practice-adoption cells are an un-materialized backlog."** No. `dev_ideas`
  holds exactly **22** rows with `origin = 'workspace_practice'`; the ideas exist and `to_process`
  is the *waiting-on-the-project* state, not a "not yet filled" state. `backfill_practice_ideas`
  re-runs at every boot over those 22 pairs and creates 0. Converged.
- **"`backfill_related_tools` has a large pending population."** No — 0 pending, because **110 of
  113** reviews have an empty `suggested_tools` and are `skipped` by construction. The pass's
  denominator is 3, not 113, and its `{total}` field reports 113. A receipt whose denominator is the
  *scanned* set rather than the *eligible* set is a milder version of D2 and is worth noting rather
  than filing.
- **"`REEMBED_BATCH = 32` bounds the companion re-embed."** It does not — `embeddings.rs:186-188`
  documents it as *"How many nodes are processed between progress logs / connection releases"* and
  it is used only in `if (i + 1) % REEMBED_BATCH == 0` (`:338`). `reembed_missing` is unbounded. The
  convergence sweep found the same thing independently.
- **"`executions_fts` has drifted from `persona_executions`."** No: **2,188 / 2,188**, and
  `db/src/lib.rs` carries a test named for exactly this
  (`ensure_executions_fts_backfills_rows_the_index_never_saw`).

---

## 8. Gaps

1. **There is no shared receipt type, and that is upstream of D2, D3, D6 and D8.** Fourteen
   operations, **nine** distinct return shapes. A new backfill author has nothing to reach for, so
   the cheapest correct thing to type is `-> Result<u32, AppError>`. The primitive that would fix
   this is ~15 lines (`BackfillOutcome { found, handled, skipped, failed, capped, available }`) and
   the reason it does not exist is that no two of these fourteen were written in the same week by
   the same person.

2. **Nothing can be bounded in the query when the two halves live in different databases.** D4's
   unbounded read is not laziness: `persona_memories` is in `personas.db` and
   `persona_memory_embedding_meta` is in `personas_data.db`, so `WHERE id NOT IN (SELECT …)` is not
   expressible and the diff must happen in memory. The reachable form is a two-step (ids only, then
   rows) and it is strictly worse than what a single-database repo gets for free. Owned jointly with
   [`second-database`](./second-database.md).

3. **A boot-time pass cannot surface a completion failure to anyone.** `lib.rs`'s startup passes are
   `match … { Ok(n) if n > 0 => info!, Err(e) => warn!, _ => {} }`. There is no toast, no badge, no
   settings row and no queue. So P5's prescription — *render the zero in words* — has no surface at
   all for the four passes that run at boot or on a tick, and the only honest instrument for them is
   the standing invariant assertion of `helpers.rs:271`. Which brings us to:

4. **There is exactly one standing invariant assertion in the repo and no framework for a second.**
   `assert_credential_blob_invariant` is 22 lines and runs every boot. Nothing generalises it: there
   is no list of "conditions that should be zero", no place to register one, and no aggregation of
   their verdicts. The census cannot supply this — it counts source shapes, not runtime facts — and
   it is the instrument this leaf most wants for the nine converged passes, because **a converged
   backfill's only remaining risk is silently un-converging**.

5. **The census cannot express any of the leaf's four questions directly.** Boundedness, resumability
   and completion are relations between a loop, a query and a caller, not shapes that are present or
   absent in text. §9 gates the **receipt**, which is the one that is a shape — and it is a proxy,
   named as such.

6. **"Has this backfill ever run" is unanswerable in principle, and the corpus now has this from two
   directions.** `data-normalization-migration` Gap 5 argues a ledger would carry information the
   *data* cannot, because a converged row shape is indistinguishable from one that never needed the
   pass. This leaf adds the operation-layer half: **there is also no record of the pass, so
   "converged because it ran" and "converged because it was never needed" are indistinguishable on
   the code side too.** D7 is the live instance — 8 of 8 QA Guardians are wired and nobody can say
   whether the command did it. Both halves point at the same one-column fix and neither path
   recommends it, for the same reason: a ledger does not survive a restore and does not detect
   regression, whereas the candidate query does both. **The honest conclusion is that "did it run"
   is the wrong question and "is the population still filled" is the right one** — which is Gap 4,
   not a ledger.

7. **A bounded pass with no residue has no home for the residue.** `schedule_missed_runs` is a
   bespoke table for one pass. The other two bounded passes (`MAX_BACKFILL_USE_CASES`,
   `MAX_BYTES_PER_SCAN`) would each need their own, and the second solves it by making the watermark
   itself the residue — which only works when the population has a natural total order. For an
   unordered population there is no cheap answer in this schema.

---

## 9. The missing gate

### What the signal is a proxy for

**The condition:** a bulk fill over a pre-existing population cannot tell its caller that it
finished — *converged*, *not applicable*, *unavailable* and *failed* all arrive as the same value.
**The proxy, in this stack:** a function whose name says it fills a population and whose return type
is a **bare numerator** — `Result<()>`, `Result<u32>`, `Result<usize>`, `Result<bool>`. A receipt
with one term cannot carry a denominator, a residue or a cap flag, so the four states are
unrepresentable at the boundary regardless of what the loop body knows.

That proxy is **manifestation-layer** and does not travel. A repo whose passes return a rich result
type by convention, or whose jobs report through a queue, or which is dynamically typed, will wear
this defect differently — an adopting repo should re-derive a signal for *"a fill whose report
cannot express partial or failed"* against its own idiom, not port this regex.

### Rules I checked for overlap — at the SITE level, against the FINAL pattern

Of the **162** rules in `scripts/census/rules.json`, these are the ones whose territory could
plausibly contain a bulk fill. Each was run and its matched sites intersected with mine:

| rule | its roots | site overlap with my 5 |
| --- | --- | ---: |
| `unresumable-migration-step` (`boot-migration-step`) | `src-tauri`, 1 file / 15 | **0** — it keys on `already_applied: \|conn\| has_column(…)` followed by two `ddl_step` calls. `backfill_lab_tool_calls` is not inside a `run_step` at all; it is a bare function call at `:5771` |
| `default-contradicted-by-backfill` (`data-normalization-migration`) | `src-tauri`, 1 file / 3 | **0** — its three sites are `incremental.rs:2175`, `:2200`, `:6693`, all `ADD COLUMN … DEFAULT` pairs. Mine is `:7679`. Same file, disjoint lines, and the two rules answer different questions about it |
| `unreportable-bulk-outcome` (`bulk-command-variant`) | `src-tauri/src`, 10 files / 14 | **0** — it **requires** a caller-supplied `ids: Vec<…>` parameter. Every backfill here takes no id list by definition: the population is the point. Structurally disjoint, and the two are complements |
| `opaque-artifact-outcome` (`portable-export-bundle`) | `src-tauri`, 2 files / 5 | **0** — all five are `export_*` returning `bool` |
| `unswept-job-registry-read` (`long-running-job-progress`) | `src-tauri`, 6 / 9 | **0** — keys on a `*_JOBS` mutex. It does own `kb_reindex`'s territory, which is why `kb_reindex -> Result<String>` is *not* a violation here |
| `outcomeless-tick` (`stall-watchdog`) | `src-tauri`, 8 / 45 | **0** — `fn tick(…)`. The auto catch-up lives inside a tick and my rule does not reach it |
| `deferred-read-then-write` (`transaction-boundary`) | `src-tauri`, 10 / 12 | **0** — it owns D10's read-modify-write half, which I hand to it rather than gate |
| `discarded-guard-verdict` (`conditional-write`) | `src-tauri`, 7 / 11 | **0** — single-row `UPDATE … WHERE id = ?1 AND …`; a fill has no `id = ?` |
| `blind-identity-write` (`repository-crud-surface`) | `src-tauri/db/src/repos`, 35 / 82 | **0** — `-> Result<(), AppError>` functions doing `UPDATE … WHERE id = ?`. It would match a `Result<()>` fill in `repos/`, but the two `repos/` sites I match return `usize`/`u32`, and `incremental.rs` is outside its root |
| `unfenced-work-outcome-write` (`job-claim-and-lease`) | `src-tauri`, 6 / 11 | **0** — terminal-status `UPDATE`s |
| `unbounded-foreign-decode` (`external-source-ingestion`) | `src-tauri`, 9 / 21 | **0** — `serde_json::from_str(&body)` |
| `retention-delete-by-status-allowlist` (`retention-and-pruning`) | `src-tauri`, 3 / 3 | **0** — deletes, not fills |

**Zero site overlap with all twelve.** The closest neighbour by *concept* is
`unreportable-bulk-outcome`, and the composition is worth stating: **its condition is a plural
command that cannot report per-item outcomes for a set the caller named; mine is a pass that cannot
report population-level outcomes for a set it discovered itself.** A door satisfying its rule (return
a quantity) can still fail mine (a quantity of what, out of what, and did you stop early), and vice
versa. Two rules, adjacent, neither redundant.

### The rule

Validated standalone in a composer-private scratch registry
(`rules-bfm-scratch.json`, unique to this composer), then **re-extracted from this document and
re-run** — identical results both times: **5 matches / 5 files, 963 files walked; control 45 matches
/ 21 files; 1.3 s for rule + control.** The full registry was **not** run, per doctrine.

Two independent implementations agree exactly, entering the declaration from opposite ends: the
census engine's spanning regex, and a structural counter that brace-matches every `fn`,
paren-matches its argument list, and parses the return type as text. Both return the same **5**
`file:line` addresses and the same anchor of **45 across 21 files**.

```json
{
  "rules": [
    {
      "id": "unfinishable-backfill-receipt",
      "goldenPath": "docs/concepts/golden-paths/backfill-migration.md",
      "title": "A bulk-fill operation whose receipt is a bare numerator — the caller cannot separate 'converged' from 'not applicable' from 'unavailable' from 'every row failed', because all four arrive as the same number",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\bfn\\s+(?=[a-z0-9_]{0,60}(?:backfill|reembed|reindex))(?!spawn_)[a-z0-9_]+\\s*\\((?:[^(){}]|\\([^()]{0,120}\\)){0,600}?\\)\\s*->\\s*(?:Result\\s*<\\s*(?:\\(\\s*\\)|usize|u8|u16|u32|u64|i8|i16|i32|i64|bool)\\s*[,>]|\\(\\s*\\)\\s*\\{)",
        "flags": "g",
        "description": "A function whose name says it fills an existing population (backfill / reembed / reindex) and whose return type is a bare numerator -- unit, or a single unsigned/signed integer, or bool. A backfill's completion is a claim about a POPULATION: how many were found, how many were handled, how many were refused and why, and whether a bound was hit. One integer cannot carry that, so 'converged', 'nothing was applicable', 'the feature is unavailable on this build' and 'every row failed' all reach the caller as the same value -- and where the caller is a loop, the terminator (0) is the value a total outage produces. Measured: 4 of the 5 matches COMPUTE the missing terms inside the loop and discard them into a tracing:: macro before returning. The lookahead is load-bearing -- it requires the fill vocabulary anywhere in the identifier, which is what selects 45 declarations out of 14,992 `fn` declarations in the tree; the return-type clause is what selects 5 of those 45. `(?!spawn_)` excludes 2 fire-and-forget spawners, for which `()` is the correct and only possible return type -- a gate that fires on correct content is worse than no gate. Test declarations are excluded structurally rather than by pattern: all 17 test-scope matches in the anchor return implicit unit (no `->` at all) and the rule requires an explicit return type. Precision 5/5, every match opened and its live population replayed against a read-only copy of the operator's 347 MB personas.db: incremental.rs:7679 backfill_lab_tool_calls -> Result<(),_> (accumulates total_inserted, logs it, returns unit; its caller then drops the source columns one line later, so its completeness is now unverifiable -- 259 rows, source gone); memories.rs:2008 backfill_memory_embeddings -> Result<usize,_> (counts successes only, per-row errors warned and uncounted, and its caller at lib.rs:1092 breaks on Ok(0) -- so a total embedder outage is indistinguishable from convergence; live 5,158/5,158 embedded, so the defect is latent); dev_workspaces.rs:1453 backfill_practice_ideas -> Result<u32,_> (unreadable practices warned, uncounted; live 22/22 converged); commands/infrastructure/dev_workspaces.rs:544 (the IPC door for the same, with zero UI consumers); obsidian_brain/mod.rs:460 obsidian_mirror_backfill_execution_knowledge -> Result<u32,_> (sums 78 per-persona helpers each of which returns 0 for four different reasons, and SetupPanel.tsx:100 renders the sum as a SUCCESS toast). Compliant shapes in the same anchor: a struct (ReembedResult{embedded,skipped,available} brain.rs:1126; ReembedCounts embeddings.rs:178; KbIngestProgress kb_ingest.rs:213), a tuple carrying the denominator ((scanned,created) triggers.rs:1416), the values themselves (Vec<DevUseCase> dev_tools.rs:7674), or a json object naming total/updated/skipped (reviews.rs:1851,1880,1988). Fix = return a struct with found / handled / skipped / failed / capped, not a second backfill.",
        "$measured": "2026-08-17 @ 50d736f6c -- 963 .rs files walked. Two independent implementations agreed exactly on the 5 violating file:line addresses AND on the 45/21 anchor: the census engine's spanning regex, and a structural counter that brace-matches every `fn` declaration, paren-matches its argument list, and parses the return type as text rather than by a regex that could span into the next declaration. Anchor partition, hand-classified: 45 declarations across 21 files = 17 test-scope (all implicit-unit, all excluded by requiring an explicit return type) + 23 production-compliant + 5 violating. Widening the vocabulary with `materialize` was measured and declined: it adds 2 violating (materialize_practice_ideas, materialize_pending_for_practice -- both internals of backfill_practice_ideas, which the rule already selects, so they count one defect three times) and 2 compliant, and the word also names per-entity construction here (materialize_persona_initial_state, materialise_reference), which is not a population pass. Validated in a composer-private scratch registry, then re-extracted from the published document and re-run with identical numbers. Rule + control together: 1.3 s."
      },
      "baseline": { "files": 5, "matches": 5 },
      "floor": 900
    },
    {
      "id": "unfinishable-backfill-receipt-positive-control",
      "goldenPath": "docs/concepts/golden-paths/backfill-migration.md",
      "title": "CONTROL: every fill-named fn declaration — the anchor the rule partitions 5 of 45 from",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\bfn\\s+(?=[a-z0-9_]{0,60}(?:backfill|reembed|reindex))[a-z0-9_]+\\s*\\(",
        "flags": "g",
        "description": "The anchor: every declaration whose identifier carries the fill vocabulary -- 45 across 21 files. This is a PARTITIONING control, the strongest form the doctrine describes: it does not merely return a bigger number, it enumerates exactly the population the rule selects from, and the split was hand-classified into 17 test-scope + 23 production-compliant + 5 violating. A control at 45 against a rule at 5 is the discrimination evidence: the return-type clause is doing the selecting, and naming a function `backfill_*` is overwhelmingly normal and correct here -- 23 of the 28 production fills already return a struct, a tuple, the values, or a json object with a denominator. If this control ever collapses toward the rule's count, the fill vocabulary has changed and the rule is measuring a population that no longer exists."
      },
      "floor": 900
    }
  ]
}
```

**How it fails loudly if its own precondition is absent.** The census engine supplies this:
`floor: 900` fails the run if fewer than 900 files are walked ("the matcher is broken, not the
codebase clean"); a rule matching zero files anywhere fails structurally; a rise fails; and a **drop
without `--update` fails**, which is the relevant direction here since the intended end state is 0.
The **positive control adds the precondition the engine cannot**: if the anchor collapses, the
vocabulary has moved and the rule is guarding an empty population — the failure mode a rule with no
control cannot detect.

**End of life.** This rule is designed to reach zero — five signature widenings, none of which
changes a row. When it does, **delete it**; do not baseline it at 0, because the census cannot
express "must be zero" and a 0-baselined rule fails structurally.

### Gates I measured and refused, with numbers

| candidate | violating | compliant | why refused |
| ---: | ---: | ---: | --- |
| a bulk fill with **no bound** (no `LIMIT`, no batch/cap parameter, no cap constant) | **11** | 3 | **79% violating.** This is the leaf's largest true finding and the wrong instrument for it — a gate that fires on four fifths of the population is a re-description of the codebase, not a ratchet, and most of the eleven operate on populations of 39, 78 and 113 rows where a bound would be ceremony. It is D-shaped, not gate-shaped, and §2(c) carries it |
| a pass whose per-row `Err` arm is a bare `tracing::warn!` with no counter | **7** | 4 | 64% violating, and **the compliant four are not reliably better** — `backfill_review_categories` derives failures as `total - updated`, which is correct and invisible to any matcher. A gate that cannot see the compliant form is a gate that will be gamed by not changing anything |
| a guard of the form `SELECT COUNT(*) FROM <destination> > 0 → return` (the latch) | **1** | n/a | **Precision 1/1 and it is the leaf's sharpest single defect — but N=1.** A one-site rule ratchets nothing: the only movement it can ever report is the fix, which the reviewer will already have seen. Carried as D1, and the durable protection is the completeness gate at `helpers.rs:189` plus the boot invariant, not a count. The tree-wide scan for the shape found exactly 2 hits, the other being `pragma_foreign_key_check` in `fk_hygiene.rs:310`, which is not a backfill |
| a `#[tauri::command]` backfill with no `src/` consumer | **2** | 6 | **Not expressible in the census.** It is a relation between a Rust attribute and the absence of a string across 4,829 TypeScript files — the doctrine's "the census cannot assert an ABSENCE", exactly. Same class as an orphan binding. Carried as D7 |
| a bounded pass with no durable residue | 2 | 1 | **Not expressible.** "Does a table exist to hold what this pass did not reach" is a schema question about a concept, not a shape in source. Carried as Gap 7 |
| a destroy-the-source not gated on a completeness re-read | **1** | 1 | N=1 on each side. The population is two sites in the whole tree and they are already both named in §6 and §7 D1. Publishing a rule over a two-member population manufactures the appearance of enforcement |

### The second instrument — a standing invariant, not a script

Two of the six refusals above (the latch; the missing residue) and Gap 4 are the same shape: a
**runtime** fact about whether a population is still filled, which no source-text count can reach.
The corpus's usual answer is "write a check script". **Here it is not, because the repo already
built the right primitive and pointed it at one condition.**

`db/src/migrations/helpers.rs:271-292` `assert_credential_blob_invariant` runs on every boot, does
one `SELECT` for a condition that must be empty, and `tracing::error!`s the offending ids without
crashing. Its doc comment states the design trade explicitly: loud, forensic, never fatal, because
*"a transient inconsistency during a future migration may be acceptable"*.

**The instrument is a second and third caller of that shape, not a new mechanism.** Concretely, one
`assert_backfill_invariants(conn)` beside it, with one `SELECT` per converged population and the
`file:line` of the pass that fills it in the comment:

- `persona_memories WHERE tier != 'archive'` minus `persona_memory_embedding_meta` — must be 0 once
  the drain has run; today **0 of 5,158**, and the *only* thing that would announce a regression.
- source triggers with no `_auto_for_trigger` listener — today **0 of 39**.
- `persona_design_reviews` whose `service_flow` is still `string[]` — today **113 of 113**, so this
  arm would fire on the first boot after it is written, which is the point (D5).
- and a **precondition** copying the existing one's spirit: `assert!(populations_checked > 0)`, so
  "somebody emptied the list" is a failure rather than a silent pass. That line is the fail-loud
  requirement; without it the whole instrument is a no-op that looks like a green check, which is
  the hazard `ci.yml` is a museum of.

**Then stop at three.** Do not build a registry, a trait or a macro for it first: the convergence
sweep found that of four independent sibling codebases, **one** has any standing completeness check
at all and **none** has a general one, so a generalised framework here would be a matcher nobody
points at a fourth population. The two-instance version already puts this repo ahead of the cohort.

**And the test this leaf most wants, which is a test and not a script.** A Rust test beside the
scheduler's six cap tests: `a_capped_backfill_reports_capped_and_leaves_a_residue` — run
`backfill_schedule` over a window containing `CAP + 1` slots on a fixture, assert
`result.capped == true`, `result.slots_enqueued == CAP`, and that a second call with a start at
`slot_times.last()` enqueues the remainder and returns `capped == false`. Its load-bearing line is
the precondition: `assert!(slots_in_window > CAP, "the fixture window is too small — this test is
measuring nothing")`. Today that test would pass, which is the correct result and also the exact
result a fixture with two slots in it returns.

---

## 10. Convergence

Swept against all five sibling checkouts — `personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
`ascent` — all of which exist and all of which were opened. The spine labels this leaf **`diverged`**.
**The label holds**, and it is worth reporting as loudly as a failure: there is no clause on which
even three of four independent siblings agree on a *practice*, and the two clauses with near-perfect
agreement are agreements on an **omission**.

**Cohort.** Personas-cloud contributes only a silence (see below), leaving an **effective independent
cohort of 4**. Lineage was checked and **nothing here is a port**: brainiac's `DEFAULT_BATCH = 64`
(`crates/brainiac-pipeline/src/reembed.rs:29`) is a real SQL `LIMIT`, while this repo's
`REEMBED_BATCH = 32` (`embeddings.rs:188`) is a logging cadence — different name, different value,
different meaning, no shared prose, no shared error strings, and different receipt types
(`ReembedStats{version_id, memories, canonicals, batches}` vs
`ReembedResult{embedded, skipped, available}`). Vibeman's `BATCH_SIZE = 1000` and ascent's
`RETENTION_DEFAULT_BATCH_SIZE = 500` share nothing with either.

**Converged — treat as physics.**

- **The candidate query is the resume point, and the two siblings with real backfill machinery
  reached for it independently.** `brainiac/crates/brainiac-pipeline/src/reembed.rs:16-19` states it
  as design — *"the 'missing embedding' query IS the resume point, and each batch autocommits (no
  wrapping transaction), so an interrupted run simply continues where it stopped"* — and
  `ascent/src/lib/retention.ts:108-113` arrives at the same thing for a destructive pass by
  re-selecting what remains with a stateless deterministic rotation. This repo does it twelve times
  without a document. **§2(a)/(b) is doctrine, not house convention.**
- **Idempotence is universally solved and the mechanism differs.** All four independent siblings are
  re-runnable; the *first* reach differs — brainiac queries the destination
  (`memories.rs:241-244` `NOT EXISTS`, then `ON CONFLICT … DO UPDATE`), vibeman consults a ledger
  (`migration.utils.ts:292`), personas-web relies on a unique constraint
  (`scripts/setup-voting-db.sql:58-70`), ascent on deletes being naturally idempotent. **Nobody
  reaches for `INSERT OR IGNORE` first**, which is what this repo's chain does.

**Where Personas is behind, and it is the strongest external result in the sweep.**

- **An incomplete fill must be enforceable against a *reader*, not merely reported to an operator —
  and only `brainiac` does it (1 of 4).** The triple is: a version row **born incomplete**
  (`migrations/…`, `memories.rs:159-175`), `is_active` flipped **only after both backfill loops
  drain** (`reembed.rs:156-163`), and **both serve doors refuse** while it is false —
  `memories.rs:204-209` bails with *"is not fully backfilled — run `reembed` to completion before
  serving this model, or revert the embedder config"*, wired at `http.rs:61-69` and `mcp.rs:290-298`.
  Ascent signals partial completion to a *monitor* (`api/cron/purge/route.ts` returns **207** on a
  degraded run, with the comment *"A DEGRADED run must NOT report a green 200"*) — good, and one
  audience short. Vibeman writes `sync_metadata.sync_status` (`sync.ts:29-36`) that nothing gates
  on. **This repo has no equivalent at all**, and D3 is exactly the case it would have caught: an
  embedder outage would leave the fill incomplete and recall would keep serving degraded results
  without a word. If this path takes one thing from the cohort, it is *born-incomplete → drain →
  flip → the door refuses*.
- **The receipt.** Ascent's `PurgeSummary` (`retention.ts:225-239`) carries per-entity counts, an
  `errors[]`, `stoppedEarly` **and** `orgsRemaining` — the only receipt in six repos from which a
  caller can compute how much work is left. `BackfillResult` is second and has no remainder term.

**Convergence on the disease — reported as such, per the doctrine.** Three omissions are
near-universal across an independent cohort of 4, which is evidence the situation is real **and
evidence against an answer existing to adopt**:

1. **No bulk pass anywhere takes a claim or lock (0 of 5).** Both siblings that own a working
   CAS/lease primitive — brainiac (`sweeps.rs:240-263`, `queue.rs:141-164` `FOR UPDATE SKIP LOCKED`,
   `migrations/0012_dim_agnostic_hnsw.sql:46` `pg_advisory_xact_lock`) and ascent (`claimRescan`,
   `org-watch.ts:209-217`) — **deliberately left it off the bulk pass**, substituting
   re-runnability. Personas is the only repo in the cohort with a claim on a fill at all
   (`scheduler.rs:190`), and §7 D10 explains why it is narrower than it reads. **This is a decision
   to make explicitly, not a gap to close by imitation.**
2. **No destroy-the-source anywhere is gated on a proven-complete check (0 of 5).** Every drop or
   prune follows the fill in sequence. The best in cohort (`vibeman/src/lib/supabase/sync.ts:146-165`)
   achieves safety by making the prune **non-fatal**, not by proving the fill drained. **This repo
   is the only one in six with a gated destroy** (`helpers.rs:189`) — and it also contains the
   ungated one (D1). Personas holds both the best and the worst answer in the cohort, in one file.
3. **No receipt anywhere distinguishes "0 because already done" from "0 because nothing matched"
   (0 of 5).** Brainiac's `ReembedStats` dodges the question by being designed to drain rather than
   cap. This is P1 and the fleet has converged on not answering it.

**Silences, reported as silences.**

- **`personas-cloud`: complete silence.** Zero repo-wide matches for `backfill` / `reembed` /
  `reindex`. Its schema evolution is 10 pure-DDL `ALTER TABLE … ADD COLUMN … DEFAULT` steps
  (`packages/orchestrator/src/db.ts:41-121`) behind an integer watermark. **It has never had to fill
  a pre-existing population, because every new column ships with a `DEFAULT`** — which is precisely
  the shape `data-normalization-migration`'s census rule counts as a defect here. The two leaves
  disagree about that repo and both are right: a constant `DEFAULT` removes the *backfill* and
  creates the *drift*.
- **`personas-web`: near-silence.** One backfill in the repo, six lines
  (`scripts/setup-voting-db.sql:53-70`) — no batch, no ledger, no receipt, and correct, because it
  is guarded on the constraint it is about to install.

**Where Personas leads, reportably.** The **gated destroy-the-source** (`helpers.rs:189-262`) plus
its **standing boot invariant** (`:271-292`) is unmatched in the cohort — 0 of 4 siblings has
either. And **six unit tests that assert a backfill's cap behaviour by name**
(`background.rs:3428-3608`) have no counterpart anywhere in the five.

> **Provenance.** This section is a subagent sweep of the five checkouts, spot-verified against this
> repo before publication. Sibling `file:line` references are from the sweep and were not re-opened
> here; treat them as leads with an address, not first-hand reads. **One of its claims about *this*
> repo was incomplete and is corrected in §12.2** — it measured `reembed_missing` as unbounded
> (true) and did not see `backfill_memory_embeddings`, which is chunked.

---

## 12. Corrections to the brief

The brief is the orchestrator's hypothesis. Six of its claims were tested; two did not survive, one
was right for a reason the brief did not give, and one of my own measurements had to be withdrawn
before it became a fabricated deviation.

**12.1 — `sides: "server"` holds, and it is the third upholding. But the clause that decides the
leaf is a string in `en.json`.** The inventory, the exemplar, the five census-rule sites, the control
and the floor are all server-side Rust, and the mechanism is structural in the way the doctrine asks
for when a label survives: **a backfill's population lives in the database and the client never sees
it**, so no client-side artifact can bound, resume or verify one. That is the same shape as the two
upholdings for `"client"` (*the server never sees the DOM*), inverted.

**The caveat is P5, and it is not decoration.** Eight of the fourteen operations are user-pressable,
and the difference between the best and the worst of them is not in Rust — it is whether the surface
that starts the pass explains its zero. The single best artifact for that clause is a locale string
(`plugins.dev_tools.uc_backfill_none`) and the single worst is a success toast
(`SetupPanel.tsx:99`). So `"server"` is right about where the *answers* live and would have hidden
the leaf's most user-visible defect if it had been used to scope the brief. **Report it as upheld
and note that `twoSided` would have been more accurate than either.**

**12.2 — the brief's "the chain does ~10 ms of row-normalization on every launch and changes 0 rows"
is correct and led to something better.** Replaying it one layer up: the *operation* layer does
**391.91 ms** on every launch and changes 0 rows — 40× the chain's entire unconditional set, in one
statement, from the pass that has already converged (D4). `data-normalization-migration` §12.6
concluded *"cost was the wrong instrument for this leaf"*, and that conclusion is correct **for the
chain and wrong one layer up**: at the operation layer, cost found the unbounded read that no
correctness reading of the same function would have.

**And a correction to that published sibling, earned here.** Its §10 states: *"**Boundedness and
resumability have exactly one converged implementation** … `brainiac/crates/brainiac-pipeline/src/reembed.rs`
… That is Gap 2's answer, built. **Nothing in Personas is chunked.**"* The final sentence is false.
`backfill_memory_embeddings(main, vec, embedder, batch_limit)` (`db/src/repos/core/memories.rs:2008`)
plus its driver (`src/lib.rs:1084-1102`) is a chunked, tunable, resumable, gentle drain whose own
comment states the design — *"loops until no un-embedded, recall-eligible memory remains — each
batch is diffed against the vec table, so restarts/repeat runs are safe"* — and it has fully
converged (5,158 / 5,158). Two reasons a migrations-scoped sweep would miss it: it lives in
`db/src/repos/`, not `db/src/migrations/`, and it is behind `#[cfg(feature = "ml")]`, so it does not
compile in the `desktop` (lite) profile most sessions build. **The same document's Gap 2 — *"Nothing
in *the chain* is chunked"* — is correctly scoped and stands.** The difference between the two
sentences is one prepositional phrase, and the unscoped one has been carried forward as fact.

The convergence sweep run for *this* path reproduced the sibling's error independently, from the
other side: it measured `reembed_missing` (unbounded, `REEMBED_BATCH` a logging cadence) and
concluded Personas has nothing chunked. **Two sweeps, months apart, agreeing on a false negative
because they both found the same one of two implementations** — which is the doctrine's *"fixing
every instance of a defect is not the same as covering every place that needs the behaviour"*, in
its measurement form: searching for a shape finds the module that has it, never the one that has a
better one under a different name.

**12.3 — "26 `status`/`enabled` drift rows where the naive repair flattens `paused`/`errored` into
`active`." The drift is exact; the flattening is latent, not live — and the brief carried a claim
that had already been corrected once.** Replayed: **26** rows are `enabled = 0 AND status = 'active'`,
325 are `enabled = 1 AND status = 'active'`, and `status NOT IN ('active','disabled')` returns
**0** — no live row holds `paused` or `errored`. [`dry-run-preview`](./dry-run-preview.md) §7 D6
measured and published this correction on 2026-08-17, and the brief for this leaf restated the
uncorrected form the same day. **A corrected claim propagates only through the document that carries
it, and briefs are assembled from the corpus's *findings*, not from its corrections.** The argument
survives and is stronger stated correctly, per that path: a value-flattening repair is invisible to a
count preview *and* invisible to the data until the day someone pauses a trigger. Not this leaf's
territory either way; cited, not re-litigated.

**12.4 — a correction to my own measurement, caught by re-running it the way the code runs.** I
measured **9** `business_feature` labels spanning ≥2 contexts and was one paragraph from filing
"`backfill_use_cases_from_business_features` has 9 eligible labels it has never promoted" as a
deviation — with a quotable comment at `useUseCases.ts:141` (*"Zero is the common, correct answer"*)
apparently contradicted by the data. The function is scoped by `project_id`. Replayed per project:
**13 of 14 projects have zero** such labels and `politicas` has **one**. The 9 was an artifact of
collapsing labels across 14 projects that never share a use-case namespace.

It is the more dangerous kind of error because **it agreed with the document's thesis** — a backfill
with a pending population nobody has run is exactly what this leaf is about, so the number looked
like confirmation. The doctrine's rule applies verbatim: *an oracle result that confirms your
argument gets the same verification as one that contradicts it.* The narrower lesson is about
grouping: **a `GROUP BY` that omits the scope key the code scopes by produces a false POSITIVE that
no amount of hand-verifying the rows will find**, because every row in it is real.

**12.5 — "41 credential-shaped values in a `tool_steps` JSON column, inside string values, which
neither JSON walker handles." Correct, already owned, and deliberately not re-derived here.**
`data-normalization-migration` D9 sizes it (41 raw / 22 surviving classification / 33,484 elements,
two independent implementations agreeing) and `secret-and-pii-redaction` §3/§6 owns the mechanism.
What this leaf adds is one sentence about the *operation*, which neither says: a value-based rewrite
of 1,921 JSON arrays has **no bound, no residue and no claim available to it** — it is the single
largest unbounded fill anyone has proposed in this repo, it targets a column two other owners also
want to rewrite, and per §2 it should be scoped to the 11 named executions, which is a repair and not
a backfill at all.

**12.6 — "349 of 351 `next_trigger_at` NULL, 11 operationally live; a repair must not simply stamp
them." Exact, and the operational half is not this leaf's.** Confirmed at `50d736f6c`: **349 of 351**
NULL; **11** are `enabled = 1 AND status = 'active'` with no next fire time (10 `schedule`, 1
`polling`). This leaf's contribution is narrow and worth recording: a repair here is a **bounded**
fill by necessity, because `get_due` returns everything `<= now` ordered ascending, so the bound is
not a cost decision but a correctness one — and per P3 it therefore owes a residue row naming the
schedules it did not arm. That is the only place in this document where the bound and the semantics
of the target are the same decision. The predicate, the `compute_next_trigger_at` call and the
invalid-timezone carve-out are `data-normalization-migration` D3 and `scheduled-trigger-firing`, both
already published.

Two further facts surfaced while replaying it, neither mine to litigate: **2** triggers have a
non-NULL `next_trigger_at` of `2026-05-29`, `enabled = 1`, `status = 'active'` — due for **80 days**
— and the newest `persona_executions` row is `2026-06-26`. And **0 of 351** triggers carry
`max_backfill` in their config, which is why the automatic catch-up path in §0 has never had a
candidate.

**12.7 — the brief asked "whether any backfill has ever been *verified* to have completed." The
answer is no, and it is worth stating precisely what kind of no.** Nine of twelve replayed passes
have **converged** — measured, today, by re-running their own candidate predicates. Not one of them
was *verified* by anything in the system: no ledger, no assertion, no flag, no door that refuses, no
test that runs against real data. The single standing verification in the repo
(`assert_credential_blob_invariant`) belongs to a credential migration and covers **0** of the
fourteen operations here. And the one pass whose completeness a human might most want to check —
`backfill_lab_tool_calls` — is the one whose input was deleted one statement later. **"Converged" is
a measurement anyone can take from outside; "verified" is a property the system holds about itself,
and this system holds it about exactly one condition, which is not a backfill.**
