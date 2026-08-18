---
layer: application
subject: cicd-monitoring
technique: transition-detection-and-notify
stack: react
---

# Transition detection & notify — `usePipelineNotifications` (Personas)

The technique's snapshot-diff, as implemented by the hook the pipeline
viewer mounts, plus the ledger it writes into — and where the OS-escalation
half crosses into territory the toasts subject already registers.

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| Previous-snapshot memory keyed by identity | `src/features/plugins/gitlab/hooks/usePipelineNotifications.ts:82` — `prevStatusesRef: Map<number, string>` keyed by provider pipeline id; rebuilt wholesale each pass (`:142-146`) |
| Cold-start baseline | `:109` — `if (prev.size > 0 && prefs.enabled)`: the first non-empty snapshot populates memory and emits nothing. Also `:112` skips entities with no previous entry (births are silent, not fabricated transitions) |
| Destination-classified transitions | `:115-119` — fires only on `ACTIVE_STATUSES.has(old) && TERMINAL_STATUSES[new]`; skipped intermediates change nothing, exactly as the technique prescribes |
| Per-class preferences, persisted | `PipelineNotificationPrefs { enabled, onSuccess, onFailed, onCanceled, sound }` in localStorage (`:12-44`), edited by `components/PipelineNotificationPrefs.tsx`; consulted at emit time (`:106`) |
| Durable in-app record | `useNotificationCenterStore.addNotification` (`src/stores/notificationCenterStore.ts:128-137`) — written regardless of OS permission (`:121-128`), so the ledger tier never depends on the escalation tier |
| Failed poll keeps memory | `gitlabFetchPipelines`/`gitlabRefreshPipeline` catch blocks (`src/stores/slices/system/gitlabSlice.ts:401-403`, `:448-450`) set `gitlabError` and leave `gitlabPipelines` untouched — no empty snapshot is ever diffed |

## Judgment calls worth copying

- **The hook is a passive observer.** Its docstring (`:70-79`) says it
  "passively observes the pipeline array without introducing any additional
  polling" — the notifier reads what the liveness-scoped loop already
  fetched. One poll budget, two consumers.
- **Ledger before escalation, unconditionally.** The in-app record is
  written whether or not the OS grants permission, so a denied prompt
  degrades to "history only", never to "nothing".

## Gaps against the technique (deviations, reported not fixed)

- **OS permission requested at mount, not at opt-in** (`:86-100`):
  `isPermissionGranted()` then `requestPermission()` runs the moment the
  viewer renders — before the user has enabled anything, and even when
  `prefs.enabled` is false. The technique places the prompt inside the
  affirmative act of enabling the preference. This is the OS-tier finding
  the brief predicted; it belongs beside the "unconditional focus-blind
  mirror" already registered at
  [#w3-toasts-notifications](../../../golden-path-deferred-fixes.md#w3-toasts-notifications).
- **Every qualifying transition escalates to the OS** (`:131-137`) with no
  focus check: a user staring at the pipeline row gets a desktop
  notification for the change they are watching. The toasts subject's
  os-escalation technique owns the rule (escalate only when attention is
  elsewhere); the same registered anchor covers it.
- **No `fixed` class.** Classes are success/failed/canceled by destination
  only; "first green after red" is not distinguishable from "another
  green". `onSuccess` defaults to `true` (`:22-28`), so the quiet-by-default
  posture the technique prescribes for successes is inverted, and the one
  success that *is* worth an interruption (a fix) is not identifiable.
- **Escalation copy is hardcoded English** — `statusEmoji()` (`:57-64`)
  and the body template (`:134`) bypass i18n; the toasts anchor's "52/57
  hardcoded strings in the OS tier" figure grows by two here.
- **Ledger identity is a timestamp-as-id.** `id: \`pn-${++nextId}-${Date.now()}\``
  (`notificationCenterStore.ts:131`) — unique per noticing, so the ledger
  cannot recognise a re-notice of the same (pipeline, class); dedup exists
  only by accident of memory replacement in the hook. Meanwhile
  `PipelineNotification` has become the app-wide notification row:
  `addProcessNotification` reuses it with `pipelineId: 0` and `ref:
  processType` (`:139-150`) — the pipeline vocabulary leaked into a
  general ledger and is now load-bearing there.
- **What the surface renders while the backend is absent.** With the five
  pipeline commands unregistered (see the liveness-scoped-polling
  application), `gitlabFetchPipelines` fails on every mount; the slice sets
  `gitlabError` (surfaced as a dismissible banner at
  `GitLabPanel.tsx:198`) **and** the viewer simultaneously renders the
  "No pipelines yet — trigger a pipeline to get started" empty state
  (`GitLabPipelineViewer.tsx:118-125`). Failure and empty success share
  the screen; the empty-state copy actively invites the user to press
  a Trigger button whose command also does not exist. Since the notifier
  never sees a non-empty list, it never leaves baseline — the observer's
  side of the value proof (a monitored lane would have surfaced the
  38/38-red e2e-smoke lane, [#w6-test-harness](../../../golden-path-deferred-fixes.md#w6-test-harness))
  cannot be delivered by this surface as shipped.
