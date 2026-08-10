# Pattern Fabric — the knowledge base as a development-time reference module

Status: **F0+F1 shipped 2026-08-10 (edges, facet door, playbooks + curator UI, 8 seeded drafts); F2 shipped 2026-08-10 (consult routes, projection v2, patterns skill).** F3 (rewiring, 432 revised / 23 pruned into the 3-level map) shipped 2026-08-10; F4 (extends contribution loop + born-subscribed projection on workspace join) shipped 2026-08-10. The fabric arc F0-F4 is complete; remaining growth is operational (verify runs filling rings, consult telemetry steering playbook lifecycle, facet vocabulary maturing). Extends
[`pattern-context-trace.md`](./pattern-context-trace.md) (the measurement
half); this is the *structure and access* half. Target: the library stops
being a review artifact and becomes the module a CLI development process
consults **while writing code** — and ultimately the reference core of the
App Factory (new apps born at the workspace's quality bar, day zero).

## The three requirements, restated precisely

- **(a) Scale past 1,000 patterns** without the tree or the graph drowning.
  Today: 455 adopted across 15 areas / ~69 clusters — 6.6 per cluster. At
  1,500 that's 22 per cluster: the modal becomes a scroll, the cluster stops
  being a decidable unit, and no CLI consumer can afford to read one.
- **(b) Connect patterns.** Patterns already relate — the 332-item
  adjudication found ~5 principle clusters each restated by 4–7 mechanism
  patterns, and `governing_id` (roll-up doctrine) is one hard-coded edge type.
  Connections must be first-class, typed, and renderable.
- **(c) Situation-keyed access.** "Project adds a new table" is not a topic —
  it is a *situation* that cuts across `data/migrations`, `data/store-boundary`,
  `api/client-seam`, `frontend/data-fetching`, `testing/parity`. The consumer
  arrives with an intent, not a taxonomy path.

## Alternatives evaluated — and what this repo's own data says

**A1 — Just deepen the taxonomy (area/cluster/subcluster, patterns as leaves).**
Solves (a) only. A situation like "new table" would still be scattered across
five branches, so (c) fails; and a strict tree cannot express (b) at all.
Necessary, insufficient.

**A2 — Free tags instead of a new level.** Every open vocabulary handed to
agents fragmented in this workspace — measured: `ftype` grew 90 values across
330 items before it was closed; `family` hit 100. Tags would fragment in one
harvest. Rejected outright.

**A3 — Embedding search instead of structure.** Attractive for (c), but a CLI
process needs **deterministic, citable lookups** (stable ids, reproducible
briefs, auditable "why did the session apply this") and the whole apparatus —
verify lanes, adoption cells, context adherence — keys on ids. Embeddings are
a *ranking complement inside* a situation's candidate set, never the spine.
Deferred as an optimization.

**A4 (chosen) — one deeper taxonomy tier for scale + two orthogonal layers:
typed pattern edges for connection, and a closed Situation layer ("playbooks")
for access.** The tree answers *where knowledge lives*; edges answer *how it
relates*; playbooks answer *when it fires*. Conflating those three axes into
one hierarchy is what the requirements (a)+(b)+(c) make impossible — the
evaluation's core conclusion is that this is **not one new nested level but
three small structures**, each closed the way this workspace has learned
vocabularies must be.

## Structure

### S1 — Third topic segment (scale)

`area/cluster/facet` — e.g. `data/migrations/table-rebuild`,
`frontend/state/subscription-scope`. The storage was built for this
(`workspace_knowledge.topic` is a free slash-path; `libraryModel` derives the
tree at render time from whatever depth exists) — only the **door** clamps to
two segments. Change: `normalize_topic` accepts an optional third segment,
open *under* a closed cluster (same precedence rules; unknown facets are kept,
listed on a per-cluster shelf, and merged in review — the `unsorted` pattern
one level down). Facets appear in the graph as the third ring inside a focused
cluster; the drill-down camera built in the prototype rounds is already the
right navigation for it. Two-segment topics stay valid forever — a facet is
earned when a cluster grows past ~10 patterns, not imposed.

### S2 — Typed pattern edges (connection)

```sql
CREATE TABLE workspace_pattern_edges (
  from_id    TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
  rel        TEXT NOT NULL CHECK (rel IN
             ('governs','composes_with','prerequisite','conflicts_with','supersedes','extends')),
  note       TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, rel)
);
```

Closed relation vocabulary (six, argued from observed need, no invention):
- `governs` — principle ⇒ mechanism (migrates `governing_id`; the ~5
  redundancy clusters the adjudicators flagged become one governing principle
  each with mechanism patterns linked under it, instead of near-duplicates
  begging to be deleted).
- `composes_with` — apply together (bounded-fanout ∘ signal-the-crossing).
- `prerequisite` — ordering inside a playbook brief.
- `conflicts_with` — mutually exclusive approaches; a brief must never ship both.
- `supersedes` — succession with history (the existing `superseded_by` column
  stays authoritative for status; the edge makes it graph-visible).
- `extends` — a project-contributed refinement of workspace canon (the
  feedback loop below).

Graph rendering: edges draw **only inside a focused dimension or between
selected nodes** — cross-branch curves at overview zoom are the hairball that
kills every knowledge graph. PoE precedent again: connections are local.

### S3 — Playbooks (the situation layer, the CLI's front door)

```sql
CREATE TABLE workspace_playbooks (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES dev_workspaces(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,          -- 'add-db-table', stable, citable
  title        TEXT NOT NULL,
  -- Machine-matchable intent triggers, JSON array of short phrases the
  -- consult endpoint matches against ('create table','new migration',…).
  triggers     TEXT NOT NULL,
  summary      TEXT NOT NULL,          -- 3-6 lines: the shape of the move
  status       TEXT NOT NULL CHECK (status IN ('draft','active','retired')),
  created_at   TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, slug)
);
CREATE TABLE workspace_playbook_patterns (
  playbook_id  TEXT NOT NULL REFERENCES workspace_playbooks(id) ON DELETE CASCADE,
  practice_id  TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
  phase        TEXT NOT NULL CHECK (phase IN ('before','during','verify')),
  ordinal      INTEGER NOT NULL DEFAULT 0,
  note         TEXT,                   -- one line: why this pattern, here
  PRIMARY KEY (playbook_id, practice_id)
);
```

A playbook is a **curated bundle with phases**: what to know before you start,
what to apply while building, what must hold before you call it done (the
`verify` phase seeds pattern×context cells for the touched contexts — the
trace layer and the fabric meet exactly here). Expected count: **20–40 per
workspace**, human-gated like everything else in the library. Candidate seeds
for this workspace fall straight out of existing material: add-db-table,
new-ipc-command, new-ui-surface, new-connector, new-cron-or-trigger,
new-shared-component, add-llm-call-site, new-plugin.

Playbooks are N:M over patterns **across all branches** — they are the
requirement-(c) object, and deliberately NOT part of the topic tree. In the
graph they render as a distinct constellation layer (toggle), not as tree
nodes.

## The interaction layer — how a CLI session actually consults this

Two channels, mirroring how sessions already reach Personas:

**Live (app running): consult routes on the dev-tools HTTP server**
(`dev_tools_http.rs` already serves projects/contexts/KPIs — patterns join it):

```
GET /patterns/index?project=…            → compact tree + playbook slugs (≤20KB)
GET /patterns/consult?intent=…&project=… → matched playbooks; per playbook the
                                           phased pattern briefs, each with
                                           statement, exemplar file:line refs,
                                           and THIS project's adherence for it
GET /patterns/{id}                       → full card (detail_md, edges, evidence)
POST /patterns/propose                   → the contribution inbox (below)
```

The consult response is **project-aware**: it carries the caller's own
adherence cells, so the brief says "this repo already follows 4 of these —
here are its own exemplars" (reuse-your-own-first, exactly the user's
new-table example) before falling back to workspace exemplars from sibling
repos.

**Ambient (no app required): projection v2.** Today's projection writes one
flat `workspace-practices.md` — readable at 185 patterns, hopeless at 1,000.
It becomes a tiered bundle under `.claude/patterns/`:

```
index.json        ids + one-liners + topic tree + playbook slugs (the router)
playbooks/<slug>.md   the phased brief, pattern cards inlined
```

plus a small `patterns` **skill** projected with it: "state your intent →
match a playbook in index.json → read its brief → cite pattern ids in the
work you produce → if you deviated or improved, file a proposal." CLAUDE.md
keeps its single `@import` line, now pointing at a two-page index instead of
the whole library. Budget rule: ambient text a session pays for on *every*
turn stays under ~150 lines; everything else is fetch-on-intent.

## The feedback loop — distribute extensions back

Reuses the harvest ingest door rather than inventing a second one: a member
session that improves on canon writes a normal harvest item with
`extends: <pattern-id>` (and optionally a playbook slug). Ingest stores it
`observed` + an `extends` edge; it walks the same adjudication queue; on adopt
it joins the parent's cluster and every playbook the parent belongs to
(flagged for curator confirmation). Governance is unchanged — sessions
propose, humans adopt — which is the property that made the library
trustworthy enough to project into repos in the first place.

## The rewiring (one-time, gated)

The 455 adopted patterns need re-tiering once. Same machinery as every
successful pass this month:

1. Opus agent per area: propose facet splits for clusters >10, `governs`
   elections for the known redundancy clusters, edge candidates, and playbook
   membership — as JSON proposals, repo untouched.
2. Operator gates per area (bulk UI already exists; proposals land as a
   review queue, not applied silently).
3. Apply through one door that normalizes facets and quarantines unknowns.

## App Factory tie-in

Factory scaffolding consults the same surface, one step earlier: at "create
app of type X," the matched playbooks emit the day-zero standard — CLAUDE.md
sections citing pattern ids, seeded adoption + context cells (`unverified`,
honest), and verify-phase checks wired into the project's first milestone. A
new app is then *born subscribed* to the fabric, and its first verify run
starts filling rings instead of starting from an unmapped void. That is the
"core reference module" role: one library feeding review (adjudication),
measurement (trace), development (consult), and creation (factory) through
one set of ids.

## Phases

- **F0** — S2 edges (+ `governing_id` migration onto them) + third-segment
  door + graph edge rendering inside focused dimensions.
- **F1** — Playbook schema + curator UI (create from a multi-selected set of
  patterns in the graph/modal) + seed 8–10 playbooks by hand.
- **F2** — Consult routes + projection v2 + the `patterns` skill; retire the
  flat projection.
- **F3** — Rewiring pass (agent proposals → gated apply).
- **F4** — Contribution loop (`extends` through the harvest door) + factory
  scaffold consumption.

## Risks named now

- **Playbook sprawl** — the layer only works closed. Cap ~40, human-gated,
  retired like patterns; a playbook nobody's consult log ever matched is a
  candidate for retirement (consult calls are logged per playbook).
- **Edge hairball** — never render cross-branch edges at overview zoom.
- **Ambient budget regression** — projection v2 must be *smaller* than v1 in
  always-loaded bytes; the index is a router, not a library.
- **Two doors drifting** — consult (read) and harvest (write) must share the
  id space and vocabularies; the fabric adds no second write path.
