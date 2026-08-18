# Patterns v2 — rewiring Overview → Patterns to the knowledge hierarchy

**Status:** implementation plan, 2026-08-18. Companion to
[`knowledge-hierarchy-plan.md`](../concepts/knowledge-hierarchy-plan.md) and the graph
contract at [`docs/concepts/paths/GRAPH.md`](../concepts/paths/GRAPH.md).
**Problem:** the Overview → Patterns module (Library + Graph, ~7,225 LOC in
`src/features/overview/sub_patterns/`) still renders the retired fabric — the
15-area × 2-segment topic taxonomy, the `macro/meso/micro` altitude toggle, `governs`
roll-ups, and a facet ring the DB door forbids — while the ratified v2 hierarchy
(**Golden Paths → Techniques → Applications → Evidence**, 82+ subjects on disk under
`docs/concepts/paths/`, frontmatter-linked, checker-gated) has no UI at all.

## 0. Architecture decisions (settle before code)

**D1 — The hierarchy is filesystem-truth; the app READS it, never copies it.**
The forge corpus is markdown + frontmatter validated by `check-corpus-integrity.mjs`.
Ingesting it into SQLite would create a second authority that drifts (the exact
failure class the hierarchy documents). A new Rust reader parses
`docs/concepts/paths/**` on demand (mtime-cached) and returns a typed graph. Adoption
and verification STATE stays in the DB, joined by **slug identity**
(`subject`, `subject/technique`) — slugs are the stable keys the graph contract
already guarantees (filename = frontmatter = folder, checker-enforced).

**D2 — Two data planes, one module.** The hierarchy plane (docs-derived, read-mostly)
and the existing workspace-practices plane (DB: `workspace_knowledge`, adoption cells,
playbooks) coexist. The practices plane is NOT deleted in this effort: three external
consumers import `libraryModel`/`KnowledgeTree`/`PracticeDetailModal`
(triage adapters, unified triage, Manual Review), and playbooks/consult serve the CLI.
Patterns v2 presents **Hierarchy** as the primary lens; legacy practices surface
*inside* subjects via `corpus-map.json` and remain fully browsable under a demoted
"Practices" view during transition.

**D3 — Category is a first-class node.** The graph needs a stable top ring. Subject
frontmatter has no group; add a generated **`docs/concepts/paths/categories.json`**
(subject → one of the 8 inventory categories: ui-surfaces, client-architecture,
llm-agent, backend-platform, operations, security, integration, engineering-process),
seeded from `subject-inventory.md`, with a checker extension requiring every subject
folder to appear exactly once. Small, honest, one authority.

**D4 — Per-project source path.** ~~The workspace row gains a `knowledge_repo_path`.~~
**Superseded during P1 — no schema change was needed.** The hierarchy belongs to a
repo, and a managed repo is already a `dev_projects` row with `root_path`. Both
commands take `project_id` and read `<root_path>/docs/concepts/paths/`. An unknown
project id is an error (the caller named something that does not exist); *every other*
absence — no path recorded, path missing on this machine, no `paths/` directory — is
an honest empty graph with `source.reason` populated, never a crash and never a spinner.
P2 therefore needs only a project id; picking WHICH project is the knowledge source is
a P2 concern (a setting, not a column).

## 1. Backend (Rust) — the reader

New module `src-tauri/src/commands/infrastructure/hierarchy_read.rs`:

1. **`dev_tools_hierarchy_graph(workspace_id)`** → `HierarchyGraph` binding:
   - `subjects[]`: slug, title (first H1), summary (first body paragraph, clamped),
     status (`draft|forged|reconciled|transplant-tested`), category (from
     categories.json), technique slugs (local + `shared@owner` resolved), application
     files (stack + technique), evidence paths + counter-evidence, deviation anchors,
     counts.
   - `techniques[]`: slug, subject, title, summary, laws cited, shared_with.
   - `laws[]`: id + one-line (parsed from `_laws.md` anchors).
   - `corpusMap`: legacy filename → subject (from `corpus-map.json`), plus per-subject
     legacy counts.
   - `crossLinks[]`: subject→subject edges parsed from relative markdown links in
     bodies (the graph's edge source; cheap regex over the already-read files).
   - Frontmatter parser: port the checker's YAML-subset parser 1:1; add a Rust unit
     test over a fixture copied from a real subject file so the two parsers cannot
     silently diverge.
   - Cache: whole-graph snapshot keyed by max-mtime of the tree; invalidate on read.
2. **`dev_tools_hierarchy_doc(workspace_id, rel_path)`** → `{markdown, frontmatter}`
   for the detail surface. Path-validated to the paths/ + golden-paths/ subtrees only
   (reuse `path_safety`).
3. Bindings via ts-rs (`--workspace --features desktop export_bindings`), command-name
   regen. Register in the doc-map (`feature-doc-map.json` → overview doc).

Deliberately **not** in scope: writing anything back to docs from the app. Status
promotion (`forged → transplant-tested`) stays a repo-side edit by the transplant
sessions.

### P1 as built (2026-08-18) — shipped

`src-tauri/src/commands/infrastructure/hierarchy_read.rs` (1,875 LOC incl. 30 tests):

```rust
dev_tools_hierarchy_graph(project_id: String) -> HierarchyGraph
dev_tools_hierarchy_doc(project_id: String, rel_path: String) -> HierarchyDoc
```

Fourteen ts-rs bindings exported. Measured against this repo's live corpus by a
permanent test that asserts **floors, not a snapshot**, so ongoing forge waves cannot
redden it: **105 subjects · 624 techniques · 236 applications · 721 evidence entries ·
247/247 legacy mapped · 385 cross-links · 9 laws · 8 categories · 0 warnings**.

Three contract refinements P2 should know about, made during the build:

- `subject.file` / `technique.file` / `application.file` are repo-relative paths that
  `dev_tools_hierarchy_doc` accepts verbatim — the path convention has ONE authority
  (the reader), never a string-concatenation twin in TypeScript.
- A shared-technique reference (`pagination@table`) emits a `crossLinks` entry of kind
  `technique`, so `@owner` edges need no frontend recomputation.
- `HierarchyDoc.markdown` is the body with the frontmatter block already stripped;
  frontmatter returns separately as `{key, values, isList}` entries (`isList`
  distinguishes `techniques: []` from an absent key).

Caching is a whole-graph snapshot per repo root keyed by (max mtime, entry count) over
`paths/`, capped at two roots with an LRU reaper — pinned by a test asserting an
unchanged tree returns the same `Arc` without re-parsing.

**`categories.json` is gated, not trusted.** `check-corpus-integrity.mjs` now fails on
a subject folder with no category entry, an entry naming no folder, an unknown category
id, or duplicate `order` values (order IS the compass sequence). All four failure modes
were fault-injected and confirmed to fire before the gate was accepted.

## 2. Library v2 (replace the topic tree as primary view)

New default view **Subjects** (segmented: `Subjects | Graph | Practices`):

- **Master–detail layout** (`master-detail-layout` shared idiom): left rail = 8
  category groups → subject rows (name, status chip, technique/application counts,
  deviation count badge, legacy-doc count); right pane = subject detail.
- **Subject detail** tabs: *Golden Path* (MarkdownRenderer over the body; relative
  links intercepted → in-app navigation to the target subject/technique),
  *Techniques* (cards: summary, laws chips, shared-technique provenance
  `pagination@table`), *Applications* (stack-badged list; opens doc), *Evidence &
  Deviations* (evidence paths as clickable repo refs; counter-evidence flagged;
  deviation anchors deep-linking into a rendered `golden-path-deferred-fixes.md`
  section), *Legacy* (the corpus-map'd old golden-paths docs for this subject).
- **Status vocabulary done right** (dogfood the status-vocabulary subject): one
  `HierarchyStatusChip` fed by `tokenLabel`-style maps; new i18n section
  `overview.patterns_v2` — and migrate the ~100 Patterns-only keys out of
  `plugins.dev_tools.workspaces` while we are there (D-note: 14-locale fill via the
  translate pipeline in the same change).
- **Search**: one omnibox over category/subject/technique/application (reuse the
  FabricSearch banded-scoring pattern with new kinds).
- Loading per loading-v2 laws: chrome always, ghost under it, module-scoped warm
  cache keyed by workspace so remounts paint warm.

## 3. Graph v2 (re-parameterize the Nexus, keep the engine)

`useGraphCanvas` (camera) and the Nexus layout mechanics (compass ring, branch
shells, LOD, flyTo, Esc-walk) are pure and battle-tested — **keep them**; swap the
model underneath:

- Ring 1: **8 category keystones** (stable compass order; new 8-entry theme — and fix
  the theme-mirror defect: one `categoryTheme.ts` source emitting CSS vars, no
  Tailwind twin file to keep in lock-step).
- Ring 2: **subjects** along each category spoke (existing branchLayout). Node ring =
  status (dashed draft → solid forged → double reconciled → filled
  transplant-tested); node size = technique count (sqrt scaling as today).
- Ring 3 (on subject focus): **techniques** (the facet machinery finally gets a real
  population — the current facet code paths are reusable nearly as-is).
- Edges: cross-subject **crossLinks** + shared-technique edges (`@owner`), drawn with
  today's cross-cluster bow rules; a **Laws lens** replaces ProjectFilter's slot —
  toggling a law highlights every technique citing it.
- Click-through: technique → detail modal (body + applications + laws), reusing the
  ClusterPatternsModal shell with pattern cards swapped for technique/application
  cards. Playbooks rail: hidden on the hierarchy graph (stays on Practices view).

## 4. Adherence (follow-up, after the context scorecard lands)

Hierarchy-plan §6 defines the per-context scorecard (census matches × context-map).
When that artifact exists, join it here: per-subject adherence rings (replacing
today's adoption rings), a project/context lens like today's ProjectFilter, and the
deviations tab gaining live counts. Until then the graph shows **status**, which is
honest and available — do not fake adherence from proxies.

## 5. Migration & cleanup

- `Practices` view = today's KnowledgeTree/Pulse/ExtractionMenu/rollout, unchanged,
  demoted to third position. External consumers untouched.
- Retire from the primary path: altitude toggle, `AREA_ORDER`/15 themes,
  `isWellFormedTopic` pillar, breadcrumb `split('/')` seams (all enumerated in the
  code-map; they survive only inside the Practices view until its own retirement
  decision).
- Tests: new `hierarchyModel.test.ts` (parser fixtures, category coverage, edge
  extraction) + graph-model tests re-pointed; the 750 LOC of old tests stay with the
  Practices lane.
- Doc-sync: update `docs/features/overview/README.md` in the shipping change.

## 6. Sequencing & effort (single-worktree, atomic commits)

| Step | Scope | Est. |
|---|---|---|
| ~~P1~~ | ~~Rust reader + bindings + categories.json + checker extension~~ **SHIPPED 2026-08-18** | done |
| ~~P2~~ | ~~Subjects master–detail + i18n section + search~~ **SHIPPED 2026-08-18** (`63262b7b2`) — three-lane switch, master–detail with 5 detail tabs, link-intercepting markdown, 42-key `overview.patterns_v2` section translated ×14. The ~100-key migration OUT of `plugins.dev_tools.workspaces` was **deferred to P5** (mechanical, zero user value, and the Practices lane those keys serve may itself be retired). | done |
| P3 | Graph re-parameterization + laws lens + technique modal | 1 session (M/L) |
| P4 | Adherence join (blocked on context scorecard) | later |
| P5 | Cleanup, tests, doc-sync, Practices demotion polish | 0.5 session (S) |

**Risks:** parser divergence (mitigated by shared fixtures); multi-workspace repos
without a hierarchy (designed empty state); the 12 partial wave-11 subject folders
currently untracked on disk (the reader must tolerate incomplete folders exactly as
the checker does — skip-with-count, never crash); i18n migration is 14-locale
(pipeline, not hand-edits).
