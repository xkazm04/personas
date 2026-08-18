---
layer: golden-path
subject: multi-project
status: forged
techniques:
  - project-identity-and-joins
  - portfolio-drill-hierarchy
  - per-project-tabs-and-state
  - passive-signal-ingestion
  - cross-project-comparison
  - project-onboarding-lifecycle
evidence:
  - src-tauri/db/src/repos/dev_tools.rs                                # identity minted (UUID v4) at the ONE create door; name/root_path validated, re-bindable fields
  - src/features/teams/sub_factory/l2/ship/shipDerive.ts               # the ID-keyed-join doctrine in code: "resolves by context ID, never by display name" + the measured name-join defect
  - src/features/teams/sub_factory/passport/ProjectsPassportWall.tsx   # the L1 wall: overview covers + compare matrix, two views of one population, gap-sort triage
  - src/features/teams/sub_factory/passport/passportDerive.ts          # normalized dimensions with explicit-gap honesty ("never an invented value — that honesty is the whole point of the comparison")
  - src/features/studio/StudioTabBar.tsx                               # browser-style tab strip, per-tab live status dot, narrowest-projection subscriptions
  - src/features/studio/studioHistory.ts                               # the persisted open-tab set + restore-and-reattach rationale (H10)
  - src-tauri/src/engine/project_tracking/scheduler.rs                 # hourly baseline tick, per-project failure isolation, event pruning
  - src-tauri/src/engine/project_tracking/push.rs                      # push acceleration with per-project debounce protecting the consolidation budget
  - src/features/teams/sub_factory/passport/populateDispatch.ts        # the metadata-contract populate door: lanes, freshness gates surfaced at consent, out-of-scope honesty
  - .claude/CLAUDE.md                                                  # "Two different maps currently claim this file" — the foreign-snapshot 5×-mis-sizing warning; the registry (DB) is the authority
counter_evidence:
  - src-tauri/src/engine/project_tracking/watchers/git.rs              # watcher failure returns Ok(vec![]) — could-not-observe spelled identically to observed-quiet past the log line
deviations:
  - w11-multi-project   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Multi-project workspace management

One project under management is a working directory with some tooling around
it. Ten of them — different stacks, different ages, some shipping weekly and
some dormant for a quarter, some fully instrumented and some barely admitted —
under one roof is a **portfolio**, and the portfolio is a different problem
than any of its members. The member-level problems — how one codebase is
scanned, how one repository handles concurrent edits, how one fleet of worker
sessions is dispatched into a checkout — belong to sibling subjects
([codebase-scanning](../codebase-scanning/codebase-scanning.md),
[concurrent-vcs](../concurrent-vcs/concurrent-vcs.md),
[fleet-orchestration](../fleet-orchestration/fleet-orchestration.md)). This
subject owns the layer above: the registry that knows what the portfolio *is*,
the workspace state that lets an operator hold N projects open at once, the
signal machinery that keeps the portfolio's picture current without
interrogating anyone, the comparisons that decide where attention goes next,
and the lifecycle that admits, equips, and eventually retires a managed
project.

The boundary with fleet-orchestration deserves one precise sentence, because
the two subjects rhyme: a fleet is *sessions doing work*, measured in minutes
and hours; a portfolio is *the projects themselves*, measured in weeks and
quarters. A session ends; a project persists. The fleet asks "what is running
and what did it produce"; the portfolio asks "what do I manage, what shape is
each of them in, and which one needs me this week." Conflate the two layers
and every restart of the work layer amnesias the management layer.

## The central claim: the portfolio trusts its own registry

Everything in this subject radiates from one structural decision: **a project
is an entity with minted identity, not a directory, not a name, and not
whatever some other tool's exported snapshot says it is.**

A project's name changes (rebrands happen mid-quarter). Its path changes (a
disk migration, a second machine, a re-clone). Its remote changes (a transfer
between organizations). Any of these, used as a join key, silently severs the
project from its accumulated record at exactly the moment the record matters —
the rename lands, and the dashboards, scores, notes, and history that were
keyed to the old string now describe a project that "no longer exists" while a
fresh, amnesiac twin appears beside it. The standard is the one
[identity law](../_laws.md#identity-survives-reuse) applied at portfolio
scale: identity is minted once, at admission, opaque, never derived from
anything that can change or collide — and **every** cross-cutting artifact
(scores, signals, notes, tab state, work rosters) joins on that identity.
Name-keyed joins are not a lesser choice; they are a defect class, and one of
the few that reliably destroys data *relationships* without destroying data.

The second half of the claim is about authority. Portfolios attract
*snapshots*: exported maps, committed manifests, cached inventories produced
by other tools or by earlier runs of this one. These are orientation aids, and
they rot the moment they are written. The registry the manager itself
maintains — updated by its own admission door, its own scans, its own signal
ingestion — is the only source that answers sizing and membership questions.
Reading a foreign snapshot for a quick look is fine; **joining or sizing
against one is how a portfolio ends up planning against a world that stopped
existing months ago** ([the gate must see its
target](../_laws.md#gate-sees-target) — and so must the planner). When
registry and snapshot disagree, that disagreement is a finding to surface, not
a discrepancy to average.

## Drill-down owns density, level by level

A portfolio surface serves one recurring question — "which project needs me?"
— and it cannot answer it by showing everything about everyone. The standard
shape is a **drill hierarchy of two or three levels, where each level owns its
own density budget**:

- **The wall** shows all N projects at a handful of signals each: liveness, a
  pulse of recent activity, one or two headline numbers, an attention flag.
  Its job is triage — rank, notice, pick — in one glance.
- **The matrix** shows one project across all its managed dimensions: every
  readiness axis, every scored capability, each as a cell dense enough to
  judge and cheap enough to scan.
- **The detail** shows one dimension of one project at full depth: the
  evidence, the history, the next action.

The discipline is that levels do not borrow each other's data. The wall never
fetches detail-grade data for N projects (the surface that does this is slow
exactly in proportion to portfolio growth, which is backwards); the detail
never re-aggregates what the matrix already derived. Rollups the wall displays
are derived once, at ingestion or scoring time, with their recomputation path
named ([a stored derivation names its
recomputation](../_laws.md#derivation-names-recomputation)) — never
re-computed per render from raw member data.

## Workspace state is first-class

An operator working a portfolio holds several projects open at once and
switches between them dozens of times a day. The standard treats that working
set the way a browser treats tabs: **a persisted, ordered set of open
projects, restored exactly across restarts, where each tab is both a
navigation handle and a live status surface.** Switching to a project restores
its state — the view it was on, the selection it held — rather than booting a
fresh visit; a tab you are not looking at still tells you, peripherally, that
its project went red or finished a run.

Two design commitments keep tab sets healthy. First, a tab is keyed by project
identity, so tab state survives renames and re-paths along with everything
else. Second, a tab is a *handle*, not a *runtime*: opening one must not boot
the project's full machinery, or the working set collapses to whatever the
machine can afford to keep hot. Closing a tab ends nothing and archives
nothing — it edits the working set, and only the working set.

## The portfolio listens; it does not poll

Keeping N projects' pictures current by interrogating them — walking each
repository, re-scanning each codebase, querying each project's tools on view —
scales as O(N × cost) and is always stale anyway, because it measures at view
time instead of change time. The standard inverts it: **each managed project
already emits exhaust** — version-control history, work ledgers, notes,
run artifacts — and the manager attaches cheap watchers to that exhaust,
consolidating what they see into a per-project **pulse**: a compact,
chronological narrative of what has been happening, maintained continuously
and read instantly.

Ingestion runs on a modest baseline cadence and *accelerates on evidence of
activity* — a quiet project is checked rarely, a busy one closely, so cost
follows relevance. Watchers are supervised recurring work and inherit the
obligations of [background-jobs](../background-jobs/background-jobs.md),
including the one that matters most at portfolio scale: **a watcher that
cannot read its project reports "unwatched," never "quiet"**
([failure ≠ empty success](../_laws.md#failure-not-empty-success)). A
portfolio wall that renders silence for both "nothing happened" and "we lost
the ability to look" trains its operator to trust a blind instrument.

The consumer side is equally constrained: portfolio surfaces read the digest.
They do not reach past it to poll workers, re-walk history, or re-derive the
narrative — the digest is the one authority for "what happened lately," or
two surfaces will disagree about the recent past.

## Comparison requires normalized dimensions

The moment a portfolio can *show* N projects it will be asked to *rank* them,
and raw measures do not rank across heterogeneous projects: commit counts,
file counts, test counts all vary with stack, age, and size before they vary
with quality. Cross-project comparison therefore rides on the machinery of
[scoring-rubrics](../scoring-rubrics/scoring-rubrics.md): dimensions defined
once for the whole portfolio, each project scored against the same rubric,
composites explained by their parts. Two decisions are portfolio-specific and
must be made deliberately, per dimension: **fleet-relative or fixed anchors**
(grade against the current cohort, which re-ranks as the cohort improves and
suits triage — or against absolute standards, which hold meaning over time and
suit progress tracking; mixing the two in one composite produces a number that
means neither), and **what unmeasured means** (a project admitted yesterday
has no score on most dimensions; rendering that as zero punishes admission
itself — the [unmeasured-honesty](../scoring-rubrics/techniques/unmeasured-honesty.md)
discipline applies unchanged).

## Lifecycle: admission equips, archival preserves

Projects enter and leave management, and both edges are doors, not events.
**Admission** mints identity, binds the current location and remotes as
re-bindable fields, and then *equips*: a managed project carries a metadata
contract — the map of its structure, its scored dimensions, its readiness
record, its knowledge artifacts — and admission is not complete until the
contract is populated or each gap is explicitly deferred. An "admitted" row
with none of its metadata is a name on a list, not a managed project, and
every portfolio surface downstream of it renders holes.

Each artifact in the contract names its refresher — what re-derives it and on
what trigger ([derivation names
recomputation](../_laws.md#derivation-names-recomputation)) — because a stale
structure map does not merely inform poorly, it actively mis-sizes work
scoped against it. **Archival** is a state, not a deletion: the project's
identity, history, scores, and pulse survive; watchers stop and their
stoppage is part of the transition ([creation names its
reaper](../_laws.md#creation-names-reaper)); and un-archiving restores the
same entity, not a new twin. The lifecycle vocabulary — candidate, active,
archived, and whatever lies between — is closed and single-sourced
([one authority per vocabulary](../_laws.md#one-authority-per-vocabulary)),
per the general shape in
[entity-lifecycle](../entity-lifecycle/entity-lifecycle.md).

## Invariants

- **Identity is minted at admission and survives everything** — rename,
  re-path, re-clone, remote transfer, archival and return. Names and paths
  are display and access fields; no join keys on either, anywhere.
- **The manager's own registry is the sole authority for membership and
  sizing.** Foreign snapshots and committed manifests are orientation only;
  any plan sized against one names that choice and its staleness.
- **Each drill level owns its density and fetches only its layer.** Wall
  cost grows with N × (a handful); it never grows with N × depth.
- **The working set is persisted, identity-keyed, and cheap.** Restart
  restores it exactly; an open tab is a handle plus a status surface, never
  a booted runtime; closing it edits only the working set.
- **Portfolio freshness comes from listening, not interrogation.** Watchers
  over project exhaust feed one digest per project; surfaces read the
  digest; an unreadable project is *unwatched*, loudly distinct from quiet.
- **Every cross-project number is normalized and carries its predicate** —
  its rubric, its anchor policy, and its measured-vs-unmeasured status
  ([a count carries its predicate](../_laws.md#count-carries-predicate)).
- **Admission and archival are the two doors.** Nothing becomes managed
  except through admission's equip step; nothing managed disappears —
  archival preserves the record and names what stops running.

## The techniques

- [project-identity-and-joins](techniques/project-identity-and-joins.md) —
  minting identity at admission; name, path, and remote as re-bindable
  fields; the ID-keyed join discipline and the rename/re-clone tests that
  prove it; foreign-snapshot identity quarantine.
- [portfolio-drill-hierarchy](techniques/portfolio-drill-hierarchy.md) — the
  wall / matrix / detail levels, the density budget each owns, derive-once
  rollups, and context preserved across the drill.
- [per-project-tabs-and-state](techniques/per-project-tabs-and-state.md) —
  the persisted working set: browser-shaped tabs, per-tab live status,
  identity-keyed state restore, tabs as handles not runtimes.
- [passive-signal-ingestion](techniques/passive-signal-ingestion.md) —
  watchers over each project's native exhaust, the consolidated pulse,
  baseline cadence with push acceleration, and unwatched ≠ quiet.
- [cross-project-comparison](techniques/cross-project-comparison.md) —
  portfolio-wide dimensions, fleet-relative vs fixed anchors, unmeasured
  honesty across heterogeneous members, and comparison surfaces that join
  by identity.
- [project-onboarding-lifecycle](techniques/project-onboarding-lifecycle.md)
  — the admission door and the metadata contract, refreshers for every
  derived artifact, archival as a preserving state, and the closed
  lifecycle vocabulary.
