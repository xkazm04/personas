---
layer: technique
subject: concurrent-vcs
technique: intent-ledgers
status: forged
laws: [creation-names-reaper, failure-not-empty-success]
shared_with: []
---

# Intent ledgers

A shared checkout with autonomous sessions needs a place where "who is
working on what right now" is written down. The intent ledger is that place:
one version-tracked document (or table) in the repository itself, holding an
**active** section and a **recently completed** section, that every session
which will materially edit the tree touches twice — once at start, once at
end. It is deliberately the least clever mechanism in the subject: a ledger
coordinates *intent*, and intent coordination must be cheap enough that
skipping it is never rationalized.

## The entry

An active entry carries, minimally:

- **Who** — a session identifier distinct enough to tell parallel sessions
  apart (tool, purpose, start time).
- **What** — one line of task intent, so a human or sibling reading the
  ledger can judge overlap semantically, not just by path.
- **Where** — the declared path scope: directories or files the session
  expects to touch. Declare at the coarsest honest granularity; a scope
  declared too narrowly is a false all-clear for the sibling that checks it.
- **When** — a start timestamp, because staleness rules (below) run on it.
- **Status** — started, and later a terminal outcome.

A completed entry adds the outcome: the landed commit's identifier, or an
explicit *aborted (reason)*, or a pointer to a handoff. The outcome field is
where the ledger obeys
[failure-not-empty-success](../../_laws.md#failure-not-empty-success): a
session that vanished and a session that finished cleanly must not be
spelled the same, and an entry with no outcome *is* the spelling of
"vanished."

## The ritual

**At session start**, before the first material edit:

1. Read the active section.
2. For every live entry whose declared scope overlaps your planned scope,
   apply the staleness rule (below). Fresh overlap → surface the conflict to
   the operator *before proceeding* — the whole value of the ledger is
   spent in this one moment; a session that registers without reading has
   kept the cost and discarded the benefit.
3. Append your own entry to the active section.

**At session end**, as part of the finish ritual, not as an afterthought:
move your entry to the top of the completed section with the outcome filled
in. The entry you created names you as its reaper
([creation names its reaper](../../_laws.md#creation-names-reaper)); no
sweep will do this for you with the outcome intact.

## Staleness: the rule that keeps an advisory ledger usable

Sessions crash. A ledger with no staleness rule fills with phantom active
entries, and sessions learn to ignore it — the death of any advisory
mechanism is the first time ignoring it is correct. So the ledger's header
states a staleness window: an active entry older than the window, still in
*started* status, is treated as *probably dead* — overlap with it is noted,
not blocking. The window is a tradeoff between long-running legitimate
sessions and how long a crashed session may cast a false shadow; what
matters more than the value is that the rule is written in the ledger
itself, so every reader applies the same one.

The staleness rule has a failure mode of its own, and it was measured:
**when deregistration decays fleet-wide, every entry goes stale, and the
conflict check becomes vacuously green** — it reports "no live conflict" for
every path without consulting anything, because its freshness conjunct is
false for the entire file. Read an empty conflict scan honestly: it means
*no information*, not *no conflict*, and a ledger whose newest active entry
is older than the staleness window is telling you the ritual has stopped,
which is itself the finding.

## Advisory by design — and why that is not a defect

The ledger stops nothing. It cannot: enforcement would require every write
path into the tree to check it, and the session population includes agents
that never read the protocol. The design accepts this and pairs the ledger
with the layers that do not depend on cooperation — physical isolation makes
interleaved edits impossible where it is used, and commit verification
detects what neither layer prevented. Treat any proposal to "harden" the
ledger into a lock with suspicion: locks held by crashed sessions block
honest ones, and the ledger's staleness rule is exactly the arbitration a
lock lacks. The ledger's job is to make conflicts *visible early and
cheaply*, and visibility is a job worth doing badly rather than not at all.

## Edit contention on the ledger itself

The ledger is a shared file in the same contended tree, so writes to it
collide like any others. Keep entries append-oriented (new entries at a
known position, moves rather than rewrites), retry on conflict by re-reading
and re-applying, and never let a ledger-edit conflict abort the session's
real work — the ledger serves the work, not the reverse.

Two structural constraints on the file, both learned from a ledger that
violated them:

- **The append anchor must be unique.** Editing tools that locate their
  insertion point by matching a heading fail *permanently* — not
  transiently — the moment the file contains that heading twice, and
  "retry" can never succeed against a structural ambiguity. One active
  section, one completed section, and any maintenance pass that duplicates
  a heading has broken every session's registration until it is repaired.
- **When the ledger itself becomes the contention hotspot, change its
  shape, not its etiquette.** One entry per session in its own file under
  a ledger directory, reconciled by listing, removes the shared-file race
  entirely — the same isolate-then-reconcile move this whole subject keeps
  converging on. A single-file ledger is the right *starting* shape
  because it is trivially readable; outgrowing it is a success signal, not
  a failure.
