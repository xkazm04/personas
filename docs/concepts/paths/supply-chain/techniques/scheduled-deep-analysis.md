---
layer: technique
subject: supply-chain
technique: scheduled-deep-analysis
status: forged
laws: [failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Scheduled deep analysis

The review-time rungs of the gate ladder fire on commits. Two classes of
security drift do not wait for commits: **the world moves** (advisories
published against pinned dependencies, disclosure of a token format that
old history contains, analysis engines shipping new detection rules), and
**deep analysis is too slow for the review rung** (whole-program semantic
analysis, full-history secret sweeps, complete dependency audits measure
in minutes to hours). The scheduled rung exists for both: it is the gate
ladder extended past merge
([gate-laddering](../../quality-gates/techniques/gate-laddering.md)),
running on the calendar instead of the commit stream.

## What belongs on the schedule

The division of labor is by *what triggers the risk*:

- **Commit-triggered risk → review rungs.** A leaked token, a lockfile
  change, a widened permission manifest: these enter with a diff, so a
  diff-triggered gate sees them at the cheapest moment.
- **Clock-triggered risk → scheduled rung.** New advisories against an
  unchanged lockfile; improved analysis rules against unchanged code; a
  full-history secret sweep with patterns that did not exist when the
  history was written. No diff will ever re-trigger these checks over
  the code they apply to — only the calendar does.
- **Budget-exceeding depth → scheduled rung, with a review-rung scoped
  subset.** Deep semantic analysis often offers a fast, diff-scoped mode;
  run that at review and the full-depth pass on the schedule. The scoped
  run is a loan against the deep one — the standard scope-vs-latency
  trade, safe only because the full-scope pass exists.

The scheduled pass also runs from a **fresh checkout on a machine the
team does not own**, which quietly re-verifies portability: analysis that
only completes on committers' machines is analysis of those machines.

## A recurring job's worst state is silently absent

A review-rung gate that dies gets noticed — merges stop or a red mark
appears on a change someone is watching. A scheduled job that dies
produces *nothing*, and nothing is exactly what it produces when all is
well. Recurring jobs are silently disabled by platform policies (repo
inactivity timeouts), expired credentials, deprecated runner images, or a
renamed branch filter — and a disabled scan is indistinguishable from a
clean scan unless the system is built to distinguish them
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
The liveness structure:

- **Monitor recency, not just results.** Somewhere that a human or an
  alert actually watches, "time since this job last completed" is a
  number with a threshold. The job failing is a notification; the job
  *not running* must be one too.
- **Route failure to a person.** A scheduled job whose failure
  notification goes to a channel nobody reads has the same effective
  liveness as no job.
- **Assert the instrument inside the job**: zero files analyzed, an
  empty advisory database, an engine that exited before scanning — fatal,
  not clean, same as any checker
  ([gate-liveness](../../quality-gates/techniques/gate-liveness.md)).

## Findings need an owner, or the lane is theater

A review-rung gate's finding blocks a person who is present and
motivated. A scheduled finding arrives addressed to no one, about code
nobody is touching. Without explicit routing, scheduled lanes converge on
a dashboard of unread findings that exists to be pointed at
retrospectively — analysis as liability documentation, not defense. The
minimum viable routing:

- Findings land in a **triage queue with an owner** — a rotation, a team
  inbox with a service-level expectation by severity, anything with a
  name attached.
- **Severity maps to a deadline**, agreed in advance: critical advisories
  measured in days, informational findings batched monthly. Undated
  findings are unowned findings.
- The queue is drained to zero or to explicit, expiring exceptions
  ([dependency-policy-gates](dependency-policy-gates.md)) — never to
  ambient acceptance. A queue that only grows is measuring the team's
  alarm fatigue, not its exposure.

## The scheduled lane is where gates get their depth audited

Because the scheduled pass re-covers ground the review rungs already
certified, disagreement between them is a signal worth keeping: a deep
pass that finds what the scoped pass missed is measuring the scoped
pass's blind spot ([gate-sees-target](../../_laws.md#gate-sees-target)).
Treat recurring disagreement as a bug in the scoped gate's scope, not as
noise — the loan the review rung took out is being called.
