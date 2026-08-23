# Registry Coverage — descope the hierarchy graph, prototype Project × Registry status

**Status:** implementation plan, 2026-08-23. Successor to the Graph-lane half of
[`patterns-v2-ui.md`](./patterns-v2-ui.md); companion to
[`knowledge-registry-migration.md`](../concepts/knowledge-registry-migration.md).

**Operator direction (verbatim intent):** the hierarchy graph is descoped and deleted —
as ai-registry grows (7 bundles already, arbitrary domains/subtrees), a geometry that
renders one bundle's 105 subjects cannot stay a relevant navigation surface. The new
direction: (1) map the **direct local registry checkout** at
`C:\Users\mkdol\dolla\ai-registry` — no clone ceremony; (2) instead of navigating
knowledge content, build a **Project × registry-status coverage** view — each project a
grid tile tracking symbolically: (a) present in the registry, (b) knowledge extracted
from it, (c) knowledge applied into it, (d) outdated-ness (last project action vs
registry updates) — with **Fleet dispatch** to resolve debts.

## 0. What recon established (2026-08-23, three read-only audits)

**The registry repo** (`xkazm04/ai-registry`, 156 commits, 7 lanes):
- Canonical project list: **`librarian/projects.md`** — committed table of 6 project
  slugs (ascent, kp, personas, personas-web, pof, systedo-case) with domains + prose
  "forged from" lineage. The only enumerable presence source.
- **`catalog.json`** is the richest structured signal: per-skill
  `adopters: ["personas@plugin:1.0.0", "pof@1.7", …]` (project slug + version + install
  mechanism), `version`, `contentHash`, `invokes30d`; per-bundle `contentHash`,
  counts; envelope `generatedAt`.
- `skills/*/LESSONS.md` headings `## <version> - <date> - <project>` = project × skill ×
  date of an actual run (35 entries).
- **Knowledge lane carries NO project provenance by design** — `consumer:`/`source_commit:`
  live only in gitignored `.evidence.local.md` sidecars; publishing them is a CI failure.
- **`scripts/build-registry-map.mjs`** (registry-side) already computes the
  project-contexts × subjects join and writes **`<project>/.ai/registry-map.json`**
  (per-pair `unknown|conformant|deviation|not-applicable` + bundle-digest staleness).
  The application/staleness half for the knowledge lane lives **in the project**, not
  the registry.
- Per-lane `git log -1` dates are a usable registry-side staleness clock. A per-project
  "last action" clock does **not** exist registry-side (usage/signals are
  installation-grain, aggregate-only by guarantee) — the app owns that half.

**Personas already has** (shipped by parallel sessions; do NOT rebuild):
- `registryLinkStore.ts` (localStorage `devtools.registryLinks.v1`): registry id,
  `clonePath` (operator-chosen absolute path — pointing it at the local checkout IS the
  "no clones" model), 1 registry : N workspaces, `syncKnowledgeRootSetting()` mirror to
  Rust (`KNOWLEDGE_REGISTRY_ROOT`). Its header explicitly names per-project rows as
  "the next slice, and this is the seam they replace".
- `useRegistryLibrary.ts`: `registryFor/workspacesOn/registryLibraryRootFor/corpusRootFor`.
- Rust: `dev_tools_registry_sync` (ff-only pull, error-first), `dev_tools_set_knowledge_root`,
  `dev_tools_write_registry_usage`, `dev_tools_export_skill_registry(library_root)`,
  `skill_files_list_global`.
- DB: `workspace_harvest_coverage` (project × scope, `last_harvested_at`, `items_found`,
  `estimated_pct`) = the extraction ledger; `workspace_practice_adoption` (+ context
  grain) = the applied ledger; `skill_registry`/`skill_usage_events`; skills drift =
  `classify_sync_state` + `driftOf` (`in_sync|behind|ahead|customized|unversioned`).
- Dispatch patterns: `PracticeRolloutModal` per-project rows (dedup key → spawn → flip
  cell), `passportFleet` ink map, `skillsWorkbenchData.syncBeforeDispatch`.
- The skills × projects heatmap (`sub_skills/registry/`) — `RegistryMode` deliberately
  generic for a future axis.

**Graph deletion blast radius** (audited): `hierarchy/graph/` (13 files, 3,852 LOC) +
`canvas/` (330 LOC) die cleanly — exactly ONE outside import (`PatternsPanel.tsx:32`),
nothing to move. 30 GRAPH-ONLY keys under `overview.patterns_v2` + `modal_laws_heading`
(pre-dead) + 3 `graph_zoom_*`/`graph_reset` under `plugins.dev_tools.workspaces`.
Subjects lane keeps everything it uses (incl. Adherence section). `cross_links` +
`HierarchyCrossLink` binding become unread (reader stays whole). Corpus citations to
`canvas/useGraphCanvas.ts` in `canvas-graph` subject docs need surgical repointing;
census/golden-path indexes regenerate.

## 1. Architecture decisions

**D1 — The local checkout IS the registry.** No clone/pairing ceremony for this
operator's flow: `RegistryWiring` gains a "link a local folder" path (DirectoryPicker →
validate `registry.yaml` exists → `linkRegistry` with state `paired`, no credential, no
pairing session). `clonePath = C:\Users\mkdol\dolla\ai-registry`. Everything downstream
(`registryFor()`, lane roots, sync) works unchanged; `dev_tools_registry_sync` stays as
an *optional* freshness action (it already refuses dirty trees — right behavior for a
live working copy).

**D2 — Coverage is a derived view, no new tables in the prototype.** One new Rust
command computes the whole read model per call (mtime/HEAD-cached like the hierarchy
reader); joins with existing DB APIs happen on the frontend. Persisting a per-project
check ledger is a later slice, taken only if the derived view proves itself. Honest-empty
doctrine throughout: a missing signal renders as "no signal", never as green (the
adherence lesson).

**D3 — Project slug mapping is explicit and honest.** Registry slugs
(librarian/projects.md, adopters) vs `dev_projects.name` matched by normalization
(lowercase, trim, `-`↔`_`); unmatched registry slugs render as "registry-only" tiles,
unmatched local projects as "not in registry". No fuzzy guessing — a mismatch is a
debt ("pair the name"), not a silent join.

**D4 — Four dimensions, each with a named source and a named gap:**

| Dimension | Symbol states | Sources |
|---|---|---|
| (a) **Present** | `in-registry` / `registry-only` / `absent` + domains chips | `librarian/projects.md` table (canonical) ∪ `catalog.json` adopter slugs |
| (b) **Extracted** | `forged` (bundle lineage) / `harvested` (app library) / `never` + last date | registry: projects.md "forged from" prose (parsed, boolean) · app DB: `workspace_harvest_coverage` per project (`last_harvested_at`, `items_found`, depth) |
| (c) **Applied** | per-lane counts: skills `N adopted (M behind)` · knowledge `conformant/deviation/unknown` · practices `adopted/diverged` | skills: `catalog.json` adopters × lane version (drift derivable) · knowledge: the project's **`.ai/registry-map.json`** (read from project root; absent = "never mapped", a debt) · practices: `workspace_practice_adoption` |
| (d) **Outdated** | `synced` / `behind` / `stale-check` / `never-checked` + the two clocks shown side by side | registry side: HEAD sha + per-lane last-commit dates + `catalog.generatedAt` + bundle `contentHash` vs `.ai/registry-map.json` digests · project side: max(adoption `last_verified_at`, harvest `last_harvested_at`, registry-map file mtime, adopter skill versions) |

**D5 — Debts are the actionable projection.** Each tile derives a short debt list from
the four dimensions (`not in registry`, `never harvested`, `registry-map missing`,
`registry-map stale vs bundle digest`, `N skills behind`, `M practice deviations`,
`never verified`). Each debt kind maps to a Fleet dispatch prompt builder (D6). "All
clear" is a real, earned state — shown only when every dimension has a signal AND no
debt derived.

**D6 — Dispatch reuses the proven shapes.** `syncBeforeDispatch(clonePath)` before any
run; dedup keys `registry:cov:<debt>:<project>`; per-debt prompt builders following
`adoptPracticePrompt`'s "reasoned refusal is valid" clause. Registry-writing debts
(e.g. add project to `librarian/projects.md`) run in the registry checkout on a branch
(the share-task pattern: commit, never push). Project-writing debts (run
`build-registry-map`/conform, adopt skill updates, harvest) run in the project root.

**D7 — Placement: the Graph lane's slot.** Patterns lanes become
`Subjects | Coverage | Practices`, persisted key `patterns:lane` unchanged (a stored
`"graph"` falls through to the default validator — no migration). Coverage is
registry-grain, not per-workspace-project-picker-grain: it uses `registryFor()` from
the wired workspace and lists ALL mapped projects.

## 2. Sequencing

| Step | Scope | Status |
|---|---|---|
| **R0** | ~~Descope the graph.~~ **SHIPPED 2026-08-23 (`7d179e52b`, 70 files, −5,244).** `hierarchy/graph/` + `canvas/` deleted; Patterns is a two-lane switch; 34 orphan keys ×14 + 8 stale allowlist entries removed; canvas-graph citations repointed to surviving witnesses (Mastermind camera, `MemoriesPageGraph`) with honest retirement notes where nothing survives (viewport capture-at-threshold, `labelScale`/`lod` LOD — recipes kept as record); census indexes regenerated; all gates green. `cross_links`/`HierarchyCrossLink` now unread on the TS side (reader untouched — the consult lane may still want them). | done |
| **R1** | **SHIPPED 2026-08-24 (`8b85e1409`, 50 files).** As specced, plus contract notes R2 needs: `CoverageTile.extraction` is null on the wire (frontend joins `workspace_harvest_coverage`; registry half = `presence.forgedFrom`); `applied.registryMap` `null` = root unreadable vs `{exists:false}` = never mapped; adopter mechanisms `link|plugin|pinned` (`link` never counts behind); debt kinds on tiles: `not-in-registry` (subsumes the rest), `never-mapped`, `map-stale`, `skills-behind`, `unknown-pairs` (`name-unmatched` reserved for registryOnly rows, frontend-rendered). No project carries `.ai/registry-map.json` yet — parser built off the writer's schema (`rkb-registry-map/1`). Real-registry floors green: 6 slugs (personas matched, 5 registry-only), 26 skills. Local link merges by catalog fullName → yaml name → path. Gotcha: rustfmt-staged hook rejects unformatted new .rs — run `rustfmt --edition 2021` before committing. ~~Local-folder wiring + coverage read model.~~ `RegistryWiring` "link local folder" path (validate `registry.yaml`); Rust `dev_tools_registry_coverage(registry_root, projects: Vec<{id, slug, root_path}>) -> RegistryCoverage` — parses `librarian/projects.md` (table rows + "forged from"), `catalog.json` (adopters, versions, generatedAt, bundle hashes), per-lane last-commit dates + HEAD sha (git CLI, read-only), each project's `.ai/registry-map.json` + `.personas/skill-registry.json`; per-project `CoverageTile { presence, extraction, applied, staleness, debts[] }`; honest `source.reason` when the root isn't a registry; mtime+HEAD-keyed cache; unit tests incl. a floors test against the real local registry + fault-injected malformed inputs. Bindings + command-names regen. | |
| **R2** | **Coverage lane UI.** `sub_patterns/coverage/`: `CoverageLane.tsx` (grid of project tiles; registry header card: name, HEAD, lanes, per-lane freshness, Sync action), `CoverageTile.tsx` (project name + favicon pattern from Statband if cheap; 4 symbol rows with the state vocabulary from D4; debt count badge), `CoverageDetailDrawer` (per-dimension evidence: which skills behind, which contexts deviating, the two clocks side by side, registry-only/unmatched explanation), loading-v2 laws (chrome always, ghost under, warm cache keyed by registry id). Frontend joins: `workspace_harvest_coverage` + `workspace_practice_adoption` via existing APIs. i18n section `overview.registry_coverage` (~30 keys ×14 via pipeline). | |
| **R3** | **Debt dispatch.** Prompt builders per debt kind (`coverageTasks.ts`, tested like `skillTasks`); Dispatch buttons on debt rows (dedup vs live sessions, `usePassportFleetSessions` ink, flip-to-dispatched local state); `syncBeforeDispatch` gate; registry-writing debts on a branch in the checkout. | |
| **R4** *(later, earn it first)* | Persisted per-project check ledger (`project_registry_state`), auto-refresh cadence, registry-map regeneration trigger from the app, promotion of `registryLinkStore` to SQLite (the store header's own plan). | |

## 3. Risks

- **Slug mapping** is name-based; `pof`/`kp` style slugs may not match `dev_projects.name`
  — D3 renders mismatches as debts rather than guessing. A manual pairing affordance is
  R4 material.
- **`librarian/projects.md` is prose-adjacent** (markdown table + free text). Parse
  defensively: table rows are the contract; "forged from" detection is a substring check
  documented as such. If the registry later grows a structured projects file, the parser
  swaps.
- **`.ai/registry-map.json` may not exist in any project yet** — the tab must be useful
  at zero signal (everything renders `never-checked` + a dispatch to create it).
- **Registry checkout is a live working copy** — coverage reads must tolerate dirty
  trees (read files as-is; show HEAD sha + a `dirty` marker rather than refusing).
- **Concurrent sessions** own `registryLinkStore`/skills lanes — R1 touches
  `RegistryWiring.tsx` minimally (additive path); coordinate via ledger.
