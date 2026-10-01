# Twin Card renderer contract `twin-card.render/1`

How a Twin Card becomes the text a language model receives when it drafts in the person's voice. A card is portable only if two tools render it the same way: same sections, same order, same limits. This contract fixes the **core block**; each tool keeps its own **task framing** around it (reply to a message, comment on a page, answer a training question).

The Personas implementation is `compile_twin_core` in `src-tauri/src/engine/twin_prompt/`, used by every drafting lane in the app (reply, browser page, training answer simulation, setup). It builds its input either from the app's database or from an imported card, so a card exported from Personas renders byte-identically in Personas.

## Inputs

- the card (`identity`, `voice`, optional unsealed `knowledge`)
- the target `channel` id
- optional extra context the tool supplies (a knowledge-base excerpt, the message being answered) - this is task framing, outside the core block

## Channel resolution

1. Use the `voice.channels[]` entry whose `channel` equals the target.
2. Else the entry for `voice.default_channel`.
3. Else the first entry.

## The core block, in order

Each section is omitted entirely when it has nothing to say; no empty headings.

1. **Identity.** `You are writing as <name>` + `, <role>` when present + `.` Then `bio` when present. Then, when `grammatical_gender` is present and the output language inflects by it: `Use <masculine|feminine|neutral> grammatical forms when <name> refers to themselves.`
2. **Languages.** When `languages` is non-empty: `<name> writes in <languages, by display name, in order>. Reply in the language of the message being answered unless told otherwise.`
3. **Standing directions.** `voice.standing_directions`, verbatim.
4. **Channel voice** (the resolved channel):
   - `directives`, verbatim, when non-empty;
   - `Length: <length_hint>` when present;
   - when `style` is present and `directives` is empty: one line per dimension using the `twin-card.style/1` level words (`Formality: consultative.`);
   - **exemplars**: up to **5**, most recent first, each cut at **500 characters** (cut at a word boundary, marked with an ellipsis), introduced as messages the person actually wrote on this channel, to be matched in register, length and habits but never copied;
   - **constraints**: up to **8**, each cut at **160 characters**, as a do/don't list.
   Exemplars and constraints are rendered even when `directives` is empty.
5. **Facts.** Up to **12** `knowledge.facts` (then `knowledge.memories` content) by importance, then recency, each one line. Introduced as things the person has confirmed; the model must not state anything verifiable beyond them.
6. **Quality rules.** `voice.quality_rules.register`; then the avoid list (`avoid_phrases`), the filler openers, and the dash rule (`dash_policy: avoid` -> "Join clauses with commas and full stops rather than dashes").

## Untrusted text

Anything the tool adds from outside the card (a web page, an inbound message) MUST be fenced and labelled as untrusted content to answer, never as instructions. The card itself is trusted only as far as its signature state allows; a consumer MAY refuse to render an `invalid` card.

## Conformance

A renderer conforms when, for the example cards in `examples/`, it produces the same section order, applies the same limits and omits the same empty sections. Wording of connective sentences MAY differ; the selection and order MUST NOT.
