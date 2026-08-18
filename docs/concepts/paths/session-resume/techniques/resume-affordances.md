---
layer: technique
subject: session-resume
technique: resume-affordances
status: forged
laws: []
shared_with: []
---

# Resume affordances

The resume system knows where the user was. It does not know why they
left, how long ago "was" feels to them, or what they came back to do —
and the interaction design must carry that epistemic humility. The core
rule: **shallow restoration is automatic; deep restoration is an offer.**
A banner that says "you were editing X — continue?" respects both the
user who wants to resume and the one who came back for something else.
Teleporting the user into last session's deep context ambushes the second
user, and the deeper the teleport — a modal reopened, a wizard
mid-flight, a draft in their face — the more disoriented the landing and
the harder the escape.

## The depth-to-consent gradient

Consent scales with the cost of being wrong, which scales with depth
([layered-place-restoration](layered-place-restoration.md) defines the
layers):

- **Route** — restore automatically. Being wrong costs one click, and
  landing somewhere familiar beats landing on a default home the user
  long ago stopped reading.
- **Scroll and selection** — restore automatically. These are ambient;
  the user who doesn't want them scrolls once and never knew they were
  restored.
- **Active entity in a full-surface sense** (reopening the editor on the
  thing, re-entering the flow) — the boundary case; automatic is
  defensible when the surface is cheap to leave, offered when it is
  modal or engrossing.
- **In-progress work** — always an offer. Reopening a half-written draft
  uninvited puts the user *inside* an obligation they may have abandoned
  on purpose; the offer lets abandonment be a decision they get to make
  calmly, once.

## Anatomy of the offer

- **Named, not generic.** "Continue editing *Quarterly rollup*?" — the
  entity's name is what lets the user decide without clicking. A generic
  "restore previous session?" forces them to open it to find out what it
  is, which is the teleport with extra steps.
- **Positioned, not blocking.** The offer is a banner or card in the
  flow of the resumed surface — never a modal. A modal makes the *offer*
  the ambush it was designed to prevent: the user must answer a question
  about last session before they may begin this one.
- **Two honest exits.** Accept (go there, restore fully) and dismiss
  (the offer leaves and does not return for this item). Dismissal is a
  real answer, recorded — the same offer re-rendered every launch is a
  nag, and the user's third dismissal of it is the moment they stop
  reading all offers, which spends the same trust budget the briefing
  lives on ([first-run-and-quiet-silence](first-run-and-quiet-silence.md)).
  Dismissing the *offer* must not destroy the *work*: the draft remains
  reachable where drafts live; only the proactive surfacing stops.
- **It expires — per kind.** An offer to continue something from twenty
  minutes ago is a courtesy; from three weeks ago it is an accusation.
  Beyond a declared age, the offer stops appearing and the work simply
  waits in its durable home. The expiry is about the offer's
  *relevance*, not the work's retention — and it differs by kind: a
  fresh failure is worth surfacing for about a day (after that it is
  history, not an interruption); a half-edited entity for about a week;
  a paused guided flow until it is finished or explicitly dismissed.
  Clamp against clock skew — a future-dated event is not "very recent."
- **It comes from state you already hold.** The offer, like the
  briefing, derives from stores the boot fills — plus one small
  persisted marker for the layer nothing else records (the last-edited
  entity, stamped on save). Because a same-window write to that marker
  fires no storage event, the writer must notify in-process subscribers
  explicitly, or the second edit of the same entity goes unnoticed (no
  count changed, no route changed, nothing re-rendered).

## One voice at the door

The offer, the away-briefing
([delta-briefings](delta-briefings.md)), and any onboarding or
what's-new surface all compete for the same moment — arrival. Left
uncoordinated, each fires independently and the returning user faces a
lobby of cards. The resume system needs a single arbiter for the arrival
moment: at most one proactive voice speaks first, and the others either
fold into it as lines or wait. Within the resume offer itself, the same
rule applies as a **ranked single signal**: compute every candidate
(a fresh failure to investigate, a guided flow left mid-step, the
entity last edited), rank by consequence — the failure outranks the
paused flow outranks the edit — and surface exactly one, or none. And
suppress the offer that duplicates something already on screen: a
paused flow's resume card is right only while the flow's own panel is
*not* showing; two invitations to the same place is a nag. The test for the whole
arrival experience is the same as for each part: would a user who opens
the application twice a day still read this in month three?

## Validate before offering

The offer is a promise, and it is made *before* the user commits — so
its validity is checked at render time, not at accept time. The entity
still exists; the user still has access; the draft still applies. An
offer that, when accepted, apologizes ("that item was deleted") is worse
than no offer: it manufactured a dead end out of goodwill. Where the
underlying entity changed while away, the offer says so up front
("edited elsewhere since — review changes?"), because that fact changes
whether the user wants to resume at all — the conflict posture itself
belongs to [layered-place-restoration](layered-place-restoration.md).

## Decision rules

- Route, scroll, selection restore automatically; in-progress work is
  always offered; full-surface re-entry is offered when the surface is
  modal or engrossing.
- Offers are named with the entity, rendered inline (never modal), with
  accept and a recorded, work-preserving dismiss.
- Offers expire by declared, per-kind age (failure ~ a day, edit ~ a
  week, paused flow until resolved); the work's retention is separate
  and longer.
- One arbiter for the arrival moment; a ranked single signal within the
  offer (failure > paused flow > last edit); at most one speaks
  proactively; suppress what is already on screen.
- Derive from held state plus a minimal persisted marker; a same-window
  marker write notifies subscribers explicitly.
- Validate the offer at render time; disclose changed-while-away before
  the user accepts.
