---
subject: import-normalization
evidence:
  - src/lib/personas/parsers/workflowDetector.ts        # structural fingerprints, confidence grades, honest unknown outcome
  - src/lib/personas/parsers/workflowParser.ts          # bounded parse (YAML depth caps), unknown → speculative parse + mandatory user confirmation, zero-candidate refusal that names supported formats
  - src/lib/personas/parsers/workflowPipeline.ts        # the narrow waist: per-format adapters lower into NormalizedNode[], one shared extraction pipeline produces the host proposal
  - src/lib/personas/platformDefinitions.ts             # capability tables as data: node-type maps, credential consolidation, role classification, exclusions; specificity-sorted matching
  - src/lib/utils/sanitizers/workflowSanitizer.ts       # imported names/params sanitized before prompt embedding; shared injection-pattern module so sibling sanitizers can't drift
  - src-tauri/src/commands/design/n8n_limits.rs         # size caps defined once, exported to the client by codegen — one authority for the bound, both runtimes enforce it
  - src-tauri/src/commands/design/n8n_transform/prompt_sanitizer.rs  # structural isolation (nonce fencing) of untrusted workflow data at the model boundary
  - src-tauri/src/commands/design/n8n_transform/confirmation.rs      # staged receipt row + atomic create-with-rollback; per-entity errors returned; credential slots surfaced as requirements, never values
  - src/features/templates/sub_n8n/hooks/useN8nImportReducer.ts      # review wizard upload→analyze→transform→edit→confirm; restored step re-proven against restored state
counter_evidence:
  - src-tauri/engine/src/platform_rules.rs              # second hand-maintained copy of the capability tables — the TS file says "mirrors the Rust struct" and no codegen links them; the caps got one authority, the tables got a race
deviations:
  - w11-import-normalization   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Import Normalization - evidence

How this codebase measures against the [`import-normalization`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
