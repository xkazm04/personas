---
layer: technique
subject: cicd-monitoring
technique: failure-drill-down
status: forged
laws:
  - failure-not-empty-success
shared_with: []
---

# Failure drill-down

The ladder from a red status to the lines that explain it:
**pipeline → stage → job → log tail**. A monitor is judged at exactly this
moment — the user has seen red and wants *why* — and the design goal is
minimum actions and minimum transferred bytes between those two points.

## Lazy at every rung

Each rung of the ladder is fetched on demand, not eagerly:

- The **pipeline list** carries only rollup status per pipeline — the
  polling loop's collection call.
- **Stages and jobs** load when a pipeline is expanded. They are the
  detail call, made for the row the user opened, not for every row the
  list contains.
- The **log tail** loads when a job is opened, and only the tail (below).

Eager-loading the whole tree multiplies every poll by the full fan-out
(pipelines × jobs × logs) to serve a level of detail the user looks at for
one row in fifty. The lazy ladder is also what keeps the polling budget
honest: liveness-scoped polling refreshes the rungs that are *open*, at
detail cadence, and only the rollup for the rest.

Each rung, while loading, shows structure-preserving pending states — the
ladder must not collapse and re-expand as data arrives (the async-ui-states
subject owns the general doctrine; it applies at every rung here).

## Auto-descend along the failure

When the user opens a failed pipeline, the ladder has one honest default:
**follow the failure**. The failed stage is expanded, the first failed job
is preselected, its log tail is already loading. Every other stage stays
collapsed. The user's question is not "what is the structure of this
pipeline" — it is "why is it red", and the structure is only scaffolding
for that answer. A drill-down that opens to a neutral, everything-collapsed
tree spends the user's next three clicks re-deriving what the monitor
already knew. (Multiple failed jobs: preselect the first, mark the rest;
the first failure is disproportionately often the root cause and the rest
its cascade.)

## The bounded tail

The log is the provider's artifact; the monitor shows a **tail** — the
last screenful-to-few-screenfuls — because failures overwhelmingly explain
themselves at the end of the log. Three rules make the bound honest:

- **The bound is declared**: a visible truncation marker ("last N lines /
  K bytes — full log at source"), never a silent cut that lets the user
  believe they read everything.
- **The rest is a link out** to the owning system, which has the search,
  the streaming, and the retention. Mirroring full logs inward turns the
  monitor into a log archive with none of an archive's tools and all of
  its transfer costs.
- **Empty is not unfetchable**, per
  [failure-not-empty-success](../../_laws.md#failure-not-empty-success).
  A job that produced no output and a log request that failed (expired,
  forbidden, provider hiccup) are different facts and render differently:
  "no output" versus a retryable error state. Collapsing them means every
  auth failure reads as "the job said nothing", which sends the user
  hunting a phantom.

A tail for a *running* job is a refreshing tail — re-fetched on the detail
cadence while the job runs, settled at the terminal transition. Whether
the provider supports ranged/incremental fetches or only whole-log reads
is a capability fact (see provider-capability-honesty); when only whole
reads exist, the refreshing tail costs a full transfer per refresh, which
argues for a slower detail cadence, honestly labeled with data age.

## Identity down the ladder

Every rung keys on provider-issued ids — pipeline id, job id — end to end:
selection, expansion state, and the fetch cache all keyed the same way. A
retry typically mints a *new* job id for the same logical job name; the
drill-down follows the id (the new run's log), while history (see
deployment-history) is what relates attempts of the same name over time.

## Decision rules

- Fetch per rung on expansion; poll open rungs at detail cadence, closed
  ones not at all.
- Red opens to the failure: failed stage expanded, failed job selected,
  tail loading — zero-click triage as the default posture.
- Tail bounds are visible and constant; the full log is a link, not a
  mirror.
- Distinguish empty output / still buffering / fetch failed — three
  states, three renderings.
- Keep the same status vocabulary at every rung (one mapping, applied at
  the adapter seam), so a "failed" pipeline never contains jobs in states
  the legend does not know.
