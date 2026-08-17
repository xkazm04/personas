# Golden path — a surface where a query string is typed and executed

> Situation node: `integrations-security/external-and-host-surfaces/sql-console` ·
> [situation spine](../situation-spine.md) · recurrence **8** · risk **HIGH** · sides **client** ·
> `twoSided: true` · convergence **converged** — **tested and REFUTED, see §12.1** ·
> dimensions: **ui · function · security · performance**
> Composed 2026-08-17 against `master` @ `f432a4ef3`.
>
> **Sweep.** Every path in the tree from a caller-authored statement string to a `prepare` / `execute`
> was enumerated and classified — **8 doors**, of which **5 can be driven by a model**. Read in full:
> `src-tauri/src/engine/db_query.rs` (3,797 lines), `src-tauri/src/commands/credentials/db_schema.rs`,
> `.../nl_query.rs`, `.../query_debug.rs`, `src-tauri/src/companion/jobs/connector_use.rs`,
> `.../operations_views.rs`, `src-tauri/src/companion/connectors.rs`,
> `src-tauri/src/commands/companion/approvals/approval_autopilot.rs`, the whole of
> `src/features/vault/sub_databases/` (41 files), `src/stores/slices/vault/databaseSlice.ts`,
> `src/api/vault/database/dbSchema.ts`. The census engine walks **5,792** files under
> `src-tauri` + `src` at `.rs`/`.ts`/`.tsx`.
>
> **Measured by executing, not reading.**
> 1. **All four statement classifiers were transliterated to JS and executed.** The port was validated
>    first by replaying **23 assertions lifted from `db_query.rs`'s own `#[cfg(test)]` module** —
>    23/23 pass — plus the 3 CTE assertions replayed against the TypeScript mirror, which ships with
>    **zero tests of its own**. Then **47 hostile statements** were run through all four doors and the
>    survivors executed against a **fresh throwaway SQLite file**. §0 and §6 are those results.
> 2. **`PRAGMA query_only` and `SQLITE_OPEN_READONLY` were measured against 19 statements each, on a
>    fresh database per configuration** (the first run polluted itself and is reported as a correction
>    in §12.7). That experiment is what §2 prescribes and what §7.A is measured against.
> 3. **Read-only copies of both live SQLite databases** (`personas.db` 347 MB / 241 tables,
>    `personas_data.db` 17.5 MB / 68 tables, copied 2026-08-17 with their `-wal`) queried for what this
>    console has actually carried. **The copies were deleted when the measurement finished.**
> 4. The §9 rule was built and run in a **private scratch registry with a filename unique to this
>    composer**, counted a second time by an independent tokenising scanner (**which disagreed, and the
>    disagreement was a real defect in the rule — §9**), exercised through **all seven** of the runner's
>    fail-loud modes, then re-extracted from this document and re-run. **The full registry was NOT run.**
>
> **Nothing was written to any live database.** No write statement was executed against `personas.db`
> or `personas_data.db`; neither file was opened for write. No request was sent to the running app.
> **No secret value appears below** — column names, row counts and byte totals only.
>
> ### Sibling boundaries, settled in prose
>
> [**second-transport-exposure**](./second-transport-exposure.md) owns *who can address this door*.
> This path owns *what the door does with the string once it is through*. §7.E is written to that seam.
> [**untrusted-definition-validation**](./untrusted-definition-validation.md) owns *a configuration
> object that the app will later execute*; a SQL statement **is** that object with the parse step
> removed, and its P2 (validate by reconstruction) is the clause this leaf cannot obey — §8.1.
> [**external-source-ingestion**](./external-source-ingestion.md) owns *ingested text becoming model
> input*; this path begins where that one ends — the model has already been influenced, and the
> question is what it can reach. [**dynamic-filter-query**](./dynamic-filter-query.md) owns SQL the
> *app* assembles from typed filters. [**informed-consent-gate**](./informed-consent-gate.md) owns the
> shape of a confirmation; §7.F is a defect in this path's use of it.
> [**autonomy-gating**](./autonomy-gating.md) owns whether an unattended loop was allowed to start;
> §0 is what happens when it was.
>
> The **Deviations** section is a fix backlog.

---

## 0. The headline, before anything else

**This app has one database that a query string can reach, and eight doors onto it. The best-guarded
door is the one a human uses. The weakest door is the one a language model uses, it can `DROP TABLE`,
and on this machine the human approval that was supposed to stand in front of it has been switched
off — deliberately, in a different file, for a different reason, six days before the guard that cites
it was last read.**

The chain, all of it measured:

```
connectors.rs:214-224   execute_select  requires_approval: true
   comment, verbatim:   "Left auto-firing, a prompt-injection payload in any ingested content
                         (a fetched URL, a drive file, another connector's output) could make
                         Athena emit `execute_select "select * from ..."` that runs silently and
                         leaks PII into the chat/episode log. Requiring approval puts a human in
                         front of the raw query."

dispatcher.rs:1852      if cap.requires_approval { insert_approval(...) }        <- files a card

approval_autopilot.rs:10-49  "That list is GONE. … under autonomous mode EVERY proposed action
                              now fires. … `use_connector` write capabilities … become externally-
                              visible actions with no human in between."       (2026-08-10)

approval_autopilot.rs:256    execute_approval_action(...)  ->  Ok(true)         <- no card, no click

live app_settings:           companion_autonomous_mode = "true"
```

`execute_mutation` sits eight lines below `execute_select` in the same array
(`connectors.rs:226-231`) and its whole guard is:

```rust
let allowed_starts = ["create","insert","update","delete","drop","alter","replace"];   // :1453-1454
if !allowed_starts.iter().any(|v| lower.starts_with(v)) { return Err(...) }             // :1455
if !is_single_statement(trimmed) { return Err(...) }                                    // :1460
let changed = conn.execute(trimmed, [])?;                                               // :1466
```

That is the entire distance between a model-emitted string and `conn.execute` against
`personas_data.db` — which holds **1,779 conversation turns, 1,554 nodes, 211 provenance rows, 90
distilled facts, 35 procedural memories and the vector knowledge base**, and which is the only
database in the app with **zero encrypted-value columns** (`personas.db` has 5). The verb list
contains `drop`. Nothing bounds the row count, the wall clock, or the blast radius. There is no
cancellation. There is no audit row.

**And the door a human uses is genuinely good, which is what makes the asymmetry the finding.** The
console (`db_schema.rs:216`) is `#[requires(privileged)]`, classifies with a comment-stripping
tokenizer rather than a prefix test, refuses stacked statements in safe mode, denies
`ATTACH`/`DETACH`/`VACUUM INTO` with a tokenizer that survives separator tricks, caps at 500 rows and
8 MB, deadlines at 60 s, sets a 10 s busy timeout, and interrupts the running statement on cancel
while guaranteeing the pooled connection is returned. Two authors solved the same problem twice and
the one who solved it well never saw the other.

### The measured surface

| Door | Who authors the SQL | Reaches | Classifier | Row cap | Timeout | Cancel | Redaction | Audit |
|---|---|---|---|---|---|---|---|---|
| `execute_db_query` ← ConsoleTab | **human** | `personas_data.db` + 5 REST connectors | tokenizer ×4 | 500 | 60 s | **wired, no button (§7.G)** | none | none (local) |
| `execute_db_query` ← QueryEditorPane | **human** | same | same | 500 | 60 s | yes | none | none (local) |
| `execute_db_query` ← ChatTab | **model writes, human clicks Run** | same | same | 500 | 60 s | **no handle passed** | none | none (local) |
| `start_query_debug` | **model writes, app auto-runs, ×3 retries** | same | `is_mutation` only | 5 shown | none | job token | **yes — 21 column names** | **yes, per attempt** |
| `use_connector personas_database execute_select` | **model** | `personas_data.db` | `starts_with("select")` | 200 | **none** | **none** | none | approval row |
| `use_connector personas_database execute_mutation` | **model** | `personas_data.db` | `starts_with` × 7 verbs incl. `drop` | n/a | **none** | **none** | n/a | approval row |
| `use_connector operations_database query_operations` | **model** | **`personas.db`** (the credential DB) | **none needed — 7 named views** | clamped | none | none | none | approval row |
| `classify_db_query` (IPC) | — | — | the authoritative classifier | — | — | — | — | — |

**The last row is the whole leaf in one line.** `classify_db_query` (`db_schema.rs:164`) exposes the
server's real classifier over IPC, is registered in `generate_handler!` (`lib.rs:2323`), is listed in
`PRIVILEGED_COMMANDS` (`ipc_auth.rs:227`), and has a typed frontend wrapper at
`src/api/vault/database/dbSchema.ts:64`. **It has zero call sites.** The client re-implements the
classifier by hand in `safeModeUtils.ts` — whose docstring says *"Mirrors the Rust `is_mutation()`
logic"* — and the two mirrors **disagree on 2 of 47 statements**, because the TypeScript copy's
mutation-verb regex omits `DROP` and `ALTER`. The mechanical link was built, shipped, and not used.

### What this install has actually run

Read-only copies, 2026-08-17:

- **`db_saved_queries`: 0 rows. `db_schema_tables`: 0 rows.** The console's own persistent surfaces
  have never been written.
- **`credential_audit_log`: 9,803 rows. Rows whose `detail` names this path: 2, both
  `db_query:introspect_tables`. Zero `db_query:execute`.** No query has ever been run against an
  external database credential.
- **`companion_approval`: 120 rows across 21 distinct actions. `use_connector` appears 0 times.** The
  model lane has never fired.
- So **every defect below is provable from source and none is observed.** Same posture
  `untrusted-definition-validation` recorded and worth restating: **in this repo, guard quality is
  anti-correlated with usage.** The path with 23 tests, four bounds and a deny-list has run zero
  times; the path with a `starts_with` has also run zero times, and is the one that will fire first
  when autonomy does something.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its warrant, so an adopting repo can tell physics from local calibration. No
file path, primitive name or count appears below this line until the head ends.

> **P1 — physics, and the whole subject.** *A query string is not an argument; it is a program, and
> accepting one is a decision to run programs an author you have not met will write.* Every other
> input a boundary receives is data the program interprets. This one **is** the program. The
> question at the door is therefore never "is this input valid" but "what is this program allowed
> to be", and those have different answers and different techniques.
>
> **P2 — physics, and the clause that replaces everything below it.** *Do not classify the statement;
> run it as a principal the engine will not let write.* A classifier is a second, worse
> implementation of a decision the database engine already makes correctly and cannot be talked out
> of. Every keyword list is a guess about a grammar you did not write, maintained by someone who
> will not read the next release notes. Open a read-only handle, or begin a read-only transaction,
> or connect as a role without write grants — then a misclassification costs an error message
> instead of a table.
>
> **P3 — physics, and the reason P2 is a floor and not a ceiling.** *Read-only stops writes. It does
> not stop reach.* A read-only principal can still attach a second database, name a table you did
> not intend to expose, and return every row of it. The two questions — *may this program change
> state* and *what may this program see* — are independent, and the engine only answers the first
> for you. The second needs an explicit statement of scope, and it is the one that leaks.
>
> **P4 — physics, and the most reinvented error in the subject.** *A leading-token test is not a
> classifier.* Comments precede the verb; whitespace and comments can sit between a verb and its
> object; a read-leading construct can wrap a write; a string literal can contain any keyword; a
> prefix match on a verb also matches every longer word beginning with it. Each of these is a
> separate bug and each has been shipped independently. If you must classify, tokenize — and then
> assume you got it wrong anyway, which is P2.
>
> **P5 — physics.** *One database must have one classifier, and the classifier must be the only thing
> that produces the value the executor accepts.* Two doors onto one store will grow two vocabularies,
> and the second one will be written by whoever needed a door in a hurry — so it will be the shorter
> list, on the newer door, with the fewer tests. Make the executor's parameter a type only the
> classifier can construct and the second vocabulary becomes unspellable rather than merely
> discouraged.
>
> **P6 — physics.** *A confirmation is a control only if the human can see the whole statement they
> are confirming.* A dialog that shows a prefix is not asking a question; it is collecting a
> keystroke. Whatever the display budget is, the statement is the payload — truncate the chrome
> instead.
>
> **P7 — physics, and where a console differs from every other model surface.** *A model that can
> write a query has the union of every read the schema permits, in one call, with no per-item
> decision.* Tool surfaces are usually bounded by their verb list; a query surface is bounded by the
> schema. If any table in that schema holds something the model must not see, a query door is not a
> tool — it is the absence of a boundary, and no argument validation reaches it.
>
> **P8 — physics, and the corollary of P7.** *A capability whose safety argument is "a human
> approves it" is only as strong as the weakest mode in which approval can be skipped.* Autonomy
> settings, retry loops, batch appliers and auto-fire policies are all approval-skipping modes, and
> they are written in different files by different people than the capability. Write the dependency
> down at the capability, and re-read it whenever the approval machinery changes.
>
> **P9 — ergonomics, and the one that makes a console usable rather than merely safe.** *Bound the
> result on four independent axes — rows, bytes, wall-clock, and a way for the human to stop it —
> because they fail in four different ways.* A row cap does not save you from wide rows; a byte cap
> does not save you from a slow scan that returns nothing; a deadline does not help the person
> watching a spinner they chose to start; and a cancel handle that no surface renders is a bound
> that does not exist.
>
> **P10 — security.** *Results are the exfiltration channel, not the statement.* Whatever redaction
> the rest of the product applies to a value — masking, scrubbing, truncation — a query console
> returns that column verbatim, because the grid was written to display cells and knows nothing
> about what they mean. Decide the redaction policy at the result, once, and apply it on every door
> that returns rows.
>
> **P11 — ergonomics.** *Every query door needs a ledger row, and the local door is the one that will
> not have it.* Doors onto a remote service get a log line for free because something else already
> logs the call; the door onto your own store has no such accident. That is exactly backwards from
> where the risk is.
>
> **Scale condition.** P1, P2 and P4 are correctness on the first statement. P5 bites at the second
> door — which arrives the first time an agent needs one. P6 and P9 bite the first time a human runs
> something they regret. P3, P7 and P10 bite the first time the schema contains something private.
> P8 bites the first time somebody adds an autonomy toggle. P11 bites when you first ask whether any
> of this has ever run.

### Warrant evidence — the five siblings, censused independently

`personas-web` (Next.js), `brainiac` (Rust workspace + Next.js console), `personas-cloud`
(TS orchestrator + Python facade), `vibeman` (Next.js + Tauri), `ascent` (Next.js). **All five
reachable; no silence to report on availability.**

**The result inverts the spine's label and is the most important thing in this section: 1 of 5
siblings has a SQL-console-shaped surface at all.**

| Repo | Console surface | Caller-authored SQL executed | Classifier | Second gate on writes | Row / byte / timeout / cancel | Redaction | Model can supply the string | Audit row |
|---|---:|---:|---|---|---|---|---|---|
| `personas-web` | **0** | 0 | — | — | — | — | no | — |
| `brainiac` | **0** | 0 | — | — | — | yes (at ingest) | no | — |
| `personas-cloud` | **0** | 0 | — | — | — | — | no | — |
| `vibeman` | **2 endpoints** | 1 | 2-verb prefix + 10-verb deny regex | **client-side only** | **0 / 0 / 0 / 0** | **none** | **yes, by design** | **no** |
| `ascent` | **0** | 0 | — | — | — | — | no | — |
| **Personas** | **8 doors** | 8 | 10 predicates, 3 files | safe mode + confirm banner | **500 / 8 MB / 60 s / partial** | none | **yes, 5 of 8** | 2 of 8 |

- **P1 and P2 converge as an AVOIDANCE, 4 of 5, across three languages.** Four siblings answered
  "how do you build a query console" by not building one: every table name is a compile-time
  literal, reached through a typed door — `.from("<literal>")` (`personas-web`, ~13 sites),
  Prisma tagged templates (`ascent`, 6 raw sites, all parameterized by construction), literal
  `db.prepare("…")` inside migrations (`personas-cloud`, ~20 sites), and **948 `sqlx` sites in
  `brainiac` of which zero accept a caller-authored string**. `brainiac`'s MCP surface is the direct
  counter-model to this repo's: **19 tools, every one typed, none takes `sql`.** That is the
  strongest possible statement of P1 — the fleet's majority position is that the query string is the
  thing to eliminate, not the thing to guard.
- **P2's positive form has an independent, working implementation in the fleet, and it is the best
  idea in the sweep.** `brainiac/crates/brainiac-store/src/lib.rs:101-135` — `scoped_tx()` issues
  `set_config('app.org_id', …, true)` transaction-locally and lets Postgres RLS decide; the worker's
  elevated read is an explicit, auditable escape that *still* excludes private rows
  (`migrations/0002_worker_read.sql`). **Nobody classifies a statement; the engine enforces the
  principal.** This repo cannot use RLS — SQLite has none — but the same move is available and
  measured in §2: a read-only handle. **Reached independently, in a different engine, for a
  different reason. Physics.**
- **P4 converges as a FAILURE, 2 of 2 among the repos that have a console, and the two are
  textually independent.** `vibeman/src/app/api/nl-query/route.ts:116-131` classifies with
  `sqlNormalized.startsWith('SELECT') || startsWith('WITH')` plus a deny regex of ten verbs.
  **Independence check passed:** it shares no keyword list, no constant, no comment and no error
  string with this repo's; its deny list omits `PRAGMA`, `VACUUM`, `REINDEX` and `ANALYZE` entirely,
  which this repo's covers, while this repo's `execute_select` uses the prefix form `vibeman`'s
  authorization path uses. Two teams, two languages, one shape. **Physics as a defect.**
- **P5 converges as a defect and `vibeman` supplies the sharper case.** It has **two** copies of the
  same two-keyword predicate with no shared constant — `nl-query/route.ts:117` (an *authorization*
  decision) and `src/lib/db/queryPatternCollector.ts:87` (a *telemetry* label). They agree today by
  coincidence and are owned by different concerns. Same shape as this repo's Rust/TypeScript pair,
  but *within one language*, which removes the usual excuse.
- **P6, P9 and P11 have NO external warrant and must be reported as silence.** No sibling has a
  confirmation step for a mutating statement (`vibeman`'s is client-side only, at
  `SchemaBrowserView.tsx:698-706`, with the server accepting a bare `DELETE`); no sibling bounds a
  console result on any axis (`vibeman`: 0/0/0/0, and its "100 rows" limit exists **only as prompt
  rule #4 at `route.ts:62`**, enforced by nothing); no sibling writes a per-query ledger row.
  **Personas is ahead of the entire fleet on P9** — it is the only codebase in six with a row cap, a
  response-byte ceiling, a wall-clock deadline and a cancellation handle on the same door. Treat P6,
  P9 and P11 as strongly-reasoned house convention, not doctrine.
- **P7 and P10 converge as a defect with the fleet's worst single item.** `vibeman`'s
  `src/lib/db/schemaMap.ts:46-50` excludes **3** tables from what it describes to the model
  (`_migrations_applied`, `sqlite_sequence`, `sqlite_stat1`), so `cli_transcript_mirror` —
  **raw Claude Code session transcripts**, migration `229_cli_transcript_mirror.ts:26-36` — is
  advertised to the LLM, reachable by generated SQL, returned unredacted, uncapped and unlogged,
  from an **unauthenticated** HTTP route (no `src/middleware.ts` exists). And the counter-example is
  in the same sweep: `brainiac/crates/brainiac-core/src/redact.rs:1-45` is a recall-biased secret
  scrubber written *because* a UAT run served a pasted credential verbatim to an agent. **The answer
  to P10 exists in the fleet and neither console uses it.**
- **P8 has no external warrant.** No sibling has an autonomy toggle that can dissolve an approval, so
  none can exhibit the failure. Report as untested; this repo's instance (§0) is a single case,
  however sharp.
- **What the oracle refused to support.** The spine's `convergence: converged` is wrong in both
  directions at once — see §12.1. There is no converged *practice* here to adopt, because four of
  six codebases converged on **not having the problem**.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "let the user run a query against their database" · "add a SQL tab" · "we need a DB browser"
- "the assistant should be able to look that up itself" · "give the agent a `sql` argument"
- "generate the SQL from the question and just run it"
- "expose the raw query for debugging" · "add a schema explorer with a result grid"
- "it's read-only, it's just a SELECT"
- **If you are about to write a function whose parameter is named `sql`, `query`, `query_text`,
  `statement` or `stmt` and whose type is a string — you are in this situation.**
- **If you are about to write `.starts_with("SELECT")`, `startsWith('SELECT')`, or any list of SQL
  verbs used as a comparison operand rather than as SQL — you are in this situation and §2's first
  sentence is about you.**
- If you are about to add an MCP tool, agent capability or chain step whose argument is a query
  string, you are in this situation and P7 is about you.

**Not this path:** SQL the *app* assembles from typed filter values is
[dynamic-filter-query](./dynamic-filter-query.md). Escaping a value into a `LIKE` pattern is that
path too. Who may reach the door at all is
[second-transport-exposure](./second-transport-exposure.md) and
[ipc-command-authorization](./ipc-command-authorization.md). Whether a schema change is safe to apply
is [destructive-schema-change](./destructive-schema-change.md). Validating a stored *configuration*
that the app will later execute is [untrusted-definition-validation](./untrusted-definition-validation.md);
this leaf is the degenerate case where the configuration is already the program and there is nothing
to reconstruct.

---

## 2. The one way

**Take a principal that cannot write instead of classifying a statement that might.** In safe mode,
check out a **read-only** handle — a second pool opened with `OpenFlags::SQLITE_OPEN_READ_ONLY`, or
at minimum `PRAGMA query_only = ON` set on the same line that already sets `busy_timeout`
(`db_query.rs:2475`) — and hand the statement to that; measured on a fresh database, a read-only
handle refuses `DELETE`, `DROP`, `INSERT`, `UPDATE`, `CREATE TABLE`, `CREATE TRIGGER`, `VACUUM`,
`ANALYZE`, a `journal_mode` change and a write to an attached file, **including the ones the
classifier gets wrong**, while every read still works (§6). Keep the classifier — but demote it from
*the* control to *the thing that picks which handle to take*, so a misclassification costs an error
message rather than a table. **`PRAGMA query_only` alone is not sufficient and the measurement says
so: `PRAGMA query_only = OFF` is itself accepted, so the guard is self-disabling** — the read-only
*handle* is the form that holds, because a flag on the connection is not addressable from SQL.
**Keep the `ATTACH`/`DETACH` deny-list regardless**, because a read-only handle still attaches and
still *reads* a second database file — verified — and that file is the one holding the encrypted
credentials. **Then write exactly one classifier and make it the only producer of the executor's
argument**: `fn execute(stmt: ReadStatement)` and `fn execute(stmt: MutatingStatement)`, both
newtypes with private fields and a single `classify()` constructor, so a second door physically
cannot invent a shorter verb list — this repo has **ten** hand-written SQL predicates across three
files and the shortest one is on the newest door. **Never classify by prefix**: strip comments, then
take the leading token, then check the token — `db_query.rs:251` does this and its sibling
`connector_use.rs:1390` does not, and the difference is measurable on `selecting from x`. **Bound the
result on all four axes and render the stop button** — rows, bytes, a wall-clock deadline and a
cancel handle the surface actually calls; the console has all four and the primary tab renders no
button for the fourth. **Redact at the result, once, on every door** — the AI-debug lane already owns
a 21-name sensitive-column list and a value truncator (`query_debug.rs:43-73`), and the human console
and the model-driven chat lane return the same rows unredacted. **Write one ledger row per executed
statement, including the local one** — the local lane is the only door with no log at all, because
its remote siblings get an audit row as a side effect of decrypting a credential. **And if a model
can supply the string, its reachable set is the schema, not the tool description**: give it named,
parameterized views (`operations_views.rs:34-47` is the exemplar and it is in this repo) rather than
a `sql` argument, and if you must give it a `sql` argument, state at the capability which approval
mode it depends on — because an autonomy toggle in another file will dissolve it without ever
appearing in the blast radius anyone drew.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
| --- | --- |
| **`src-tauri/src/companion/jobs/operations_views.rs:27` — `run_view(pool, args)`** | **The one site to copy, and the answer to P7.** A model asking an operational question names a **view** (`executions_recent`, `cost_by_persona_day`, `messages_inbox`, `reviews_pending`, `incidents`, `goals_active`, `kpis_latest`), never a statement. Params are clamped by `arg_i64(args, key, default, min, max)` (`:52`), the SQL is literal, the result is a markdown table. It reads the **credential** database and is the only model-facing door onto it — and it is safe precisely because there is no string to guard. `connectors.rs:239-247` marks it `requires_approval: false` and is right to. |
| **`src-tauri/src/engine/db_query.rs:251` — `extract_first_keyword`** | The correct classification primitive: strips leading `--` and `/* */` comments in a loop, then takes the leading ASCII-alphabetic run, and returns a **sentinel** `__UNCLOSED_COMMENT__` so callers can apply a fail-safe rather than guessing. This is what makes `ATTACH/**/DATABASE` and `ATTACH\tDATABASE` fail closed where a `starts_with("ATTACH ")` did not — the comment at `:2584-2586` records that regression. |
| **`db_query.rs:298` — `strip_sql_literals`** · **`:328` — `has_multiple_statements`** · **`:340` — `cte_body_has_mutation`** | Literal-aware statement analysis. `strip_sql_literals` replaces each `'…'`/`"…"` with a single space and **drops the remainder on an unterminated quote — the safe direction for a classifier**, and executed proof that it matters: `SELECT ';' AS sep FROM t;` is correctly one statement and `WITH t AS (SELECT … WHERE msg = 'DELETE failed')` is correctly a read. `cte_body_has_mutation` closes the read-leading-write hole (`WITH d AS (DELETE … RETURNING *) SELECT * FROM d`) that a leading-keyword classifier reports as a read. |
| **`db_query.rs:2464` — `run_local_sqlite_guarded`** | **The bounded-execution reference, and it is better than anything in the five sibling repos.** Sets `busy_timeout(10s)` so lock contention fails fast instead of eating the query budget; takes an interrupt handle; runs the blocking work on a `spawn_blocking` task that **owns** the pooled connection so it is returned on every path; and on cancel or the 60 s deadline it fires the interrupt **and awaits the task to completion** rather than detaching it. Copy this whole function. |
| **`db_query.rs:89` — `inject_row_limit`** · **`:56` — `ensure_response_within_ceiling`** · **`:27` `MAX_ROWS=500`** · **`:48` `MAX_RESPONSE_BYTES=8 MiB`** | The two bounds a pass-through connector needs, with the reasoning written down: the post-parse row cap cannot help when the driver streams the whole result into a `String` first, so the byte ceiling exists, and the injected `LIMIT` is `MAX_ROWS + 1` because the parsers detect truncation via `rows.len() > MAX_ROWS`. `inject_row_limit` is **append-only and declines to act** on anything it is not confident about — multi-statement, non-read, already-limited, or containing a `--` that would swallow the clause. Declining is the right default for a rewriter. |
| **`db_query.rs:144` — `sanitize_error(msg, fields)`** | Error-path redaction: every non-empty credential field value replaced by `[REDACTED:<key>]` **regardless of length** — the test at `:3769-3789` states why a short-value exemption was refused — plus connection-string, Bearer and Basic patterns. Every failure on this path goes through `finalize_result` (`:186`) which calls it. |
| **`src-tauri/src/commands/credentials/query_debug.rs:79` — `sanitize_query_result`** + **`:43` `SENSITIVE_COLUMNS`** (21 names) + **`:124` `truncate_value`** | **Result-side redaction, already written, wired to exactly one of the eight doors.** Column-name match → `[REDACTED]`, everything else truncated to 200 chars at a UTF-8 boundary, rows capped at 5 with `rows_omitted` reported honestly. This is P10's answer and §7.D is that it is not shared. |
| **`src/features/vault/sub_databases/hooks/useQuerySafeMode.ts:21`** | The client half of the two-sided contract, and the **context-drift guard is the part to copy**: a pending mutation is pinned to the `runQuery` identity that was live when it was stashed, cleared in an effect when that identity changes, **and re-checked synchronously inside `confirmMutation`** (`:55-59`) for the click-race the effect would lose. So a confirm dialog cannot be accepted against a connection that changed underneath it. |
| **`src/features/vault/sub_databases/QueryResultTable.tsx:22`** | The result grid, and the dimension nobody else in the fleet satisfies: `@tanstack/react-virtual` row virtualization, cell previews truncated to 60 chars (`:31`), sticky header, and an honest `results_truncated` notice driven by the backend's `truncated` flag (`:198`). 500 rows × N columns renders without a jank budget. |
| **`src/features/vault/sub_databases/introspectionQueries.ts:1-8`** | **A deletion, recorded as a primitive.** The frontend used to build introspection SQL by interpolation; the header says those builders *"were a weaker second implementation and have been deleted"* in favour of the parameterized backend commands. This is P5 applied and then written down so it cannot be quietly re-added. What remains is classification plus a clipboard helper — and even that quotes identifiers per dialect (`:137-152`) with the bug it fixed named in the comment. |
| **`db_query.rs:637` — `connector_capability(service_type)`** | Honest capability advertising: `FullSql` / `SelectSubset` / `KeyValue` / `IntrospectionOnly`, kept "immediately next to the `execute_query` dispatch above so the advertised capability and the actual execution behavior can never silently drift" (`:634-636`). The editor renders a note from it, so the console never implies more than the connector supports. |

**Do not exist — this path names them:**

- **A read-only connection pool.** `init_user_db` (`db/src/lib.rs:492`) builds one `max_size(8)`
  read-write pool. There is no read-only handle anywhere in the tree, so the classifier has nothing
  to fall back to. §2's central prescription needs one `Pool::builder()` and one `OpenFlags`.
- **A type that distinguishes a classified statement from a string.** `query_text: &str` at every
  hop. This is the fourth path to ask for a provenance newtype
  ([structured-output-extraction](./structured-output-extraction.md) §8,
  [model-composed-ui](./model-composed-ui.md) §8,
  [untrusted-definition-validation](./untrusted-definition-validation.md) §3,
  [external-source-ingestion](./external-source-ingestion.md) §4) — **and this is the first one where
  the newtype would be trivial**, because the classifier already exists and has three consumers.
- **A shared result redactor.** `sanitize_query_result` is private to `query_debug.rs`.
- **Any audit row for a local-database query.** `log_decrypt` is called only after the
  `personas_database` early return (`db_query.rs:548-552` returns before `:555`), so the door onto
  the app's own store is the one door with no ledger.
- **A caller for `classify_db_query`.** Zero, against a hand-written mirror with a different verb
  list.
- **Any test for `validate_ddl_only`, for the `ATTACH`/`DETACH`/`VACUUM INTO` deny-list, or for
  `isMutationQuery`.** Measured: `db_query.rs`'s test module holds **4** assertions touching
  `is_mutation`/`is_sqlite_read` (all CTE) and **zero** touching the other two; `safeModeUtils.ts`
  has no test file.

---

## 4. Steps

1. **Ask whether the query string is necessary at all.** Four of five sibling codebases answered no
   and shipped typed doors instead (`brainiac`'s 19 typed MCP tools; this repo's own
   `operations_views`). A named view with clamped parameters is not a lesser console — it is the
   thing a console is usually a substitute for. Only proceed if a human genuinely needs to write
   arbitrary SQL.
2. **Decide the principal before the parser.** Safe mode → a read-only handle. Write mode → the
   normal handle, reached only after an explicit human confirmation. This is one branch at the
   connection checkout, not a branch in the classifier.
3. **Write exactly one classifier, and tokenize.** Strip leading comments in a loop, take the leading
   token, look the token up. Return a sentinel for an unterminated block comment and fail safe on
   it. Strip string literals before scanning a body for verbs.
4. **Make the classifier the only producer of the executor's argument** — see the type question
   below. Do not hand a second door a `&str` and a code review.
5. **Deny what read-only does not cover**, explicitly and by token, not by `starts_with`:
   `ATTACH`, `DETACH`, `VACUUM INTO`, and any `PRAGMA` that mutates connection or file state
   (`journal_mode`, `writable_schema`, `foreign_keys`, `synchronous`, `query_only`). Measured, all of
   those survive both a read-only handle and `query_only = ON` (§6).
6. **Bound on four axes and wire the fourth to a control.** Row cap, byte ceiling on any body you
   parse into memory, wall-clock deadline, and a cancel handle — then check that a surface renders
   the button. Prefer interrupting the running statement over dropping the future, and await the
   blocking task so the pooled connection comes back.
7. **Redact at the result, on every door**, from one list. If a column-name heuristic is what you
   have, use it everywhere rather than on the door somebody happened to be worried about.
8. **Show the human the entire statement** in the confirmation, and make the container scroll rather
   than truncating the payload.
9. **Write one ledger row per executed statement** — statement fingerprint (length, verb class,
   target), never the text if the text can carry data; outcome; duration; who asked. Then query the
   table and confirm the door has ever carried anything.
10. **If a model can reach the door, state at the capability which approval mode it depends on**, and
    grep the approval machinery for modes that skip it. "Requires approval" is a claim about a
    different file.
11. **And then stop.** Who may address the door is
    [second-transport-exposure](./second-transport-exposure.md); the tier of the command is
    [ipc-command-authorization](./ipc-command-authorization.md); building SQL from typed filters is
    [dynamic-filter-query](./dynamic-filter-query.md); whether a schema migration is safe is
    [destructive-schema-change](./destructive-schema-change.md).

### Can the type make the wrong call impossible? — asked before §9

**Yes, twice, and the two answers are at different layers. Ship both.**

**(a) The statement newtype — `ReadStatement` / `MutatingStatement` with private fields and
`classify()` as the only constructor.**

- **Q1 (a required prop carries only what it encodes).** It encodes *that the one classifier ran*,
  not that the classifier is right. That is the honest limit and it is why (b) exists — the point of
  (a) is that there is exactly one classifier to be wrong.
- **Q2 (requiredness ≠ closedness).** Not applicable; this is provenance, not optionality.
- **Q3 (a type nobody constructs constrains nothing).** Executors that would take it: **3** —
  `execute_local_sqlite_conn` (`db_query.rs:2525`), `personas_db_execute_select`
  (`connector_use.rs:1401`), `personas_db_execute_mutation` (`:1466`). Classification sites that
  would become the constructor: **10**. Small, enumerable, every one reachable in a single edit.
  **Passes.**
- **Q4 (a type anyone can construct authenticates nothing).** This is the qualification that decides
  the shape. A tuple struct with a public field — `ReadStatement(String)` — is a comment;
  `ReadStatement(pub(crate) String)` in the same module as a second door is a comment. It must have a
  **private** field and live in the module that owns `classify()`. That is the whole difference
  between this working and not.
- **Q5 (withholding beats requiring).** The qualification that fits, and it is exactly the
  three-doors experiment the doctrine already banked: today `conn.execute(trimmed, [])` is handed
  back the dangerous freedom at 3 sites and 2 of the 3 invented a shorter verb list. Withholding the
  `&str` overload removes the freedom rather than documenting it.
- **Q6 (withhold the dangerous freedom, not the answer).** The freedom to remove is "supply an
  unclassified string", not "supply a statement". A caller with a legitimate mutation still gets
  one — by asking `classify()` for it and handling the `MutatingStatement` arm.
- **Q7 (relaxing a requirement is inert when the caller supplies the bad value voluntarily).**
  Applies to a *second* type change and is the reason it is worth making: `execute_query(pool, cid,
  text, udb, allow_mutation: bool, ddl_only: bool)` has **two adjacent `bool` parameters at a
  security boundary**, and transposing them compiles. Replace them with
  `enum QueryMode { SafeRead, ConfirmedWrite, SchemaSetup }`. This is not cosmetic:
  **measured, 1 of the 4 boolean combinations is a dead configuration.** With
  `ddl_only = true, allow_mutation = false`, `validate_ddl_only` admits `CREATE TABLE` / `CREATE
  INDEX` / `CREATE VIEW` / `CREATE TRIGGER` / `BEGIN` / `COMMIT` / `ROLLBACK` / `SAVEPOINT` and then
  `is_mutation` rejects **every one of them** — the only input that executes is the empty string. An
  enum makes that state unspellable, and nobody has ever noticed it because `ddl_only` has zero true
  call sites (§7.C).

**(b) The read-only handle — the type answer at the layer below.** `run_local_sqlite_guarded` takes a
`&UserDbPool`. Give it a `ReadOnlyUserDbPool` newtype over a second pool opened with
`OpenFlags::SQLITE_OPEN_READ_ONLY`, and safe mode literally cannot write, *whatever the classifier
concluded*. Held against Q4: a newtype over a pool whose connections carry the read-only flag is not
forgeable by constructing the newtype — the property lives in the OS handle, not in the Rust type,
which is the rare case where Q4's objection does not apply.

**Where neither type reaches — and this is the doctrine's first hazard, at home.**

The doctrine names *"inside a SQL string literal"* as the first place types cannot reach, earned by
an `INSERT` naming a column that never existed. **This leaf is that hazard's home and the answer is
worse than the doctrine's:** there, the string was written by a developer and a test would have
caught it; here the string is written by *the user or a model at runtime*, so there is nothing to
compile and nothing to test. `conn.prepare(trimmed)` accepts any bytes. **No type reaches inside the
statement, ever, by construction** — which is precisely why §2 leads with the principal rather than
the parser. Three further limits, all measured:

1. **Across the process boundary to a REST connector.** Neon and PlanetScale receive the payload
   verbatim over HTTP; whatever the remote engine does with it is unreachable from any Rust type,
   and in **write mode the multi-statement guard is deliberately skipped** (`db_query.rs:535`), so
   `SELECT 1; DROP TABLE users` is forwarded as one body. That is intended — the user confirmed —
   but the confirmation banner showed them a **200-character prefix** (§7.F).
2. **Through `PRAGMA`.** Every classifier in the tree treats `PRAGMA` as a read. Executed: `PRAGMA
   journal_mode = DELETE`, `PRAGMA foreign_keys = OFF`, `PRAGMA synchronous = OFF` and `PRAGMA
   writable_schema = ON` all run in **safe mode** on a pooled connection, and three of the four
   change state that outlives the query — `journal_mode` in the database file, the rest on a
   connection returned to a pool of 8 that the rest of the app then draws from. No parameter type
   sees this; it is inside the statement.
3. **Into the approval decision.** Whether `execute_mutation` needs a human is a `bool` on a
   `ConnectorCapability` in one file, read by a dispatcher in a second, and overridden by an
   autonomy setting in a third. No signature spans those three.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Classifying the statement instead of choosing the principal** | Every keyword list is a guess about a grammar you did not write. Measured: a read-only handle refuses 9 of 19 hostile statements the classifier has to get right by hand, including the two the classifier gets wrong. |
| **`starts_with("select")` as a read check** | `connector_use.rs:1390`. Executed: `selecting from x` and `SELECTX 1` both pass it. Harmless in SQLite (they fail at prepare) and harmless in the *console*, whose tokenizer classifies both as mutations — which is the point: **the same repo has both forms, and the weaker one is on the door a model drives.** |
| **A prefix test against the raw string, with no comment stripping** | `validate_ddl_only` (`db_query.rs:410-449`) and both `connector_use` guards. `db_query.rs:2584-2586` records fixing exactly this for `ATTACH` — *"separator tricks (`ATTACH/**/DATABASE`, `ATTACH\tDATABASE`, a newline before the verb) can't split the verb from the guard the way the old raw `starts_with("ATTACH ")` did"* — and the fix was not carried to the three siblings that need it. |
| **Two implementations of "is this one statement"** | `has_multiple_statements` (`db_query.rs:328`) strips literals first; `is_single_statement` (`connector_use.rs:1317`) is `!trimmed.contains(';')`. Executed: `SELECT * FROM t WHERE x = 'a;b'` — a legitimate read — is **accepted by the console and rejected by the model lane**. Fails closed, so it is a function defect not a hole; it is here because it is the same question answered twice with different care. |
| **Two identifier sanitisers with opposite policies** | `connector_use.rs:1349` **rejects** anything outside `[A-Za-z0-9_]` (correct, fail-closed) — and accepts `""`, producing `PRAGMA table_info("")`. `db_query.rs:2632` **silently strips** the offending characters, so `x"); DROP TABLE y --` becomes the table name `xDROPTABLEy` and `PRAGMA table_info('xDROPTABLEy')` runs. Neither injects. But one answers a different question than the one asked, without saying so — the doctrine's own failure shape, in a sanitiser. They also disagree on Unicode: `is_alphanumeric()` keeps `tábla`, `is_ascii_alphanumeric()` rejects it. |
| **Treating `PRAGMA` as a read** | All four classifiers do. Executed in safe mode: `PRAGMA journal_mode = DELETE` changes the file's journal mode; `PRAGMA foreign_keys = OFF` and `PRAGMA synchronous = OFF` change the state of a **pooled** connection that goes back into a pool of 8. A "read-only" query mutated the database and contaminated a shared resource. |
| **A confirmation that truncates the payload** | `MutationConfirmBanner.tsx:41` — `pendingMutation.length > 200 ? slice(0, 200) + '...'`, inside a `max-h-20` `<pre>`. The one human gate in this path shows a prefix of the program it is asking about. |
| **A capability whose safety rests on an approval that another file can switch off** | `connectors.rs:214-224` reasons carefully about prompt injection and concludes *"Requiring approval puts a human in front of the raw query"*. `approval_autopilot.rs:10-49` removed that human for every `use_connector` write under autonomous mode, deliberately and with its own careful note — and nothing pointed the connector at it. Same shape as [second-transport-exposure](./second-transport-exposure.md) §7.H: **a borrowed control leaves no reference the deleter can follow.** |
| **Shipping the mechanical link and then hand-writing the mirror** | `classify_db_query` is registered, privileged, has a typed wrapper, and has **zero callers**; `safeModeUtils.ts` re-implements it and diverges on `DROP`/`ALTER` inside a CTE. This is [client-rule-mirroring](./client-rule-mirroring.md)'s subject with the excuse removed — there was no boundary problem to solve. |
| **Redacting on the door you were worried about** | `query_debug.rs` masks **27** sensitive column names and truncates every value to 200 chars. `execute_db_query` — including the ChatTab lane, where a **model** wrote the SQL — returns `QueryResult` verbatim. Two model-driven query doors, opposite redaction policies. |
| **A cancellation stack with no button** | `IN_FLIGHT_QUERIES` + `CancellationToken` + `get_interrupt_handle` + a `cancel_db_query` IPC command + `useDbQueryRunner.cancelQuery` — all correct, all wired, and `ConsoleTab.tsx:35` destructures the hook **without** `cancelQuery`. The saved-query editor renders the button; the primary console does not. |
| **Auditing the remote door and not the local one** | `log_decrypt(…, "db_query:execute", …)` fires only after the `personas_database` early return. The door onto the app's own memory store — the one with no encrypted columns — is the one with no ledger. |
| **An unbounded model-facing read** | `personas_db_execute_select` caps at 200 rows *after* fetching, and has no timeout, no busy timeout, no cancellation and no interrupt handle — against a pool the whole companion runtime shares. The console lane 60 lines away has all four. |

---

## 6. Evidence

### The one site to copy: `src-tauri/src/companion/jobs/operations_views.rs:27` — `run_view`

Not a safer console — **the thing a console is usually a substitute for.** A model asking an
operational question supplies a `view` name from a closed set of seven and a handful of parameters
that `arg_i64(args, key, default, min, max)` clamps (`:52`). The SQL is literal and lives beside the
view name. There is no statement to classify, no verb list to maintain, no prefix to bypass, and no
schema to enumerate — so P4, P5 and P7 all become vacuous rather than handled. It reads the
**credential database**, which is the strongest possible statement of the trade: the door onto the
most sensitive store is the door with no query string, and it is `requires_approval: false` and right
to be.

**Also exemplary:**

- **`db_query.rs:2464` — `run_local_sqlite_guarded`.** The bounded-execution reference; better than
  anything in the five sibling repos on all four axes. Read the `tokio::select!` (`:2484-2506`): on
  cancel or deadline it fires the interrupt **and then awaits the blocking task**, never detaching
  it, so the pooled connection is returned in every branch. The docstring says why.
- **`db_query.rs:89` — `inject_row_limit`.** A rewriter that declines. Four named conditions under
  which it returns the statement verbatim, and its own doc lists the two cases it knowingly handles
  imperfectly (a `UNION` gets one trailing `LIMIT`; a trailing block comment is appended after). A
  rewriter that documents where it is approximate is a rewriter you can reason about.
- **`useQuerySafeMode.ts:33-64`.** The context-drift guard, in both its effect form and its
  synchronous re-check, so a confirm cannot be accepted against a connection that changed underneath
  it. The comment names the click-race the effect would lose.
- **`introspectionQueries.ts:1-8`.** A deletion recorded as doctrine: the frontend's interpolated SQL
  builders *"were a weaker second implementation and have been deleted"*.
- **`ChatTab.tsx:179-184`.** The model-writes-SQL lane routed through the **same**
  `useQuerySafeMode` gate as the human editor, with the comment saying so. The right instinct; §7.D
  is the two things it does not inherit.

### The classifier census — ten predicates, three files, one database

| # | Predicate | Site | Method | Tests |
|---|---|---|---|---:|
| 1 | is it a mutation? | `db_query.rs:383` `is_mutation` | tokenizer, 42 read keywords, CTE-aware | 3 |
| 2 | is it a SQLite read? | `db_query.rs:360` `is_sqlite_read` | tokenizer, 5 read keywords, CTE-aware | 2 |
| 3 | is it safe DDL? | `db_query.rs:410` `validate_ddl_only` | raw `starts_with`, no comment strip | **0** |
| 4 | is it escaping the sandbox? | `db_query.rs:2588` inline deny-list | tokenizer, `ATTACH`/`DETACH`/`VACUUM INTO` | **0** |
| 5 | is it one statement? | `db_query.rs:328` `has_multiple_statements` | literal-aware | 7 |
| 6 | is it eligible for a `LIMIT`? | `db_query.rs:99` inside `inject_row_limit` | tokenizer + literal-aware | 8 |
| 7 | is it a Supabase-shaped SELECT? | `db_query.rs` `parse_select_to_postgrest` | a hand-written SELECT sub-parser | 9 |
| 8 | is it one statement? *(again)* | `connector_use.rs:1317` `is_single_statement` | `!contains(';')`, **not** literal-aware | **0** |
| 9 | is it a SELECT? | `connector_use.rs:1390` | `to_lowercase().starts_with("select")` | **0** |
| 10 | is it an allowed mutation? | `connector_use.rs:1455` | `starts_with` over 7 verbs incl. `drop` | **0** |
| — | *(client mirror)* is it a mutation? | `safeModeUtils.ts:37` `isMutationQuery` | regex, verb list missing `DROP`/`ALTER` | **0** |

**Six of eleven have no test at all**, and the three on the model-facing door are all in that six.

### The differential — port validated first, then 47 hostile statements

```
PORT VALIDATION (Rust half): 23 passed, 0 failed
  [23 assertions lifted verbatim from db_query.rs #[cfg(test)] :3078-3298]
PORT VALIDATION (TS half, replaying the Rust assertions it claims to mirror): 3 passed, 0 failed
  [the repo ships ZERO tests for safeModeUtils.ts]
```

**Client mirror vs server classifier — 2 divergences in 47, both the same cause, both fail closed:**

```
  CTE w/ DROP in body                ts=read  rust=MUTATION
  dollar-quoted mutation ($$…$$)     ts=read  rust=MUTATION
```

The TypeScript `MUTATION_VERBS_RE` (`safeModeUtils.ts:24`) is
`DELETE|UPDATE|INSERT|MERGE|REPLACE|TRUNCATE|UPSERT` — the Rust `CTE_MUTATION_VERBS`
(`db_query.rs:290`) is the same list **plus `DROP` and `ALTER`**. The consequence is not a bypass; it
is that for `WITH … DROP …` the client shows **no confirmation banner**, sends `allowMutation: false`,
and the backend returns a raw error. **The safe-mode UX — the entire point of the client mirror — is
unreachable for exactly the statements it was most needed for.** (The `$$…$$` divergence is the
mirror image: the TypeScript stripper knows Postgres dollar-quoting and the Rust one does not, so
Rust is *stricter*. Both directions exist in one 40-line pair.)

**The four doors, side by side** (48 rows measured; the ones that matter):

| statement | console safe | console write | model select | model mutation | `ddl_only` |
|---|---|---|---|---|---|
| `DROP TABLE companion_fact` | REJECT | EXECUTE | REJECT | **EXECUTE** | block |
| `DELETE FROM companion_fact` | REJECT | EXECUTE | REJECT | **EXECUTE** | block |
| `ALTER TABLE …` | REJECT | EXECUTE | REJECT | **EXECUTE** | block |
| `SELECT 1; DELETE FROM …` | REJECT | PREPARE¹ | REJECT | REJECT | block |
| `WITH d AS (DELETE … RETURNING *) SELECT …` | REJECT | EXECUTE | REJECT | REJECT | block |
| `ATTACH DATABASE 'personas.db' AS app` | REJECT | **REJECT** | REJECT | REJECT | block |
| `ATTACH/**/DATABASE …` · `ATTACH\tDATABASE …` | REJECT | **REJECT** | REJECT | REJECT | block |
| `VACUUM INTO '/tmp/copy.db'` | REJECT | **REJECT** | REJECT | REJECT | block |
| `PRAGMA journal_mode = DELETE` | **PREPARE** | PREPARE | REJECT | REJECT | block |
| `PRAGMA foreign_keys = OFF` | **PREPARE** | PREPARE | REJECT | REJECT | block |
| `PRAGMA writable_schema = ON` | **PREPARE** | PREPARE | REJECT | REJECT | block |
| `SELECTX 1` / `selecting from x` | REJECT | EXECUTE | **PREPARE** | REJECT | block |
| `SELECT * FROM t WHERE x = 'a;b'` | PREPARE | PREPARE | **REJECT** | REJECT | block |
| `CREATE TRIGGER … BEGIN DELETE FROM …; END` | REJECT | EXECUTE | REJECT | REJECT | **ALLOW** |
| `""` (empty) | PREPARE | PREPARE | REJECT | REJECT | **ALLOW** |

¹ reaches `conn.prepare`, which returns `Error::MultipleStatement` — **rusqlite 0.38's
`prepare_with_flags` (`lib.rs:785-792`) refuses a non-empty tail.** The driver, not the app, is what
stops a stacked statement on the local lane. The app's guard is load-bearing only for the
pass-through connectors, which is exactly what `db_query.rs:526-534` says.

### The decisive experiment — a fresh throwaway database per configuration

19 statements × 3 configurations. Abridged; **every "REFUSED" below is the SQLite engine, not a
keyword list:**

| statement | A. pooled conn (today) | B. `PRAGMA query_only = ON` | C. `SQLITE_OPEN_READONLY` handle |
|---|---|---|---|
| `SELECT count(*) …` | allowed | **allowed** | **allowed** |
| `PRAGMA table_info(…)` | allowed | **allowed** | **allowed** |
| `DELETE` / `UPDATE` / `INSERT` | allowed | **REFUSED** | **REFUSED** |
| `DROP TABLE` / `CREATE TABLE` | allowed | **REFUSED** | **REFUSED** |
| `CREATE TRIGGER … DELETE …` | allowed | **REFUSED** | **REFUSED** |
| `VACUUM` / `ANALYZE` | allowed | allowed | **REFUSED** |
| `PRAGMA journal_mode = DELETE` | allowed | allowed | **REFUSED** |
| `PRAGMA foreign_keys/writable_schema/synchronous` | allowed | allowed | allowed |
| **`PRAGMA query_only = OFF`** | allowed | **allowed — the guard is self-disabling** | allowed *(and inert)* |
| `ATTACH DATABASE '<second file>' AS side` | allowed | allowed | **allowed** |
| … then `SELECT … FROM side.<table>` | allowed | allowed | **allowed** |
| … then `INSERT INTO side.<table>` | allowed | allowed | **REFUSED** |
| `REINDEX` | allowed | allowed | allowed |

Three conclusions, and they are §2:

1. **A read-only handle is strictly stronger than `query_only`**, because `PRAGMA query_only = OFF`
   is an accepted statement and a handle flag is not addressable from SQL.
2. **Neither stops `ATTACH`, and both still let you READ the attached file.** So the
   `ATTACH`/`DETACH` deny-list at `db_query.rs:2589` is **the entire boundary between this console
   and `personas.db`'s 42 `credential_fields` rows**, it is one hand-written match arm, and it has
   zero tests. It is also correct, and correct against separator tricks, which is why §7 does not
   list it as a defect — but it should never have been the only thing there.
3. **Neither stops the state-mutating `PRAGMA`s**, which every classifier calls a read.

### What the live databases hold

Read-only copies, 2026-08-17, deleted after measurement:

- **`personas_data.db`** — the database this console's local lane and the model lane reach. **68
  tables. Zero encrypted-value columns.** `companion_turn` 1,779 · `companion_node` 1,554 ·
  `companion_provenance` 211 · `companion_approval` 120 · `companion_fact` 90 ·
  `companion_procedural` 35 · `companion_known_project` 10 · `companion_taxonomy` 9 ·
  `companion_session` 4 · `companion_backlog_item` 3 · `companion_goal` 1 · the whole vector KB.
- **`personas.db`** — **241 tables, 5 encrypted-value columns**, `credential_fields` 42 rows,
  `persona_events` 4,972, `credential_audit_log` 9,803, `personas` 78. **Unreachable from the
  console's local lane** — the only model-facing door onto it is `operations_views`' seven named
  views. **This corrects the brief; see §12.2.**
- **`db_saved_queries` 0 · `db_schema_tables` 0 · `db_query:execute` audit rows 0 ·
  `use_connector` approvals 0 of 120.** Nothing on this leaf has ever run.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every item below reduces to one absence: **there
> is no type that says "this string has been classified."** Because the executor's parameter is
> `&str`, a new door is one function away and the classifier is optional at it; because the
> classifier is optional, the second author wrote a shorter one; because there are two, the client
> wrote a third; and because none of them can be the *only* thing standing between a statement and
> the data, the read-only principal that would have made all of them advisory was never reached for.
> Give `conn.execute` and `conn.prepare` wrappers that only accept a classified newtype, and 7.A,
> 7.B and 7.H become compile errors instead of judgements.

### 7.A — P0: a model-supplied string reaches `conn.execute` with a 7-verb prefix check, and the human who was supposed to see it has been switched off

`connector_use.rs:1443-1469`. The guard is `lower.starts_with(v)` over
`["create","insert","update","delete","drop","alter","replace"]` plus `!contains(';')`. Then
`conn.execute(trimmed, [])` against `personas_data.db`.

The capability is `requires_approval: true` (`connectors.rs:230`) and the dispatcher honours it
(`dispatcher.rs:1852`). Under `companion_autonomous_mode` — **`"true"` in this install's
`app_settings`** — `auto_resolve_if_allowed` (`approval_autopilot.rs:69`) takes the generic path for
every non-fleet, non-`remote_instruct` action, calls `execute_approval_action` (`:256`) and returns
`Ok(true)` (`:318`). No card, no click. The module's own docstring states this outcome plainly at
`:44-49`.

**No bound of any kind applies**: no row cap (it is a mutation), no timeout, no `busy_timeout`, no
cancellation token, no interrupt handle, no audit row beyond the approval record. The console lane
60 lines away in the same crate has all six.

**Stated plainly, as the brief asks: yes — a model-supplied string reaches a write statement, and on
this install nothing human stands between them.** It has never fired (0 `use_connector` rows in 120
approvals), so this is a latent hazard, not an observed incident.

**Fix, cheapest first:** (a) delete `execute_mutation` — a model that needs to write to the brain has
`write_fact` / `write_procedural` / `write_backlog_item`, which are typed, and `execute_mutation` has
never been used; (b) if it must stay, remove `drop` and `alter` from the verb list and route it
through `db_query::is_mutation` + the `ATTACH` deny-list rather than a prefix test; (c) add the
capability an explicit `bypasses_autonomy: false` marker so the autonomy path has something to read,
which is the mechanical form of P8.

### 7.B — P0: `execute_select` is unbounded on every axis the console bounds, and its own comment says why that matters

`connector_use.rs:1376-1441`. `starts_with("select")` (executed: `selecting from x` passes),
`!contains(';')` (executed: rejects `WHERE x = 'a;b'`), then `conn.prepare(trimmed)` and a **post-fetch**
`limit` clamped to 200.

Missing relative to `run_local_sqlite_guarded`, all four of P9: no `busy_timeout`, so a locked
database blocks a pooled connection indefinitely; no wall-clock deadline; no `CancellationToken` and
no interrupt handle, so a cartesian product cannot be stopped; and no injected `LIMIT`, so the 200-row
cap applies **after** SQLite has materialised the result. The pool is `max_size(8)`
(`db/src/lib.rs:511`) and is shared with the vector knowledge base, whose comment at `:508-510`
records that a search "holds a connection for hundreds of ms" and that `max_size(2)` was already a
contention problem.

The capability's own comment (`connectors.rs:215-223`) reasons correctly about prompt injection and
concludes that approval is the control. §7.A is why that conclusion no longer holds.

**Fix:** route it through `execute_query_cancellable` with `allow_mutation = false`. That is one
call and it inherits the tokenizer, the deny-list, the row cap, the deadline and the interrupt.

### 7.C — P1: `validate_ddl_only` guards nothing, is unreachable in the only configuration where it would matter, and admits deferred DML

Three findings in one 40-line function.

1. **Zero true call sites.** `ddl_only` is a parameter on `execute_db_query` (`db_schema.rs:222`),
   threaded through two engine functions, and the only frontend wrapper
   (`src/api/vault/database/dbSchema.ts:73`) is called from exactly one place —
   `databaseSlice.ts:146` — which passes **`undefined`**. Nothing sets it. Its docstring says it
   exists to protect *"during schema setup in template adoption"*; template adoption does not call it.
2. **One of the four boolean combinations is dead.** Measured: with `ddl_only = true` and
   `allow_mutation = false`, `validate_ddl_only` admits `CREATE TABLE`, `CREATE INDEX`, `CREATE
   VIEW`, `CREATE TRIGGER`, `BEGIN`, `COMMIT`, `ROLLBACK` and `SAVEPOINT`, and then the safe-mode
   guard three lines later (`db_query.rs:518`) rejects **every one of them** as a mutation. The only
   input that executes in that mode is the empty string. Two adjacent `bool` parameters, one
   nonsensical combination, compiler content — §4(a) Q7.
3. **`CREATE TRIGGER` is admitted, and a trigger is deferred DML.** `upper.starts_with("CREATE ")`
   then `after.starts_with("TRIGGER")` returns `Ok(())` for
   `CREATE TRIGGER t AFTER INSERT ON x BEGIN DELETE FROM companion_fact; END`. The function's stated
   purpose is *"to guard against hallucinated AI proposals or careless user edits destroying
   operational data"*, and a trigger is the standard way to write a `DELETE` that a DDL allowlist
   waves through.

**Fix:** delete the parameter and the function. If schema setup ever needs it, it needs `QueryMode::SchemaSetup`
(§4) with `CREATE TRIGGER` excluded and a test — it currently has **zero**.

### 7.D — P1: the AI-debug lane redacts results and the AI-chat lane does not

`query_debug.rs:79` `sanitize_query_result` masks **27** sensitive column names, truncates every other
value to 200 chars at a UTF-8 boundary, caps at 5 rows and reports `rows_omitted` honestly. It is
applied to exactly one of the eight doors.

> **Count corrected 2026-08-17 by [telemetry-scrubbing](./telemetry-scrubbing.md)** — this path said
> 21 in two places. It also measured what the list would cost if the match were loosened:
> `contains()` matching would `[REDACTED]` **130 of 2,570 live columns**, mostly `input_tokens`,
> `is_sensitive`, `content_hash`, `tags` and `authors`. A wider allowlist is not free.

`ChatTab.tsx:170` — where a **model** authored the SQL and the human pressed Run — calls
`executeDbQuery` and renders the raw `QueryResult`. So do both human editors. There is no redaction
anywhere in `src/features/vault/sub_databases/` (grep for `redact|mask|sensitive`: **0 hits**).

**Two model-driven query doors in one feature, opposite redaction policies, and the unredacted one is
the one whose results are also copied into the chat transcript.** The right answer is not to redact
the human console — the human asked, and P10's cost is real — it is that the *policy* should be one
decision made once and applied per door, rather than an artefact of which door somebody was worried
about. `sanitize_query_result` is private to `query_debug.rs`; promoting it is a `pub(crate)`.

### 7.E — P1: `classify_db_query` has zero callers and the hand-written mirror diverges

`db_schema.rs:164` exposes `is_mutation` over IPC. Registered (`lib.rs:2323`), privileged
(`ipc_auth.rs:227`), typed wrapper at `src/api/vault/database/dbSchema.ts:64`. **Zero call sites in
4,829 TypeScript files.**

`safeModeUtils.ts` re-implements it, calling itself a mirror, and diverges on 2 of 47 statements
because its CTE verb list omits `DROP` and `ALTER` (§6). The divergence fails closed, so the cost is
UX rather than safety: for `WITH … DROP …` the user gets a backend error instead of the confirm
dialog.

This is [client-rule-mirroring](./client-rule-mirroring.md) with the usual justification removed.
That path's finding is that a parity *test* on one side is a third copy; here there is not even a
mirror to test — **there is an IPC call that would have made the mirror unnecessary, and it was
built and never used.** The argument for the mirror is latency (no round trip before showing a
dialog), which is real; the answer is to call `classify_db_query` and *fall back* to the local
heuristic, or to generate the verb list into both languages from one source the way
`gen-tour-anchors.mjs` does for tour anchors.

### 7.F — P2: the one human gate shows a 200-character prefix of the program it is asking about

`MutationConfirmBanner.tsx:41`:

```tsx
{pendingMutation.length > 200 ? pendingMutation.slice(0, 200) + '...' : pendingMutation}
```

inside `<pre className="… max-h-20 overflow-x-auto">`. So a statement longer than 200 characters is
truncated, and one taller than ~4 lines is clipped by the container as well.

This matters most in the case the code deliberately allows: **in write mode the multi-statement guard
is skipped** (`db_query.rs:535`, correctly — the user confirmed), and for the Neon/PlanetScale
pass-through the whole payload is forwarded verbatim. A 250-character statement whose tail is a
second statement is confirmed from its first 200 characters.

**Fix:** drop the `slice`, let the `<pre>` scroll (`max-h-40 overflow-auto`). This is
[informed-consent-gate](./informed-consent-gate.md)'s territory and the one-line version of its rule.

### 7.G — P2: the cancellation stack is complete and the primary console renders no button

`IN_FLIGHT_QUERIES` registry (`db_schema.rs:16`), `register_query`/`deregister_query` on every exit
path, `cancel_db_query` IPC command, `CancellationToken` threaded to
`execute_query_cancellable`, `get_interrupt_handle()` on the SQLite path, the `tokio::select!` that
awaits the blocking task after interrupting, `cancelDbQuery` in the store, and
`useDbQueryRunner.cancelQuery` (`:60-63`).

`QueryEditorPane.tsx:42,:71` uses it. **`ConsoleTab.tsx:35` destructures the hook without it.** The
Console tab is the primary SQL surface; a runaway query there can only be waited out for 60 seconds.

Related, same file family: `ChatTab.tsx:170` calls `executeDbQuery(credentialId, sql, undefined,
allowMutation)` — four arguments, so no `queryId` — which means the model-authored lane never
registers a cancellation token at all.

### 7.H — P2: the local database lane writes no audit row

`execute_query_cancellable` returns at `db_query.rs:551` for `service == "personas_database"`, before
`get_decrypted_fields` and `audit_log::log_decrypt(…, "db_query:execute", …)` at `:555-562`. So the
only door with a ledger entry is the one that had to decrypt a credential to reach a remote service —
the audit row is a **side effect of decryption**, not a record of execution.

Confirmed from the data: `credential_audit_log` holds 9,803 rows and **2** mention this path, both
`db_query:introspect_tables`. The local lane has `tracing::info!` (`:199-217`) and nothing durable.

That is exactly backwards from where the risk is: the local lane is the one reaching an unencrypted
store of the operator's conversation history, and the one a model can drive.

### 7.I — P3: `PRAGMA` mutates through a "read" branch and contaminates a pooled connection

Every classifier lists `PRAGMA` as read (`db_query.rs:368`, `:394`, `safeModeUtils.ts:11`), so a
`PRAGMA` goes down the `is_sqlite_read` branch to `conn.prepare` and **never reaches the
`ATTACH`/`VACUUM INTO` deny-list, which lives in the `else` arm** (`:2582-2602`). Executed in safe
mode against a throwaway file: `PRAGMA journal_mode = DELETE` changed the file's journal mode;
`PRAGMA foreign_keys = OFF` and `PRAGMA synchronous = OFF` changed connection state that is then
returned to a pool of 8 and handed to the next caller — which may be the vector KB or the companion
brain.

Low severity today (the door is `#[requires(privileged)]` and the model lanes reject `PRAGMA`), and
named because the *shape* is the leaf's thesis in miniature: a keyword list decided this was a read,
and the engine disagreed.

### 7.J — P3: `ChatTab`'s pending mutation and its result target can name different messages

`ChatTab.tsx:182` sets `runTargetMsgIdRef.current = msgId` then `guardedExecute(sql)`. If message A's
mutation is stashed pending and the user runs message B's read, the ref moves to B while A's text
stays pending; confirming then executes **A's statement** (correct — the banner shows it) and writes
the result onto **B's message**. The statement executed is the one displayed, so this is an
attribution defect rather than a wrong-statement defect. The shared `useQuerySafeMode` drift guard
cannot see it, because `runQuery`'s identity is pinned to `credentialId` only — deliberately, per the
comment at `:41-45`.

### 7.K — what this path CLEARED

Reported because a path that lists only defects mis-sets priors.

- **`ATTACH` is denied at all three local doors, and the deny-list is well built.** The console's
  arm uses `extract_first_keyword`, so `ATTACH/**/DATABASE`, `ATTACH\tDATABASE` and a leading line
  comment all fail closed — executed, all four variants rejected. The model lanes reject it by verb
  allowlist. **The two-database separation holds today**, and the comment at `:2584-2586` shows the
  weaker `starts_with("ATTACH ")` form was found and fixed. The finding in §6 is that this is the
  *only* thing there, not that it is broken.
- **The console does not reach the credential database.** `personas_database` resolves to
  `state.user_db` = `personas_data.db`. `credential_fields` lives in `personas.db`. **This corrects
  the brief — §12.2.**
- **Stacked statements cannot execute on the local lane even in write mode**, because rusqlite 0.38's
  `prepare_with_flags` returns `Error::MultipleStatement` on a non-empty tail (`lib.rs:785-792`).
  The app's guard is load-bearing for the REST pass-through connectors only, which is what its
  comment claims.
- **`nl_query.rs` generates SQL and does not execute it.** The generated statement is emitted to the
  UI and lands in the editor, where the human sees it and the safe-mode gate applies. That is the
  correct shape for an NL-to-SQL feature and it would have been easy to get wrong — `query_debug.rs`,
  the sibling, does auto-execute.
- **`query_debug.rs` blocks mutations by default and audits every attempt** (`:392-412`) with a
  length fingerprint rather than the statement text (`:391` — *"log a length fingerprint, not raw
  query text"*), and truncates + redacts its results. Of the three model-driven doors it is by some
  distance the best-behaved.
- **`sanitize_error` is applied on every failure path** through `finalize_result`, redacts every
  credential field value regardless of length, and the test at `:3769-3789` records the reasoning
  for refusing a short-value exemption.
- **The result grid satisfies the performance dimension** — virtualized, cell previews truncated,
  sticky header, honest truncation notice — which no sibling console does.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **Reconstruction, this corpus's strongest validation technique, does not apply here.**
   [untrusted-definition-validation](./untrusted-definition-validation.md)'s P2 says: read the fields
   you know by name and emit a new object. A SQL statement has no fields — it is already the program.
   You cannot rebuild it without writing a SQL parser and a serializer, and then you own a dialect.
   That is the whole reason §2 moves the control to the principal: **when you cannot validate the
   input, constrain the executor.** Worth carrying upward as a general rule.
2. **A read-only principal bounds writes, not reach.** Measured: a read-only handle still attaches a
   second database and still reads it, and still reads every table in the schema. P3 has no
   primitive here at all — SQLite has no row-level security, no per-role grants, and no view-only
   connection. The nearest available answer is a separate database file per audience, which is a
   schema decision, not a console decision.
3. **`PRAGMA` cannot be classified by verb.** It is one keyword covering ~60 statements ranging from
   `table_info` (pure read) to `writable_schema` (a foot-gun). Distinguishing them means a second
   allowlist keyed on the pragma *name*, which is the same maintenance problem one level down.
4. **The census cannot assert the absence that matters.** *"No caller-authored statement reaches an
   executor without going through the one classifier"* is a dataflow statement across three crates
   and two languages. §9 counts a different, countable thing and says so. The three sharpest findings
   here are absences — `classify_db_query` has no caller, the local lane has no audit row, and
   `validate_ddl_only` has no call site — and **none is gateable by counting.** The first and third
   are `assert!`-shaped and belong in a Rust test; the second is a query somebody has to run.
5. **No gate can see an approval that another file dissolves.** §7.A's chain crosses
   `connectors.rs` → `dispatcher.rs` → `approval_autopilot.rs` → a runtime setting. A rule can count
   `requires_approval: true` capabilities; it cannot know whether the mode that skips them is on.
   The honest instrument is a test asserting that every capability whose handler reaches
   `conn.execute` is listed in a `NEVER_AUTO_FIRE` set — which does not exist.
6. **The 200-character confirmation truncation is not purely a bug.** A statement can be arbitrarily
   long and a banner cannot be. The fix is scrolling, not unlimited height, and there is a genuine
   design question about what "the user saw it" means for a 4,000-character statement. Named so the
   next reader does not treat §7.F as free.
7. **The client mirror cannot be removed without a latency cost.** `isMutationQuery` exists so the
   confirm dialog appears without an IPC round trip. Calling `classify_db_query` instead adds one
   round trip per Run. The right answer is generation from one source, and this repo has the
   machinery (`scripts/docs/gen-tour-anchors.mjs` emits a Rust file and a JSON twin from one scan) —
   but pointing it at a verb list is real work, and that is why the hand-written mirror exists.

---

## 9. The missing gate

### First, the contract's prior question: prefer a type over a gate

**Yes, twice** — §4 holds both against all seven qualifications and lands on **Q5 with a hard Q4
condition** (the newtype's field must be private, or it is a comment) plus **Q7** for the adjacent
`bool` pair, where the measurement found a dead configuration. **Ship the read-only pool first** — it
is one `Pool::builder()` with one `OpenFlags`, it needs no call-site changes beyond the checkout, and
it is the only change that makes a classifier bug survivable. Ship the `ClassifiedStatement` newtype
second. The gate below ratchets the dimension neither type reaches: **how many hand-written SQL verb
vocabularies this repo maintains.**

### The condition this signal is a proxy for

> *A second, independent decision about what kind of statement a caller-authored string is —
> expressed as its own vocabulary, outside the classifier that owns the decision.*

**An adopting repo must re-derive its own proxy and must NOT port this pattern.** The precondition
here is specific: this repo spells the defect as a Rust `matches!` arm or a `&[&str]` array of verb
literals, and a TypeScript `Set`/regex of the same. In a Next.js app it wears
`sqlNormalized.startsWith('SELECT')` with a sibling deny-regex (measured, twice, in `vibeman`); in
Python it would wear a `re.match(r'^\s*select', sql, re.I)`; in Java a `SqlParser` class nobody
else calls. **This pattern scores zero on all three.** The transferable instruction is: *find every
place your codebase names SQL verbs as data, and ask which one is authoritative.*

### Not already gated — the neighbours checked

All **145** rules in `scripts/census/rules.json` were read. Nothing matches `.route(`-style query
execution or a verb vocabulary. The nine that touch SQL at all were checked for file and condition
overlap:

| rule | goldenPath | overlap with my 2 files |
|---|---|---:|
| `unescaped-like-pattern` | dynamic-filter-query | **0** (matches `format!("%…{…"` — a value, not a verb) |
| `unverifiable-conflict-clause` | conditional-write | **0** (`INSERT OR IGNORE INTO` — SQL *as* SQL) |
| `hand-rolled-fixture-ddl` · `constraintless-table-declaration` · `handwritten-rebuild-shape` | schema paths | **0** (`CREATE TABLE` in DDL text) |
| `retention-delete-by-status-allowlist` · `unfenced-work-outcome-write` · `unowned-inflight-state-sweep` | delete/status paths | **0** (`DELETE FROM`/`UPDATE … SET` as SQL) |
| `unatomic-sequence-rewrite` · `silent-row-skip` · `untimed-repo-query` | repo-layer paths | **0** (`conn.execute` in a loop; `query_map`) |

Every one of those keys on **SQL text used as SQL**. This rule keys on **SQL verbs used as data** —
the disjointness is structural, not incidental, and it is why the exclusion of `db_query.rs` does not
collide with anything.

### Precision, recall, and the trade

**Precision: 2 of 2, hand-read.** `connector_use.rs:1453` (`allowed_starts`, the model-mutation
vocabulary — §7.A) and `safeModeUtils.ts:9` (`READ_ONLY_KEYWORDS`, the client mirror — §7.E). Both
are §7 deviations. No false positives.

**Recall is deliberately partial and stated.** Requiring **three or more** verb literals in a run
means a single-verb check is invisible — so `connector_use.rs:1390`'s
`starts_with("select")` and `validate_ddl_only`'s `starts_with("CREATE ")` are **missed**, and both
are real instances. Widening to two verbs pulls in every `create|update|delete` CRUD-audit enum in
the tree (measured: 13 matches / 9 files, **precision 6/13 = 46%** — below the doctrine's refusal
bar, and 5 of the 7 false positives are audit-operation names, not SQL). **The narrow form was chosen
for precision over recall and the trade is recorded here so the next reader does not "fix" it.** The
discriminator that buys the precision is a lookahead requiring at least one verb that is *only* a SQL
statement keyword (`SELECT|DROP|ALTER|TRUNCATE|MERGE|UPSERT|PRAGMA|ATTACH|DETACH|VACUUM|EXPLAIN|SAVEPOINT|ROLLBACK|COMMIT`),
which is what excludes `"create","update","delete"`.

### Two implementations — and the disagreement was a real defect in the rule

A tokenising scanner (quoted-literal / separator / other, runs assembled by state machine) reported
**7 matches / 4 files**. The census regex reported **8 / 4** — same files, one extra match. Hand
inspection: `db_query.rs:393-400` is **one** `matches!` arm split across lines with a leading `|`,
and the regex's separator allowed `[ \t]{0,8}` *before* the `|` but `[ \t\r\n]{0,12}` after, so a
newline-then-12-spaces continuation broke the run into two. **The rule was counting one vocabulary as
two.** Making the whitespace bound symmetric and raising it to `{0,20}` (the source indents 12
spaces, so `{0,12}` missed by one character) brought the regex to **7 / 4, identical membership**.

*Agreement is not soundness — but a disagreement that names its own cause is.* The bounds are
deliberately finite rather than `*`: an unbounded quantifier on both sides of a bounded outer
repetition is the nested-quantifier shape the doctrine records hanging a 963-file walk. Measured
runtime over 5,792 files: **2.6 s**.

### The positive control partitions the anchor exactly

Both rules key on the same anchor. The violating arm excludes the two files that legitimately own a
vocabulary; the control excludes the two that do not. **2 + 5 = 7 = the anchor's entire raw
population**, no residue, no overlap:

```
adhoc-statement-verb-vocabulary                    2 files   2 matches   (base 2 / 2)   walked 5792
adhoc-statement-verb-vocabulary-positive-control   2 files   5 matches   (no baseline)  walked 5792
```

Violating: `connector_use.rs` 1, `safeModeUtils.ts` 1. Compliant: `db_query.rs` 3 (the three arms of
the one classifier), `sqlTokenizers.ts` 2 (a syntax-highlighting lexer — a vocabulary that decides
nothing). **A control returning ~0 would mean the repo has no authoritative classifier and the rule
is measuring house style rather than a choice.** It returns 5.

**The `exclude` list IS the deliverable.** It is the classifier-ownership table §6 says does not
exist anywhere in code, with a prose reason per entry that the runner refuses to let go stale.

```json
{"rules":[
{
  "id": "adhoc-statement-verb-vocabulary",
  "goldenPath": "docs/concepts/golden-paths/sql-console.md",
  "title": "A second SQL statement-verb vocabulary, hand-written outside the classifier that owns the decision",
  "roots": ["src-tauri", "src"],
  "extensions": [".rs", ".ts", ".tsx"],
  "signal": {
    "pattern": "(?=(?:[\"'](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|MERGE|UPSERT|PRAGMA|ATTACH|DETACH|VACUUM|EXPLAIN|WITH|VALUES|ANALYZE|SHOW|DESCRIBE|DESC|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)[\"'][ \\t\\r\\n]{0,20}[,|][ \\t\\r\\n]{0,20}){0,12}[\"'](?:SELECT|DROP|ALTER|TRUNCATE|MERGE|UPSERT|PRAGMA|ATTACH|DETACH|VACUUM|EXPLAIN|SAVEPOINT|ROLLBACK|COMMIT)[\"'])(?:[\"'](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|MERGE|UPSERT|PRAGMA|ATTACH|DETACH|VACUUM|EXPLAIN|WITH|VALUES|ANALYZE|SHOW|DESCRIBE|DESC|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)[\"'][ \\t\\r\\n]{0,20}[,|][ \\t\\r\\n]{0,20}){2,}[\"'](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|MERGE|UPSERT|PRAGMA|ATTACH|DETACH|VACUUM|EXPLAIN|WITH|VALUES|ANALYZE|SHOW|DESCRIBE|DESC|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)[\"']",
    "flags": "gi",
    "ignoreCommentLines": true,
    "description": "A run of three or more quoted SQL statement-verb literals — a hand-written vocabulary used to CLASSIFY a caller-authored statement — in a file that is not the classifier that owns the decision. PROXY FOR the stack-free condition: a second, independent decision about what kind of statement a caller-authored string is. Measured 2026-08-17 at f432a4ef3: 2 matches / 2 files violating (connector_use.rs:1453 the model-mutation verb list; safeModeUtils.ts:9 the client mirror), against 5 matches / 2 files for the compliant form (db_query.rs 3 = the one classifier's three arms; sqlTokenizers.ts 2 = a highlighting lexer that decides nothing). 2+5=7 = the anchor's entire raw population, so rule and control PARTITION it. PRECISION 2/2 hand-read; both are section-7 deviations. RECALL is deliberately partial: requiring THREE OR MORE verbs makes a single-verb check invisible, so connector_use.rs:1390 (starts_with(\"select\")) and validate_ddl_only's starts_with(\"CREATE \") are missed — both real instances. Widening to two verbs gives 13 matches / 9 files at 46% precision by pulling in every create/update/delete CRUD-AUDIT enum in the tree; the narrow form was chosen for precision and the trade is stated in the golden path so nobody 'fixes' it. THE LOOKAHEAD IS LOAD-BEARING: it requires at least one verb that is ONLY a SQL statement keyword, which is what excludes the audit enums. THE WHITESPACE BOUNDS MUST BE SYMMETRIC AND >= 20: an asymmetric {0,8}/{0,12} pair split one matches! arm across a leading-pipe continuation line and counted ONE vocabulary as TWO — caught by a second tokenising implementation that disagreed by exactly 1. CORRECT END STATE is 0, at which point DELETE this rule rather than baselining it at zero. PRECONDITION (re-derive per repo, do NOT port): in Next.js the condition wears sqlNormalized.startsWith('SELECT') plus a sibling deny-regex (measured twice in ../vibeman); in Python a re.match(r'^\\s*select', sql, re.I). This pattern scores ZERO on both."
  },
  "exclude": [
    { "path": "src-tauri/src/engine/db_query.rs", "reason": "the primitive itself — the one classifier that owns the read/write decision for every door onto this database (is_mutation :383, is_sqlite_read :360, and the CTE_MUTATION_VERBS list :290). Everything else in the repo should be calling this or the classify_db_query IPC command that wraps it." },
    { "path": "src/features/vault/sub_databases/sqlTokenizers.ts", "reason": "a syntax-highlighting lexer for the SQL editor, not a gate: SQL_KEYWORDS/SQL_FUNCTIONS/REDIS_COMMANDS decide a CSS class and nothing else, and its only consumer is SqlEditor.tsx. Deliberately NOT merged with the classifier — a highlighter wants recall, a classifier wants precision." }
  ],
  "baseline": { "files": 2, "matches": 2 },
  "floor": 4000
},
{
  "id": "adhoc-statement-verb-vocabulary-positive-control",
  "goldenPath": "docs/concepts/golden-paths/sql-console.md",
  "title": "POSITIVE CONTROL — the same anchor pointed at the vocabularies that legitimately own the decision",
  "roots": ["src-tauri", "src"],
  "extensions": [".rs", ".ts", ".tsx"],
  "signal": {
    "pattern": "(?=(?:[\"'](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|MERGE|UPSERT|PRAGMA|ATTACH|DETACH|VACUUM|EXPLAIN|WITH|VALUES|ANALYZE|SHOW|DESCRIBE|DESC|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)[\"'][ \\t\\r\\n]{0,20}[,|][ \\t\\r\\n]{0,20}){0,12}[\"'](?:SELECT|DROP|ALTER|TRUNCATE|MERGE|UPSERT|PRAGMA|ATTACH|DETACH|VACUUM|EXPLAIN|SAVEPOINT|ROLLBACK|COMMIT)[\"'])(?:[\"'](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|MERGE|UPSERT|PRAGMA|ATTACH|DETACH|VACUUM|EXPLAIN|WITH|VALUES|ANALYZE|SHOW|DESCRIBE|DESC|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)[\"'][ \\t\\r\\n]{0,20}[,|][ \\t\\r\\n]{0,20}){2,}[\"'](?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|MERGE|UPSERT|PRAGMA|ATTACH|DETACH|VACUUM|EXPLAIN|WITH|VALUES|ANALYZE|SHOW|DESCRIBE|DESC|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)[\"']",
    "flags": "gi",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL: the same anchor, pointed at the two files that legitimately own a SQL verb vocabulary — db_query.rs (the one classifier) and sqlTokenizers.ts (a highlighting lexer). Must return ~5. Disjoint from the violating arm by construction — its exclude list is the exact complement of the violating rule's — so together they partition the anchor's 7 raw matches with no residue and no overlap. If this ever returns ~0, the anchor has stopped discriminating: either the classifier was refactored out of a literal verb list (in which case the violating arm is now measuring house style rather than a choice) or the pattern broke."
  },
  "exclude": [
    { "path": "src-tauri/src/companion/jobs/connector_use.rs", "reason": "control: this is the violating arm's first match (the model-mutation verb list at :1453) — excluded here so the control counts ONLY the compliant vocabularies and the two rules partition the anchor" },
    { "path": "src/features/vault/sub_databases/safeModeUtils.ts", "reason": "control: this is the violating arm's second match (the client mirror's READ_ONLY_KEYWORDS at :9) — excluded here for the same reason" }
  ],
  "floor": 4000
}
]}
```

### Validation — run 2026-08-17 via `node scripts/census/run-census.mjs --rules <scratch> --check`

Validated in a **private scratch registry with a filename unique to this composer**
(`rules-sqlcon-console-probe.json`). **The full registry was NOT run.**

| # | Scenario | Expected | Observed | Exit |
|---|---|---|---|---|
| 1 | rule + control as shipped, `--check` | baseline holds; control non-zero | `OK adhoc-statement-verb-vocabulary 2/2 files, 2/2 matches, 5792 walked, floor 4000` · `OK …-positive-control 2 files, 5 matches` | **0** |
| 2 | fault: **rise** (baseline 1/1) | must fail | `files rose 1 -> 2 (+1). New violations of docs/concepts/golden-paths/sql-console.md` | **1** |
| 3 | fault: **silent drop** (baseline 3/3) | must fail | `files dropped 3 -> 2 (-1) without the baseline moving. A silent drop is a broken matcher more often than fixed code` | **1** |
| 4 | fault: **broken matcher** (roots narrowed to one dir) | must fail structurally | `walked 40 files but floor is 4000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` **and** the stale-exclude error, both | **1** |
| 5 | fault: **zero match** (nonexistent token) | must fail structurally | `matched zero files anywhere … DELETE the rule rather than baselining it at zero` | **1** |
| 6 | fault: **stale exclude** (file renamed) | must fail structurally | `exclude "…/db_query_RENAMED.rs" matched no file. The exemption is stale` | **1** |
| 7 | fault: **control carrying a baseline** | must be rejected by `validateRule` | `a positive control must NOT carry a baseline — it exists to fail, and a baselined control would ratchet against improving adoption` | **1** |
| 8 | **re-extracted from this document** and re-run | identical to #1 | identical to #1 | **0** |

### Where it executes

**`npm run census:check`, chained inside `npm run check` AND a `pre-push` lefthook job**
(`lefthook.yml`, `golden-path-census`). Per the brief's calibration this matters: `ci.yml` is red on
ten pre-existing failures, so a gate that lived only there would run nowhere. The runner's own
fail-loud contract — floor, zero-match, stale-exclude, rise, silent drop — is what makes this a gate
rather than a report; rows 2–7 above are that contract exercised against this rule.

### What this gate does NOT catch — the contract's fifth failure mode, named

It counts vocabularies. It will go green on a codebase where every door classifies by a
single-verb `starts_with` — which is **two of the ten predicates in this repo today**, including the
one on the model-facing read door. It cannot see §7.A's approval chain, §7.C's dead boolean
combination, §7.D's missing redaction, §7.E's zero-caller IPC command, §7.G's unrendered button or
§7.H's missing audit row — five of those six are **absences**, and the census ratchets a count of
something present.

**The complementary instruments the census cannot host**, in priority order:

1. A Rust test asserting **`execute_local_sqlite_conn`'s callers are the only executors** — i.e. that
   `conn.execute(` and `conn.prepare(` do not appear in `connector_use.rs`. That is one `assert!` on
   a source scan and it would have failed the day `personas_db_execute_mutation` shipped.
2. A Rust test asserting **every `ConnectorCapability` whose handler reaches `conn.execute` is in a
   `NEVER_AUTO_FIRE` set** — the mechanical form of P8, and the only thing that would have caught
   §7.A when `approval_autopilot.rs` changed.
3. `assert!(classify_db_query_callers >= 1)` — the same shape
   [second-transport-exposure](./second-transport-exposure.md) §9 specified for `command_tier`, and
   for the same reason: a vocabulary with no reader guarantees a second vocabulary.
4. **A query, which somebody has to run**: `SELECT count(*) FROM credential_audit_log WHERE detail
   LIKE 'db_query:execute%'`. It returns 0, and no code reading can tell you that.

Ship the read-only pool first, the newtype second, and this as the ratchet that holds the line until
they land.

---

## 12. Corrections to the brief

The brief made five priming claims and set one calibration. **Two were right, one was wrong on the
database, one pointed at the largest finding without knowing which door it was on, and the spine's
label was wrong in a way worth recording.**

**1. `convergence: converged` — TESTED AND REFUTED. That is eleven labels tested and eleven failed,
and this one failed in a way none of the previous ten did.** The oracle's finding is not that the
fleet disagrees about how to build a SQL console. It is that **four of five siblings do not have
one**, having independently chosen typed doors instead — `.from("<literal>")`, Prisma tagged
templates, literal `db.prepare`, and 948 `sqlx` sites of which zero take a caller-authored string,
across three languages. The fifth (`vibeman`) has one, built it for a language model, and gave it two
keyword checks, zero row caps, zero timeouts, zero redaction, zero audit rows and zero
authentication. So the label points at a *shape* that converges — the failure shape, 2 of 2 among
repos that have the surface, textually independent — while the *practice* it implies has 0 of 5
external warrant. **The tenth failure was "the fleet converged on the disease"; this is the eleventh
and it is "the fleet converged on not catching it."** Ask not only what the siblings agreed to do,
but whether they agreed to be in the situation at all — a leaf whose convergence is *avoidance* is
telling you the prescription should be §4 step 1, and this path's is.

**2. "the DB holds encrypted credentials and 4,972 event rows" — the console does not reach that
database.** Two databases: `state.db` = `personas.db` (241 tables, `credential_fields` 42 rows,
`persona_events` 4,972, 5 encrypted-value columns) and `state.user_db` = `personas_data.db` (68
tables, **0 encrypted-value columns**). The `personas_database` connector resolves to `user_db`
(`db_query.rs:548-551`), so the console's local lane reaches **the companion brain, not the vault** —
1,779 conversation turns, 1,554 nodes, 90 distilled facts, the vector KB. **The correction makes the
finding sharper, not milder**: the reachable store is the one with no encryption at rest and the one
whose contents are the operator's own conversations, and the *only* thing keeping the console out of
the credential database is the hand-written `ATTACH`/`DETACH` deny-list at `db_query.rs:2589` —
verified by execution, because a read-only handle still attaches and still reads a second file. The
one model-facing door onto `personas.db` is `operations_views`, and it has no query string at all.

**3. "`dev_tools_http.rs:468-510` is an unauthenticated loopback route that spawns a billed
subprocess. Find every sibling on that transport and ask which of them reach the database." —
verified, and the answer is none.** All **31** `.route(` registrations in `dev_tools_http.rs` were
enumerated. Zero take a query string; the only rusqlite call in the file is a literal
`params![ws, dedup_key]` at `:430`. `local_http`'s other routers (`hooks.rs`, `push.rs`,
`browser_bridge`, `orchestration/mcp`) likewise. **The unauthenticated transport does not reach this
leaf.** That is a real result and it narrows the blast radius considerably — the query doors are all
behind `#[requires(privileged)]` IPC or behind the companion's approval machinery. Which is why §0 is
about the approval machinery.

> **"Zero take a query string" is FALSE, corrected 2026-08-17 by
> [inbound-endpoint-surface](./inbound-endpoint-surface.md).** Four handlers in that file take
> `Query<…>` — `patterns_index` (`:202`), `patterns_consult` (`:232`), `list_kpis` (`:620`) and
> `list_use_cases` (`:1118`) — and **the module's own header documents one of them**
> (`//! GET /kpis/{project_id}?status=proposed`, `dev_tools_http.rs:21`).
>
> **The conclusion above nevertheless holds, and that is the instructive part.** All four parameters
> land in `repos/dev_tools.rs` calls that bind `?1`/`?2`, and `resolve_scope` reads them as
> workspace/project ids — so no caller-authored SQL reaches this leaf, exactly as stated.
> **A false premise whose conclusion survives is the hardest kind to notice, because nothing
> downstream ever contradicts it**, and this one was carried forward into a later brief as fact.
> The app-wide query surface is **7 axum `Query<…>` extractors** plus one hand-rolled
> `url.query_pairs()` parser in the OAuth callback — and the hand-rolled one is the only query
> surface in the app carrying an authentication value.

**4. "The doctrine's first place types cannot reach is *inside a SQL string literal*. This leaf is
that hazard's home. Test whether the console's own queries are checkable at all." — confirmed, and
the honest answer is worse than the doctrine's, in a way that changes the prescription.** In the
earning case the string was written by a developer, so a test could have caught it. Here the string
is written at runtime by a user or a model, so **there is nothing to compile and nothing to test —
the hazard is not a gap in the type system, it is the feature.** That is why §2 does not propose a
better parser: it proposes moving the control off the string entirely and onto the principal, and §6
measures a read-only handle refusing nine statements the classifier has to get right by hand. **The
generalisation worth carrying up to the doctrine: when the untrusted value IS the program, the answer
is not a type on the value but a constraint on the executor.**

**5. "A model can reach a query path: measure whether any MCP tool, agent capability, or chain step
can put a string into a SQL execution, and what bounds it." — five of eight doors, and the brief's
framing of "what bounds it" admits an answer it did not anticipate: for the worst door, the bound was
a human, and the human is a runtime setting in a different file.** The MCP surface is clean (20
tools, none takes `sql` — checked). The chain/system-op surface is clean. The reachable doors are the
`personas_database` connector's `execute_select`/`execute_mutation`, `query_debug.rs`'s
auto-executing retry loop, `nl_query.rs` (generates but does not execute — cleared), and the ChatTab
lane. `execute_mutation`'s bound is `starts_with` over seven verbs including `drop`, plus an approval
that `companion_autonomous_mode = "true"` dissolves. **§0 is that chain and it is the document's
headline.**

**6. A prediction of my own, disproved and recorded.** From `executeDbQuery`'s six-parameter API
signature `(credentialId, queryText, savedQueryId, allowMutation, ddlOnly, queryId)` and the hook's
five-argument call `(credentialId, text, queryId, allowMutation, execId)` I drafted a P0: the
execution id is landing in `ddlOnly`, `ddl_only: Option<bool>` is receiving a UUID string, and the
cancellation handle is being dropped. **It is not.** The store slice in between
(`databaseSlice.ts:145-147`) has its own five-parameter signature and passes `undefined` for
`ddlOnly` explicitly. The finding survives in a much smaller form — `ddl_only` has zero true call
sites (§7.C) — and the near-miss is worth recording because *two* adjacent optional parameters of
different types, mediated by a third signature, is exactly the shape that makes a reader confident
about something they have not traced.

**7. A correction to my own instrument, caught by the doctrine's own rule.** The first run of the
`PRAGMA query_only` experiment used **one** throwaway database for all three configurations, so
`DROP TABLE zz` in the baseline made six later rows read `no such table` — results that looked like
refusals and were not. Re-run with a **fresh database per configuration**; §6's table is the clean
one. Same family as the `head -3` truncation the doctrine records: *the measurement's own side effects
were being reported as the measurement's findings.* Assert the instrument, then re-assert it after
the first result surprises you.

**8. The §9 rule disagreed with its own second implementation by exactly 1, and the rule was
wrong.** An asymmetric whitespace bound (`{0,8}` before the separator, `{0,12}` after) split a single
`matches!` arm across a leading-pipe continuation line and counted one vocabulary as two. Symmetric
`{0,20}` on both sides brought the two implementations to identical count *and* membership. Recorded
because the disagreement was one match on a rule whose whole population is seven — small enough to
dismiss as noise, and it was the defect.

**Scratch artifacts.** The transliteration harness, the port-validation replay, the differential, the
`query_only` experiment, the two independent scanners, the fail-loud driver and the private rule
registry live in the session scratchpad and were not written into the working tree. **Both database
copies were deleted when the measurement finished.** The only file this composition adds is this
document. `scripts/census/rules.json` was **not** edited — both rules ship as the fenced JSON above,
per the contract's concurrent-composer rule.
