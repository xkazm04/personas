---
layer: golden-path
subject: chat-transcript
status: forged
techniques:
  - turn-model
  - inline-structured-rows
  - progress-narration
  - transcript-scroll
  - turn-metadata
  - markdown-and-code-rendering
evidence:
  - src/features/plugins/companion/Bubble.tsx                    # one transcript row, role-dispatched; markdown body via the shared sanitizing renderer
  - src/features/plugins/companion/NarrationThread.tsx           # live narration log (bounded, "+N earlier") + collapsed "What I did — 7 steps · 48s" trail
  - src/features/plugins/companion/chat/athenaChatSession.ts     # open-at-latest behind the containerReady gate (commit d17b43d00); per-conversation initial jump; instant 'auto'
  - src/features/plugins/companion/useChatScroll.ts              # pin-to-tail within 80px band, disengage on user scroll, jump-to-latest off atBottom
  - src/features/plugins/companion/RecallStrip.tsx               # per-turn recall rollup: collapsed count line, expandable grouped chips, click-through to source
  - src/features/plugins/companion/TurnSummaryChip.tsx           # per-turn side-effect rollup below the bubble, click-through jump targets
  - src/features/shared/components/editors/MarkdownRenderer.tsx  # the one render door: no raw markup, sanitized links, copy-source-text, long-code collapse
  - src/features/agents/components/ChatThread.tsx                # streamingMessageId — the streaming turn is a flagged member of the list, not a separate element
counter_evidence:
  - src/features/plugins/companion/chat/AthenaChatProposals.tsx  # approvals/cards as end-of-transcript stacks; resolved cards are removed, not settled in place
deviations:
  - w7-chat-transcript   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Chat transcript rendering

A chat transcript is a **document that is read while it is being written**. Two
or more authors alternate turns; one of them is a machine whose output arrives
incrementally, carries embedded structure (tool invocations, approval requests,
artifacts), and cannot be trusted as markup. The user, meanwhile, is doing the
most ordinary thing in the world: reading — scrolling back, selecting text,
copying a snippet, weighing an answer. The whole discipline of this surface is
holding those two facts together: the transcript must behave like a live stream
for the writer and like a stable document for the reader, at the same time, in
the same scroll container.

That framing separates this subject from its neighbors. The mechanics of the
live token flow — parsing, buffering, throttling, run attribution — belong to
[streaming-output](../streaming-output/streaming-output.md); the transcript is
a *consumer* of that machinery, and inherits its guarantees rather than
re-deriving them. How machine-readable structure is extracted from model output
and split from display prose belongs to
[structured-output](../structured-output/structured-output.md); the transcript
renders what the display channel yields. The policy for treating model text as
untrusted belongs to [prompt-safety](../prompt-safety/prompt-safety.md); the
transcript is the render site where that policy either holds or fails. What
this subject owns is everything about the transcript **as a rendered
document**: the turn as its unit, structured events as its rows, narration
that collapses, scroll as a contract, and metadata that informs without
interrupting.

## The turn is the unit

The transcript's atom is not a message string — it is a **turn**: an entity
with a stable identity, an author role, a lifecycle, and (for machine turns) an
outcome. Everything else in this subject leans on that atomicity:

- **Identity is minted at creation and never changes.** A turn keyed by its
  position, its timestamp, or its content breaks the moment turns are
  regenerated, reordered by late arrival, or re-fetched after a reload — and a
  broken key shows up on screen as flicker, duplicated bubbles, or lost
  selection.
- **Streaming and settled are two phases of one turn, never two elements that
  swap.** The single most common structural defect on this surface is a "live
  bubble" component that unmounts when the stream ends and a "message"
  component that mounts in its place. The swap discards scroll anchoring, text
  selection, focus, and any in-progress animation — precisely at the moment the
  user starts reading in earnest. One element, one identity, a phase attribute
  that changes.
- **A failed turn is rendered as a failed turn.** In its place, styled as a
  failure, with what partial output existed and a path forward. A turn that
  vanishes because its stream died is the transcript form of failure spelled
  as empty success — the conversation's own record now denies something the
  user watched happen.

The [turn-model](techniques/turn-model.md) technique owns identity, phases,
edit and regenerate semantics, and failure rendering.

## Structured events are rows, not overlays

A conversation with a machine is not prose with interruptions — the tool call,
the approval request, the produced artifact, the error *are the conversation*,
as much as the sentences around them. The standard therefore renders them as
**first-class transcript rows**, interleaved at their true position in the
turn sequence, not as toasts, modals, or side-panel notifications detached
from the flow that produced them.

This has a consequence people resist: interactive rows live *in history*. An
approval card is answerable while pending and becomes a **record of the
decision** once resolved — same row, same position, resolved state. It never
disappears, because the transcript's other job is to be the account of what
happened; a decision with no trace in the flow that requested it is an audit
hole shaped like a UI cleanup. The
[inline-structured-rows](techniques/inline-structured-rows.md) technique owns
the row taxonomy, the dispatcher, and the interactive lifecycle. What those
rows *mean* — the approval contract itself — belongs to
[hitl-approval](../hitl-approval/hitl-approval.md).

## Progress narration collapses

While a machine turn works, the transcript narrates: reading this, invoking
that, third step of five. That narration is genuinely valuable *live* — it is
the difference between a working agent and a frozen one — and genuinely
worthless at full volume *afterward*, when the user wants the answer, not a
scroll-length diary of how it was produced.

The standard: **live detail folds into a compact trail at settlement.** The
turn keeps an honest, expandable record of what it did — step count, the
notable actions — but the settled transcript reads as a conversation, not a
process log. The collapse is a change of presentation over a durable record,
never a deletion: expanding the trail recovers the steps. The
[progress-narration](techniques/progress-narration.md) technique owns what is
shown live, what survives settlement, and the collapse itself.

## Scroll is a contract

A transcript grows at the bottom while the user may be reading anywhere. Every
defect class on this axis comes from one side breaking its promise:

- **Open at latest — after layout is ready.** A conversation opens at its most
  recent exchange. But "scroll to bottom" issued before rows have actually
  reached their rendered size lands the user mid-history with the tail below
  the fold — so the initial positioning waits on a **ready gate** that observes
  real layout stability, not a proxy like "the data arrived".
- **Follow while pinned; never yank.** While the user is at the tail, growth
  keeps the tail in view. The moment they scroll up, they have declared "I am
  reading", and the surface must not fight it — new content accumulates below,
  announced by an affordance (jump to latest, with a count), never by seizing
  the viewport.
- **Position survives navigation.** Switching threads and returning restores
  where the user was; a new thread opens at its tail. Loading older history at
  the top holds the visible content still.

The [transcript-scroll](techniques/transcript-scroll.md) technique owns the
ready gate, restoration, and the affordances; the underlying pin-to-tail flush
mechanics are owned by streaming-output's
[render-throttling](../streaming-output/techniques/render-throttling.md) and
are inherited, not reinvented, here.

## Rendered model text is untrusted content

The machine's half of the transcript is rich text — emphasis, lists, tables,
links, code — produced by a system that can be induced to emit anything. The
transcript renders that richness **through one sanitizing door**: markup is
neutralized, links carry a scheme and navigation policy, code is displayed
verbatim rather than interpreted, and nothing the model emits can execute,
exfiltrate, or impersonate surface chrome. The policy is prompt-safety's
([output-sanitization](../prompt-safety/techniques/output-sanitization.md));
the transcript is its most exposed enforcement point, because it is where
model output meets a renderer powerful enough to matter. The
[markdown-and-code-rendering](techniques/markdown-and-code-rendering.md)
technique owns the render pipeline, including its hardest corner: rich text
that must render *stably while incomplete*, mid-stream.

## Metadata belongs to the turn — and yields to reading

Machine turns accumulate facts about themselves: what they cost, how long they
took, what was recalled into context, what produced them. Those facts belong
**on the turn** — a quiet strip, legible on inspection, expandable to detail —
and never interleaved with the prose they describe. The reading flow is the
transcript's primary product; metadata is disclosure, not content. The
[turn-metadata](techniques/turn-metadata.md) technique owns the strip, the
expansion, and the honesty rules for derived numbers.

## The transcript is long-lived — render economics follow

Conversations run to hundreds of turns and stay open for hours. Two structural
rules keep that viable:

- **The settled prefix is inert.** Turns already settled do not re-render
  because the tail is streaming; a transcript whose per-token cost grows with
  its length is quadratic over the conversation's life, and long conversations
  will find it.
- **History is windowed, not eagerly total.** Older turns load on demand at
  the top, with position held stable; the initial paint is the recent window,
  which is also what the ready gate measures.

## Accessibility posture

- The transcript is a **log**: announced politely and coarsely. New settled
  turns and terminal outcomes are announced; per-token announcement is a
  firehose. Live-region semantics attach to the turn level, not the token
  level.
- Every interactive row (approval, retry, copy, expand) is reachable in
  document order — the transcript's order — and does not move or vanish while
  focused; a card resolving under focus keeps focus on its resolved form.
- Authorship is conveyed in text and structure, never only by bubble color or
  alignment.
- Voice affordances on turns (read a turn aloud) belong to
  [voice-io](../voice-io/voice-io.md); the transcript only hosts the control.

## The techniques

- [turn-model](techniques/turn-model.md) — turn identity, the
  streaming→settled phase machine, edit/regenerate semantics, failed turns
  rendered as failures.
- [inline-structured-rows](techniques/inline-structured-rows.md) — the closed
  row taxonomy, the dispatcher, unknown-row fallback, interactive cards and
  their post-settlement lifecycle.
- [progress-narration](techniques/progress-narration.md) — the live activity
  thread, the collapse to a trail, what survives settlement.
- [transcript-scroll](techniques/transcript-scroll.md) — the ready gate,
  open-at-latest, pin with user override, unseen-count affordances, per-thread
  restoration.
- [turn-metadata](techniques/turn-metadata.md) — cost/recall/provenance
  strips, expandable detail, honest derived numbers.
- [markdown-and-code-rendering](techniques/markdown-and-code-rendering.md) —
  the sanitizing render door, code blocks and copy affordances,
  streaming-stable incremental rich text.
