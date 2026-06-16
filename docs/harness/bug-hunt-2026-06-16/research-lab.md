# Bug Hunter — Research Lab

> Total: 5 findings (1 C critical, 2 H high, 1 M medium, 1 L low)
> Context: research-lab | Group: First-Party Plugins

## 1. AI synthesis is never persisted — lost silently on drawer close
- **Severity**: High
- **Category**: 🔮 Latent failure / 💀 Silent failure (lost session work)
- **File**: `src/features/plugins/research-lab/sub_reports/ReportPreviewDrawer.tsx:48,143`
- **Scenario**: User picks a persona, clicks "AI synthesis", waits ~30–120s for an LLM run (real tokens/cost), sees the "Abstract & Discussion synthesized" success toast, then closes the drawer (Escape / backdrop / X). Re-opening the same report shows the deterministic stub Abstract again — the synthesized text is gone.
- **Root cause**: `synthesis` lives only in component local state (`const [synthesis, setSynthesis] = useState<ReportSynthesis | null>(null)`). `handleSynthesize` calls `setSynthesis(parsed)` and feeds it into the `compileReport` `useMemo`, but nothing writes it back to the DB (`research_reports` has no abstract/discussion column, and no `updateReport`/persist call exists). The drawer unmounts on close and the state evaporates.
- **Impact**: Every synthesis run is throwaway. Repeated LLM cost with zero durable value; users believe the report is enriched but it reverts. Classic success-theater on an expensive operation.
- **Fix sketch**: Add `abstract`/`discussion` (or a `synthesis` JSON) column to `research_reports` + an `updateReport`/`research_lab_set_report_synthesis` command; persist in `handleSynthesize` after parse; hydrate `synthesis` from the report on open. At minimum, warn the user it is unsaved before close.

## 2. Report compiled from another project's data (cross-project store leak)
- **Severity**: Critical
- **Category**: 💀 Silent failure / 🕳️ Edge case (partial results shown as complete)
- **File**: `src/features/plugins/research-lab/sub_reports/ReportPreviewDrawer.tsx:88-99` (and `researchLabSlice.ts:131-258`)
- **Scenario**: User is on Project A (active), opens a report belonging to Project B from a list. The drawer's `useEffect` fires `fetchSources/Hypotheses/Experiments/Findings(report.projectId=B)`, which **overwrites the single global store arrays** with B's data. While those fetches are in flight, `compileReport` runs against A's still-loaded arrays; even after they land, if the user then navigates the rest of the app (still "Project A" active) the global arrays now hold B's data — A's panels silently show B's sources. Conversely, a race where B's fetch hasn't resolved yet renders a report claiming "_No sources linked._" though B has many.
- **Root cause**: There is exactly one `researchSources` / `researchHypotheses` / … array in `systemStore`, keyed to whatever was last fetched — not partitioned by project. `ReportPreviewDrawer` re-fetches by `report.projectId` and then `.filter(s => s.projectId === report.projectId)` over the global array, assuming it contains B's rows. The `.filter` masks the bug into an empty/partial result instead of an error: a stale or wrong-project array yields a report that looks complete but omits real data.
- **Impact**: Reports can be generated against the wrong or empty dataset and exported/copied as if authoritative. Findings/references quietly missing. Also corrupts other panels' view of the active project until a refetch.
- **Fix sketch**: Key the store collections by projectId (e.g. `Record<projectId, ResearchSource[]>`) or have the drawer hold its own local fetched copy rather than mutating shared store state; gate the `compileReport` memo on a per-project loaded flag so it renders a spinner until B's data is confirmed loaded.

## 3. arXiv "Added N sources" toast lies when sources are de-duplicated
- **Severity**: High
- **Category**: 💀 Silent failure (success theater) / 🕳️ Edge case (duplicates)
- **File**: `src/features/plugins/research-lab/sub_literature/ArxivSearchModal.tsx:90-113` + `src-tauri/src/db/repos/research_lab.rs:172-223`
- **Scenario**: User searches arXiv, selects 5 papers that were already added earlier (same DOI/URL), clicks Add. UI reports "Added 5 sources" and the list count appears to grow by 5 (5 rows prepended in the store), but the backend created **0** new rows.
- **Root cause**: `create_source` has a dedup guard that returns the *existing* row on a normalized DOI/URL match instead of inserting. The modal counts `added += 1` for every `createSource` that resolves successfully — it can't tell an insert from a dedup hit. Worse, the store's `createResearchSource` unconditionally prepends the returned row (`[source, ...s.researchSources]`), so the already-present source is duplicated *in the in-memory list* (two cards, same id) until the next fetch — React key collision on `key={source.id}` and a visibly wrong count.
- **Impact**: Misleading success count; transient duplicate cards with duplicate React keys; user can't tell which picks were genuinely new. Erodes trust in the "add sources" flow.
- **Fix sketch**: Have `create_source` return a `{ created: bool }` flag (or compare returned `id` to a freshly generated one) so the caller can count only true inserts and de-dup the store prepend (skip if id already present); adjust the toast to "Added X new, Y already present".

## 4. Concurrent runs of different experiments race the runs drawer / refresh token
- **Severity**: Medium
- **Category**: ⚡ Race condition (tab/run state)
- **File**: `src/features/plugins/research-lab/sub_experiments/ExperimentsPanel.tsx:33-101,234-241` + `ExperimentRunsDrawer.tsx:29-43`
- **Scenario**: `runningId` is a single value, so the *button* for the in-flight experiment is disabled — but the user can still click "Run" on a **different** experiment card (its button isn't disabled), starting a second long poll. When the first finishes it calls `setRunningId(null)` in its `finally`, re-enabling all buttons and clobbering the second run's running indicator, so the second run shows no spinner though it's still polling. Both runs bump the same `runsRefresh` counter; if the runs drawer is open for experiment X while experiment Y completes, the `refreshToken` change refetches X's runs needlessly and a completing Y can leave X's drawer showing stale data depending on interleaving.
- **Root cause**: Run concurrency is tracked with a single scalar `runningId` rather than a set, and a single global `runsRefresh` token shared across all experiments and the (single-experiment) drawer. State for "which experiments are running" and "which drawer needs refresh" is conflated.
- **Impact**: Lost/confusing run-in-progress affordance, redundant refetches, and a drawer that can momentarily misrepresent another experiment's run history. No data corruption (run_number is serialized in Rust), but visible state incoherence.
- **Fix sketch**: Track running experiments as a `Set<string>`; disable each card's button by membership. Scope the refresh token per-experiment (e.g. `Record<expId, number>`) or only bump it when the completing experiment matches the open drawer.

## 5. Sources auto-marked "indexed" though no real KB ingestion happens (and ingest rollback hides failure)
- **Severity**: Low
- **Category**: 💀 Silent failure (success theater)
- **File**: `src/features/plugins/research-lab/sub_literature/ArxivSearchModal.tsx:104-107` + `src/features/plugins/research-lab/shared/useIngestSource.ts:20-35`
- **Scenario**: An arXiv source with an abstract is auto-flipped to `status='indexed'` immediately after creation. Manual ingest (`useIngestSource`) likewise just flips `ingesting → indexed`. The status pill, dashboard "(N indexed)" stat, and report "Indexed Sources" section all imply the full text was ingested into a knowledge base — but the hook's own comment confirms "there is no real KB ingestion behind it today". On the auto-path, `updateSourceStatus(...,'indexed').catch(() => {})` swallows any failure, so a source can render as indexed even if the status write failed.
- **Root cause**: `status='indexed'` is overloaded to mean "we have an abstract" rather than "content is in the KB"; `knowledge_base_id` stays null. The `.catch(() => {})` on the auto-index discards errors entirely (no toast, no log), and `useIngestSource` only rolls back to `failed` after the second flip — if the first `'ingesting'` write succeeds but `'indexed'` throws, you can land in a misleading interim.
- **Impact**: Literature reviews and dashboards overstate research completeness; downstream "indexed" filters select sources whose content was never ingested. Low severity today (feature is a stub) but actively misleading once real ingestion lands.
- **Fix sketch**: Introduce a distinct status (e.g. `metadata_only`) for "abstract available, not KB-ingested", and only set `indexed` when a real `knowledge_base_id` is attached. Stop swallowing the auto-index error with an empty catch — at least log via `silentCatch`.
