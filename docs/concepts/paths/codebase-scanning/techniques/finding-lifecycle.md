---
layer: technique
subject: codebase-scanning
technique: finding-lifecycle
status: forged
laws:
  - identity-survives-reuse
  - deletion-is-not-repair
shared_with: []
---

# Finding lifecycle

A finding is born as a candidate, survives verification to become a work
item, and leaves through one of a small set of named exits. The technique is
the state machine and its invariants: identity that survives the world
changing under it, ordering that spends operator attention well, a
verification pass between detection and filing, and honest terminal states
after remediation. A scanner without this lifecycle produces the same
finding fifty times, forgets what was already judged, and cannot tell
progress from churn.

## Identity: the dedup key must survive the world moving

Every finding carries a stable identity from the moment of emission, and the
construction is load-bearing. The naive key — rule plus file plus line
number — breaks the day anyone edits above the match site: the line shifts,
the key changes, and yesterday's acknowledged finding refiles as new while
its predecessor dangles as a phantom. The construction that survives is
**rule identity plus normalized location plus a digest of the matched
content** — where "normalized location" means the containing unit (module,
declaration, block) rather than the raw line, and the content digest is what
distinguishes two genuine instances inside one unit. Line numbers ride along
as presentation detail, never as identity
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).

Dedup then operates at two horizons: within a sweep (one defect matched by
overlapping patterns files once) and across sweeps (a re-found finding
refreshes its last-seen timestamp and retains its history — verdicts,
notes, age — rather than spawning a sibling). Age since first-seen is one of
the most useful signals the pipeline produces, and it exists only if
identity holds across runs.

## Verify, then file

Between the emission stage and the operator's queue sits the verification
pass, and it is a distinct pass, not a flag on detection. The verifier
re-reads the claimed location in the current tree and asks three questions
in order: does the quoted evidence still exist there (the world may have
moved since the snapshot); does the rule's reasoning survive the surrounding
context (the match may be real but the defect may not — a suppressed case,
a deliberate exception, a test fixture); and does the finding pass the
actionable predicate (would a human decision change the outcome). Only a
candidate that clears all three is filed. The pass is where the pipeline
spends compute to save attention: a re-check costs milliseconds to minutes;
a false positive in the queue costs trust that does not refill.

## Ordering and disclosed truncation

Filed findings are ranked by **impact-per-effort** — what fixing this buys,
against what fixing this costs — with severity and age as tiebreakers, and
the ranking is deterministic so the queue is stable between visits. Volume
is then capped, and the cap is *disclosed*: the report states how many
findings were withheld and by what rule. The two decisions travel together
because a cap over an unstable order silently rotates which findings the
operator ever sees, which is the worst of both worlds — bounded visibility
and unbounded blind spots.

## Exits: every finding leaves through a named door

- **Fixed → verified.** Remediation does not close a finding; verification
  does. The cheapest sound design needs no separate probe engine at all:
  since a detector only emits when its signal is over threshold, **the next
  sweep's fresh emission is itself the probe** — the finding's identity
  absent from the fresh set means the signal fell below threshold
  (**cleared**), and the identity still present means the fix did not fix
  (**persisted**, the finding stays open and says so), or, after a prior
  clearing, **regressed** — a distinct and louder state than "new finding",
  because it impeaches the fix. Two refinements keep this honest. First,
  absence only clears **when the sensor actually ran** — a skipped sensor
  produces absence too, and counting that as a win is the loop fabricating
  its own successes. Second, findings split into *presence-shaped* (the
  condition either still matches or it does not) and *metric-shaped* (the
  finding was raised on a number); for the latter, the verdict compares the
  stored raising-time reading against the fresh one, and an improvement
  below a declared materiality floor is judged **unchanged** — claiming a
  win on noise is how a verification loop starts lying. And no verdict is
  issued at all until the remediation actually shipped; judging unshipped
  work manufactures outcomes for effort that never happened.
- **Rejected.** The operator judged it a false positive. The verdict is
  recorded *against the rule as well as the finding* — rejection rates per
  rule are the live precision measurement, and a rule being rejected at
  high rates is itself a finding about the scanner.
- **Suppressed.** A true match deliberately accepted — with a recorded
  reason and, ideally, an owner and a revisit horizon. Suppression is a
  verdict with provenance. What is *not* an exit: editing the rule's scope
  to exclude the annoying site, or deleting the finding record — both
  remove the visibility while leaving the condition, which is the exact
  move [deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)
  names. If a suppression is warranted, it is warranted on the record.
- **Expired.** A finding not re-found for N consecutive full-coverage
  sweeps is retired as stale — the world resolved it out of band. Expiry
  requires coverage honesty: a finding may only expire against sweeps that
  actually re-examined its location.

## The ledger is the product

Run to run, the persisted lifecycle is what elevates a scanner from a
reporting tool to an instrument: it can answer "what is our oldest open
finding", "which rules earn their keep", "did last month's cleanup hold",
and "what came back". None of those questions can be answered by a scanner
that starts from zero each run — and they are the questions that justify
the scanner's continued existence when its budget is next reviewed.
