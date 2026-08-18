---
layer: technique
subject: prompt-safety
technique: input-caps-and-clamps
status: forged
laws: [one-validation-door, count-carries-predicate]
shared_with: []
---

# Input caps and clamps

Before an untrusted span is fenced, it is **bounded and typed**. Caps are the
least glamorous layer of the boundary and the one with the best
cost-to-coverage ratio: a length ceiling and a grammar check close whole
attack families — context flooding, instruction burial, resource burn,
slot-type confusion — with logic a reviewer can verify in a minute. The
technique is knowing *what* to bound (per class, not globally), *how* to cut
(visibly, never silently), and *where* (one door).

## Ceilings are per class, not per prompt

A single global cap is the wrong shape. Insertion slots have classes, and the
classes differ by orders of magnitude in legitimate size:

- an **identifier** slot: tens of characters, machine grammar;
- a **name or title**: one line, no structure;
- a **message or instruction variable**: a paragraph or a few;
- a **document or transcript**: large, but still finite and budgeted.

The ceiling for each class encodes a judgment about legitimacy: a "title" of
forty thousand characters is not a long title, it is a payload wearing a
title's slot. Class-scoped caps catch that *semantically* — the input is
implausible for what it claims to be — where a global cap would wave it
through because the prompt still fits. The class table lives in one place,
named and reviewable, so tightening a ceiling is an edit, not an excavation
(the composition-side budget arithmetic belongs to the sibling discipline
prompt-assembly; this table is the safety floor under it).

Two ceilings stack on top of the class table:

- **The engine ceiling.** Whatever the downstream model or transport accepts
  is a hard physical bound; clamping to it at the last moment prevents the
  worst outcome — a request rejected wholesale, or worse, truncated by the
  *transport* at an arbitrary byte with the trusted tail instructions cut off.
  Better that the data span loses its tail than the frame loses its authority.
- **The aggregate ceiling.** Many individually legal spans can still sum to a
  prompt that drowns its own instructions; the assembly door enforces a total
  untrusted-content budget, not just per-slot ones.

## Clamp visibly, reject loudly

When input exceeds its ceiling there are two honest responses and one lie:

- **Reject** — for slots where truncation changes meaning (identifiers, keys,
  anything later validated against a store). A clipped identifier is a
  *different* identifier; there is nothing safe to keep.
- **Clamp with a mark** — for prose slots. Cut at the ceiling and append an
  explicit, machine-recognizable truncation marker inside the fenced region,
  so both the model and any human reading the transcript know the span is
  partial. Cut on a character boundary that cannot split an encoded unit into
  an invalid sequence — a clamp must never manufacture malformed text that
  downstream parsers then "repair" into something new.
- **The lie** is the silent clamp: the model answers about 30% of a document
  while everyone believes it read it all. The failure this produces —
  confidently wrong output with no visible cause — is far more expensive than
  the ceiling that caused it.

One refinement earns its subtlety: **the same value can legitimately carry two
ceilings, keyed to placement trust.** Untrusted text spliced into *trusted*
prompt structure — an inline variable inside instruction prose — gets a tight
cap, because every character there enlarges the injection surface at the most
sensitive location. The same value presented *inside a fenced data region* can
be complete, because the fence is doing the isolating. When both placements
appear in one prompt, the truncation marker at the tight site should say where
the full value lives — turning an apparent contradiction between two limits
into a pointer, for the model and for the human reading the transcript.

Every clamp and rejection is counted, per slot class, with the ceiling that
triggered it ([count-carries-predicate](../../_laws.md#count-carries-predicate)
— "clamped 14 times" is noise; "14 clamps of document-class spans at ceiling
N, all from one source" is a finding). Clamp telemetry is how ceilings get
tuned instead of folk-adjusted.

## Structural validation before insertion

Length is the coarse check; grammar is the fine one. Any slot with an
expected *shape* validates the shape before insertion:

- identifier slots accept identifier grammar — the allowlisted alphabet and
  length of the system's own identifiers, nothing else;
- enumerated slots (a mode, a category, a status) accept members of the
  enumeration, resolved against the single authority for that vocabulary;
- structured slots (a date, a number, an address) parse under the strict
  parser, and the *parsed, re-serialized* value is what gets inserted — never
  the raw input that happened to parse.

Free-text slots get hygiene instead of grammar: strip or reject control
characters that have no business in prose — including the invisible ones that
reorder, hide, or disguise text (direction overrides, zero-widths,
lookalike-enabling controls). These are the classic carriers for making
hostile text render as innocent and for splitting log lines; no legitimate
document variable needs them.

## One door, again

Caps, clamps, and grammar checks live in the **same single door** that fences
([one-validation-door](../../_laws.md#one-validation-door), and see
[untrusted-span-fencing](untrusted-span-fencing.md)): bounding happens as part
of insertion, not as a courtesy each call site performs first. A cap enforced
at nine of ten call sites is a cap the attacker chooses whether to encounter.
The door order is fixed and worth stating: **validate grammar → clamp length →
neutralize fence-lookalikes → fence → place** — grammar first (a clamp can
change what the grammar would have said), fencing last (nothing added after
the fence is inspected by it).
