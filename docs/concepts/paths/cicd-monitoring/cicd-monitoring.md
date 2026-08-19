---
layer: golden-path
subject: cicd-monitoring
status: forged
techniques:
  - liveness-scoped-polling
  - transition-detection-and-notify
  - failure-drill-down
  - remote-action-consent
  - deployment-history
  - provider-capability-honesty
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

# CI/CD pipeline monitoring

A build/deploy pipeline has two sides. The **owner's side** — defining the
stages, ordering the gates, arming the publish key — is the
[release-pipeline](../release-pipeline/release-pipeline.md) subject. This
subject is the **observer's side**: an application that watches pipelines it
does not own, running on infrastructure it does not control, reached through
an API it merely borrows — and that reacts when their status changes.

The observer's side exists because of a property the owner's side documents
about itself: *the pipeline whose failures nobody notices*. A red unit test
annoys a developer within the hour; a red release lane annoys nobody, because
the only person who would notice is the person trying to ship, and most days
nobody is. A verification lane can be red every single run since its
inception — for its entire life — and the project looks healthy from inside,
because no run history is anyone's morning read. The monitor is the
structural countermeasure: it makes pipeline run history a *watched* signal,
so consecutive failures become an event that finds a human instead of a fact
that waits for one. A monitor that exists but is not trusted, or polls but
never notifies, provides none of this; the subject's standards are what make
the watching real.

Three constraints shape everything below, and none of them apply to the
owner's side:

- **The state is remote and sampled.** The monitor does not receive events;
  it takes snapshots through an API and *infers* events by comparing them.
  Everything interesting — the notification, the red row, the "deploy
  finished" moment — is a derived transition, and derivations from sampled
  state have failure modes (missed intermediate states, fabricated diffs
  after a failed poll, replayed history on restart) that a system observing
  its own state never meets.
- **Every observation spends someone else's budget.** Each poll is a request
  against a rate limit the provider owns and other consumers share. A
  monitor that polls finished pipelines forever is a rate-limit incident on
  a timer — the cost arrives later, as throttled requests for whoever needed
  the API next. Politeness budgets themselves are
  [rate-limiting](../rate-limiting/rate-limiting.md)'s subject; this
  subject's obligation is to *deserve* the budget by only asking questions
  whose answers can still change.
- **Acting is not observing.** The monitor inevitably grows buttons —
  retry, trigger, deploy — and the moment it does, it stops being a window
  and becomes a hand reaching into a system other people depend on. A
  deploy button in a monitor is still a deploy button; embedding it in a
  read-mostly surface makes it *more* dangerous, not less, because the
  surrounding UI has trained the user that clicking is safe.

## Poll only what's alive

Polling cadence is gated by two liveness tests, and both must pass: **is
anything still running** (the watched state can still change) and **is
anyone still looking** (the answer can still matter). A pipeline in a
terminal state stops being polled the moment the terminal snapshot lands; a
hidden or navigated-away view suspends its clock. The interval names its
reaper at creation — terminal state, view teardown, lost visibility — per
[creation-names-reaper](../_laws.md#creation-names-reaper); the classic
defect is a timer keyed to view mount that outlives every reason it was
started. When the provider offers a push channel, push demotes polling to a
fallback ([realtime-events](../realtime-events/realtime-events.md),
[webhook-ingestion](../webhook-ingestion/webhook-ingestion.md)); most
observer-side monitors never get one, which is why the discipline is stated
for polling first. Cadence tiers, the stop conditions, and the
last-poll-must-see-the-end subtlety are
[liveness-scoped-polling](techniques/liveness-scoped-polling.md).

## Transitions are the signal, states are the display

The remote system stores *states*; users need *changes*. The display renders
the current snapshot; the notification layer fires on the **difference
between consecutive snapshots** — pending became running, running became
failed — never on the state itself, or every poll of a failed pipeline
re-announces the failure. Transition detection requires memory (the previous
snapshot, keyed by pipeline identity that survives restart, per
[identity-survives-reuse](../_laws.md#identity-survives-reuse)), a
first-observation baseline rule (a cold start learns the world, it does not
announce it), and dedup per (entity, transition-class). What happens *after*
a transition is detected — channels, budgets, quiet hours, OS escalation —
is owned by [proactive-nudges](../proactive-nudges/proactive-nudges.md) and
[toasts-notifications](../toasts-notifications/toasts-notifications.md);
this subject's job ends at emitting a well-identified, deduplicated,
class-tagged event with per-class user preference applied. The detection
contract, the baseline rule, and the failed-poll trap are
[transition-detection-and-notify](techniques/transition-detection-and-notify.md).

## Drill-down follows the failure

A monitor's worth is measured at the moment of a red status: how many
actions from "the pipeline failed" to *the lines of log that say why*. The
standard is a lazy ladder — pipeline → stage → job → log tail — where each
level loads on demand, the ladder auto-descends along the failing path (the
failed stage opens, the failed job is preselected), and the log tail is
**bounded**: the last screenful with an explicit truncation marker and a
link out to the owning system for the rest. The monitor is a triage surface,
not a log archive; mirroring full logs inward duplicates storage the
provider already owns and turns every poll into a bulk transfer. An
unfetchable log must render as a distinct failure, never as an empty one
([failure-not-empty-success](../_laws.md#failure-not-empty-success)). The
ladder, its loading states, and the bounds are
[failure-drill-down](techniques/failure-drill-down.md).

## Remote actions carry consent

Trigger, retry, cancel, deploy — the monitor's write surface. Each is an
outward-facing act against shared infrastructure, and each carries
**confirmation proportional to blast radius**: retrying one job is a click;
triggering a pipeline with parameters echoes what will run before it runs;
deploying to an environment names the environment and makes the user say it
back. Two rules distinguish a disciplined write surface from a dangerous
one. First, **the action's result is observed, never assumed**: the request
returns an identifier, the identifier joins the polling set, and the UI
learns the outcome the same way it learns everything else — no optimistic
state transitions on a system the monitor does not own. Second, the button
disarms while its request is in flight, because a double-fired deploy is
two deploys. Confirmation shapes are shared with
[hitl-approval](../hitl-approval/hitl-approval.md); scoped write
credentials belong to
[credential-vault](../credential-vault/credential-vault.md). The blast
ladder and the fire-then-watch contract are
[remote-action-consent](techniques/remote-action-consent.md).

## History contextualizes

A live status answers "what is happening"; only history answers **"is this
normal"** — the question every red row and every slow run actually poses.
The standard places recent runs beside live state (duration against
typical, results as a streak, who triggered what) and, for deploy targets,
a per-environment view: what version is where, since when, put there by
which run. Terminal runs are immutable, so history is cached hard and
fetched lazily — it needs none of the liveness polling that live status
does ([client-fetch-cache](../client-fetch-cache/client-fetch-cache.md)).
Any rate or streak shown carries its window and filter
([count-carries-predicate](../_laws.md#count-carries-predicate)); a
"success rate" with no denominator is decoration. The two shapes of
history — append-only run log, derived current-state-per-environment — and
the normality cues are
[deployment-history](techniques/deployment-history.md).

## Provider abstraction is honest about capability differences

Every provider exposes a different pipeline model: some have stages, some
flat jobs; some allow per-job retry, some only whole-pipeline; some stream
logs, some serve tails; some accept trigger parameters, some do not. The
worst monitors paper over the differences — rendering the same buttons
everywhere and letting them mean different things per provider, which
betrays the operator exactly at the moment of action. The standard is a
**declared capability set** per adapter: the UI renders from the
declaration, absent capabilities produce absent affordances (not broken
ones), and anything the provider does not report renders as an honest
*unknown* rather than a fabricated default. Status vocabularies are mapped,
not passed through: one canonical set, one mapping table per provider, an
explicit catch-all to unknown, per
[one-authority-per-vocabulary](../_laws.md#one-authority-per-vocabulary)
and the [status-vocabulary](../status-vocabulary/status-vocabulary.md)
subject. The adapter seam itself — where provider code lives and how it is
shaped — is owned by
[adapter-normalization](../connector-catalog/techniques/adapter-normalization.md);
this subject owns what the seam must *declare*. The capability contract and
the mapping discipline are
[provider-capability-honesty](techniques/provider-capability-honesty.md).

## The techniques

- [liveness-scoped-polling](techniques/liveness-scoped-polling.md) — the
  two liveness gates, cadence tiers, stop conditions, and the terminal
  snapshot that must be the last poll's catch.
- [transition-detection-and-notify](techniques/transition-detection-and-notify.md)
  — snapshot diffing, previous-state memory, the cold-start baseline, dedup
  identity, per-class preferences, and the failed-poll trap.
- [failure-drill-down](techniques/failure-drill-down.md) — the lazy
  pipeline→stage→job→log ladder, auto-descent along the failure, bounded
  tails, link-out for the rest.
- [remote-action-consent](techniques/remote-action-consent.md) — blast-radius
  proportional confirmation, in-flight disarm, fire-then-watch instead of
  optimistic state.
- [deployment-history](techniques/deployment-history.md) — runs beside live
  status, per-environment version state, normality cues, immutable-history
  caching.
- [provider-capability-honesty](techniques/provider-capability-honesty.md) —
  declared capability sets, absent affordances over broken ones, canonical
  status mapping with an explicit unknown.
