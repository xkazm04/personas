---
layer: technique
subject: drag-drop
technique: cross-surface-handoff
status: forged
laws: [one-authority-per-vocabulary, creation-names-reaper]
shared_with: []
---

# Cross-surface handoff

The drags that leave home — from a browsing panel onto a composition
surface, from a palette into a canvas region, from one tool's territory into
another's — are a different problem from reordering within a list. Inside
one surface, source and target share a data model, a coordinate space, and
an owner. Across surfaces, none of that is given, and the design work is
precisely in the contract that replaces the shared context.

## The payload contract is negotiated, not assumed

Within one list, the drop handler knows what it is receiving because it
watched the drag start. Across surfaces, the target sees only what the
payload declares — so the declaration carries the whole burden:

- **Kinds come from one shared vocabulary.** The set of draggable kinds is a
  closed vocabulary with exactly one authoritative definition that every
  source and every target derives from. Two surfaces each maintaining their
  own list of "the kinds" is the canonical vocabulary drift: they diverge
  the day someone adds a kind and finds only one list, and the symptom —
  a drop that silently does nothing between two surfaces that both
  "support" the type — appears far from the cause.
- **The source declares; the target filters — and refuses first.** At drag
  start the source publishes the payload's kind(s); each potential target
  answers "I accept this" or not from its own accept-list against the
  shared vocabulary, and it inspects the declaration *before* signaling
  acceptance. A target that says yes unconditionally — accepting first,
  inspecting at drop time — has volunteered to receive everything: foreign
  drags from sibling surfaces, files from the host system, stray text
  selections. The filter is also what drives cross-surface affordances
  ([drop-affordances](drop-affordances.md)): a target that cannot inspect
  the payload's kind until the drop cannot light up during the drag, and a
  handoff without in-flight target feedback is trial-and-error with extra
  panels.
- **The payload stays a reference.** Everything in
  [payload-and-identity](payload-and-identity.md) holds with more force
  here: the receiving surface resolves the identity against the system of
  record at drop time. A payload that serializes a snapshot of the entity
  turns the handoff into a fork — the target builds on data the source
  already invalidated. Ship the id, the kind, and minimal origin context;
  let the target fetch truth.

When a handoff crosses a *process or application* boundary, the payload
additionally needs a self-describing serialized form — versioned, so a
receiver can refuse a shape it does not understand rather than half-parse
it. Refusing loudly beats accepting wrongly; a half-understood drop corrupts
quietly.

## The drop translates meaning

A cross-surface drop is not "insert here"; it is a *translation* from the
source's domain into the target's. An asset dropped onto a sequence becomes
a placed instance with a start time and duration; a record dropped onto a
person becomes an assignment. The translation is target-owned — the source
cannot know what its entity means over there — and it has parts that each
need a decision:

- **Copy, move, or link.** Does the entity leave the source, duplicate, or
  does the target hold a reference to the original? The convention that
  crossing an ownership boundary defaults to *copy or link* (the source
  keeps its thing) and staying within one defaults to *move* matches most
  users' mental model, but whichever is chosen must be shown during the
  drag, not discovered after it — and where a modifier toggles it, the
  in-flight cursor or badge reflects the current meaning continuously.
- **Where, in target terms.** The pointer position must map into the
  target's own geometry — a time on a sequence, a cell in a grid, a slot in
  a hierarchy — with the same previewed-promise discipline as any insertion
  indicator: the preview is computed by the target from target geometry,
  and the drop lands exactly where the preview said.
- **Whose rules.** The drop enters the *target authority's* validation door
  ([ownership-boundaries](ownership-boundaries.md)); the source's
  permissions got the drag started, but only the receiving domain can judge
  the placement it is being asked to accept.

## Dwell: targets that open under the pointer

Handoffs often need navigation mid-drag — hovering a collapsed group, a tab,
a folder to make it open so the real target becomes reachable. Dwell
(spring-loading) is the standard answer, and it is a nest of mode resources:

- the dwell threshold is long enough that passing over does not open
  (sub-second passes must be inert), short enough not to feel like begging;
- an *arming cue* precedes the open — the hovered container signals that
  continued hovering will open it — so opens never feel random;
- every dwell timer names its reaper: pointer leaves, drag ends, mode
  cancels — the timer dies with the condition that started it. A leaked
  dwell timer opens a container after the drop, which reads as the
  interface acting on its own;
- what dwell opened, cancel un-opens. If the drag ends without a drop, the
  navigation the drag caused rewinds — the user did not choose to be there;
  the gesture did.

## The mode is still one mode

A handoff spans surfaces but remains a single drag: one lifecycle, one
cancel that restores *both* sides (the source's placeholder, the target's
previews, anything dwell opened), one cleanup that runs whichever surface
the pointer happens to be over when the mode ends. The bug class unique to
handoffs is split-brain teardown — source and target each cleaning up "their
half" on different triggers, leaving one side haunted when the mode ends on
the other. Structure it as the [drag-lifecycle](drag-lifecycle.md) demands:
the mode has one owner, and both surfaces subscribe to it.
