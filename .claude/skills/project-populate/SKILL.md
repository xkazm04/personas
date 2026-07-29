---
name: project-populate
category: Maintenance
memory: project
description: Populate a newly managed repository with the data Personas needs to maintain and develop it — a context map, a feature (use-case) inventory, and a triaged KPI set. Contexts and features are assigned autonomously; KPIs are negotiated with the operator wave by wave, and wired to real monitoring tools when the project already has them. Dispatched by the passport wall, or run standalone with /project-populate.
---

# Project Populate

A repository that Personas has just adopted is *registered* but not yet
*understood*. It has no context map, so nothing can be scoped; no feature
inventory, so nothing can be planned against; and no KPIs, so nothing can be
measured. Every later capability — scoped dispatch, the improve plan, the Ship
roadmap, KPI simulation — reads from those three tables.

Your job is to fill them, in that order, because each one is built on the one
before it: features are slices through the context map, and a KPI worth
tracking is a KPI attached to a feature someone cares about.

**You do not do the scanning yourself.** The app owns three scan lanes and
they already encode the doctrine — how a context is shaped, what makes a good
use case, which KPIs are measurable in this stack. You conduct them over the
app's loopback bridge, gate them on freshness so a re-run is cheap, and spend
your own turns on the part no lane can do: deciding with the operator which
KPIs are worth adopting, and wiring them to whatever monitoring the project
already has.

## Modes

**Dispatched (passport wall).** The prompt carries a DISPATCH BRIEF — project
id, repo root, the bridge port, per-lane freshness verdicts already computed
by the app, and the project's available connector metadata. Trust the brief's
verdicts; they were derived from the same database you would be querying.

**Standalone (`/project-populate` in a repo).** No brief. Derive everything
yourself per [`references/bridge.md`](references/bridge.md): find the bridge
port, resolve this repo's `project_id` from `GET /dev-tools/projects` by
matching `root_path`, and compute the freshness gates from the same endpoints.
If the repo is not registered in Personas at all, say so and stop — registering
it is the operator's call, not yours.

## Before anything else

The bridge is the app. If it does not answer, nothing in this skill works:

1. Confirm the bridge responds (`GET /dev-tools/projects`). If it does not,
   tell the operator Personas is not running and stop. Do not fall back to
   editing the database or writing files that mimic scan output — the app's
   ingest path is the only door, and inventing another one silently corrupts
   the data model.
2. Confirm the `project_id` resolves to this repo's root. A mismatch means you
   would populate the wrong project.

## Phase 1 — Context map

**Gate.** In dispatched mode the brief states the verdict. Standalone, derive
it: no context groups → `full`; newest group `updated_at` older than 14 days →
`incremental`; otherwise → `skip`.

- `full` — `POST /dev-tools/scan-codebase` with `delta_mode: false`.
- `incremental` — same call with `delta_mode: true`.
- `skip` — say what the map already holds (group and context counts, age) and
  move on. Do not rescan a fresh map to feel thorough; it costs the operator
  tokens and can only churn a map that was already right.

Poll `GET /dev-tools/scan-status/{scan_id}` until the status leaves `running`.
These scans take minutes — poll at a human pace (~10s), and relay the
milestone lines as they arrive so the operator can see progress rather than a
frozen cursor.

The scan lane fans out over subagents internally. You do not need to explore
the codebase to help it, and you should not: two agents mapping the same tree
produce two different maps, and only the lane's output reaches the database.

If the scan fails, report the error verbatim and stop the phase. A failed
context map makes Phase 2 meaningless, so do not proceed past it.

## Phase 2 — Feature inventory

Features are slices through the context map, so this phase runs **only after**
Phase 1 has a map. If Phase 1 ended in `skip`, the map is already there and
this phase proceeds normally.

**Gate.** Same 14-day rule against the use-case list: none → scan; all older
than 14 days → scan; otherwise skip. There is no delta mode here — a use-case
scan is always a fresh proposal pass.

`POST /dev-tools/scan-use-cases`, then poll
`GET /dev-tools/use-case-scan-status/{scan_id}`.

Two failures are expected rather than exceptional, and both are informative
rather than fatal — report them and move to Phase 3:

- *"Scan the codebase into a context map first"* — Phase 1 skipped or failed.
- *"N proposals already await review"* — the operator has an unreviewed queue.
  Point them at Projects → Factory → Overview and move on. Do not triage use
  cases yourself; unlike KPIs, they have a review surface in the app and it is
  the better place to do it.

## Phase 3 — KPIs, with the operator

This is the phase that needs a human, and the reason both dispatch transports
are interactive.

**Gate.** If the project already has KPIs in any status other than archived,
do not scan — go straight to triaging whatever sits in `proposed`, and if
nothing does, report the active set and skip to Phase 4.

Otherwise `POST /dev-tools/scan-kpis` and poll
`GET /dev-tools/kpi-scan-status/{scan_id}`.

### Triage in waves

Fetch the proposals (`GET /dev-tools/kpis/{project_id}?status=proposed`) and
walk them **five at a time**. For each wave:

1. Present the five compactly — name, what it measures, the proposed target,
   and the one thing that matters most: **how it would actually be measured in
   this repo**. A KPI whose measurement you cannot describe concretely is a KPI
   the operator should reject, and you should say so rather than let it pass.
2. Ask for a decision per KPI: **adopt** · **adopt with a different target** ·
   **reject** · **defer**. Recommend one, and say why in a clause, not a
   paragraph.
3. Record each answer immediately via `POST /dev-tools/kpi-decision` —
   `active`, `archived`, or `paused`, plus `target_value` when the operator
   adjusted it. One call per KPI as the answer arrives, never a batch at the
   end: a run interrupted mid-wave then leaves every answered proposal
   correctly filed instead of losing the whole wave.
4. Move to the next wave. Do not re-litigate a decided KPI.

Waves exist because a list of twenty proposals gets rubber-stamped and a list
of five gets read. If the operator starts answering "yes to all", that is a
signal the proposals are too vague to judge — say so, and offer to reject the
batch and re-scan rather than banking agreement nobody examined.

## Phase 4 — Wire the adopted KPIs to real monitoring

A KPI with no measurement path is a number someone has to remember to update
by hand, which means it stops being true within a month.

Read the connector metadata in the brief (standalone: ask the operator what
the project already uses). If the project has monitoring, error tracking, CI,
or analytics available, then for each adopted KPI that could be fed by one:

- Name the **exact** binding — which connector, which KPI, what it would
  measure. Never "you could wire this up to Sentry"; say which credential and
  which metric.
- Where the wiring is a repo change you can make (a metric emission, a CI step
  that records a number, a query the project can run), propose it as concrete
  work and execute what the operator accepts.
- Where the wiring is a credential binding inside Personas, name it as a
  follow-up for the operator to do on the passport wall. You cannot bind
  credentials from here and should not pretend otherwise.

If the project has no monitoring connectors at all, say that plainly and note
which single one would unlock the most adopted KPIs. One specific
recommendation beats a survey.

## Using subagents

Phases 1-3 are conducted, not performed — the lanes do the heavy reading, and
duplicating their work fights them. Use subagents for **your** reading, where
one exists:

- Phase 3 grounding: before presenting a wave, dispatch subagents to establish
  how each proposed KPI would really be measured in this repo — one per KPI,
  in a single message so they run concurrently. This is what turns "Test
  coverage: 80%" into "there is no coverage reporter configured; adopting this
  means adding one first".
- Phase 4: one subagent per candidate connector to find the integration points
  that already exist in the repo.

Do not fan out for the sake of it. A subagent that reports what you already
know costs a turn and buys nothing.

## Hard rules

- **Never write to the database directly.** The bridge is the only door. If a
  route you need does not exist, say so and stop — do not route around it.
- **Never invent a scan result.** If a lane fails, the phase failed. Reporting
  a plausible context map you assembled yourself would poison every downstream
  feature that trusts the table.
- **Never decide a KPI for the operator.** Recommend, then wait. Adoption is
  the one thing in this skill that is theirs.
- **Report skipped phases as skipped.** A run that skipped two gates because
  the data was fresh is a *good* run. Do not dress it up as work, and do not
  hide it.

## Coordination — active-runs ledger

If the target repo keeps `.claude/active-runs.md`, register at start and move
your entry to `## Recently completed` at the end. Declared paths: whatever
Phase 4 executes (nothing, in the common case). Phases 1-3 write only through
the app.

## Final report

End with a short, honest summary:

- Context map: scanned (full / incremental) or skipped, with counts.
- Features: scanned or skipped, with the proposal count and where to review.
- KPIs: how many proposed, adopted, adjusted, rejected, deferred.
- Monitoring: what got wired, and the single most valuable thing still unwired.
- What a human should do next, if anything.

Then the machine-readable line, on its own, as the last line of your final
message:

```
PROJECT_POPULATE_RESULT: contexts=<full|incremental|skipped|failed> features=<scanned|skipped|failed> kpis_adopted=<n> kpis_rejected=<n> kpis_deferred=<n> wired=<n>
```
