---
layer: technique
subject: structured-output
technique: extraction-strategies
status: forged
laws: [failure-not-empty-success]
shared_with: []
---

# Extraction strategies

The extractor's input is settled model text; its output is either a
**candidate structure** handed to validation, or the fact that no candidate
exists. Its job is purely syntactic — find the payload the model *meant* to
send inside whatever it *actually* sent — and it does that with an **ordered
ladder of strategies**, tried cheapest-and-most-reliable first, where the
first success wins and the strategy that fired is recorded.

The ladder is a contract, not a grab-bag: each rung states what it accepts,
what it can never mis-fire on, and why it sits where it sits. Reordering the
rungs changes behavior on real traffic, which is why the order is written
down and tested, not emergent from an if-else chain someone kept appending
to.

## The ladder

1. **The whole text parses.** Try the entire settled output as one payload
   first. When the producer behaved — and constrained decoding or a
   well-tuned prompt makes this the common case — every later rung is dead
   code for that turn. This rung must come first for a subtle reason: any
   span-hunting rung applied to an already-clean payload can find a *smaller*
   valid span inside it (a nested object) and truncate silently.

2. **Fenced blocks.** Code fences are the model's most common wrapper, with
   or without a language label, and the label is frequently wrong — match
   the fence, not the label. When multiple fences exist, the policy is
   explicit: prefer the fence that parses *and* validates furthest, and
   record that multiple candidates were seen (a multi-candidate turn is a
   prompt-drift signal worth counting).

3. **Balanced-span detection.** No fence, payload embedded in prose: scan for
   the first plausible opener (an opening brace or bracket), then walk to its
   balanced closer, respecting string escapes — never with a regular
   expression, which cannot balance nesting and *will* match a brace inside a
   quoted string. If the first span fails to parse, continue to the next
   opener rather than giving up: prose containing a brace before the payload
   ("use the {name} placeholder…") is common.

4. **Longest-valid-span.** When spans are torn — the producer stopped early,
   or truncation clipped the tail — the aggressive rung asks: what is the
   longest prefix (or interior span) that parses? This rung is powerful and
   dangerous in proportion: it can rescue a 95%-complete artifact, and it can
   also present a half-object as whole. Therefore it **always marks its
   output as recovered-partial**, and validation decides whether the schema's
   required fields survived. A partial that validates is usable; a partial
   presented as complete is a lie with a delay fuse.

5. **Tolerant syntax repair.** Mechanical near-miss fixes with no semantic
   judgment: trailing commas, typographic quotes straightened,
   unquoted-but-unambiguous keys, a missing closing bracket at end-of-text.
   The repairs permitted here are enumerated, each one deterministic and
   meaning-preserving by construction. The moment a "repair" requires
   guessing what the model meant, it is not syntax repair — it is the
   model-assisted repair loop's job
  ([schema-validation-and-repair](schema-validation-and-repair.md)), where
   the producer itself resolves the ambiguity.

6. **Prose fallback — only where the contract says so.** Some flows have a
   defined degraded mode: if no structure is found, the whole text is
   accepted *as* the artifact's designated prose field (a report whose
   structured sections could not be recovered still has value as a
   document). This rung exists only when the schema explicitly models it —
   a fallback the schema does not know about is corruption wearing a
   friendly face. Flows without a defined degraded mode skip this rung and
   fail honestly.

## Rules that hold across every rung

- **Strategies find candidates; validation judges them.** No rung consults
  the schema beyond "does it parse". The moment a strategy starts checking
  fields, validation has a second door, and the second door is where the
  next engineer's bug lives.
- **The fired strategy travels with the candidate.** "Parsed clean at rung 1"
  and "recovered by longest-valid-span at rung 4" produce different
  confidence and different observability; erasing the distinction throws
  away the cheapest drift signal the pipeline has
  ([extraction-observability](extraction-observability.md)).
- **Bounded input.** The extractor runs under the same size discipline as
  every parser fed by an unbounded producer: a stated cap on the text it
  will scan and the payload it will parse, enforced before allocation, with
  over-cap treated as an extraction failure carrying that reason — not a
  freeze, and not a silent clip.
- **No candidate is not an error — it is a result.** The ladder exhausting
  itself yields the explicit no-candidate outcome, with the head and tail of
  the scanned text retained (size-capped) as evidence. A ladder that throws
  on rung 6 and a ladder that found nothing must be distinguishable from
  each other and from a ladder that never ran
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

## Fixtures come from real turns

The extraction ladder is tested against **captured model outputs** — real
turns, including the ugly ones that motivated each rung — not against
hand-typed examples. A hand-written fixture encodes its author's belief about
how models misbehave, and models misbehave more creatively than authors
believe. Every production extraction failure is a fixture candidate: capture
it, add it, and the ladder's regression suite becomes a museum of everything
the producer has ever actually done.
