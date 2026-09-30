---
subject: cicd-monitoring
evidence:
  - src/features/plugins/gitlab/components/GitLabPipelineViewer.tsx   # state-liveness gate: usePolling enabled only while a selected pipeline is running/pending; list→jobs→log lazy ladder
  - src/lib/polling/pollingCoordinator.ts                              # attention-liveness gate for every poller: pause on hidden, immediate fire on regain, bucketed heartbeat
  - src/hooks/utility/timing/usePolling.ts                             # POLLING_CONFIG.pipelineRefresh 5s/30s — cadence as declared data; error backoff via shouldRun predicate
  - src/features/plugins/gitlab/hooks/usePipelineNotifications.ts      # snapshot diff keyed by pipeline id, cold-start baseline, destination-classified transitions, persisted per-class prefs
  - src/features/plugins/gitlab/components/JobRow.tsx                  # log fetched on expand only; auto-scroll to tail; link-out to the owning system
  - src/features/plugins/gitlab/components/GitOpsVersionHistory.tsx    # version-per-environment view + arm-then-confirm rollback (the one write with real consent)
  - src/features/plugins/gitlab/components/DeploymentHistoryTab.tsx    # local append-only deployment ledger with rolledBackFrom lineage
  - src-tauri/src/commands/infrastructure/gitlab.rs                    # history/version commands; is_current heuristic at :706 (counter-example inside the evidence)
  - .github/workflows/e2e-smoke.yml                                    # the observer-side value proof: a lane red 38/38 since inception that a monitored run-history would have surfaced (#w6-test-harness)
counter_evidence:
  - src/lib/commandNames.overrides.ts                                  # gitlab_list_pipelines / get_pipeline / list_pipeline_jobs / get_job_log / trigger_pipeline: UnregisteredCommand — the pipeline surface invokes five commands that exist in zero Rust files, ever
  - src/lib/bindings/GitLabPipeline.ts                                 # orphan binding: no Rust struct emits it; hand-planted with the frontend in 50c0eb146
deviations:
  - w12-cicd-monitoring   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w3-toasts-notifications   # OS permission requested at mount + focus-blind OS notify on every transition + hardcoded English escalation copy — adjacent to the registered OS-tier findings; golden-path-deferred-fixes.md
  - w6-test-harness           # the red-lane value proof this subject cites; golden-path-deferred-fixes.md
  # No w12-cicd-monitoring anchor exists yet — composer report carries the six subject-specific gaps (unregistered pipeline commands, two liveness vocabularies, selected-row-only polling, log null=loading forever, single log slot, is_current heuristic) for the orchestrator to register.
---

# Cicd Monitoring - evidence

How this codebase measures against the [`cicd-monitoring`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
