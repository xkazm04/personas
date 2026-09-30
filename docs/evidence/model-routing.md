---
subject: model-routing
evidence:
  - src-tauri/src/companion/model_routing.rs            # TurnTier { model, effort } — MAIN/ASIDE/MICRO, each constant carrying its bench measurement (incl. a negative result)
  - src-tauri/src/companion/session/                  # bench env overrides applied at the main-turn consumer, not the router; validated levels; override feeds flag AND ledger column
  - src/features/settings/sub_byom/libs/byomHelpers.ts  # policy-as-data validation: blocked-list typo = blocking error (evaluator silently drops unparseable entries), block-beats-allow warnings
  - src/features/settings/sub_byom/libs/useByomSettings.ts  # one policy surface: save gated on blocking errors; refuses save after failed load to prevent silent policy wipe
  - src-tauri/db/src/repos/execution/provider_audit.rs  # append-only decision record (model_used, was_failover, routing_rule_name, compliance_rule_name) + per-provider usage timeseries
  - src-tauri/db/src/model_routing.rs                   # rule cascade carrying both model AND effort, specificity precedence, validate() rejecting unknown effort levels
  - src-tauri/engine/src/prompt/capabilities.rs         # the terminal named constant — DEFAULT_CAPABILITY_MODEL, docstring citing the dated cost incident that justified it
  - src-tauri/src/engine/runner/mod.rs                  # the mid-tier floor: no resolved model on the default provider → pinned constant, never the account default
  - docs/development/model-effort-guide.md              # measured effort-inversion, judge family bias (ρ=0.50), output-cap nullification — with predicates and scope caveats
counter_evidence:
  - src/features/settings/sub_byom/components/ByomAuditLog.tsx  # the audit surface whose model_used column has never been written (NULL on 4,001 of 4,001 live rows) — a record that exists and cannot answer the question it renders
deviations:
  - w8-model-routing   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Model Routing - evidence

How this codebase measures against the [`model-routing`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
