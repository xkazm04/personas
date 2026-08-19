---
layer: application
subject: structured-output
technique: artifact-lifecycle
stack: rust
---

# The AI-artifact flow — the lifecycle machine built once, and the exits it forgot to type

The repo's instance of the reusable machine is
`src-tauri/src/commands/credentials/ai_artifact_flow.rs`. Its module doc says
the technique's thesis verbatim: credential design and the credential
negotiator "follow an identical lifecycle: idle -> running -> completed |
error", so the invariant parts were captured as `AiArtifactMessages`,
`AiArtifactParams`, and `run_ai_artifact_task`, "so that adding future
AI-generates-X flows … is a matter of instantiation rather than
reimplementation." The instantiations exist:
`src-tauri/src/commands/recipes/recipe_generation.rs` (a 24-line
`AiArtifactMessages` const + a one-line extractor) and
`src-tauri/src/commands/tools/automation_design.rs` ride the same runner
with only prompt, event names, and extractor swapped.

## Confirmed against the technique

- **Pluggable extraction seam**: `AiArtifactParams.extractor:
  fn(&str) -> Option<serde_json::Value>` (`ai_artifact_flow.rs:93`) — the
  per-flow plug point. Recipe generation's whole extractor is
  `extract_json_by_key(output, &["name", "prompt_template"])`
  (`recipe_generation.rs:72-74`), delegating to the shared strategy ladder
  in `src-tauri/engine/src/design.rs:276` (fenced block first, then bare
  balanced span, discriminant keys to pick the right candidate).
- **Extraction on the settled record**: `spawn_claude_and_collect`
  accumulates typed `AssistantText` events into `text_output` and the
  extractor runs once, after the process exits (`:349`) — never against the
  live tail.
- **Every exit converges, including panic**: `spawn_ai_artifact_task`
  (`:139-167`) wraps the runner in `catch_unwind`; on panic it clears the
  registry slot and emits a `"failed"` status "so the UI never gets stuck
  in a loading state" — the forgotten-exit defect, pre-armed against.
  Timeout kills the child, reaps the zombie, and returns a typed error
  (`:562-589`); cancellation is detected by registry identity comparison
  (`:271`) — the run checks it still owns its domain slot, the technique's
  identity discipline.
- **Single-flight per flow**: the `ActiveProcessRegistry` domain key
  (`"credential_design"`, `"negotiation"`, …) is the flow key; every
  terminal path calls `registry.clear_id_if(&domain, &task_id)` so a failed
  run cannot permanently block the flow (`:297`, `:351`, `:384`).
- **Extraction failure is its own outcome — at the log layer**: extractor
  `None` logs `outcome = "extraction_failed"` with `text_output_len` and a
  500-char `raw_output_preview` (`:385-394`) — the size-capped failure
  sample the observability technique prescribes.

## Deviations, kept against the standard

1. **The frontend cannot tell extraction-failed from turn-failed.** Both
   paths emit status `"failed"`, distinguished only by the human error
   string (`messages.extraction_failed_error` vs the spawn error). The
   typed outcome taxonomy exists in `tracing` fields but is flattened
   before it crosses to the UI — a consumer wanting a "retry with a better
   prompt" affordance for extraction failures specifically has nothing to
   key on.
2. **No repair loop anywhere on this lifecycle.** The extractor returns
   `Option`; a near-miss (validation-shaped failure) and a no-candidate
   failure are the same `None`, and no typed errors flow back for a second
   model attempt. Budget-zero is a legal repair budget, but here it is
   unstated rather than chosen.
3. **The sharpest counter-example rides a *different*, hand-rolled
   lifecycle.** `src-tauri/src/engine/deliberation.rs:516` and `:1372` spend
   a parse failure as `unwrap_or_default()` — a default-constructed,
   fully legal artifact. The legacy census
   (`docs/concepts/golden-paths/structured-output-extraction.md`) measured
   the cost on the live ledger: 91% of headless turns (the five
   deliberation lanes, $44.94 at measurement) structurally cannot report a
   parse failure, and a failed parse presents as a team stall, escalating
   as `stall_limit` after three ticks. The flows that adopted the shared
   machine inherited honest extraction failure; the flow that did not,
   reinvented the third spelling of failure the golden path bans.
