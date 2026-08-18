---
layer: technique
subject: sync-replication
technique: conflict-detection-and-policy
status: forged
laws: [failure-not-empty-success, one-authority-per-vocabulary]
shared_with: []
---

# Conflict detection and policy

A conflict is two copies of one record carrying different content with
neither derived from the other. Everything in this technique follows
from splitting the problem in half and refusing to let the halves blur:
**detection** establishes what actually happened to the copies;
**policy** decides what to do about it. Systems that fuse them — "newest
timestamp wins" doing both jobs in one comparison — destroy data
precisely because they never found out what happened before deciding.

## Detection: compare content, not clocks

Timestamps from two devices are two opinions from two unsynchronized
clocks; they order nothing reliably and detect nothing at all (a copy
re-saved without change has a new timestamp and identical content). The
primitive is the **content hash**: cheap to store beside each copy,
cheap to compare, and it answers the first question exactly — *are these
copies the same?* Equal hashes end the analysis regardless of what any
clock claims.

Unequal hashes pose the second question: *which kind of different?* This
needs a third point of reference — the **last common state**, the
version both sides agree preceded their edits (kept as a base copy, a
base hash, or a position in shared history). The three-way compare
resolves the ambiguity two-way comparison cannot:

- local differs from base, remote equals base → local advanced; push.
- remote differs from base, local equals base → remote advanced; pull.
- both differ from base, local equals remote → **converged**: both sides
  made the same edit. Not a conflict — adopt the shared content, update
  the base, no lane, no alarm.
- both differ from base and from each other → **divergence**: a true
  conflict. Only now does policy apply.

Convergence deserves emphasis because implementations that skip the
local-equals-remote check flag it as conflict, and false conflicts are
not merely noise — they train humans that the conflict lane cries wolf,
which is how the real divergence six weeks later gets clicked through.
The four outcomes are a closed vocabulary; every consumer of the
comparison — the sync loop, the status surface, the audit log — names
which one occurred
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)),
and "resolved" is never spelled the same as "no conflict existed"
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):
one of the two destroyed a candidate version, and the record must say
so.

## Policy: every rule has a scope

A resolution policy is legitimate only within the scope where its
assumption holds. Stating the policy without its scope is how the wrong
one metastasizes:

- **Last-writer-wins** assumes the writers are *one mind*. Same user,
  several devices: the later edit supersedes the earlier because the
  same person made both, and the loser is a draft they already moved
  past. Applied across *users*, LWW is silent destruction of a
  colleague's work with a timestamp for an alibi — the assumption "the
  later writer knew about the earlier write" is exactly what concurrent
  editing violates. And even in scope, LWW is only a policy when it is
  a **deterministic total function over the data**: later modification
  instant, ties broken by a stable replica identity, so that both sides
  run the same inputs through the same function and agree on the winner
  without coordination. The degenerate form — whichever write reached
  the shared store last stands, with no comparison and no read-back —
  is not last-writer-wins; it is last-*arrival*-wins, a race whose
  outcome depends on network timing, whose loser is never told it lost,
  and which is written down nowhere. If arrival order is genuinely the
  intended rule, declare it; a policy that exists only by omission is
  indistinguishable from a bug that hasn't been reported yet.
- **Authority-wins** (the hub's version stands, spokes rebase) is
  legitimate where a hub topology already made the hub the arbiter of
  order; it degrades to might-makes-right if the "authority" is just
  whichever side ran the loop.
- **Field-partitioned merge** — different fields owned by different
  sides, merged structurally — is conflict avoidance by construction and
  the cheapest honest answer where the data permits disjoint ownership.
- **Human merge** is the residual lane for divergence that no automatic
  rule can resolve without discarding someone's intent.

The policy is declared **per stream, in the topology table**, chosen
when the stream is designed — a policy chosen at incident time is chosen
under pressure to make the incident disappear, which is how "delete the
older one" becomes precedent.

## The human lane: park, preserve, present

When divergence exceeds policy, the system's job narrows to three verbs.
**Park** the conflict as a first-class record — the stream keeps flowing
around it; one contested record must not dam its siblings. **Preserve**
both versions in full — the cardinal sin of the lane is presenting a
choice after already discarding one option; until a human rules, the
system holds both, and the loser of the eventual ruling remains
recoverable for as long as the audit posture requires. **Present** the
disagreement with what a ruling needs: both contents, the base if known,
attribution and time of each side, and a diff at the granularity humans
edit at. A parked conflict is also a *pending liability with an owner
and an age* — surfaced, assigned, and aged in the observability surface,
because a conflict parked silently for a year is both sides stale.

## Deletes conflict too

A delete concurrent with an edit is a conflict between a tombstone and a
new version, and it goes through the same detection and the same
declared policy — never resolved implicitly by whichever operation
happened to apply last. "Delete wins, edit is preserved in the conflict
record" and "edit revives, deletion is noted" are both defensible; the
indefensible option is deciding by arrival order. The tombstone
machinery that makes the delete visible to this comparison at all is
[tombstone-propagation](tombstone-propagation.md).
