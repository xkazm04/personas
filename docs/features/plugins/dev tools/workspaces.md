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
  the items — crisp at hundreds of practices. A **Demo corpus** toggle blends in
  a deterministic sample dataset so scale is visible before harvesting exists
  (demo rows never touch the database).
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
  `evidence_count` (prevalence). The library's **Altitude** column + a default-on
  **Hide lint layer** toggle drop `micro` / `mechanical` items — a practice
  library surfaces *doctrine*, not lint-enforceable rules (route those to
  eslint/clippy). Machine writers (miners, harvest) set these; hand-authored
  items may leave them null.
- **Governance ladder** — `observed` (machine-harvested) → `proposed` →
  `adopted` / `rejected`, plus `deprecated` (optionally superseded by a newer
  practice). **Agents only ever propose; adoption is always your decision.**
  Rejected items are kept so future extraction runs don't re-propose them.
- **Adoption matrix** — adopting a practice fans it out to every member project as
  a per-project state: `proposed` (to adopt), `na` (not applicable to that
  stack), `dispatched`, `adopted`, or `diverged`. A project newly assigned to the
  workspace automatically inherits every applicable adopted practice as its
  to-adopt queue — the library scales with the workspace.

## Pulse — the library's own dashboard

Above the library sits a **Pulse** band answering the questions you have
*before* opening any row. Everything in it is computed on read and **never
stored** — a stored weekly rollup would be a second source of truth that goes
wrong the moment a decision is reversed (the plan's *projection principle*).

**Four health pillars**, each 0–1 over the real rows (the demo corpus is
excluded — a dashboard that counts the sample reports activity that never
happened):

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
- **Harvest a project (AI)** — per member repo, dispatches a Fleet Dev-runner
  session (the `practice-harvest` skill / `practiceHarvestPrompt.ts` engine)
  that reads the repo's real conventions and writes
  `practice-harvest/runs/<id>/result.json`. **Results import themselves** — while
  the Workspaces surface is open, a poll watches each dispatched session and
  ingests its run once the work settles (an interactive CLI session parks at
  `idle`, not `exited`); ingest is idempotent via the run-dir `ingested.json`
  marker, so firing on idle/exit/vanish is safe. **Import** stays as the manual
  fallback for runs that finished while the surface was closed. Commands:
  `dev_tools_workspace_harvest_prepare` → (Fleet) →
  `dev_tools_workspace_knowledge_ingest`.
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
