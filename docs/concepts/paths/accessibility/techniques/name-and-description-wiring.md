---
layer: technique
subject: accessibility
technique: name-and-description-wiring
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Name and description wiring

Every interactive element has an **accessible name** — the string a
screen reader speaks to identify it, the string a voice-control user
must say to activate it — and optionally an **accessible description**,
the supplementary text voiced after it. Neither is a rendering; both are
*computed* by a defined precedence algorithm over a chain of possible
sources. Products that let this computation happen by accident ship
controls named nothing, named wrongly, or named by text that vanishes at
the worst moment. Wiring the chain deliberately is cheap; discovering it
was never wired is an audit finding per control.

## The computation is a precedence chain

In outline: an explicit reference to labeling elements wins over a
direct label attribute, which wins over an associated visible label,
which wins over the element's own content, with stragglers (placeholder,
tooltip text) as fallbacks of last resort. Three practical consequences:

- **Know which source is naming each control.** When two sources are
  present, the higher-precedence one silently wins — the classic defect
  is a visible label that everyone edits while a stale explicit label
  attribute, invisible on screen, is what users actually hear.
- **Never rely on the last-resort sources.** A placeholder disappears
  the moment the user types — naming an input by its placeholder means
  the control loses its identity exactly when the user is acting on it.
  Tooltip-ish fallbacks are unreachable on most touch and keyboard
  paths. Both exist in the algorithm for salvage, not for design.
- **Reference-based labeling is wiring, and wiring is id plumbing.**
  Associating a control with its visible label, hint, and error requires
  stable, unique ids and correct references — exactly the kind of
  repetitive plumbing that belongs inside a field primitive, generated
  once, rather than hand-threaded per form. The field-level pattern is
  owned by [field-composition](../../form/techniques/field-composition.md);
  this technique states the contract it implements.

## Every control has a name — the icon-button rule

The largest single population of nameless controls in any product is
**icon-only buttons**: close, settings, copy, delete, expand — pixels
that are self-evident to sighted users and literally nothing to everyone
else ("button", says the reader, and stops). The rule is unconditional:
an icon-only control carries an explicit accessible name, and the
primitive layer makes that structural — the icon-button variant of the
shared button *requires* a label prop
([primitive-level-a11y](primitive-level-a11y.md)), so the nameless case
does not compile rather than being caught in review.

Decorative graphics inside an already-named control are the inverse
case: marked as hidden from the tree, so the reader does not voice a
filename or a doubled label.

## Description and error: the described-by contract

The description channel carries what the name should not: the hint
("letters and dashes only"), the consequence ("this cannot be undone"),
and — most load-bearing — the **error**. When a field enters an invalid
state, three things wire together as one contract: the field is marked
invalid, its describing chain now includes the error text, and the error
text is thereby voiced when the field is focused. An error message that
renders in red beside the field but joins no chain is visible-only
feedback — a sighted-user exclusive presented as if delivered to all.

Order matters within the chain (hint before error, or a deliberate
policy of error-replaces-hint), and the chain is recomputed when state
changes, not assembled once at mount. Which of validation's many
messages surface where — inline, summary, announcement — is the form
subject's design; this technique owns the invariant that *whatever
surfaces is attached to what it describes*.

## The visible label and the accessible name are one string

Voice-control users activate what they can see: they read the label on
the button and speak it. If the accessible name diverges from the
visible text — a designed label of "Go" over an accessible name of
"submit registration form" — the spoken command fails against the very
string the interface displayed. So the rule
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
in miniature): **the visible label is the authority, and the accessible
name derives from it** — equal to it, or beginning with it when context
must be appended for disambiguation ("Delete" visibly, "Delete,
staging environment" accessibly). Sighted-and-speaking users are the
population that experiences any drift between the two vocabularies
immediately.

Two corollaries:

- **Names are user-facing copy.** They are translated with the rest of
  the product's language ([i18n](../../i18n/i18n.md)), reviewed as
  copy, and never assembled from internal identifiers or enum values
  that read as machine noise.
- **No role words in names.** The platform appends the role; a name of
  "Save button" is voiced "Save button, button". Name the action, let
  the role be the role.

## Dynamic names and state

State that changes on a control divides into two channels, and mixing
them is a recurring defect:

- **State properties** carry toggling and progress: pressed, expanded,
  checked, busy. A toggle is named for the *thing it controls*
  ("Notifications") with a state property carrying on/off — not a name
  that rewrites itself ("Enable notifications" / "Disable
  notifications"), which reads as two different controls appearing and
  disappearing, and breaks voice targeting between states.
- **The name** carries identity, and identity may legitimately be
  dynamic when the *referent* changes — "Play" becoming "Pause" is two
  operations sharing a slot and is conventionally acceptable; a row's
  actions being named with their row ("Delete, entry 14") is identity
  disambiguation, and essential the moment more than one "Delete"
  exists on screen.

The test that catches most wiring defects in one pass: walk the product
with the tree inspector open and read *only* the computed names and
descriptions, never the pixels. Every "button", every doubled phrase,
every vanished hint is a wire to fix.
