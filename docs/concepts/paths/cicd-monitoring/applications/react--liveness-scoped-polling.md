---
layer: application
subject: cicd-monitoring
technique: liveness-scoped-polling
stack: react
---

# Liveness-scoped polling — the pipeline viewer's refresh loop (Personas)

The technique's two liveness gates, as implemented by the GitLab pipeline
viewer on top of the app-wide polling coordinator — and the one place the
gates disagree with each other.

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| State-liveness gate | `src/features/plugins/gitlab/components/GitLabPipelineViewer.tsx:49-62` — `usePolling(refreshActivePipeline, { ...POLLING_CONFIG.pipelineRefresh, enabled: !!projectId && !!activePipelineId && isRunning })`. `enabled` is the narrowest true condition; a terminal snapshot flips `isRunning` false and the next render disposes the ticker |
| Attention-liveness gate | `src/lib/polling/pollingCoordinator.ts` — every bucket pauses on `visibilitychange` hidden (`:185`, `:206-208`; opt-out via `runWhileHidden`, unused here) and **fires immediately on regain** (`:14-16`) — the refresh-on-regain rule, for free, for every consumer |
| Cadence as declared data | `src/hooks/utility/timing/usePolling.ts:6-19` `POLLING_CONFIG.pipelineRefresh = { interval: 5_000, maxBackoff: 30_000 }`; rounded to the coordinator's 5s bucket. Six named cadences, all landing on a bucket — the technique's "tier table, not literals" |
| Failure backoff without desync | `usePolling.ts:68-84` — consecutive errors double the ticker's `nextEligibleAt` up to `maxBackoff` via a `shouldRun` predicate, so the shared bucket keeps its heartbeat and only this ticker skips |
| Reaper named at creation | `usePolling.ts:86-94` — the effect that registers the ticker returns `handle.dispose()`; unmount and `enabled` flip both reap through the same door |
| Poll result feeds the gate | `gitlabRefreshPipeline` (`src/stores/slices/system/gitlabSlice.ts:436-451`) writes the fresh pipeline into `gitlabActivePipeline`, from which `isRunning` is derived on the next render — the loop's own catch decides whether there is a next poll |

## Judgment calls worth copying

- **Order of operations is right by construction.** The fetch lands in the
  store, the component re-renders, `isRunning` is recomputed from the new
  status, and only then does `enabled` change — so the terminal snapshot is
  always processed before the loop stops. The technique's "last poll must
  see the end" falls out of deriving the gate from state rather than
  holding it in a flag.
- **The coordinator makes attention-liveness a platform property.** No
  pipeline-specific visibility code exists; the viewer inherits pause,
  resume-with-immediate-fire, and bucket alignment by using `usePolling`.
  This is why the polling-loop legacy path names this file as the exemplar
  and the *only* adopter in the plugin surface.

## Gaps against the technique (deviations, reported not fixed)

- **Two liveness vocabularies, one loop.** The viewer's `isRunning` is
  `status === 'running' || status === 'pending'` (`GitLabPipelineViewer.tsx:51`).
  The sibling notification hook's `ACTIVE_STATUSES` is
  `{running, pending, created, waiting_for_resource, preparing}`
  (`usePipelineNotifications.ts:50`). A pipeline the provider reports as
  `created` or `preparing` is *alive* to the notifier and *dead* to the
  poller — so it is never polled, its start is never observed, and its
  terminal transition reaches the notifier only if the user refreshes by
  hand. One authority per vocabulary; here there are two, three lines
  apart in the same feature.
- **Only the selected pipeline is polled.** The loop refreshes
  `activePipelineId` alone; the list of 20 (`gitlabListPipelines(projectId, 20)`)
  is fetched once on mount and updated only for the selected row
  (`gitlabSlice.ts:445` maps the one id back into the list). A running
  pipeline the user has *not* clicked never updates — and since the
  notifier observes the list, its transitions never fire. The technique's
  collection-poll-then-descend shape is inverted: detail is polled, the
  collection is not.
- **No settling tier.** After `gitlabTriggerPipelineAction` the returned
  pipeline becomes active (`gitlabSlice.ts:410-415`); if the provider
  reports it `created` rather than `pending`, the gate is closed from the
  first render and the user watches a frozen row until manual refresh.
- **The loop can never start today.** `gitlab_list_pipelines`,
  `gitlab_get_pipeline`, `gitlab_list_pipeline_jobs`, `gitlab_get_job_log`
  and `gitlab_trigger_pipeline` are all listed as `UnregisteredCommand`
  in `src/lib/commandNames.overrides.ts:17-21` and appear in **zero** Rust
  files (`git log -S` across the whole history: never implemented).
  `activePipelineId` requires a successful select, which requires a
  registered command — so `enabled` is false forever. The exemplar loop is
  a correct shape wrapped around a backend that does not exist; see the
  transition-detection application for what the surface renders instead.
