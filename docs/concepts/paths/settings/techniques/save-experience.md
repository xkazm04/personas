---
layer: technique
subject: settings
technique: save-experience
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Save experience

A settings surface makes a promise no other form makes: *what you see here is
what the system will do*. Every design choice in the save path either honors
that promise or quietly breaks it, and the failure mode is nastier than a
broken form — a user who flips a toggle, sees it flip, and later discovers
the write never landed has learned that the settings screen lies. After that,
every knob on it is under suspicion. The save experience is therefore not
polish on top of the store; it is the store's credibility layer.

## Two save models — choose per surface, never mix on one control

- **Immediate (auto-save)**: the control commits on change. Right for
  independent, low-ceremony values — preferences, toggles, selections. The
  contract: the write is *debounced* where input is continuous (sliders,
  text), and the control reflects the **stored** state, not the hoped-for
  state.
- **Explicit (form + save button)**: edits accumulate locally and commit
  together. Right when values are interdependent (host + port + credentials
  that only make sense validated as a set), when the change is consequential
  enough to deserve a deliberate act (a safety ceiling), or when partial
  application would be worse than none.

The anti-pattern is the hybrid: a surface where some controls commit
instantly and others wait for a button teaches the user that they cannot
predict what saving means, which is the promise broken by design. Pick per
surface; make the model legible at a glance.

## Honest feedback

- **Confirm quietly, fail loudly.** Success wants a small, transient
  acknowledgment near the control — enough to close the loop, not enough to
  interrupt. Failure is the case that matters: the write that did not land
  must say so *and put the control back to the truth*. Optimistic flips that
  stay flipped after a failed write are the settings screen lying in its
  most literal form
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
- **Debounce the write, never the truth.** During the debounce window the
  control shows the user's input (anything else fights the user's hand), but
  the window must flush on blur, on navigation, and on close — a debounce
  that can die with the page converts the last edit into a silent no-op.
- **Consequential writes get ceremony.** Raising a ceiling, disabling a
  safety mechanism, or anything in the taxonomy's heavier kinds
  ([setting-kinds](setting-kinds.md)) warrants confirmation that names the
  consequence, not a generic "are you sure". Reset-to-default affordances
  say what the default *is* before doing it.

## Unsaved-changes guards

Explicit-save surfaces owe the user a guard: navigating away with
uncommitted edits prompts — save, discard, or stay. The guard's quality
hinges on one detail: **dirty means different-from-stored, not
touched-since-mount**. Edit a field, edit it back, and the surface is clean;
a guard that cries wolf on clean forms trains users to click through it,
which un-builds the guard. This requires keeping the pristine snapshot to
diff against — a small cost that the guard's credibility entirely depends
on.

## Findability

Past a few dozen keys, the settings surface's dominant UX problem is not
editing — it is *finding*. Scrolling through category tabs is archaeology.
A settings search earns its place early: it indexes labels, descriptions,
and synonyms (users search "dark mode", not "theme variant"), and its
results *navigate* — landing the user on the owning section with the match
highlighted, preserving the spatial memory that pure-result UIs destroy.
The index derives from the same registry that owns the key space
([key-registry](key-registry.md)); a hand-maintained search index over a
registry-owned space is a second vocabulary waiting to drift. Search also
quietly serves the support path: "search for X, change it" beats a
screenshot tour of nested tabs in every conversation where anyone helps
anyone configure anything.
