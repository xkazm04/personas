---
layer: technique
subject: codegen
technique: commit-vs-derive-policy
status: forged
laws: [derivation-names-recomputation, deletion-is-not-repair]
shared_with: []
---

# Commit-vs-derive policy

For every derived artifact class the repository must answer one question:
does the output live in version control, and if so, what enforces its
freshness? The answer is a **per-class policy decision**, and the failure
mode this technique prevents is not choosing wrong — it is not choosing at
all, so that each class's posture is an accident of who added it.

## The three tiers

1. **Derive-on-build, never committed.** The artifact exists only in build
   output. Freshness is guaranteed by construction; the costs are that the
   contract is invisible to review and history, and every consumer's build
   now depends on the generator's toolchain. Right for artifacts nobody
   reads: packed sprites, minified bundles, compression outputs.
2. **Committed, with a lockstep gate.** The artifact is in the tree, and an
   automated gate regenerates and compares, failing any commit where source
   and output disagree. Right where staleness is dangerous and diffs carry
   review signal — the boundary type contract is the canonical member, and
   the full argument for this tier in that instance is made in
   [generated-type-contracts](../../ipc-contract/techniques/generated-type-contracts.md).
3. **Committed, ambient refresh, no gate.** The artifact is in the tree,
   regenerated as a side effect of ordinary work (see
   [trigger-wiring](trigger-wiring.md)), and allowed to lag between
   sessions. Right where staleness is cosmetic and self-healing: reference
   inventories, convenience indexes, documentation distillates.

## The decision inputs

- **Who consumes it, and when.** If a consumer needs the artifact before any
  build runs — an editor, a review tool, a human reading the tree — tier 1
  is unavailable and the artifact must be committed.
- **What staleness costs.** Runtime failure in front of a user demands tier
  2. A slightly outdated reference document tolerates tier 3. Be honest
  about which one each class is; the expensive error is gating by prestige
  ("it's generated, so it must be gated") rather than by consequence.
- **Whether diffs carry signal.** A shape change in a contract is exactly
  what a reviewer should see: tier 2 makes it visible. A thousand-line
  re-split of a catalog carries no reviewable intent: committing it buys
  history, not review, and pretending otherwise just trains skimming.
- **Toolchain coupling.** Tier 1 couples every consumer build to the
  generator's runtime. Committing decouples — sometimes that alone decides.

## Review-noise economics, and the settle commit

Committed derived output competes with authored code for reviewer
attention, and attention is the scarcest resource in the loop. Two
disciplines keep the ledger balanced:

- **Lockstep commits for tier 2.** The source change and its regenerated
  output travel in the same commit — that is what makes the gate's
  invariant ("committed output equals current derivation") hold at every
  point in history, and what lets a reviewer see cause and effect in one
  diff.
- **Settle commits for tier 3.** When ambient regeneration accumulates
  drift across many sessions, the honest move is a dedicated commit that
  contains *only* regenerated output, labeled as such, with no authored
  changes hiding inside. This keeps authored commits clean, gives the noise
  one attributable home, and — critically — keeps the settle commit
  skimmable *because* it promises nothing else is in it. A settle commit
  with one hand-edit smuggled in poisons the promise for every future one.

## Demotion is legitimate — and must be recorded

Policies move. An artifact gated at tier 2 whose staleness turns out to be
cheap, whose gate fires mostly on noise, and whose ambient refresh is
reliable can be **demoted** to tier 3 — dropping the gate on purpose. This
is a real decision with a real trade, and it is distinguishable from the
malpractice it superficially resembles
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)) by
exactly one property: **the invariant is being consciously weakened, and
the weakening is written down** — what was demoted, why, what now keeps the
artifact approximately fresh, and what observation would justify
re-promotion. A gate that merely disappears reads as an accident: the next
maintainer either re-adds it (wasting the original judgment) or assumes the
artifact is still guaranteed (inheriting a guarantee nobody is providing).
The recorded demotion is also where the recomputation path must be
restated — a de-gated artifact leans entirely on its documented rebuild
command
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)),
because nothing else will ever again tell anyone it went stale.

The same honesty applies in the promotion direction: adding a gate to a
previously convenience-refreshed class should state what incident or risk
justified the new tax, or the gate will be resented as ceremony and
overridden into uselessness.
