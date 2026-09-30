---
subject: prompt-assembly
evidence:
  - src-tauri/engine/src/prompt/mod.rs                    # one assembler for the persona prompt family: owned sections, ordering, capability rendering, fingerprint
  - src-tauri/src/companion/prompt/                     # layered companion prompt: constitution / identity / digest / recall / doctrine, with digest bounding
  - src-tauri/engine/src/skills_sidecar/mod.rs            # lazy expansion: heavy capability material moved out of the inline prompt into an on-demand sidecar
  - src-tauri/engine/src/prompt/resume_prompt.rs          # continuation prompt: delta-only re-send for a preserved session (credentials + connector roster re-derived)
  - src-tauri/engine/src/prompt/variables.rs              # interpolation with trust classes: magic vars + persona params trusted, execution input sanitized
  - src-tauri/engine/src/prompt/capabilities.rs           # active_capabilities_fingerprint: sorted, deterministic digest of the enabled use-case set
  - src-tauri/engine/src/session_pool.rs                  # compute_config_hash: fingerprint-keyed warm-session invalidation on config change
  - src-tauri/src/companion/brain/doctrine.rs             # doctrine chunked by heading, content-hash upsert, own recall budget
counter_evidence:
  - src-tauri/src/engine/runner/mod.rs                    # post-assembly appends (memories, prior reviews, team context) concatenated AFTER the assembler returns — measured at ~45% of a median production prompt, outside the budget, the fence, and the fingerprint
deviations:
  - w4-prompt-assembly   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Prompt Assembly - evidence

How this codebase measures against the [`prompt-assembly`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
