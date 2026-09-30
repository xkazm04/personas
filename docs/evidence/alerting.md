---
subject: alerting
evidence:
  - src/features/overview/sub_observability/libs/useGlobalAlertEvaluator.ts   # always-mounted 60s loop; overlapping-tick guard; private metric window so the viewed filter can't skew evaluation
  - src-tauri/src/commands/execution/alert_evaluator.rs                       # the NOC authority loop: cooldown from persisted fired_alerts (restart-proof), per-rule scope, fire → persist → incident → event
  - src-tauri/src/commands/communication/observability/alerts.rs              # always-true rules rejected at the create door (non-negative metrics × >= 0)
  - src/stores/slices/overview/alertSlice.ts                                  # severity/metric vocabulary from shared enums with a never-typed exhaustiveness arm; history-fallback cooldown; eval health record
  - src/features/overview/sub_observability/components/AlertHistoryPanel.tsx  # fire history as a queryable, dismissable record
  - src/features/overview/sub_observability/components/AlertToastContainer.tsx # delivery surface consuming fire records — severity mapped onto the one shared palette
counter_evidence:
  - src/features/overview/sub_observability/libs/useObservabilityData.ts      # measured third evaluator: fires evaluateAlertRules() off the tab's viewed metrics (range/persona filter), so changing a chart filter can fire and persist an alert
deviations:
  - w5-alerting   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Alerting - evidence

How this codebase measures against the [`alerting`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
