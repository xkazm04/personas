---
layer: technique
subject: undo-history
technique: gesture-coalescing
status: forged
laws: [identity-survives-reuse]
shared_with: []
---

# Gesture coalescing

The unit of undo is the unit of intention, but input arrives at the unit of
the event system: a drag is dozens of move events, typing is one event per
keystroke, a slider emits continuously while held. Coalescing is the layer
that collapses event-grained mutations into intention-grained history steps —
and it is not optional polish. An uncoalesced history breaks the undo promise
(no user intended forty micro-moves), floods the stack bound with noise
(eighty steps of history become two seconds of dragging), and inflates
whichever cost model was chosen (forty snapshots or forty commands for one
gesture).

## The two policies

**Explicit tags** — the interaction that generates the events declares its
own step identity. Each mutation carries a tag naming the gesture it belongs
to ("move-clip-42", "type-run", "adjust-opacity"); consecutive mutations with
the same tag merge into the open step; a mutation with a different tag — or
no tag — closes the open step and starts a new one.

**Time windows** — mutations arriving within some interval of each other
merge regardless of origin; a pause closes the step.

Explicit tags are the standard, and the gap is not close. The time window
guesses at intention from rhythm and guesses wrong at both edges: a slow,
deliberate drag splinters into several steps (the pause mid-drag was the user
aiming, not finishing), and two rapid distinct actions fuse into one (undo
now reverts something the user considers a separate decision). Tags cost one
string at each mutation site and are *correct by declaration* — the code that
knows it's mid-drag says so. Reserve time windows for the one place they
carry their weight: merging consecutive keystrokes into a typing run, where
no explicit gesture brackets exist and a pause genuinely does signal a
settled thought. Even there, prefer a hybrid: tag the run, and let a pause or
a boundary event close it.

## Tag identity must survive interleaving

The tag is an identity, and it obeys identity's law: it must distinguish
everything the user distinguishes and survive the operations the session
actually performs ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
Two consequences:

- **The tag names the gesture instance, not the operation type.** A bare
  "move" tag merges dragging object A with dragging object B if the user
  alternates quickly — undo then reverts both drags at once. The tag carries
  the target's identity: "move:A". Same for multi-touch or multi-cursor
  input, where two gestures are genuinely open at once.
- **Reusing a tag later must not resurrect a closed step.** "move:A", other
  edits, then "move:A" again is two steps, not one. Merging is only legal
  into the step *currently at the top* of the stack; anything else rewrites
  settled history.

## Boundary events close steps

A step must close when the intention ends, and intentions end in more ways
than "the next mutation had a different tag":

- **The gesture's own terminal event** — pointer released, key focus left the
  field, the slider handle dropped. The interaction code that opened the tag
  closes it; this is the authoritative boundary.
- **A commit-grade action** — save, submit, run, export. Whatever the user
  does next is a new intention by definition.
- **Focus or selection leaving the edited object** — a typing run in one
  field never merges with a typing run in another.
- **Undo itself.** Invoking undo closes any open step first, then reverts a
  whole step. Undo during an open gesture (mid-drag keyboard shortcut) either
  cancels the live gesture or is deferred — it never reverts the *previous*
  step while the current one is still accumulating.
- **A time ceiling as backstop, not policy.** Even under explicit tags, a
  step that has been open for minutes (a held slider the user is meditating
  over) may close on a generous ceiling so a single marathon gesture can't
  swallow the session. This is a safety valve; if it fires often, the tag
  design is wrong.

## What a coalesced step stores

Merging is asymmetric: keep the **before-state (or inverse) of the first
mutation** and the **after-state (or forward) of the latest**. Everything
between is noise — undo restores where the gesture started, redo restores
where it ended. Under a snapshot model this means a merge *replaces* the
open step's after-capture and touches nothing else; the step's memory cost
is flat no matter how many events merged into it. A coalescing
implementation that appends rather than replaces has reimplemented the
uncoalesced stack with extra bookkeeping.

The step also inherits its **name** from the tag ("undo move", "undo
typing") — coalescing is where nameable undo comes from for free, because
the step was built around a named intention.

## Live preview vs history truth

During a gesture the document mutates continuously (the user sees the drag
happen), but history sees one step. This split — render every intermediate,
record only endpoints — is the entire trick. Implementations that try to
record only at gesture end instead discover they cannot render intermediate
states without mutating, then mutate without recording, and now the
document and the stack disagree if the gesture is interrupted (escape
pressed, window blurred, pointer lost). The robust order: open the step at
gesture start (capture the before), mutate freely during, seal the after at
gesture end — and on interruption, restore the captured before, discarding
the step entirely. A cancelled gesture leaves no history entry; cancel is
not undo.

## Prohibitions

1. No continuous interaction (drag, slider, paint stroke, resize) that lands
   as more than one history step.
2. No time-window-only coalescing for gestures that have explicit start/end
   events — the events know the truth; use them.
3. No tag that omits the target's identity when the user can interleave
   targets.
4. No merging into any step except the current top of stack.
5. No open step surviving a commit-grade action, focus departure, or undo
   invocation.
6. No cancelled gesture leaving a history entry.
