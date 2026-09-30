---
subject: structured-output
evidence:
  - src-tauri/src/commands/credentials/ai_artifact_flow.rs   # reusable idle→running→completed|error artifact lifecycle: pluggable extractor, per-flow events, cancellation via registry, panic-safe terminal event, extraction_failed logged as its own outcome with a size-capped raw preview
  - src-tauri/src/companion/dispatcher/                    # op extraction from finalized text, ALLOWED_ACTIONS closed vocabulary, unknown actions rejected+warned+left visible as data, cleaned_text display channel, repair_op_json bounded syntactic brace-completion
  - src-tauri/engine/src/design.rs                           # extract_json_by_key strategy ladder: fenced block first, then bare balanced span, discriminant keys to pick the right candidate
  - src-tauri/engine/src/safe_json.rs                        # bounded parse: size + nesting-depth caps enforced before deserialization
  - src-tauri/src/commands/infrastructure/kpi_sim.rs           # one ingest door for an agent-produced result.json: validated at the door, idempotent, size-capped, path-confined (workspace_harvest.rs, the first such door, was retired 2026-09-14)
counter_evidence:
  - src-tauri/src/engine/deliberation.rs                     # parse_decision(&blob).unwrap_or_default() (:516, :1372) — parse failure spelled as a default-valued, fully legal artifact; downstream cannot distinguish "the team stalled" from "the parser failed"
deviations:
  - w4-structured-output   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Structured Output - evidence

How this codebase measures against the [`structured-output`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
