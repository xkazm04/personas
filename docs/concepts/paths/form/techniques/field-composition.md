---
layer: technique
subject: form
technique: field-composition
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Field composition

A field is not an input. It is a **composite unit** — label, control, optional
hint, error slot, and the wiring between them — and the composition is the
same for every field in the product regardless of what the control is. Getting
this unit right once, as a primitive every form consumes, is the difference
between forms that are uniformly correct and forms where each field re-solves
(and mis-solves) label association, error placement, and required marking.

## The anatomy, and who owns what

```
[ label            (required marker) ]
[ control                            ]
[ hint — always present space or none]
[ error — replaces or follows hint   ]
```

- **The label** names the datum, persistently. It is programmatically
  associated with the control — activating the label focuses the control, and
  assistive tech announces it when the control gains focus. Placeholder text
  never substitutes: it disappears at first keystroke, and a field whose name
  vanishes while being filled is a memory test.
- **The control** is whatever edits the value — text entry, toggle, selection
  list, structured sub-editor. The composition does not care, which is the
  point: specialized controls slot into the same frame and inherit correct
  labeling and error wiring for free.
- **The hint** carries guidance the user needs *before* erring — format
  expectations, consequences, where to find the value. Hints that only appear
  after a violation are errors wearing a disguise; put the guidance up front
  and the violation may never happen.
- **The error slot** renders the field's current violation, adjacent to the
  control, associated with it through the described-by relationship, with the
  control's invalid state exposed in the accessibility layer and never
  signaled by color alone. Reserve the geometry: an error whose appearance
  shoves the rest of the form downward makes the layout lurch on every
  validation pass — either hold space for one line or animate the reveal so
  the shift reads as intentional.

The feedback area below the control is **one slot with a priority order**,
not a stack: a blocking error wins over advisory feedback (an in-flight or
resolved availability verdict), which wins over the standing help text — and
the described-by association follows whichever occupant is showing. Stacking
all three at once buries the one that matters; the priority order is decided
in the primitive, once, so every field in the product resolves the collision
the same way.

The unit owns the **wiring**: the identifiers linking label→control and
control→error/hint exist and are unique because the composition mints them,
not because each call site remembered. Uniqueness matters more than it looks —
the same field composition rendered twice (a dialog reopened, a row editor
repeated per row) with hand-fixed identifiers silently cross-links labels to
the wrong controls.

## One field vocabulary

The field unit is also where the product's field *vocabulary* lives: what a
required marker looks like, where errors sit, how hints are toned, what
disabled means visually. That vocabulary has exactly one authority — the
primitive — and every form derives from it
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
The tell that the authority has fragmented: two forms in the same product
disagree about where the error message goes, and both are locally consistent.
Hand-rolled label+input+caption stacks are how the fragmentation starts; each
is a private copy of the vocabulary that will not receive the next revision.

## The parse/format boundary lives in the control

The user edits a **presentation** (localized number, formatted duration,
masked secret); the system stores a **canonical value** (the number, the
seconds, the secret). Specialized controls exist precisely to own that
boundary:

- Parse on the way in, tolerantly — accept the formats a reasonable user
  produces, normalize to canonical.
- Format on the way out, canonically — one rendering per type, decided once.
- Report *unparseable* as a validation state, not by silently coercing. A
  control that turns "abc" into zero has invented a value the user never
  entered.

The canonical value is what constraints judge and what submit sends. Forms
that validate presentation strings ("must contain a dot") instead of parsed
values are validating the costume.

## Specialized controls keep the contract

Every control beyond plain text entry earns its place by owning a boundary or
a semantic the plain control cannot:

- **Toggle/switch** for a boolean that *applies immediately or on save* —
  pick one per product; a switch that looks instant but needs a save button
  is the classic betrayal. It is still a labeled field: the on/off state is
  exposed to assistive tech as state, not as two different labels.
- **Selection from a closed set** — a listbox/dropdown owns keyboard
  navigation, type-ahead, and the guarantee that the value is always a member
  of the set. The options are data (value + label + disabled), not markup, so
  the same control serves every enumeration.
- **Structured collections** (key-value pairs, tag lists, repeatable rows)
  are fields whose value is a small document. The control owns row identity
  (stable per row, not positional — rows get reordered and deleted), per-row
  validation attribution, and the add/remove affordances. Its validity rolls
  up into the field contract like any scalar: the form sees one field with
  one validity, however rich the inside.
- **Secret entry** owns reveal/conceal, never echoes into logs or error
  messages, and treats "unchanged" as a distinct state from "empty" when
  editing an existing record — a secret field that renders the stored value
  as dots and then submits the dots has destroyed the secret.

## Prohibitions

1. No control without a persistent, programmatically associated label.
2. No placeholder doing a label's job.
3. No error text that is merely *near* the control instead of associated with
   it.
4. No color-only invalid signaling.
5. No call site hand-assembling label + control + error when the field
   primitive exists — that is a private fork of the field vocabulary.
6. No control that silently coerces unparseable input into a value.
