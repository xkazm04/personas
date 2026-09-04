---
subject: software-engineering/concurrency-guards
project: personas
raised_by: intake intake-kube-0903 (peer comparison)
source: librarian/sources/2026-09-03-kube-rs.md
stage: the admission gate — QueueTracker::admit in src-tauri/engine/src/queue.rs and its one caller in src-tauri/src/engine/execution.rs
size: 3 files / ~120 lines / S
status: accepted
---

## Why the scope implies it

`scope.does` fixes the product at *"one operator per install"*, and that is exactly the condition under which a duplicate run is invisible. There is no second person to notice that a persona ran twice for the same trigger; the run appears in the activity board as two tiles, produces two sets of tool calls against the same external systems, and lands on the provider bill as two charges. `scope.does` also names *"observe runs — cost, health, traces"*, which is the surface where the duplication shows up as noise rather than as a fault.

The admission gate personas already has is a good one, and better than the peer's on two axes. It refuses **by class**, with displacement, and the reasoning is written out where the decision is made: *"Depth alone cannot decide this: a queue that carries priority levels but consults them only when choosing an insertion point has a refuse-newest shed policy regardless of what the levels say, because the gate that refuses never sees the class. Reject-by-class needs the class evaluated BEFORE the depth verdict, and it needs a displacement rule -- the comparison alone is the easy half"* (`src-tauri\engine\src\queue.rs:294-302`). It also holds admission on a quota the work would immediately violate, so *"the work WAITS rather than running straight into the limit and failing"* (`:266-286`). `kube-runtime`'s scheduler has neither — it never refuses, and overload manifests only as latency.

What it does not have is any notion of two admissions meaning the same thing. `admit` takes `(persona_id, execution_id, max_concurrent, priority)` (`:261-266`) and inserts by priority without consulting the queue for an equal entry. The only dedup is incidental: `running` is a `HashSet<String>` of execution ids per persona (`:231-241`), so one *id* cannot be registered twice — which is a tautology, since ids are minted fresh. Two executions of the same persona from the same trigger are two ids, two slots, and two CLI processes whenever `persona.max_concurrent > 1`.

The peer's whole scheduler is built on the opposite premise, and states the guarantee it buys: a message whose equal is currently executing is parked in a `pending` set rather than run (`C:/t/kube/kube-runtime/src/scheduler.rs:114-139`; `kube-runtime/src/controller/runner.rs:20-25`), and the builder's doc says *"despite concurrency, a controller never schedules concurrent reconciles on the same object"* (`kube-runtime/src/controller/mod.rs:605-617`). That guarantee is what lets a reconciler be written without a lock — nobody has to remember to take one, because the queue took it. The two limits are deliberately independent: per-key exclusion and a global cap answer different questions and are configured separately.

personas has the same shape and has drawn the axis one notch off. `has_capacity(persona_id, max_concurrent)` (`queue.rs:222-229`) is a **resource** limit — a persona that spawns two CLI processes at once costs twice the memory and twice the tokens — and it is right for that. It is not an exclusion, and nothing anywhere else provides one.

The key this needs already exists and already travels with the work; it simply does not cross the admission boundary. `PersonaExecution` carries `trigger_id: Option<String>` (`src-tauri\core\src\models\execution.rs:16`), and the caller has the whole persona and the priority in hand at the admission call (`src-tauri\src\engine\execution.rs:690-693`) — it passes four of the five things it knows.

## What the first context contains

A **conflict key on admission**, and the two places the tracker must consult it. One optional parameter, one set, no new module.

**The key.** `admit` takes a fifth argument, `key: Option<&str>`, formed by the caller as `persona_id + trigger_id` when a trigger fired the run, and `None` when a person pressed run. The `None` case is the load-bearing half of the design: `scope.does` says the operator runs personas, and a person who presses run twice may genuinely mean it. Only machine-originated work — a schedule, a webhook, a chain hop, a healing retry — is deduplicated, because only machine-originated work can fire twice for one cause without anyone deciding to.

**Consumer one — a third `AdmitResult`.** `AdmitResult` gains `AlreadyAdmitted { execution_id }` beside `Running`, `Queued` and `QueueFull` (`queue.rs:52-60`), returned when the key matches an entry that is running or queued. It names the existing execution rather than returning a bare refusal, so the caller can attach the new trigger's provenance to the run that is already going rather than dropping the event — the same distinction `Queued { position, displaced }` already makes between "refused" and "refused, and here is what moved".

**Consumer two — the two sets.** `QueueTracker` gains `running_keys: HashMap<String, String>` (key → execution id) maintained by `add_running` / `remove_running` (`:231-241`, `:343-352`), and the queued side is answered by scanning the persona's own `VecDeque`, which is depth-capped at 10 (`:7`) so the scan is bounded by construction. The key is cleared on exactly the two paths that already clear the running set, so there is no third lifetime to reason about.

**Consumer three — the drain.** `drain_next` and `drain_next_global` (`:372`, `:423`) already re-check quota, resource pressure and per-persona capacity before promoting; the key check joins that list. It has to be there and not only at `admit`, because two entries can be queued before either runs — `admit` sees the second one, but a displacement (`:303-315`) can reorder them, and the promotion is the last honest moment.

**What it must NOT absorb.** Not `has_capacity` or `GLOBAL_MAX_CONCURRENT` — those are resource limits, they stay exactly as they are with their own numbers, and collapsing them into the key would silently serialize a persona the operator deliberately configured for parallelism. Not the shed policy: an `AlreadyAdmitted` is not a `QueueFull` and must not consume the displacement rule, because displacing an entry to make room for its own duplicate is the worst possible outcome. Not the quota cooldown, which is a different gate answering a different question and already works. Not the durable side: `restart_recovery.rs`'s re-admission of `queued` rows (`db/src/repos/execution/restart_recovery.rs:26-33`) is the boot path and stays exactly as it is — a resumed row's key is recomputed on admission like any other, which is correct and needs no special case. Not the trigger layer, which keeps firing whatever it fires; the gate is the queue's, not the trigger's.

## The measurable

**Concurrent runs for one (persona, trigger): today up to `max_concurrent`, target 1.**

Measured by a case beside the existing tracker tests (`engine/src/queue.rs:639-720` is the harness and the style). Admit two executions with the same `persona_id` and the same trigger key, with `max_concurrent = 2` and global capacity free. Today: two `AdmitResult::Running`, two ids in `running_ids`. After: one `Running`, one `AlreadyAdmitted` naming the first.

**The paired assertion, which is what stops this becoming the per-persona limit in disguise:** two executions of one persona from *different* trigger keys must both reach `Running` at `max_concurrent = 2`, and two executions with `key: None` — the operator pressing run twice — must both reach `Running`. If either fails, the gate has widened from exclusion into serialization, and it has taken away parallelism the operator asked for.

**Second number, for the operator.** Duplicate executions observed in the live database: rows in `persona_executions` sharing `(persona_id, trigger_id)` whose `started_at`/`completed_at` windows overlap, over the retained history. This is the base rate, it is one query, and **it should be run before the proposal is accepted** — see the falsifier below.

**Third number, for cost.** `cost_usd` summed over the overlapping rows found by the second number. `scope.does` names cost observation; if duplicates exist, this is what they cost, and it is the number that decides whether the direction is worth the third `AdmitResult` variant.

## What would make this wrong

**If the overlap has never happened.** This machinery prevents a class of waste, not a class of corruption: nothing is written twice that cannot be written twice, and a duplicated persona run mostly produces a duplicated conversation. If the second number returns zero overlapping `(persona_id, trigger_id)` pairs across the retained history, the gate is guarding a case that does not occur, and the honest verdict is `deferred` with "one overlapping pair observed" as the return condition. This is the check to run first; everything else in the proposal is cheap enough that the base rate is the only real question.

**If `trigger_id` is not the conflict key.** The design assumes a trigger is the unit that can fire twice for one cause. If in practice one trigger legitimately fires per *event* — a webhook trigger receiving three distinct payloads in a second, each of which should run — then the key is `(persona_id, trigger_id, event_identity)` and the event identity may not exist as a field. If it does not, the key would collapse three legitimate runs into one, which is a data-loss failure and much worse than the duplication it prevents. The failure direction is asymmetric and this is the bad side, so the first implementation must confirm that every trigger kind either has an event identity or fires at most once per cause; if any kind has neither, that kind passes `None` and stays outside the gate.

**If `AlreadyAdmitted` is treated as an error at the call site.** The caller currently matches three `AdmitResult` arms and spawns or reports (`src/engine/execution.rs:695-710`). A fourth arm folded into the error path would surface a normal, correct deduplication to the operator as a failed run — the exact defect the hook surface's own rule warns about, that *"veto-by-error makes a denial and a contributor bug indistinguishable at every consumer downstream"* (`src/engine/runner/hooks/mod.rs:18-24`). `AlreadyAdmitted` is a successful outcome and must reach the activity surface as one.

**If the key's lifetime drifts from the running set's.** `running_keys` has to be cleared on exactly the paths that clear `running`, and one of those paths is a task that can panic. If a key can outlive its execution, the persona's trigger is wedged silently and forever — the same shape as the peer-comparison study's §4.6 finding about pumper's overlap guard, which stayed true after a retried job and stopped a schedule firing while health reported `ok`. The mitigation is that both sets are mutated only in `add_running` / `remove_running`, which is why the key must live in the tracker and not beside it; if the implementation puts it anywhere else, the review should stop there.
