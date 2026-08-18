---
layer: technique
subject: quality-gates
technique: gate-laddering
status: forged
laws: [gate-sees-target]
shared_with: []
---

# Gate laddering

One standard, several rungs. The ladder exists because the two properties a
gate needs — *fast enough that nobody routes around it* and *complete enough
that its green is meaningful* — cannot be satisfied by a single check at a
single point. So the same standards are enforced repeatedly, at escalating
cost, with each rung's scope sized to the latency its stage can afford.

## The rungs and their budgets

| Rung | Latency budget | Scope | Enforces? |
|---|---|---|---|
| Editor | instant | the open file | no — feedback only |
| Commit | low seconds | files in the commit | yes, bypassable |
| Push | tens of seconds | affected surface | yes, bypassable |
| Merge pipeline | minutes | everything | yes — the binding rung |

**Editor.** Squiggles at authoring time prevent more defects than any other
rung, and enforce none of them. This rung is where advisory-severity rules
earn their keep — see severity-by-construction — but nothing here counts as
a gate.

**Commit.** The budget is a handful of seconds; above that, authors start
reaching for the bypass flag, and a bypass habit at the commit rung bleeds
into a bypass habit everywhere. Only checks that are fast *and* scoped
belong here: format and lint over the committed files, secret scanning,
message-shape checks, cheap inventory checks with a clear domain trigger
(run the catalog-completeness check only when catalog files are in the
commit). Everything at this rung is scoped to what is being committed —
which immediately raises the gate-sees-target question of *what content*
gets read; that discipline lives in hook-hygiene.

**Push.** The last local rung, and the right home for checks too slow for
every commit but too valuable to defer to the pipeline: type checking, fast
unit-test subsets, contract checks between generated artifacts and their
sources. The push rung's real product is latency — the author learns of the
failure minutes before the pipeline would have told them, while the context
is still loaded.

**Merge pipeline.** Everything, over everything, in a clean environment.
Full lint with no scoping, full test suites, cross-platform builds, every
inventory and drift check at repository scope. This rung is slow and that
is acceptable, because its job is not feedback — it is refusal.

## The binding rung is the last one

Every local rung runs inside the author's machine and can be skipped —
deliberately with a bypass flag, or accidentally because the hooks were
never installed on this clone. That is not a flaw to fix; local enforcement
that *cannot* be bypassed blocks legitimate emergency work and gets torn
out. The consequence is structural:

> **Every check on a lower rung also exists on the merge rung. A check
> that runs only locally is a courtesy, not a gate.**

The local rungs are latency optimizations over the binding rung — they move
the moment of discovery earlier; they do not move the moment of refusal.
Teams that forget this ship elaborate hook suites with no pipeline
counterpart, and the standard holds exactly until the first developer whose
clone lacks the hooks.

And the binding rung binds only if it can be green. A merge pipeline that
is red on every run — measured in the wild at *zero* successes across
hundreds of runs, for months, while merging continued — is not a strict
gate; it is no gate, because a refusal that fires on everything refuses
nothing anyone obeys. Permanent red converts the entire ladder back into
advice: the local rungs still give feedback, but the moment of refusal has
quietly ceased to exist. The pass rate of the binding rung is therefore
the first number to check when auditing any ladder — before reading a
single rule.

## Scoping is a loan against the backstop

A commit-rung check that examines only the committed files is making a
deliberate trade: completeness for latency. The trade is sound under one
condition — the *unscoped* run exists upstream on the binding rung. Without
the backstop, scoped checking silently converts "the codebase satisfies the
standard" into "files touched recently satisfy the standard," and the gap
concentrates in the oldest, least-visited code
([gate-sees-target](../../_laws.md#gate-sees-target): the scoped gate sees
a subset and verdicts the whole).

The same logic governs *conditional* rungs — checks that trigger only when
certain files appear in the change. Conditional triggering is a fine latency
optimization and a poor completeness guarantee: the condition can be wrong,
the coupling can be indirect (the source changed but the artifact that
should have changed with it is not in the diff), and only the unconditional
upstream run closes the hole.

## One authority for the rule set

When the same rule runs at three rungs, there must be one configuration all
three read. Hand-copying rule lists into hook config, push config, and
pipeline config manufactures drift: the rule gets strengthened in one place
and the other two silently gate an older standard. The rungs may differ in
*scope* and *severity handling*; they must not differ in *rule content*
except by derivation from the single source.

## Diagnostics the ladder should emit

- **Bypass rate.** If the bypass flag is used often, the rung is too slow
  or too imprecise — measure which. A rung nobody bypasses and a rung
  everybody bypasses are both signals; only the first is good news.
- **Time-to-red.** For each defect class, which rung catches it? Defect
  classes that only ever surface at the merge rung are candidates for a
  cheaper detector on an earlier rung.
- **Rung skew.** Findings that appear at the merge rung but not at commit
  for the same content mean the rungs have drifted — different rule
  versions, different scoping, or a dead local rung.
- **The typical-commit fire set.** For a representative sample of real
  commits, which jobs would actually have run? Trigger-scoped jobs are
  each individually reasonable, and can still compose into a rung where
  the only job firing on the *median* commit is one that cannot fail —
  replaying recent history against the trigger conditions is the only way
  to see the composition.
