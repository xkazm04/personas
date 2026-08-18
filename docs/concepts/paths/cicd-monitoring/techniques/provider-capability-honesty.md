---
layer: technique
subject: cicd-monitoring
technique: provider-capability-honesty
status: forged
laws:
  - one-authority-per-vocabulary
shared_with: []
---

# Provider capability honesty

Every pipeline provider exposes a different model: stages or flat jobs;
per-job retry or whole-pipeline only; log tails, log streams, or logs
only until they expire; trigger parameters or bare triggers; environments
as first-class objects or as naming conventions. A monitor that fronts
more than one provider — or intends to — must decide what to do about the
differences, and there are only two honest answers: **declare them** or
**support one provider and say so**. The dishonest third answer, papering
over differences behind a uniform surface, is the one this technique
exists to kill, because its failures land at the worst possible moment:
the same button, present everywhere, quietly meaning different things —
a "retry" that re-runs one job here and the whole pipeline there betrays
the operator precisely when they are firing actions at a broken build.

## The capability declaration

Each adapter ships a declared capability set — flags, not code paths
discovered by trying: *can retry job*, *can retry pipeline*, *can cancel*,
*can trigger with parameters*, *serves log tails*, *reports stages*,
*models environments*, *supports push*. The consuming surface renders
from the declaration:

- **Absent capability → absent affordance.** No button, or a
  disabled-with-reason control when discoverability matters ("this
  provider retries whole pipelines only"). Never a present, enabled
  button that fails or approximates on click.
- **Approximation is opt-in and labeled.** If the monitor chooses to
  emulate a missing capability (whole-pipeline retry offered where
  per-job retry is missing), the surface says what will actually happen —
  the emulation is a different action with its own blast radius, and the
  consent step (see remote-action-consent) names the real act.
- **Structural differences render structurally.** A stage-less provider
  gets a flat job list, not fabricated stages; an environment-less
  provider gets no environment view rather than one bluffed from naming
  conventions — unless the convention mapping is itself explicit,
  user-visible configuration.

The declaration lives with the adapter, versioned with it, so a provider
API gaining a capability is one flag flip with the UI already wired. The
adapter seam's shape — where provider code lives, how it is registered —
is the connector-catalog subject's adapter-normalization; this technique
owns *what the seam must declare*.

## Status mapping: one authority, explicit unknown

Every provider ships its own status strings, and they are false friends:
the same word means different lifecycle points on different providers,
and each provider has states the others lack. The discipline, per
[one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary):

- **One canonical status set**, owned by the monitor, small, closed, and
  chosen for what the *display and transition layers* need (queued,
  running, succeeded, failed, canceled, skipped, unknown — destination
  classes for notification, colors for display).
- **One mapping table per provider**, data not scattered conditionals,
  from raw provider strings to canonical members.
- **An explicit catch-all to `unknown`.** Providers add states between
  monitor releases; an unmapped string must land in a rendered, visible
  *unknown* — never crash, never silently reuse the previous status,
  and never pass the raw string through to a display layer whose legend,
  colors, and transition classes have never heard of it.
- **Raw preserved beside canonical.** The original string travels with
  the mapped one (shown in detail views, logged with transitions), so an
  `unknown` is diagnosable and the mapping table's next entry writes
  itself.

`unknown` rendering matters: it is an honest fact ("the provider said
something this version does not understand"), styled as its own thing —
not disguised as failure (false alarms) and not as pending (false calm).
A spike of unknowns is a monitorable signal that the mapping table is
stale.

## Honesty about data freshness and depth

Capability honesty extends to the data's own limits, stated where the
data renders: log tails that expire at the provider, history windows
shallower than the provider's retention, polling staleness (data age on
a surface whose poll loop is suspended or failing). The monitor's
credibility is its only asset — the first time it confidently renders
stale data as current, the user goes back to checking the provider's own
site, and the monitor becomes decoration.

## Decision rules

- Capabilities are declared flags per adapter; UI renders from flags;
  discovery-by-failure is banned.
- Missing capability: hide, or disable with the reason; emulating:
  relabel the action as what it really does.
- One canonical status vocabulary; per-provider mapping tables; explicit
  catch-all to a rendered `unknown`; raw string preserved beside the
  canonical member.
- Never fabricate structure (stages, environments) a provider does not
  model, except via explicit user-visible configuration.
- State data age and window depth on every surface whose data can be
  stale or shallow.
