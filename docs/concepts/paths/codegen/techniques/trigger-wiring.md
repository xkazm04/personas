---
layer: technique
subject: codegen
technique: trigger-wiring
status: forged
laws: [gate-sees-target, derivation-names-recomputation]
shared_with: []
---

# Trigger wiring

A regeneration command that must be remembered is a regeneration command
that will be skipped — not by the careless, but by everyone, eventually,
because remembering is not a mechanism. This technique makes regeneration
**ambient**: wired into the doors developers already walk through, so
derived artifacts are fresh as a side effect of ordinary work.

## Hook the doors people actually use

The two doors that matter are *starting a development session* and
*producing a build*. Both get a pre-step that runs the pipeline's
appropriate preset before the real work begins. This placement has three
properties worth naming:

- **It runs on the machine where the inputs just changed.** The developer
  who edited the master catalog is the one whose next session regenerates
  the splits — the regeneration happens closest to the knowledge of why.
- **It needs no discipline.** The correct measure of success is that a
  contributor can work productively for months without learning the
  pipeline exists. Freshness by habit fails with turnover; freshness by
  wiring survives it.
- **It is the recomputation path made ambient.** The stored derivation's
  documented rebuild command
  ([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation))
  is not a separate ritual — it is the same preset the doors already run,
  so the documented path and the habitual path cannot diverge.

Commit-time hooks are a third, narrower door: right for cheap checks on
gate-graded artifact classes (see
[drift-gating](drift-gating.md)), wrong for heavy regeneration — a slow
commit hook is the fastest known way to teach a team to bypass hooks
wholesale.

## The bypass hazard: every raw door ships stale artifacts

The wrapper only guarantees the doors it stands in front of. Almost every
build toolchain also exposes the *inner* command — the raw build without the
pre-steps — and every path to it is a hole in the guarantee exactly that
wide. The holes are rarely malicious: a "quick" invocation in a debugging
session, a deployment recipe written from the toolchain's own docs, an
automation agent following generic instructions for the stack rather than
this repository's wrapper. In each case the build succeeds, ships every
committed derived artifact **as of the last time somebody ran the wrapper**,
and nothing anywhere records that the pipeline was skipped.

Countermeasures, strongest first:

1. **Make the inner build assert freshness.** A stamp the pipeline writes
   (inputs' content hash) and the inner build verifies turns the bypass
   into a loud failure instead of a silent stale ship. This is the only
   countermeasure that closes the hole rather than shrinking it — the check
   rides *inside* the thing being protected, so the gate finally sees its
   target ([gate-sees-target](../../_laws.md#gate-sees-target)).
2. **Make the wrapped door the cheapest one.** If the wrapper is what the
   docs name, what the shortcuts run, and what finishes fast, the raw door
   has no constituency.
3. **Document the bypass at the point of use.** If the raw command must be
   mentioned at all, the warning lives in the same sentence — "this skips
   the pipeline; run the preset first" — never in a different document. A
   trap's sign belongs inside the trap.

A drift gate downstream (in the automated pipeline) catches *committed*
staleness but not this: the bypass ships artifacts that are perfectly
consistent with what was committed — the commit was fine; the *build* was
stale relative to nothing version control can see. That is why the stamp
countermeasure exists at the build layer and cannot be delegated to the
commit layer.

## The speed budget is load-bearing

Ambient triggering taxes every session start. The tax must stay small — a
handful of seconds — or developers will route around it, and routing around
it is precisely the bypass hazard. The engineering that keeps it small is
not optional polish:

- **Parallel fan-out** across independent tasks (the registry's declared
  independence, from
  [task-registry-design](task-registry-design.md), is what makes this safe).
- **Per-task budgets** so one degenerate generator cannot hold the door
  shut; a task that blows its budget fails loudly and the door's failure
  policy (block or warn-past, per
  [generator-failure-isolation](generator-failure-isolation.md)) decides
  what happens next.
- **Cheap no-op detection** where a generator can compare input fingerprints
  and skip real work — reported as *skipped-fresh*, distinct from both
  success and failure, so the summary stays honest.

The quiet corollary: when the ambient pipeline is fast and reliable, the
per-class policy debate (gate or no gate, in
[commit-vs-derive-policy](commit-vs-derive-policy.md)) gets easier, because
"the next session heals it" is actually true. A slow, flaky pipeline forces
everything toward hard gates, which are the expensive kind of honesty.
