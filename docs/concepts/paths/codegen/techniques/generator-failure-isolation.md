---
layer: technique
subject: codegen
technique: generator-failure-isolation
status: forged
laws: [failure-not-empty-success, count-carries-predicate, creation-names-reaper]
shared_with: []
---

# Generator failure isolation

A pipeline of independent generators inherits none of their individual
robustness automatically. Composition adds failure modes that no single
task has, and each one converts a local defect into a global lie: a hang
that holds every task's output hostage, an abort that hides four failures
behind the first, a swallowed non-zero exit that turns today's crash into
next month's stale artifact. This technique is the runner's failure
contract.

## Every task gets a budget, and the budget is enforced

Each registry entry carries a time budget (see
[task-registry-design](task-registry-design.md)); the runner enforces it by
terminating the task's process tree when it expires. Three details make
the enforcement honest:

- **Termination is complete.** A generator that spawned children must have
  its whole tree reaped, or the "timed out" task keeps writing into its
  output root after the runner has reported on it — the runner created the
  process, the runner is its reaper
  ([creation-names-reaper](../../_laws.md#creation-names-reaper)).
- **A timeout is attributed, not aggregated.** The report names the task
  and the budget it blew. "The pipeline timed out" is a bisection exercise;
  "the catalog task exceeded its budget" is a fix instruction.
- **The budget is overridable per invocation, not silently raised.** Slow
  environments (cold caches, constrained runners) are real; the escape
  hatch is an explicit knob, so the default stays honest for the common
  machine instead of creeping upward to cover the worst one.

## Fan out in parallel; collect everything; judge once

Independent tasks run concurrently — that is the speed that keeps ambient
triggering viable (per [trigger-wiring](trigger-wiring.md)) — but the
scheduling discipline that matters is at the *end*, not the start:

- **No fail-fast abort of siblings.** Killing the batch on the first
  failure means each run reveals exactly one problem, and a five-defect
  morning costs five full runs. Let every task finish (or fail) and report
  the complete surface at once.
- **No continue-and-forget either.** The opposite sin is collecting
  failures and then not letting them affect the outcome. The pipeline's
  exit status is the disjunction of task outcomes: one failed task, failed
  run. A wrapper that always exits clean is not tolerant — it is
  converting every generator failure into unbounded future staleness, in a
  place where nothing else will ever look.

## The four outcomes are four different words

Each task ends in exactly one of: **succeeded** (ran, wrote or verified
output), **failed** (non-zero exit, crash, or budget exceeded), **skipped**
(a declared precondition made the task inapplicable), or — the one most
runners get wrong — **produced nothing** (ran, exited zero, touched zero
outputs). The last is a distinct state because for a *generator*, zero
output is almost never success: it is the mis-scoped invocation, the empty
target set, the wrong flag — the instrument failing while reporting
politely
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
The runner should require each task to account for its outputs (a count,
or a verified-fresh assertion) and treat unexplained zero as failure. And
a **skip must print as a skip**: a skipped task rendered as a pass makes
"the pipeline is green" mean less than everyone believes it means, which
is the deepest kind of gate rot — the downstream consequences for checks
that ride on the runner are drawn out in [drift-gating](drift-gating.md).

## An interrupted generator must not leave less than it found

Budgets and door policies handle the runner's view of failure; this section
is about what the *killed task* leaves behind, because a generator holding
committed artifacts can fail in a way no exit code reports: by destroying
its own output mid-write. Two write patterns create the window:

- **Truncate-on-open.** The default file-write primitive in most runtimes
  opens the destination and truncates it before the first byte lands, so an
  interrupt at any point leaves a zero-byte committed file — a state the
  file's own do-not-edit header cannot warn about, because the header was
  the first thing truncated.
- **Delete-then-repopulate.** A generator that clears its output directory
  before rewriting it opens a window in which the artifacts *do not exist*
  — and measured on a real many-file split, that window was reachable a
  fraction of a second into the run, with the entire committed set gone. It
  also quietly kills any "skip if unchanged" guard downstream in the same
  run, since nothing exists to compare against. Deleting first is not a
  stronger form of overwriting; it is a different operation with a failure
  mode overwriting does not have.

And interruption is not rare. The runner's own budget enforcement kills
tasks by design; a developer cancelling a session is a keystroke; the
ambient trigger (per [trigger-wiring](trigger-wiring.md)) puts generators in
the path of every impatient restart. The discipline: **build the entire
output in memory, then replace the destination atomically** — write to a
temporary path and rename into place; for multi-file outputs, stage the
whole set and swap the directory. After that, every observable state is
either the old complete output or the new complete output, and the
interrupted state is unrepresentable.

## The summary is a count with its predicate

The end-of-run report names every task with its outcome and duration: how
many ran, how many were skipped and why, how many failed and with what.
Not "done in twelve seconds" — that number without its predicate will be
read as "everything is fine" no matter what it actually covered
([count-carries-predicate](../../_laws.md#count-carries-predicate)). The
summary is also where partial failure gets its loudness: failures sort to
the bottom, adjacent to the exit, so the last thing on screen is the thing
that needs action — never scrolled off by a wall of successes.

## Door policy: block or warn-past is a decision, not a default

When the pipeline runs ambiently in front of a developer's session, a task
failure poses a genuine policy question: hold the door shut (safe, and
infuriating when the broken generator is unrelated to today's work) or
warn and proceed (convenient, and the warning will eventually be ignored).
There is no universally right answer; there is a universally wrong one —
inheriting whichever behavior the runner happened to ship with. Decide per
entry point: build doors block, because a build assembles the artifacts
for shipping; interactive doors may warn-past, but the warning must be
unmissable and the failure must still land somewhere durable, or
warn-past decays into silent-past within a quarter.
