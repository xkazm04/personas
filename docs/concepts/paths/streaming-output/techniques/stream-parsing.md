---
layer: technique
subject: streaming-output
technique: stream-parsing
status: forged
laws: [one-authority-per-vocabulary, failure-not-empty-success]
shared_with: []
---

# Stream parsing

The parser is the boundary where transport ends and meaning begins. Below it:
chunks — arbitrary byte windows cut wherever the transport felt like cutting
them. Above it: **typed events** — content delta, tool started, tool result,
phase marker, warning, terminal outcome — each a self-describing record the
rest of the system can attribute, buffer, count, and act on. Nothing above
the parser ever touches raw transport, and the parser emits nothing untyped.
Every clean streaming architecture has this boundary; every haunted one has
consumers doing substring surgery on an accumulating string.

## Framing before parsing

A stream has two grammars stacked: the **framing** (how the byte flow divides
into units — commonly one record per line, sometimes length-prefixed blocks
or blank-line-separated groups) and the **payload** (what each unit means).
Separate them. The framer's only job is to cut chunk flow into complete
frames; the payload parser's only job is to turn one complete frame into one
typed event. Fusing them produces the classic corruption: a payload parser
fed a torn frame.

Two framing rules are non-negotiable:

1. **Carry the tail.** A chunk boundary falls mid-frame more often than not.
   The framer holds the unterminated remainder and prepends it to the next
   chunk; it never parses it, never discards it, and never assumes chunk
   boundaries mean anything. The most common streaming parser bug in the wild
   is a correct parser applied per-chunk instead of per-frame — it works in
   testing (small payloads arrive whole) and shreds in production.
2. **Bound the frame.** A frame that never terminates — a missing delimiter,
   a length prefix pointing at the horizon — must not buffer without limit.
   Past a stated size cap the framer declares the frame malformed, surfaces
   it through the malformed policy below, and resynchronizes at the next
   delimiter. A framer without a cap is an invitation for one corrupt frame
   to consume all memory. And the cap is enforced by **routing, never by
   mutation**: an oversized frame is handed onward whole to the diagnostic
   channel and skipped by the payload parser — not clipped and then parsed.
   A framer that truncates a frame and hands the mutant to the parser
   manufactures malformed input out of valid input; the parser rejects its
   own framer's output, the rejection is indistinguishable from noise, and
   the record vanishes without a trace at exactly the sizes where it
   carried the most.

## One event vocabulary, defined once

The set of event types is a closed vocabulary with exactly one authoritative
definition, shared by producer and consumer — the serialization schema, the
type union, and any cross-language mirror all derive from it
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
Two hand-maintained copies of the event vocabulary drift precisely when
someone adds an event type, and the symptom is silent: the consumer that
missed the memo treats the new type as noise.

Which is why the vocabulary needs an escape hatch designed in from the start:

- **Unknown event types are forwarded, not dropped.** The parser wraps an
  unrecognized-but-well-formed frame as an explicit *unknown* event carrying
  the raw payload. Downstream chooses what to do (usually: count it, show
  nothing). This is the forward-compatibility contract that lets the producer
  evolve ahead of the consumer without every deployment being a lockstep.
- **Unknown fields inside known events are ignored, known fields are
  validated.** Tolerant in shape, strict in meaning.

## Interleaved noise

Real producers are dirty: diagnostic lines, progress chatter, and the
producer's own logging arrive interleaved with the framed stream on the same
channel. The parser's stance is *tolerant framing, strict payloads*: a line
that does not parse as a frame at all may be classified as noise and routed
to a diagnostic side-channel (visible in a debug view, counted), while a line
that frames correctly but carries a corrupt payload is **malformed** — a
different category with a different policy. Collapsing the two means either
crashing on log chatter or silently eating corrupt data; both are wrong.

## The malformed-frame policy

Every parser has a malformed-frame policy; the only question is whether it
was chosen or inherited from an exception handler. The chosen one:

1. **Count it.** A counter of malformed frames per run, carried into the
   settled record. Zero and "the parser was never exercised" must be
   distinguishable ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
2. **Keep a sample.** The first few malformed payloads, size-capped, so the
   defect is diagnosable after the fact without re-running.
3. **Emit a diagnostic event.** Malformation is itself an event in the typed
   stream — downstream may render an unobtrusive notice when the count is
   nonzero. A parser that swallows malformed frames converts producer bugs
   into missing output, and missing output is undetectable by anyone who
   doesn't already know what should have arrived.
4. **Resynchronize and continue.** One bad frame does not end the run; the
   framer skips to the next frame boundary. Ending the stream on first
   malformation turns a cosmetic producer bug into a total outage.

## Incremental payloads

Some events carry structured payloads that are themselves large — a nested
result arriving over many frames, or one frame whose payload is enormous. Two
acceptable strategies, one forbidden:

- **Accumulate to completion under a cap**: buffer the pieces, parse once
  when the unit is complete, subject to the same size bound as framing.
- **Parse incrementally**: a resumable parser that consumes pieces as they
  arrive and yields partial structure. More machinery; justified when
  partial structure is actually rendered.
- **Forbidden: re-parse the accumulated whole on every arrival.** Parsing an
  ever-growing buffer per chunk is quadratic in stream length — invisible in
  short tests, a frozen interface on the first long run.

## What the parser owes its consumers

- Events in **arrival order**, exactly once each — the parser neither
  reorders nor deduplicates; those are attribution's problems.
- **No blocking**: parsing happens at wire speed and hands off; anything
  expensive (rendering, persistence) lives behind the buffer, not inside the
  parser.
- **A terminal event, always** — where the producer's protocol has an
  explicit end-of-stream marker, the parser forwards it; where transport
  closes without one, the parser *synthesizes* a distinct
  transport-closed event. Downstream must never infer termination from the
  absence of further events; silence is a fact about the network, not about
  the run.
- **Data, not prose.** The parser emits typed events carrying the fields;
  it never emits pre-formatted display strings as the primary channel.
  A channel of formatted strings is write-only knowledge: nothing
  downstream can filter, count, or re-render what the formatter chose not
  to say, even though the bytes arrived. Formatting is the view's job, at
  the end of the pipeline, from the typed event.

## Fixtures come from captured bytes

Test the parser against frames the producer actually sent — captured from a
real session and committed — not against examples written by hand. An
invented fixture encodes its author's belief about the wire format, and the
author's belief is precisely the thing under test: parser and fixture share
one imagination, so the test can only confirm it, and it stays green for
years against a shape the producer never once emitted. A captured corpus
also ages honestly — when the producer's format evolves, re-capturing
updates the fixtures from reality instead of from memory.
