---
subject: prompt-safety
evidence:
  - src-tauri/engine/src/prompt/runtime_safety.rs        # the inbound door: caps, announced truncation, invisible-char/homoglyph stripping, structural escaping, nonce boundaries, canary
  - src-tauri/src/companion/brain/sleep_cycle/         # nonce-fenced untrusted evidence, rules stated OUTSIDE the fence, ordering pinned by a regression test
  - src-tauri/core/src/redact.rs                         # outbound secret masking at the persistence boundary: pattern + entropy families, precision-biased, kill-switched
  - src-tauri/src/companion/dispatcher/                # the op-grammar door: closed action set, validated anchors/routes/modes, visible rejections, fail-closed
  - src/lib/utils/sanitizers/promptInjection.ts          # the UI-side of the boundary, deliberately unified so two sanitizer call sites cannot drift
counter_evidence:
  - src-tauri/core/src/utils/sanitization.rs             # the 2026-08-15 drift incident recorded in-file: a token regex that could match no real token, duplicated across three modules, while the correct rules sat in a sibling — parity by mirror-comment, with no shared test corpus to catch it
deviations:
  - w4-prompt-safety   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Prompt Safety - evidence

How this codebase measures against the [`prompt-safety`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
