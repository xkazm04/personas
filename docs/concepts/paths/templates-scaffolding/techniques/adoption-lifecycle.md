---
layer: technique
subject: templates-scaffolding
technique: adoption-lifecycle
status: forged
laws: [identity-survives-reuse, derivation-names-recomputation, creation-names-reaper]
shared_with: []
---

# Adoption lifecycle

Adoption is the pipeline that turns a catalog entry into a live instance, and
each stage exists to absorb a failure that would otherwise reach production:

> **author/generate → admit → browse → preview → interview → review → adopt
> → divorced instance**

The stages before `admit` protect the catalog (see
[catalog-curation](catalog-curation.md)); the stages after protect the
adopter. This technique covers the adopter's half.

## The dimension model: answers are data, mapping is deterministic

The interview presents the template's declared dimensions (from
[template-anatomy](template-anatomy.md)) as questions. Its output is a small,
serializable record: **dimension id → chosen option id**. That record — the
*answer set* — is the pivot of the whole lifecycle, and the discipline is to
keep both of its edges honest:

- **Upstream edge:** the interview may only produce answers that the
  parameter surface declares. No free-text smuggled into an option slot, no
  interview-side invented choices. If the interview needs a question the
  template doesn't declare, the template is missing a dimension — fix it
  there, once, for every surface.
- **Downstream edge:** a single **deterministic mapping** turns the answer
  set into concrete configuration deltas over the payload. One function,
  pure in the answers and the template: same template + same answers ⇒ same
  instance, every time, on every machine. The anti-pattern is scattering
  `if answer == …` through the instantiation code — that turns the mapping
  into an emergent property of a code path, unpreviewable and untestable as
  a unit.

Determinism is not pedantry; it is what makes three other things possible at
zero marginal cost: **preview** (run the mapping, render the result),
**provenance** (store the answers, and the instance is reproducible), and
**testing** (enumerate answer sets, assert on outputs — the mapping is the
only part of adoption that has interesting logic, and it is pure).

## Preview renders the mapped result, or it lies

A preview's contract: **what "confirm" creates is what the preview shows,
under the current answers.** The preview is a derived view of
(template, answer set) and must name its recomputation — re-run the mapping
on every answer change
([derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)).
The two degenerate previews both ship constantly and both break trust:

- the **stock screenshot** — a static image of the template's happy path,
  unchanged by any answer; an advertisement wearing a preview's chrome;
- the **stale preview** — mapped once on open, not recomputed on change, so
  the adopter's last edits are exactly the ones not shown.

A preview may honestly show *less* than the instance (elide detail), never
*other* than the instance.

## Review: comparing candidates is part of the lifecycle

When templates are generated in batches, the adopter's real task is often
"which of these three drafts is right", not "configure this one". A review
surface — side-by-side comparison, a tray of candidates, accept/discard per
candidate — belongs to the lifecycle, and its verdicts are lifecycle events:
a discarded draft is **deleted or archived by the flow that created it**
([creation-names-reaper](../../_laws.md#creation-names-reaper) — generated
drafts are the classic orphan population: cheap to mint, nobody's job to
reap). A generation feature that only ever adds drafts converges on a
catalog whose majority is abandoned candidates. The deeper editing loop —
drafts as first-class mutable artifacts with their own save/discard
semantics — is the [draft-editing](../../draft-editing/draft-editing.md)
subject; adoption borrows its results rather than restating them.

## Adoption is a transaction

Instantiation typically creates a graph — the primary entity, sub-entities,
wiring between them, subscriptions — and the rule is **all or nothing**. A
half-adopted template is the pipeline's worst output because it
*impersonates* a finished instance: it appears in lists, accepts
configuration, and fails only when the missing half is exercised. Whatever
transactional machinery the platform offers, adoption uses it; where a step
is genuinely non-transactional (an external registration), it is ordered
last and its failure rolls back the rest or surfaces as an explicit
incomplete-adoption state — never as silence.

Identity is minted **at adoption, per instance**
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)): adopting
the same template twice produces two instances with two ids and no shared
mutable state. Deriving instance identity from the template's id — or
worse, reusing it — makes the second adoption a collision, and "adopt it
again" is a normal operation, not an edge case.

## The divorce, with a forensic stamp

After the transaction commits, the instance is **divorced**: editing the
instance never writes back to the template; editing the template never
mutates existing instances. The coupling that remains is one inert
**provenance stamp** on the instance — template id, template version, answer
set, adoption time. Two spelling rules on the stamp, both paid for in
measurement: it keys the template by **stable id, never display name** (a
reference system's adoption counter matched on display name while callers
passed ids — 144 of 160 real adoptions incremented nothing, and the ledger
recorded the miss each time); and it records the version **as it stood at
adoption**, not a pointer to the template's current version — the current
version changes under you, and without the frozen value "the adopter edited
this" and "the catalog moved on" become the same observation, unseparable
by any later hashing. The stamp is for reading, not for synchronization:

- forensics ("which template produced the instance that misbehaves?"),
- cohort queries ("every instance from template T before version 3"),
- **offers, not actions** ("this template has improved since you adopted" —
  an upgrade the adopter may accept, never an update pushed into an
  instance they have since made their own).

Live template→instance coupling is the design that must be argued *for*,
and almost never survives the argument: the instance's whole value is that
the adopter owns it now.

## Re-adoption and idempotence

Because adoption is cheap and templates improve, the same template will be
adopted repeatedly — by one user experimenting, by many users
independently, by automation. The lifecycle therefore answers, by design
rather than by accident: what does adopting T twice produce (two
independent instances — the default), when is an adoption a *replay* (same
template, same answers, intentional idempotence key — e.g. seeding built-in
content on every startup must not duplicate it), and how does a
re-adoption relate to an existing instance's local edits (it doesn't —
divorce means the new instance arrives beside, not over, the old one).
Seed-shaped adoptions — the product installing its own catalog's content —
follow the same pipeline with the interview skipped and the defaults
applied, which is precisely why the defaults-within-options invariant of
[template-anatomy](template-anatomy.md) is load-bearing: the most automated
path through the lifecycle is also the one no human is watching.
