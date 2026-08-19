---
layer: golden-path
subject: codegen
status: forged
techniques:
  - task-registry-design
  - trigger-wiring
  - commit-vs-derive-policy
  - drift-gating
  - generated-file-hygiene
  - generator-failure-isolation
evidence:
  - scripts/run-codegen.mjs                        # the flat registry: explicit task map ("no glob/auto-discovery"), presets per door, per-task timeout, parallel allSettled fan-out, exit = disjunction of outcomes
  - scripts/docs/gen-shared-catalog.mjs            # check mode sharing one code path with the write; the deliberately DE-gated catalog (advisory refresh, a recorded tier-3 policy decision)
  - scripts/generate-template-checksums.mjs        # checksum manifests emitted into two language worlds from one input set
  - scripts/generate-guidance-anchors.mjs          # "refusing to write an empty allow-list" — a generator that asserts its instrument instead of emitting empty success
  - src/lib/commandNames.generated.ts              # the self-declaring header: generator, re-run command, source pointer, and a falsifiable derived count
  - scripts/i18n/split-locales.mjs                 # locale splits as an ambient-refresh artifact class; also the measured delete-then-repopulate interruption hazard
counter_evidence:
  - src-tauri/tauri.android.conf.json              # a committed build profile wired to the documented bypass — the raw build command that runs zero pipeline tasks
  - scripts/docs/gen-tour-anchors.mjs              # the unregistered generator: correct output, do-not-edit headers, and stale committed artifacts — registration was the whole variable
deviations:
  - w6-codegen   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Generated-source pipelines

Mature repositories contain source that no human wrote: locale catalogs split
from a master file, name vocabularies extracted from handler declarations,
component inventories distilled from annotations, checksum manifests over
asset directories, type trees derived from schemas, sprite sheets packed from
icon sets. Each of these is **committed source derived from other committed
source** — and the moment a repository has more than one such derivation, it
has a *pipeline*, whether anyone has admitted it or not. The subject of this
path is that pipeline as a first-class engineering artifact: how the
population of generators is registered, triggered, policed, and kept honest
as a family.

This subject deliberately sits one level above its most famous instance. The
cross-boundary type contract — one language world generating another world's
declarations — is a whole subject of its own
([ipc-contract](../ipc-contract/ipc-contract.md)), and its
[generated-type-contracts](../ipc-contract/techniques/generated-type-contracts.md)
and [drift-gates](../ipc-contract/techniques/drift-gates.md) techniques treat
that single artifact class in depth. What lives *here* is everything those
techniques assume: the general discipline that applies to **any** derived
artifact, and the pipeline-level concerns — registry, triggering, isolation,
per-class policy — that no single artifact class can see from inside itself.

## Derived source is a different substance

Authored source and derived source look identical in a directory listing, and
treating them identically is the root defect this whole path exists to
prevent. They differ in every property that matters:

- Authored source is edited to change it; derived source is edited only by
  mistake, and the next regeneration silently erases the edit.
- Authored source is reviewed for intent; derived-source diffs are reviewed
  for *provenance* — "does this output correspond to that input change" — a
  different question needing different affordances.
- Authored source is true by fiat; derived source is true only **relative to
  its input at a moment in time**, which means it carries a standing claim
  that can silently become false the moment its input changes.

That last property is the spine of the subject. A derived artifact is a
stored derivation, and **a stored derivation names its recomputation**
([derivation-names-recomputation](../_laws.md#derivation-names-recomputation)):
for every generated file in the tree there is exactly one documented,
invokable command that rebuilds it, that command is written where the next
confused reader will actually be standing (in the file's own header, in the
contributor docs beside the authoring step), and it is the *same* command
every gate runs. A derived artifact whose recomputation is folklore — "ask
the person who added it" — is a future discrepancy with no arbiter.

## The pipeline is explicit, or it is unauditable

One generator is a tool. Ten generators are a system, and a system needs a
front door. The standard is a **single flat registry**: one file that lists
every generation task by name, with its command, its time budget, and the
named entry-point groups it belongs to. Adding a generator means adding a
registry line — a reviewable, attributable diff. The tempting alternative,
convention-based discovery ("every file in this directory matching a pattern
is a task"), hides exactly what the registry exposes: a discovered task has
no reviewer at the moment it joins the pipeline, no reviewer at the moment it
silently leaves, and no single place where a human can answer "what runs, in
what order, with what budget" by reading. A registry you can read is a
registry you can audit. The
[task-registry-design](techniques/task-registry-design.md) technique owns the
shape.

The registry also settles output ownership. Every task declares what it
writes; no two tasks write the same output root, because two writers to one
artifact are two authorities for one vocabulary
([one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary))
and the artifact's content becomes a function of run order.

One field measurement deserves golden-path standing because it reorders the
usual intuitions: in a real population of generators, **membership in the
registry was the single property that separated fresh committed artifacts
from stale ones** — every registered generator's output was byte-fresh,
most unregistered generators' output was stale, and nothing about the
generators' internals (headers, guards, comparison logic) predicted
anything. A generator only holds the line if something runs it. The
corollary is that the registry itself needs a completeness check — an
inventory that finds writers of generated output which no registry entry
claims — and that check is part of the technique.

## Regeneration must be ambient — and every bypass is a stale-ship vector

A pipeline that must be remembered will be forgotten; the discipline is
structural, not moral. Regeneration hooks into the entry points developers
already use — starting the development server, producing a build — so
freshness is a *side effect of working*, not a checklist item. Done right, a
contributor can be productive for months without knowing the pipeline
exists, which is the correct measure of success.

Ambient triggering has a shadow: **every raw entry point that skips the
wrapper ships stale artifacts**. The moment the underlying build tool can be
invoked directly — as a "fast path", in a debug recipe, by an agent following
generic instructions — the pipeline's guarantee has a hole exactly the width
of that door. The honest postures, in descending order of strength: make the
inner build itself assert freshness; make the wrapped entry the cheapest and
most obvious one; or at minimum document the bypass *at the point of use*, in
the same breath that names it. A bypass documented three files away is a trap
with a sign nobody standing in it can read. The
[trigger-wiring](techniques/trigger-wiring.md) technique carries this,
including the economics — an ambient pipeline that is slow or flaky trains
developers to bypass it, so speed and isolation are not conveniences but
load-bearing parts of the guarantee.

## Not every artifact earns the same policy

The naive rule — "commit everything, gate everything" — collapses under a
real population of artifact classes, because the classes genuinely differ in
what staleness costs. A boundary type contract that goes stale produces
runtime failures in front of users; a component inventory that goes stale
produces a slightly outdated reference document that the next ambient run
silently heals. Applying lockstep enforcement to both spends review attention
and build time where they buy nothing, and the spent attention is not free:
noisy gates get overridden, and overriding becomes a habit that then defeats
the gates that mattered.

So the subject demands a **per-class policy decision**, made explicitly and
recorded: derive-on-build only (never committed), committed with a
build-failing lockstep gate, or committed with ambient regeneration and no
gate. The decision inputs — consumer needs, staleness cost, review-signal
economics, toolchain coupling — and the legitimate (rare, recorded) act of
*demoting* an artifact from gated to convenience-refreshed live in
[commit-vs-derive-policy](techniques/commit-vs-derive-policy.md). The
gates themselves, and the blind spots every diff-shaped gate has — the
untracked new file, the orphan whose source died, the generator that
silently did nothing — live in [drift-gating](techniques/drift-gating.md),
which defers to the boundary-contract treatment where that instance is
concerned and adds what only the pipeline level can see: gate placement,
per-class attribution, and manifest-accelerated checks.

## A generated file declares itself

Every generated file states, in its opening lines, that it is generated, what
generates it, what it derives from, and how to rebuild it. This is the
derivation naming its recomputation *at the point of discovery* — the reader
who opens the file is precisely the person about to hand-edit it, and the
header is the last interception point before they do. Around the header sit
the mechanical reinforcements: format and lint tooling excludes generated
roots (a formatter and a generator fighting over one file are two writers,
and the churn destroys diff signal), review tooling collapses generated
diffs by default, and output is **deterministic** — stable ordering, no
timestamps, no machine-local paths — because a generator whose re-run
produces phantom diffs teaches reviewers to skim generated changes, and a
skimmed diff is an unreviewed one. The
[generated-file-hygiene](techniques/generated-file-hygiene.md) technique
owns the full set.

## One broken generator must not take the pipeline down — or pass it

A pipeline of independent tasks has failure modes no single generator has,
and all of them are composition defects: one hung task holding every other
task's output hostage; one crashed task aborting siblings so a single run
reveals only the first failure of five; one failed task whose wrapper exits
clean anyway, converting the failure into next month's staleness. The
standard is per-task time budgets, parallel fan-out that *collects every
result before judging*, an exit code that is the honest disjunction of task
outcomes, and a summary that names which tasks failed, which passed, and
which were skipped — because a skip reported as a pass is empty success
wearing a green light
([failure-not-empty-success](../_laws.md#failure-not-empty-success)). The
[generator-failure-isolation](techniques/generator-failure-isolation.md)
technique carries the full contract, including the genuinely open policy
choice at the ambient trigger: whether a generator failure blocks the
developer's session or warns past it — a choice to be made per entry point
and stated, never defaulted into silently.

## The techniques

- [task-registry-design](techniques/task-registry-design.md) — the flat
  explicit registry: names, budgets, preset groups, declared outputs; why
  discovery-by-convention is an audit hole.
- [trigger-wiring](techniques/trigger-wiring.md) — hooking regeneration into
  the doors developers already walk through; the bypass hazard and its
  countermeasures; the speed budget that keeps ambient honest.
- [commit-vs-derive-policy](techniques/commit-vs-derive-policy.md) — the
  three-tier policy per artifact class; review-noise economics; settle
  commits; demotion done honestly.
- [drift-gating](techniques/drift-gating.md) — which classes get gates and
  what shape; placement, attribution, manifest acceleration; the blind
  spots, deferring to the boundary-contract deep treatment.
- [generated-file-hygiene](techniques/generated-file-hygiene.md) — the
  self-declaring header, tool exclusions, determinism, single output roots.
- [generator-failure-isolation](techniques/generator-failure-isolation.md) —
  budgets, fan-out, collect-then-judge, exit-code honesty, visible skips.
