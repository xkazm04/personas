> Context: tauri:db/repos [2/6]
> Total: 7
> Critical: 0  High: 0  Medium: 5  Low: 2

## 1. `connectors::update` lets a custom connector shadow a builtin by name
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src-tauri/src/db/repos/resources/connectors.rs:157-248
- **Scenario**: `create` takes an IMMEDIATE tx and rejects a name already in use (lines 106-128), with an explicit comment: "Reject a name already in use so a custom connector can't shadow a builtin and flip its classification/readiness." But `update` only checks that the new `name` is non-empty (lines 163-167) — it never re-checks uniqueness. A user creates connector `foo`, then updates its `name` to `github` (a seeded builtin). Now two rows share the name, and `get_by_name("github")` (line 31-50) returns an arbitrary single row, so downstream resolution of services/healthcheck/readiness may bind the custom definition instead of the builtin.
- **Root cause**: The uniqueness invariant is enforced only on the create path; the update path was never brought under the same guard. `name` has no UNIQUE constraint (create's comment notes this), so nothing at the DB level backstops it.
- **Impact**: security/integrity — the exact "shadow a builtin and flip its classification/readiness" outcome the create guard exists to prevent, reachable via rename.
- **Fix sketch**: In `update`, when `input.name` is Some and differs from the current name, run the same IMMEDIATE-tx `EXISTS(... WHERE name = ? AND id <> ?)` check before applying the UPDATE; reject with the same "already exists" validation error.

## 2. Rotation single-active-policy invariant is not atomic (race)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src-tauri/src/db/repos/resources/rotation.rs:110-147, 149-195
- **Scenario**: `create_policy` calls `disable_policies_for_credential` (line 127) and then, on a *separate* pooled connection, INSERTs the new enabled policy (line 137). There is no transaction spanning the two. Two concurrent `create_policy` (or `update_policy` enabling) calls for the same `credential_id` can interleave: both run the disable (each seeing the other not-yet-inserted), then both INSERT `enabled=1`, leaving two active policies — violating the "single-active-policy invariant" the code comments claim to enforce. `get_due_policies` then fires the credential's rotation twice per window.
- **Root cause**: Read/disable + write done across two autocommit statements on independent connections (DbPool hands out separate connections), exactly the pattern other repos here fix with `TransactionBehavior::Immediate` (see connectors.rs:112, research_lab.rs:202).
- **Impact**: duplicate/over-firing rotations, inconsistent policy state; a security control (credential rotation) whose stated invariant silently breaks under concurrency.
- **Fix sketch**: Wrap the disable + insert (and the enable branch of `update_policy`) in one `Immediate` transaction on a single connection so the disable and the enabling write are one serialized step.

## 3. `research_lab` list queries silently drop rows that fail to map
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/db/repos/research_lab.rs:38, 142, 327, 432, 494, 552, 674
- **Scenario**: Every `list_*` (`list_projects`, `list_sources`, `list_hypotheses`, `list_experiments`, `list_findings`, `list_reports`, `list_experiment_runs`) ends with `Ok(rows.filter_map(|r| r.ok()).collect())`. If a mapper errors on any row (a NULL in a column the model reads as non-optional, a schema drift, an enum/`get` type mismatch), that row is dropped with no log and no error — the finding/source/report just vanishes from the UI while the call returns `Ok`. The user sees a short list, not a failure, and cannot tell data is missing. (Same pattern in db_schema.rs:24/183 and shared_events.rs:63/180/201/228.)
- **Root cause**: `filter_map(|r| r.ok())` swallows per-row `rusqlite::Error`s instead of surfacing or logging them — unlike audit_log.rs which routes through `collect_rows` and knowledge.rs which `warn!`s on dropped rows.
- **Impact**: data-integrity/UX — silent partial data loss in the research surface; masks schema/model drift that should be loud.
- **Fix sketch**: Route these through the existing `repos::utils::collect_rows` helper (which logs drops) as audit_log.rs does, or `.collect::<Result<Vec<_>,_>>().map_err(AppError::Database)` where a bad row should fail the call.

## 4. `evolution::complete_cycle` writes two rows non-atomically
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/db/repos/lab/evolution.rs:294-342
- **Scenario**: The cycle row is marked completed/promoted (first `conn.execute`, lines 309-327) and the policy stats (`total_cycles`, `total_promotions`, `last_cycle_at`) are bumped in a second, separate autocommit `conn.execute` (lines 329-337). A crash or DB error between the two commits leaves a cycle showing `completed`/`promoted` while `total_cycles`/`total_promotions` never increment — the promotion counter under-counts and `last_cycle_at` isn't advanced, so `should_evolve` may immediately re-fire.
- **Root cause**: Multi-row invariant update done as two independent autocommit statements rather than one transaction.
- **Impact**: minor stat drift / possible early re-trigger; not data loss but a consistency gap.
- **Fix sketch**: Open a transaction on the connection and run both UPDATEs inside it, committing once.

## 5. `research_lab` duplicates row-mapping and burns a second connection on create
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/db/repos/research_lab.rs:120-168, 330-352, 435-456, 497-520, 555-576
- **Scenario**: A `row_to_source` helper exists (lines 147-168) but `list_sources` (lines 120-141) inlines the identical 18-field mapping closure instead of using it. Worse, hypotheses/experiments/findings/reports have *no* helper: each `create_*` re-reads the just-inserted row on a **second pooled connection** (`let conn2 = pool.get()?`, e.g. lines 340, 445, 508, 565) and inlines the same field-for-field mapping that its sibling `list_*` also inlines — so each entity's mapping is written twice and every create holds two pool connections at once. Sibling repos in this same context (recipes.rs, test_runs.rs, external_api_keys.rs) already use `INSERT ... RETURNING *` with a single mapper and one connection.
- **Root cause**: Mapper helpers were only extracted for `ResearchSource`, and the create paths predate the `RETURNING`-on-one-connection pattern adopted elsewhere.
- **Impact**: maintainability (5 mapping closures duplicated; a column add must be edited in ~10 places) plus needless pool pressure (2 connections per create).
- **Fix sketch**: Add `row_to_hypothesis/_experiment/_finding/_report` helpers, use them in both `list_*` and `create_*`, and switch creates to `INSERT ... RETURNING *` on the single `conn` (drop `conn2`); point `list_sources` at the existing `row_to_source`.

## 6. LIKE-escaping logic duplicated across repos
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/db/repos/resources/team_memories.rs:17-23, src-tauri/src/db/repos/core/settings.rs:130-133
- **Scenario**: `team_memories::escape_like` and `settings::get_by_prefix` both hand-roll the identical three-step LIKE metacharacter escape (`\` then `%` then `_`, order-sensitive) with the same correctness comment. The QueryBuilder also has `where_like_escape_any`. The escaping rule lives in at least three places; a fix or bug in the ordering must be replicated by hand.
- **Root cause**: No single shared `escape_like` utility; each caller re-implemented it.
- **Impact**: maintainability — divergence risk on a security-relevant (injection-adjacent) helper.
- **Fix sketch**: Hoist one `escape_like(&str) -> String` into a shared db util (or reuse the QueryBuilder helper) and call it from both sites.

## 7. `knowledge::get_summary` duplicates the count-row closure across two arms
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/db/repos/execution/knowledge.rs:490-513
- **Scenario**: The persona-filtered and unfiltered branches of `get_summary` each contain a byte-for-byte copy of the same six-column tuple-mapping closure (lines 492-501 vs 503-512), differing only in whether `params![pid]` or `[]` is bound — the same optional-persona split the file already abstracts for row selects via `query_with_optional_persona` (line 451).
- **Root cause**: The scalar count query wasn't given the same optional-persona helper treatment as the list queries below it.
- **Impact**: maintainability — a change to the aggregate shape must be edited in two identical closures.
- **Fix sketch**: Extract the closure to a named `fn` (or a small helper mirroring `query_with_optional_persona`) and call it from both arms.
