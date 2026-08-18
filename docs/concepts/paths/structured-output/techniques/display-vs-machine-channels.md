---
layer: technique
subject: structured-output
technique: display-vs-machine-channels
status: forged
laws: []
shared_with: []
---

# Display vs machine channels

One model turn, two products: the **machine artifact** (validated structure
the system acts on) and the **display text** (words the human reads). They
have different consumers, different failure modes, different retention
rules — they are different products that happen to share a birth. The
technique is the discipline of separating them at the extraction boundary
and never letting either impersonate the other.

## The two bans, stated first

1. **Never show the user the raw machine payload.** A wall of serialized
   structure in a conversation is a usability failure (unreadable), a trust
   failure (the user treats it as authoritative prose, quotes it, edits it),
   and frequently a disclosure failure (machine payloads carry ids,
   internal names, and scaffolding never meant for eyes). Where the user
   should see *that something was proposed*, they see a purpose-built
   presentation — a card, a summary line, an approve/inspect affordance —
   rendered **from the validated artifact**, not from the raw span.
2. **Never parse the display channel.** The display text is a rendering,
   optimized for a human, subject to copyediting, localization, and model
   phrasing whims. Any consumer that regexes data back out of it has built
   a parser for an interface with no contract, and it will break on the
   first prompt tweak that changes a preposition. If a machine needs a
   value, the machine channel carries it or the pipeline is incomplete —
   the fix is upstream in the schema, never a scraper downstream.

## Cleaning the display text

The settled turn arrives with the machine payload embedded — fenced,
spanned, or interleaved. Producing the display channel means **removing the
payload spans** and healing the text around them:

- Removal uses the **extractor's own span boundaries** — the same offsets
  that produced the candidate. A second, independent "find the payload
  again for cleanup" pass is a second implementation of extraction that
  will disagree with the first on exactly the ugly inputs, leaving half a
  payload visible or eating a paragraph of prose.
- Healing is cosmetic and conservative: collapse the double blank line the
  removal left, drop a now-dangling introduction ("Here is the
  configuration:") only when it matches an enumerated set of scaffold
  phrases. Aggressive cleanup that summarizes or rewrites is the display
  channel drifting from what the model said — the user should read the
  model's words, minus the machine parts.
- **Where a payload was removed, something visible may take its place** —
  an inline card, a reference chip ("proposed 3 changes — review"), or
  nothing, per the flow's design. But the *decision* is per-flow and
  explicit; payload removal that silently deletes the only evidence the
  turn did anything reads to the user as a model that ignored them.

## Failure modes are per-channel

The channels fail independently, and the four quadrants are all real:

| Machine | Display | Outcome |
| --- | --- | --- |
| artifact valid | text present | the normal turn |
| artifact valid | text empty (model emitted only the payload) | render the presentation; synthesize no fake prose — an empty narration is honest |
| extraction failed | text present | show the text; surface the extraction failure as its own state, not silence |
| extraction failed | text empty | the turn failed for the user's purposes — say so |

The third row is the one implementations get wrong by omission: the prose
reads fine, the payload was garbage, and nothing tells the user the action
half of the turn is missing. The display channel rendering *plus* an
extraction-failed indicator is the honest composite.

## Retention differs too

The machine artifact is the system of record — retained, versioned,
auditable, the input to the downstream gate
([hitl-approval](../../hitl-approval/hitl-approval.md) when the artifact
proposes consequential actions). The display text is conversational
history. The raw settled text — the only witness to what the model
actually emitted — is retained size-capped on failure for diagnosis, and
may be dropped on success once both products are derived. Conflating the
three retentions either bloats the record store with prose or, worse,
leaves the machine artifact reconstructible only from a chat log —
which is the never-parse-display ban violated at rest instead of in
flight.
