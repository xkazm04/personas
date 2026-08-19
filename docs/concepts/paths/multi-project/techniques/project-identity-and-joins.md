---
layer: technique
subject: multi-project
technique: project-identity-and-joins
status: forged
laws: [identity-survives-reuse, one-validation-door, gate-sees-target]
shared_with: []
---

# Project identity and joins

Every other technique in this subject assumes one thing: that "this project"
means the same durable entity to the tab bar, the score table, the signal
digest, the notes, and the work roster — across renames, moves, re-clones,
and months of history. That assumption is manufactured, not free. This
technique is where it is manufactured.

## Mint at admission, join forever

A project's identity is **minted at the admission door** — opaque, unique,
never reused, never derived from any observable property of the project
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). The
candidates that feel natural are all traps, and each fails under a specific,
routine operation:

- **Name** — fails under rename and under collision. Two clients each have a
  project called "platform"; one rebrand later, a name-keyed history describes
  a ghost while the renamed project starts from zero.
- **Filesystem path** — fails under moves, second machines, and re-clones.
  The same project at two paths is one project; two projects that
  successively occupy one path are not.
- **Remote address** — the strongest impostor, because it looks stable. It
  fails under organization transfers, mirror setups, and protocol changes of
  the same remote; and forks share ancestry without sharing identity.
- **Row position, admission order, timestamps** — fail under re-admission
  and restore, the standard index-as-identity defect.

All four become **fields** of the registry entry: the display name, the
current binding to disk, the remote fingerprints, the admission date. Fields
are re-bindable — a rename edits the name field and touches nothing else.
Only the minted key joins.

## The join discipline

The rule is absolute because the exceptions are where it dies: **every
artifact the manager keeps about a project carries the project's minted key,
and every read that combines two artifacts joins on it.** Scores to signals,
tabs to registry rows, notes to score history, dispatch rosters to projects.
The tempting shortcut — joining a metric row to a project by matching the
name a scanner happened to print — works in every demo and fails in
production the first time a name drifts, and it fails *silently*: the join
returns fewer rows, not an error, and the surface downstream renders a
smaller, plausible, wrong picture. A name-keyed join is a defect even while
it still returns correct results, the same way an unlocked door is a defect
before anything is stolen.

Two aggravations, both measured in the field rather than hypothesized.
**Machine-generated inventories produce near-identical names by
construction** — an automated scan that splits one area into parts labels
them with the same base string plus a suffix, and every rescan may relabel
— so within generated metadata, name collisions are not an edge case but
the steady state, and every regeneration is a mass rename. And **the blast
radius reaches verdicts, not just displays**: a scope footprint that
resolves its members by name quietly drops the renamed ones, and a
go/no-go decision computed over that footprint reads *go* because part of
its own scope vanished from under it. The rule is cheapest stated
absolutely because the exceptions are unpoliceable: resolve by key, always,
and let the same one helper do it for every surface that needs it.

Two practices keep the discipline checkable:

- **Producers stamp at the source.** Whatever writes an artifact — a scan, a
  score run, a signal batch — receives the project key as input and writes
  it into every row. Reconstructing the key later ("which project was this
  file about?") by matching strings is the name-join defect re-entering
  through the back door.
- **Display names appear at the last render step only.** Any name found in
  storage, in an intermediate structure, or in a message payload doing
  identifying work is a smell the review can grep for.

## The three tests

An implementation claims this technique when it survives three concrete
operations with all relationships intact — worth automating as fixtures, not
just asserting in review:

1. **Rename** — change the display name; every score, signal, note, and tab
   still belongs to the project.
2. **Re-path** — move the working copy (or open the portfolio on a second
   machine); the entity persists, only the binding field changes.
3. **Re-clone** — delete the working copy and clone it fresh to a new
   location; re-binding attaches the *existing* entity, and does not mint an
   amnesiac twin. This is the test that catches path-derived identity, and
   the one most implementations fail first.

## Admission is where duplicates are caught

Because identity is minted, minting twice for one real-world project is the
technique's own failure mode, and the admission door is the one place it can
be prevented ([one validation door](../../_laws.md#one-validation-door)).
Admission fingerprints the candidate — remote addresses, root ancestry,
content markers — and compares against the registry. A probable match
**surfaces a choice** (same project at a new location → re-bind; genuinely
new → mint) rather than deciding silently in either direction: auto-merging
two distinct projects corrupts both records; auto-minting a duplicate splits
one history in half. The fingerprints are evidence for a human-grade
decision, not a join key — remotes are a field, per the list above.

## Foreign identity is quarantined

Other tools export inventories, and their entries carry their *own* ids,
minted in someone else's namespace, on someone else's schedule, possibly
describing a different granularity of "project" entirely. The rule: **a
foreign id never appears in a local join.** If a foreign artifact must be
correlated, map it once at the ingestion boundary — foreign id → local
minted key, stored as an explicit mapping with a provenance note — and let
everything downstream use the local key. Trusting a foreign snapshot's ids
(or its counts — the sibling defect) means joining against a world snapshot
that nothing local keeps true
([the gate must see its target](../../_laws.md#gate-sees-target)). When the
mapping cannot be established, the artifact stays visibly unmapped; a guessed
mapping is worse than none, because every surface downstream inherits the
guess with none of the doubt.
