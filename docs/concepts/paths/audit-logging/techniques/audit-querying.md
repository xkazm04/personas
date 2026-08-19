---
layer: technique
subject: audit-logging
technique: audit-querying
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Audit querying

An audit trail is consulted rarely, urgently, and by people who did not
build it — an auditor with a compliance question, an operator mid-
incident, a user disputing what happened to their data. The read model
is therefore part of the ledger's contract, designed with the same
seriousness as the write path: **a trail that can only be interrogated
by the engineers who wrote it has an audience of exactly the people an
audit exists to check.** "The data is in there" satisfies no auditor;
"here is the screen, filter by actor and date" does.

## The four axes, and what they demand of the schema

Every real question against a trail decomposes onto four filters —
**actor** (what did X do), **action** (all deletions, all exports),
**subject** (who touched this record), and **time window** — usually two
or three combined: *which actors exported data from this project last
quarter*. This is the requirement that flows backward into the record
schema (see the write side: the door demands these fields precisely so
the read side can filter on them), and it dictates that the four axes
are **structured columns, indexed**, never facts buried inside a payload
blob that only substring search can reach. Substring search over
payloads is how "query the trail" degrades into "grep and hope," and
hope is not a compliance posture. Outcome joins the four as a fifth
filter wherever the domain records failures and denials — "show me
failed attempts" is the security reviewer's first query.

Two harder questions earn schema support in domains that face them:
**correlation** (everything, across ledgers, belonging to one request or
one incident — served by the correlation handle every record carries)
and **delegation** (everything done *under* a given grant, however many
automations exercised it — served by recording the grant alongside the
acting automation, decided at write time; no read model can reconstruct
an attribution the record never captured).

## Meet the reader where the subject lives

The trail's primary surface is **in context**: the history of a
credential reachable from that credential's own screen, the history of a
record from the record. In-context history answers the reader's actual
question ("what happened to *this*?") in one step, pre-filtered, with no
query language — and it is what makes the trail *used*, which matters
because a trail nobody reads accumulates schema drift and silent
breakage until the day it is urgently needed and found wanting. The
global cross-ledger view (all activity, all subjects, filterable on the
axes) is the second surface, for the reviewer whose question starts from
an actor or a time window rather than a subject. Build the in-context
surface first; it is the one with daily traffic, and daily traffic is
what keeps a read model honest.

Presentation carries obligations of its own, and one rule governs them
all: **the view renders only what the record contains.** The moment a
surface *computes* an audit fact — who, when, whether it was automatic —
from something other than the field that records it (a regex over a
free-text notes column, a heuristic over a message), the view has become
a second, unversioned writer whose output nobody reviews and whose
failures are silent by construction; when the writer's phrasing drifts,
the inference misses everything and looks like nothing. If a fact
matters, it is a structured field the write path records; the read model
never back-derives it. The same rule covers names: rendering never
replaces what write time recorded (a display that "helpfully" maps an
actor identifier to the actor's *current* name is quietly rewriting
history — name changes make the trail contradict its own exports).
Render the stored fact; annotate with current context if useful, but
visibly as annotation. And an actor the record lacks renders as an
explicit null value ("unattributed", "system"), never as a vanished
element — absence of pixels and absence of attribution must not look
the same.

## Export is part of the contract

Audits end with evidence leaving the system — a file handed to an
external reviewer, a range submitted in a dispute. Export is therefore a
feature of the read model, not a favor from an engineer with database
access: filtered range in, machine-readable file out, columns matching
the stored schema. Two disciplines attach. The export states its
predicate — what filters, what window, generated when
([count-carries-predicate](../../_laws.md#count-carries-predicate)
applied to a file: an export that cannot say what it contains will be
cited for claims it does not support). And the export path runs through
the same sanitized read model as the screens — a raw-storage dump
"just this once" bypasses every protection the write path built,
and the exceptional export is exactly the one that leaves the building.

## Reading the trail is itself an auditable act

The read model gets its own access control, decided per ledger: the
security ledger's readers are not the operational ledger's readers, and
"whoever can open the app" is a decision (defensible for a single-
operator tool, indefensible for a team product), not a default nobody
made. And for ledgers whose contents are sensitive — the trail records
who touched what, which is itself behavioral data about people — access
to the trail is recorded in the trail: a read-access record, same
schema, same door. This sounds recursive and is simply complete: the
question "who has been reading the audit history?" is a question an
investigation eventually asks, and the ledger should answer it the same
way it answers everything else.

## The empty result must be distinguishable from the broken query

A reviewer who filters a window and sees nothing needs to know which of
three things is true: nothing happened, the recorder was down (the known
gaps counter and gap markers from
[best-effort-with-accounting](best-effort-with-accounting.md) answer
this — surface them *on the query result*, not only on the health
dashboard), or the window predates the ledger's horizon (the retention
policy from
[retention-and-partitioning](retention-and-partitioning.md) is displayed
at the query surface: "records before date D have been retired by
policy"). An empty list with no provenance invites the reader to
conclude "nothing happened" — the one conclusion the read model must
never let them reach unexamined.

The non-empty result carries the twin obligation: **a capped, filtered,
or trimmed listing says so on the surface.** "Newest 50" and "all of
them" are different claims, and a reviewer deciding that an event did
not occur needs to know which one they are looking at — a count label
that quietly describes the page rather than the population converts a
display limit into a false negative
([count-carries-predicate](../../_laws.md#count-carries-predicate) at
the pixel: the rendered number states what it counts).
