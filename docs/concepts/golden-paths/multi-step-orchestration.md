# Golden path — Multi-step orchestration

> Situation node: `backend-runtime/job-coordination/multi-step-orchestration` ·
> [situation spine](../situation-spine.md) · recurrence **5** · risk **HIGH** ·
> `sides: server` but **`twoSided: true`** (with `fusedAcrossSides: false` and **no `clientHalf`
> declared** — §12 correction 2) · convergence **diverged**.
> Dimensions: **function · ui · resilience · cost**.
> Spine's own framing: *"Topological order, per-step status and conditional edges across dependent
> steps."*
>
> Composed 2026-08-17 against `master` @ `50d736f6c`.
>
> **Sweep.** All **963** `.rs` files under `src-tauri/` and all **4,828** `.ts`/`.tsx` under `src/`
> ([`shared-facts.json`](../shared-facts.json)). Read in full:
> `src/engine/team_assignment_orchestrator.rs` (1,936 lines),
> `db/src/repos/orchestration/team_assignments.rs` (826),
> `engine/src/team_handoff.rs` (242), `src/engine/build_session/orchestrator.rs` (161),
> `src/companion/brain/consolidation.rs`'s `run_consolidation`,
> `src/commands/companion/approvals/approval_exec_night.rs`,
> `src/engine/deliberation.rs::{advance_one_deliberation, plan_transition}`,
> `db/src/chain.rs::evaluate_chain_triggers`,
> `src/commands/core/memories.rs::apply_persona_memory_review_proposal`,
> `src/commands/infrastructure/task_executor.rs::dev_tools_start_auto_run`,
> `core/src/models/team_assignment.rs`, plus the client half
> (`src/stores/slices/pipeline/assignmentSlice.ts`, `src/api/pipeline/assignments.ts`,
> `src/features/teams/sub_goals/GoalsMissions.tsx`, the four `TeamAssignment*` ts-rs bindings).
>
> **Measured by executing, not by reading — five independent instruments:**
>
> 1. **Read-only copies of both live SQLite files** (`personas.db` 347,054,080 bytes / 244 tables,
>    `personas_data.db` 17,502,208 bytes / 71 tables, copied 2026-08-17 12:43 with their
>    `-wal`/`-shm`, opened `readOnly: true`). **The live files were never opened for write while the
>    app was running**, and **both copies were deleted when the composition finished**.
> 2. **One real multi-step run was reconstructed end to end** from the store, as the brief asked —
>    assignment `a1a399f6-0754-4bb0-8fd4-e74a9945cf3f`, 4 steps, 106 ledger events, 9 resume rounds
>    over 9h57m. §0.1 is the reconstruction and it is the best half of this document.
> 3. **The repo's own status write was replayed against the live DDL.** `update_assignment_status`'s
>    `UPDATE` statement was transcribed verbatim from
>    `db/src/repos/orchestration/team_assignments.rs:455-465` and run, in an in-memory database
>    built from the **live `CREATE TABLE`**, for each status the orchestrator writes. That replay is
>    §0.2 and no amount of reading produced it.
> 4. **Every `CHECK(status|phase|state IN (…))` allowlist in both live databases was extracted (23)
>    and compared against the literals the Rust tree actually writes** through each table's own
>    transition door. One violation, and it disables an entire feature.
> 5. The §9 rule was measured by **two independent implementations** — a brace-matching,
>    balanced-argument-list Rust scanner and the census engine itself — **which disagreed**, and the
>    disagreement was a finding (§12 correction 5). Site-level overlap was checked against the **15**
>    nearest existing rules against the **final** pattern. Validated in a composer-private scratch
>    registry (`census-mso-7f3c21.json` — a filename unique to this composition, because sibling
>    composers share the scratchpad), then **re-extracted from this finished document and re-run**;
>    identical. **The full registry was NOT run**, per the doctrine.
>
> **No `cargo` command and no build of any kind was run.** **No chain, handoff, build session or
> assignment was started**; nothing was dispatched and no row was written. Every Rust claim is static
> and traces to a file opened during composition. **No secret value appears in this document.**
>
> The **Deviations** section is a fix backlog. **Nothing in it was applied** — per the
> [runbook](../golden-path-runbook.md), the operator uses this app daily.

---

## 0 The headline: this repo built the fleet's best multi-step orchestrator, wrote the type that would make its one bug unrepresentable, and wired that type to nothing

Four findings, in the order the measurement produced them.

### 0.1 The reconstruction succeeded completely — and what it shows is a resume loop that works mechanically and cannot converge

I picked the richest real run in the store and rebuilt it from `team_assignments` +
`team_assignment_steps` + `team_assignment_events`. It rebuilt **completely** — every transition,
every timestamp, every failure reason, every resume:

```
ASSIGNMENT a1a399f6 · "Advance: Sanitize error messages before echoing them to the client"
  status awaiting_review · strategy llm_eval · max_parallel_steps 3 · goal-linked
  created 2026-06-10 09:58:06 · completed_at NULL · error_message NULL

  #0 failed   retry=8  exec=bb5eeba8  dep=—       Implement error message sanitization
  #1 skipped  retry=0  exec=NULL      dep=[#0]    Review the sanitization PR
  #2 skipped  retry=0  exec=NULL      dep=[#1]    Security-verify no residual error leakage
  #3 skipped  retry=0  exec=NULL      dep=[#2]    Test and merge the PR

  09:58:06  created {"step_count":4} → status_running → #0 matching → #0 running
  10:08:15  #0 failed "Step execution timed out"
            #1,#2,#3 skipped "Dependency was skipped or failed"  →  status_awaiting_review
  10:10:11  athena_review_resolution {"outcome":"incident","rationale":
              "QA persona is disabled; the implementation step timed out before executing …"}
  10:40:27  ← auto-resume round 2:  4 × step_pending, status_running, #0 matching/running
  10:41:53  #0 failed "Execution failed (exit code 1): " → 3 × skipped → awaiting_review
  11:51:45  round 3 → 12:01:52 "Step execution timed out"
  12:35:27  round 4 → 12:44:15 "Execution failed (exit code 1): "
  13:15:27  round 5 → 13:25:33 "Step execution timed out"
  14:00:27  round 6 → 14:01:14 "Execution failed (exit code 1): "
  14:45:27  round 7 → 14:47:45 "Execution failed (exit code 1): "
  19:10:39  round 8 → 19:10:42 "Claude usage limit reached (rolling window)"
  19:55:39  round 9 → 19:55:42 "Claude usage limit reached (rolling window)"
            → awaiting_review, and it has stayed there for 68 days
```

**Say this first, because most of what follows is deviations.** Structurally this is the best
job-coordination instrument in the repo, and the measurements say so:

| structural property, over all 383 assignments / 1,488 steps / 8,486 events | measured |
| --- | ---: |
| assignments whose status is terminal while a step is still non-terminal | **0 / 372** |
| steps whose parent assignment row no longer exists | **0 / 1,488** |
| ledger events whose assignment row no longer exists | **0 / 8,486** |
| steps pointing at a `persona_executions` row that no longer exists | **0 / 944** |
| assignments with zero steps | **0 / 383** |
| transitions reachable in the ledger but not in the row | every one — the ledger is a superset |

The cascade-skip is idempotent across ticks, the restore is transitive and refuses to resurrect a
*human's* skip (`team_assignment_orchestrator.rs:319-328` writes the reason down), the panic in a
step worker is caught and still writes a terminal status (`:733-777`), and the tick loop re-derives
its whole world from the durable rows on every pass. **Nothing in this document should be read as
"the orchestrator is bad."** It is the thing to copy.

**What the reconstruction could NOT recover, and this is the leaf:**

- **Which of the 9 attempts each `execution_id` refers to.** `set_step_execution`
  (`team_assignments.rs:548-559`) is a bare `UPDATE … SET execution_id = ?1`, so the step points at
  the **last** attempt only. Measured across the corpus: **1,301 executions carry a `step_id` stamp
  in their own `input_data`; 950 steps spawned 1,276 of them; 357 (27.4 %) are unreachable from the
  step that spawned them**, across **170 of 972 steps**.
- **How many attempts there actually were.** `retry_count` is bumped only by
  `auto_resume_retryable_steps` (`:386`). Orphan-recovery requeue (`:477`), cascade-restore (`:432`)
  and both review resolutions reset a step to `pending` **without** bumping it. Measured: **326
  extra attempts beyond the first, of which `SUM(retry_count)` explains 177 — 149 (45.7 %) of all
  retries are invisible to the counter that caps retries.**
- **How long the step took.** `update_step_status` COALESCEs `started_at` (set once, never reset) and
  overwrites `completed_at` on every terminal write (`:498-501`). So step #0 reads `09:58:06 →
  19:55:42` — **9h57m for a final execution that lasted 2.3 seconds.** Corpus-wide the widest such
  recorded step duration is **87.32 hours**.
- **Why it kept trying.** At 10:10, ninety-four minutes into the run, an `athena_review_resolution`
  event recorded the actual diagnosis — *"QA persona is disabled; the implementation step timed out
  before executing"*. **Nothing reads that event.** Eight further rounds ran against a cause already
  written down in the same table.

### 0.2 The soft-pause feature cannot execute a single statement, and 8,486 ledger events prove it never has

`pause_assignment` (`team_assignment_orchestrator.rs:526-541`) writes the status `"paused"`.
The live `team_assignments` table declares:

```sql
status TEXT NOT NULL DEFAULT 'queued'
       CHECK(status IN ('queued','running','awaiting_review','done','failed','aborted'))
```

**`'paused'` is not in the list.** Replayed — `update_assignment_status`'s exact `UPDATE`,
transcribed verbatim, against an in-memory database built from the live `CREATE TABLE`:

```
  update_assignment_status -> running          OK  changes=1
  update_assignment_status -> paused           REJECTED — CHECK constraint failed:
                                               status IN ('queued','running','awaiting_review','done','failed','aborted')
  update_assignment_status -> awaiting_review  OK  changes=1
  update_assignment_status -> done             OK  changes=1
  update_assignment_status -> aborted          OK  changes=1
  update_assignment_status -> queued           OK  changes=1
```

Everything downstream is built on a state that cannot exist:

| built for `paused` | site |
| --- | --- |
| the tick loop's clean-exit branch | `team_assignment_orchestrator.rs:577-583` |
| the lost-resume recovery's list of "normal loop exits" | `:191`, `:209` (doc comment) |
| `resume_team_assignment`'s precondition `if assignment.status != "paused" { return Err }` | `commands/teams/assignments.rs:196` — so **resume is unreachable too** |
| two IPC commands, an api module, two store actions | `assignments.rs:177`, `:189`; `api/pipeline/assignments.ts:46,:50`; `assignmentSlice.ts:225,:234` |
| two rendered Pause/Resume buttons | `GoalsMissions.tsx:257,:266`; `ConversationCards.tsx:123-124` |

The write and its audit-event insert share one transaction (`team_assignments.rs:451`), so a
rejected pause leaves no trace at all. Consistent with that: of **8,486** `team_assignment_events`,
the `kind` distribution is `status_running` 617 · `status_done` 343 · `status_awaiting_review` 274 ·
`status_aborted` 23 — and **`status_paused` 0**. The operator has pressed a button that returns a
`Failed to pause team assignment` toast and can never do anything else.

**The type that makes this unrepresentable is already in this repo, correct, and connected to
nothing.** `core/src/models/team_assignment.rs:31-55` declares:

```rust
pub enum TeamAssignmentStatus { Queued, Running, AwaitingReview, Done, Failed, Aborted }
impl TeamAssignmentStatus {
    pub fn as_str(&self) -> &'static str { … }
    pub fn is_terminal(&self) -> bool { matches!(self, Self::Done | Self::Failed | Self::Aborted) }
}
```

Its six variants are **exactly** the CHECK's six values. It derives `TS`, is `#[ts(export)]`, has a
doc comment, and ships as `src/lib/bindings/TeamAssignmentStatus.ts`.

| | measured |
| --- | ---: |
| references to `TeamAssignmentStatus` in 963 `.rs` files, outside its own declaration | **0** |
| references in 4,828 `.ts`/`.tsx` files, outside the generated binding | **0** |
| references to `TeamAssignmentStepStatus` in either tree, outside its declaration | **0** |
| `is_terminal()` call sites in the tree | 10 — all on *other* enums (`executions.rs:882`, `remote_jobs.rs:219,:227,:248`, `p2p/remote_jobs.rs` ×4) |
| the orchestrator's own hand-rolled substitute | `fn terminal_step_status(s: &str)` — `team_assignment_orchestrator.rs:1084` |

This is doctrine **Q3** (*"a type nobody constructs constrains nothing"*) in its purest measured
form, and it inverts the usual prescription: **the fix here is not to design a type. It is to change
one parameter from `&str` to `TeamAssignmentStatus` at a door that already exists.**

### 0.3 The topology apparatus is complete, correct, and has never expressed a graph

The leaf's own framing is *"topological order … conditional edges across dependent steps."* All of it
is built: `depends_on` is a JSON array, `parse_depends_on` (`:1088`) parses N ids,
`step_deps.iter().all(|d| done_ids.contains(d))` (`:721`) is a real join-gate, `restore_cascade_skipped_dependents`
(`:411-443`) walks the dependent subtree transitively to a fixpoint, and `max_parallel_steps` funds
a concurrency budget (`:709`).

| measured over 1,488 live steps in 383 runs | value |
| --- | ---: |
| steps carrying a non-empty `depends_on` | 1,105 |
| **steps with more than one dependency** | **0** |
| assignments by step count | 1:4 · 2:8 · 3:111 · 4:166 · 5:93 · 6:1 |
| assignments with `max_parallel_steps` ≠ 3 | **0 / 383** |
| assignments with `match_strategy` ≠ `llm_eval` | **0 / 383** |

**Every one of the 383 runs is a linked list.** The fan-in gate has never had two inputs, the
parallel budget of 3 has never had two runnable steps to fund, and the "conditional edges" the spine
names are, in the data, `[predecessor]` and nothing else. This is not an argument for deleting the
apparatus — it is the reason the *sequential* failure semantics (cascade-skip, restore, resume) are
the mature part and the *parallel* semantics are untested in production.

### 0.4 Twenty-two of thirty-six durable multi-step job stores have never held a row

Enumerating both live databases for a table with a lifecycle column (`status`/`phase`/`state`) and
either an ordering/dependency column or a name declaring a run, job, plan, pipeline or session of
work:

| | count |
| --- | ---: |
| durable multi-step job/step stores | **36** |
| …that have ever held a row | **14** |
| …that hold **0 rows, ever** | **22** |

The 22 include `dev_auto_runs`, `pipeline_runs`, `dev_pipelines`, `genome_breeding_runs`,
`companion_consolidation`, `companion_consolidation_item`, `companion_night_plan`,
`autopilot_night_runs`, `dev_run_checkpoints`, `remote_jobs`, `chain_stop_reasons`,
`automation_runs`, `schedule_missed_runs`, `assignment_outcomes`, `evolution_promotion_proposals`,
`policy_proposals`, `kb_extraction_runs`, `obsidian_revitalize_runs`, `research_experiment_runs`,
`lab_ab_runs`, `lab_matrix_runs`, `lab_eval_runs`/`lab_consensus_runs`.

Three of those zeroes matter for this leaf specifically, because they are the *explanation*
mechanisms of job engines that demonstrably ran:

- **`chain_stop_reasons`: 0 rows** — while **727 `persona_events` carry `source_type='chain'`**, so
  the chain relay fired 727 times. Cause is one line: `record_stop` only writes
  `if let Some(ctid) = chain_trace_id` (`db/src/chain.rs:246-247`), and **3 of 2,942 traces carry a
  `chain_trace_id`, in 3 groups of one.** The audit that answers *"why did the relay not continue
  here"* is gated on an identifier the chain almost never has.
- **`dev_auto_runs`: 0 rows** — while `dev_tasks` holds **2 rows `status='running'` since
  2026-04-09**. `dev_tools_start_auto_run` writes its ledger row best-effort
  (`task_executor.rs:1500-1502`) and the surrounding wave demonstrably ran.
- **`assignment_outcomes`: 0 rows** — the Self-Evolving-Team learning record that
  `spawn_on_terminal` is called for at **three** terminal sites (`:178`, `:353`, `:693`) across 372
  terminal assignments.

**The live population of multi-step engines is therefore much smaller than the source suggests:
one that ran 383 times (team assignments), one that ran 142 times (deliberations), one that ran
12 times (build sessions), one that ran 9 times (dev tasks), and a chain relay with 727 firings and
no per-run record at all.** Everything else in §7 is measured against those five.

### Sibling boundaries, settled in prose

[**agent-dispatch**](./agent-dispatch.md) owns *the door that starts one agent session and whether it
stays addressable*. **This path owns the job that starts several, in an order.** Its finding that
`fleet_spawn_session` takes no idempotency key is upstream of nothing here — the orchestrator's
single-flight guard (`live_assignments()`, `:107-110`) is the same concern solved at the *job* level
rather than the *spawn* level, and it is the better artifact: it dedupes across resume paths that a
per-call key could not see.

[**idempotent-invocation**](./idempotent-invocation.md) owns *did one click land twice*. **This path
owns whether one JOB advanced twice** — and supplies the corroborating instance its §0 predicted:
`run_assignment`'s doc comment at `:98-106` names, in prose, exactly the double-spawn that path
measured (*"two persona executions, two PRs, doubled token spend"*), and closes it with a
process-wide `HashSet` rather than a database key. That is this leaf's answer to that leaf's
problem, and it is the only place in the repo where the answer is *at the job level*.

[**bounded-parallel-fan-out**](./bounded-parallel-fan-out.md) owns *N sub-tasks under a concurrency
budget with per-item outcomes*. **This path owns the DAG that decides which N are runnable.** The
boundary is sharp and the data makes it sharper: `run_lanes` (`build_session/orchestrator.rs:57-93`,
**2 production call sites**: `fanout.rs:288`, `tool_tests.rs:995`) is the budget primitive and
belongs there; `max_parallel_steps` has **never funded more than one runnable step** (§0.3) and
belongs here.

[**job-claim-and-lease**](./job-claim-and-lease.md) owns *exactly one worker takes a queued row, and
a crashed worker's lease expires*. `build_sessions.claimed_by_instance` / `claim_expires_at` are
its columns; measured here only to report that both are **NULL in 12 of 12 rows**.

[**long-running-job-progress**](./long-running-job-progress.md) owns *liveness, phase and percent for
one multi-minute run, recoverable after remount*. **This path owns whether the run has more than one
step and what happens between them.**

[**stall-watchdog**](./stall-watchdog.md) owns *whether a repeating producer produced anything*, and
bounds every number here: the engine's execution plane has been silent since 2026-06-26. The newest
`team_assignment_steps` row is **2026-06-17 05:33:30**. Everything in this document is a measurement
of a system at rest.

[**execution-trace-instrumentation**](./execution-trace-instrumentation.md) owns *whether ONE unit of
work can be replayed*. **This path owns whether the SEQUENCE can.** Its D10 — *"`chain_trace_id` has
never grouped two executions"* — is confirmed independently here (3 values, 3 rows, **0 groups of
size > 1**) and this path supplies the consequence it could not: that id is the gate on
`chain_stop_reasons`, which is why the chain's own explanation table is empty after 727 firings.

[**domain-event-publication**](./domain-event-publication.md) owns *whether an event was published
and whether anyone listened*. **This path owns the handoff that a published event is supposed to
advance** — and §6 reports the corpus's cleanest pairing result on top of it.
---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count, so an adopting repo can tell physics from local calibration. Each clause names its
warrant.

> **P1 — the whole subject.** *The durable per-step record IS the program counter. The driver must be
> able to die at any instant and be replaced by a fresh driver that reads only the store.* A job
> whose position lives in a call stack, a loop variable, an in-memory map or a language-runtime task
> has a position that ends when the process does. Make every tick re-derive "what is runnable now"
> from the persisted step rows, so restart, resume, review-resolution and crash-recovery are the
> **same code path** rather than four. *Warrant: measured in this repo as 0 invariant violations
> across 383 runs and 1,488 steps, against a sibling engine in the same repo that keeps its position
> in one overwritten column and holds 56 abandoned children.*
>
> **P2 — physics.** *A job's aggregate status must never reach a terminal value while any of its
> steps is non-terminal.* This is the one invariant a multi-step engine can be checked against
> without knowing anything about its domain, and it is checkable on live data at any moment. Where
> an engine deliberately ends with work outstanding, the abandoned work must be *marked* abandoned,
> not left in its in-progress state. *Warrant: two engines in one codebase, one at 0/372 and one at
> 34/118, differing only in whether the terminal decision consults the child count.*
>
> **P3 — physics, and it is the leaf's sharpest defect class.** *Never flip the aggregate to a
> TERMINAL status before applying the per-item effects.* A pre-loop flip to "done" buys at-most-once
> at the price of "and we will never know how far it got": a crash at item k leaves k applied, N−k
> silently dropped, no record of which, and a compare-and-swap that now refuses the retry. Flip to an
> IN-PROGRESS status before, and to the terminal one after — or put the whole batch and the flip in
> one transaction. *Warrant: 4 doors of this shape were opened and read; the two that flip to
> "in progress" are recoverable, the one that flips to "applied" is not, and the one that flips to a
> human-consent value is unre-approvable after a partial crash.*
>
> **P4 — physics.** *Commit the N per-item writes and the parent's status flip together, or make the
> per-item write itself the durable step record.* There is no third safe design. *Warrant: the one
> function in this sweep that does the first — a transaction spanning every item insert plus the
> parent's transition — is also the only batch here where a crash provably leaves nothing partial.*
>
> **P5 — physics, and the one to fix first if you fix one.** *A retry counter must count retries, and
> exactly one cap must consume it.* Two failure modes, both measured: a counter incremented on only
> one of several reset paths under-reports and the cap never bites; a counter shared between two
> unrelated caps means exhausting one silently exhausts the other. *Warrant: 45.7 % of this repo's
> real retries are invisible to its retry counter, and 53 steps had a second, unrelated review cap
> already exhausted before their first review.*
>
> **P6 — physics as a defect.** *A step's attempt history is not the step row.* Overwriting the
> pointer to "the execution this step ran" on each attempt makes every earlier attempt unreachable
> from the only place a reader will look, and makes the step's own start/end timestamps describe a
> span no single attempt occupied. Either keep an attempt row per attempt, or say plainly that the
> row describes the last one. *Warrant: 27.4 % of the executions this engine spawned are unreachable
> from the step that spawned them, and the widest step duration on record is 87 hours for work that
> took seconds.*
>
> **P7 — physics.** *The set of legal states must be a closed type at the door that writes them, not
> a convention spread across call sites and a storage constraint that no compiler compares them
> against.* A lifecycle value spelled as a bare string is checked in exactly one place — at runtime,
> by the store, on the unhappy path — and the failure is a rejected write on a feature nobody tests.
> *Warrant: an entire pause/resume feature — two IPC commands, a store slice, two rendered buttons, a
> loop-exit branch and a resume precondition — is dead because one string is absent from one
> allowlist, while the closed enum with exactly the right variants sits in the same crate with zero
> consumers.*
>
> **P8 — physics as a defect.** *A job's explanation record must not be gated on an identifier the
> job usually lacks.* An audit table whose write is conditional on a correlation id is empty exactly
> when the correlation is weakest, which is when you need it. *Warrant: 727 firings, 0 audit rows,
> because the id is present on 3 runs out of 2,188.*
>
> **P9 — house convention, flagged.** *Derive the name that couples two halves of a handoff from one
> expression, and let both halves call it.* Where an emitter's target name and a receiver's
> subscription name must agree, a shared pure function makes disagreement unspellable and makes the
> wiring pass idempotent per half, so a re-run repairs whichever half is missing. *Warrant: 55 of 55
> live edges paired, 0 hand-typed names in the same table — but no sibling repo has a
> persona-to-persona handoff at all, so this is calibration until someone else reinvents it.*

---

## 1 Trigger

- "This job has several steps — where do I put the state?"
- "Step 3 failed. What happens to steps 4 and 5?"
- "The app restarted mid-run. Can it pick up where it left off?"
- "Add a step / a phase / a stage to this pipeline."
- "Apply all of these at once." / "Run the whole batch."
- "Why is this assignment stuck in `awaiting_review`?"
- "Retry the failed step." / "Resume this run."
- "The team handoff didn't fire — the second persona never woke up."

If you are about to type `depends_on`, `step_order`, `for item in items { … repo::update(…) }`,
`update_*_status(…, "some_state", …)`, a `phase` column, a `tokio::spawn` that owns a job's
lifecycle, a `mark_applied` before a loop, a `while` loop that polls a child's status, or a second
table whose rows are the steps of a first table's row — you are in this situation.

**Not this path:** *one agent session's dispatch door* is [agent-dispatch](./agent-dispatch.md);
*did one click land twice* is [idempotent-invocation](./idempotent-invocation.md); *N sub-tasks under
a concurrency budget* is [bounded-parallel-fan-out](./bounded-parallel-fan-out.md); *exactly one
worker claims a queued row* is [job-claim-and-lease](./job-claim-and-lease.md); *percent and liveness
for one long run* is [long-running-job-progress](./long-running-job-progress.md); *whether a
repeating loop produced anything* is [stall-watchdog](./stall-watchdog.md); *whether one run's
internals can be replayed* is
[execution-trace-instrumentation](./execution-trace-instrumentation.md).

## 2 The one way

**Put the job's position in a per-step table, drive it from a loop that re-derives everything from
that table on every pass, and make the aggregate's status a closed type that can only reach a
terminal value when every step already has.** Concretely: (a) **one row per step**, carrying its own
`status`, its `depends_on`, its attempt count and its terminal timestamps — the row is the program
counter, and no other copy of the position may exist. (b) **The driver is disposable.** Each tick
reads the assignment and its steps, computes runnable = `pending` ∧ all deps `done`, launches up to
the budget, and returns; it holds no state across ticks that it could not rebuild. A crash, a
restart, a review resolution and an auto-resume then all converge on the same code — *re-queue a
step and spawn the driver* — which is why there is exactly one recovery path and not four. (c)
**Single-flight the driver on the job id**, process-wide, because every resume entry point can fire
while a driver is already live; and handle the release window explicitly, because a resume that lands
between "the loop exited" and "the slot was freed" is silently dropped. (d) **Never write a terminal
aggregate status before the per-step effects.** Write an in-progress status before and the terminal
one after; if the effects are all database writes, put them and the terminal flip in **one
transaction** instead. (e) **Spell every lifecycle value as a variant of a closed enum**, and make
the repo function that writes it take that enum — the storage constraint and the code then agree by
construction rather than by review. (f) **Count every retry, and give each cap its own counter.**
Any path that returns a step to `pending` is a retry. (g) **Keep an attempt record per attempt**, or
accept — in writing, on the field — that the step row describes only the last one. (h) **Write the
step transition and its ledger event in one transaction**, so the history can never disagree with the
row. (i) **Then stop.** Do not add a second position for the same job; do not add an explanation
table whose write is conditional on an id the job may not have.

If you must get one right first: **(a) + (b)**. Everything else in this document is recoverable by a
later pass; a job whose position lived in the driver is not.

## 3 Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src/engine/team_assignment_orchestrator.rs:547` `tick_loop` | **the one site to copy.** A 1-second loop that re-reads the assignment and all its steps every pass, cascade-skips, reaps, checks terminal, then launches within budget. It carries **no** position across ticks — `in_flight` is a liveness map, not a cursor. Measured: 0 invariant violations across 383 runs. |
| `:107` `live_assignments()` + `:128-141` | process-wide single-flight on the job id, with the *reason* in the doc comment: without it, every resume path forks a second loop that re-launches the same step — "two persona executions, two PRs, doubled token spend". |
| `:219-248` `respawn_if_resume_dropped` | the corpus's best-documented race repair: it names the exact window (the loop writes its exit status, *then* the wrapper frees the slot; a resume landing in between is absorbed as a duplicate and lost), and bounds the recovery with two guards — live status **and** runnable work — so it can neither restart a terminal job nor loop. |
| `:454-506` `recover_orphaned_assignments` | startup orphan recovery. Any `matching`/`running` step of a `running`/`queued` assignment goes back to `pending` **with a note** (`"App restarted while step was running — re-queued"`), its cascade-skipped dependents are restored, and the driver is respawned. Wired at `background.rs:483`. |
| `:411-443` `restore_cascade_skipped_dependents` | transitive un-skip to a fixpoint, keyed on the **exact sentinel** `"Dependency was skipped or failed"` so a *human's* skip can never be resurrected. `:319-328` states that this coupling is load-bearing and what breaks if someone threads an error message through the user-skip path. Copy the discipline, not just the function. |
| `:733-777` the per-step `catch_unwind` wrapper | a panic inside `run_step` still writes a terminal status. The comment names the failure it prevents: without it the task finishes, the reaper drops the handle, and the assignment hangs in `running` for 2 hours with no terminal write ever. |
| `db/src/repos/orchestration/team_assignments.rs:483-535` `update_step_status` | **the transactional step transition.** One `conn.transaction()` covering the row `UPDATE` **and** the `team_assignment_events` insert, so the ledger can never disagree with the row. `error_message`/`output_summary` are `COALESCE`d so a reset preserves history; `started_at` sets once; `completed_at` stamps on terminal. |
| `src/companion/brain/consolidation.rs:146` `run_consolidation` | **the one site to copy for a BATCH.** Insert the parent in `running` first (a *progress* marker, not a completion), do the expensive call, then open **one** `unchecked_transaction` that inserts every item row **and** flips the parent to `review`, and commit (`:204-253`). A crash anywhere leaves the parent at `running` with zero items — retryable, never partial. |
| `engine/src/team_handoff.rs:57` `handoff_event_type` | **the pairing primitive.** One pure function produces both the emitter's `event_type` and the receiver's `listen_event_type`, so the two halves cannot disagree. Each half is existence-checked independently (`:128`, `:160`), which makes the whole wiring pass idempotent *per half* — re-running repairs whichever side is missing. Live: **55/55 paired.** |
| `core/src/models/team_assignment.rs:31` `TeamAssignmentStatus` · `:63` `TeamAssignmentStepStatus` | the closed enums, with `as_str()` and `is_terminal()`, whose variants are **exactly** the CHECK allowlists. **Currently 0 consumers — see §7 D1. Use them.** |
| `src/engine/build_session/orchestrator.rs:57` `run_lanes` | the bounded-parallel lane executor: `Semaphore` budget, per-lane `catch_unwind`, results in input order tagged by lane id. 2 production call sites. Owned by [bounded-parallel-fan-out](./bounded-parallel-fan-out.md); named here so nobody hand-rolls a third. |

**Do not exist — and this is the leaf's structural finding:**

- **There is no attempt table.** No `team_assignment_step_attempts`, no per-attempt row anywhere.
  `execution_id` is a single column and `retry_count` a single integer. D3 and D4 are downstream.
- **There is no shared multi-step primitive.** `team_assignment_orchestrator`, `pipeline_executor`,
  `dev_tools_start_auto_run` and `build_session/runner` each hand-roll a driver. The good ideas in
  the first (single-flight, orphan recovery, cascade-restore, panic discipline) exist in exactly one
  of the four.
- **Nothing checks a status literal against its column's allowlist.** Not `rustc`, not a test, not
  the census; the check happens once, at runtime, on the write.
- **There is no reconciliation sweep for the terminal-parent invariant.** 34 violations in
  `team_deliberations` have been live since June and nothing counts them.

## 4 Steps

1. **Model the steps as rows before you write any driver.** Parent table + child table with
   `(parent_id, step_order)` unique, a `status`, a `depends_on`, an attempt count, `started_at` and
   `completed_at`. If you cannot answer "what is runnable now?" with one `SELECT`, the design is
   wrong.
2. **Declare both lifecycles as closed enums in the same change as the DDL**, and make the CHECK
   allowlist a rendering of the enum rather than a second list. Give the enum `is_terminal()`; do not
   hand-roll a `fn terminal(s: &str)` beside it.
3. **Make the repo's transition function take the enum, not `&str`.** This is the whole of D1 and it
   is one signature.
4. **Write the transition and its ledger event in one transaction** (`update_step_status:491` is the
   shape). A history that can disagree with the row is worse than no history.
5. **Write the driver as a tick that re-derives everything.** Read parent; bail on terminal/paused;
   cascade-skip; reap; check terminal; compute runnable; launch within budget; sleep. Hold nothing
   across ticks that you could not rebuild from the store.
6. **Single-flight the driver on the job id, and handle the release window.** Claim before spawning;
   release before the error branch; re-read once after a *normal* exit and respawn iff the job is
   live *and* has runnable work (`:219-248`).
7. **Add the startup recovery pass in the same change as the driver.** Not later. `list_active` →
   re-queue non-terminal steps with a note → restore cascade-skips → respawn. Without it the first
   crash wedges a job forever, and the wedge is invisible.
8. **Decide the terminal rule explicitly and enforce it.** "Terminal when every step is terminal" is
   the safe default. If your engine may end with work outstanding, *mark the outstanding work
   abandoned in the same transaction as the parent's flip* — do not leave it `open`.
9. **For a batch inside one function: never flip to terminal first.** In-progress before, terminal
   after; or one transaction around both. If the effects are not all database writes (a spawn, an
   HTTP call), you cannot have a transaction — so you must have a per-item durable record, written
   as each item completes.
10. **Count every reset as a retry, and give each cap its own counter.** If two features need a cap,
    they need two columns.
11. **Then stop.** Do not add a second position for the job. Do not gate the explanation record on a
    correlation id. Do not add a fifth hand-rolled driver — extend one of the four.

## 5 Anti-patterns

- **Flipping the aggregate to a terminal status before the loop.** *Failure:* a crash at item k
  leaves k applied, N−k dropped, no record of which, and a compare-and-swap that refuses the retry.
  **Measured: `apply_persona_memory_review_proposal` (`commands/core/memories.rs:901`) CAS-flips to
  `applied` before iterating `proposal.entries` at `:920`, where each entry can `delete_non_core`,
  `update_importance`, synthesize a memory or archive its sources.** The comment at `:896-900` is
  honest about the trade it took (at-most-once) and silent about the one it paid for it.
- **A lifecycle value spelled as a bare string at the call site.** *Failure:* the legal set is a
  convention; the store is the only checker; the failure surfaces as a rejected write on a rarely
  used path. **Measured: 152 such sites in 26 files, against 72 sites that pass a typed variant; the
  single most violating file is the best orchestrator in the repo (21 sites), and one of its 21 is
  `"paused"`, which no `team_assignments` row can hold.**
- **A retry counter that only one of several reset paths increments.** *Failure:* the cap never
  bites and the history is wrong. **Measured: 4 code paths return a step to `pending`; 1 bumps
  `retry_count`. 149 of 326 real retries (45.7 %) are uncounted.**
- **Two caps sharing one counter.** *Failure:* exhausting one silently exhausts the other.
  **Measured: `auto_resume_retryable_steps` bumps `retry_count` for rate-limit retries
  (`:386`) and `run_step` gates the QA fix loop on `step.retry_count < MAX_QA_FIX_ROUNDS` where
  `MAX_QA_FIX_ROUNDS = 2` (`:964`, `:1119`). 53 of 1,488 steps reached `retry_count >= 2` on rate
  limits alone, so their first QA bounce goes straight to "human review required" — 33 of those 53
  are `done`.**
- **Overwriting the pointer to the current attempt.** *Failure:* every earlier attempt becomes
  unreachable from the only place anyone looks. **Measured: `set_step_execution`
  (`team_assignments.rs:548-559`) is a bare `UPDATE`; 357 of 1,301 stamped executions (27.4 %) are
  unreachable, across 170 of 972 steps.**
- **A `started_at` that COALESCEs and a `completed_at` that overwrites.** *Failure:* the row reports
  a duration no attempt occupied. **Measured: 87.32 hours is the widest; the reconstructed run reads
  9h57m for a 2.3-second final attempt.**
- **Ending the parent while a child is still in progress.** *Failure:* the aggregate asserts a
  completion that did not happen and the abandoned children look live forever. **Measured:
  `plan_transition` (`deliberation.rs:236-253`, `:274-284`) resolves on `Converged`, on an explicit
  `Conclude`, and on the round cap — three of four terminal paths ignore `open_agenda_after`, which
  it is handed. 34 of 118 terminal deliberations hold 56 `open` agenda items.**
- **Gating the explanation record on a correlation id.** *Failure:* the audit is empty exactly when
  the correlation is weakest. **Measured: `chain.rs:246` writes a stop reason only
  `if let Some(ctid) = chain_trace_id`; 727 chain firings, 3 runs carrying the id, `chain_stop_reasons`
  0 rows.**
- **A per-item write inside a loop whose Result is discarded.** *Failure:* the item stays in its old
  state and the parent transitions anyway. **Measured: `advance_one_deliberation`
  (`deliberation.rs:243`, `:245-247`) does `let _ =` on both `add_agenda_item` and
  `resolve_agenda_item`, then computes `open_after` from a *re-read* — so a failed resolve is
  invisible to the write and visible to the count, and three of the four terminal branches ignore
  the count anyway.**
- **Reporting an edge as wired when only half of it was.** *Failure:* the emitter exists and the
  receiver does not, and the pass says "wired". **`team_handoff.rs:183-185` sets `wired_something`
  if EITHER half was created, and both create-failures are `tracing::warn!(… "continuing")`
  (`:152-156`, `:176-180`).** The pass is idempotent so a re-run repairs it — but nobody is told to
  re-run. *(Live: 55/55 currently paired, so this is a latent hazard, not an active defect.)*
- **Recording a user cancellation as a failure.** *Failure:* the terminal state lies about who ended
  the job. **Measured: `background_job.rs:437` — `cancel()` calls
  `set_status(app, job_id, "failed", Some("Cancelled by user".into()))`.**
- **Keeping the job's position in the driver.** *Failure:* the position ends when the process does.
  **Measured as an absence: `build_sessions` carries one overwritten `phase` column and no step
  history — `phase_timings_json`, `parser_result_json` and `workflow_json` are NULL in 12 of 12
  rows, and so are `claimed_by_instance` and `cli_pid`.**
## 6 Evidence

**The one site to copy: `src/engine/team_assignment_orchestrator.rs:547-785` — `tick_loop`.** Read it
as six decisions, in the order they appear:

1. **It re-reads the world every pass** (`:573`, `:584`, `:614`). The assignment and the step list are
   fetched fresh on each tick, twice — once before the cascade-skip and once after — so the terminal
   check sees the writes the cascade just made. Nothing about "where the job is" survives a tick.
2. **The cascade-skip is idempotent and reason-marked** (`:588-607`). Every `pending` step whose
   `depends_on` names a `skipped`-or-`failed` step becomes `skipped` with the exact sentinel
   `"Dependency was skipped or failed"`. Running it twice is a no-op; the sentinel is what makes the
   *restore* safe.
3. **The terminal check is conjunctive and honest** (`:615-621`, `:639-644`). `any_failed &&
   !any_pending_or_running && in_flight.is_empty()` → `awaiting_review`; `all_terminal &&
   in_flight.is_empty()` → `done`/`failed`. **This one expression is why the invariant holds at
   0/372.** Note `in_flight.is_empty()` in both — an in-memory liveness map is consulted *in
   addition to* the durable statuses, never instead of them.
4. **The launch gate is a real join** (`:717-723`): `step.status == "pending"` and
   `step_deps.iter().all(|d| done_ids.contains(d))`, funded by `budget = max_parallel_steps -
   in_flight.len()`.
5. **The step worker cannot escape without a terminal write** (`:733-777`). `catch_unwind` around
   `run_step`, and both `Err` and panic arms write `failed` with the message. The comment names the
   alternative outcome precisely: the assignment hangs in `running` until `ASSIGNMENT_MAX_TICKS`
   (2 h) or the next restart.
6. **It exits rather than spins.** Every terminal branch `return Ok(())`, and the resume paths spawn
   a *new* loop. A driver that can only be started, never resumed in place, is what makes crash
   recovery and review-resolution the same code.

Supporting exemplars, each for one property:

| site | the property to copy |
| --- | --- |
| `team_assignment_orchestrator.rs:98-110` | a single-flight registry keyed on the job id, with the doubled-spend failure named in the doc comment. The guard is at the **job** level, which is the only level that can see a resume arriving from six different entry points. |
| `:189-248` `respawn_if_resume_dropped` | the sharpest race documentation in the corpus: the window is named, both bounding guards are justified, and the "isn't already live again" case is delegated to `run_assignment`'s own `insert`. |
| `:319-328` (`resolve_review_skip`) | **a deliberate asymmetry, written down.** A user's skip passes `None` as the error message *specifically* so `restore_cascade_skipped_dependents` can never resurrect it, and the comment says the coupling is load-bearing and what breaks if a future change threads a message through. This is how to document an invariant that lives in a value rather than a type. |
| `:388-392`, `:267-271`, `:298-301` | the same F1 repair — restore the cascade-skipped tail — applied at **all three** resume doors, each with the observed symptom in the comment (*"implement retried fine, QA never ran"*). Fixing every place that needs the behaviour, not every place that showed the bug. |
| `db/src/repos/orchestration/team_assignments.rs:483-535` | row transition + ledger event in one transaction; `COALESCE` on the fields a reset must preserve; `CASE WHEN` on the timestamps. |
| `src/companion/brain/consolidation.rs:146-253` | parent inserted `running` → expensive call → **one transaction** holding every child insert *and* the parent's flip to `review` → commit. The batch shape §5's first anti-pattern gets wrong. |
| `engine/src/team_handoff.rs:57-59` + `:128`, `:160` | one derivation, two independent existence checks; a re-run repairs a half-wired edge. |
| `db/src/chain.rs:156-210` `read_chain_cost_ceiling` | `CostCeilingReading::{Disabled, Configured, Corrupt}` — a **corrupt** ceiling halts the cascade instead of resolving to "disabled". Unset and unparsable are not the same value. This is the type discipline §2(e) asks for, in the one place the chain applies it. |

### What this sweep CLEARED — say it, so nobody re-litigates it

- **The assignment engine's terminal invariant is not broken.** 0 of 372 terminal assignments has a
  non-terminal step, over 1,488 steps. A composer arriving expecting partial completion should stop
  looking *here* and look at `team_deliberations` (§7 D6).
- **Referential integrity is intact for this leaf.** 0 orphan steps, 0 orphan ledger events, 0 steps
  pointing at a missing execution. This is *not* the `execution_traces` situation (29.9 % orphans) —
  the FK cascades on these tables held.
- **The ledger is complete.** Every transition the code writes appears in `team_assignment_events`,
  in one transaction with the row, and the reconstruction in §0.1 needed nothing else.
- **The handoff wiring is 100 % paired.** 55 chain triggers, 55 receivers, 0 hand-typed names.
- **`run_lanes` is not dead.** 2 production call sites; the reuse backlog's older "0 callers" claim
  is stale.

### Convergence — 5 sibling repos, all opened, and the effective cohort is **3**

Read-only sweep 2026-08-17 of `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened**; nothing below is reported by omission.
Searched for names (`steps`, `stage`, `phase`, `depends_on`, `dag`, `topolog`, `workflow`,
`orchestrat`, `saga`, `compensat`, `checkpoint`, `resume`, `requeue`, `reap`, `lease`) as well as
mechanisms, and over every migration set.

**Lineage first, because it changes the denominator — and it changed since the last sweep.**
[`execution-trace-instrumentation`](./execution-trace-instrumentation.md) reported `personas-cloud`
and `personas-web` as one system via a shared `@dac-cloud/shared` package. **That npm link is now
gone — zero matches for `dac-cloud` anywhere in `personas-web`.** But the coupling survives in two
other forms: `personas-web/scripts/setup-sync-db.sql:79-102` declares `synced_executions` with this
repo's column set verbatim (`retry_of_execution_id`, `retry_count`, `claude_session_id`,
`model_used`, `cost_usd`, `duration_ms`), and `src/app/api/executions/[id]/stream/route.ts:16-22`
reverse-proxies to the exact SSE route `personas-cloud` serves at `orchestrator/src/httpApi.ts:298`.
So they are still one system, now coupled over the wire. `personas-cloud`'s *schema* is a port of
ours (`packages/shared/src/types.ts:1-3` says so in a comment: *"mirroring desktop Tauri models"*),
while its *runtime* is independently written — `recoverStaleRunningExecutions` and the string
`"Orchestrator crashed — execution was in-flight"` have zero matches in this repo. **Effective
independent cohort for this leaf: 3 (`brainiac`, `vibeman`, `ascent`), plus `personas-cloud` at half
weight on runtime clauses only, plus `personas-web` at zero.**

| # | clause | verdict | evidence |
| --- | --- | --- | --- |
| 1 | **A durable, WRITTEN per-step history exists** | **PERSONAS IS ALONE — 1 of 6, and the label's direction is backwards** | Every sibling keeps a **cursor**, not a history. `personas-cloud`: one flat `persona_executions` row. `brainiac`: a durable job row, chain in-process. `ascent`: `ScanDimension` models rubric dimensions, not steps. **`vibeman` is the finding** — `migrations/117_autonomous_agent.ts:38-55` declares a textbook per-step table (`agent_steps` with `goal_id`, `order_index`, per-step `status`/`result`/`error_message`/`tokens_used`, FK to `agent_goals` carrying `total_steps`/`completed_steps`/`current_step_id`) and **it has zero writers**: `agentStepRepository` has exactly one importer, re-exported at `db/index.ts:140` and called by nobody. Its live path is a cursor — `schema.tables.ts:196-197` `current_step TEXT` + `total_steps INTEGER`, nulled on requeue. **The fleet did not choose a different design; four of five have no design, and the fifth wrote one and never wired it.** |
| 2 | **A dependency / topology declaration** | **2 of 6, and the sibling's is better than ours where ours is worse than its own storage** | `vibeman/src/lib/dag/dagScheduler.ts` is the cohort's only topology *engine*: `DAGTask.dependencies` (`:22`), `validateNoCycles` DFS (`:64-94`), ready/blocked classification (`:99-164`), `getNextBatch` under a parallelism cap (`:170-177`), `getExecutionLevels` with an explicit cycle-break (`:184-218`). This repo ships `depends_on` with **no cycle validator and no level resolver** — but our edges are a column and **theirs live in `localStorage`** (`store/dependencyStore.ts:62`, zustand `persist`), rendered by real components (`DependencyBadge.tsx:21` ← `KanbanTaskCard.tsx:133`, `TaskItem.tsx:222`). `ascent` is a clean zero: every `depends_on`/`dag`/`topolog` hit lives in `docs/`, `reference-data/` or `tiger/` session JSON — **zero in `src/`**. |
| 3 | **Crash / orphan recovery exists** | **CONVERGED ON THE NEED — 5 of 6 — and DIVERGED on the mechanism, which is where the value is** | Four distinct answers. `personas-cloud` `db.ts:1249-1265`: splits **requeueable** (`queue_data IS NOT NULL` → `'queued'`) from **unrecoverable** (→ `'failed'` with a named reason) rather than blanket-requeueing, at boot (`dispatcher.ts:1144-1153`) **and** on a periodic sweep (`eventProcessor.ts:45-67`). `vibeman` `scanQueueWorker.ts:141-150`: three layers — unconditional `resetAllRunning()` at fresh boot (rationale: age-based recovery cannot catch a 30-second-old corpse), `resetOrphanedRunning(10min)` for live restarts, plus phantom-id clearing. `brainiac`: claim-time reaping (below). **`ascent` needs no recovery pass at all** (below). `personas-web` alone has none, and has nothing to recover. **This is the clause where the fleet agrees, and it is the clause this repo is on the right side of** (`recover_orphaned_assignments`, `:454-506`). |
| 4 | **The aggregate is flipped TERMINAL before the per-item effects** | **PERSONAS IS ALONE IN THE DEFECT — 0 of 5 siblings** | Nobody else does it. `vibeman/src/lib/scanQueueWorker.ts:593-605` is the nearest miss and it is the *correct* ordering with a different hole: N idea updates commit inside `db.transaction(...)`, then `'completed'` is written at `:605` **outside** it — a crash between leaves N accepted items under an `in_progress` parent. `personas-cloud` `eventProcessor.ts:535-540` writes `recordEventDispatch` **before** `dispatcher.submit` and the comment calls it *"the idempotency key"* — correct ordering, non-atomic pair (`submit` is an in-memory ring-buffer push, `dispatcher.ts:27`), so a crash between strands the execution for up to 5 minutes. `brainiac/worker.rs:427-440` flips **after**, deliberately, with the reason written down. **D2 is a house defect and P3 must be adopted on its logic, not on anyone's precedent.** |
| 5 | **N per-item writes and the parent's flip commit together** | **1 of 6, and `ascent` is the exemplar to import** | `ascent/src/lib/db/scans-persist.ts:234` — one `prisma.$transaction` holding the parent `Scan`, N `ScanDimension`, N `Recommendation`, contributor upserts, a dependency-ordered delete of a superseded mock scan, **and** the audit entry, with the hole it closes named in the comment: *"a crash mid-way left a scan with no contributors or no audit row."* This repo has the shape in exactly one place (`run_consolidation`) over a table with **0 rows**. `vibeman` gets it half right; `brainiac` puts its audit row deliberately outside the job transaction **and says why** (`worker.rs:427-440`: propagating an audit failure would skip `queue::complete`, re-run a *succeeded* source, and eventually dead-letter it) — a reasoned exception, not an oversight. |
| 6 | **One retry counter serves two unrelated caps** | **PHYSICS AS A DEFECT — 2 of 4 independent** | `vibeman/src/components/cli/store/cliExecutionManager.ts:520` — `MAX_TASK_RETRIES = 3` is checked against the same `task.retryCount` at `:640` (*server unreachable during recovery*) and `:709` (*task was interrupted, re-queue*), with a third cap `MAX_RECOVERY_ATTEMPTS = 5` (`:523`) over the same path. **That is D4 of this document, in TypeScript, arrived at independently.** `personas-cloud` is clean (one `retryCount`, one `MAX_REQUEUE_RETRIES = 5`, one purpose). `brainiac` has one budget with two enforcement points, deliberately. `ascent` has **no attempt counter at all** — which is its own defect (below), not compliance. |
| 7 | **A crash-poison job has a terminal path** | **1 of 6, and `brainiac` is the one answer worth importing verbatim** | `brainiac/crates/brainiac-store/src/queue.rs:1-31` distinguishes three terminal outcomes in its module docs — `ok`, `failed` (*"adjudicated — the worker ran the job, caught an error, and reported it"*), and `dead` (*"crash-poison: the job kept crashing the worker before it could report"*) — and enforces it with **claim-time reaping**: ready jobs at `attempts >= MAX_ATTEMPTS` are `DELETE … RETURNING` → `INSERT INTO queue.archive` with `outcome='dead'`, **in the same transaction as the SKIP-LOCKED claim**. `attempts` is bumped **on claim, not on failure** (`:5-15`), so a crash-redelivered job and a cleanly-failed one consume the same budget. **Nobody else in the family, including this repo, can terminate a deterministic crasher.** `ascent` is the counter-example and reports it as a gap: no attempt ceiling, no dead letter, so a permanently broken repo retries every 6 h forever. |
| 8 | **Crash recovery WITHOUT a recovery pass (a lease)** | **1 of 6, and it is the cheapest correct answer in the sweep** | `ascent/src/lib/db/org-watch.ts:209-217` — `claimRescan` is a conditional `updateMany` (`nextScanAt: { lte: now }` → `now + CLAIM_LEASE_MS`) returning true only on `count === 1`. Atomic, cross-instance, and `api/cron/rescan/route.ts:146-149` states the payoff: *"a run that died/timed out before reaching here re-qualifies after the lease instead of silently skipping a whole cadence."* Its sibling `claimRepoScan` carries the reasoning for choosing a TTL over a boolean: *"a leaked boolean lock would bar a repo from every future scan — a strictly WORSE bug than the duplicate it guards against."* **This repo achieves less with a whole startup sweep.** |
| 9 | **Watermarks advance from observed data** | **THE FLEET DESIGNED THE PROBLEM AWAY — 1 observed cursor in 6 repos, and it does not matter** | The structural result, and it reframes the brief (§12 correction 4): **no sibling has a permanent-skip watermark, because no sibling selects work by a time RANGE.** All three independents select by **row state** — `visible_at <= now() AND attempts < N` (brainiac `queue.rs`), `status = 'queued'` (vibeman), `nextScanAt <= now()` (ascent). Their ~4 wall-clock values each are visibility and backoff *timers*, not "rows since T" cursors, so whether the clock is read before or after the work cannot lose anything. The one observed-data worklist is `brainiac`'s `documents.dirty_at`, and its `compose_tick` doc explains the choice against a queue: *"dirty pages are already a durable, idempotent work list in the database — enqueueing a job per dirty page would add a second, weaker source of truth."* |
| 10 | **A wired per-job step UI** | **2 of 6 wired, 1 dead, and ours is real** | `brainiac`'s ingest module hits a real `/v1/pipeline/runs` (`console/app/console/modules/ingest/Module.tsx:22-30` → `crates/brainiac-server/src/console.rs:78`) and falls back to synthetic data **behind an unconditional `DemoBanner`** — an honest degradation. `vibeman`'s dependency badges render real edges from a `localStorage` store. `personas-web`'s flow composer (`src/components/flow-composer/data.ts:10-31`) is a **hardcoded `TOOL_CATALOGUE`** mounted once by a landing-page section — zero per-step status, zero real data. This repo's `AssignmentReplay.tsx` / `GoalTaskTable.tsx` read live steps. |

> **The single strongest sibling result is `brainiac`'s `failed` vs `dead` split, because it names a
> terminal state this leaf's whole §7 is missing.** Every retry mechanism measured here — 9 rounds
> on one step, `retry_count` reaching 9, `MAX_QA_FIX_ROUNDS`, `AssignmentAutoResumeSubscription` —
> answers "how many times do we try?" and none answers "what do we call a step that has stopped
> being tryable?" The reconstructed run in §0.1 ended at `awaiting_review` and has sat there for 68
> days. `brainiac` archives it with `outcome='dead'` **inside the claim transaction**, so the queue
> cannot re-offer it. That is a state, not a policy, and it is importable.

> **The second strongest is `ascent`'s lease, because it deletes code this repo has.**
> `recover_orphaned_assignments` is 53 lines that run once at boot, cannot help a job orphaned by a
> hang rather than a restart, and needs `list_active` to be exactly right. A claim with an
> expiry — one conditional `UPDATE … WHERE claim_expires_at < now() … RETURNING` — recovers from
> *every* liveness failure with no recovery code at all. This repo already has the columns:
> `build_sessions.claimed_by_instance` and `claim_expires_at`, **NULL in 12 of 12 rows.**

> **Three corrections offered upward to siblings, not applied** (per the runbook, sibling findings
> are reported, never edited):
> 1. `vibeman/src/app/api/system-status/route.ts:379` selects `requirement_name, status,
>    elapsed_time FROM conductor_runs`; **neither `requirement_name` nor `elapsed_time` is created by
>    any of the nine migrations that build that table**, so SQLite throws and the surrounding
>    `catch` returns `status:'unknown'` — a permanently blank Task Runner panel with no error
>    surfaced. *(Independently re-found here; already reported by
>    [execution-trace-instrumentation](./execution-trace-instrumentation.md) §6 clause 4.)*
> 2. `vibeman`'s `conductor_runs` has **zero writers** and three readers, across nine migrations
>    (134, 200-207, 211) that evolve a table nothing writes.
> 3. `ascent`'s autoscan path has no attempt counter and no dead-letter, so a permanently broken
>    repo retries every 6 h forever — exactly the crash-poison loop `brainiac`'s claim-time reaping
>    exists to kill. Two siblings, opposite ends of the same axis.

## 7 Deviations found

Every entry is live on `master` @ `50d736f6c`, measured against read-only copies of the operator's
databases. **Nothing was applied.**

### D1 — the closed enums for both lifecycles exist, are correct, and have zero consumers

`core/src/models/team_assignment.rs:31-55` and `:60-89` declare `TeamAssignmentStatus` and
`TeamAssignmentStepStatus` with `as_str()`, `is_terminal()`, `#[derive(TS)] #[ts(export)]`, doc
comments, and variant sets that **exactly** match the two CHECK allowlists in the live schema.

| | measured |
| --- | ---: |
| `TeamAssignmentStatus` references in 963 `.rs`, outside its declaration | **0** |
| `TeamAssignmentStepStatus` references in 963 `.rs`, outside its declaration | **0** |
| either, in 4,828 `.ts`/`.tsx`, outside the generated bindings | **0** |
| `is_terminal()` call sites in the tree | 10 — all on other enums |
| the orchestrator's hand-rolled substitute | `fn terminal_step_status(s: &str)` at `:1084` |
| status literals passed as `&str` to these two doors | 21 in `team_assignment_orchestrator.rs` alone |

`update_assignment_status(pool, id, status: &str, …)` and `update_step_status(pool, id, status: &str,
…)` are the two doors. **Changing one parameter each is the whole fix**, and it is what makes D2
impossible.

### D2 — the pause/resume feature cannot execute, and never has

`pause_assignment` (`:526-541`) writes `"paused"`; the live `team_assignments.status` CHECK admits
six values and that is not one of them. Replayed against the live DDL: **rejected**
(§0.2). Everything downstream is unreachable — `resume_team_assignment`'s precondition
(`commands/teams/assignments.rs:196`) requires the status the write cannot produce; the tick loop's
`paused` exit (`:577`) can never be taken; `respawn_if_resume_dropped`'s doc comment names `paused`
as a normal loop exit (`:191`, `:209`). Two IPC commands, two api functions, two store actions and
two rendered buttons (`GoalsMissions.tsx:257,:266`; `ConversationCards.tsx:123-124`) sit on top.
**0 of 8,486 ledger events is `status_paused`**, and the write shares a transaction with its event
insert so a rejected pause leaves no trace at all.

**Fix:** either add `'paused'` to the CHECK **and** the enum (a migration), or delete the feature.
Do not do it by hand at 21 call sites — do D1 first and the compiler enumerates them.

### D3 — 45.7 % of real retries are invisible to the retry counter

Four code paths return a step to `pending`; **one** bumps `retry_count`:

| path | site | bumps? |
| --- | --- | :---: |
| `auto_resume_retryable_steps` | `:385-386` | **yes** |
| `recover_orphaned_assignments` (restart requeue) | `:477-484` | no |
| `restore_cascade_skipped_dependents` | `:432` | no |
| `resolve_review_edit` / `resolve_review_reassign` (via `edit_step_description` / `override_step_assignment` → `resume_assignment`) | `:265`, `:296` | no |
| `trigger_qa_rework` (predecessor + QA step) | `:1175`, `:1214` | no |

Measured: **950 steps spawned 1,276 executions — 326 attempts beyond the first. `SUM(retry_count)`
over those steps is 177. 149 attempts (45.7 %) are uncounted.** The counter gates
`AssignmentAutoResumeSubscription`'s per-step cap, so the cap is applied to a number that under-reports
by roughly half.

### D4 — one counter, two unrelated caps

`run_step:964` gates the QA fix loop on `step.retry_count < MAX_QA_FIX_ROUNDS` (`= 2`, `:1119`).
`auto_resume_retryable_steps:386` bumps the same column for **rate-limit** retries. **53 of 1,488
steps reached `retry_count >= 2`** — their first `qa.pr.changes_requested` takes the
`"fix-loop cap reached; human review required"` branch (`:970-988`) without a single fix round.
**33 of the 53 are `done`**, so this is not hypothetical: a third of the affected steps completed
having spent a review budget on an unrelated failure mode.

**Fix:** a `qa_rework_count` column. The two caps measure different things.

### D5 — 27.4 % of the executions this engine spawned are unreachable from the step that spawned them

`set_step_execution` (`team_assignments.rs:548-559`) is `UPDATE … SET execution_id = ?1`. Measured
by parsing the orchestrator's own `step_id` stamp out of `persona_executions.input_data`
(`build_step_input:1451`, the stamp at `:1459`): **1,301 executions carry the stamp; 950 steps spawned 1,276 of them; 357
(27.4 %) are not the value in `steps.execution_id`; 170 of 972 steps lost at least one attempt.**
Compounding it, `update_step_status` COALESCEs `started_at` and overwrites `completed_at`
(`:498-501`), so a retried step's own timestamps span every attempt: **the widest recorded step
duration is 87.32 hours**, and the run reconstructed in §0.1 reads 9h57m for a final attempt that
lasted 2.3 seconds.

### D6 — 34 of 118 terminal deliberations hold 56 `open` agenda items

`plan_transition` (`src/engine/deliberation.rs:214-296`) is handed `open_agenda_after` and consults
it in **one** of its four terminal branches: it resolves on `StatusSignal::Converged`, on
`ModeratorAction::Conclude`, **or** on `open_agenda_after == 0` (`:236-241`), and again
unconditionally at the round cap (`:274-284`). So two of the terminal paths end the parent with work
outstanding by design — and the outstanding items keep `status='open'` forever rather than being
marked abandoned. Measured: **34 of 118 terminal deliberations, 56 open items.** The same query
against the assignment engine returns **0 of 372**.

Compounding it, `advance_one_deliberation:243` and `:245-247` apply the moderator's agenda edits with
`let _ =` on both `add_agenda_item` and `resolve_agenda_item`, then re-read the count. A failed
resolve is therefore invisible to the writer and visible to the counter — and three of the four
terminal branches ignore the counter anyway.

### D7 — `chain_stop_reasons` is empty after 727 chain firings

`db/src/chain.rs:246-247`: the stop-reason recorder writes only `if let Some(ctid) = chain_trace_id`.
The doc comment states the intent — *"only records when this hop belongs to a chain trace … so every
reason is queryable per trace"* — and the measurement is the cost: **`chain_trace_id` is present on
3 of 2,942 traces, in 3 groups of one; `persona_events` holds 727 rows with `source_type='chain'`;
`chain_stop_reasons` holds 0.** Nine distinct stop reasons (depth limit, lookup failure, cost
ceiling, cycle, …) are constructed at call sites that can never fire the write. The one instrument
that answers *"why did the cascade stop here"* has never answered it.

### D8 — the wiring pass reports a half-wired edge as wired

`engine/src/team_handoff.rs:183-185` sets `wired_something` if **either** the emitter or the receiver
was created, and both create failures are `tracing::warn!(… "continuing")` (`:152-156`, `:176-180`).
An edge whose chain trigger landed and whose listener did not is counted in `edges_wired` and
reported as success by `repair_team_handoff`. The pass is idempotent per half, so re-running repairs
it — but nothing tells anyone to re-run, and no query anywhere counts unpaired edges.
**Live state is clean: 55 of 55 paired.** This is a latent hazard, recorded because the reporting is
what would hide it.

### D9 — 22 of 36 durable multi-step job stores have never held a row

§0.4. Three of the zeroes are the explanation mechanisms of engines that demonstrably ran:
`chain_stop_reasons` (D7), `dev_auto_runs` (0 rows while `dev_tasks` holds 2 `running` since
2026-04-09), and `assignment_outcomes` (0 rows against 372 terminal assignments, with
`team_assignment_learning::spawn_on_terminal` called at three sites — `:178`, `:353`, `:693`).
`companion_consolidation` and `companion_consolidation_item` are also 0/0, which means **the batch
shape this document holds up as the exemplar (§3, `run_consolidation`) has never executed.** The
code is right; nothing is asserting it stays right.

### D10 — `build_sessions` keeps a cursor, not a history, and its lease columns are unused

12 rows. `phase` is one overwritten column (`promoted` ×10, `test_complete` ×2). Measured across all
12: `phase_timings_json` NULL 12/12, `parser_result_json` NULL 12/12, `workflow_json` NULL 12/12,
`claimed_by_instance` NULL 12/12, `claim_expires_at` NULL 12/12, `cli_pid` NULL 12/12. A crash
mid-build leaves one word describing where it was and nothing describing how it got there. This is
the exact shape the convergence sweep found in four of five siblings (§6 clause 1) — the difference
is that this repo has an engine that does it right, 400 lines away.

### D11 — the topology apparatus has never expressed a graph

**0 of 1,488 steps has more than one dependency**; 1,105 carry exactly one; `max_parallel_steps` is
3 in all 383 runs and has never had two runnable steps to fund; `match_strategy` is `llm_eval` in
all 383. Not a defect — recorded because it bounds every claim about the parallel path in this
document, and because there is **no cycle validator and no topological-level resolver** in this repo
(a sibling has both, §6 clause 2), so the first genuine diamond will be the first test of code that
has never run against one.

### D12 — a user cancellation is recorded as a failure

`src/background_job.rs:437`: `cancel()` calls
`self.set_status(app, job_id, "failed", Some("Cancelled by user".into()))`. The terminal state and
the reason disagree, and every consumer that groups by status counts a deliberate stop as a failure.

### D13 — the review resolution that diagnosed the run is written and never read

In the reconstructed run, an `athena_review_resolution` event at 10:10:11 recorded
*"QA persona is disabled; the implementation step timed out before executing"* — 94 minutes into a
10-hour loop, and **eight further identical rounds followed.** `team_assignment_events` holds 92 such
rows. Nothing in the auto-resume path reads them: `AssignmentAutoResumeSubscription` classifies the
*step's* `error_message` and consults `retry_count`, and the diagnosis lives in a different table
column that no query joins.
## 8 Gaps — what the primitives genuinely cannot do

1. **There is no attempt record, and no call-site discipline can create one.** `execution_id` is one
   column and `retry_count` one integer. D3, D4, D5 and the 87-hour duration are all downstream of a
   missing `team_assignment_step_attempts` table, and every workaround (a JSON blob in
   `output_summary`, a naming convention on the execution) is worse than the schema change.
2. **The retryability classifier can only see the last attempt.**
   `step_failure_is_retryable` (`subscription.rs:1747-1775`) reads `persona_executions` by the
   step's single `execution_id`, which D5 shows is the most recent attempt. It therefore cannot
   distinguish "rate-limited nine times" from "rate-limited once after eight hard failures". In the
   reconstructed run the classifier saw two `usage limit` failures and could not see the three
   timeouts and four exit-code-1s that preceded them.
3. **There is no dead state.** `done | skipped | failed` are the three terminal step statuses, and
   `failed` is reused for "adjudicated failure" and for "this has now failed nine times and will
   fail again". `brainiac`'s `failed`/`dead` split (§6 clause 7) is the missing third, and adding it
   is a migration plus a CHECK change, not a call-site fix.
4. **The tick-loop driver cannot recover from a HANG, only from a restart.**
   `recover_orphaned_assignments` runs at boot. An assignment whose tokio task is alive but wedged
   (or whose loop exceeded `ASSIGNMENT_MAX_TICKS`) is not in `list_active`'s blast radius until the
   next process start. A lease (§6 clause 8) covers both with less code; the current design cannot.
5. **`max_parallel_steps` cannot express per-persona fairness**, and the doc comment says so
   (`:12-15`): persona-level `max_concurrent` gates independently, downstream, so the two budgets
   compose in a way neither can predict. Untested in production because the DAG has never had two
   runnable steps (D11).
6. **A batch whose per-item effect is NOT a database write cannot be transactional.** The night-shift
   dispatcher spawns PTY sessions; `apply_persona_memory_review_proposal` calls repo functions on a
   pooled connection, not a transaction handle; the assignment orchestrator starts executions. §2(d)
   therefore has two arms and the second (a durable per-item record) is the only one available to
   three of the four batch doors in this sweep.
7. **The census cannot assert an absence, and several of the largest findings here are absences.**
   "No table joins a step to its earlier attempts", "no query counts unpaired handoff edges", "no
   reconciliation sweep checks the terminal-parent invariant", "`chain_stop_reasons` has never been
   written" — none is a count of something present. Same limit
   [stall-watchdog](./stall-watchdog.md) Gap 4 and
   [execution-trace-instrumentation](./execution-trace-instrumentation.md) Gap 6 recorded.
8. **No static analysis compares a status literal against its column's allowlist.** The two live in
   different languages and different files; the only comparison happens at runtime, on the write, on
   the unhappy path. §9's rule is a *proxy* for that condition — it counts the untyped spelling, not
   the mismatch — and the mismatch itself needs the instrument specified at the end of §9.
9. **Nothing can tell "this job is waiting for a human" from "this job is abandoned."**
   `awaiting_review` is both. Eleven assignments have held it since June, each with exactly one
   failed step; there is no age, no escalation, no expiry and no query that distinguishes them from
   an assignment that failed ninety seconds ago.

## Prefer a type over a gate

Per the [contract](../golden-path-contract.md), answered explicitly before §9.

**The answer is YES, it is the strongest type-over-gate result the corpus has measured on this
repo, and it required no design work at all: the type already exists.**

```rust
// core/src/models/team_assignment.rs:31 — already written, already exported, 0 consumers
pub enum TeamAssignmentStatus { Queued, Running, AwaitingReview, Done, Failed, Aborted }
pub enum TeamAssignmentStepStatus { Pending, Matching, Running, AwaitingReview, Done, Skipped, Failed }
```

The whole change is two parameters:

```rust
// db/src/repos/orchestration/team_assignments.rs:444, :483
pub fn update_assignment_status(pool: &DbPool, id: &str, status: TeamAssignmentStatus,   error: Option<&str>) -> …
pub fn update_step_status      (pool: &DbPool, id: &str, status: TeamAssignmentStepStatus, error: Option<&str>, out: Option<&str>) -> …
```

Held against all seven qualifications:

1. **A required prop carries only what it actually encodes.** ✔ and this is the discriminating
   check, because it is where the naive version fails. `TeamAssignmentStatus` encodes *which state*
   and nothing else — it does **not** encode "and this state is legal for this table", which is why
   the enum's variant set being identical to the CHECK's is a fact to *assert*, not a fact the type
   gives you. The `successRateSource` failure was a correct union beside an untyped number; here it
   would be a correct enum beside an unverified allowlist. **So the type is the fix and the §9
   instrument's second half (comparing the enum to the CHECK) is not redundant with it.**
2. **Requiredness is orthogonal to closedness.** ✔ and only closedness matters. The `status`
   parameter is already required at all 21 orchestrator call sites; requiring it harder changes
   nothing. Closing it is the entire win: `"paused"` stops compiling.
3. **A type nobody constructs constrains nothing.** ✔ — **and this is the qualification that
   currently FAILS, which is the finding.** Construction sites today: **0**. The enum is inert
   precisely because nothing takes it. After the two-parameter change, `rustc` creates a
   construction site at every one of the 21+ transitions and there is no second way to spell one.
   This is the difference between *available* and *unavoidable*, and it is one signature wide.
4. **A type anyone can construct authenticates nothing.** ✔ with an honest limit. Nothing stops an
   author writing `TeamAssignmentStepStatus::Failed` for a step that succeeded. What becomes
   **impossible** is D2's exact shape: a state that the storage rejects, spelled at a call site,
   surviving review because the string looks like the five strings above it.
5. **Withholding beats requiring.** ✔ read correctly. What is withheld is **the ability to name a
   state the schema has not agreed to**. The current door accepts any `&str`, including one
   assembled by `format!`.
6. **Withhold the dangerous freedom, not the answer.** ✔ The dangerous freedom is *inventing a
   state*. The answer — "this step is now failed, and here is why" — stays fully expressible and
   gains `is_terminal()`, which deletes the hand-rolled `terminal_step_status(s: &str)` at `:1084`.
7. **Withholding a requirement only helps when the requirement was forcing the bad value.** ✔ and it
   rules out the alternatives. Nobody was forced to write `"paused"`; the author wrote it because it
   was the obvious word for the feature being built. Relaxing anything is inert. The constraint has
   to exist at the door or it does not exist.

**Does the type reach the code?** **Yes, and unusually cleanly — but check the four walls first.**
Both doors are ordinary Rust functions with all call sites inside `src-tauri`; `rustc` visits every
one. There is **no `OnceLock`**, no environment variable and no build boundary in this path. The
status **is** interpolated into a SQL statement — but as a **bound parameter** (`params![status, …]`,
`:464`), not a string literal, so doctrine §1 item 1 does not bite. **The one wall that does bite is
item 5, the serialization boundary**, and it bites in a specific and bounded way: the value crosses
into a `TEXT` column and comes back as a `String` in `row_to_assignment`. So the enum guarantees that
**every state this program writes is legal**; it guarantees nothing about the 383 rows already there
or about a row a future migration rewrites. That residual is exactly what the §9 instrument covers.

**What the type does NOT reach, and must not be claimed to:** D3 (an uncounted retry is a missing
call, not a wrong type), D5 (an overwritten column is a schema shape), D6 (the deliberation engine
ends deliberately), D7 (a conditional write), D9 (an absence). **Five of the thirteen deviations are
closed by the type; eight are not.**

**Fix order:** (1) D1 — the two signatures, which surfaces D2 as a compile error and deletes the
hand-rolled terminal check; (2) D2 — decide whether `paused` is a state (migration) or a feature to
delete; (3) D4 — a second counter column, one line of DDL; (4) D3 — bump `retry_count` on the other
three reset paths; (5) D6's abandonment marking; (6) the attempt table (D5), which is the largest and
the least urgent.

## 9 The missing gate

### The conditions, stated stack-free first

Three, and only the first is a count of something present:

> **(A)** A job or step lifecycle transition is addressed by an untyped string at the call site, so
> the set of legal states is a convention rather than a type.
> **(B)** The set of states the code writes is not compared, by any tool, against the set the store
> admits — the comparison happens once, at runtime, on the write.
> **(C)** A job's aggregate status can reach a terminal value while one of its steps has not.

Per the [portability test](../research/portability-test.md), an adopting repo inherits these three
sentences and re-derives its own instrument. What follows is **one census rule** for (A), plus the
specification for the check that covers (B) and (C), which the census cannot express.

### Existing rules checked first, by reading each definition rather than its title

All **162** rules in `scripts/census/rules.json` were enumerated; these eight were opened and read in
full because they are the nearest neighbours, and **site-level overlap was measured against the
FINAL pattern**, not an intermediate draft:

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `unfenced-work-outcome-write` (6/11) | an `UPDATE … SET status='<terminal>' … completed_at … WHERE id=?` **inside a SQL string literal** | The nearest conceptual neighbour — "recording the outcome of work". It keys on the SQL text; mine keys on the **Rust argument** handed to the function that owns that SQL. `update_assignment_status`'s statement uses `?1`, so it matches neither literal. **0 shared lines.** |
| `start-marker-before-admission` (4/7) | `Some("running")` followed by `.insert_running(` | Closest in spirit to §5's first anti-pattern, and disjoint: it pairs a literal with a *registry* call. **0 shared lines.** |
| `unowned-inflight-state-sweep` (6/6) · `partial-terminal-status-set` (6/14) | SQL-literal sweeps and `status IN (…)` membership over `persona_executions` | Both are SQL-string shapes bound to a different table. **0 shared lines each.** |
| `unatomic-sequence-rewrite` (1/3) | a `for` loop reaching `conn.execute("UPDATE … SET <ordering column> = …")` | The closest *structural* neighbour — N writes outside a transaction — and it is scoped to ordering columns via a pooled `conn`. **0 shared lines.** |
| `anonymous-retry-budget` (6/8) | a retry budget spelled as a numeric literal at the site that spends it | Adjacent to D3/D4 and it would **not** have caught either: `ASSIGNMENT_RETRY_MAX` and `MAX_QA_FIX_ROUNDS` are both named constants. The defect is *which counter they read*, which no numeric-literal rule can see. **0 shared lines.** |
| `outcomeless-tick` (8/45) | a `fn tick(` definition returning `()` | `tick_loop` is not a `fn tick(`. **0 shared lines.** |
| `blind-identity-write` (35/82) · `discarded-guard-verdict` (7/11) · `unverified-effect-dispatch` (60/162) · `silent-row-skip` (64/148) · `unobservable-detached-task` (86/169) · `unresumable-migration-step` (1/15) · `discarded-sync-watermark-write` (4/11) · `unreportable-bulk-outcome` (10/14) | discarded results, unchecked writes, detached spawns | All plausible collisions given §5. Measured: **0 shared lines with every one.** |

**Measured overlap: 0 shared source lines against all 15, against the final pattern.** The
comparison is at line level, over every line each match spans, with the narrower-rooted rules
re-scanned across the whole tree (a conservative superset).

### The rule

```json
{
  "id": "untyped-lifecycle-transition",
  "goldenPath": "docs/concepts/golden-paths/multi-step-orchestration.md",
  "title": "A job/step lifecycle transition addressed by a bare string literal at the call site, so the legal state set is a convention rather than a type",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:update|set|mark|transition|advance)_[a-z0-9_]*(?:status|phase|state)\\s*\\(\\s*(?:(?![;{]|\\bfn\\s)[\\s\\S]){0,300}?\"(?:pending|queued|running|matching|awaiting_review|awaiting_action|paused|done|failed|skipped|aborted|cancelled|canceled|completed|applied|discarded|approved|proposed|expired|review|resolved|in_progress|active|stale|incomplete|dead_letter|delivered|errored|open|closed|blocked|promoted|test_complete|analyzing|initializing|transforming|spawning|streaming|claimed|dispatched|processing|succeeded|declined|rejected|archived|escalated|converging|tracking|action_running)\"",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a call to a lifecycle-transition door (update_*_status / set_*_phase / mark_*_state ...) whose argument list carries a bare double-quoted state name. PROXY FOR the stack-free condition: the set of legal states for a job or step is a convention spread across N call sites and one storage constraint that no compiler compares them against, so an invented state is caught once — at runtime, by the store, on the write. EXECUTED, not argued: `update_assignment_status`'s exact UPDATE, transcribed verbatim from team_assignments.rs:455-465 and replayed against an in-memory database built from the LIVE `CREATE TABLE`, is REJECTED for the one status the orchestrator writes that the CHECK omits — `\"paused\"` (team_assignment_orchestrator.rs:538). That single string disables two IPC commands, a store slice, two rendered buttons, the tick loop's clean-exit branch and `resume_team_assignment`'s entire precondition; 0 of 8,486 team_assignment_events is `status_paused`. The closed enums that make it unspellable (TeamAssignmentStatus, TeamAssignmentStepStatus, core/src/models/team_assignment.rs:31,:63) already exist, match the CHECK allowlists variant-for-variant, and have ZERO consumers in 963 .rs and 4,828 .ts files. PRECONDITION (re-derive per repo): this repo names its transition doors `<verb>_<noun>_status|phase|state`, spells states in lower_snake_case, and enforces them with SQLite CHECK allowlists on 23 tables. A repo whose ORM already types the column has the condition designed out and needs no rule. KNOWN IMPRECISION: 2 of the 147 matches (healing.rs:1018,:1030) sit inside a `#[cfg(test)]` module the engine cannot exclude — precision 145/147 = 98.6%.",
    "note": "The positive control is the SAME anchor reached with a typed variant. Control 72 / violating 147 is a RATIO, not a partition: the anchor matches 331 call sites in 83 files, and the residue of 112 passes a variable or parameter in the state slot, which this rule deliberately neither praises nor blames."
  },
  "exclude": [
    {
      "path": "src-tauri/db/src/repos/dev_tools_page_tests.rs",
      "reason": "a test-fixture module carrying NO #[cfg(test)] attribute, so only a filename rule can see it — the doctrine's named case."
    }
  ],
  "baseline": { "files": 26, "matches": 147 },
  "floor": 900
}
```

```json
{
  "id": "untyped-lifecycle-transition-positive-control",
  "goldenPath": "docs/concepts/golden-paths/multi-step-orchestration.md",
  "title": "POSITIVE CONTROL — the same transition doors reached with a typed state variant",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\b(?:update|set|mark|transition|advance)_[a-z0-9_]*(?:status|phase|state)\\s*\\(\\s*(?:(?![;{]|\\bfn\\s)[\\s\\S]){0,300}?\\b[A-Z][A-Za-z0-9]*(?:Status|Phase|State)\\s*::\\s*[A-Z]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "the SAME doors, reached with a typed variant instead of a literal — the compliant form, which exists in this repo at 72 sites across 24 files (LabRunStatus, DeliberationStatus, BuildPhase, ExecutionStatus, RemoteJobStatus). A control returning ~0 would mean the pattern is not discriminating on what it claims to."
  },
  "floor": 900
}
```

### How it was validated

**Two independent implementations, and they DISAGREED — which was the useful part** (§12 correction
5). A brace-matching Rust scanner that extracts each call's **balanced argument list** and buckets it
once, and the census engine's regex. Scanner: 131 violating / 67 compliant. Engine: 152 / 72.
Reconciling every differing site:

- **21 sites found only by the engine, and 19 of them are real** — all in
  `src/engine/pipeline_executor.rs`, the repo's *other* DAG walker, where the call is
  `update_node_status(&mut statuses, member_id, &[("status", serde_json::json!("failed"))])`. The
  scanner took the **first** string literal in the argument list, which is `"status"` — not a state
  name — and bucketed 19 sites as "neither". **A vocabulary-based signal's recall is bounded by its
  author's word list, and the miss hid the single densest file in the population.**
- **2 are genuine over-counts** — `db/src/repos/execution/healing.rs:1018,:1030`, inside a
  `#[cfg(test)]` module opening at `:925`. The engine does not strip `#[cfg(test)]`; the scanner
  does. **Precision 150/152 = 98.7 %**, reported rather than tuned away.
- **0 sites found only by the scanner.**

Then: hand-verified a spread of **10** violating sites (`team_assignment_orchestrator.rs:538`,
`pipeline_executor.rs:961`, `background_job.rs:437`, `night_shift/mod.rs:601`,
`approval_exec_night.rs:49`, `competitions.rs:399`, `kpi_compose.rs:299`, `task_executor.rs:569`,
`nl_query.rs:85`, `template_adopt.rs:1356`) — **10/10 true positives.** Site-level overlap against
15 neighbours: **0**. Runtime: **1.6 s** over 963 files, no backtracking (the bounded lazy quantifier
sits behind a negative lookahead on `[;{]`, so it cannot cross a statement boundary).

Validated in a composer-private scratch registry `census-mso-7f3c21.json` — a filename unique to this
composition, because sibling composers share the scratchpad and have overwritten each other's files —
then **re-extracted from this finished document and re-run**; identical:

```
  rule                                              files  base  matches  base  walked  floor
  OK  untyped-lifecycle-transition                     26    26      152   152     963    900
  OK  untyped-lifecycle-transition-positive-control    24     —       72     —     963    900

  census OK — 2 rule(s), 1926 file-visits, 224 surviving violation(s) across 50 file(s).  exit 0
```

`963 walked` is exactly `rust.files` in [`shared-facts.json`](../shared-facts.json) — an
independently derived count agreeing, which is the only reason to trust the walk. **The full registry
was NOT run**, per the doctrine; the orchestrator runs it on merge.

**The distribution is the argument for the rule.** The most violating file is
`src/engine/team_assignment_orchestrator.rs` at **21 sites** — the best multi-step engine in the
repo, the one this document tells everyone to copy. The gate does not point at bad engineering. It
points at the one thing careful engineering got wrong, and it is the thing that killed a whole
feature.

### What the census cannot gate here, and the instrument that can

Conditions (B) and (C) are properties of a **store** and of a **cross-language pair**, not of source
text. The census ratchets a count of something present; it cannot say "these two sets are equal" or
"no parent is terminal while a child is not".

**`scripts/check-job-invariants.mjs`** — a dev-time probe over **read-only copies** of the local
databases, ~180 lines, `node:sqlite`, no dependency:

1. **Its own fail-loud precondition first.** Exit **2** if a database is absent, if the CHECK-
   allowlist inventory resolves to **fewer than 10** tables (today: 23), if the ts-rs binding
   inventory resolves to **zero** lifecycle enums, or if **zero** parent/child job pairs are
   discovered. Print the inventory sizes on success, so a green log distinguishes "clean" from
   "checked nothing". These are the four ways this check could silently become the thing it watches.
2. **(B) — allowlist vs code.** Extract every `CHECK(status|phase|state IN (…))` from the live
   schema (today 23 tables). For each, take the states the code writes through that table's own
   transition door and report any literal outside the allowlist. **Today it prints exactly one line:
   `team_assignments: "paused" <- src/engine/team_assignment_orchestrator.rs:538`.** Run in the
   other direction too, and report allowlist values no code path ever writes — a state nobody can
   reach is a dead branch in every consumer that switches on it.
3. **(B′) — allowlist vs the ts-rs enum.** For each table with both a CHECK and a generated
   `*Status`/`*Phase` binding, assert the two sets are equal. Today `TeamAssignmentStatus` ≡ the
   CHECK (6/6) and `TeamAssignmentStepStatus` ≡ the CHECK (7/7); if D2 is fixed by migration and not
   by enum, this line goes red the same day.
4. **(C) — the terminal-parent invariant.** For every discovered parent/child job pair, count
   parents in a terminal state holding a non-terminal child. Today: `team_assignments` → `steps`
   **0/372**; `team_deliberations` → `deliberation_agenda` **34/118 (56 items)**; `dev_goals` →
   `dev_goal_items` **2/168**. **This is the single most valuable line the script would print and no
   source-level gate can produce it.**
5. **Attempt accounting.** For each step-like table, compare `SUM(retry_count)` against the number of
   child executions actually stamped with that step's id. Today: **326 extra attempts, 177
   counted, 149 (45.7 %) invisible.**
6. **Declared-but-unwritten job stores.** Report every table matching the job/step shape with **0
   rows, ever**, and cross-reference the writers the source declares. Today: **22 of 36**, including
   three explanation tables for engines that demonstrably ran.
7. **Report; fail only on its own preconditions, on a NEW literal outside an allowlist, and on a
   NEW terminal-parent violation in a pair that previously had zero.** A developer's machine
   legitimately has few rows and old data; a ratio is not a build error. What *is* a build error is
   a state the store will reject and an invariant that has just started breaking.

Running it today would print, in under two seconds: one unwritable status that disables a feature,
34 deliberations that ended with 56 open items, 149 uncounted retries, and 22 job stores that have
never held a row — which is most of §7, produced by the one thing nobody had built.

### Where it would run

Not `ci.yml` — there is no `personas.db` on a CI runner, and per the §9 calibration `ci.yml` is red
on 10 pre-existing failures, so a gate that runs only there runs nowhere. This is a local
`npm run check:jobs`, run by a developer touching a job engine. **Its (B′) half — the CHECK-vs-enum
comparison — is the exception and CAN run in CI**, because the schema DDL and the generated bindings
are both in the tree; that half needs no database at all and should be wired to the existing
binding-drift job.

### On severity, if any of this ships as a lint rule

Nothing here is proposed as an ESLint rule, so the question does not arise — and it must not be
argued from warning volume in either direction. `npm run check` runs `eslint src/` with **no
`--max-warnings`**, and the pre-commit hook runs `--quiet --max-warnings 99999`, where `--quiet`
discards warnings before they can be counted. **A warn-level rule enforces nothing at either gate, at
any count, by construction.** The census rule above fails a run; the proposed script exits non-zero.

## 12 Corrections to the brief

1. **The primed lead about `apply_persona_memory_review_proposal` is CONFIRMED, and the population
   question it asked has an answer: the door is an outlier, but not the one the brief expected.**
   The CAS-flip to `applied` before the loop is exactly as described (`memories.rs:901` then `:920`),
   and its comment is honest about buying at-most-once and silent about the price. Measuring the
   population rather than assuming: a brace-matched scan of **10,080** function bodies in 963 files
   found **510** multi-effect loops, of which **10** write a status before the loop. Opening all 10:

   | door | pre-loop write | verdict |
   | --- | --- | --- |
   | `apply_persona_memory_review_proposal` (`memories.rs:875`) | `applied` — **TERMINAL** | **the outlier** |
   | `execute_night_shift_execute_plan` (`approval_exec_night.rs:17`) | `approved` — a human-consent gate, then `running` at `:113` | half-right: the flip is not terminal, but `if plan.status != "proposed"` (`:32`) makes a partially-dispatched plan **unre-approvable**, and 3 of 5 spawns can be lost with 2 audit rows written |
   | `run_consolidation` (`consolidation.rs:146`) | `running` — **in progress**, and the batch + the terminal flip share one transaction | **the exemplar** |
   | `run_breeding_pipeline` (`genome.rs:162`) | `Running` — in progress, **typed** | correct |
   | `dev_tools_start_auto_run` (`task_executor.rs:1472`) | `running` — in progress | correct |
   | `twin_studio_generate_answers` (`twin.rs:1510`) | `running` — in progress | correct |
   | `start_query_debug` / `run_query_debug` (`query_debug.rs:194,:281`) | `running` — in progress | correct |
   | `tick_loop` / `run_step` (`team_assignment_orchestrator.rs:547,:791`) | `running` / `matching` — in progress | correct |

   **So: 1 of 10 flips to a terminal status before its effects, and 9 flip to an in-progress one.**
   The brief said "one composer checked 6 doors and found that one is the outlier"; over the full
   population of 10 the ratio is sharper, not softer — and the *shape* the outlier is missing turns
   out to be present, transactionally, 300 lines away in `run_consolidation`. **The convergence
   sweep then made this a house defect: 0 of 5 siblings flips terminal-before-effects.**

2. **`sides: "server"` is right; `twoSided: true` is right; but the spine declares NO `clientHalf`
   and `fusedAcrossSides: false`, and the client half is where the deadest code is.** Unlike
   [execution-trace-instrumentation](./execution-trace-instrumentation.md)'s leaf, this node carries
   no `clientHalf`/`serverHalf` text at all — only `dimensions: [… "ui" …]`. Tested: the client half
   is small (an api module, a store slice, three surfaces) and **entirely correct as written** — and
   two of its buttons call a command that cannot succeed (D2). A composer who took `sides=server`
   literally would have found the CHECK-constraint rejection and reported it as a backend bug worth
   a paragraph, rather than as a feature with a UI, an IPC surface, a store action and a Rust
   branch, all dead. **The `sides` ledger gains a second `"server"` upholding — with the correction
   that the *consequence* was on the client.**

3. **The primed handoff lead is CONFIRMED and the number is better than the brief's.** The brief
   said *"51 names, a consumer 94 % of the time against 13 % for hand-typed ones."* Measured live at
   the trigger level: **55 chain triggers, 55 of them carrying a derived `team_handoff.<target>`
   name, 55 of 55 paired with a receiver on the same persona — 100 %.** And the contrast has no
   denominator left to compute: **there are 0 hand-typed chain event names in the whole
   `persona_triggers` table.** 729 `persona_events` rows carry a derived handoff type, so the
   mechanism is not merely wired but exercised. *(The brief's 51/94 % almost certainly counted a
   different population — subscriptions as well as triggers — and I did not attempt to reproduce it;
   the trigger-level figure is what this leaf's mechanism owns.)* **D8 records the latent hazard the
   100 % hides: the wiring pass would report a half-wired edge as wired.**

4. **The watermark lead is REFUTED in its specifics and REPLACED by a stronger result.** The brief
   said *"one advances from the clock after an LLM call (a permanent skip sized by model latency);
   four of six advance from observed data."* Enumerating the population: **8 persisted
   advance-past-what-I-processed mechanisms, not 6** — `companion_exec_review_cursor`,
   `companion_msg_triage_cursor`, `cloud_sync_cursor:<table>`, `cloud_sync_cursor:tombstones`,
   `team_slack_bridge_cursor:*` (2 streams), `cloud_webhook_watermarks.last_seen_ts`,
   `notification_dispatch_watermark.last_event_at`, `shared_event_subscriptions.last_cursor` — plus
   one in-process (`cdc.rs:296`'s `max_persona_event_rowid`).

   **Seven of the eight advance from observed data**, several of them exemplary:
   `execution_review.rs:749-752` holds the cursor until triage *succeeds* with a bounded retry;
   `webhook_notifier.rs:716-728` advances to the tuple max `(created_at, id)` strictly *before* the
   earliest failed delivery; `cloud_webhook_relay.rs:426` upserts the watermark and publishes the
   event **in one transaction**; `shared_event_relay.rs:167-170` advances only through the leading
   contiguous run of handled firings; `team_slack_relay.rs:440-448` breaks at the first failure and
   holds.

   **I found no watermark that advances from the clock after an LLM call.** The one clock-derived
   advance is `cloud/sync/mod.rs:393` (`process_tombstones` → `tick_start`), and **the clock is
   captured BEFORE the read** (`:374`), which is the *safe* direction: it can re-deliver, never
   skip, and deletes are idempotent. The direction of the capture is the whole discriminator and the
   brief's framing did not have it. Better still, `cloud/sync/rows.rs:478-491` records that this
   codebase **already learned the lesson and wrote it down** — the table cursor *used to* be `now()`
   and was changed to the observed max, with the failure mode spelled out in the comment.

   The genuine permanent skips exist and are **not** clock-shaped: `message_triage.rs:319-321`
   advances past an undecidable batch by design (*"the messages simply stay unread — the safe
   failure mode"*), and `execution_review.rs:619-627` advances after `MAX_TRIAGE_ATTEMPTS`. Both are
   observed-data advances over unprocessed work, both are documented, and neither is sized by model
   latency.

   **And the convergence sweep reframes the whole question (§6 clause 9): no sibling has a
   permanent-skip watermark, because no sibling selects work by a time RANGE.** All three
   independents select by row *state*. The clock values they hold are visibility and backoff timers,
   where before-vs-after cannot lose anything. **The strongest answer to "is our watermark safe?" is
   "why is your worklist a time range?"**

5. **My own two implementations disagreed, and the disagreement was worth more than the agreement.**
   131/67 vs 152/72. Twenty-one differing sites: **19 real** (all `pipeline_executor.rs`, whose call
   shape puts the literal `"status"` before the state name, so my scanner's first-literal rule
   bucketed the repo's second DAG walker as "neither"), **2 false** (`healing.rs:1018,:1030`, inside
   a `#[cfg(test)]` module the engine cannot strip). This is the doctrine's *"a vocabulary-based
   signal's recall is bounded by its author's word list, and the misses cluster on the unusual
   cases"* — and the unusual case here was the densest file in the population.

6. **"`chain_trace_id` has never grouped two executions" — CONFIRMED independently, and this leaf
   supplies the consequence.** 3 distinct values, 3 rows, **0 groups of size > 1** in 2,942 traces.
   [execution-trace-instrumentation](./execution-trace-instrumentation.md) D10 counted the cost as
   dead apparatus. The cost is larger: **that id is the gate on `chain_stop_reasons`**
   (`chain.rs:246`), so the chain's only explanation table holds 0 rows against **727** firings
   (`persona_events` with `source_type='chain'`). A dead correlation id did not merely waste a
   column; it silenced an audit.

7. **"The trace lives in a `Mutex<SpanStore>` until `finalize()`" — confirmed as the shape, and this
   leaf is the counter-example that proves the prescription.** The trace is the case where the record
   is assembled in memory and written once; the assignment engine is the case where **every**
   transition is written when it happens, in a transaction with its ledger event. The two live in
   the same process. **The difference is not effort or care — it is that one of them made the
   durable record the program counter and therefore could not defer it.** That is the argument for
   P1 and it is measured rather than asserted: 0 % trace coverage for reaped runs, against a step
   ledger that reconstructed a 10-hour 9-round failure completely.

8. **How far the reconstruction got, stated plainly, because the brief asked.** *All the way, and
   further than expected.* Assignment `a1a399f6`: every step, every dependency edge, every one of 9
   resume rounds, every cascade-skip and restore, every failure string, every transition timestamp,
   and the human-visible diagnosis — rebuilt from three tables with **no gaps**. **Where it broke:**
   (i) which execution each of the 9 attempts used — 8 of 9 are unrecoverable from the step
   (D5); (ii) how long any individual attempt took — the step's own timestamps span all nine
   (9h57m for a 2.3 s attempt); (iii) how many attempts there were — `retry_count` says 8 and the
   execution stamps say 9, and corpus-wide the counter misses 45.7 %; (iv) why it stopped — the
   `awaiting_review` state carries no distinction between "a human is looking at this" and "this was
   abandoned 68 days ago"; (v) what the step actually produced — `output_summary` is NULL, because
   it is only written on `done`. **So: the shape of what happened, completely. The order of what
   happened, completely. The attempts inside it, partially. Why it stopped, not at all.**

9. **What a crash at each boundary leaves, since the brief asked for it explicitly.** Measured
   against the assignment engine, boundary by boundary:

   | crash point | what is left | recoverable? |
   | --- | --- | --- |
   | between `create` and the first tick | assignment `queued`, steps `pending` | **yes** — `list_active` includes `queued`; boot respawns the driver |
   | inside `run_step` after `update_step_status("matching")` | step `matching`, no execution | **yes** — orphan recovery re-queues `matching`/`running` with a note |
   | after `exec_repo::create` but before `set_step_execution` | step `matching`, an orphan `persona_executions` row nothing points at | **partially** — the step re-runs; the orphan execution is invisible to the step and to the retry counter |
   | after `set_step_execution`, before `update_step_status("running")` | step `matching`, `execution_id` set | **yes**, and the next attempt overwrites the pointer (D5) |
   | mid-`start_execution` | step `running`, execution `queued`/`running` | **yes** — the step is re-queued; the execution is reaped separately by the zombie sweep |
   | between the terminal `update_step_status` and the parent's flip | step terminal, parent `running` | **yes** — the next tick recomputes the parent from the steps. **This is the boundary the design makes free**, and it is why the invariant is 0/372 |
   | between `update_assignment_status("done")` and the goal-progress close-loop (`:663-688`) | assignment `done`, goal item unticked | **no** — best-effort, never retried, no record |
   | between the terminal flip and `spawn_on_terminal` (`:693`) | assignment terminal, no learning record | **no** — and `assignment_outcomes` holds **0 rows** for 372 terminal assignments |
   | inside `wire_team_handoff` between the emitter and the receiver create | an emitter with no receiver, reported as `edges_wired` | **yes**, but only if someone re-runs `repair_team_handoff` (D8) |
   | inside `apply_persona_memory_review_proposal`'s entry loop | proposal `applied`, k of N entries applied, no record of k, CAS refuses the retry | **no** — D2's shape and the leaf's namesake defect |
   | inside `execute_night_shift_execute_plan`'s dispatch loop | plan `approved`, k of N sessions spawned, k audit rows, and `if plan.status != "proposed"` blocks re-approval | **partially** — the audit rows say which spawned; nothing acts on them |
   | inside `run_consolidation`'s item loop | parent `running`, **zero** items | **yes** — one transaction; there is no partial state to be in |
