---
layer: technique
subject: draft-editing
technique: draft-model
status: forged
laws: [one-validation-door, identity-survives-reuse]
shared_with: []
---

# Draft model

The draft is a first-class object: constructed from the persisted entity in
one explicit step, mutated through one patch door, compared against a
retained baseline, and mapped back to storage shape in one explicit step.
Four verbs — construct, patch, apply, discard — and each is a designed
boundary, not an accident of whichever handler touched the data last.

## Construction: an explicit projection, not a shared reference

The draft is built from the entity by a **projection function** that runs
once at open:

- **It copies deeply enough that mutation cannot reach the persisted
  object.** A draft that shares nested structures with the entity it was
  drafted from mutates the "clean" copy through the back door, and every
  dirty comparison thereafter compares a thing with itself.
- **It normalizes on the way in.** Missing optional fields get their
  defaults filled; legacy shapes from older stored versions get migrated to
  the current edit shape; presentation-friendly restructuring (grouping,
  ordering) happens here. Construction is the one place where "whatever is
  in storage" becomes "what the editor is defined over" — normalizing lazily
  at each consuming control instead re-derives this boundary N times and
  drifts.
- **The edit shape may differ from the storage shape.** The draft is
  optimized for editing (denormalized, presentation-ordered, with derived
  conveniences); the apply step owns the inverse mapping. Committing to
  "the draft is literally the wire format" trades every future editing
  affordance for one saved function.

The constructed snapshot is retained as the **baseline** — the reference
point for all dirtiness derivation, advanced only by successful saves.

## The patch door

Every mutation flows through one interface — a patch function taking the
change (typically a partial: field, or region-scoped set of fields) and
producing the next draft state. This is
[one-validation-door](../../_laws.md#one-validation-door) applied to
mutation, and it is the single most consequential decision in the standard,
because everything the surface later wants attaches at that door exactly
once:

- dirtiness recomputation for the touched region;
- save scheduling (the patch knows which group it dirtied);
- clamps and normalization (bounds enforced on entry, not at N controls);
- undo capture (a sibling standard, but this is its attachment point);
- change telemetry.

A second write path — a control that mutates draft state directly "just this
once" — silently exempts itself from all five. The tell during review: any
assignment into draft state that is not the patch function.

## Apply: draft to storage, explicitly

The save step maps edit shape back to storage shape — the projection's
inverse. Its contract:

- **It sends the diff, never the record.** The payload names the fields
  where draft and baseline differ, and *omits* everything else — omission
  is the only spelling of "leave alone" that survives every transport,
  because a placeholder value invented to fill a required slot is
  indistinguishable, on the wire, from an instruction. The two failure
  modes of a full-record payload are both data loss: a blank filled with
  an empty value *clears* a field the user never touched, and a field
  copied from the client's stale read *reverts* every write that landed
  since. The strong form withholds payload authorship entirely — call
  sites express an intent (rename, retune, toggle) and one builder derives
  the field set, so an unchanged key structurally cannot be sent.
- **"Never set" and "cleared" are spelled differently.** A diff must be
  able to say "clear this field" without that spelling colliding with
  "I am not mentioning this field". If the transport collapses the two,
  the damage is unauditable afterward — at rest, a cleared value and a
  never-set value are the same value.
- **It remembers what it sent.** When the save resolves, "clean" is
  decided by comparing against the payload that was actually saved, not
  by assuming the draft stood still (drafts keep moving while saves are
  in flight — the debounced-save-groups technique owns this race).
- **It may apply partially.** With region grouping, apply operates per
  group; the baseline advances per group.
- **Invalid state does not pass.** A draft may *hold* invalid values —
  that is its purpose — but the apply door is where they stop, visibly.
- **A draft built from unreadable source must not save over it.** When
  construction cannot faithfully project part of the stored entity (a
  corrupt or unparseable fragment), filling that part with defaults is
  acceptable for *display* — but auto-applying those defaults would
  overwrite the still-recoverable original with the reset. Suppress the
  save for the affected fields, tell the user why, and unblock only on an
  explicit re-edit.

## Discard: return to baseline

Discard reconstructs the draft from the baseline — not from empty, and not
by refetching unless the baseline is suspected stale. Discard scoped to a
region (revert this tab) falls out for free when dirtiness is grouped;
whole-draft discard is the same operation at the root.

## Identity and staleness

The draft carries the entity's identity from construction. Two rules:

- **Switching entities constructs a new draft; it never rebases the old
  buffer onto a new identity.** Reusing the buffer object across entities is
  how one record's half-typed edits bleed into another
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)); the
  draft's lifetime is bound to one entity's editing session.
- **The entity can change underneath the draft** — another surface, another
  device, another collaborator. The draft records what version it was
  constructed from; the apply door detects divergence and escalates
  (reload, merge, or an explicit overwrite choice) rather than blind-writing
  over someone else's committed work. Detection at save time is the floor;
  surfacing the divergence when it happens is the courtesy.

## Prohibitions

1. No mutation path outside the patch door.
2. No draft that shares mutable structure with the entity or the baseline.
3. No lazy per-control normalization — construction is the one door in.
4. No apply that marks clean without comparing against the payload it sent.
5. No buffer reuse across entity identities.
6. No discard that resets to empty instead of baseline.
