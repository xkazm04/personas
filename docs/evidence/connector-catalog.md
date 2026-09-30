---
subject: connector-catalog
evidence:
  - src/lib/credentials/builtinConnectors.ts                    # seed catalog: one JSON row per service, category-tag union, matching helpers
  - scripts/connectors/builtin/slack.json                       # anatomy of a row: fields + sensitive flags, {{field}} probe template, resources with declarative pagination
  - src/features/vault/sub_catalog/components/schemas/CredentialSchemaForm.tsx   # one renderer, N declarations; orphan-row rollback on failed save
  - src/features/templates/sub_n8n/edit/connectorMatching.ts    # tiered matching with minimum-signal guard and ambiguity refusal
  - src/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters.ts        # four heterogeneous observability APIs behind one view model
  - src/lib/credentials/connectorRoles.ts                       # functional roles as a closed vocabulary, separate from browse categories
counter_evidence:
  - src-tauri/db/src/lib.rs                                     # seed_builtin_connectors' boot refresh — the measured clobber (deferred-fixes §127)
deviations:
  - w11-connector-catalog   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - deferred-fix-127   # golden-path-deferred-fixes.md §127 — boot refresh overwrites nine columns of every shipped row; operator edits revert, updated_at lies
  - deferred-fix-126   # golden-path-deferred-fixes.md §126 — three probes reference no declared field; green for any typed value, and Save is gated on that green
---

# Connector Catalog - evidence

How this codebase measures against the [`connector-catalog`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
