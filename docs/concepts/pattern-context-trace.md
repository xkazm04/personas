# Pattern × Context Traceability

Status: **designed 2026-08-10, not yet built.** Companion to the topic graph
(Overview → Patterns → Graph) and the workspace adoption matrix.

## The problem, precisely

The adoption matrix (`workspace_practice_adoption`) is **project-grain**: one
cell says "project P adopted practice X". The topic graph renders that cell as
if it described the whole project — but in truth a practice adopted "by the
project" is usually followed in a handful of modules and absent everywhere
else it applies. The 2026-07-30 divergence waves measured this directly:
nearly every technique had live counter-examples a few files from its
exemplars, *inside projects that count as adopted*. A ring that reads 100%
because one cell says `adopted` is the exact "false green" the library's own
canon forbids.

The unit that matches how adoption actually happens is the **context** (the
context map's feature-grain unit, `dev_contexts`): small enough that
"follows / violates / not applicable" is a decidable question, large enough
that the answer is worth storing. The Trace overview does not need to show
*which* contexts are covered — the **ratio** is the product surface; the
per-context rows are the auditable substrate underneath it.

## Data model

One new table, mirroring the adoption matrix one level down:

```sql
CREATE TABLE workspace_practice_context_state (
  practice_id  TEXT NOT NULL REFERENCES workspace_knowledge(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES dev_projects(id)        ON DELETE CASCADE,
  context_id   TEXT NOT NULL REFERENCES dev_contexts(id)        ON DELETE CASCADE,
  -- context NAME, denormalized: the reconcile key that survives full rescans
  context_name TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('na','unverified','adopted','violating')),
  -- file:line citations from the verify pass; NULL for na/unverified
  evidence     TEXT,
  verified_at  TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (practice_id, context_id)
);
CREATE INDEX idx_wpcs_project  ON workspace_practice_context_state(project_id, practice_id);
CREATE INDEX idx_wpcs_practice ON workspace_practice_context_state(practice_id, state);
```

### States — and what they may NOT mean

| state        | meaning                                                        | who writes it |
|--------------|----------------------------------------------------------------|---------------|
| `na`         | practice does not apply to this context (wrong layer/stack)    | envelope seeding; verify may override either way |
| `unverified` | applies (as far as the envelope knows), nobody has looked      | envelope seeding; staleness decay |
| `adopted`    | verified: this context follows the practice, evidence cited    | verify ingest ONLY |
| `violating`  | verified: applies here and is not followed, evidence cited     | verify ingest ONLY |

Two hard rules, both scars from this repo's own history:

1. **`adopted` and `violating` require cited evidence.** No mechanical writer
   may set them. A context is never "adopted by silence" — a verify session
   that read a context and said nothing about a practice leaves the cell
   `unverified`. (The alternative — treating in-scope-but-uncited as holds —
   is how a green gate asserts nothing; see the inert-enforcement postmortems.)
2. **`na` is a first-class answer, excluded from every denominator.** "This
   Rust data context cannot follow a React state practice" must not read as
   0% adherence — that conflation is exactly what once queued seven Next.js
   practices against a Tauri app.

## The three writers

### W1 — Envelope seeding (mechanical, cheap, Rust-only)

When a practice is adopted, or a project's contexts change, seed missing cells
for every (adopted practice × context) pair:

- `na` when the practice's applicability envelope misses the context's
  `tech_stack`/`category` (reuse `applicability_matches`, extended with the
  context's own tech_stack instead of the project's), or the practice's topic
  area is disjoint from the context's category by the coarse map
  (frontend/* practices → `ui` contexts, data/* → `data`+`api`, etc. —
  fail OPEN: when unsure, `unverified`, never `na`).
- `unverified` otherwise.

Seeding is idempotent (`INSERT OR IGNORE`) and never touches verified cells.
This is the same envelope logic prototyped in the 2026-07-29 probe experiments;
its measured precision is why it only gets to say "maybe" (`unverified`) and
"surely not" (`na`), never "yes".

### W2 — Verify ingest (authoritative, evidence-attributed)

The existing verify/divergence lane already produces file-cited verdicts
(`applied_at` / `absent_at` with `file:line`, per the technique-scan contract).
The ingest door — not the agent — attributes files to contexts:

- resolve each cited file against `dev_contexts.file_paths` (exact path match,
  the same mapping `dev_context_file_hashes` is keyed by);
- an `applied_at` citation → that context's cell becomes `adopted`;
- an `absent_at` citation → `violating`;
- an explicit `not_applicable` verdict for a scoped context → `na`;
- conflict inside one run (same practice cited both ways in one context) →
  `violating` wins — a context that half-follows a practice is work owed;
- files that resolve to no context are recorded in the run report, never
  silently dropped (the report-denominator rule).

This keeps the agent contract UNCHANGED — verifiers keep talking about files,
which they can actually see; contexts are the app's own bookkeeping. Batching
stays by-context (one session reads a context once, rules on all candidate
practices), which the scan economics already proved out.

### W3 — Staleness decay (the map moves; verdicts age)

A verdict is a statement about code that existed at `verified_at`. The delta
rescan already computes per-context file-hash changes (`dev_context_file_hashes`,
`incremental_scan`). When a context's files change materially (any hash delta
in its set), its `adopted`/`violating` cells decay to `unverified` (evidence
kept, `verified_at` cleared) — coverage honestly sags until someone re-looks,
instead of a 2026 verdict vouching for 2027 code.

## Roll-ups — the one number the graph shows

Per (practice, project):

```
applicable = cells where state != 'na'
adherence  = adopted / applicable          -- the ring
verified   = (adopted + violating) / applicable   -- optional secondary axis
```

- Topic-node ring (graph, project lens): mean adherence over the cluster's
  practices, weighted by each practice's applicable-context count.
- Workspace (no lens): same, summed across member projects —
  `Σ adopted / Σ applicable`. Projects with no context map contribute nothing
  (not zeros): no map means "cannot measure", not "0%".
- Zero applicable contexts → no ring (absence of data is not a ring at 0%).
- The project-grain `workspace_practice_adoption.state` is NOT derived from
  these numbers. Governance ("we committed to this") and measurement ("this is
  how far it actually reached") stay separate axes; the graph shows commitment
  as node colour (the existing lens) and measurement as the ring.

## Surviving rescans

Full context rescans DELETE unpinned contexts and recreate them under fresh
ids; `snapshot_context_links` / `reconcile_links` already restore use-case
slices and KPI scopes **by context name**. Pattern cells join that exact
ritual: snapshot `(practice_id, context_name, state, evidence, verified_at)`
before the scan, re-key to the new ids by `context_name` after, drop cells
whose name vanished (reported, not silent). Delta rescans never delete
contexts, so W3 decay is the only effect there. `context_name` being
denormalized into the table is what makes the snapshot self-contained.

## Surface

- IPC: `dev_tools_practice_context_rollup(workspace_id, project_id?)` →
  `[{ practice_id, adopted, violating, unverified, applicable }]` (ts-rs,
  camelCase — mind the ratchet). Rollup only; per-context rows stay queryable
  by the detail modal via a second command when a drill-in is wanted later.
- Graph: `CoverageRing` switches its input from matrix-resolved-share to
  context adherence wherever rollup rows exist; the matrix share remains the
  fallback for projects without context maps. Modal metadata line becomes
  "adherence 34% · 12 of 35 contexts verified".
- Verify dispatch: the existing rollout/verify prompts gain one line asking
  for `not_applicable` verdicts per scoped context; everything else they
  already emit.

## Build order

1. **P0 — schema + seeding + rollup command** (migration, W1, IPC, bindings).
   Rings switch over; they will read LOW (mostly `unverified`) — that low
   number is the honest baseline the current rings overstate.
2. **P1 — verify ingest attribution** (W2 in the existing ingest door +
   scoped-verdict line in the verify prompt).
3. **P2 — rescan snapshot/reconcile + staleness decay** (W3; joins
   `ContextLinkSnapshot`).
4. **P3 — cross-project Trace overview** (per-area ratios across the
   workspace; the "which projects lag on security/*" question).

Explicitly out of scope: showing per-context lists in the Trace overview (the
ratio is the product; the rows are substrate), and any LLM writer for
`adopted` outside the evidence-cited verify lane.
