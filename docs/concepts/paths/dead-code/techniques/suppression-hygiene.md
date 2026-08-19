---
layer: technique
subject: dead-code
technique: suppression-hygiene
status: forged
laws:
  - creation-names-reaper
  - deletion-is-not-repair
  - failure-not-empty-success
---

# Suppression hygiene

Every instrument that reports findings grows a suppression surface: ignore globs,
exclude lists, allowlists, keep-prefixes, inline pragmas. Suppression is necessary —
an instrument with no escape hatch gets deleted the first time it blocks something
it misunderstands — and it is also dead code's favorite disguise, because a
suppression entry is the one artifact whose *job* is to make an instrument report
nothing. Undisciplined suppression converts an instrument into a decoration one
entry at a time, with every step individually reasonable.

## Reasons are mandatory, with enforced substance

Every suppression entry carries a reason, and the instrument *enforces* the
requirement mechanically — including a minimum substance bar, because "temp" and
"TODO" satisfy a presence check while explaining nothing. An unexplained exemption
is how suppression becomes policy: the next person extends the pattern ("there are
already six entries like this"), and within a year the exclude list is a shadow
configuration nobody can audit because nobody recorded what any entry was for. The
reason is written for the person deciding whether to *remove* the entry — it names
the condition that made the exemption necessary, so its lapse is checkable.

## A stale suppression fails the run

The load-bearing rule, and the one most tools get backwards: **a suppression that
matches nothing is a failure, not a harmless leftover.** When the excluded file is
deleted or renamed, the exemption points at nothing — and a tolerant instrument
carries it forever. That entry is dead code *inside the instrument built to find
dead code*, and it rots in the worst available direction: a glob-shaped exemption
that outlived its target will eventually re-match something new, silently exempting
code its author never saw. Failing on the stale entry converts the rot into a
ten-second fix at the moment the context still exists
([failure-not-empty-success](../../_laws.md#failure-not-empty-success) — an
exemption that exempts nothing and an exemption doing its job must be
distinguishable, and only the instrument can tell them apart).

## Every entry names its reaper

A suppression is created for a reason that will someday lapse — the migration will
finish, the vendor tree will be replaced, the dynamic-dispatch surface will get
typed. So every entry names its reaper at creation
([creation-names-reaper](../../_laws.md#creation-names-reaper)): an expiry date, a
re-review cadence, or the checkable condition under which it lapses. Stale-match
failure reaps entries whose *target* died; the reaper clause covers the other rot
axis — entries whose target survives but whose *justification* died. Without it,
the list only ever grows, and a growing suppression list is the instrument's
coverage shrinking on a schedule nobody approved.

## The ignore roster is a published blind-spot inventory

The healthiest suppression surface is not a confession of weakness but a coverage
map: each ignore entry declares **which orphan class it hides and which other
instrument covers that class**. Ignoring the generated-artifact tree in the
unused-export scanner is correct *if and only if* the reconciliation instrument
owns that tree — and the entry should say so, turning "ignored" into "delegated."
The audit this enables is the valuable one: walk the roster, and any entry that
delegates to an instrument that does not exist marks a class with **no coverage at
all** — invisible precisely because every individual tool shows green. Suppression
without delegation notes divides coverage between instruments with a gap in the
middle, and the gap is where the orphans live.

## Suppressing to quiet versus suppressing to delegate

Two suppressions can be textually identical and morally opposite. Suppressing
because another instrument owns the class, because the finding is a measured false
positive, or because a quarantine decision is pending — with the reason recorded —
is hygiene. Suppressing because the finding is *annoying*, the fix is unscheduled,
or the report should look better is
[deletion-is-not-repair](../../_laws.md#deletion-is-not-repair) in its most common
costume: the defect stays, and the one place that displayed it goes dark. The
mechanical tells are the reason field (the quiet-motivated entry cannot state a
condition that will lapse) and the reaper clause (it cannot name one). A
suppression surface where both are enforced makes the dishonest entry harder to
write than the honest one — which is the correct direction for the friction to
point.
