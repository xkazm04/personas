---
layer: technique
subject: modal-stack
technique: dismissal-semantics
status: forged
laws: []
shared_with: []
---

# Dismissal semantics

How an overlay closes is a contract declared when it opens, not a pile of
event handlers accreted afterward. The contract has three parts: which
*gestures* may close this overlay, which *exit* each gesture means, and what
*guard* stands between the gesture and the close when the user has something
to lose.

## The gesture set

Four ways out, each with its own rules:

- **Escape.** The universal "get me out" for keyboard users. It addresses the
  **topmost** overlay only — one press, one layer. An implementation where
  escape closes several layers at once, or closes a bottom layer while a
  popover sits on top, has routed the key by subscription order instead of
  stack order. Escape may be *guarded* (see below) but should almost never be
  simply absent: a modal with no keyboard exit is a trap.
- **Outside interaction** ("light dismiss"). A pointer press outside the
  overlay's territory closes it. Two subtleties carry all the bugs:
  - *Territory is more than the panel.* The overlay's own anchor (the button
    that opened it) is inside — otherwise clicking the trigger closes and
    instantly reopens, a flicker users read as a broken toggle. Any overlay
    stacked **above** this one is inside too: interacting with a nested menu
    must not read as "outside" to its parent.
  - *Judge on press, act with care.* A press that begins inside and ends
    outside (a slipped drag, a text selection that leaves the panel) is not
    an outside click. Judging on release alone closes overlays under users'
    fingers mid-gesture.
  - *The opening press must not be judged by the listener it just created.*
    The click that opens the overlay is, by raw geometry, outside it — and if
    the outside-judge starts listening synchronously, it closes the overlay
    in the same gesture that opened it (the "opens then instantly vanishes"
    toggle). The answer is structural, not disciplinary: scope the listener,
    use event phase, or arm it one tick after open. Any of the three works;
    trusting call sites to remember does not.
- **Explicit close** — the close affordance, a cancel action, a "done"
  action. Always present on modal surfaces; light anchored surfaces may omit
  it because their whole dismissal posture is light.
- **Programmatic** — the flow that pushed the overlay completes it (save
  succeeded, selection made, task finished elsewhere). This path bypasses
  gesture policy but still runs the same single close door, so guards and
  bookkeeping cannot be skipped by code.

## Policy follows investment

Which gestures are enabled is decided by what the user stands to lose:

| Surface | Escape | Outside | Rationale |
| --- | --- | --- | --- |
| Menu, picker, tooltip-like popover | yes | yes | nothing invested; friction is pure cost |
| Informational dialog | yes | yes | reading is not investment |
| Form dialog, empty | yes | usually | nothing typed yet |
| Form dialog, dirty | guarded | guarded or off | typed input is at stake |
| Critical flow (payment step, irreversible progress) | guarded | off | a stray click must not discard the flow |

The rule of thumb: **light surfaces dismiss lightly; invested surfaces
dismiss deliberately.** Both failure directions are real products: the menu
that only closes via its tiny close glyph, and the half-filled form that a
misclick on the backdrop vaporizes.

## Cancel, dismiss, complete — three exits, three meanings

Callers awaiting an overlay's result must be able to distinguish:

- **Complete** — the user did the thing; a value or confirmation comes back.
- **Cancel** — the user explicitly declined; the flow should treat this as a
  decision.
- **Dismiss** — the user left without deciding (escape, outside click,
  navigation). Often handled like cancel, but not always: analytics differ, a
  "don't ask again" must not bind on dismiss, and a critical flow may re-ask
  after a dismiss where it would respect a cancel.

Collapsing these into one "closed" event loses information the pushing flow
cannot reconstruct. The resolution rides the pop, as the stack-ownership
technique's result channel.

## The unsaved-changes guard

When a dismiss gesture arrives at an overlay holding un-persisted user input,
the gesture is **intercepted, not obeyed and not ignored**:

1. The close request enters the one close door and hits the entry's guard.
2. The guard pushes a small confirmation *on top* — the guard is a stack
   citizen, subject to every ordinary rule (topmost, owns input, escape
   addresses it now).
3. Its resolution decides: *discard* pops both layers; *keep editing* pops
   only the guard; an optional *save and close* runs the save, then pops.

Disciplines:

- **Dirty means dirty.** The guard keys on actual divergence from the
  initial values, not on "the overlay was opened". Guarding pristine forms
  teaches users the guard is noise — and they will click *discard* on the day
  it is not.
- **All gestures share the guard.** Escape, outside click, explicit close,
  and navigation all route through the same interception; a guard wired only
  to the close button is a gate that most exits walk around.
- **The guard guards once.** Answering *discard* closes; it does not cascade
  into a second "are you sure?".

## Non-modal cousins

Toasts and banners dismiss on timer, on explicit action, or on context
change — never on outside click (everything is outside a toast). Timed
dismissal pauses under the pointer and under keyboard focus, and anything
carrying an action the user might need must not vanish faster than it can be
reached. Their dismissal is a scheduling policy, not a gesture policy — but it
is still declared where they are created, not improvised per call site.
