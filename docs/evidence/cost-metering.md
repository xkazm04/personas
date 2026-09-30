---
subject: cost-metering
evidence:
  - src-tauri/src/companion/turn_ledger.rs                              # per-turn ledger incl. FAILED turns: is_error = CLI-reported OR died-before-report, low-cardinality error_reason taxonomy, one construction site for failure rows, unknown cost stays NULL rather than blocking the row
  - src-tauri/db/src/repos/llm_spend.rs                                 # second spend class (headless dev_llm_spend), same wire parsing; write-time SpendCtx carries source/trigger/model/persona/project axes; group-by COALESCEs NULL model into a visible '(unknown)' bucket
  - src-tauri/db/src/repos/execution/executions.rs                      # MONTHLY_SPEND_PREDICATE — ONE shared verbatim predicate (status set, UTC start-of-month, ops-chat exclusion) for the gate that blocks runs AND the budget UI feed; cancelled rows count because they may have consumed credits
  - src-tauri/src/commands/communication/observability/metrics.rs       # MonthlySpendResult returns period_start_utc WITH the items — the period travels with the totals; boundary deliberately UTC to match the gate's predicate, caller's utc offset intentionally ignored
  - src-tauri/src/engine/background/                                  # scheduled-trigger budget gate mirrors the manual gate's exact semantics (0.0 = unlimited); a budget skip advances the pointer but preserves the fired-watermark
  - src-tauri/src/commands/execution/executions.rs                      # manual/API enforcement point: same get_monthly_spend, refusal names persona, spend, and limit
  - src-tauri/engine/src/cost.rs                                        # preflight estimation: chars-per-token ratio, per-family direction-split rates, documented non-zero default for unknown models; preview returns estimate + monthly spend + ceiling in one structure
  - src-tauri/core/src/run_budget.rs                                    # run-scope aggregate ceiling across fan-out spawns; launch-gate (not mid-flight kill) semantics stated in the header; enforce-mode explicit and captured at persist time
  - src-tauri/db/src/repos/run_budget.rs                                # run budget persisted at finalize so cost trends survive restarts, keyed by run identity
  - src/stores/slices/agents/budgetEnforcementSlice.ts                  # ceilings client-side: fail-closed on stale/missing data, TTL declared, invalidation marks stale until refetch lands, explicit session-scoped user overrides
  - src-tauri/src/commands/infrastructure/tier_usage.rs                 # tier config as limit authority; TTL-cached snapshot (3s) with approaching-limit flag
  - src/features/overview/sub_activity/libs/useLlmSpend.ts              # spend-class dashboard consumer keyed to the shared day-range filter
counter_evidence:
  - src-tauri/engine/src/cost.rs                                        # same file, other face: the table is undated/unversioned, has no cached-input unit classes, and its unknown-model default is silently mid-tier and uncounted — documented, but neither conservative nor observable
deviations:
  - w8-cost-metering   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w1-streaming-output   # token counts structurally zero on execution rows — fixture-certified dead field; the attribution axes exist but the units never arrive
  - w4-prompt-assembly    # input_tokens never persisted for persona prompts while the companion class persists per-block sizes + hashes — two spend classes, unequal evidentiary standards
---

# Cost Metering - evidence

How this codebase measures against the [`cost-metering`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
