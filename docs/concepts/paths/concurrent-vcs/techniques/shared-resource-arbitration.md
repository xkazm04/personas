---
layer: technique
subject: concurrent-vcs
technique: shared-resource-arbitration
status: forged
laws: [identity-survives-reuse, failure-not-empty-success]
shared_with: []
---

# Shared-resource arbitration

The checkout's tree and index are the headline contention, but sessions
sharing one machine contend for more: scratch directories, build and
artifact caches, dependency-install directories, network ports, temporary
message files. Each has the same three-option decision — **namespace it,
arbitrate it, or detect-and-wait** — and choosing the wrong option for a
resource's shape is how "coordination" becomes either corruption or
deadlock.

## Namespace what can be namespaced

The cheapest arbitration is none: give each session its own copy by
construction.

- **Scratch files carry session-unique names.** The measured incident:
  two sessions wrote their commit message to the same generic scratch
  filename, and one overwrote the other between write and use — the losing
  session committed with the winner's message. A generic name is an
  identity that does not survive reuse
  ([identity survives reuse](../../_laws.md#identity-survives-reuse));
  derive scratch names from a session identifier, or pass the content
  inline and skip the file entirely.
- **Per-session scratch directories** beat per-session filename prefixes —
  cleanup becomes "delete my directory," which cannot delete a sibling's
  scratch.
- **Worktrees are this same move applied to the checkout itself** — the
  general principle is: when a resource can be cheaply duplicated,
  duplication is strictly better than any locking protocol, because there
  is nothing to leak, stale, or deadlock.

## Arbitrate what cannot be duplicated

Some resources are genuinely singular: a port number, a build cache whose
tool assumes single-writer access, a device, an installer that must run
once. For these:

- **Prefer arbitration the resource's own tooling provides** (a build
  tool's own lock, an allocator that hands out free ports) over home-made
  lock files.
- **When you must gate by hand, the lock names its owner and its
  staleness rule** — which session, since when, and after how long a
  reader may presume the owner dead. A bare lock file is a promise with no
  expiry: its owner crashes and every honest session queues behind a
  ghost. This is the intent ledger's staleness lesson in miniature, and
  the same design answers it.
- **Serialize at the narrowest point.** If only the final write is
  contended, only the final write is gated; sessions do everything else in
  parallel and queue for the one singular step.
- **Put the guard between the intent and the command**, not in a
  convention document. The measured version: two sessions launched the
  same core-saturating build suite concurrently and the machine became
  unusable — not because no rule existed, but because *nothing stood
  between the intent and the command*. A guard that intercepts the
  invocation itself fires regardless of which script or session issues it.
- **Decide the guard's failure direction explicitly, and make degradation
  loud.** A guard whose false *block* is worse than its false *allow* (a
  developer who cannot run anything at all, versus a survivable resource
  spike) fails open — but it must say so when it does: when its instrument
  breaks, it prints that it is degraded and allowing unchecked, never
  silently passing. An empty observation is not "nothing is running"; it
  may be "the guard never looked", and those must be spelled differently
  ([failure ≠ empty
  success](../../_laws.md#failure-not-empty-success)).

## Detect activity, not artifacts

The subtlest failures come from sessions inferring a sibling's state from
*artifacts* — a lock file, a directory's existence, a half-populated
install — instead of *activity*. Artifacts outlive their creators; activity
does not.

- A missing or half-populated dependency directory does **not** mean "a
  sibling is installing; wait." It may mean an install crashed an hour
  ago. Before waiting on a presumed concurrent operation, look for a real
  activity signal — a process, fresh file modification times, growing
  sizes. Absent evidence of progress, **surface a stall to the operator
  rather than polling indefinitely**: a session silently waiting on a
  ghost is spelled exactly like a session working, and that spelling is
  the lie ([failure must be spelled differently from empty
  success](../../_laws.md#failure-not-empty-success)).
- Ports are activity-checkable directly: the question is never "should
  this port be free" but "what process holds it" — then a deliberate
  decision to reclaim or relocate, not a blind retry loop.
- The same logic gates destructive cleanup: a sweep that treats an
  artifact's existence as abandonment destroys live work; the
  worktree-collection rule (clean *and* merged *and* stale) is the
  template — multiple independent signals, each cheap, conjoined before
  anything is destroyed.

## Population checks over assumptions

Before using a shared cache or installed state, verify it is *actually
populated for your need* — the file you need exists and is non-empty, the
version matches — rather than trusting that its directory exists. A
sibling's partial population passes the existence check and fails the use;
the population check moves the failure to the cheap moment, before work is
built on the assumption.
