# Golden path — Bulk command variant

> Situation node: `backend-runtime/command-definition/bulk-command-variant` ·
> [situation spine](../situation-spine.md) · recurrence 31 · risk **medium** ·
> sides: **server** (the spine also carries `twoSided: true` **and**
> `fusedAcrossSides: true` — see §12.1) · convergence: **mixed** ·
> dimensions: **performance · ui · function**
> Composed 2026-08-16 against `master` @ `e3c5e0d7f`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri/` (the four sibling crates `src`, `db`,
> `core`, `engine`), of which **564** are under `src-tauri/src` — the command tree, and the census
> root. All **1,585** commands registered in the `invoke_handler` were enumerated from
> `src/lib/commandNames.generated.ts` and matched back to their **1,664** `#[tauri::command]`
> definitions (**0** registered commands had no definition). Every command's parameter list was
> parsed at paren-depth 0 over comment-and-string-stripped source, and every one taking a
> collection was classified by what its return type can say. All **4,829** `.ts`/`.tsx` files under
> `src/` were swept for the consumer half: each command's `src/api/` wrapper was resolved from the
> command-name string literal, then its non-`api` call sites, then whether any of them reads a
> per-item field.
>
> **Measured by execution, not by reading.** Two commands were replayed **verbatim** — schema,
> pragmas and statements transcribed from this tree — against a scratch SQLite file (`node:sqlite`,
> `PRAGMA foreign_keys = ON` per `db/src/lib.rs:201`): `bulk_assign_tools` against its singular
> sibling `assign_tool` under three input shapes, and `dev_tools_reorder_goals` under four. §0
> publishes what the caller is told beside what happened. Read-only **copies** of the operator's
> live `personas.db` (347 MB) and `personas_data.db` (17.5 MB) were queried, copied 2026-08-16
> 21:17 with the app running (`engine-leader.lock` live); the live files were never opened for
> write, and the copies were deleted afterwards. **No bulk command was invoked against the running
> app.**
>
> **`cargo` was not run.** Every Rust claim is static and traces to a file read during composition.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It produced the sharpest clause in this document
> (§6 clause 3), one claim this repo **refutes** (§6 clause 8), and one silence.
>
> **Settles:** what the plural sibling of a singular command does differently, what it silently
> stops doing, and what it is able to tell the caller when 5 of 8 landed.

---

## 0. The headline

**A plural command inherits exactly what the repository function it happens to call inherits — and
nothing its singular sibling put anywhere else. Then it answers with a number.** Of **44** Tauri
commands that take a list of entity ids, **14 return a scalar or unit**, **6 name the per-item
outcome**, and the remaining 24 are reads, job-starters, or single-entity writes whose id list is a
field rather than a target set. 14 + 6 + 24 = 44, exactly.

### Executed, not argued

Replayed verbatim from `db/src/repos/resources/tools.rs` against the real `persona_tools` schema
(`db/src/migrations/schema.rs:69-78`, `UNIQUE(persona_id, tool_id)`, FK on `tool_id`):

| scenario | `bulk_assign_tools(persona, ids)` says | N × `assign_tool(persona, id)` says | truth |
|---|---|---|---|
| 4 selected, 1 already assigned | **`3`** | `created, existing, created, created` | 3 new, 1 already there |
| 4 selected, 1 id names no tool definition | **`Err("FOREIGN KEY constraint failed")`**, **all four writes rolled back**, no id named | `created`, `existing`, **`NotFound(t9)`**, `created` | 3 should land, exactly 1 should be refused |
| 1 selected, with a `tool_config` | writes `tool_config = NULL` | writes `tool_config = {"budget":5}` | — |

The plural is not the singular in a loop. `assign_tool` (`tools.rs:377-431`) opens with
`get_definition_by_id(pool, tool_id)?` — *"Validate tool_id exists before assigning"* — and returns
the existing row if there is one. `bulk_assign_tools` (`tools.rs:469-497`) is a bare
`INSERT OR IGNORE` inside one `unchecked_transaction`, with **no validation call at all**. SQLite's
`OR IGNORE` does not suppress foreign-key violations, so the one bad id takes the other three down
with it, and `Result<u32, AppError>` has nowhere to put "these three would have worked".

And `u32` is the answer in the *good* case too: the command returns `3` for a selection of 4, and
"one was already assigned" and "one was refused" are the same value.

Then `dev_tools_reorder_goals` (`db/src/repos/dev_tools.rs:861-873` — N `UPDATE`s on a **pooled
connection with no transaction**, affected-row count discarded, `Result<(), AppError>`):

```
B1  clean reorder of 5              -> Ok(())   g5=0 g4=1 g3=2 g2=3 g1=4          correct
B2  a busy lock at item 3 of 5      -> Err      g1=0 g5=0 g2=1 g4=1 g3=2          TWO duplicate order_index values
B3  an id from ANOTHER project      -> Ok(())   the foreign row was renumbered    silent cross-tenant write
B4  an id that does not exist       -> Ok(())   nothing happened, nothing said     0 rows affected, nobody looked
```

B2's duplicate ordering is not hypothetical: the operator's live database holds one right now —
`dev_goals`, project `dbaa0abb-9950-4dc9-a6fc-4aba22f62352`, **two rows at `order_index = 0`**. B3
is a type problem, not a bug: `dev_tools_reorder_goals(ids: Vec<String>)` has **no `project_id`
parameter**, so the server has nothing to scope the write against — and the frontend wrapper
*holds* one and deliberately does not send it (`src/api/devTools/devTools.ts:189-196`).

### The location law, and its three witnesses

The plural is a *different function*. It therefore gets whatever its callee does, and nothing else.
Three cases, all in this tree:

**1 — A safety phase that lives in the command layer is lost.** `delete_persona`
(`commands/core/personas.rs:671-843`) runs a documented two-phase drain — the same file calls it
*"the app's most safety-critical path"* (`:913`): `mark_deleting` to block new executions → cancel
every running/queued execution → wait ≤15 s for `all_slots_cleared` → `force_cancel_all_for_persona`
on timeout (*"prevents active tasks from writing to DB rows that are about to be CASCADE-deleted,
which would cause silent data corruption or foreign-key constraint violations"*, `:806-809`) →
`repo::delete` → reclaim the orphaned custom-icon file → `unmark_deleting`.

`bulk_delete_personas` (`:66-73` → `db/src/repos/core/personas.rs:1826-1878`) does **one** of those:
the system-persona check, re-implemented as a `protected` outcome. It calls `repo::delete` — the
*last* step — directly. It takes no `AppHandle`, so it could not reclaim an icon even if it wanted
to. Its own docstring says it *"Iterates the same single-persona drain path server-side"*
(`personas.rs:1823-1824`). **It names the drain and does not do it.** Latent today: 0 of 78 personas
have a running or queued execution, and 0 draft personas have any execution history — but 2,188
executions have run on this install, and the "delete drafts" button (`PersonaOverviewActions.tsx:127`)
routes every one of them through this door.

**2 — A post-commit side effect that lives in the command layer is lost.**
`dev_tools_workspace_knowledge_decide` (`commands/infrastructure/dev_workspaces.rs:201-250`) calls
`repo::decide_knowledge_cas(...)` and then, for `adopt`, `repo::materialize_pending_for_practice` —
one backlog idea per member project that owes the practice.
`dev_tools_workspace_knowledge_decide_bulk` (`:274-284`) calls `repo::decide_knowledge_bulk` and
returns. `materialize_pending_for_practice` has **exactly one production call site in 963 files**,
and it is in the singular. So bulk-adopting 50 practices adopts them and materialises **nothing**,
while adopting the same 50 one at a time materialises N. The command's own docstring reads *"Same
governance gate as the single decide … only the batch size changes."* Live: **1,164 adopted**
practices, **22** `dev_ideas` rows with `scan_type = 'workspace_practice'`.

**3 — And the direction inverts when the safety lives in the repository function.**
`persona_memories` has three delete doors and they disagree about the vector store:

| door | repo fn | drops the KNN vector? |
|---|---|---|
| `delete_memory` (singular) | `crud_delete!("persona_memories")` (`db/src/macros.rs:207`) | ❌ no |
| `batch_delete_memories` (plural) | `memories.rs:821` → `spawn_delete_memory_embeddings(ids)` (`:843`) | ✅ **yes** |
| `delete_all_memories` (`_all`) | `memories.rs:1052` — a bare `DELETE … WHERE tier != 'core'` | ❌ no |

**The plural is the only correct one.** Latent: 5,158 embeddings against 6,535 memories (the 1,377
`archive`-tier rows correctly carry none) and **0 orphans**, so no single-delete has yet hit an
embedded row. `delete_all`'s `tier != 'core'` exemption is real and documented — *"Without the
guard this single, unscoped, workspace-wide call would irreversibly nuke every persona's pinned
identity memories on one click"* — and on this install there are **0 core-tier rows**, so it would
delete all 6,535.

### Then look at the denominator

| | count | |
|---|---:|---|
| registered Tauri commands | **1,585** | 1,664 `#[tauri::command]` definitions |
| plural commands with a morphological singular sibling | **31** | e.g. `bulk_delete_personas` ← `delete_persona` |
| commands taking a `Vec` of entity ids (`ids` / `*_ids` / `keys` / `*_keys`) | **44** in 32 files | the anchor |
| — return a **scalar or unit**: partial success unrepresentable | **14** in 10 files | §9's population |
| — return a **per-item outcome** | **6** in 5 files | the positive control |
| — residual: reads, job-starters, single-entity writes | **24** | named in §9 |
| of the 44: carry an **item cap** | **4** | `MAX_BULK_DLQ_BATCH = 200` (×2), `MAX_BATCH_IDEAS = 30`, `parent_ids.len() > 5` |
| of the 44: say anything about an **empty list** | **10** | the rest silently succeed on `[]` |
| bespoke per-item outcome shapes in the tree | **6** | in six files, no shared type |
| generic per-item outcome types that exist | **1** | `LaneOutcome<T>` — **0 reachable call sites** |

**`SkippedIdea { idea_id: String, reason: String }`** (`commands/companion/backlog_triage.rs:54`)
and **`DispatchSkip { idea_id: String, reason: String }`**
(`commands/infrastructure/dev_tools.rs:977`) are byte-identical two-field structs in the same
crate, 900 lines apart.

### The one construction that has both halves

The convergence sweep found that across all five sibling repos, **atomicity and singular-reuse are
mutually exclusive with no exception** — every bulk path that loops the singular function is N
independent writes, and every atomic one re-implements the write. Personas refutes it, in one file.

`bulk_retry_dead_letter` (`db/src/repos/communication/events.rs:1114-1163`) does not call the
singular *function* — it shares the singular's **SQL constant** and its **failure-classification
block**, executed against a `tx` instead of a pooled `conn`:

```rust
const RETRY_DLQ_SQL: &str = "UPDATE persona_events …";   // :1008 — ONE statement, two callers
let rows = conn.execute(RETRY_DLQ_SQL, params![id, MAX_MANUAL_RETRIES])?;   // :1036  singular
let rows = tx  .execute(RETRY_DLQ_SQL, params![id, MAX_MANUAL_RETRIES])?;   // :1133  plural
```

So the batch is one transaction (*"the whole commit happens at once so observers never see a
half-retried batch"*, `:1112-1113`) **and** every item is judged by exactly the singular's guard,
with the singular's three reasons — `not_found` / `wrong_status` / `retry_exhausted`, derived by
re-reading the row after a 0-row swap. **Factor the statement, not the function.** That is the
resolution, it is one `const`, and it is the answer §2 mandates.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path,
primitive name or count. Each clause names its warrant.

> **P1 — physics, and the clause everything else follows from.** **A bulk operation is N
> operations, and N operations have N outcomes.** The moment one call covers more than one entity,
> "it worked" and "it failed" stop being a partition of the outcome space. A return type that can
> only hold one verdict has already decided it will lie about at least one case.
> *Warrant: all four degenerate answers — per-item, aggregate-only, nothing, successes-only —
> appear across five sibling repos, sometimes two of them inside one repo.*
>
> **P2 — physics.** **A count is not a report.** "3 of 4 succeeded" and "3 were already in that
> state" and "3 succeeded before the fourth aborted the transaction" are three different facts and
> one integer. A count answers *how many*, and the only question a caller can act on is *which*.
> *Warrant: executed here — the same `u32` carries all three; and found independently in three
> sibling repos, one of which collects the failing ids WITH identity and then flattens them to
> `.length` at the response boundary.*
>
> **P3 — physics, and the sharpest one.** **A bulk endpoint that re-implements its singular sibling
> becomes a way around the gates the singular enforces.** Existence checks, ownership checks,
> state preconditions, drains, and post-commit effects live wherever their author put them; a second
> implementation inherits only what it happens to call. This is not carelessness — it is what
> "collapse N calls into one" *means* unless you take deliberate steps against it.
> *Warrant: the strongest external result in the sweep. Across five repos, every divergence in
> authorization or side effects landed on a re-implementing path and none on a looping one — 10
> bulk paths, 6 looping, 4 re-implementing, and 4 of 4 divergences on the re-implementers.*
>
> **P4 — physics.** **Hoist what belongs to the caller; keep per-item what belongs to the item.**
> A token's scope, a session, a rate budget are properties of the request and may be checked once.
> Ownership, existence, and current state are properties of each row and must be checked N times.
> Getting this backwards is how one authorization decision comes to cover N tenants.
> *Warrant: independently reasoned in two sibling repos with no shared code — one hoists the token
> scope and explicitly refuses to hoist the per-team gate, the other forces the batch homogeneous
> first so that one gate is valid for all of it.*
>
> **P5 — ergonomics.** **A batch needs a ceiling, and the ceiling is a governance number, not a
> performance number.** "How many can one click affect" is a question about what a human can have
> meant, not about what the machine can survive. Choose it from what the operator was looking at.
> *Warrant: 6 caps and 4 absences across the cohort; exactly one names it as governance rather than
> throughput, and it is set to the page size the reviewer sees.*
>
> **P6 — physics.** **Refusing and truncating are different, and a truncation nobody is told about
> is a lie.** A cap that silently slices the input reports success for work it never attempted.
> *Warrant: three sibling caps refuse with an error, two truncate — and of those two, only one
> returns the remainder as a `skipped` count.*
>
> **P7 — physics as a defect.** **Producing the per-item shape and consuming it are independent
> decisions, and they diverge about half the time.** A carefully designed failure list is worth
> nothing until a pixel reads it, and nothing in a type system asks.
> *Warrant: of the six best-shaped bulk return types across six codebases, three are read by a
> consumer that renders the failures and three are discarded at their only call site — one of them
> has no call site at all.*
>
> **P8 — ergonomics.** **Share the statement, not the loop.** The reason bulk paths drift from
> their singular is that "call the singular function" and "do it in one transaction" appear to be
> incompatible. They are not: factor the guarded statement into a constant and let both a pooled
> connection and a transaction execute it.
> *Warrant: 0 of 5 sibling repos do this — every atomic bulk path in the cohort re-implements the
> write — and the one place in this repo that does gets both halves in one file.*
>
> **Scale condition.** P1, P2 and P3 are wrong on day one, at N = 2. P4 bites the first time a
> batch spans two owners. P5 and P6 bite the first time somebody selects all. P7 and P8 are what
> decide whether the fix survives the next feature.

---

## 1. Trigger

- "The UI fires this command once per row — can we make it take a list?"
- "Add a bulk delete / bulk approve / select-all action."
- "Just return the count of how many were updated."
- "Add a `deleteMany` / `bulk_*` / `batch_*` / `import_many` / `reorder_*` variant."
- "One IPC round-trip instead of N."
- "The batch failed — which ones actually went through?"

**If you are about to write** a command whose parameter is `ids: Vec<String>` (or `*_ids`, `keys`,
`items`, `rows`, `inputs`), or a command whose name contains `bulk` / `batch` / `_all` / `many` /
`reorder`, **you are in this situation.**

You are **not** in this situation for a single-entity write whose payload happens to carry a list
(`create_use_case(context_ids)`, `create_share_link(resource_ids)`, `add_annotation(tags)`) — that
is one row with a list-valued field, and 24 of this repo's 44 id-list commands are that or a read.
You are also not in it for a command that *starts one job* over N inputs (`lab_start_eval`,
`genome_start_breeding`) — see the boundaries.

### Boundaries with the adjacent leaves

- [**`bounded-parallel-fan-out`**](./bounded-parallel-fan-out.md) owns **how many of the N run at
  once** and what the combinator returns. This path owns **what the caller is told about each of
  them.** Its `Vec<LaneOutcome<T>>` and this path's `Vec<BulkDeleteOutcome>` are the same idea from
  two sides; its §7 D2 (`try_join_all` pushing credentials to GitLab) is this leaf's condition
  arriving through a combinator instead of through a return type. `dev_tools_start_batch` and
  `companion_dispatch_fleet_plan` are **its** matches, not mine — they spawn processes.
- [**`partial-failure-read-envelope`**](./partial-failure-read-envelope.md) owns **a READ over 2+
  sources**. This path owns **a WRITE over N entities.** Its P3 ("emptiness is a claim; a failed
  read cannot make it") arrives here through a return type rather than a `.catch`: the 24 residual
  commands include `get_rotation_history_bulk` and `get_prompt_versions_bulk`, whose
  `HashMap<id, Vec<T>>` **omits** any credential whose read threw (`commands/credentials/rotation.rs:88-104`,
  log-and-skip). A missing key is `.catch(() => [])` written on the server.
- [**`conditional-write`**](./conditional-write.md) owns **one guarded write and its affected-row
  count**. This path owns **N of them**, and is where that count stops being a boolean and becomes
  a per-item reason: `bulk_retry_dead_letter` re-reads the row after `rows == 1` fails and turns the
  discarded verdict into `not_found` / `wrong_status` / `retry_exhausted`. **That path's `Swap` and
  this path's per-item outcome are the same value at two cardinalities.**
- [**`delete-semantics`**](./delete-semantics.md) owns **what deleting one thing means** (cascade,
  soft vs hard, protection). This path owns **what deleting eight things reports.**
- [**`ipc-command-authorization`**](./ipc-command-authorization.md) owns **whether a command has a
  gate**. This path owns **whether the gate runs once or N times** — see §12.3 for a correction that
  belongs to that path.
- [**`drag-reorder`**](./drag-reorder.md) owns **the gesture and the ordering column**, including
  the atomicity of an N-row sequence rewrite (its `unatomic-sequence-rewrite` rule matches exactly
  the three `reorder_*` repository bodies). This path owns **what the reorder command's signature
  and return type can express** — that it takes no `project_id` and answers `Ok(())`. §7 D3 is one
  defect with two owners.
- [**`transaction-boundary`**](./transaction-boundary.md) owns **`tx` vs `conn`**. This path owns
  the case where the answer is *both*: P8's shared-statement construction.
- [**`bulk-selection-actions`**](../situation-spine.md) (client leaf, recurrence 20) owns the
  checkbox strip and the action bar. This path owns what happens after the button is pressed.

## 2. The one way

**Decide what the caller will be told about item 5 of 8 before you write the signature, then make
the plural run the singular's guarded statement rather than a second implementation of it.**
Concretely: (a) **return one entry per input id**, not a count — `Vec<Outcome { id, status,
reason }>` or a `{ succeeded: Vec<Id>, failed: Vec<{ id, reason }> }` pair; a `usize` is only
honest when the command has no per-item concept at all (a set-scoped `_all` sweep). (b) **Make
`reason` a machine token, not a sentence** — `not_found` / `wrong_status` / `retry_exhausted` — so
the frontend can map it through `tokenLabel` into 14 languages and group by it; a preformatted
`"{id}: {e}"` string is a per-item outcome that only a human can read, and this repo ships two of
them. (c) **Do not re-implement the singular's write — factor its statement.** Hoist the guarded
SQL into a `const` and take a receiver both a pooled connection and a transaction satisfy, so the
batch is one transaction *and* every item is judged by the singular's exact predicate; if you
cannot, call the singular repository function per item and accept N transactions, which is the next
best thing and what the cohort does. (d) **Enumerate what the singular does that is not in that
statement** — an existence probe, an engine drain, a post-commit fan-out, a file reclaim, an event
publish — and either run it per item or write down in the docstring that the bulk path does not,
because the default is that nobody notices for a year. (e) **Check ownership, existence and state
per item; check the token, the tier and the session once** (P4); if the batch can span owners and
you want one check, refuse a heterogeneous batch at the door instead. (f) **Cap the list and refuse
above it** — `if ids.len() > MAX { return Err(Validation(...)) }`, with the constant's comment naming
what the number means; never `.slice(0, MAX)` silently, and if you must truncate, return the
remainder as a field. (g) **Say something about the empty list** — returning `Ok(0)` for `[]` is
fine, returning it *by accident* because the loop did not run is how a no-op reports success.
(h) **Publish the singular's events only for the items that actually changed**, which is what a
per-item outcome gives you for free — `bulk_resolve` returns the ids it flipped precisely so
`incident_resolved` fires once per real transition. Then stop: do not add a second scalar count
beside the outcome list, do not collapse `protected` and `failed` into one number at the frontend,
and do not let the plural take fewer parameters than it needs to scope the write.

If you must get one right first: **(c)**. (a) and (b) produce a visible hole a user can report; (c)
produces a second write path that quietly stops enforcing something, and the only signal is the
absence of a check nobody remembers was there.

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `db/src/repos/communication/events.rs:1008,:1023` — `RETRY_DLQ_SQL` / `DISCARD_DLQ_SQL` as `const`, executed at `:1036` (`conn`, singular) and `:1133` (`tx`, plural) | **the one construction to copy.** One guarded statement, two receivers: the batch is a single transaction *and* every item is judged by exactly the singular's predicate. Zero of six codebases surveyed has anything else that achieves both. |
| `db/src/repos/communication/events.rs:1087-1163` — `BulkDeadLetterOutcome { succeeded: Vec<String>, failed: Vec<BulkDeadLetterFailure { id, reason }> }` | **the per-item outcome type to copy.** `reason` is a *machine token* documented as such (*"the frontend maps this through `tokenLabel`"*, `:1103-1105`), and it is **derived** — a 0-row swap triggers a re-read that separates `not_found` from `wrong_status` from `retry_exhausted`. Both bulk commands cap at `MAX_BULK_DLQ_BATCH = 200` and **refuse** above it (`commands/communication/events.rs:273,:282,:296`). |
| `core/src/models/persona.rs:850-855` — `BulkDeleteOutcome { id, status: "deleted"\|"protected"\|"failed", reason: Option<String> }` | **three statuses, not two.** "Refused by policy" is not "failed", and a UI that cannot tell them apart writes the wrong sentence. Constructed at `db/src/repos/core/personas.rs:1832-1876`. |
| `commands/infrastructure/dev_tools.rs:982-994` — `DispatchIdeasResult { target, dispatched: Vec<DispatchedIdea>, skipped: Vec<DispatchSkip>, started: bool }` | **both halves plus the fact that decides the UI branch.** `started` answers "did anything begin" without the caller re-deriving it from two array lengths. |
| `commands/companion/backlog_triage.rs:107-140` — `dev_tools_athena_triage_batch` | **the complete door.** Empty-list refusal with a *sentence a user can act on*, `idea_ids.len() > MAX_BATCH_IDEAS` (30) refusal that prints the number it got, **de-duplication before the loop** (*"the same idea listed twice would otherwise appear twice in the prompt"*), and a per-item `skipped` with `reason: "already {status}"`. |
| `commands/execution/audit_incidents.rs:178-199` + `db/src/repos/execution/audit_incidents.rs:600-618` — `bulk_resolve` → `Vec<String>` of **the ids this call actually flipped** | **how to publish events from a batch.** The repo returns only the genuinely-transitioned ids so the command can `publish_incident_resolved` exactly once per real transition; the comment names the failure it prevents (two windows resolving an overlapping set re-emitting on the bus). The repo layer also states why it propagates rather than swallows a DB error (`:583-587`). |
| `engine/src/template_checksums.rs:183-205` — `BatchIntegrityResult { results: Vec<TemplateIntegrityResult>, all_valid, total, valid_count, invalid_count, unknown_count }` | **per-item plus the roll-up, and `unknown` as a third bucket** — the same three-bucket discipline `engine/healthcheck.rs:596-655` (`BulkHealthcheckSummary`: `passed`/`failed`/**`unverifiable`**) applies to a sweep. Counts derived from the list, so they cannot disagree with it. |
| `src/features/triggers/sub_dead_letter/DeadLetterTab.tsx:282-345` | **the client half, complete.** `summarizeFailures` groups `failed` by machine `reason` into i18n labels (*"2 retry-exhausted, 1 not found"*); `applyOutcome` removes **only** the succeeded rows and **keeps the failed ones selected**, so the retry button is already aimed. Copy this component's two callbacks. |
| `src/engine/build_session/orchestrator.rs:30-33` — `LaneOutcome<T> { lane: String, result: Result<T, String> }` | **the generic type this leaf wants, already written.** Adopt it — but see §7 D8: it has **zero reachable production call sites**, so adopting it means wiring it, and its `String` error means it cannot carry a token today. |

**Do NOT build:** a seventh bespoke `{ id, reason }` struct (§8 Gap 1); a bulk command returning
`Result<usize>` where the singular returns a row; a bulk write that calls `conn.execute` in a loop
with the count discarded (§7 D3); an `INSERT OR IGNORE` batch standing in for a singular that
validates (§7 D1); a `_all` command with no cap and no confirmation contract; a `failed:
Vec<String>` of preformatted `"{id}: {err}"` (§7 D6); a frontend that collapses `protected` and
`failed` into one number (§7 D7).

## 4. Steps

1. **Find the singular and read its whole body — not just the repo call.** List every phase:
   validation, existence probe, ownership check, the write itself, post-commit effects, event
   publishes, file cleanup, engine coordination. `delete_persona` has seven; `bulk_delete_personas`
   has one.
2. **Decide the return type before the signature.** One entry per input id, with `status` and a
   `reason` token. If you find yourself writing `-> Result<usize, AppError>`, ask what the UI will
   render when the number is smaller than the selection.
3. **Factor the guarded statement, don't fork it.** Hoist the SQL into a `const` (P8,
   `RETRY_DLQ_SQL`) and run it against the transaction. If the singular's logic is bigger than one
   statement, call the singular's repository function per item and accept N transactions.
4. **Re-run the per-item checks the singular runs.** Existence, ownership, state. Hoist only the
   request-level ones (token, tier, session).
5. **Ask whether the type can make the wrong call impossible — before you write the gate.** Here it
   can, at the command signature; see below.
6. **Cap the list, refuse above the cap, and say what the number means.** *"200 is the page the
   console renders — the largest batch a reviewer can honestly claim to have read"* is a cap the
   next person can re-tune; a bare `200` is not.
7. **Deduplicate, and decide what the empty list means.** Both take one line and both are currently
   missing from most of the 44.
8. **Publish events only for the items that changed**, using the outcome list you already built.
9. **Write the client half in the same change.** Group `failed` by `reason` token, render the
   labels, keep the failed rows selected. A per-item outcome with a `{count} succeeded` toast is
   half the work and reads to the user exactly like the version that has no outcome type at all.
10. **Write down what the plural does NOT do**, in the docstring, in the plural. If the drain, the
    icon reclaim or the materialisation is deliberately out of scope, say so — the three worst
    entries in §7 are all cases where the docstring claims parity that the body does not have.
11. **And then stop.** Do not add a second aggregate beside the list, do not retry inside the loop
    without multiplying the cap by the attempt budget, and do not give the plural a shorter
    parameter list than the write needs to be scoped (`reorder_goals` has no `project_id`).

### Can the type make the wrong call impossible? — asked before §9

**Yes, at the command signature, and it is the strongest type answer in this leaf's neighbourhood.**
The bad state is not "an item failed" — it is **"the command's success type has no place to put the
item that failed"**. `Result<usize, AppError>` makes partial success *unrepresentable*;
`Result<Vec<Outcome>, AppError>` makes it **the only representable answer**. There is no early
`?` that can hide an item, because the caller receives a vector whose length is the input's.

Held against the seven qualifications:

- **Q1 (a type carries only what it encodes)** — holds, and this is where the leaf is honest about
  its limits: `Vec<Outcome>` encodes *which item, and a token for why*. It does **not** encode that
  the write was atomic, that the ownership check ran per item, or that the singular's drain
  happened. Those are §2(c)(d)(e), and no return type reaches them. That is why this path's
  prescription is four clauses and not one.
- **Q2 (requiredness ≠ closedness)** — the edit is *closedness* on the outcome (`status` should be
  a Rust enum with `#[serde(rename_all)]`, not `String`; all three current shapes use `String`), and
  it is *presence* on the vector. Making an existing scalar `required` changes nothing; it already is.
- **Q3 (a type nobody constructs constrains nothing)** — **the live objection, and it is why this
  is "wire it", not "write it".** `LaneOutcome<T>` (`orchestrator.rs:30`) is the generic form and has
  **0 reachable production call sites**; six bespoke shapes exist instead. A shared type proposed
  today would be the seventh. So the honest proposal is: make **one** of the six `pub` in a shared
  module and route the next bulk command through it, rather than minting an eighth name.
- **Q4 (a type anyone can construct authenticates nothing)** — relevant: `BulkDecision { failed:
  Vec<String> }` is constructible with an empty `failed` from a path that never checked, and
  `PushSyncResult { errors: Vec<String> }` likewise. The vector's *presence* is what the type
  guarantees; its *truthfulness* is not, which is why §2(c) is about the write path and not the type.
- **Q5/Q6 (withhold the dangerous freedom, not the answer)** — the dangerous freedom is *answering
  with one verdict for N items*. Withhold the scalar success type. Do **not** withhold the roll-up
  counts: `BatchIntegrityResult` carries both and its counts are derived from the list, so they
  cannot drift.

**And one destination needs fixing before a gate points at it** (contract, fifth §9 failure mode).
Routing callers to "return a per-item outcome" is worth little while the repo's per-item outcomes
carry `reason: String` free text in two of six cases (`BulkDecision`'s `format!("{id}: {e}")`,
`PushSyncResult`'s `errors: Vec<String>`). Those cannot be grouped, cannot be counted by cause, and
cannot be translated — `DeadLetterTab`'s `summarizeFailures` works only because *its* reason is a
token. **Make the token the default in the shared shape, or the gate will route people to a type
that still cannot say the true thing in 14 languages.**

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`-> Result<usize \| u32 \| i64, AppError>` from a command taking `ids: Vec<String>`** | Partial success is unrepresentable. **14 of this repo's 44 id-list commands.** Executed: `bulk_assign_tools` returns `3` for a selection of 4, and "already assigned" and "refused" are the same value. §7 D1. |
| **`-> Result<(), AppError>` from a bulk write** | Worse: not even the count. The three `reorder_*` commands. Executed: `Ok(())` for a non-existent id, `Ok(())` for an id belonging to another project. §7 D3. |
| **Re-implementing the singular's write instead of running its statement** | The second implementation inherits only what it calls. `bulk_assign_tools` has no `get_definition_by_id`; `bulk_delete_personas` has no drain; `decide_bulk` has no materialisation. **P3, and 4 of 4 cross-repo divergences land here.** §7 D1, D2, D5. |
| **A docstring claiming parity the body does not have** | *"Iterates the same single-persona drain path"* (it calls the last step), *"Same governance gate … only the batch size changes"* (the post-commit fan-out is absent). The claim is what stops the next reader from checking. §7 D2, D5. |
| **`INSERT OR IGNORE` as the bulk form of a validating singular** | `OR IGNORE` suppresses UNIQUE, not FOREIGN KEY. Executed: one unknown id → `FOREIGN KEY constraint failed` and **all four writes rolled back**, error names no id. §7 D1. |
| **N `conn.execute` in a loop on a pooled connection** | No transaction, so a failure at item k persists 0..k−1. Executed: two duplicate `order_index` values and an unstable sort — and the live database already holds one. Owned as an atomicity question by `unatomic-sequence-rewrite`; owned here as a *reporting* question. §7 D3. |
| **A bulk command with fewer parameters than the write needs to be scoped** | `dev_tools_reorder_goals(ids)` has no `project_id`, so a foreign id is silently renumbered and the server cannot refuse. The frontend wrapper *holds* the project id and does not send it. §7 D3. |
| **`failed: Vec<String>` of `format!("{id}: {e}")`** | A per-item outcome only a human can read: not groupable, not countable by cause, not translatable. Two of six shapes here. Compare `BulkDeadLetterFailure { id, reason: token }`. §7 D6. |
| **No item cap** | **40 of 44.** "Select all" is a button. A cap is one `if` and its comment is where the number's meaning lives. §7 D4. |
| **A cap that truncates instead of refusing** | Reports success for work never attempted. Not present here (all 5 caps refuse); present twice in the sibling cohort, once silently. |
| **Building a per-item outcome and toasting only the count** | The type was the work; the sentence is the value. `AthenaVerdictCard.tsx:112-119` reads `accepted`/`rejected` and never `failed`, whose docstring says *"reported, never swallowed"*. §7 D7. |
| **A frontend that collapses `protected` and `failed`** | "Skipped 2" covers *"the Director cannot be deleted"* and *"the database was locked"*. `PersonaOverviewActions.tsx:82-89`. §7 D7. |
| **`HashMap<id, T>` as a bulk read's return** | A key that is absent because the read threw is indistinguishable from a key that is absent because there is nothing. `get_rotation_history_bulk` logs and skips. This is [`partial-failure-read-envelope`](./partial-failure-read-envelope.md) P3 on the server. §7 D9. |

## 6. Evidence

**The one site to copy: `src-tauri/db/src/repos/communication/events.rs:1008-1163` — the DLQ pair.**

```rust
const RETRY_DLQ_SQL: &str = "UPDATE persona_events …";     // :1008 — ONE statement …

pub fn retry_dead_letter(pool: &DbPool, id: &str) -> Result<PersonaEvent, AppError> {
    let rows = conn.execute(RETRY_DLQ_SQL, params![id, MAX_MANUAL_RETRIES])?;   // :1036  … pooled conn
    if rows == 0 { /* re-read the row; classify into 3 reasons */ }
}

pub fn bulk_retry_dead_letter(pool: &DbPool, ids: &[String]) -> Result<BulkDeadLetterOutcome, AppError> {
    let tx = conn.transaction()?;                                              // :1127  … and a tx
    for id in ids {
        let rows = tx.execute(RETRY_DLQ_SQL, params![id, MAX_MANUAL_RETRIES])?; // :1133  same statement
        if rows == 1 { succeeded.push(id.clone()); } else {
            let current = tx.query_row("SELECT status, retry_count …")…;        // :1140  the SAME re-read
            let reason = match current {
                None                                        => "not_found",
                Some((status, _)) if status != "dead_letter" => "wrong_status",
                Some((_, rc)) if rc >= MAX_MANUAL_RETRIES    => "retry_exhausted",
                Some(_)                                     => "wrong_status",
            };
            failed.push(BulkDeadLetterFailure { id: id.clone(), reason: reason.into() });
        }
    }
    tx.commit()?;                                                              // :1159  ONE commit
    Ok(BulkDeadLetterOutcome { succeeded, failed })
}
```

Six decisions worth copying: (1) the statement is a `const`, so the guard cannot drift between the
two paths; (2) the receiver differs, so the batch is atomic and the singular is not forced into a
transaction it does not need; (3) `rows == 1` is the per-item verdict — this is
[`conditional-write`](./conditional-write.md)'s discarded `usize`, *not* discarded; (4) the reason
is **derived** by re-reading, so `not_found` and `wrong_status` and `retry_exhausted` are three
facts rather than one "failed"; (5) the reason is a **token**, and the docstring says why
(`:1103-1105`); (6) the command layer adds what the repo cannot know — `ids.len() >
MAX_BULK_DLQ_BATCH` (200) with a refusal (`commands/communication/events.rs:282-286`).

**Live-input caveat, stated rather than buried.** `persona_events` holds **4,941 `delivered`** and
**31 `skipped`** rows on this install and **zero `dead_letter`** rows — so the best implementation of
this leaf in the repo currently has nothing to act on, while the weakest (`bulk_assign_tools` over
210 rows, `bulk_acknowledge_audit_incidents` over 99 open incidents, `dev_tools_bulk_delete_ideas`
over 236 ideas, `batch_delete_memories` over 6,535 memories) all have real inputs. **Quality is
inversely correlated with live population here**, which is a reason to copy this pattern outward
rather than a reason to discount it.

Its own docstring is this golden path, written before it:

> *"Each id is evaluated independently — exhausted retries or missing ids land in `failed` rather
> than aborting the batch, so an operator clicking 'Retry selected' never gets stuck on one stale
> row. The whole commit happens at once so observers never see a half-retried batch."*
> — `events.rs:1109-1113`

**And the client half that completes it: `DeadLetterTab.tsx:282-345`.**

```ts
const summarizeFailures = (failed: BulkDeadLetterFailure[]) => {
  const counts: Record<string, number> = {};
  for (const f of failed) counts[f.reason] = (counts[f.reason] ?? 0) + 1;   // group BY REASON
  return Object.entries(counts).map(([reason, count]) => `${count} ${labelFor(reason)}`).join(', ');
};
const applyOutcome = (outcome: BulkDeadLetterOutcome) => {
  const succeeded = new Set(outcome.succeeded);
  setEvents((prev) => prev.filter((e) => !succeeded.has(e.id)));   // remove ONLY what landed
  setSelected((prev) => { … keep every id NOT in succeeded … });   // failed rows stay selected
};
```

The user is told *"4 of 6 retried — 1 retry-exhausted, 1 not found"*, in their own language, with
the two failures still selected so the next click is already aimed. **This is the only place in the
app where a bulk failure survives all the way into pixels with its cause intact.**

**Also exemplary:**

- **`commands/companion/backlog_triage.rs:107-140`** — the complete front door: empty refusal with
  an actionable sentence, `MAX_BATCH_IDEAS = 30` refusal that prints what it got, de-duplication
  before the loop with the reason stated, per-item `skipped` with `reason: "already {status}"`.
- **`db/src/repos/execution/audit_incidents.rs:600-618`** — `bulk_resolve` returning *the ids this
  call flipped*, so `commands/execution/audit_incidents.rs:193-197` publishes `incident_resolved`
  once per real transition. The event-publishing pattern for a batch, in four lines.
- **`engine/healthcheck.rs:596-655`** — `BulkHealthcheckSummary`'s three buckets (`passed` /
  `failed` / **`unverifiable`**) with `failed` derived by subtraction so the buckets conserve, and
  the comment that is this leaf's thesis: *"a vault of entirely unprobed credentials would report
  'N passed, 0 failed' and read as fully verified."*
- **`db/src/repos/core/personas.rs:1826-1878`** — `Vec<BulkDeleteOutcome>` with **three** statuses.
  `protected` is not `failed`, and the frontend has the information to say so even though it
  currently does not (§7 D7).

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** 10 bulk write paths found outside this
repo; the key claims below were re-opened and verified by hand.

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **A plural variant gets built wherever there is a list UI** | **PHYSICS (4/5)** | brainiac 2 (`console.rs:371`, `http.rs:844`), vibeman 5, ascent 4, personas-cloud 1. Silence: **`personas-web` has NO bulk write endpoint** — all 10 API routes are singular and both bulk paths are client-side loops (`useReviewBulkActions.ts:110`, `eventStore.ts:193`). Where bulk lives is not converged: a transport route, a React hook, and a repository method are all used. |
| 2 | **Can the type say "5 of 8"?** | **LOCAL — and all four degenerate answers exist, sometimes in one repo** | (a) per-item + reason: `BulkReviewRow{promotion_id, ok, status, error}` (brainiac `console.rs:336`), `RepoResult{repo, ok, error}` (ascent `apply-batch:27`), `failed:[{id,error}]` (vibeman `ideas/approve:70-77`); (a−) identity, no reason: `failedIds` (personas-web `useReviewBulkActions.ts:22`), `failed: string[]` (ascent `org/watch:60`); (b) aggregate only: `{succeeded,failed,aborted,skipped}` (personas-web `eventStore.ts:232`); (c) nothing: `reorderHubLinks(): void` → `{reordered:true}` (vibeman `knowledge.repository.ts:400`); (d) successes only: `{data: results, movedCount}` (vibeman `batch-move:39-43`). Personas holds all four too. |
| 3 | **⚠ THE SHARPEST — a re-implementing bulk path is where the gates go missing** | **PHYSICS (4 of 4 divergences, 0 exceptions)** | 10 sibling bulk paths: **6 loop the singular, 4 re-implement.** Every authorization or side-effect divergence found landed on a re-implementer and none on a looper. vibeman `batchMoveContexts` writes its own `CASE WHEN` UPDATE (`context.repository.ts:283-288`) where the singular calls `updateContext`, checks only `!move.contextId`, and derives **one** project for `scheduleContextMapExport` from `results.find(c => c.projectId)` (`batch-move:36-37`) — so a cross-project batch leaves the other projects' `context-map.json` stale. ascent `setRepoSegmentsBulk` uses `createMany`/`deleteMany` where the singular upserts, and *"unknown fullNames are ignored"* by design (`segments.ts:138`). **Identical here**: every §7 divergence (D1, D2, D5) is a re-implementer. |
| 4 | **brainiac wrote this leaf's best sentence, unprompted** | **the cohort's clearest statement** | `console.rs:185-191`: *"the bulk endpoint calls it once per id. That is the whole design of bulk: every gate here runs per item, under that item's own transaction, so a batch is exactly N single reviews and cannot be a cheaper path to the same writes. A batch-shaped query (`WHERE id = ANY($1)`) would have been one round trip and **one authorization decision for N teams** — which is how a bulk endpoint quietly becomes a way around the gate it is supposed to honour."* No shared document with this one. |
| 5 | **P4 — hoist request-level checks, keep item-level ones per item** | **PHYSICS (2 independent inventions)** | brainiac `console.rs:400-403`: *"`write` scope once — it is a property of the token, not of an item. The per-TEAM maintainer gate is emphatically NOT hoisted here: it runs inside `review_one`, per item, because the batch may span teams."* ascent reaches the same place from the other side — `apply-batch:64-67` **refuses a heterogeneous batch** (`owners.size > 1` → 400) *so that* one `requireOrgAccess(owner)` is valid for all of it. |
| 6 | **An item cap** | **MIXED (6 caps, 4 absences) — and only one names it as governance** | brainiac `BULK_MAX = 200` (`console.rs:317`) and `MAX_BULK_ITEMS = 100` (`http.rs:149`), both **refuse**; vibeman `ideas/approve:31` 200, refuses; ascent `MAX_BATCH = 25` (`apply-batch:25`) **truncates** and reports `skipped`; ascent `MAX_BULK = 500` (`org/watch:17`) **truncates silently**; personas-cloud clamps to 10. brainiac is alone in `console.rs:309-316`: *"Not a performance number — a governance one … 200 is the page the console renders … the largest batch a reviewer can honestly claim to have read."* Personas: **4 of 44**, all refusing. |
| 7 | **⚠ P7 — the per-item shape is produced and then discarded** | **PHYSICS AS A DEFECT (3 read / 3 discard)** | READ: brainiac `ReviewWorklist.tsx:287-296` (`for (const r of out.rows) if (!r.ok) failed.set(r.id, r)`, failed rows stay selected); personas-web `BulkResultToast.tsx:31-36` + a **Retry** button wired to `retryFailed(failedIds)`; ascent `useInstallationRepos.ts:294-302` reverts exactly the failed rows. DISCARDED: vibeman's MCP `resolve_approval` types the response as `{success, error?, updatedCount?, status?}` (`mcp-server/tools/ideas.ts:208`) so `failed[]`/`notFound[]` are **unreachable through the type**; personas-web `EventsListPanel.tsx:81` is `await replayEvents(selected);` with no destructure, dropping a four-field aggregate **including a circuit-breaker `aborted` flag**; vibeman `batchAcceptImplementations` has a well-shaped `{acceptedCount, failedIds, errors}` and **zero call sites**. |
| 8 | **Atomicity and singular-reuse are mutually exclusive** | **REFUTED — and Personas is the only repo that refutes it** | Across all five siblings the correlation is exact: every atomic bulk path re-implements the write (vibeman `reorderHubLinks` `db.transaction`, vibeman's `CASE WHEN`, ascent's `createMany`, personas-cloud's one-execution batch) and every looping path is N independent writes. `bulk_retry_dead_letter` breaks it by sharing the **statement** rather than the function (`RETRY_DLQ_SQL` at `events.rs:1008`, run against `conn` at `:1036` and `tx` at `:1133`). Reported as a Personas-ahead result — **n = 1 out of 44**, so it is an achievement and an adoption problem at once. |
| 9 | **A reusable generic per-item result type** | **SILENCE — 0 of 6** | ~14 distinct bespoke vocabularies across the cohort, none shared, none generic. ascent proves the *concurrency* half is factorable (`mapPool`, `src/lib/pool.ts:14`, 9 production call sites) and still has 4 bespoke result shapes over it. brainiac maintains **three** near-identical shapes for one endpoint (`BulkReviewRow` server-side, `BulkRowOutcome` in `review-surface.ts:70`, `BulkRow` in `actions.ts:92`, with a hand-written mapping at `actions.ts:123`). **Personas is the only repo that has WRITTEN the generic type — `LaneOutcome<T>` — and the only one that does not use it.** |
| 10 | **The plural is sometimes RICHER than the singular** | **MINORITY (2/6), reported so nobody reads this leaf as "plural is always worse"** | personas-web's bulk review adds a 5 s undo window, `setPollPaused(true)`, an unmount flush and rollback-on-failure (`useReviewBulkActions.ts:148-161, 218, 294-303`) — none of which the singular has. Here: `batch_delete_memories` is the **only** one of `persona_memories`' three delete doors that drops the KNN vector. |

**Physics — keep as doctrine:** clauses 1, 3, 5, 7 (the last as a defect).
**Reported as silence:** clause 9 (*nobody has a generic per-item result type*), and
`personas-web` having no bulk write endpoint at all.
**Personas is ahead** on clause 8 (shared-statement atomicity) with n = 1, and **behind** on
clause 6 (4 of 44 capped, against brainiac capping both of two).

> **The counter-example that keeps this honest is `personas-cloud`, and it is instructive.** Its
> one batch endpoint (`packages/orchestrator/src/httpApi.ts:1864`) takes a `count`, not an id list,
> and submits **one** execution carrying a batch prompt — *"the LLM produces all personas in one
> call"* (`:1890`). "5 of 8 landed" there means the model emitted 5 parseable designs. And it is the
> only repo whose *status enum itself* names the state: `types.ts:411` documents
> `partial: some items succeeded, some failed`. **A one-write batch still needs a per-item result
> type** — which is the clearest available proof that this leaf is about the report, not about the
> loop.

## 7. Deviations

Every entry is live on `master` @ `e3c5e0d7f` and was verified by reading the file, by replay, or
against a read-only copy of the operator's database. **Per the campaign's no-destructive-applies
rule these are notes for later, not asks** — nothing here should be applied while the app is in
daily use without the operator's say-so.

### D1 — `bulk_assign_tools` is not `assign_tool` in a loop; it is a different, unvalidated write

`commands/tools/tools.rs:93-111` → `db/src/repos/resources/tools.rs:469-497`, against
`tools.rs:377-431`. Executed in §0. Three differences:

- **No existence validation.** The singular's first statement is
  `get_definition_by_id(pool, tool_id)?`. The plural has none, and relies on the FK to reject —
  which it does by killing the transaction, so one bad id costs all N and the message names none.
- **`tool_config` is hard-coded `NULL`** (`:487`). The singular takes it as a parameter. Latent:
  **0 of 210** live `persona_tools` rows carry a non-null `tool_config`.
- **`u32` cannot separate "already assigned" from "newly assigned"** under `INSERT OR IGNORE`.

The consequence is not cosmetic. `is_tool_assigned` (`tools.rs:449-462`) is described as a security
gate — *"callers (even privileged) must not be able to run a tool against a persona it was never
configured for"* — so `persona_tools` is an authorization table, and the plural is the door into it
that does not check what it is writing. Today the FK holds the line (**0 orphan `tool_id`s live**);
the moment the FK is relaxed or the table gains a non-FK column, it does not.

The consumer completes the loss: `src/stores/slices/agents/toolSlice.ts:90-98` does
`await bulkAssignTools(personaId, toolIds)` and **discards the count**, reporting
`"Failed to assign tools"` on error.

**Fix (note):** call `assign_tool`'s repo fn per id inside the transaction, or hoist its validation;
return `Vec<Outcome>`; thread `tool_config` through.

### D2 — `bulk_delete_personas` skips the drain its own docstring names

`commands/core/personas.rs:66-73`. Detailed in §0. The plural jumps to `repo::delete` — the
singular's *Phase 2c* — skipping `mark_deleting`, the execution cancellation loop, the ≤15 s
`all_slots_cleared` wait, the post-timeout `force_cancel_all_for_persona` sweep, the custom-icon
reclaim, and `unmark_deleting`. It cannot do the icon reclaim at all: it takes no `AppHandle`.

Latent today (0 personas with running/queued executions), and the file itself explains what the
drain prevents: *"active tasks writing to DB rows that are about to be CASCADE-deleted, which would
cause silent data corruption or foreign-key constraint violations"* (`:807-809`). Reachable from two
buttons — batch delete of the selection, and "delete drafts".

**Fix (note):** make `delete_persona_inner` take `&[String]` and drain once for the whole set, then
per-id `repo::delete`, returning the existing `Vec<BulkDeleteOutcome>` with a fourth status for
"could not drain". The drain is naturally batch-shaped — one `mark_deleting` pass, one wait.

### D3 — the three `reorder_*` commands: no transaction, no scope, no verdict, no report

`commands/infrastructure/dev_tools/goals.rs:98,:244` and `.../contexts.rs:80` →
`db/src/repos/dev_tools.rs:861, :1030, :2978` — three byte-identical N-statement loops on a pooled
connection. Executed in §0 (B1–B4). Four defects in twelve lines each:

1. **No transaction** → a failure at item k leaves duplicate `order_index` values and an unstable
   sort. Live: `dev_goals` project `dbaa0abb…` has two rows at `order_index = 0`.
   ([`unatomic-sequence-rewrite`](./drag-reorder.md) owns this half — 1 file, 3 matches, and
   they are exactly these three.)
2. **The affected-row count is discarded** on every statement, so a non-existent id is a silent
   no-op.
3. **No `project_id` in the signature**, so an id from another project is renumbered and the server
   cannot refuse. The frontend wrapper holds one and does not send it
   (`src/api/devTools/devTools.ts:189-196`, with the reasoning written down).
4. **`Result<(), AppError>`** — the caller learns nothing either way.

`dev_tools_reorder_goal_items` has **no consumer at all** in `src/`.

**Fix (note):** one transaction; take `project_id` and add `AND project_id = ?` to the predicate;
sum the affected rows and return `Result<usize>` **at minimum** — or `Vec<Outcome>` if a
partially-valid list should be reported rather than refused.

### D4 — 40 of 44 id-list commands have no item cap; 34 say nothing about an empty list

The four that cap: `bulk_retry_dead_letter_events` / `bulk_discard_dead_letter_events`
(`MAX_BULK_DLQ_BATCH = 200`), `dev_tools_athena_triage_batch` (`MAX_BATCH_IDEAS = 30`), and
`genome_start_breeding` (`parent_ids.len() < 2` / `> 5`, both with a sentence). All four
**refuse**, which is the correct half.

The uncapped set includes every delete: `batch_delete_memories`, `batch_delete_team_memories`,
`dev_tools_bulk_delete_ideas`, `bulk_delete_personas`, and all three `reorder_*`. The repo layer
chunks `batch_delete` at 500 for SQLite's variable limit (`memories.rs:825-827`) — a *parameter*
bound that was never a *governance* bound. Live inputs a "select all" would reach today: 6,535
memories, 236 dev ideas, 99 open audit incidents, 210 tool assignments.

**Fix (note):** one `if ids.len() > MAX` per command, with the constant's comment naming what the
number means (brainiac's *"the page the console renders"* is the model).

### D5 — `decide_bulk` documents parity it does not have, and drops the adoption fan-out

`commands/infrastructure/dev_workspaces.rs:271-284`. Detailed in §0. Docstring: *"Same governance
gate as the single decide (agents propose, humans adopt); only the batch size changes."* Measured:

- **The CAS is preserved** — `decide_knowledge` is `decide_knowledge_cas(…, None)`
  (`db/src/repos/dev_workspaces.rs:766-773`), and passing `None` from the bulk adjudicator is
  **deliberate and documented** (`:786-789`). *This half of the docstring is true* — see §12.2.
- **`materialize_pending_for_practice` is not.** One production call site in 963 files, in the
  singular command (`:232`). Bulk-adopting creates zero backlog ideas. Live: 1,164 adopted
  practices, 22 `dev_ideas` rows with `scan_type = 'workspace_practice'`.
- Reachable: `KnowledgeLibrary.tsx:122` calls it with `'adopt'`.

**Fix (note):** move the post-commit block into a helper both commands call, over the returned
`BulkDecision.ids`.

### D6 — two of six per-item outcome shapes carry free text where a token belongs

`BulkDecision.failed: Vec<String>` built as `format!("{id}: {e}")`
(`db/src/repos/dev_workspaces.rs:952`) and `PushSyncResult.errors: Vec<String>`
(`core/src/models/obsidian_brain.rs:212`). Neither can be grouped by cause, counted by cause, or
translated. Their consumers prove it: `KnowledgeLibrary.tsx:131-133` renders
`{count} failed` from `res.failed.length` and never the strings; `SyncPanel.tsx:117` renders
`` `…, ${result.errors.length} errors` `` — and that toast is **hardcoded English** in a 14-locale
app. Compare `BulkDeadLetterFailure { id, reason: token }`, whose consumer can say *"2
retry-exhausted, 1 not found"* in every language.

**Fix (note):** `{ id, reason: <token> }`, with the tokens added under `status_tokens` in
`src/i18n/locales/en.json`.

### D7 — three consumers hold a per-item outcome and render a count

- **`AthenaVerdictCard.tsx:112-119`** reads `applied.accepted` and `applied.rejected` and **never
  `applied.failed`**, whose field docstring reads *"Ids that could not be written (already deleted,
  etc.) — **reported, never swallowed**"* (`backlog_triage.rs:96-97`). Because `accepted` counts
  only successes, a batch of 20 where 3 were already deleted toasts *"17 accepted"* with no mention
  of 3. The backend is impeccable here — it even annotates the approval ledger via `note_applied`
  (`:290`).
- **`PersonaOverviewActions.tsx:82-89`** computes `protectedCount + failed` into one `skipped`
  number, so *"the Director cannot be deleted"* and *"the database was locked"* render identically,
  and `reason` is never shown.
- **`BacklogPanel.tsx:194`** reads `DispatchIdeasResult.dispatched` and not `skipped`;
  `DispatchPanel.tsx:120` reads both. Same type, two consumers, one of them complete.

**Fix (note):** each is a few lines at the render site; the types already carry everything needed.

### D8 — the generic per-item outcome type exists and has zero reachable call sites

`engine/build_session/orchestrator.rs:30-33` — `LaneOutcome<T> { lane: String, result: Result<T,
String> }`, returned by `run_lanes`. Two non-test call sites, neither of which runs:
`build_session/fanout.rs:288` is `#![allow(dead_code)]` with a header reading *"NOT yet wired"*, and
`tool_tests.rs:995` is behind `PERSONAS_SCRIPTED_TOOL_TESTS=1`, a string read three times and set
zero times.

So the repo has six bespoke `{ id, reason }`-shaped types in six files — two of them
(`SkippedIdea`, `DispatchSkip`) byte-identical — and one generic type nobody constructs. Doctrine
Q3 exactly, and the reason §4 says **wire one of the six**, not mint a seventh.
[`bounded-parallel-fan-out`](./bounded-parallel-fan-out.md) §7 D6 found the same type unreachable
from the concurrency side; this is the second independent sighting.

**Fix (note):** make `BulkDeadLetterOutcome`'s shape generic (`BulkOutcome<Id, Reason>`) in a shared
module and route the next bulk command through it. Do not add a seventh name.

### D9 — the bulk READ variants report a failed source by omitting its key

`commands/credentials/rotation.rs:81-106` (`get_rotation_history_bulk`) and `:125-131`
(`get_all_rotation_statuses`) return `HashMap<id, T>` and, on a per-credential error,
`tracing::warn!` and skip. The comment states the intent honestly — *"one corrupted row, transient
lock, or bad id must not blank out the entire annotation layer … log and skip, return the successful
subset"* — and the intent is right; the *shape* is the problem, because a caller cannot tell a
credential with no rotation history from one whose read threw. Same in
`get_prompt_versions_bulk` and `resolve_effective_config_bulk` (`Vec<T>` shorter than the input).

This is [`partial-failure-read-envelope`](./partial-failure-read-envelope.md) P3 arriving through a
bulk command's return type instead of a `.catch(() => [])` — see §12.4.

**Fix (note):** `HashMap<id, Result<T, String>>`, or a sibling `errors: HashMap<id, String>`, which
is what `HealthBundleErrors` (`commands/communication/observability/metrics.rs:264-291`) already
does for a fixed source set.

### D10 — `delete_all_memories` skips the vector cleanup its plural sibling does

`db/src/repos/core/memories.rs:1052-1058` is a bare
`DELETE FROM persona_memories WHERE tier != 'core'` with no `spawn_delete_memory_embeddings`, while
`batch_delete` at `:843` has one. The singular `delete` (via `crud_delete!`) has none either. Latent:
**0 orphan embeddings** live (5,158 vectors against 5,158 non-archive memories), so neither path has
yet hard-deleted an embedded row. On this install `delete_all_memories` would delete 6,535 rows and
leave 5,158 vectors — the `tier != 'core'` guard protects nothing here, because there are **0
core-tier rows**.

**Fix (note):** `SELECT id … WHERE tier != 'core'` before the delete, then
`spawn_delete_memory_embeddings(ids)`. Two lines. *(Not an apply — the first run of anything in this
area deletes rows.)*

## 8. Gaps

1. **There is no shared per-item outcome type, and the shapes have already diverged on the field
   that matters.** Six bespoke types: `BulkDeleteOutcome{id,status,reason}`,
   `BulkDeadLetterOutcome{succeeded,failed:[{id,reason}]}`, `BulkDecision{decided,ids,failed:[String]}`,
   `AppliedTriage{accepted,rejected,skipped,overridden,failed:[SkippedIdea]}`,
   `DispatchIdeasResult{dispatched,skipped:[DispatchSkip]}`, `PushSyncResult{…,errors:[String]}`.
   Four carry a reason per id; two carry free text. Three name the failure list `failed`, one
   `skipped`, one `errors`. `SkippedIdea` and `DispatchSkip` are byte-identical. **0 of 6 codebases
   surveyed has a generic one** (§6 clause 9), so any prescription for a *named* shared type would
   be an invention — which is why §2 mandates the **shape** and §4 says wire one of the six.
2. **`status: String` everywhere.** All three per-item status fields are `String`
   (`"deleted"|"protected"|"failed"`, `"not_found"|"wrong_status"|"retry_exhausted"`), so the
   generated TypeScript binding is `string` and the frontend's `o.status === 'protected'` is a
   string compare a typo defeats silently. A Rust enum with `#[serde(rename_all = "snake_case")]`
   would give ts-rs a union type and close it in one edit per type. `BulkDeleteOutcome.ts`'s own
   docstring lists the three values in prose.
3. **The `_all` family cannot be anchored on anything.** `delete_all_memories`,
   `delete_all_messages`, `delete_all_manual_reviews`, `mark_all_messages_read` take **no
   parameter**, so no signature-level gate can see them and no cap can bound them. They are the
   highest-blast-radius commands in this leaf (6,535 rows for one of them) and structurally the
   least observable. The honest instrument for them is a *consent* contract, which
   [`informed-consent-gate`](./informed-consent-gate.md) owns, not a return type.
4. **No test in this repo asserts a bulk command's partial-failure behaviour.** The three
   `reorder_*` have none; `bulk_assign_tools` has none; `bulk_delete_personas`' file has a
   `drain_tests` module that tests the singular's engine primitives and explicitly documents that
   the command's *"own sequencing glue … is unreachable without AppState"*. The instrument is six
   lines (seed two rows, pass three ids of which one is bogus, assert the outcome vector's length
   and statuses) and it is what turned §0 from a reading into a measurement.
5. **Nothing connects a bulk command to its singular sibling.** The pairing is by *name*
   (`bulk_delete_personas` ↔ `delete_persona`), which is a convention no tool reads, so "did the
   plural keep what the singular does" is a question only a human asking it will ever answer. 31
   morphological pairs exist; a `#[bulk_of(delete_persona)]` attribute (or just a docstring
   convention the census can key on) would make the divergence auditable. Today it is not.
6. **`tokenLabel` has no category for bulk failure reasons.** `src/i18n/tokenMaps.ts`'s categories
   are execution, event, automation, severity, priority, healing_status, healing_category,
   connector_status, test, dev. `DeadLetterTab` therefore hand-rolls its own `labelFor`
   three-branch mapping (`:285-289`) instead of calling `tokenLabel(t, 'bulk_failure', reason)` —
   which is why the pattern has not spread: the shared door for the shared vocabulary does not exist.

## 9. The missing gate

**The condition, stated stack-free:** *one call performs N independent writes and answers with a
single verdict, so "which of them landed" is a fact the wire shape cannot carry and no caller, log
or retry can recover it.*

**The signal (a proxy, and stated as one):** a `#[tauri::command]` whose parameter list carries a
`Vec` of entity identifiers (a parameter named `ids` / `<thing>_ids` / `keys` / `<thing>_keys`) and
whose success type is a scalar or unit. This keys on the shape the condition wears **in this repo**,
where an N-item write is an IPC command with a snake_case `Vec<String>` parameter. **An adopting
repo must re-derive its own proxy** — see the portability note below.

**The mechanism: a census rule.** The runner already exists (`scripts/census/`) and implements the
fail-loud contract, so this path does not write a script.

**Where it executes:** two places, neither of them CI-only. `npm run census:check` is part of
**`npm run check`** (`package.json` — `check` = `check:contracts && … && census:check && tsc && eslint`),
which the agent runs before opening a PR; and it is the **`golden-path-census` pre-push job** in
`lefthook.yml:74-75`, added 2026-08-16 precisely because "inside `npm run check`" was not
enforcement. That matters here: `ci.yml` is currently red on 10 pre-existing failures, so **a gate
that only runs in CI runs nowhere.** This one fails the push.

**Precision 14/14 on the stated condition, every match opened and read.** On the stricter question
*"is this a defect"* it is ~13/14: `design/reviews.rs:133` `delete_stale_seed_templates` takes
`active_ids` as a **keep-list** and sweeps the complement, where a count is a defensible answer. It
is listed **on purpose** — separating it requires knowing that the id list is a negation, which no
matcher can see, and one knowingly-listed arguable site beats a heuristic that guesses.

**Two independent implementations reconcile EXACTLY, at every level of the partition.**
Implementation #1 is the census regex. Implementation #2 is a paren-balanced signature extractor
over comment-and-string-stripped source that walks all 564 files under `src-tauri/src`, splits each
command's parameter list at depth 0, and classifies the return type. They agree at **44 / 32**
(anchor), **14 / 10** (violating) and **6 / 5** (compliant), with **zero disagreement in either
direction**. The extractor also proved the sweep's own precondition: 1,585 registered commands, 0
of them without a definition.

**The population partitions, and the residual is a named family rather than a remainder:**

| | matches | files |
| --- | ---: | ---: |
| **anchor** — every `#[tauri::command]` with an id-list `Vec` parameter | **44** | 32 |
| ↳ **violating** — scalar or unit return | **14** | 10 |
| ↳ **compliant** — a per-item outcome type (the positive control) | **6** | 5 |
| ↳ **residual** — reads returning `Vec<T>`/`HashMap`, job-starters returning `serde_json::Value`, single-entity writes whose id list is a *field* | **24** | 20 |

14 + 6 + 24 = 44. **The gate discriminates on what the command can SAY**, not on the token `Vec`
and not on the word `bulk`.

**Existing rules checked for overlap first, by re-running each neighbour's committed pattern over
its own roots and intersecting the file sets — measured, not assumed.** (All seven reproduced their
committed baselines exactly, which is also the instrument's own check.)

| neighbour rule | its files / matches | overlap with my 10 files | why it is a different condition |
|---|---:|---:|---|
| `opaque-artifact-outcome` (`portable-export-bundle.md`) | 2 / 5 | **1 (10%)**, sharing **2 of my 14 matches (14%)** | The nearest neighbour. It keys on the fn **name** beginning `export\|import\|backup\|restore\|dump` with a `bool` return; I key on an **id-list parameter** with any scalar return. The shared members are `export_selective` and `export_selective_to_path`. |
| `unatomic-sequence-rewrite` (`drag-reorder.md`) | 1 / 3 | **0 (0%)** | Its 3 matches are the reorder trio's **repository** bodies in `db/src/repos/dev_tools.rs`; my 3 are their **command** signatures in `src-tauri/src`. Disjoint file sets, and a different question: it asks *was the rewrite one transaction*, this asks *was the caller told*. Complementary — see §7 D3. |
| `untyped-command-payload` (`new-ipc-command.md`) | 40 / 104 | **2 (20%)** | Commands returning `serde_json::Value`. **Disjoint by construction**: my pattern requires a scalar/unit return, and `Value` is neither. The 5 anchor members returning `Value` are in my residual, and are its matches. |
| `blind-identity-write` (`repository-crud-surface.md`) | 35 / 82 | **0 (0%)** | Repository fns, `WHERE id = ?N` alone, one row. Different layer, different cardinality. |
| `discarded-guard-verdict` (`conditional-write.md`) | 7 / 11 | **0 (0%)** | A guarded single-row UPDATE's `usize` dropped in statement position. Its cardinality is one; this leaf begins at N. |
| `unverified-effect-dispatch` | 60 / 162 | 1 (10%) | `let _ = …emit(…)`. Unrelated construct that happens to share one large file. |
| `silent-row-skip` | 64 / 148 | 2 (20%) | `query_map(...).filter_map(Result::ok)` on **reads**. Unrelated construct, two large shared files. |

The largest *match-level* overlap is 14%, well under the 83% that got a previous gate correctly
declined.

**Disclosed recall gap — the anchor is a vocabulary, and the misses cluster exactly where the
doctrine says they will.** The pattern anchors on the *identifier* naming convention, so it misses
the bulk commands whose collection parameter is named after the **payload**:
`batch_import_design_reviews(inputs) -> u32`, `import_composition_workflows(workflows) -> u32`,
`companion_file_browser_defects(defects) -> usize`, `dev_tools_playbook_set_patterns(members) -> ()`.
It also cannot see the `_all` family, which takes **no parameter at all** (§8 Gap 3):
`delete_all_memories`, `delete_all_messages`, `delete_all_manual_reviews` (`usize`),
`mark_all_messages_read` (`()`). True recall over scalar/unit-returning bulk-write commands is
**≈ 14/20 = 70%**.

**How it fails loudly if its own precondition is absent:** `floor: 300` against a live walk of 564
`.rs` files under `src-tauri/src`, so a broken glob or a moved root fails rather than reporting
zero; a rule matching zero files anywhere is a structural failure in the runner; a rise is fatal;
and a **drop** without `--update` is fatal, because a silent drop is a broken matcher more often
than it is fixed code.

**What the gate cannot do, stated so nobody trusts it further than it goes:**

- **It cannot see whether the plural kept the singular's checks** — §0's location law, and the three
  worst entries in §7 (D1, D2, D5). All three return a *type the gate is happy with or indifferent
  to*: `bulk_delete_personas` returns `Vec<BulkDeleteOutcome>` and is in the **positive control**
  while skipping a documented safety drain. **A per-item outcome type is necessary and nowhere near
  sufficient**, and this is the single most important limitation of this §9.
- It cannot see the item cap (§7 D4) or the empty-list contract. Both are body-level `if`s over a
  population of 44, and a signal keyed on `.len() >` would fire on hundreds of legitimate bounds
  checks tree-wide.
- It cannot see the client half. Whether `failed` reaches a pixel is a property of a `.tsx` file
  three hops away; §7 D7's three cases were found by resolving each command's api wrapper by hand.
- It cannot tell a keep-list from a target list (the one arguable match).
- It counts a *signature*, not a *behaviour*. `-> Result<Vec<T>>` returning only the rows that
  worked (omission ≡ absence) is in the **residual**, not the violating set, and is a real defect
  (§7 D9). Closing that needs to know what the vector's length means relative to the input's, which
  is dataflow, not a matcher.

```json
{
  "rules": [
    {
      "id": "unreportable-bulk-outcome",
      "goldenPath": "docs/concepts/golden-paths/bulk-command-variant.md",
      "title": "A Tauri command that acts over a caller-supplied list of entity ids returns a type in which partial success is unrepresentable",
      "roots": ["src-tauri/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "#\\[tauri::command[^\\]]{0,60}\\](?:[ \\t]*\\r?\\n[ \\t]*#\\[[^\\]\\n]{0,160}\\][ \\t]*)*[ \\t]*\\r?\\n[ \\t]*(?:pub[ \\t]+)?(?:async[ \\t]+)?fn[ \\t]+[a-z][a-z0-9_]{0,60}[ \\t]*\\((?:[^(){}]|\\([^()]{0,100}\\)){0,700}?\\b(?:ids|[a-z][a-z0-9_]{0,30}_ids|keys|[a-z][a-z0-9_]{0,30}_keys)[ \\t]*:[ \\t]*(?:Option[ \\t]*<[ \\t]*)?Vec[ \\t]*<(?:[^<>]|<[^<>]{0,60}>){0,80}>(?:[^(){}]|\\([^()]{0,100}\\)){0,700}?\\)[ \\t]*->[ \\t]*Result[ \\t]*<[ \\t]*(?:\\([ \\t]*\\)|usize|u8|u16|u32|u64|i8|i16|i32|i64|bool)[ \\t]*,",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A #[tauri::command] whose parameter list carries a Vec of ENTITY IDENTIFIERS (a parameter named ids / <thing>_ids / keys / <thing>_keys) and whose success type is a SCALAR OR UNIT - (), usize, u32, u64, i64, bool. PROXY FOR the stack-free condition: one IPC call performs N independent writes and answers with a number, so 'which of them landed' is a fact the wire shape cannot carry and no caller, log or retry can recover it. THE SHAPE IS DELIBERATE, WHICH IS WHY IT IS GATEABLE: a parameter named `ids: Vec<String>` is somebody collapsing N calls into one on purpose - the plural sibling of a singular command that returns a row or a bool per item - so the return type is a decision, not an accident. MEASURED 2026-08-16 at e3c5e0d7f: 14 matches across 10 of 564 .rs files under src-tauri/src, EVERY ONE OPENED AND CONFIRMED (precision 14/14 on the stated condition). THE POPULATION PARTITIONS EXACTLY: an anchor counting every #[tauri::command] with an id-list Vec parameter regardless of return type matches 44 in 32 files, and 14 unreportable + 6 per-item-outcome (the positive control) + 24 residual = 44, where the residual is reads (Vec<T>/HashMap - see the note below), job-starters returning serde_json::Value, and single-entity writes whose id list is a field rather than a target. TWO INDEPENDENT IMPLEMENTATIONS RECONCILE EXACTLY AT 44 / 14 / 6 with zero disagreement in either direction: this regex, and a paren-balanced signature extractor over comment-and-string-stripped source that parses each command's parameter list at depth 0 and classifies the return type. EXECUTED, not argued (node:sqlite, statements and schema transcribed verbatim from this tree): (1) bulk_assign_tools (commands/tools/tools.rs:93 -> db/src/repos/resources/tools.rs:469) over a 4-item selection where one tool was already assigned returns 3 - so 'one was already there' and 'one was refused' are the same u32; (2) the same call with ONE id naming no tool definition fails the whole unchecked_transaction with 'FOREIGN KEY constraint failed', LOSES ALL FOUR WRITES and names no id, while N x assign_tool (tools.rs:377, which does `get_definition_by_id(pool, tool_id)?` first) lands three and refuses exactly one BY NAME; (3) the singular carries tool_config and the plural hard-codes NULL; (4) dev_tools_reorder_goals (db/src/repos/dev_tools.rs:861 - N UPDATEs on a POOLED connection with no transaction, affected-row count discarded) failing at item 3 of 5 persists g1=0 g5=0 g2=1 g4=1 g3=2, i.e. TWO DUPLICATE order_index VALUES and an unstable sort order, with Err and no way to learn how far it got - and the operator's live database already holds one such duplicate (dev_goals, project dbaa0abb, two rows at order_index 0); (5) the same command returns Ok(()) when an id belongs to ANOTHER PROJECT (it is silently renumbered - the signature has no project_id to scope against, and src/api/devTools/devTools.ts:195 holds a _projectId it deliberately does not send) and Ok(()) again for an id that does not exist. THE SHARPEST MATCH IS gitlab_revoke_credentials (commands/infrastructure/gitlab.rs:378): a loop that DELETEs CI/CD variables from a GitLab project, swallows every per-key failure into tracing::warn! and returns `revoked: u32` - so '3 of 8 secrets revoked' and '5 were already gone' are the same value, and its provisioning sibling 120 lines above uses try_join_all, which fails fast and drops the rest: same file, opposite failure posture, and neither can say WHICH key. ONE MATCH IS KNOWINGLY ARGUABLE: design/reviews.rs:133 delete_stale_seed_templates takes active_ids as a KEEP-list and sweeps the complement, where a count is a defensible answer; it is listed on purpose because separating it needs to know that the id list is a negation, which no matcher can see. TWO MATCHES OVERLAP `opaque-artifact-outcome` (core/data_portability.rs:1831 and :2126, export_selective / export_selective_to_path -> bool): that rule keys on the fn NAME beginning with export|import|backup|restore|dump and this one keys on an id-list parameter, so the shared members are 2 of my 14 (14%) in 1 of my 10 files (10%) - re-measured by re-running its committed pattern, not assumed. ZERO overlap with `unatomic-sequence-rewrite` (which owns the reorder trio's ATOMICITY, in db/src/repos/dev_tools.rs, one file, three matches - my three reorder matches are the COMMAND-layer signatures in src-tauri/src, a different file set and a different question: that rule asks whether the rewrite is one transaction, this one asks whether the caller is told what happened). ZERO overlap with `blind-identity-write` (repo fns, singular, WHERE id = ?N alone) and `discarded-guard-verdict` (a guarded UPDATE's usize dropped in statement position) - both live in the repo layer and both are about ONE row. DISCLOSED RECALL GAP, exactly where the doctrine predicts: the anchor is a vocabulary, and it misses the bulk commands whose collection parameter is named after the PAYLOAD rather than the ids - batch_import_design_reviews(inputs) -> u32, import_composition_workflows(workflows) -> u32, companion_file_browser_defects(defects) -> usize, dev_tools_playbook_set_patterns(members) -> () - plus the whole `_all` family, which takes NO parameter at all and so cannot be anchored on one (delete_all_memories -> usize, delete_all_messages -> usize, delete_all_manual_reviews -> usize, mark_all_messages_read -> ()). True recall over scalar/unit-returning bulk-write commands is about 14/20 = 70%. LEGAL DESTINATIONS the pattern leaves unmatched by construction, all of which exist in this tree: (1) Vec<BulkDeleteOutcome> { id, status: 'deleted'|'protected'|'failed', reason } - core/src/models/persona.rs:850, returned by commands/core/personas.rs:66; (2) BulkDeadLetterOutcome { succeeded: Vec<String>, failed: Vec<BulkDeadLetterFailure{id, reason}> } where reason is a MACHINE TOKEN the frontend maps through tokenLabel - db/src/repos/communication/events.rs:1102-1163; (3) DispatchIdeasResult { dispatched: Vec<DispatchedIdea>, skipped: Vec<DispatchSkip{idea_id, reason}> }. PRECONDITION (must be re-derived per repo): this repo exposes N-item writes as Tauri commands with a snake_case Vec<String> id parameter and a Result<_, AppError> return. A repo whose bulk write is an HTTP route with a JSON body scores a structural zero here while carrying the condition at scale - measured in the sibling checkouts: vibeman's DELETE /api/cross-task/bulk collects skippedRunning WITH identity and then flattens it to `.length` at the response boundary (src/app/api/cross-task/bulk/route.ts:33 vs :47), and its reorderHubLinks returns void under a hardcoded { reordered: true } (src/app/db/repositories/knowledge.repository.ts:400, api/knowledge-base/route.ts:183). Do NOT silence a match by widening the scalar to a String message, by returning Result<Vec<T>> of only the rows that worked (omission is not a report - that is the residual bucket, not the compliant one), or by moving the count into an untyped serde_json::Value (which trades this rule for `untyped-command-payload`)."
      },
      "exclude": [],
      "baseline": { "files": 10, "matches": 14 },
      "floor": 300
    },
    {
      "id": "unreportable-bulk-outcome-positive-control",
      "goldenPath": "docs/concepts/golden-paths/bulk-command-variant.md",
      "title": "POSITIVE CONTROL - the same id-list command whose return type NAMES the per-item outcome",
      "roots": ["src-tauri/src"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "#\\[tauri::command[^\\]]{0,60}\\](?:[ \\t]*\\r?\\n[ \\t]*#\\[[^\\]\\n]{0,160}\\][ \\t]*)*[ \\t]*\\r?\\n[ \\t]*(?:pub[ \\t]+)?(?:async[ \\t]+)?fn[ \\t]+[a-z][a-z0-9_]{0,60}[ \\t]*\\((?:[^(){}]|\\([^()]{0,100}\\)){0,700}?\\b(?:ids|[a-z][a-z0-9_]{0,30}_ids|keys|[a-z][a-z0-9_]{0,30}_keys)[ \\t]*:[ \\t]*(?:Option[ \\t]*<[ \\t]*)?Vec[ \\t]*<(?:[^<>]|<[^<>]{0,60}>){0,80}>(?:[^(){}]|\\([^()]{0,100}\\)){0,700}?\\)[ \\t]*->[ \\t]*Result[ \\t]*<[ \\t]*(?:Vec[ \\t]*<[ \\t]*)?(?:[A-Za-z_][A-Za-z0-9_]{0,40}::){0,4}(?:Bulk[A-Za-z0-9_]{0,40}|[A-Za-z0-9_]{0,40}Outcomes?|AppliedTriage|DispatchIdeasResult|PushSyncResult|BatchIntegrityResult)\\b",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "POSITIVE CONTROL - the COMPLIANT form of the same condition, over the same root and extension and behind the IDENTICAL id-list anchor: a #[tauri::command] taking a Vec of entity ids whose success type NAMES the per-item outcome. Measured 2026-08-16 at e3c5e0d7f: 6 matches in 5 files, against the violating rule's 14 in 10. THIS IS A PARTITION, NOT A RATIO: the shared anchor (an id-list command, any return type) matches 44 in 32 files, and 14 violating + 6 compliant + 24 residual = 44 exactly. The residual is a NAMED family, not a remainder - 24 commands that are reads returning Vec<T> or HashMap (get_prompt_versions_bulk, get_rotation_history_bulk, resolve_effective_config_bulk, get_app_settings_bulk, ...), job-starters returning serde_json::Value (dev_tools_start_batch, dev_tools_run_scan, promote_build_draft), and single-entity writes whose id list is a FIELD rather than a target set (dev_tools_create_use_case, twin_create_distilled_fact, create_share_link). So the gate discriminates on WHAT THE COMMAND CAN SAY, not on the token Vec or on the word bulk. THE SIX: communication/events.rs:275 and :290 (bulk_retry_dead_letter_events / bulk_discard_dead_letter_events -> BulkDeadLetterOutcome{succeeded, failed:[{id, reason}]}, the strongest in the tree - the reason is DERIVED by re-reading the row after a 0-row CAS, so it distinguishes not_found from wrong_status from retry_exhausted, and it is a machine token the frontend maps through tokenLabel); core/personas.rs:66 (bulk_delete_personas -> Vec<BulkDeleteOutcome>{id, status, reason}); infrastructure/dev_tools.rs:1041 (dev_tools_dispatch_ideas -> DispatchIdeasResult{dispatched, skipped:[{idea_id, reason}]}); infrastructure/dev_workspaces.rs:274 (dev_tools_workspace_knowledge_decide_bulk -> BulkDecision{decided, ids, failed:Vec<String>} - the weakest of the six, because `failed` holds a preformatted \"{id}: {e}\" string rather than a pair); obsidian_brain/mod.rs:527 (obsidian_brain_push_sync -> PushSyncResult{created, updated, skipped, errors:Vec<String>} - also untyped errors). A MATCH HERE IS NOT A CERTIFICATE: bulk_delete_personas sits in this control and still skips the documented two-phase engine drain its singular sibling runs (see the golden path's section 7 D2), because a per-item outcome type is necessary and nowhere near sufficient. Carries NO baseline by construction: a ratchet is monotone-downward and a rule counting compliant code would fail the build every time adoption improved (scripts/census/lib/engine.mjs:377 exempts a -positive-control id; merge-published-rules.mjs skips it). THE TWO COUNTS MUST MOVE IN OPPOSITE DIRECTIONS: if unreportable-bulk-outcome falls while this stays flat, a bulk command was DELETED rather than given a per-item shape, and the ratchet would otherwise have recorded that as progress. NOTE the alternation is a NAME LIST (Bulk*, *Outcome/*Outcomes, plus four spelled-out types) because this repo has no generic per-item result type - there are SIX bespoke shapes in six files and SkippedIdea{idea_id, reason} (commands/companion/backlog_triage.rs:54) and DispatchSkip{idea_id, reason} (commands/infrastructure/dev_tools.rs:977) are byte-identical two-field structs in the same crate. If the generic type lands (engine/build_session/orchestrator.rs:30 already defines LaneOutcome<T>{lane, result: Result<T,String>} and has ZERO reachable production call sites), add its name here or this control will under-report adoption. `Summary` and `Report` were deliberately REMOVED from the alternation after they matched two reads - get_bulk_delivery_summaries and dev_tools_project_wall_summary - which return one row per entity but report no failure; a suffix is not a contract."
      },
      "exclude": [],
      "floor": 300
    }
  ]
}
```

Validated standalone via `node scripts/census/run-census.mjs --rules <a composer-private scratch
registry, filename unique to this composer because siblings share the scratchpad>`, never against
the shared `rules.json`. The runner reports **14 matches / 10 files** for the rule and **6 / 5** for
the control over **564** files against a floor of 300, and `--check` exits **0** at the declared
baseline. **Re-extracted from this finished document and re-run, with identical counts.**

### The type, alongside the ratchet

The gate counts the **return type**. Three things it cannot reach, in descending importance:

- **The location law (§0) is not a type at all.** Whether the plural kept the singular's existence
  probe, drain, or post-commit fan-out is a property of *which function it calls*, and the only
  instrument that sees it is a human reading both bodies. §8 Gap 5 is the closest thing to a fix: a
  declared sibling link (`#[bulk_of(delete_persona)]`, or a docstring convention) would at least
  make the pair *auditable*. Today nothing connects the 31 morphological pairs.
- **`status: String` should be an enum** (§8 Gap 2). Three per-item types spell their statuses as
  string literals, so ts-rs emits `string` and every frontend comparison is a typo away from
  silence. One `#[derive]` per type closes it and gives the client a union.
- **Fix the destination before ratcheting the callers** (contract: *a gate on reaching a
  destination is only as good as the destination's defaults*). Two of the six per-item shapes carry
  free-text reasons (§7 D6) and `tokenMaps.ts` has no bulk-failure category (§8 Gap 6), so a caller
  who follows this gate can arrive at a type that still cannot be grouped, counted or translated.
  Add the category and make `reason` a token in the shared shape **first**.

## 12. Corrections to the brief

1. **`sides: "server"` is wrong for this leaf, and the spine already says so twice in the same
   node.** It carries `twoSided: true` **and** `fusedAcrossSides: true`, plus an explicit
   `clientHalf` (*"One action over N entities reporting per-reason failures rather than a single
   'error'"*), and the evidence is decisive: **three of the six commands that already return a
   per-item outcome have a consumer that renders only a count** (§7 D7), so on those the server is
   compliant and the user still cannot tell. The single best implementation in this document is a
   *pair* — `bulk_retry_dead_letter` plus `DeadLetterTab.tsx:282-345` — and neither half is worth
   much alone. **Recommend flipping `sides` to `both`.** I swept the client anyway.
2. **"Two of three `dev_tools_reorder_*` commands could never execute … Fixed 2026-08-16" —
   confirmed, and the fix left the more interesting defect standing.** `devTools.ts:189-196` now
   sends `{ ids: goalIds }` with the mismatch documented in a comment. But the *reason* the payload
   carried `projectId` is that a reorder needs it: without it the server has no predicate to scope
   the write, and executed, `reorder_goals` silently renumbers a row belonging to another project
   and returns `Ok(())`. **The argument-name bug was a symptom of a missing parameter, and only the
   symptom was fixed.** The brief is also right that a gate keyed on command *names* cannot see
   this; a signature-vs-call-site checker can, and I built one — but it belongs to
   [`new-ipc-command`](./new-ipc-command.md)/[`bridge-type-contract`](./bridge-type-contract.md),
   neither of which owns argument-name drift today. Flagged there, not gated here.
3. **A correction to a finding of my own, caught before publishing, and it is the most useful thing
   in this section.** `dev_tools_workspace_knowledge_decide_bulk` is the **only** one of the 45
   bulk-write commands with no `#[requires(...)]` attribute and no `require_auth*` call, while its
   singular sibling has `require_auth_sync`. I had that written up as an authorization asymmetry.
   Then I opened the function: `ipc_auth.rs:477-479` is
   `pub fn require_auth_sync(_state) -> Result<(), AppError> { Ok(()) }` — *"now a no-op for public
   (non-privileged) commands"*, and `#[requires(auth)]` expands to the same call
   (`macros/src/lib.rs:68-73`). **The gate the siblings carry and this one lacks enforces nothing
   either way**, so the asymmetry is cosmetic. Real enforcement is `#[requires(privileged)]` →
   `require_privileged_sync` (`ipc_auth.rs:447`, fails closed on the IPC session-token flag) and
   `#[requires(cloud)]`. This belongs to [`ipc-command-authorization`](./ipc-command-authorization.md)
   and to `unfalsifiable-tier-guard`, not here. **The general lesson is the doctrine's: a gate's
   presence in the source is not its presence in the binary, and the difference is one file read.**
4. **"`Result<Vec<()>, E>` cannot express '5 of 8 landed', and two byte-identical `try_join_all`
   sites push credentials to GitLab under it" — confirmed, and the same file holds the *opposite*
   failure posture on the same credentials.** `gitlab_revoke_credentials`
   (`commands/infrastructure/gitlab.rs:378-406`), 120 lines below the provisioning pair, is a serial
   loop that swallows every per-key `delete_variable` failure into a `tracing::warn!` and returns
   `revoked: u32`. So provisioning **fails fast and drops the rest**, revocation **fails open and
   reports a count**, and neither can name a key. For a *revocation* path the second is worse: "3 of
   8 revoked" and "5 were already gone" are the same number, and the difference is whether five
   secrets are still live in a GitLab project. `bounded-parallel-fan-out` §7 D2 owns the
   `try_join_all` half; this is its sibling and it is unowned.
5. **"`run_lanes(...) -> Vec<LaneOutcome<T>>` exists, makes partial success representable, and has
   zero reachable production call sites" — confirmed, and the finding is sharper with the
   convergence result beside it.** The oracle found **0 of 6 codebases has a generic per-item result
   type** and ~14 bespoke vocabularies between them. **Personas is the only repo that has written
   one — and the only one that does not use it**, while carrying six bespoke shapes of its own, two
   of which (`SkippedIdea`, `DispatchSkip`) are byte-identical structs in the same crate. That is
   doctrine Q3 with an external control group: the type is not unused because it is bad, it is
   unused because nobody in any of six codebases reaches for a generic one.
6. **"A bulk approve route in a sibling repo takes 200 ids ungated" — refuted, and the truth is the
   better lead.** brainiac's bulk review (`console.rs:371`) caps at exactly 200 and **refuses**
   above it (`:390-399`), and the constant's comment is the best sentence on batch sizing in the
   cohort: *"Not a performance number — a governance one … 200 is the page the console renders …
   the largest batch a reviewer can honestly claim to have read"* (`:309-316`). It also hoists the
   token scope once while explicitly **refusing** to hoist the per-team maintainer gate (`:400-403`).
   The ungated-200 shape does exist — in **vibeman**, whose `POST /api/ideas/approve` caps at 200
   and validates nothing beyond the id list. Personas caps **4 of 44**.
7. **"Per-module 'Delete all' buttons exist (`delete_all` preserves the core tier)" — confirmed for
   memories, and the exemption protects nothing on this install.** `memories.rs:1052` is
   `DELETE FROM persona_memories WHERE tier != 'core'` with a docstring naming what the guard
   prevents. Live: **0 core-tier rows**, so the command would delete all **6,535** memories — and it
   is the one delete door of three that does **not** drop the KNN vectors (§7 D10). The `_all`
   family is also the part of this leaf **no signature-level gate can reach**, because those
   commands take no parameter at all (§8 Gap 3).
8. **A correction to my own instrument, offered because the doctrine asks for it — three times.** (a) My
   first side-effect classifier reported four bulk commands as ungated, including
   `healthcheck_all_credentials` and `gitlab_revoke_credentials`. It was matching only
   `#[requires(auth` and `require_auth`, and missed `#[requires(privileged)]` and
   `#[requires(cloud)]` — the two that actually enforce. Widening it took the ungated count from 4
   to 1. (b) My first client-half sweep concluded `dev_tools_workspace_knowledge_decide_bulk` has
   **no consumer at all**, because I guessed its wrapper was named `decideKnowledgeBulk`. It is
   `decideWorkspaceKnowledgeBulk`, and `KnowledgeLibrary.tsx:122-133` calls it *and* reads
   `res.failed.length`. I caught it only by rewriting the sweep to resolve each wrapper **from the
   command-name string literal in `src/api/`** instead of from a guessed name. Both errors are the
   same one — *a vocabulary I wrote guessing at names somebody else chose* — and both would have
   shipped as confident findings. The second one would have made the §12.3 correction look like a
   live security hole in dead code. (c) My item-cap detector reported **5 of 44** by matching
   `.clamp(` anywhere in the body. One of the five, `list_director_score_trends`
   (`commands/infrastructure/director.rs:97`), clamps `limit` — the per-persona sparkline window —
   and does **not** bound `persona_ids` at all. The honest count is **4 of 44**, corrected
   throughout this document. *A pattern that finds the right token in the wrong argument counts a
   bound that is not on the thing you are bounding*, which is the same family as this leaf's own
   central defect: the number was plausible and pointed at the wrong noun.
