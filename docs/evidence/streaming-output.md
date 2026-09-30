---
subject: streaming-output
evidence:
  - src/lib/execution/executionSink.ts                        # dual-budget ring (10k lines / 10 MB / 4 KB line clamp), head eviction, honest truncation notice, generation-gated visibility-aware throttled flushes, forceFlush-before-reset
  - src/hooks/execution/useStructuredStream.ts                # typed event union (11 variants) dispatched only after execution_id gating; singleton shared subscription
  - src/hooks/design/core/useTauriStream.ts                   # per-start generation counter making stale listeners/timeouts inert; listeners registered before invoke; bounded line buffer; timeout → error, never silent
  - src/features/companions/athena/extractStreamPhase.ts      # phase derived from event shapes (tool_use > thinking; text yields to visible output), closed vocabulary, curated details
  - src-tauri/engine/src/safe_json.rs                         # bounded parse: 16 MiB size cap + nesting-depth cap before deserialization
  - src-tauri/engine/src/protocol.rs                          # the stream/finalize pipeline stages as a formal trait boundary (StreamOutput → FinalizeStatus)
counter_evidence:
  - src/features/shared/components/terminal/TerminalStrip.tsx # a shared component pinning the viewport to the tail without an at-bottom check — the scroll-contract violation the standard forbids
deviations:
  - w1-streaming-output   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Streaming Output - evidence

How this codebase measures against the [`streaming-output`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
