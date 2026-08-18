---
layer: technique
subject: voice-io
technique: spoken-intent-parsing
status: forged
laws: [one-validation-door, failure-not-empty-success]
shared_with: []
---

# Spoken intent parsing

Between "the engine produced a transcript" and "the product did something"
sits a crossing: free text, produced by a statistical guess about noisy
audio, must become a **typed command** — or visibly fail to. This technique
owns that crossing. It exists because the two naive designs both fail in
production: substring-matching the raw transcript fires on accidents and
misses paraphrases, and shipping the transcript to a general language
understander turns a millisecond decision into a slow, unauditable one. The
middle path — constrained grammars, staged normalization, cost-gated
confirmation — is small, fast, and honest about what it heard.

## Constrain the grammar to the decision point

The central insight: at any moment the product listens for a command, the
set of *valid* utterances is small and known — the visible choices, a
handful of verbs, yes/no, digits. Parsing against that **closed, contextual
grammar** succeeds where open interpretation cannot, because the grammar
supplies the error-correction the transcript lacks: with five valid targets,
a transcript that garbled one word still lands, while an open parser would
need the garbled word to mean something.

The corollary is that the grammar is *per decision point*, assembled from
what is actually actionable right now — options currently on screen, indices
of visible items, verbs whose targets exist. A spoken command matching
yesterday's grammar ("approve" when nothing awaits approval) is an
unmatched utterance, not a stale action.

## Normalize before matching — transcripts don't spell like keyboards

Transcripts arrive without reliable punctuation or casing, with numbers in
either form ("three" / "3"), with filler ("um, yes go ahead"), and with
homophones resolved by the engine's luck. The parser therefore runs a
normalization ladder before any matching: case-fold; strip punctuation and
filler tokens; fold number words to digits (and keep both forms as match
candidates — "for" is a preposition and a homophone of a digit); collapse
whitespace. Matching then proceeds in **strictness order**:

1. exact match against the grammar;
2. synonym sets — each command declares its spoken aliases ("yes" / "yeah" /
   "confirm" / "go ahead"), because people do not speak menu labels;
3. contained keyword match, for command words embedded in a sentence
   ("could you approve that one");
4. bounded fuzzy match with a threshold — tolerating one engine-garbled
   token, never inventing an interpretation from whole cloth.

Each rung is weaker evidence than the one above, and the rung that matched
travels with the result: a downstream confirmation policy is entitled to
know whether it is acting on an exact match or a fuzzy rescue.

## One parsing door per channel

The transcript-to-command mapping for a listening channel lives in **one
place** ([one-validation-door](../../_laws.md#one-validation-door)) — one
parser that takes (transcript, current grammar) and returns a typed result.
The drift mode of scattering it is concrete and severe for voice: three
surfaces each grow private matching for "yes", a synonym gets added to one,
and the product now agrees with the user in one dialog and ignores the same
word in another — an inconsistency users experience as "voice control is
haunted", because nothing on screen explains why identical utterances
diverge. Surfaces contribute *grammars*; they never contribute matchers.

The parser's output is a closed union, and every arm is a designed outcome:

- **matched(command, evidence)** — the typed command plus how it matched;
- **ambiguous(candidates)** — more than one command matched comparably;
  the surface disambiguates by asking, never by picking silently;
- **unmatched(heard)** — nothing matched; carried with what was heard.

## The unmatched case is a first-class outcome

Per [failure-not-empty-success](../../_laws.md#failure-not-empty-success):
an utterance that matched nothing is **shown** — what was heard, and what
could have been said ("I heard 'remove the last one' — you can say a number,
'confirm', or 'cancel'"). Silently ignoring unmatched speech is the worst
outcome available, because the user cannot distinguish "it heard me and
disagreed", "it misheard me", and "it never heard me at all" — and each has
a different fix (rephrase, re-speak, check the microphone). Echoing back the
heard text is what lets the user pick the right fix. A channel that drops
unmatched utterances trains users to repeat themselves louder, which
degrades the transcripts further.

## Confidence gates action through the cost of being wrong

Whether a matched command *executes* is decided by two inputs jointly: the
strength of the match (which rung, engine confidence, margin over the
runner-up candidate) and the **cost of the action being wrong**. Neither
alone suffices — a 99%-confident "delete everything" still deserves a
confirmation, and a 70%-confident "scroll down" does not.

| | Reversible action | Destructive / expensive action |
| --- | --- | --- |
| **Strong match** | execute; show what executed | confirm explicitly |
| **Weak match** | execute with a visible, immediate undo | confirm explicitly, or treat as unmatched |

Two rules harden the table:

- **confirmation echoes the interpretation, not the transcript.** "Delete
  item three — confirm?" tells the user what will happen; "you said 'delete
  item three'?" asks them to re-parse their own words and verifies nothing
  about what the product understood. The gap between those two is exactly
  where misinterpretation hides.
- **the confirmation itself may be spoken, but its grammar is the strictest
  in the product** — yes/no/cancel, exact or synonym rungs only, no fuzzy
  rescue. A confirmation that can be fuzzily matched into "yes" defeats its
  own purpose.

## Only finals parse; identifiers get grammars, not dictation

Two boundary rules with the rest of the subject:

- the parser consumes **final transcripts only** (the
  [stt-pipeline](stt-pipeline.md) contract): partials revise themselves,
  and a command that fired off a partial races the engine's second thoughts.
- when the expected input is an identifier — a code, a row number, a
  spelled word — the surface switches to an explicit **digit or
  letter-by-letter grammar** and displays the accumulating value as it is
  spoken. Free dictation of precise tokens is the known weak spot of every
  transcription engine; the fix is changing the grammar, not hoping the
  engine improves.
