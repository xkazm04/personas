---
layer: technique
subject: tracing
technique: raw-record-viewers
status: forged
laws: [count-carries-predicate, failure-not-empty-success]
shared_with: []
---

# Raw record viewers

The waterfall answers *which span*; the raw record answers *what happened
inside it*. Beneath every structural view there must be a floor of viewers
that render the actual payloads — the request that was sent, the response
that came back, the log lines, the terminal output — because the structure's
job is to **localize**, and localization without inspection strands the
investigation at "something in here was slow". The floor is also the humility
layer: when the span model missed something, the raw record is where the
truth still lives, so the viewers must render what is actually there, not
what the schema expected.

Three viewer species recur, plus rules they all share.

## Structured-payload viewers

Hierarchical data — request bodies, tool arguments, configuration snapshots —
is rendered as what it is:

- **Syntax-aware highlighting** that distinguishes keys, strings, numbers,
  booleans, and nulls; a wall of monochrome brackets hides exactly the "this
  field is a string, not a number" class of defect that payload inspection
  exists to catch.
- **Collapse by subtree** with the collapsed row stating what it hides
  ("… 214 items") — a bare ellipsis is a count without a predicate.
- **Copy that copies the truth**: copying yields the raw value, not the
  display transform — not the truncated rendering, not the highlighted
  markup, not a re-serialization that reordered keys. Investigations continue
  in other tools, and a copy that differs from the record poisons them.
- **Invalid input renders as text with the failure stated.** A payload that
  fails to parse is displayed raw, labeled "not parseable as structured data:
  <reason>" — never a blank panel, never a crashed viewer. Malformed payloads
  are the *interesting* ones; the viewer that dies on them fails at its
  moment of maximum value
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

## Log viewers

Line-oriented records with per-line classification:

- **Severity is derived from the line's shape** — a structured level field
  when present, recognizable markers when not — and the derivation is honest:
  a line matching no rule renders *unclassified*, not silently "info".
  Classification is a claim; a viewer that paints unknown lines as normal has
  promoted absence-of-match to a verdict.
- **Classification drives emphasis, not censorship.** Errors and warnings
  are visually loud, and filtering by severity is offered — but the default
  view is the whole record, because the line that explains a failure is
  routinely an innocuous-looking one three lines before the loud one.
- **Timestamps align with the trace.** Where lines carry times, the viewer
  can situate them against the owning span's interval — the bridge between
  the structural floor and this one.

## Terminal-output viewers

Captured console output arrives with control sequences embedded — color
codes, cursor movement, progress-bar rewrites. The rule: **interpret or
strip, never leak.** Raw escape bytes rendered as text are noise that buries
the content. Interpretation renders the colors and styles the producer
intended (mapped through the product's own palette, both themes); stripping
yields clean text; either is honest. Progress rewrites (the same line redrawn
hundreds of times) are collapsed to their final state with the rewrite count
noted — replaying them as hundreds of lines is technically faithful and
practically unreadable.

## Rules all viewers share

- **Bounded rendering with honest truncation.** Payloads are unbounded;
  viewport memory is not. Render up to a stated budget and mark the cut —
  "showing first N of M lines / bytes" with the full record reachable
  (download, copy-all, paging). The count and its predicate travel together
  ([count-carries-predicate](../../_laws.md#count-carries-predicate)); an
  unmarked cut turns the viewer into a fabricator of shorter records.
- **The viewer never mutates the record.** All transforms — highlighting,
  collapsing, redaction, pretty-printing — are presentation-layer and
  re-derivable from the stored bytes. The stored record is evidence;
  evidence is read-only.
- **Redaction is a marked transform.** Secrets and credentials are masked at
  display with a visible placeholder — never removed silently, which changes
  the record's apparent shape, and never left visible because "it's an
  internal tool". (Better: sensitive values are masked before storage, at
  capture, so the viewer's redaction is a second fence, not the only one —
  the [credential-vault](../../credential-vault/credential-vault.md) subject
  owns that boundary.)
- **Search within the record**, with match counts and navigation — at
  payload sizes worth a viewer, scrolling is not a search strategy.
- **Provenance stays attached.** Every raw record renders under its owning
  span's identity, name, and time interval, so a screenshot or a copied
  excerpt still says which operation of which run it came from.
