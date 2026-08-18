---
layer: application
subject: cicd-monitoring
technique: remote-action-consent
stack: react
---

# Remote action consent — trigger, deploy, rollback (Personas)

The GitLab plugin's write surface, ranked against the technique's blast
ladder: three actions, three different consent shapes, none of them chosen
by blast radius.

## Where each mechanism lives

| Action | Implementation | Consent shape as shipped |
|---|---|---|
| Trigger pipeline | `GitLabPipelineViewer.tsx:72-74` `handleTrigger` → `gitlabTriggerPipelineAction(projectId)` (`gitlabSlice.ts:406-421`) | **None.** One click fires against the default ref; no parameter echo, no confirm. In-flight disarm via `loading={triggering}` + `disabled` (`:98-108`) — the technique's mandatory guard is present |
| Deploy persona to environment | `GitLabDeployModal.tsx` — environment `<select>` (dev/staging/production, `:194-204`) + Deploy button (`:211-225`) → `gitlabDeployPersonaVersioned` | **None beyond selection.** Choosing `production` and pressing Deploy is two clicks with no environment named at a confirm step; the largest-blast action has the same consent as the smallest |
| Roll back to version | `GitOpsVersionHistory.tsx:56-66` — first click arms `confirmRollback = tagName`, second click on the now-red "Confirm rollback" button executes (`:305-328`) | **Two-click inline confirm**, disarmed while `rollingBack`. The one action with a real consent step |
| Roll back from history | `DeploymentHistoryTab.tsx:48-58` — same arm-then-confirm pattern keyed by record id | Same as above |
| Result observed, not assumed | Deploy: `result.tagCreated === false` surfaces a warning toast that the version trail has a gap (`gitlabSlice.ts:506-515`) — a partial outcome reported as partial | Trigger: the returned pipeline object is provider-issued (`:409-414`), not fabricated — acknowledgment, correctly typed as such |
| Local action record | `emitDeploymentEvent({ eventType: 'deploy_started' \| 'deploy_succeeded' \| 'deploy_failed' \| 'credential_provisioned' \| 'agent_undeployed', target: 'gitlab', … })` on every deploy path (`gitlabSlice.ts:277-295`, `:495-530`, `:552`, `:622`) — the monitor's own audit line |

## Judgment calls worth copying

- **Rollback's arm-then-confirm keyed by target** (`confirmRollback ===
  version.tagName`) — the confirm names the specific version, and
  switching persona/filter clears the armed state (`GitOpsVersionHistory.tsx:95`,
  `DeploymentHistoryTab.tsx:83`) so a stale arm cannot fire on a
  different target after a context change.
- **Partial success is spelled as partial.** The deploy-landed-but-tag-
  failed toast is the fire-then-observe rule applied to a two-step remote
  act: it does not collapse "deployed" and "versioned" into one green.
- **The deploy event ledger is emitted from the slice**, not the
  component — every caller of the write path records the act, not just
  the modal.

## Gaps against the technique (deviations, reported not fixed)

- **Blast ladder inverted.** Rollback (medium) has a confirm; deploy to
  `production` (largest) and trigger (medium, consumes shared runners)
  have none. The technique ranks by (action × target); here consent was
  attached by which component happened to get one.
- **Trigger has no parameter echo and no ref choice.** `ref` is optional
  in the slice signature but the viewer never passes it; the user cannot
  see what will run before it runs.
- **Trigger optimistically mutates the list.** `gitlabPipelines: [pipeline,
  ...state.gitlabPipelines]` (`gitlabSlice.ts:413`) prepends the
  acknowledgment object as if it were a polled row. It is provider-issued,
  so this is acknowledgment-as-row rather than fabrication — but no
  "requested, waiting to observe" state exists, and if the provider queues
  the run under a status the poller's `isRunning` does not recognise, the
  row freezes (see liveness-scoped-polling).
- **`GitLabDeployModal` marks the request phase with a null-rendering
  spinner** (`LoadingSpinner` inside the button, `:216-221`) — the
  in-flight disarm holds (`disabled={isDeploying}`) but the visible busy
  signal is an `sr-only` label; the toasts/async-ui doctrine's real
  spinner belongs here.
- **Trigger's command is unregistered** (`gitlab_trigger_pipeline`,
  `commandNames.overrides.ts:21`) — the button is a consent-free deploy-
  shaped control wired to nothing, which today is the safest possible
  state and the least honest.
