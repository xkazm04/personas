---
layer: technique
subject: sync-replication
technique: topology-declaration
status: forged
laws: [one-authority-per-vocabulary, gate-sees-target]
shared_with: []
---

# Topology declaration

Before any code, a sync design answers one question in writing: **for each
replicated stream, which way does data flow, and who is the authority when
copies disagree?** The answer is a declaration — a table the machinery
enforces — not a vibe the code mostly honors. Every corruption class in
this subject traces to a topology that was implemented differently than it
was believed: a mirror that quietly accepts local writes, a merge that
assumes one side is "usually right", a stream that flows both ways but was
only ever tested in one.

## The three shapes and their physics

**One-way mirror.** Source projects into a replica; the replica never
writes back. Conflict is *defined away* — and that definition is a
promise the system must enforce, because the failure mode is not "a
conflict appears" but "a local edit silently exists until the next mirror
pass flattens it". Enforcement means the replica's write paths for
mirrored streams are structurally absent or rejected, not merely
undocumented. The mirror's other obligation: it must be **total within
its projection** — a mirror that skips rows it finds inconvenient is not
a mirror, it is an editorial process nobody reviews.

**Hub and spoke.** N replicas converge through one authority that orders
all writes. Conflicts exist — two spokes edited the same record between
round trips — but adjudication happens in one place, against one
sequence, with one clock worth trusting. The hub's ordering *is* the
authority: spokes submit, the hub decides, spokes converge on the hub's
answer. The demand this shape makes of records: every write a spoke
submits carries what the spoke *believed* was current (a version, a base
hash), so the hub can tell an update from a stale overwrite.

**Peer merge.** Replicas exchange changes with no distinguished
authority. Concurrent edits are structural, not exceptional, so every
record must carry enough to detect them — a version vector, a lineage, or
at minimum a content identity plus a policy that admits what it loses.
This is the most expensive shape; choose it only when disconnected
operation on multiple writable copies is a genuine requirement, not a
flattering one.

## Direction is per stream

A real system carries different streams in different shapes at once:
reference data mirrors down, user work pushes up, a shared workspace
merges. The declaration is therefore a **per-stream table** —
(stream, direction, authority, conflict policy, projection) — and the
sync engine is generic over it, iterating declared streams rather than
hard-coding each one. Two payoffs: adding a stream is a declaration
change the whole pipeline picks up (cursoring, observability, backfill
come free), and the table *is* the audit artifact — the answer to "what
leaves this machine, and who wins on disagreement" is readable in one
place ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary):
the stream set is a closed vocabulary with one definition, and the
engine, the status surface, and the security review all derive from it).

## The undeclared two-way stream

The signature rot: a stream declared one-way grows a write path on the
wrong side — a migration backfills the replica, a feature edits the
mirrored copy "just this field", an import lands on the downstream. Now
the system is running a two-way sync with the conflict machinery of a
one-way one, which is to say none; the next pass from the authority
overwrites the interloping write, and nothing logs that it happened,
because the topology says it cannot happen. The gate for this cannot be
belief — it must observe the thing it gates
([gate-sees-target](../../_laws.md#gate-sees-target)): either the
replica's schema physically lacks write affordances for mirrored streams,
or the sync pass detects local drift (the replica's content differs from
what the cursor history says was delivered) and reports it as an
incident instead of silently repaving.

## Promotion is a redesign, not a flag flip

Topologies get promoted — the mirror everyone reads eventually breeds a
request to edit "just one field" downstream. Honor the request by
redesigning the stream, not by tolerating the write: either carve the
editable fields into their own upstream stream (two one-way streams in
opposite directions over disjoint projections — still conflict-free, by
construction), or promote the stream to merge and pay merge's full cost
(versioning on every record, a declared policy, a conflict lane). The
disciplined question at the boundary: *can the two directions be made to
touch disjoint fields?* If yes, the cheap shape survives. If no, the
stream is a merge stream and pretending otherwise only defers the
corruption to the first concurrent edit.
