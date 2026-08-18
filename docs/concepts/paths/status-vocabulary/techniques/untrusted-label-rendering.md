---
layer: technique
subject: status-vocabulary
technique: untrusted-label-rendering
status: forged
laws: [one-validation-door]
shared_with: []
---

# Untrusted label rendering

The same badges, cells, and headings that render closed-vocabulary labels
also carry text the repo did not author: entity names typed by users,
titles imported from other systems, summaries written by a model. The
ownership test is the **author**, not the surface — if any part of a
rendered string came from outside the repo, this technique applies to it,
however small the pixel footprint. Small surfaces are where the guard is
most often skipped, because a name in a badge "obviously" is not a
document.

## Escape by default, at the primitive

Rendering untrusted text as ordinary text nodes — which every mainstream
UI framework escapes — is already safe, and needs no sanitizer, no
helper, and no review. So the display primitives (badge, cell, tooltip,
heading) accept **text, never markup**, and safety becomes a property of
the rendering layer rather than a per-call-site discipline. The defects
live at the two doors out of that default:

- **The raw-markup door.** Any injection of a string into the DOM as
  markup goes through one named sanitizer helper with an explicit tag
  allowlist, and the injection sits on the same line as the helper call
  so a reviewer sees both at once
  ([one-validation-door](../../_laws.md#one-validation-door): the door is
  enumerable, the writers are visible).
- **The markdown door.** Rich untrusted text renders through **one**
  shared markdown renderer where the link, image, and raw-passthrough
  policy lives — never a bare markdown component per call site, because
  the policy is exactly what the bare component lacks. URLs that arrived
  *with* the content are sanitized before they become link targets, and
  external opens route through the app's one external-open door.

The deeper treatment — hostile model output, fencing, the sanitizer's own
correctness (single-pass entity decoding is not a fixpoint) — is owned by
[output-sanitization](../../prompt-safety/techniques/output-sanitization.md)
and its sibling
[model-output-as-untrusted](../../prompt-safety/techniques/model-output-as-untrusted.md).
This technique owns the display half: the primitives' contract and the
two doors.

## Untrusted text never becomes vocabulary

The subtler failure is not injection but **identity confusion**: logic,
color, filtering, or persistence keyed on user-authored content as if it
were a token. A status pill whose hue derives from matching an
entity's *name*, a branch on a model-emitted phrase, a map keyed by an
imported title — each treats content (open, hostile, renameable) as
vocabulary (closed, trusted, stable). The boundary is the same one
[token-label-separation](../../i18n/techniques/token-label-separation.md)
draws for catalog labels, applied to a rougher neighborhood: **tokens are
minted by the repo; everything else is a dead end that data flows into
and never out of.** If untrusted content must influence presentation
(user-chosen accent colors, say), it does so through a closed selection
the user picks from — the content names a token; it never *is* one.

## Geometry is part of the contract

Untrusted text has untrusted *shape*: unbounded length, no spaces,
right-to-left runs, combining characters, emoji. The primitive owns
truncation (with the full value recoverable — a tooltip or expansion),
overflow, and bidirectional isolation, because a call site that clips by
eye will be wrong at the first name longer than the test data. A layout
broken by a crafted name is the same class of defect as markup injected
by one — outside authorship exploiting a per-call-site decision — and the
same cure applies: decide once, inside the primitive.
