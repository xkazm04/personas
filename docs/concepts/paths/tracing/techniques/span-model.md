---
layer: technique
subject: tracing
technique: span-model
status: forged
laws: [one-authority-per-vocabulary, identity-survives-reuse]
shared_with: []
---

# Span model

Everything else in this subject — capture, propagation, rendering, rollups —
assumes that every producer and every viewer agree on what a span *is*. This
technique is that agreement: one schema, defined once, spoken by the process
that runs the engine, the process that renders the interface, and every
producer in between. The test is brutal and simple: **take a span from any
producer, hand it to any viewer, and it renders in the same waterfall with no
adapter.** The moment one surface needs a translation layer, there are two
models, and they are already drifting.

## The fields, and why each earns its place

A span is a small, closed record:

- **`id`** — minted once, at the moment the operation starts, unique within
  the trace at minimum. It is the only thing other spans may use to point at
  this one. Positions, timestamps, and names are all disqualified as identity:
  positions shift under concurrency, timestamps collide under fan-out, names
  repeat by design ("model call" appears forty times per run). Identity must
  survive reordering, reuse, and restart
  ([identity-survives-reuse](../../_laws.md#identity-survives-reuse)).
- **`trace_id`** — which run this span belongs to. Every span carries it, so
  a span is self-locating even when it arrives alone (from a queue, from
  another process, out of order).
- **`parent_id`** — the structural fact. Null exactly once per trace (the
  root, which *is* the run). Everything the waterfall shows as nesting is
  this field and nothing else; see the containment rule below.
- **`kind`** — a **closed vocabulary** of operation species: the run itself,
  a phase or stage, a model call, a tool invocation, a subagent, a storage
  operation, a network call, a queue wait. Kinds drive icons, colors, default
  aggregations, and filtering. The set is small (single digits to low teens),
  extended deliberately, and defined in exactly one place that every producer
  and viewer derives from
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
  A free-text kind is not a kind; it is a name wearing a kind's clothes, and
  every consumer ends up pattern-matching on it.
- **`name`** — the human-readable label for *this* operation: the tool's
  name, the model's name, the stage's title. Names are for reading, never for
  joining, filtering logic, or identity. And a name is a **constant chosen by
  a person**, with the instance data ("which tool", "which credential")
  carried in attributes beside it — never a label computed from a value's
  debug rendering, reflection, or ordinal position. A computed label cannot
  be searched, cannot be aggregated, retroactively changes meaning when the
  source type is reordered, and is unreadable at the exact moment someone
  needs to read it.
- **`start` / `end`** — timestamps in one declared clock domain per producer.
  `end` is absent while the span is open; an open span is a first-class state,
  not a malformed record. Duration is *derived* from the pair — storing it
  separately creates a second authority that disagrees after the first
  clock-skew correction.
- **`status`** — a **closed vocabulary**, and a separate axis from kind:
  *running*, *ok*, *failed*, *cancelled*, *interrupted* (ended abnormally by
  something other than the operation itself — process death, finalization
  sweep). Failed spans carry a failure category drawn from the product's one
  failure taxonomy, not a per-producer invention. The distinction between
  *failed* (the operation reported its own failure), *cancelled* (a human or
  policy stopped it), and *interrupted* (the world stopped it) is load-bearing:
  they lead to different next actions and must never collapse into one color.
- **`attributes`** — the decoration: typed key–value pairs for everything
  specific to the operation. Token counts, monetary cost, model identifier,
  retry ordinal, input sizes. Namespaced keys, bounded total size, and a hard
  rule: **attributes never carry the payload.** Requests, responses, and logs
  live in the raw record store and are referenced by id from an attribute.
  A span is a skeleton entry; the skeleton stays light enough that reading a
  ten-thousand-span trace is a scan, not a download.

## Parentage is a reference, not a coincidence of timing

The tree is assembled at read time from `parent_id` references. The tempting
shortcut — infer containment from intervals ("B started after A and ended
before A, so B is inside A") — produces correct trees exactly when traces are
boring, and fabricates structure the moment two children overlap, a producer
fans out, or clocks skew across a boundary. Concurrency is when a trace is
worth reading; an inference that breaks under concurrency is worse than no
tree, because it renders *plausible wrong structure* with full confidence.

Corollaries:

- A child may **outlive** its parent record's arrival: spans arrive out of
  order from queues and processes, so the assembler parks orphans and links
  them when the parent lands — and reports parents that never land, rather
  than silently reparenting to the root.
- The parent of an operation is the operation that *caused* it, not the one
  that happened to be open. In fan-out, ten children share one parent and
  overlap each other; the model must represent that without contortion.

## Quantities live on the span that incurred them

Cost, tokens, sizes, and counts are attributes of the span that spent them,
written when they become known — usually at span close. This is what makes
every rollup a fold over the tree instead of a join across ledgers. A
producer that knows its cost only for the whole run records it on the root
and *does not apportion it downward as if measured* — apportionment is an
estimate, and estimates are labeled as such (see
[synthetic-and-estimated-traces](synthetic-and-estimated-traces.md)).

Two rules keep the quantities trustworthy, and both are violated constantly:

- **Absent and zero are different measurements.** "I did not find out" is
  absence; "it was zero" is a datum. Collapsing the first into the second at
  the write is irreversible for the life of the record, and it fails in the
  worst direction: the healthiest-looking value becomes the one that means
  "no idea". A quantity read out of another program's output earns extra
  suspicion — when the expected field is missing, that absence is a finding
  to surface at least once, never a silent default of zero. The renderer
  then draws absence as absence (a dash, "not measured"), not as a number.
- **A field needs a producer before it gets a renderer.** A quantity that
  only the schema and a viewer believe in makes the surface confidently
  wrong — a tile rendering a sum nobody writes displays zero forever, which
  is worse than a surface that admits it does not know. Adding the field,
  its producer, and its display is one change; a field added "for later"
  is a standing lie deferred.

## One model, many producers — the discipline that keeps it one

- **The schema is defined in one authority** and every language boundary
  consumes a derived form of it — generated, mirrored with parity checks, or
  otherwise incapable of silent divergence. Two hand-maintained span structs
  on two sides of a process boundary are the vocabulary race the law names.
- **Producers extend by attribute, never by shape.** A new feature that needs
  a new fact adds a namespaced attribute; it does not add a field, a parallel
  record type, or a "stage" that is a span with different spelling.
- **Viewers consume the model, not a producer.** A viewer keyed to one
  producer's habits ("the engine always emits phases as top-level spans") is
  a fork of the model in disguise; the waterfall must render a tree it has
  never seen before, correctly, from the schema alone.
