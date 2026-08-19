---
layer: golden-path
subject: quality-gates
status: forged
techniques:
  - gate-laddering
  - severity-by-construction
  - ratchet-design
  - gate-liveness
  - hook-hygiene
  - false-positive-economics
evidence:
  - lefthook.yml                                    # the two local rungs, with the ladder + hygiene rationale written into the file itself (fast pre-commit, hooks never mutate the tree, heavy checks on pre-push, CI backstop)
  - package.json                                    # `check` — the 9-step && merge-rung chain; `census:check` / `census -- --update` — the ratchet pair
  - scripts/census/run-census.mjs                   # the ratchet: exit 1 on a rise AND on a silent drop; baselines updated only by a deliberate --update that lands in the diff
  - scripts/census/check-corpus-integrity.mjs       # living liveness exemplar: FATAL (exit 2) vocabulary distinct from fail, instrument asserted before result, ROOT derived from file location after the one-laptop incident
  - scripts/secret-scan.mjs                         # the announced skip: scanner absent → loud hint + exit 0 — honest output, zero enforcement without a binding backstop
  - .github/workflows/ci.yml                        # the binding rung: conventional-commit lint with engineered exemptions, binding-drift and command-name-drift gates
counter_evidence:
  - docs/concepts/golden-paths/adding-a-ci-gate.md  # measured: the binding rung had NEVER passed — 0 successes in 260 runs — while merging continued; a permanently red backstop is no gate
  - docs/concepts/golden-paths/commit-path-gates.md # fault-injection: the quiet flag disarms the display channel, not the exit code — a mechanism folklore five documents repeated wrongly; and the only pre-commit job firing on every commit was one that cannot fail
deviations:
  - w6-quality-gates   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Quality gates & ratchets

A quality standard exists in exactly one of two forms: as prose someone must
remember, or as a mechanism that can refuse. Only the second form survives
contact with deadlines, staff turnover, and the two-hundredth pull request.
The domain of quality gates is the engineering of refusal: which checks run,
where in the pipeline they run, what severity they carry, how metrics that
cannot yet be zeroed are prevented from getting worse, and — the part most
teams never do — how the gates themselves are verified to be alive. A team's
real quality bar is not what its documents say; it is the precise set of
states its machinery will refuse to let through. Everything softer is
aspiration.

## A gate exists only if it can fail

The foundational test for any check: **name the input that makes it block.**
If no input can make the pipeline stop, the check is not a gate — it is
output. This sounds trivial and is violated constantly, because severity is
usually *configured* in one place and *neutralized* in another:

- a rule set to advisory level, in a pipeline whose runner exits clean at
  any advisory count;
- a threshold flag set beyond any count the codebase could plausibly
  produce — strictness in review, unfireable in fact;
- a check that prints findings to a log nobody's exit code depends on.

In each case the severity label says "enforced" and the construction says
"decorative." The discipline is to reason about severity **by construction,
not by label**: trace the exit-code path from the finding to the merge
decision, and believe only what that path can actually do. Advisory output
is not worthless — it changes behavior through editor feedback at authoring
time, which is real and measurable — but it is a different product from
enforcement, and the failure mode is buying one while believing you own the
other. The full discipline, including how to measure whether a severity
level can ever fail a build, is
[severity-by-construction](techniques/severity-by-construction.md). The same
lesson was measured independently in
[swallowed-error-prevention](../error-handling/techniques/swallowed-error-prevention.md):
a rule that only warns, at gates that ignore warnings, enforces nothing at
either commit or merge — by construction.

## Gates are laddered by cost

A single monolithic "run everything" gate fails in both directions: too slow
at commit time and people bypass it; only at merge time and feedback arrives
hours after the mistake was cheap to fix. The senior structure is a
**ladder** — the same standards enforced at multiple rungs, with each rung's
scope sized to its latency budget:

- **Editor** — instant, advisory, per-keystroke. Catches most defects before
  they are ever committed, enforces nothing.
- **Commit** — seconds. Scoped to the files being committed. Fast static
  checks only.
- **Push** — tens of seconds to a minute. Type-level and contract-level
  checks over the affected surface.
- **Merge pipeline** — minutes. Everything, over everything, on a machine
  nobody's local state can pollute.

Two invariants make the ladder sound. First, **the binding rung is the last
one**: every local rung can be bypassed (and must be bypassable — see
[hook-hygiene](techniques/hook-hygiene.md)), so the merge pipeline is the
only rung whose green means anything, and every check on a lower rung must
also exist there. A check that runs *only* locally is a courtesy, not a
gate. Second, **scoping is a loan against the backstop**: a commit-stage
check that examines only changed files is deliberately trading completeness
for latency, and the trade is safe only because the full-scope run exists
upstream. Scoped rungs without a full-scope backstop accumulate blind spots
in exactly the files nobody has touched recently. Rung design, what belongs
where, and the bypass economics are
[gate-laddering](techniques/gate-laddering.md).

## The gate must see its target

A gate observes some artifact and renders a verdict about some other thing —
the commit, the release, the codebase. The two are rarely identical, and
every gap between them is a place the gate passes while the target fails
([gate-sees-target](../_laws.md#gate-sees-target)). The recurring gaps:

- **Working tree vs. commit content.** A commit-stage check that reads the
  working tree is checking files as they sit on disk, not as they will be
  committed — partially staged files diverge exactly there.
- **Diff-shaped gates are blind to absence.** A gate built as "fail if this
  tracked artifact changed unexpectedly" cannot see a *new* artifact that
  was never tracked, or a stale artifact whose source vanished. Nothing
  changed; nothing fails; the drift is invisible by construction. Absence
  requires an inventory gate — "enumerate what should exist and compare" —
  not a diff gate.
- **Stale intermediates.** A gate that reads a generated index, a cached
  catalog, or yesterday's build output verifies the intermediate, and passes
  precisely when the intermediate has drifted from the source — the one
  condition it existed to catch.

Before trusting any green result, the question is never "did the check
pass" but "what did the check read."

## Ratchets: monotonic improvement as a gate

Most quality metrics in a living codebase cannot be zeroed today — hundreds
of legacy violations, a bundle that grew for two years, a warning class with
deep roots. The wrong responses are the common ones: block on zero (instant
bypass culture) or track it on a dashboard (numbers that only ever go up).
The senior structure is the **ratchet**: record the current value as an
explicit, committed baseline, and gate on direction — the metric may fall,
never rise.

A correct ratchet fails in **both** directions. Fail on rise, obviously.
But also fail — or at minimum refuse silence — when the measured value drops
below the baseline without a baseline update, because an unexplained
improvement has two explanations and the likelier one is that **the
measurement broke**. A counter that walked zero files reports zero
violations; celebrating that number buries the instrument failure inside
good news ([failure-not-empty-success](../_laws.md#failure-not-empty-success)).
Improvements are welcomed by re-baselining as a deliberate, reviewed diff —
the baseline file is the metric's audit log. Baseline mechanics, bucketing,
and the endgame (a ratchet that reaches zero graduates into a hard ban) are
[ratchet-design](techniques/ratchet-design.md).

## A gate that cannot prove it ran has not run

The most dangerous gate state is not red; it is **false green** — the
checker that exited clean because it checked nothing. A missing tool, a
path assumption that holds on one machine only, a glob that matched zero
files, an early chain-step that aborted before the real check: all of these
produce the same observable as success unless the gate is built to refuse
that equivalence. The standing rule: **assert the instrument before the
result**. Zero files walked, zero rules loaded, a scanner binary absent —
these are fatal errors with their own exit path, never a green report
([failure-not-empty-success](../_laws.md#failure-not-empty-success)). And
liveness is verified from the outside, too: a gate is proven alive by
feeding it a known-bad input and watching it fail — once at birth, and
again whenever anyone claims it works. A gate that has never been seen
red is unverified machinery. Portability, instrument assertion, chain
ordering, and seeded-failure verification are
[gate-liveness](techniques/gate-liveness.md).

## False positives are how gates die

Gates do not usually die by being deleted in anger. They die by a quieter
sequence: the gate fires on content that is actually correct; the author,
knowing they are right, bypasses it; bypassing becomes ambient habit;
eventually the gate blocks something real, gets bypassed by reflex, and the
defect ships — at which point the gate is deleted for having "never worked."
**Precision is a survival property.** Before a detector earns blocking
severity it is driven over the full population it will judge, and its
precision measured against ground truth; a detector that flags correct code
is a debt against the team's trust budget, and the budget is shared across
*all* gates — one crying wolf teaches people to bypass the whole ladder.
When a live gate misfires, the fix is narrowing the detector, never deleting
the gate ([deletion-is-not-repair](../_laws.md#deletion-is-not-repair)) —
unless measurement shows the detector never matched the standard at all, in
which case it was not a gate for that standard and pretending otherwise is
the harm. The economics, the measurement method, and the quarantine
protocol for flaky checks are
[false-positive-economics](techniques/false-positive-economics.md).

## Hooks are guests in someone else's working tree

The commit and push rungs run inside the author's workspace, possibly
alongside other in-flight work, and their discipline is a subject of its
own: **hooks observe, never mutate** — an auto-fixing hook silently commits
content the author never saw and diverges staged from unstaged state;
hooks are non-interactive and time-bounded; hooks scope to what is being
committed, not to whatever else is in the tree; and hook *installation* is
itself a liveness problem, because a hook that was never installed reports
nothing and looks identical to a hook that passed. The full protocol is
[hook-hygiene](techniques/hook-hygiene.md).

## Domain gates ride the same ladder

Everything above is domain-agnostic scaffolding, and its test is that
domain-specific gates compose onto it without new machinery: a completeness
gate for translation catalogs
([completeness-gates](../i18n/techniques/completeness-gates.md)) is a
commit-rung inventory gate with a merge backstop; a token-enforcement rule
for a design system
([token-enforcement](../design-tokens/techniques/token-enforcement.md)) is a
severity-by-construction decision plus a fix-as-you-touch ratchet; a
swallowed-error census is a ratchet whose counter must assert its
instrument. When a new standard arrives, the questions are always the same
four: which rung, what severity by construction, ratchet or hard ban, and
how will we know the gate is alive next year.

## The techniques

- [gate-laddering](techniques/gate-laddering.md) — cost tiers by pipeline
  stage, scope-vs-latency trades, the binding rung, and the full-suite
  backstop.
- [severity-by-construction](techniques/severity-by-construction.md) —
  tracing what a severity level can actually fail; advisory feedback vs
  enforcement; escalation paths for new rules.
- [ratchet-design](techniques/ratchet-design.md) — committed baselines,
  fail-on-rise and fail-on-silent-drop, reviewed re-baselining, and
  graduating to a ban.
- [gate-liveness](techniques/gate-liveness.md) — instrument assertion,
  portability, chain-abort ordering, and proving a gate red before
  trusting it green.
- [hook-hygiene](techniques/hook-hygiene.md) — never mutate the worktree,
  staged-content scoping, non-interactive discipline, bypass policy, and
  installation as a liveness problem.
- [false-positive-economics](techniques/false-positive-economics.md) —
  precision as survival, measuring before enforcing, the trust budget, and
  quarantining flaky checks.
