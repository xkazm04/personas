---
layer: technique
subject: draft-editing
technique: navigation-guards
status: forged
laws: [gate-sees-target]
shared_with: []
---

# Navigation guards

Leaving a surface with unsaved work is data loss with one keystroke of
warning available. The guard exists to spend that keystroke — but the
technique is larger than the dialog: enumerate the exits, observe the real
state, offer honest choices, and make the question rare by making the draft
survive.

## One interceptor, every exit

The exits a draft surface owns form a longer list than anyone remembers
while building:

- switching regions *within* the editor (usually not an exit — the draft
  spans regions — but a flush trigger);
- navigating to a different route or view;
- closing the surface (close button, backdrop, escape, programmatic close);
- switching to a different entity inside the same editor;
- closing the window or the application.

All of them route through **one interceptor**. The classic hole is guarding
the close button while escape and backdrop dismiss freely; the durable
version of that hole is the exit path *added next quarter* that never heard
of the guard. One choke point makes the next path safe by default; N
per-path checks make it unguarded by default.

## The guard observes the real state

The guard's condition is not "the dirty flag": it is **derived dirtiness
plus pending plus in-flight plus failed saves**
([gate-sees-target](../../_laws.md#gate-sees-target)). Work sitting in a
debounce timer is exactly as unsaved as work never scheduled — the
signature bug of this technique is a guard that consults dirtiness, sees
"clean because a save is scheduled", and lets the user leave while the
timer dies with the surface.

Ordering matters: on an exit attempt, **flush first, ask second**. Flushing
pending groups resolves most exits without any dialog — the draft was a
save away from clean, so save it. The question is reserved for what the
flush cannot settle: saves that fail, or content the system refuses.

## The offer

When the guard must ask, it offers three verbs, spelled honestly:

- **Save and leave** — the default and the primary action when saving can
  succeed.
- **Discard and leave** — named destructively ("discard changes", never a
  second "cancel"). The double-negative dialog where "cancel" might mean
  cancel-the-leaving or cancel-the-draft is a coin flip that costs someone
  their work.
- **Stay** — return to the editor, nothing touched.

Two honesty rules: the guard **never fires on a clean draft** (a guard that
cries wolf trains users to click through the one that matters), and the
failed-save case changes the message — "saving has been failing" is a
different, louder conversation than "you have unsaved changes".

## Survival layers: make the question moot

The dialog is the last line, and the weakest — window-close hooks are
platform-limited, and a process kill asks nobody. The stronger posture is
that the draft survives each boundary it can:

1. **Survives remount** — the draft lives above the surface's lifetime
   (held in state that outlives the view), so navigating away and back
   restores the buffer without ceremony. This converts most guard
   encounters into non-events. Store mechanics for this are owned by the
   [client-state](../../client-state/client-state.md) standard.
2. **Survives reload** — the draft is persisted locally, keyed by entity
   identity and the version it was drafted from. On reopen: if the entity
   is unchanged, offer or silently restore the draft; if the entity moved
   on, the stale draft is a *conflict*, surfaced as one — never silently
   applied over newer committed work, and never silently deleted.
3. **Survives nothing further** — beyond local persistence, survival means
   committing, which is the save architecture's job, not the guard's.

Each layer added makes the layer below rarer. An editor with remount
survival and flush-on-exit shows its dialog almost exclusively for genuine
failures — which is exactly the case that deserves the interruption.

## Prohibitions

1. No exit path outside the single interceptor.
2. No guard condition that ignores pending, in-flight, or failed saves.
3. No dialog before attempting the flush.
4. No firing on a clean draft.
5. No ambiguous verbs — the destructive option names the destruction.
6. No stale persisted draft applied or deleted silently after the entity
   changed underneath it.
