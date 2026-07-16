# plugins/research-lab [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: Plugins & Companion | Files read: 34 | Missing: 0

## 1. Stale-cache heuristic skips fetching sources for the active project, silently degrading AI hypothesis generation
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: data-layer-staleness
- **File**: src/features/plugins/research-lab/sub_hypotheses/HypothesesPanel.tsx:36
- **Scenario**: User views Project A's literature (store `researchSources` fills with A's rows), switches the active project to B, and goes straight to the Hypotheses tab. The effect runs `if (sources.length === 0) fetchSources(activeProjectId)` — length is > 0 (A's stale rows), so B's sources are never fetched.
- **Root cause**: Array length is used as a cache-freshness signal, but the store holds one flat `researchSources` array shared across projects; a non-empty array proves nothing about the *current* project. Every other panel (Literature, Graph, Experiments) unconditionally refetches on `activeProjectId` change.
- **Impact**: `GenerateHypothesesModal.projectSources` filters by `project.id` and yields 0, so the LLM prompt says "Available sources (0) … _No sources indexed yet._" and the panel's generator loses all grounding context — a silent quality regression with no error surfaced. The "optimization" saves one cheap local query.
- **Fix sketch**: Drop the guard and fetch unconditionally on project change, matching the sibling panels: `useEffect(() => { if (activeProjectId) { fetchHypotheses(activeProjectId); fetchSources(activeProjectId); } }, [activeProjectId, …])` and remove `sources.length` from the deps.

## 2. Exported-but-unused atelier primitives duplicated wholesale between the two Atelier variants
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/research-lab/sub_projects/ResearchProjectListAtelier.tsx:336
- **Scenario**: `AtelierBand` (line 336), `RailItem` (409) and `BackgroundGrid` (487) are `export`ed with a comment "kept inline for now — extracted later if winner", but a repo-wide grep shows zero importers. Meanwhile `LiteratureSearchPanelAtelier.tsx` re-implements private near-identical copies: `RailItem` (line 249, byte-for-byte identical), `BackgroundGrid` (429, differs only in SVG pattern ids), and `AtelierHeader` (174, a variant of `AtelierBand`), plus a parallel `ChronologyThread`/`AtelierEmpty` pair.
- **Root cause**: The second Atelier variant was written by copy-paste instead of importing the already-exported primitives; the exports were never wired up.
- **Impact**: ~200 duplicated lines that will drift (they already have: SVG ids, slice(0,10) vs slice(0,12), hardcoded "Recent"/"All sources" vs translated labels in the projects version). The unused `export` keywords also falsely advertise a shared API.
- **Fix sketch**: Move `RailItem`, `BackgroundGrid` (take the pattern-id as a prop), and a unified `AtelierBand` into `shared/` (e.g. `shared/atelier.tsx`), import them from both variants, and delete the private copies. If the prototypes are still in bake-off (see `PrototypeTabs` "throwaway scaffolding" note), at minimum strip the dead `export` keywords so the duplication is honest.

## 3. `ReportSynthesis` defined twice with conflicting shapes in the same folder
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/research-lab/sub_reports/parseSynthesis.ts:3
- **Scenario**: `compileReport.ts:7` declares `ReportSynthesis { abstract?: string; discussion?: string }` (optional fields); `parseSynthesis.ts:3` declares a second `ReportSynthesis { abstract: string; discussion: string }` (required fields). `ReportPreviewDrawer` imports the type from `compileReport` but stores values produced by `parseSynthesisOutput` (the other type) — it only compiles because the required shape is assignable to the optional one.
- **Root cause**: The parser module re-declared the interface instead of importing the compile-side one (or vice versa).
- **Impact**: Type drift hazard: adding a field to one interface silently doesn't flow to the other; the required/optional mismatch also mis-documents what `parseSynthesisOutput` guarantees (it always returns both keys, possibly empty strings).
- **Fix sketch**: Keep one definition (in `compileReport.ts`, since it is the consumer contract, or a tiny `sub_reports/types.ts`), export it, and have `parseSynthesis.ts` import it. Decide once whether fields are optional and align the parser's return accordingly.

## 4. Report nodes fan an edge in from every finding — reports × findings edge explosion in the research graph
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: quadratic-fanout
- **File**: src/features/plugins/research-lab/sub_graph/graphLayout.ts:205
- **Scenario**: In `buildGraph`, each visible report does `findings.forEach((f) => addEdge('finding:...', reportId))` — every finding is wired to every report. A project with 60 findings and 8 reports renders 480 report edges alone, all re-created (new objects, new ids) on every store update, then diffed and drawn by ReactFlow.
- **Root cause**: Reports have no real link table to findings, so the layout fakes provenance by connecting all findings to all reports instead of linking each report to the project node.
- **Impact**: O(findings × reports) edges makes the canvas visually unreadable (a solid ribbon between the two columns) and multiplies ReactFlow's render/diff work on a hot memo that re-runs whenever any research entity changes. It also asserts a data relationship that doesn't exist.
- **Fix sketch**: Link reports to `project:` (one edge each) like sources/hypotheses do, or cap/aggregate: a single labeled edge from the findings column ("n findings") per report. If real report→finding provenance is wanted, add ids to the report row first.

## 5. arXiv bulk-add persists sources one-by-one with sequential awaits (2 round-trips per paper)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/plugins/research-lab/sub_literature/ArxivSearchModal.tsx:93
- **Scenario**: Selecting all 20 search results and clicking Add runs a serial `for` loop: `await createSource(...)` then `await updateSourceStatus(source.id, 'indexed')` per paper — up to 40 sequential store round-trips (each a Tauri IPC + SQLite write + store-array update/re-render) while the modal shows a spinner. `GenerateHypothesesModal.handleAccept` (sub_hypotheses/GenerateHypothesesModal.tsx:109) has the same serial-create pattern for up to 20 hypotheses.
- **Root cause**: No batch-create seam on the store/API, and the follow-up status write is a separate call instead of creating the source directly with `status: 'indexed'`.
- **Impact**: Linear latency stacking on a user-facing confirm action (multi-second on slower disks), plus N× store notifications each re-rendering subscribed panels mid-loop. Bounded (≤20 items) but on the main add-sources flow.
- **Fix sketch**: Cheapest: pass the initial status into `createSource` (killing the second call), and run the creates with `Promise.allSettled` over the picks, tallying added/duplicates from results. Better: add a `createResearchSources(batch)` store/command that inserts in one transaction and updates the store array once.

## 6. Persona `<select>` option-building copy-pasted across three modals
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/research-lab/sub_hypotheses/GenerateHypothesesModal.tsx:55
- **Scenario**: The identical "sort personas by name, prepend `{ value: '', label: '—' }`" option list is built in `GenerateHypothesesModal.tsx:55`, `ReportPreviewDrawer.tsx:65`, and `AddExperimentForm.tsx:40` (the latter without memoization).
- **Root cause**: Each modal grew its own dropdown plumbing instead of a shared helper next to the existing `SelectField`.
- **Impact**: Three drift points for the empty-sentinel convention and sort order; minor re-computation in `AddExperimentForm` on every keystroke (unmemoized sort/map — negligible at persona counts, but free to fix in the same move).
- **Fix sketch**: Add `usePersonaOptions()` (or a pure `buildPersonaOptions(personas, t)`) in `shared/`, returning the memoized sorted list with the `'—'` sentinel; replace the three inline builders.
