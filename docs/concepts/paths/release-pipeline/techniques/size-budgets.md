---
layer: technique
subject: release-pipeline
technique: size-budgets
status: forged
laws: [count-carries-predicate, derivation-names-recomputation, deletion-is-not-repair]
shared_with: []
---

# Size budgets

Artifact size is the dimension that regresses by default. Every dependency
added, every asset committed, every feature flag left compiled in moves it
one direction, no test fails, and no reviewer sees a number. Unmeasured,
size is discovered by users — as download time, disk cost, and update
payload — long after the hundred small causes have blended into an
unattributable total. The technique is to make size a **measured, budgeted,
ratcheted** dimension: measured on every change, budgeted with hard
ceilings, ratcheted so wins persist.

## The baseline is committed, and deltas are the signal

The core artifact is a **committed baseline**: a small versioned file
recording what each tracked artifact weighed at last acceptance. Committing
it — rather than fetching "the last build's size" from the automation
host — buys three properties: the comparison point is deterministic and
survives history rewrites and host migrations; changing it requires a
reviewable edit that appears in the diff next to whatever caused it; and
the measurement tool can run anywhere, including a contributor's machine
before a change is even proposed.

Against the baseline, every proposed change gets a **delta report** where
its author and reviewers already look — the absolute size matters
quarterly, but the delta is what a review can act on. "+2.1MB" on a
one-line change is a conversation; the same amount spread over a quarter
of unmeasured changes is a fact of life. The report follows the
counted-number law
([count-carries-predicate](../../_laws.md#count-carries-predicate)): every
figure names *which artifact, which target, compressed or not, measured
how* — a bare number will be compared against a figure measured under
different rules, and the comparison will be believed.

## Fail versus advise — both, with distinct thresholds

A single threshold forces a bad choice: strict enough to matter, it blocks
legitimate growth and teaches people to bump it reflexively (a gate whose
routine response is raising it is advisory with extra steps); loose enough
to never annoy, it catches nothing. Use two layers:

- **The budget (fail).** A per-artifact ceiling that fails the pipeline.
  Set it from a real constraint — what download size costs acquisition,
  what the update payload may weigh on a metered connection — with
  deliberate headroom. Raising it is a decision with an owner and a
  written reason, not a reflex in the failing change.
- **The delta (advise).** Any change moving an artifact more than a noise
  floor gets a visible report, and an unusually large delta may require
  an acknowledgment — but advisory findings do not block. Their job is to
  make the author *see* the number while the cause is one diff old.

## The ratchet: wins are captured, not enjoyed

Budgets alone have a one-way failure: when someone lands a real reduction,
the distance to the ceiling becomes invisible headroom, and the next
quarter of small regressions consumes the entire win without any gate
noticing. The ratchet closes this: **when measured size drops below the
baseline by more than noise, the baseline comes down to meet it** — by an
update in the same change or a routine that proposes it. Size can then
drift upward only through visible, acknowledged deltas; every reduction
becomes the new floor. (The baseline is a stored derived value; the tool
that regenerates it from a build must be named in it, or the first
discrepancy between baseline and reality has no arbiter —
[derivation-names-recomputation](../../_laws.md#derivation-names-recomputation).)

## Per-target budgets, and measuring the right object

One global number hides regressions two ways: across *artifacts* (the
installer grew while the update payload shrank) and across *targets* (one
platform's toolchain links a library another strips). Budgets and baselines
are therefore keyed per artifact **per target**, and the tracked set is
enumerated — a new target enters the budget file the day it enters the
build matrix, or it ships forever unmeasured.

Measure the object the constraint is about, at the compression the user
receives it in: the download budget on the compressed installer, the
update budget on the update payload, a disk budget (if one matters) on the
installed tree. Intermediate, uncompressed sizes are diagnostic detail —
useful for attribution, wrong for the gate, because compression moves
differently than raw bytes and the user never downloads raw bytes.

## When the budget fails

The response to a red budget is attribution, then a decision: what grew
(a size-attribution breakdown — per module, per dependency, per asset — is
the difference between a fixable finding and a mystery), then either shrink
it, accept it by raising the budget *with a written reason*, or reject the
change. The banned move is making the number green without making the
artifact smaller — dropping the target from the tracked set, switching the
measurement to a smaller intermediate, widening the noise floor
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)). The
budget file's history should read as a record of decisions, because that
is what it is.
