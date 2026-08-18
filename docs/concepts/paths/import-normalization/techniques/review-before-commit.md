---
layer: technique
subject: import-normalization
technique: review-before-commit
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Review before commit

Between the pipeline's understanding of the file and the first write to the
user's workspace stands a **review gate**: the user sees what was found and
what it will become, selects what to bring, resolves collisions, and
explicitly commits. The gate is not a courtesy screen — it is the structural
answer to three facts at once: the conversion is lossy (consent requires
sight), the input is foreign (the user may not want everything the file
contains), and the destination is live (a wrong bulk write is expensive to
unwind).

## The staging model

Everything before commit operates on the staged proposal — the intermediate
representation plus its loss ledger — and **nothing persists to the real
store until the commit action**. Preview state may be cached (a multi-step
review that loses its state on an accidental navigation will be abandoned,
and per [wizard-flows](../../wizard-flows/wizard-flows.md)' snapshot
discipline, resumability is what makes long reviews survivable), but staged
state is clearly second-class: it has an expiry, it names its reaper
([creation-names-reaper](../../_laws.md#creation-names-reaper)) — abandoned
staging areas are garbage-collected, not discovered by the user as
mysterious half-imports — and it is never queryable as if it were real data.

The step architecture, progress communication, and back-navigation semantics
are [wizard-flows](../../wizard-flows/wizard-flows.md)' subject matter
wholesale. What import adds is the *content* of the steps: inspect →
select → resolve → confirm.

## Per-entity opt-in

The unit of selection is the entity, not the file. A real export contains
the user's whole workspace-worth of material; the user came for two
workflows. Selection semantics that keep the gate honest:

- **Dependencies select with their dependents, visibly.** Choosing a step
  that requires a credential slot pulls the requirement in and says so;
  deselecting an entity that others reference either cascades (with a
  count: "deselecting this also removes 3 connections") or blocks with an
  explanation. Silent dependency dragging — committing things the user
  never saw selected — breaks the gate's core promise.
- **Unimportable entities stay visible, disabled, with reasons.** The
  entities that failed validation or graded `unsupported` render in place,
  unselectable, each with its reason. Hiding them re-creates silent loss
  one screen after the pipeline worked to prevent it.
- **Defaults favor the probable intent, never totality by momentum.** A
  select-all default on a 200-entity export converts "review" into
  "scroll past and click confirm".

## Collision policy is an explicit user choice

An incoming entity will sooner or later match something already in the
workspace — same name, or same provenance (the same foreign id imported
last month). The gate detects both kinds and puts the policy in the user's
hands, per collision or as a batch rule: **skip** (keep mine), **rename**
(bring it in alongside, with a deterministic suffix shown up front), or
**replace** (with the same weight of confirmation the product gives any
destructive overwrite). The one forbidden design is a *silent* default —
imports that quietly overwrite, or quietly duplicate on every re-run,
convert the second import of the same file into either data loss or a
naming landfill. Provenance-based matching is what makes **re-import**
tractable: recognizing "this is the same foreign entity, newer" upgrades
the choice from name-guessing to an informed update-or-fork decision.

## Disclosure at the decision point

The loss ledger renders **inside the gate**, attached to the entities it
describes — a per-entity grade badge with reasons on demand, and a summary
("42 of 51 map fully; 6 approximated; 3 cannot be imported") whose counts
name their predicate. Disclosure shipped anywhere else — a log, a
post-commit toast, a docs page — is not consent, because the user decided
without it. This is the review gate's half of
[lossy-conversion-disclosure](lossy-conversion-disclosure.md); the ledger's
construction is the adapter's half.

## Commit is atomic and lands through the normal door

The confirmed subset commits as one unit: either every selected entity is
created (through the host's ordinary creation door — see
[import-validation](import-validation.md)) or none are, and the failure
report names what blocked, **per entity** — "3 of 5 tools failed: X, Y, Z —
fix and retry" is actionable; "import failed" is not. Partial commits are
the worst outcome the gate exists to prevent — a store holding half an
import, with the user unsure which half, is worse than a clean failure.
Where the platform cannot offer a real transaction across entity kinds, the
commit orders writes so that dependencies land before dependents and
records a manifest as it goes, so a mid-commit failure is at minimum
*enumerable* and reversible by the manifest rather than by archaeology.

Write the receipt row **before** the transaction, in a staged status, and
flip it to committed or failed at the end. A receipt created only on
success is a receipt precisely for the imports that needed no explanation;
the staged-first ordering means even a crash mid-commit leaves a record
that an import was attempted, by whom, from what. And the receipt must
actually *enumerate* — what was created, from which source file, at which
conversion grades. A receipt schema whose enumeration column exists but is
written empty on every success is the commit-side rendition of silent
loss: the record says "an import happened" and can answer nothing the user
will later ask. Anything the commit needs the user to do afterwards —
credential requirements to fulfill, `data-only` entities to finish —
returns from the commit as an explicit follow-up list, rendered
immediately, not discovered later as broken entities.
