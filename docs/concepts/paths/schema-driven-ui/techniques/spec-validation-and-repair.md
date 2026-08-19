---
layer: technique
subject: schema-driven-ui
technique: spec-validation-and-repair
status: forged
laws: [one-validation-door, count-carries-predicate, failure-not-empty-success, deletion-is-not-repair]
shared_with: []
---

# Spec validation and repair

Every spec that reaches the renderer has passed through one validation door —
the same door whether the spec was just emitted by a model, loaded from
storage, imported from another host, or hand-edited by a developer. The writers
to that door are enumerable; nothing renders around it. Validation sprinkled
per-widget or trusted to "the emitter already checked" is validation minus the
path added next quarter.

(Upstream of this door sits a different discipline: getting a parseable
candidate document out of a model turn at all — fence stripping, retry-on-
unparseable, schema-guided decoding — which belongs to structured-output's
schema-validation-and-repair, not here. This technique begins with a parsed
document of the right general shape and asks: which of these nodes may render?)

## The passes, in order

1. **Envelope**: is this a spec at all — version present and known (or
   downlevelable), top-level shape correct? Envelope failure is the one case
   that rejects outright; there is nothing to salvage from a document that
   is not a spec. Rejection renders a designed failure state — never a blank
   surface, never the empty state. Invalid and empty are different facts and
   must be spelled differently.
2. **Caps**: total node count, tree depth, per-string and per-collection
   lengths. Caps are resource protection against pathological documents
   (accidental or adversarial) and they run *before* per-node work so the
   validator itself cannot be wedged by the document it is judging. A capped
   subtree is truncated at the cap and the truncation joins the drop set.
3. **Per-node structural validation**: for each node — kind known to the
   registry, config valid against that kind's contract, children legal under
   the composition rules. Each check that fails removes *that node* (and its
   subtree) from the render set and appends a drop record: node identity,
   kind, reason.
4. **Cross-node checks**: references resolve (an action reference names a
   registered action; a node reference names a node that survived), stable
   ids unique. Dangling references degrade the referring feature — an
   unresolvable action renders disarmed — rather than dropping content.

The output is a **render plan plus a drop ledger**, both first-class: the
plan is what the renderer realizes; the ledger is what the disclosure line,
the telemetry, and the emitter-improvement loop consume.

A candidate document that fails the envelope — or one whose every node drops —
does not end in a blank panel: the surface falls back to the plain display
channel the raw output would have gotten with no spec at all. The spec channel
is progressive enhancement; its worst case is the status quo, never a dead end.

## Normalize, then salvage — two tiers, one line between them

Model-emitted documents are systematically sloppy in *meaning-preserving* ways:
a number where a string belongs, a label three characters over its cap, a
percentage of 104. Dropping nodes for these is punishing the user for the
emitter's dialect. So the pass has a **normalization tier** ahead of the drop
decision — bounded, mechanical transforms declared per field in the config
contract: coerce scalar types to the declared type, truncate strings to their
caps, clamp numerics into their declared range, treat blank-and-absent as one
"not given". Normalization is forgiving on the way in and bounded on the way
out; the caps still hold absolutely.

The line that must not blur: normalization transforms a value *deterministically
toward its declared contract*; it never guesses at intent. Coercing `42` to
`"42"` is normalization. Deciding a misspelled kind ("timelinee is probably
timeline") or fabricating a missing required field is invention, and invention
converts a visible emitter defect into an invisible rendering lie. When a value
cannot be normalized mechanically, the node drops and the ledger records why.

## Salvage semantics

Repair means: render everything valid, drop the invalid minimally (the node,
not its valid siblings; the subtree only when the container itself is
invalid), and never *invent*. The repair pass may apply registered defaults
for omitted optional fields — that is the config contract doing its job — but
it never fabricates required content and never reorders surviving nodes to
paper over a gap. The drop ledger exists precisely so defects stay visible;
salvage protects the user's surface, never the emitter's reputation.

## Disclosure: the dropped-N line

A surface rendered from a repaired spec discloses the repair **in the surface
itself**: "3 sections shown · 1 could not be displayed." Rules that make the
line honest rather than decorative:

- **The count carries its predicate.** What was dropped and at what
  granularity — nodes, sections, items — is stated in the ledger and
  consistent in the line. "1 dropped" meaning "one subtree of forty items"
  is a count divorced from its predicate.
- **Zero drops renders no line.** The disclosure is an exception report, not
  chrome.
- **The line is calm and terminal-severity-appropriate** — this is expected
  operating behavior, not an error banner. A detail affordance may reveal
  per-drop reasons for users who can act on them (spec authors, operators);
  end users get the honest count and an intact surface.
- **Silent best-effort is banned even when N is embarrassing.** The
  temptation to hide the line on high-drop specs inverts its purpose: high
  drop counts are exactly the signal that the emitter and vocabulary have
  drifted and someone must be told.

## Repair is a render-time view, not a storage-time edit

The validation door produces a repaired *view*; it does not write the repaired
spec back over the stored one. Deleting the invalid nodes from storage would
destroy the evidence of what the emitter actually produced — the artifact that
exposes the defect — and would fight the concurrent-edit discipline (another
author may hold the fix for the very node being dropped). The stored document
stays as written; every reader passes it through the door; the ledger, not
deletion, is the repair record. Storage-side migration happens only as a
deliberate, versioned vocabulary migration
([node-vocabulary-design](node-vocabulary-design.md)), never as a side effect
of rendering.

## The ledger feeds the loop

Drop records are telemetry, keyed by kind and reason. A spike in
`unknown-kind` after a vocabulary change means the emitter documentation
lagged the registry ([emitter-registry-sync](emitter-registry-sync.md)); a
steady rate of config failures on one kind means that kind's contract and the
emitter's understanding of it disagree. The repair pass is not just a shield —
it is the measurement instrument for the whole emit→render pipeline, and an
instrument that reports zero must be distinguishable from an instrument that
did not run.
