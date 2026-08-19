---
layer: technique
subject: wizard-flows
technique: snapshot-and-resume
status: forged
laws: [identity-survives-reuse, creation-names-reaper, failure-not-empty-success]
shared_with: []
---

# Snapshot and resume

A wizard's weight — the very thing that justifies its existence — guarantees
it will be interrupted. Users park high-stakes decisions; applications
restart; sessions expire. The design question is never *whether* the flow
survives interruption but *which* interruptions it survives, and the honest
answer must be written down: navigation-away, application restart, device
change, and days of delay are all normal, and each one either resumes or
loses the user's work. "Start over" is a data-loss bug with a euphemism.

One boundary first, because over-persisting is a real failure too: **the
tier of durability follows the side effects, not the step count.** A flow
that creates nothing until its final commit — every answer cheap to
re-enter, no work launched, no money spent — may legitimately keep its
whole model in memory and die on close; that is the honest zero tier, and
bolting snapshot machinery onto it adds surface that rots unused. The
snapshot obligation begins exactly where a step first makes something real
or collects something expensive. What is never legitimate is the split: a
durable side effect with an ephemeral pointer, so the effect outlives the
flow's memory of where it stood. Pointer and effects live and die
together, whichever tier that is.

## The snapshot

At meaningful boundaries — step transitions at minimum, significant answers
ideally — the state model is serialized into a **snapshot** carrying:

- **The flow instance's identity**, minted when the flow started
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). Not
  "the latest draft of this kind" — identity. Two drafts of the same kind
  (the user started over deliberately, or two contexts each opened one) are
  two instances; resume-by-latest silently merges or clobbers them.
- **The answers and position** — the model, not the screens. A snapshot
  that serializes rendered state resurrects presentation garbage; one that
  serializes the model resurrects a flow.
- **A schema version stamp.** Flows outlive releases; the step registry
  changes between when the snapshot was written and when it is read.
- **Identities of in-flight work** the flow started elsewhere (below).

What the snapshot must *not* require: the process that wrote it. Resume is
cold-start by definition — it reads the record and rebuilds the model, with
no dependence on live memory, a surviving session, or the conversation that
produced the answers.

## Resume is an offer, never an ambush

On return, a found snapshot is **offered**: what it is, when it was last
touched, resume or discard. Silent restoration is wrong in both directions —
restoring a three-week-old half-draft under a user who came to start fresh
is as hostile as discarding yesterday's work under one who came to finish
it. The offer costs one interaction and is the only version that respects
both users.

Three read outcomes, spelled differently
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)):

- **No snapshot** → fresh start, no ceremony.
- **Snapshot present and readable** → the offer.
- **Snapshot present but unreadable or version-incompatible** → say so.
  Either migrate it (version skew with a written migration is routine) or
  tell the user a draft existed and could not be recovered. The one
  forbidden rendering is the quiet fresh start that is indistinguishable
  from "no snapshot" — that converts a recoverable defect into a user who
  believes the product ate their work and cannot even prove it.

After resume, re-validate rather than trust: the world moved while the
draft slept. Referenced entities may be gone, options may have changed,
prices may differ. Stale references surface as step-level invalidity with
an explanation — the flow re-opens at the first step that no longer holds,
not at a later step built on sand.

## Re-attach to in-flight work, don't re-run it

When a step launched long-running work in another part of the system, the
snapshot stores that **work's identity**, and resume *re-attaches*: query
the work's current state by identity and reconcile — still running (show
progress), finished (consume the result), failed (surface the failure at
its step). The alternative — resume re-triggers the step's effect — bills
the user twice for the system's most expensive operations and, for
non-idempotent work, corrupts on top of wasting.

This is also the tier-selection criterion for *where* the flow state lives:

- **Local draft persistence** suffices when the flow is pure data entry —
  cheap, per-device, private.
- **System-of-record persistence** is mandatory once the flow has effects
  in flight or must survive device change: the pause itself becomes a
  durable server-side state, and any client can pick it up. A flow that
  pauses waiting for another party's answer is this case by definition —
  the continuation discipline is
  [resume-after-decision](../../hitl-approval/techniques/resume-after-decision.md)'s.

Choosing the local tier for a flow with server-side effects creates the
orphan pattern: the client forgets, the server-side work completes into a
void, and the resource it produced has no owner.

## Snapshots name their reaper

A snapshot is created state, and it names what destroys it
([creation-names-reaper](../../_laws.md#creation-names-reaper)):

- **Commit** deletes it — the flow ended; a surviving snapshot re-offers a
  draft of something that already exists.
- **Explicit discard** deletes it — the user's "start over" means it.
- **Expiry** deletes it on a named schedule, because a draft's value decays
  and its liabilities (stale references, superseded prices, obsolete
  schema) grow. The expiry window is a product decision made once, stated
  where the snapshot is defined — not an accident of whichever cleanup job
  someone eventually writes.

An expired-and-reaped snapshot is the "no snapshot" outcome; an expiry
policy that leaves corpses which then fail the readability check has just
moved the mess, not cleaned it.
