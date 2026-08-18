---
layer: technique
subject: chat-transcript
technique: markdown-and-code-rendering
status: forged
laws:
  - one-validation-door
shared_with: []
evidence:
  - src/features/shared/components/editors/MarkdownRenderer.tsx  # the shared door: no raw markup pass-through, link sanitization, copy-source via tree flatten, long-code collapse, wrap toggle
  - src/lib/utils/sanitizers/sanitizeUrl.ts                    # the link scheme policy the renderer applies
---

# Markdown and code rendering

The machine's half of the transcript arrives as lightweight markup — prose
with emphasis, lists, tables, links, and code — and the transcript renders it
richly because rich text is dramatically more readable than raw source. That
convenience has two sharp edges this technique exists to hold: the text is
**authored by an inducible system** and must be rendered as untrusted
content, and during streaming it is **structurally incomplete** and must
render stably anyway.

## One sanitizing door

All model-authored text reaches the renderer through **one door** that owns
the safety policy, per
[one-validation-door](../../_laws.md#one-validation-door). Every transcript
surface — the live turn, settled history, previews, quoted excerpts, exports
— renders through that same door; a second renderer "just for the preview"
is the unsanitized hole someone finds later. What the door enforces is
prompt-safety's policy (the reasoning lives in
[model-output-as-untrusted](../../prompt-safety/techniques/model-output-as-untrusted.md)
and
[output-sanitization](../../prompt-safety/techniques/output-sanitization.md));
the transcript-shaped consequences:

- **Markup is neutralized, never interpreted raw.** Whatever embedded markup,
  scripts, styles, or event attributes the text smuggles, the renderer emits
  inert text or strips it — nothing model-authored executes or restyles the
  page.
- **Links carry policy.** Scheme allowlist (no script-in-a-link schemes),
  no delegated window control, and the displayed text of a link is not
  trusted as its destination — a link whose label is one address and whose
  target is another is a phishing shape the renderer must expose, by showing
  the true destination on hover/long-press or interstitial.
- **Remote content does not load implicitly.** Model-referenced images and
  embeds are a tracking/exfiltration channel if fetched on render;
  the policy decides (block, proxy, or click-to-load), the renderer obeys.
- **Model text cannot impersonate chrome.** Rendered output is visually
  contained within the turn; markup that mimics the surface's own controls
  (buttons, cards, system banners) must not be renderable — the structured
  row registry, not model prose, is how interactive elements enter the
  transcript (see [inline-structured-rows](inline-structured-rows.md)).

## Code is displayed, not interpreted

Code blocks are the transcript's most-copied content, and their contract is
verbatim fidelity:

- **What is copied is the source text** — exactly, unstyled, untransformed.
  Smart quotes, ligatures, auto-hyphenation, or wrapped-line artifacts
  applied to code destroy it silently at paste time; typography stops at the
  fence.
- **Every code block carries a copy affordance**, and the affordance reports
  success. Selecting inside a scrollable, syntax-highlighted block is
  fiddly; the button is the primary path.
- **Long lines scroll inside the block.** A wide line widens neither the
  bubble nor the page; the block is its own horizontal scroll container.
  The transcript's column must survive any content.
- **The language label is a hint, not a trust signal.** Highlighting is
  cosmetic; a block labeled as one language containing another must render
  fine, because the label is model-authored too.
- **Inline code stays inline** — literal, styled distinctly, never
  line-broken mid-token where avoidable.

Prose gets the mirrored courtesy: unbroken tokens the model loves to emit —
long identifiers, addresses, hashes — wrap by force rather than widening the
column.

## Streaming-stable incremental rendering

Mid-stream, the text is a prefix of a document: fences unclosed, emphasis
half-open, a table missing its body, a link half-written. Naive re-parsing
of the growing text flickers — content renders as prose, then reinterprets
as a block when the closing marker arrives, jumping layout every time. The
stability rules:

- **Parse with provisional closure.** An unterminated construct is rendered
  *as if closed at the current tail* — an open fence renders as a code block
  growing line by line, not as prose that becomes a block seconds later.
  The interpretation of already-rendered content never regresses; new
  characters extend, they do not reclassify what the user already read.
- **Settled blocks are inert.** Completed constructs above the live tail do
  not re-parse or re-render per increment; only the trailing incomplete
  construct is live. This is the transcript's cost bound — without it,
  rendering cost grows with turn length and the longest answers are the
  jankiest.
- **Dangerous ambiguity resolves conservatively.** While a construct's
  nature is genuinely undecidable (is this pipe a table or prose?), render
  the plainer reading; upgrading presentation later is a smaller lie than
  downgrading it.
- **Sanitization applies to every intermediate state.** The door (above)
  processes each provisional render, not just the settled text — a smuggled
  construct that "exists" only mid-stream is still on screen.

At settlement, one final parse of the authoritative settled text replaces
the provisional tail — quietly identical to what is on screen in the normal
case, and the correcting authority in the edge cases.
