# Workspaces — Workspace Knowledge Center

> Group your dev projects into a **workspace** (your "org") and grow a governed,
> cross-project best-practice library inside it: practices are harvested from
> member repos, adjudicated by you, and distributed back — so good design, code
> quality, UI and performance patterns discovered in one project lift all of them.

**Design & full arc:** [`docs/plans/workspace-knowledge-center.md`](../../../plans/workspace-knowledge-center.md)
**UI:** Plugins → Dev Tools → **Workspaces** (`src/features/plugins/dev-tools/sub_workspaces/`)
**Backend:** `src-tauri/src/commands/infrastructure/dev_workspaces.rs` → `db/repos/dev_workspaces.rs`
**Tables:** `dev_workspaces`, `workspace_knowledge`, `workspace_practice_adoption`, plus nullable `dev_projects.workspace_id`

## Concepts (Arc 1 — shipped)

- **Workspace** — a named, coloured group of dev projects. A project belongs to at
  most one workspace (`dev_projects.workspace_id`, NULL = unassigned). The old
  localStorage prototype (`devtools.workspaces.v1`) is imported automatically on
  first open (idempotent by name), and the footer workspace switcher + Project
  Manager tabs now read the database. The UI is the **Atlas** shell (a crest-card
  grid; the selected workspace unfolds a detail band with membership + library).
  The library listing is the shared **DataGrid** (paginated, per-column
  sortable/filterable) beside an emergent slash-path **topic tree** derived from
  the items — crisp at hundreds of practices, with a **project filter** on the
  listing toolbar that narrows it to one origin repo (or to workspace-level,
  hand-authored practices). Everything shown is real: the deterministic demo
  corpus that once padded an empty library was retired when harvesting shipped.
- **Knowledge item (practice)** — a governed unit of cross-project knowledge:
  `kind` (pattern / pitfall / decision / howto / fact), a distilled `statement`,
  optional evidence (`detail_md`), a slash-path `topic` (`ui/motion/reveals`)
  that drives the library's arbitrary-depth tree, and an `applicability`
  envelope (layers, languages, frameworks) so a practice only targets the
  projects it can apply to. Author one by hand via **New practice** in the
  library header (lands as `proposed`); the harvest engine (Arc 2) fills the
  rest automatically. **Click any practice** to open its detail modal — the
  full claim, its evidence, the metadata the table doesn't carry (origin,
  topic, altitude, confidence, provenance), and the governance action its state
  allows: **Adopt / Reject** while `observed`/`proposed`, **Roll out /
  Deprecate** once `adopted`. Rejection is retained, not deleted, so the miners
  dedup against it for 90 days.
  Adjudicating a library is a sequential pass, so the modal is a **review
  queue**, not a single row: **← / →** (or the header's ‹ › stepper) walk the
  library's *current visible ordering* — filters, sort and search included —
  and a decision **advances to the next item automatically**, closing when the
  queue runs out. The queue is snapshotted when the modal opens; recomputing it
  from the live table would re-sort under the cursor the moment a decision
  changed a row's status, and "next" would stop meaning next. Items deleted
  from elsewhere mid-pass are skipped rather than shown blank.
- **Topic taxonomy** — `topic` is **exactly two segments, `area/cluster`**,
  drawn from a closed vocabulary in
  [`db/repos/workspace_taxonomy.rs`](../../../../src-tauri/src/db/repos/workspace_taxonomy.rs).
  Two rules make it hold:
  1. **`topic` answers WHERE a practice lives** (which concern or subsystem it
     governs); the separate `ftype` column answers what *shape* it is. A
     repository-behind-one-interface practice is `data/store-boundary`, not
     `architecture/boundaries`, even though it is boundary-shaped. When both
     columns encoded shape, `architecture` swallowed a third of the library.
  2. **The 15 areas are precedence-ordered** — security · auth · billing · llm ·
     testing · observability · performance · errors · concurrency · data · api ·
     frontend · integration · architecture · process. Most practices touch
     several at once, so writers take the *first* area that genuinely governs.
     `architecture` sits near the end deliberately: it means the codebase's own
     skeleton. Without a stated tiebreak, every writer picks differently — which
     is exactly how the library fragmented (13 parallel agents once produced 154
     topics for 177 items, and a first regex normalization left a dozen
     `general` catch-alls plus the same leaf name meaning different things under
     three areas).

  **Growth is designed in.** Areas are closed; clusters are a *starter
  vocabulary*. `normalize_topic()` keeps an unrecognized cluster under a
  recognized area verbatim — that is how the taxonomy grows with the workspace.
  Only an unrecognized *area* is quarantined onto a visible `unsorted/` shelf,
  because a new top level is the decision that actually re-fragments the tree
  and it should be a human's. The vocabulary ships to harvest agents inside
  `snapshot.json` and to the divergence pass inside its prompt, so there is one
  copy and it cannot drift from what the ingest door enforces.
- **Categorization axes** (orthogonal to the topic tree) let the library rank
  and filter by *quality*, not just subject: `abstraction`
  (macro / meso / micro — the altitude), `ftype` (finding-type taxonomy:
  architecture / module-boundary / data-flow / extensibility / api-design /
  state-mgmt / error-strategy / concurrency-reliability / perf-strategy /
  micro-technique), `durability` (durable / situational / mechanical),
  `governing_id` (roll a micro-instance up under a macro doctrine), and
  `evidence_count` (prevalence). They feed the consistency pillar and the
  detail modal. Machine writers (miners, harvest) set these; hand-authored
  items may leave them null. (The default-on **Hide lint layer** toggle that
  used to drop `micro` / `mechanical` rows from the listing was removed — it
  hid harvested rows by default, which made the library look emptier than it
  was. Filter on the axes in the detail surface instead.)
- **Governance ladder** — `observed` (machine-harvested) → `proposed` →
  `adopted` / `rejected`, plus `deprecated` (optionally superseded by a newer
  practice). **Agents only ever propose; adoption is always your decision.**
  Rejected items are kept so future extraction runs don't re-propose them.
- **Adoption matrix** — adopting a practice fans it out to every member project as
  a per-project state: `to_process`, `proposed`, `na` (not applicable to that
  stack), `dispatched`, `adopted`, or `diverged`. A project newly assigned to the
  workspace automatically inherits every applicable adopted practice as its
  to-adopt queue — the library scales with the workspace.
- **Actionable kinds → the `to_process` queue.** Which seed state a cell gets
  depends on what the practice *asks for*. A `pitfall` names something to remove
  and a `pattern` names something to converge on: both are work the repo owes,
  so their cells seed at **`to_process`** — the execution queue. `decision`,
  `howto` and `fact` are reference material; they reach the repo through the
  memory projection and seed at plain `proposed`. The split lives in one place
  (`initial_adoption_state` in `src-tauri/src/db/repos/dev_workspaces.rs`,
  mirrored by `ACTIONABLE_KINDS` in `src/api/devTools/workspaces.ts`). The Pulse
  shows the open `to_process` count, so adopting an actionable practice has a
  visible consequence instead of being a silent status change. **Draining the
  queue automatically is not wired yet** — today you clear a cell by dispatching
  it from the rollout modal; the queue is the hook a future executor reads.

## Pulse — the library's own dashboard

Above the library sits a **Pulse** band answering the questions you have
*before* opening any row. Everything in it is computed on read and **never
stored** — a stored weekly rollup would be a second source of truth that goes
wrong the moment a decision is reversed (the plan's *projection principle*).

**Four health pillars**, each 0–1 over the library's rows:

| Pillar | Asks | Denominator |
| --- | --- | --- |
| **Governance** | Of everything harvested, how much has a human actually ruled on? | all practices |
| **Currency** | Of the adopted canon, how much was touched in the last 90 days? | adopted only |
| **Consistency** | How much of the corpus obeys its own structure — well-formed `area/cluster` topic plus categorization axes? | live (non-rejected) |
| **Liquidity** | Of the project slots that could carry an adopted practice, how many actually reached `adopted` in the repo? | applicable cells (`na` excluded) |

A pillar with nothing to measure shows **`—`, not a score** — and is dropped
from the overall average rather than dragged to zero. The library's own
`data/modeling` canon says *"never fabricate — unknown values stay null, gaps
are reported not filled"*; a health surface that invents a number for an empty
workspace breaks the doctrine it is reporting on. Each pillar also carries its
denominator (`92% /13`), because 100% over 3 items should not read like 100%
over 300.

Rejected practices are deliberately **excluded from Consistency**: they are
retained as dedup memory ("rejection is knowledge"), and holding them to the
current structure would penalize the library for remembering.

**The week's activity** — adopted / rejected / deprecated / harvested counts for
the last 7 days, expandable to the actual items (click one to open its detail).
The digest windows on `decided_at`, not `updated_at`: a verification pass or a
topic renormalization touches `updated_at` on months-old rows and would
otherwise resurface them as "decided this week". A quiet week says so plainly
rather than padding itself.

## Commands

`dev_tools_workspace_list / create / update / delete / assign_project / import_local`,
`dev_tools_workspace_knowledge_list / create / update / decide / delete`,
`dev_tools_workspace_adoption_list / set` — wrappers in `src/api/devTools/workspaces.ts`.

## Extraction engine (Arc 2 — shipped)

The library fills itself. From the library header's **Extract** menu:

- **Run miners** — deterministic, no-LLM. Two cross-project miners scoped to
  workspace members (`dev_projects.workspace_id`): shared **findings** (the same
  `dev_ideas` finding recurring in ≥2 members → a shared pitfall) and skill
  **adoption gaps** (a skill heavily used in one member, absent in a sibling →
  a howto). Candidates land `observed`, dedup-gated. Cheap signal before any LLM
  spend. Command: `dev_tools_workspace_run_miners`.
- **Harvest a project (AI)** — dispatches Fleet Dev-runner sessions (the
  `practice-harvest` skill / `practiceHarvestPrompt.ts` engine) that read the
  repo and write `practice-harvest/runs/<id>-<scope>/result.json`. Harvest fans
  out **per scope**, not per repo — see *Scopes and coverage* below. **Results
  import themselves** — while the Workspaces surface is open, a poll watches
  each project's harvest sessions and ingests once the wave settles (an
  interactive CLI session parks at `idle`, not `exited`); ingest is idempotent
  via the run-dir `ingested.json` marker, so firing on idle/exit/vanish is safe,
  and a no-argument ingest imports **every** un-ingested run, not just the
  newest. **Import** stays as the manual fallback for runs that finished while
  the surface was closed. Commands: `dev_tools_workspace_harvest_prepare` →
  (Fleet) → `dev_tools_workspace_knowledge_ingest`, with
  `dev_tools_workspace_harvest_coverage` for the per-scope ledger.

### Scopes and coverage — why harvest fans out

The first harvest engine sent **one agent at a whole repository** with a ~15-item
cap and the instruction *"prefer a small number of high-signal practices over
volume"*. On a large codebase that brief is satisfiable **without reading the
codebase**: the cheapest place to find something that looks like a convention is
the root config files. A measured run on the Personas repo (2026-07-27) spent
~11 tool calls over 8,568 tracked files, returned 14 items, and every one came
from `eslint.config.js` / `lefthook.yml` / `scripts/` / `build.rs` — **nothing**
from the 236 mapped contexts of feature code. The run was not failing; it was
complying. Worse, it compounded: the snapshot tells each run which practices
already exist but never told it *where it had already looked*, so run N+1
re-read the same configs, hit the dedup list and returned less (an earlier run
returned 2 items).

Three changes fix it, and they only work together:

1. **Territory** — `personas_core::harvest_scopes` derives named scopes from the
   repo: one per **group** in `context-map.json` when present (12 groups /
   ~3,700 files here), otherwise a generic walk grouping files by their first
   two path segments. `repo-global` (root configs, CI, hooks, scripts) is always
   emitted — it is a legitimate territory, just not the whole repo. Each session
   owns exactly one scope and is told to stay in it.
2. **No item cap** — the prompt asks for everything the territory genuinely
   supports (usually 5–25). The closed taxonomy in `workspace_taxonomy.rs` is
   what prevents the 154-topics-for-177-items fragmentation the cap was
   originally introduced for; keeping both meant the library was protected by
   the taxonomy *and* starved by the cap. The machine guards remain:
   `MAX_INGEST_PER_RUN` = 120 candidates, 1 MiB of `result.json`.
3. **Coverage memory** — `workspace_harvest_coverage` holds one row per (member
   repo, scope). `last_harvested_at IS NULL` means *never read*, and the backend
   returns never-read scopes first. Each Harvest click dispatches a bounded
   **wave** of 4 scopes into the stalest ground and reports how many remain, so
   repeated clicks advance instead of re-reading. The Extract menu shows
   `3/13 scopes harvested` per project — an unread codebase can no longer look
   like a complete one.

Coverage is stamped on what was **read**, not on what survived dedup: a
territory that was harvested and yielded only duplicates has still been read,
and re-dispatching it ahead of never-read ground is exactly the decay the ledger
exists to stop. Runs that predate scopes (or omit the `scope` field) are stamped
`repo-global`, which is honestly what they read.

### What the first full scan changed (2026-07-27)

Twelve territories were harvested in parallel: **330 items**, against 14 from the
previous whole-repo run. Contract compliance was near-perfect (0 invented areas,
0 malformed topics, 0 duplicate titles across 12 independent agents), and the
closed taxonomy held at **5.8 items/topic** — the fragmentation incident that
originally motivated the item cap was 1.15. Volume rose 23x and topic density
improved 5x, which settles the question: the taxonomy protects the library, the
cap only suppressed reading.

The same scan falsified four things in the design, each fixed:

1. **Fragmentation had simply moved to `ftype`** — 90 distinct values for a field
   designed with 11 (`guard`, `guardrail`, `convention`, `policy`, …). Only
   `topic` was ever shipped as a closed vocabulary and normalized at ingest.
   `ftype` is now closed the same way (`FTYPES` + `FTYPE_HINTS` in
   `workspace_taxonomy.rs`, shipped in `snapshot.json`, aliased and quarantined
   by `normalize_ftype`). **Lesson: enforcing one axis does not protect its
   neighbours.**
2. **`durability` was a dead axis** — 330 of 330 items said `durable`, because
   the prompt tells authors mechanical items don't belong here. It is gone from
   the author contract and ignored at ingest; it is a reviewer's call or nothing.
3. **`to_process` keyed on `kind` captured 91.5% of the library** — see below.
4. **`governing_id` was set on 0 of 330 items.** A session sees one territory
   and cannot know what a topic already holds, so the app derives it after
   ingest (`roll_up_topic_doctrine`): within a topic, the `macro` item with the
   most evidence governs the rest. No doctrine, no linking.

Coverage also gained **depth**. Every agent volunteered its real read-depth and
the pockets it never opened ("~11% of 404 files", "teams/ is the real gap") and
the first ledger discarded all of it. `result.json` now carries a `coverage`
block (`files_read` / `files_total` / `estimated_pct` / `unread_pockets`), the
ledger stores it, the Extract menu shows `4/13 scopes · ~26% read`, and the next
dispatch for a scope receives the previous pass's unread pockets — which is what
makes a second wave a second *pass* rather than a re-read.

### `to_process` is earned by evidence, not inferred from kind

The original rule seeded `to_process` for actionable kinds (pitfall/pattern) at
adoption time. On real data that is 302 of 330 items — and tightening on the
other axes doesn't help (288 are also `durable` and non-`macro`). A queue holding
90% of the library is a synonym for "adopted".

The error was conceptual: **`kind` describes the shape of a practice, never
whether *this repo* violates it.** A pattern the repo already follows is not
work. Only evidence answers that, and the verify pass already gathers it. So:

| Cell before | Verdict | Cell after | Meaning |
| --- | --- | --- | --- |
| `adopted` | holds | `adopted` | still true here |
| `adopted` | fails | `diverged` | **drift** — the code moved away from canon |
| `proposed` / `to_process` | fails | `to_process` | **work owed** — this repo does not comply |
| any | holds | `adopted` | already satisfied here, however the cell got there |
| `na` | — | `na` | a stack judgement; a code verdict does not resurrect it |

Adoption seeds `proposed` (or `na`) and nothing else. `is_actionable_kind`
survives as the pre-filter deciding *which* practices are worth spending a
verification on — a `fact` has no work behind it either way — and the verify
pass now orders its capped run actionable-first, then never-verified-first.
`materialize_practice_ideas` (the `to_process` → `dev_ideas` bridge) is
unchanged and still refuses non-actionable kinds, so the backlog guard holds
regardless of how the queue was filled.

### Reviewing a large library

330 pending items at one modal each is roughly four hours, which makes the
governance pillar unmovable and the rational response "don't harvest". So the
library table supports **bulk review**: multi-select (undecided rows only —
batch-adopting something already rejected is a mistake, not a shortcut), select-all
across the *current filters*, and Adopt/Reject on the selection via
`dev_tools_workspace_knowledge_decide_bulk`. Per-item failures are reported, never
swallowed: a reviewer who thinks they cleared 50 must not silently have cleared 47.
The default sort is now **review value** (`evidence_count x confidence`, undecided
first) rather than ingest order — at this volume the order decides what actually
gets adjudicated before attention runs out.
- **Find divergences (AI)** — the question only visible in aggregate: *are
  several member projects solving the same problem in different, locally
  reasonable ways?* Runs **in-app** as a headless background job (not a Fleet
  terminal — the input is the library, not a working tree), reasoning over the
  workspace's accumulated knowledge and proposing ONE recommended practice per
  real divergence, carrying each project's current approach as evidence. The
  bar is deliberately conservative (apps legitimately differ; zero proposals is
  a valid result) and lint-level mechanics are explicitly out of scope. Needs
  ≥2 member projects and ≥4 live knowledge items. Commands:
  `dev_tools_workspace_run_divergence` → `_get_divergence_status` (poll) →
  `_cancel_divergence`, on the `divergence-scan-*` events.

All machine-harvested candidates route through one governed door
(`ingest_candidates`): landed `observed` with machine provenance, dedup-gated on
`dedup_key` — an existing live practice or a rejection within the last 90 days
blocks re-proposal ("rejection is knowledge"). Everything still waits for a
human `adopt`.

## Distribution (Arc 3 — shipped)

An adopted practice is worth little if it only lives in the app's database.
Two paths carry it out to the repos:

- **Project to repos** (ambient, the autonomy lever) — writes each member repo's
  applicable adopted practices into `.claude/workspace-practices.md` and ensures
  a single `@import` line in that repo's `CLAUDE.md`, so **every future Claude
  Code session there carries the workspace's canon at zero dispatch cost**. The
  generated file is fully owned (overwritten wholesale); CLAUDE.md only ever
  gains one line — the projection never parses or rewrites your own prose.
  Practices are grouped by topic area and annotated with that project's rollout
  state. Command: `dev_tools_workspace_project_practices`.
  *(Deliberate deviation from the plan's marker-block sketch: this follows the
  existing `engine/claude_md_projection.rs` precedent, which is strictly safer.)*
- **Roll out** (push) — click an **adopted** practice to open its rollout
  surface: each member project with its current state and a dispatch that sends
  a Fleet Dev-runner session into that repo with the practice, its evidence, and
  a customize-for-this-codebase instruction. The prompt requires the session to
  survey first and to return `DECLINED: <why>` if the practice genuinely doesn't
  fit — a rollout that can't refuse produces cargo-culted code. Dispatch flips
  the cell to `dispatched`; you mark `adopted` or `diverged` after reading the
  verdict.

## Later arcs (planned)

Weekly digest ("what the workspace adopted/deprecated this week" — a computed
view, never stored) and adoption verification (a rescan flipping `adopted` →
`diverged` when evidence contradicts; surfaced, never auto-un-adopted) are the
remaining Arc-3 pieces. Then workspace-scoped skills (Arc 4), health pillars +
Mastermind alignment (Arc 5).
