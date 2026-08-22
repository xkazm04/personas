---
layer: application
subject: admission-queue
technique: admission-vocabulary
stack: rust
---

# The admission vocabulary in the Personas execution engine

The persona-execution lane implements the technique's core almost verbatim
— a closed verdict enum, composed gates emitting one result, a caller
contract per arm — and then demonstrates the technique's two failure shapes
at its own edges: the refusal's *type* contradicts its English at the IPC
boundary, and seven sibling admission lanes in the same binary each speak
their own vocabulary.

## The closed verdict, and the composition behind it

`AdmitResult` (`src-tauri/engine/src/queue.rs:56-63`) is the three-way
verdict exactly as the technique prescribes:

- `Running` — admitted; the tracker has already registered the execution
  (`add_running` inside `admit`, `:269-271` — check-and-take is one
  operation under the caller's lock, no legal state between).
- `Queued { position }` — the payload is the position, 0-indexed, computed
  from the priority-ordered insertion point (`:302-308`).
- `QueueFull { max_depth }` — refusal carries the bound that produced it.

`admit` (`:253-309`) composes **four** independent gates — per-persona
capacity, global capacity, provider-quota cooldown, host resource pressure
— and all four report into this one vocabulary: capacity shortfalls queue,
and a healthy-capacity-but-gated arrival *also* queues rather than running
into a known limit, with a debug log naming which gate held
(`quota_held` / `resource_held`, `:273-281`). The quota gate has the
never-shortens discipline (`set_quota_cooldown` keeps the later deadline,
`:174-179`) so a burst of limit-failures cannot prematurely lift the pause.

## The caller contract per arm

The single call site (`src-tauri/src/engine/mod.rs:886`) branches three
ways, each arm doing what the technique's table says the caller owes:

- `Running` (`:890`) — spawns the execution task; the wait is over, the
  execution clock starts.
- `Queued` (`:904`) — emits a `QueueStatusEvent` with position, depth, and
  global occupancy to the frontend (`:918-926`), plus a process-activity
  event so the run shows as *queued*, not silently absent. Waiting is
  visible, with "behind what" attached.
- `QueueFull` (`:951`) — warns with the persona and depth, **counts the
  refusal** (`record_queue_rejection`, `:958` — the verdict-counter the
  technique demands), emits a `queue-backpressure` event with the bound
  (`:959-968`), and returns an error to the requester.

The durable record spells the verdict's vocabulary: a queued execution is
persisted with `status='queued'` — which is what lets
`requeue_persisted_executions` (`mod.rs:748`) treat the rows as the durable
queue after a restart and re-admit them **through the normal gate**, while
a row whose persona vanished is failed with an explicit reason. Verdict
first, record second, record honest.

## Deviation 1: the refusal's type contradicts its sentence

The `QueueFull` arm returns
`AppError::Validation("… queue is full … Try again later.")`
(`mod.rs:969-972`). The prose is an instruction to retry; the type is the
app's own taxonomy for *the caller made a mistake* — classified
`retryable = false` and `failover_eligible: false` everywhere the envelope
is read. Nothing downstream reads English. This is the technique's
"refusal is a result, not an exception" rule failing at the last hop: the
verdict was a perfect classification for one function call, then collapsed
into the wrong error family at the process boundary. The legacy corpus
audit measured the same inversion at six more capacity doors in this
binary, and registered the type-level fix (a retry-after-carrying refusal
variant) as a deferred fix.

## Deviation 2: one vocabulary, one subscriber

`AdmitResult` has exactly **one call site**. The same binary admits work
through at least seven other doors — background-job mutual exclusion
returning `Result<(), AppError>` (where `Err` also means a poisoned lock),
raw semaphore permits with no verdict at all
(`LAB_CELL_CONCURRENCY`, `src-tauri/engine/src/test_runner/:37`,
`:1613` — admission by waiting, refusal inexpressible), a rate limiter
returning `Result<(), u64>`, boolean healing-session gates, and
backlog-producer caps refusing via validation errors. Each lane re-invents
a private spelling of admitted/queued/refused, most of them lossy — the
per-gate-vocabularies failure shape, live. The strongest admission type in
the tree governs one lane; no other lane can express the three outcomes it
names.

## The counter-example: record before verdict

`src-tauri/src/commands/infrastructure/task_executor.rs:551-568` writes the
task's durable `running` marker, *then* asks its admission door; a refusal
returns through `?` and leaves the row `running` with a start timestamp and
a null completion — forever. The live-database audit found rows stranded
this way for 129 days. This is the precedes-the-record rule inverted, and
it is why the rule is stated as sequencing, not as style: the two lines
cost the same in either order, and only one order can strand a record.
