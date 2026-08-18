---
layer: technique
subject: dead-code
technique: quarantine-vs-delete
status: forged
laws:
  - deletion-is-not-repair
  - creation-names-reaper
  - failure-not-empty-success
---

# Quarantine versus delete

Every static instrument has a horizon past which it cannot see: names assembled at
runtime, string-keyed dispatch, reflection, configuration-driven loading, identifiers
arriving over a wire. Candidates near that horizon carry irreducible uncertainty,
and the two ways of being wrong about them are not symmetric. Deleting live code is
an outage — discovered by a user, in production, on the dynamic path nobody
exercised in review. Keeping dead code is carrying cost — real, but paid in build
seconds and reader confusion, and reversible any afternoon. The technique is
choosing between three moves per candidate — delete, quarantine, keep — priced by
that asymmetry.

## The decision table

- **Confidence high, reversal cheap → delete.** Verified by the deletion protocol,
  restorable from version control as one operation. Most candidates from
  reachability walking over statically-imported code land here.
- **Confidence high, reversal expensive → quarantine first.** Migrations,
  data-shape changes, anything where "restore the file" does not restore the
  state. The quarantine is a rehearsal for the delete.
- **Confidence uncertain → quarantine, loudly.** The candidate sits near a
  dynamic-dispatch surface, or the instrument's own predicate admits it cannot
  see this class. Deleting hopefully is how scanners become outage generators.
- **Confidence low, cost of keeping low → keep, and record why.** Not every
  candidate is worth the investigation; an unranked "maybe" list is legitimate as
  long as it is labeled as one and not left to be mistaken for a verified backlog.

## Quarantine is loud, or it is not quarantine

The defining property: **quarantined code reports its own use.** Code that is left
in place "just in case" but instrumented to say nothing is not quarantined — it is
kept, with a hopeful label. Three forms, in rising strength:

- **Dry-run defaults.** Any destructive tool defaults to printing its plan; the
  apply flag is a decision someone makes, not the path of least resistance. The
  dry run *is* the quarantine of the whole candidate set — the plan is inspectable,
  and the wrong candidate is caught by reading, at zero risk.
- **Declared keep-lists.** Known dynamic-lookup subtrees are declared to the
  instrument as live-regardless, with the reason naming the dynamic surface. This
  is quarantine at the class level: the instrument still runs over the tree, still
  reports what it would have found, and the declaration is auditable — a keep-list
  entry is a suppression and inherits every hygiene rule, including its reaper.
- **Tripwires.** Genuinely uncertain code stays in place with a marker that
  records reachability — a log line, a counter, a telemetry breadcrumb — so that
  after an observation window the question "did anything call this?" has data.
  This is the strongest form and the only honest one for the dynamic-dispatch
  class: static analysis said "cannot know," and the tripwire converts *cannot
  know* into *observed for N days, zero hits*
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success) — a
  tripwire that could not fire and a tripwire that never fired must be told
  apart, so the tripwire reports its own liveness too).

## Quarantine names its reaper

Quarantine without expiry is the new dead code — worse, because it wears a label
that reads as *managed*. Every quarantine decision names its reaper at creation
([creation-names-reaper](../../_laws.md#creation-names-reaper)): the observation
window after which recorded silence *authorizes* the delete, or the condition
under which the candidate is promoted back to live. Unexpired quarantine is a
decision pending. Expired, unreaped quarantine is a decision abandoned, and the
audit that catches it is the same one that catches stale suppressions: walk the
quarantine roster, flag every entry past its window, and treat "the window passed
and nobody looked" as a finding against the process, not just against the code.

## Deletion-is-not-repair cuts both ways

The law is usually cited to stop the deletion of a *failing* artifact — the flaky
test, the noisy check — that exposes a defect. Here it also stops the opposite
error: **quarantining a verified corpse to avoid the deletion decision** is repair
withheld. Code that the protocol has proven unreachable, with an empty transitive
closure and no dynamic surface nearby, does not earn quarantine; leaving it "to be
safe" is not caution but cost, and a quarantine roster padded with verified-dead
entries devalues the label for the candidates that actually need it. Quarantine
is the honest response to *uncertainty* — and uncertainty must be stated, not
assumed, because the alternative is a repo where nothing is ever deleted and every
corpse is filed as "pending"
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)).
