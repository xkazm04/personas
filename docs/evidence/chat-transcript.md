---
subject: chat-transcript
evidence:
  - src/features/companions/athena/Bubble.tsx                    # one transcript row, role-dispatched; markdown body via the shared sanitizing renderer
  - src/features/companions/athena/NarrationThread.tsx           # live narration log (bounded, "+N earlier") + collapsed "What I did — 7 steps · 48s" trail
  - src/features/companions/athena/chat/athenaChatSession.ts     # open-at-latest behind the containerReady gate (commit d17b43d00); per-conversation initial jump; instant 'auto'
  - src/features/companions/athena/useChatScroll.ts              # pin-to-tail within 80px band, disengage on user scroll, jump-to-latest off atBottom
  - src/features/companions/athena/RecallStrip.tsx               # per-turn recall rollup: collapsed count line, expandable grouped chips, click-through to source
  - src/features/companions/athena/TurnSummaryChip.tsx           # per-turn side-effect rollup below the bubble, click-through jump targets
  - src/features/shared/components/editors/MarkdownRenderer.tsx  # the one render door: no raw markup, sanitized links, copy-source-text, long-code collapse
  - src/features/agents/components/ChatThread.tsx                # streamingMessageId — the streaming turn is a flagged member of the list, not a separate element
counter_evidence:
  - src/features/companions/athena/chat/AthenaChatProposals.tsx  # approvals/cards as end-of-transcript stacks; resolved cards are removed, not settled in place
deviations:
  - w7-chat-transcript   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Chat Transcript - evidence

How this codebase measures against the [`chat-transcript`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
