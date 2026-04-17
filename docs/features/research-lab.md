# Research Lab

> A project workspace for turning scattered reading into structured research — sources, hypotheses, experiments, findings, and compiled reports, all linked into a graph you can see and run.

The plugin lives at `src/features/plugins/research-lab/` and is exposed through the **Plugins → Research Lab** entry in the sidebar. The Rust surface lives at `src-tauri/src/commands/infrastructure/research_lab.rs` with schema in `src-tauri/src/db/models/research_lab.rs`.

---

## What it does

Research Lab models the scientific process as six linked domains, each with its own tab and its own SQLite table, all rooted in a **Research Project**:

| Domain | Purpose | Backing table |
|---|---|---|
| **Project** | Named investigation with thesis, domain, status, and optional Obsidian vault binding | `research_projects` |
| **Sources** (Literature) | Papers, URLs, PDFs, manual notes — metadata + abstract + indexing status | `research_sources` |
| **Hypotheses** | Testable claims with confidence score, rationale, supporting/counter evidence | `research_hypotheses` |
| **Experiments** | Named runs that test a hypothesis; optionally linked to a persona for automated execution | `research_experiments` + `research_experiment_runs` |
| **Findings** | Insights extracted from experiment results or manual analysis, with confidence + category | `research_findings` |
| **Reports** | Compiled markdown documents that pull from the other five domains via templates | `research_reports` |

Every entity is scoped to a project. A **Graph** view renders the whole project as a columnar DAG (sources → hypotheses → experiments → findings → reports) with edges derived from foreign-key fields so you can *see* the shape of your investigation. A **Report Preview** drawer compiles any report on the fly into markdown you can copy, download, or sync to Obsidian.

The plugin is **local-first** — everything lives in the app's SQLite DB. Obsidian sync is optional and one-way (app → vault). External calls (arXiv search) hit the public API directly from the webview; PDF extraction and embedding are deliberately out of scope.

---

## User flow

The plugin is organised as eight tabs: **Dashboard**, **Projects**, **Literature**, **Hypotheses**, **Experiments**, **Findings**, **Reports**, and **Graph**. Most tabs require an active project (set from Projects); if you open a tab without one, the panel shows an inline CTA to jump back to Projects.

### 1. Dashboard — the one-screen overview

1. Six stat cards (projects, sources, hypotheses, experiments, findings, reports) show totals at a glance. Clicking any card routes to the matching tab.
2. The **Recent projects** list shows the five most recently touched projects; clicking one activates it and jumps to the Literature tab.
3. A **+ New Project** button in the top-right opens the same form used from Projects.

### 2. Projects — CRUD + Obsidian binding

1. Grid of project cards with name, description, thesis, status badge (semantic colors: scoping/literature_review/hypothesis/experiment/analysis/writing/review/complete), and domain pill.
2. Click a card to activate it and jump to Literature.
3. Hover → Pencil (edit) and Trash (delete) buttons.
4. **Create / Edit** opens a modal with name, thesis, description, domain dropdown (8 domains — CS, Biology, Chemistry, Physics, Mathematics, Business, Medicine, General), and an Obsidian vault picker using Tauri's native directory dialog.
5. If a vault is linked, two pill buttons appear on the card: **Sync to Obsidian** (writes experiments as notes, returns the count synced) and **Daily note sync** (appends today's delta to the daily note). Both are idempotent and disabled during active sync to prevent double-fires.

### 3. Literature — sources with arXiv search

1. Section header shows `filtered / total sources` plus an **arXiv** button and an **Add source** button.
2. Clicking **arXiv** opens a modal with a search box. Hit Enter → queries `https://export.arxiv.org/api/query?search_query=all:<q>&max_results=20&sortBy=relevance`, parses the Atom feed with `DOMParser`, and renders results with checkboxes. Select → **Add N** creates the matching `research_sources` rows (sourceType = `arxiv`, year + authors + DOI + abstract populated). **Every arXiv-sourced row is auto-marked `indexed` on insert** because the abstract is already attached — the "Ingest" step is deterministic for this source type.
3. **Add source** opens a manual form (title, type, year, authors, URL, DOI, abstract) with `pending` status.
4. Source cards show metadata, abstract snippet, source type pill, status pill (green=indexed, amber=ingesting, red=failed, neutral=pending), DOI, and an ExternalLink icon for the URL.
5. For `pending` sources, an **Ingest to KB** button transitions status `pending → ingesting → indexed`. (Today this is an attestation. Real embedding/chunking lives in the backend pipeline Phase 2 — see direction #1.)
6. Filter input appears when >2 sources exist; substring match against title + authors.

### 4. Hypotheses — manual entry + agent-generated

1. **Add hypothesis** opens a modal with statement + rationale textareas.
2. **Generate** (violet, ✨ icon) opens an **agent-driven generator**:
   - Pick a persona from the app's persona list.
   - Optional custom instructions.
   - Click Generate → builds a prompt with the project's thesis + domain + up to 50 indexed source titles, fires `executePersona`, polls every 2 s with live status until terminal.
   - Parses output tolerantly (JSON array → numbered list → bulleted list → paragraph split), dedupes.
   - **Step 2: preview** — up to 20 candidates render as a checklist with inline `<textarea>` editing and per-row Remove. Select/deselect-all + a **Re-run** button return to step 1 without losing setup. Accept → bulk creates hypotheses with `generatedBy = persona.name`.
3. Each hypothesis card shows statement, rationale, a **ConfidenceBar** (color-graded: green ≥ 70%, amber ≥ 40%, else red), ThumbsUp/Down counts parsed from JSON-encoded evidence arrays, and `generatedBy` attribution.

### 5. Experiments — design + run against a persona

1. **New experiment** form: name, linked hypothesis (dropdown from project's hypotheses), linked persona (optional), methodology, success criteria. When a persona is linked, two extra fields unlock: **Run input** (textarea passed to the persona on each run) and **Pass pattern (regex)** (optional — matched case-insensitive against `output_data` to decide pass/fail).
2. Linked-persona and pass-pattern data persist in the experiment's `input_schema` field as JSON — see [Storage convention](#storage-convention-linked-persona--run-config) below.
3. Experiment cards show: name, linked hypothesis (with Target icon), linked persona (with Bot icon), methodology snippet, success criteria snippet, and status pill.
4. **Run** (green Play icon) — available when a persona is linked. Click → `runPersonaAndWait` fires `execute_persona`, polls `get_execution` every 2 s for up to 120 s, evaluates pass/fail via `evaluatePass(output, passPattern, statusPassed)`, and inserts a `research_experiment_runs` row with outputs + metrics JSON (`{ status, inputTokens, outputTokens, passBy }`).
5. **View runs** opens a right-side drawer with full history: per-run number, pass/fail pill, duration (ms or s), cost USD, creation timestamp, and a collapsible Output panel. New runs refresh automatically via a `refreshToken` bump.

### 6. Findings — results and insights

1. **New finding** form: title, description, category (free text — e.g. "performance", "limitation", "surprise").
2. Cards show title, description snippet, category pill, status pill, confidence percentage, and `generatedBy` attribution. Manual entry today; the agent path is direction #2.

### 7. Reports — templated markdown compilation

1. **New report** form: title, type (Literature review / Experiment report / Full paper / Executive summary), format (Markdown / PDF / HTML).
2. Click any report card → **ReportPreviewDrawer** (right-side, ESC to close):
   - Fetches sources/hypotheses/experiments/findings for the project on mount.
   - `compileReport(args)` picks a template based on `reportType` and returns a markdown string:
     - **Literature review** — sources grouped by year (indexed first, pending second), citation-style entries with author/DOI/link.
     - **Experiment report** — hypotheses under test, experiments with methodology + success criteria, findings section.
     - **Full paper** — IMRaD scaffold (Introduction → Related Work → Methodology → Results → Discussion → References) with citation keys like `[Author2024]`.
     - **Executive summary** — snapshot table + top 5 findings by confidence + open questions.
   - **Preview ↔ Markdown** toggle switches between `MarkdownRenderer` (with `remark-gfm` + `rehype-highlight`) and raw `<pre>`.
   - **Copy** → `navigator.clipboard.writeText`. **Download** → slug-safe `.md` blob using the shared `downloadStringAsFile` helper.

### 8. Graph — the whole project as a DAG

1. Toolbar at top shows the project name + five toggle pills (Sources / Hypotheses / Experiments / Findings / Reports) each with their count. Click to hide/show that node type on the canvas.
2. Main canvas is `@xyflow/react` with a columnar layout (6 columns, 110 px row gap). Nodes are custom `ResearchNode` cards with color-coded kind indicators; edges are auto-derived:
   - Every entity → Project (project-scoped fallback).
   - Experiment → Hypothesis (`hypothesisId`).
   - Finding → Experiments / Hypotheses / Sources (via JSON arrays `sourceExperimentIds`, `hypothesisIds`, `sourceIds`).
   - Report → Findings (if any).
3. Includes Background dots, Controls (zoom/fit), MiniMap colored by node kind.
4. Click a node → right-side details drawer shows kind, label, sublabel, and a **View all** button that activates the project and jumps to the matching list tab for that entity type.
5. Nodes are non-draggable / non-connectable — the graph is a read view of the project's structure, not an editor.

### Lifecycle, end-to-end

```
┌──────────┐   add    ┌──────────┐  link   ┌────────────┐  run   ┌────────────┐  extract  ┌──────────┐
│   arXiv  │ ───────► │  Sources │ ──────► │ Hypotheses │ ─────► │ Experiments│ ────────► │ Findings │
│  Manual  │          │ (indexed)│         │ (manual +  │        │ + runs     │           │          │
└──────────┘          └──────────┘         │   agent)   │        └────────────┘           └──────────┘
                                           └────────────┘              │                       │
                                                                       ▼                       ▼
                                                                 ┌────────────────────────────────┐
                                                                 │  Reports (compiled markdown)   │
                                                                 └────────────────────────────────┘
                                                                                │
                                                                                ▼ optional
                                                                          Obsidian vault
```

Each layer is independent: you can add sources without ever writing a hypothesis; you can design experiments without sources; you can compile reports from whatever's present. The graph tab reflects whatever subset exists.

---

## Storage convention: linked-persona & run config

`research_experiments.input_schema` is defined on the Rust side as a free-form JSON string. The frontend uses it to persist UI-side run configuration that isn't yet modelled as first-class columns:

```jsonc
{
  "linkedPersonaId": "uuid-of-persona",
  "inputDataTemplate": "Baseline dataset: GSM8K. Answer the following questions …",
  "passPattern": "PASSED|score\\s*>\\s*0\\.8"
}
```

Parse/serialize helpers live in `_shared/experimentConfig.ts` (`parseExperimentConfig`, `serializeExperimentConfig`, `evaluatePass`). When the Rust backend gains a dedicated `persona_id` column (or similar), this convention is a trivial migration — read the existing `input_schema`, write the fields into their new columns, and drop the JSON wrapper.

---

## Strongest use case (speculation)

> **A personal investigation workbench where the same tool you use to read papers also runs the experiments that test what you read — and writes the paper that closes the loop.**

Most research tools pick one lane: reference managers (Zotero, Mendeley) own the sources; notebook tools (Jupyter, Hex) own the experiments; writing tools (Scrivener, Notion) own the document. The seams between them are where research actually slows down — you end up pasting DOIs into one tool, metric tables into another, and then rebuilding the story from memory.

Research Lab assumes the three lanes are *one* flow. Every source, hypothesis, experiment, finding, and report is a row in the same DB, linked by real foreign keys, rendered together in the graph view, and compiled into the report by a template that *knows* where every piece comes from. When you edit a finding, the experiment report that cites it is already updated before you click Preview. When you delete a source, the graph tab shows the hypotheses that just became orphans.

The killer pairing is with Personas' agent engine: a linked persona means an experiment isn't a spreadsheet cell, it's a *reproducible run*. Click Run and you get a new `research_experiment_runs` row with the full output, the cost, and a pass/fail derived from your own regex on the output. The agent is now a lab instrument, not a chat window — and its output lives permanently in the same graph as the hypothesis it was testing and the finding it will produce.

The combination is hard to replicate from outside because it needs all three: a local DB (browser apps can't keep it offline), a real agent-execution engine (reference managers don't have one), and a graph view of the whole project (notebook tools don't model it). Research Lab occupies the intersection where a scientist, a prompt engineer, and a technical writer meet at the same desk.

---

## Five development directions

### 1. Real literature ingestion — PDF → chunks → embeddings → KB

Today the **Ingest to KB** button transitions status `pending → indexed` but no content lands in a vector store. The full pipeline needs Rust work:

- Add a Rust crate for PDF text extraction (`pdf-extract` or `lopdf`) that runs on the arXiv PDF URL or a user-picked local file.
- Chunk by semantic section (abstract, headers, paragraphs) with an overlap window.
- Embed each chunk via the existing model-provider layer (reuse what the chat engine uses).
- Write the embedded rows into the existing `ExecutionKnowledge` table (or a sibling `research_source_chunks` table), scoped by `scopeType='research_source'` and `scopeId=source.id`.
- Expose a `research_search(query, projectId)` tool on a builtin Research connector so agents can pull relevant chunks into context at generation time.

This single change converts Literature from a bibliography into **the retrieval layer that agents actually use** when generating hypotheses or findings — closing the only open seam in the plugin.

### 2. Agent-extracted findings from experiment runs

Today, findings are manual. The `generatedBy` field is populated by the hypothesis generator but never by anything else. Wire a parallel generator for findings:

- After an experiment run completes, offer an **Extract findings** action that pipes `(experiment metadata, run output, methodology, success criteria)` into a configured persona.
- Parse the persona's output as JSON (schema: `[{ title, description, category, confidence }]`) — reuse `parseHypothesesOutput`-style tolerance.
- Pre-fill a multi-select confirmation drawer (same UX as hypothesis generator's step 2).
- Link each created finding back to the experiment via `sourceExperimentIds` JSON so the graph edge appears automatically.

Pair this with a "sweep all runs" batch action and the plugin turns into a **standing findings extractor** — every new run produces vetted candidate findings you can approve or discard, instead of a blank panel that needs manual authoring.

### 3. Live experiment runner with streaming + sweep

The current runner is single-shot and polled. Three upgrades:

- **Stream** the execution output via the same `Channel<BuildEvent>` pattern used by `useBuildSession.ts`, surfacing partial output in the runs drawer as it arrives. No more 2-minute silent polling window.
- **Parameter sweep** — let an experiment define a list of inputs (`inputDataTemplate` interpolation with `{{variable}}` slots, plus a CSV of values). Run once → get N rows in the run history, each tagged with its input vector. Plot passed-rate against the varying parameter.
- **Hypothesis gating** — after K runs, auto-update the linked hypothesis's `confidence` as `passed / total` and append to `supportingEvidence` or `counterEvidence` JSON arrays. The plugin finally closes the loop: running experiments moves hypothesis confidence, which moves the graph view, which moves the report draft.

This is the direction that makes "experiments" feel like *science* instead of *scheduled API calls*.

### 4. Report Compiler v2 — editable templates + Obsidian two-way sync

The four current templates are hardcoded in `compileReport.ts`. Make them a first-class, editable thing:

- User-owned Markdown templates with Handlebars-style interpolation over the project tree (`{{#each findings}} … {{/each}}`). Persist as rows in a new `research_report_templates` table.
- A template authoring tab (new sub-tab or a drawer in Reports) with live preview while editing.
- **Sync reports to Obsidian** — reuse the existing `obsidian_brain` sync plumbing to push each compiled report as a markdown file under `Personas/<project>/reports/<slug>.md`, with a stable frontmatter block carrying the `reportId` for round-trip detection.
- **Pull** — if the user edited the `.md` in Obsidian, show a three-way merge in the report preview drawer (app-side compiled version vs. vault edit vs. base). Keep the winner, or merge.

This is the path from "compile once and forget" to "drafts live in the vault, agents compile supporting sections, you write the prose."

### 5. Cross-project Research Graph + collaborators

The Graph tab today is per-project. Lift it up a level:

- A **global Research Graph** tab (under Dashboard or as a new top-level view) that shows all projects as super-nodes, with cross-project edges where sources/findings/hypotheses reference each other (e.g. a source that appears in two projects, a finding that contradicts a hypothesis in a neighbouring project).
- Node filters by **domain**, **status**, **age** — find stale projects, orphaned findings, un-cited sources.
- **Collaborator import** — read another Personas user's exported research-lab dump (JSON) into a read-only "shared" project. Their hypotheses and findings appear in your graph as faded nodes you can click to see but not edit — the beginning of "I read your paper draft in my app" instead of "they emailed me a PDF."
- **Coverage metrics** — for a given project, flag hypotheses with zero experiments, findings with zero sources, experiments that have never run. Nudges the scientist toward the next productive action.

This is the direction that turns a single-user workbench into a **lab notebook network** — the layer above individual research projects.

---

## Reference: backend commands

| Command | Purpose |
|---|---|
| `research_lab_list_projects` / `_get_project` | Read projects (list + single) |
| `research_lab_create_project` / `_update_project` / `_delete_project` | Project CRUD |
| `research_lab_list_sources` | Read project's sources |
| `research_lab_create_source` / `_delete_source` | Source create/delete |
| `research_lab_update_source_status` | Transition source status (pending → ingesting → indexed / failed) + optional KB link |
| `research_lab_list_hypotheses` | Read project's hypotheses |
| `research_lab_create_hypothesis` / `_update_hypothesis` / `_delete_hypothesis` | Hypothesis CRUD (update covers status/confidence/evidence) |
| `research_lab_list_experiments` | Read project's experiments |
| `research_lab_create_experiment` / `_delete_experiment` | Experiment create/delete |
| `research_lab_list_experiment_runs` / `_create_experiment_run` | Run history per experiment |
| `research_lab_list_findings` / `_create_finding` / `_delete_finding` | Findings CRUD |
| `research_lab_list_reports` / `_create_report` / `_delete_report` | Reports CRUD |
| `research_lab_get_dashboard_stats` | Aggregate counts used by the Dashboard tab |
| `research_lab_sync_to_obsidian` | Write project's experiments/findings to the linked vault; returns count |
| `research_lab_sync_daily_note` | Append today's delta to the vault's daily note; returns status message |

### Reused infrastructure

| Command | Origin | Purpose in research-lab |
|---|---|---|
| `execute_persona` | `src/api/agents/executions.ts` | Fires the persona linked to an experiment or the hypothesis generator |
| `get_execution` | `src/api/agents/executions.ts` | Polled by `runPersonaAndWait` until a terminal status |

External HTTP from the webview to `https://export.arxiv.org` is whitelisted in `src-tauri/tauri.conf.json`'s `connect-src` for both `csp` and `devCsp`.

---

## Reference: frontend modules

```
src/features/plugins/research-lab/
├── ResearchLabPage.tsx                       # tab host + lazy routing
│
├── _shared/
│   ├── ResearchLabFormModal.tsx              # BaseModal wrapper w/ header, body, footer
│   ├── FormField.tsx                         # TextField, TextAreaField, SelectField, Field
│   ├── SectionHeader.tsx                     # title + action button + optional extras
│   ├── EmptyState.tsx                        # empty state + "no active project" state
│   ├── tokens.ts                             # project/source status colors + domain/source-type label resolvers
│   ├── runPersona.ts                         # executePersona + poll-to-terminal wrapper
│   ├── experimentConfig.ts                   # parse/serialize input_schema JSON + evaluatePass()
│   └── downloadFile.ts                       # clipboard + download-as-file helpers
│
├── sub_dashboard/ResearchDashboard.tsx       # stat cards + recent projects
│
├── sub_projects/
│   ├── ResearchProjectList.tsx               # grid + Obsidian sync + edit/delete hover actions
│   └── ResearchProjectForm.tsx               # create + edit modal w/ vault picker
│
├── sub_literature/
│   ├── LiteratureSearchPanel.tsx             # source list + filter + ingest flow
│   ├── AddSourceForm.tsx                     # manual source form
│   ├── ArxivSearchModal.tsx                  # arXiv query + checklist + bulk add (auto-indexes)
│   └── arxivClient.ts                        # Atom-feed fetch + DOMParser
│
├── sub_hypotheses/
│   ├── HypothesesPanel.tsx                   # list w/ confidence bar + evidence counts
│   ├── AddHypothesisForm.tsx                 # manual entry
│   ├── GenerateHypothesesModal.tsx           # two-step: run persona → preview candidates → bulk create
│   └── parseHypotheses.ts                    # tolerant list parser (JSON → numbered → bullets → paragraphs)
│
├── sub_experiments/
│   ├── ExperimentsPanel.tsx                  # list w/ Run + View Runs; evaluatePass on completion
│   ├── AddExperimentForm.tsx                 # linked persona + run input + pass pattern
│   └── ExperimentRunsDrawer.tsx              # run history drawer w/ pass/fail, duration, cost, output
│
├── sub_findings/
│   ├── FindingsPanel.tsx                     # list w/ confidence %
│   └── AddFindingForm.tsx                    # title + description + category
│
├── sub_reports/
│   ├── ReportsPanel.tsx                      # grid w/ Preview + delete hover actions
│   ├── AddReportForm.tsx                     # title + type + format
│   ├── ReportPreviewDrawer.tsx               # Preview ↔ Markdown toggle + copy/download
│   └── compileReport.ts                      # 4 templates + citation key + year-grouped sources
│
└── sub_graph/
    ├── GraphPanel.tsx                        # @xyflow/react canvas + type toggles + detail drawer
    ├── ResearchNode.tsx                      # custom node w/ color-coded kind
    └── graphLayout.ts                        # buildGraph(): entities → columnar nodes + derived edges
```

```
src-tauri/src/
├── commands/infrastructure/research_lab.rs   # 27 Tauri commands (CRUD + sync + runs + stats)
├── db/models/research_lab.rs                 # ResearchProject/Source/Hypothesis/Experiment/Finding/Report structs
├── db/repos/research_lab.rs                  # rusqlite queries
└── engine/obsidian/                          # called by research_lab_sync_to_obsidian + sync_daily_note
```

All copy lives under `t.research_lab.*` in `src/i18n/en.ts` (≈170 keys). Zustand state is in `src/stores/slices/system/researchLabSlice.ts`. The Rust command invoke-handler registrations are in `src-tauri/src/lib.rs`.
