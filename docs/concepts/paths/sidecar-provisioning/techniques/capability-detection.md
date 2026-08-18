---
layer: technique
subject: sidecar-provisioning
technique: capability-detection
status: forged
laws: [failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Capability detection

Every feature built on an unshipped dependency ships to machines that do
not have it. That is the initial condition of every install, not a rare
misconfiguration — so "the engine is missing" must be a state the product
was *designed in*, with its own interface, its own messaging, and its own
path forward. This technique owns what the application establishes about
an external dependency's availability and what the product does with each
answer; the probe mechanics — timeouts, caching, scheduling, rollups —
belong to [health-checks](../../health-checks/health-checks.md)
(especially [probe-design](../../health-checks/techniques/probe-design.md)
and
[three-state-outcomes](../../health-checks/techniques/three-state-outcomes.md)).

## What a capability probe must establish

Presence is the floor, not the finding. A useful capability verdict has
four layers, each one a distinct fact:

1. **Resolvable** — the resolution ladder produced a concrete path
   (resolution-ladders owns the how). A verdict computed any other way —
   checking a hardcoded location, assuming a previous session's answer —
   probes something other than what the feature will actually use
   ([gate-sees-target](../../_laws.md#gate-sees-target)).
2. **Executable and sane** — the artifact runs at all: a version
   invocation succeeds and returns parseable output. This one cheap
   execution catches wrong-architecture binaries, missing runtime
   libraries, and corrupt files that mere existence checks bless.
3. **Version-compatible** — the detected version falls in the range the
   application supports, evaluated against a declared range, not a
   string-equality against one blessed value (which converts every
   harmless patch release into a false "unsupported").
4. **Capable of the specific job** — where one dependency serves several
   features at different feature levels, the probe establishes the
   specific sub-capability (the optional module, the required model file,
   the hardware path) that *this* feature needs.

The verdict vocabulary is closed and at minimum three-valued: **available**
(with version and path), **absent** (ladder exhausted — the normal state of
a fresh install), and **broken** (found but failed sanity or version — a
different fact demanding different messaging)
([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
Collapsing absent and broken into one "unavailable" produces the classic
support disaster: the user who *did* install the dependency being told to
install it.

## Gate features, do not booby-trap them

Every entry point into a dependent feature consults the capability verdict
**before** committing — before the spawn, before the download-sized
promise, before the interface paints controls that cannot work. The
anti-pattern is the booby trap: the feature renders fully armed, the user
invests intent, and the spawn failure surfaces as a raw error from six
layers down. Gating means the dependent surface is present but honest —
visibly degraded, labeled with *why*, wired with the remedy.

Degradation is proportionate. A missing optional enhancement degrades to
the baseline behavior with a quiet hint; a missing core engine disables
its feature surface with a full affordance; and where a *fallback
implementation* exists (a slower path, a remote service), the switch is
made visible rather than silent — a user who believes they are on the
local engine while a fallback quietly ships their data elsewhere has been
lied to by omission.

## The affordance: status, reason, remedy

Wherever absence surfaces, three elements travel together:

- **Status** — what is unavailable, in the product's language, not the
  dependency's internal name.
- **Reason** — absent versus broken versus unsupported-version, with the
  detected detail (found version X, need Y) when there is one.
- **Remedy** — the action, right there: an install-it button that opens
  the provisioning flow for artifacts the application can fetch itself
  (atomic-downloads and source-pinning make that safe), guidance for
  dependencies the user must install, and a **re-check** action either
  way — because the user who just installed the dependency must not have
  to restart the application to be believed. The re-check invalidates the
  cached verdict and re-runs the ladder; a status affordance without a
  re-check is an accusation with no appeal.

## Verdicts age

Availability changes while the application runs: the user installs the
tool, evicts the model, edits the override. The verdict is therefore a
cached fact with named invalidation events — completed provisioning,
eviction, settings changes, explicit re-check — and features consult the
verdict store rather than each re-probing ad hoc. One capability, one
verdict, many consumers; the alternative is three features probing the
same dependency three ways and disagreeing about reality in one window.
How often background re-probing runs, and how verdicts roll up into any
overall health surface, is
[health-checks](../../health-checks/health-checks.md)' jurisdiction.
