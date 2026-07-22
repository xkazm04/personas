# scraper — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 2 medium / 2 low)
> Context group: App Shell, Settings & Sharing | Files read: 10 | Missing: 0

## 1. `error` state in useScraperData is set but never rendered — load failure shows "No scrapes yet"
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/scraper/useScraperData.ts:46
- **Scenario**: `reload()` catches list failures into `error` state (line 59) and also routes them through `silentCatch`, but no consumer ever reads `data.error` — ScraperPage renders `ScraperControlRoom` unconditionally after loading, and ControlRoom only checks `configs.length === 0`. If `listScraperConfigs`/`listScraperDatasets` fails (DB locked, backend down), the user sees the friendly "No scrapes yet — define a URL…" empty state.
- **Root cause**: The `error` field was wired into the `ScraperData` contract for the prototype variants but no surviving variant renders it; the failure path degenerated to a silently misleading empty state.
- **Impact**: Dead state field plus a user-facing honesty problem — a transient load failure is indistinguishable from an empty fleet, inviting the user to recreate scrapes that already exist.
- **Fix sketch**: In ScraperPage (or ControlRoom), branch on `data.error` before the empty-state check and render an error panel with a Retry button calling `data.reload()`. Alternatively, if the decision is toast-only error handling, delete the `error` field from `ScraperData` and the `setError` plumbing so the contract stops advertising a capability nothing uses.

## 2. `queryDataset` is exposed by useScraperData but has zero callers
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/scraper/useScraperData.ts:113
- **Scenario**: `queryDataset` (wrapping `queryScraperDataset` with a hardcoded 100-row cap) is built with `useCallback`, added to the `ScraperData` interface, and returned — but a repo-wide grep (src, tests, docs) finds no call site. The datasets strip in ControlRoom only shows name + count; nothing drills into records.
- **Root cause**: Leftover from the retired Pipeline / Field Notebook prototype variants that presumably had a dataset-records view; the Control Room baseline never adopted it.
- **Impact**: Dead API surface that every future variant author will assume is load-bearing; also keeps `DatasetRecord` and `queryScraperDataset` imports alive in this hook for nothing.
- **Fix sketch**: Remove `queryDataset` from `ScraperData` and the hook body, plus the now-unused `queryScraperDataset`/`DatasetRecord` imports. If a records drill-down is planned, reintroduce it with the consuming UI. Verify `@/api/scraper.queryScraperDataset` still has other callers before touching the API module itself (out of this context).

## 3. Retired-variant leftovers: `ruleSummary`, LlmRuleBuilder `compact` prop, exported `formatPreviewValue`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/scraper/useScrapeForm.ts:71
- **Scenario**: The module docs record that the Composer/Blueprint editor variants and Pipeline/Field-Notebook page variants were retired, but their support code lingers: `ruleSummary()` (useScrapeForm.ts:71) has no callers anywhere in the repo; LlmRuleBuilder's `compact` prop (LlmRuleBuilder.tsx:19) is never passed by the sole caller (EditorSteps.tsx:101), so the compact branch is unreachable; `formatPreviewValue` (PreviewResults.tsx:55) is exported but only used within its own file.
- **Root cause**: Prototype-round cleanup removed the variant components but not the shared helpers/props built for them.
- **Impact**: ~30 lines of unreachable code and a phantom prop that suggests a "compact mode" exists; low cost but pure noise for maintenance.
- **Fix sketch**: Delete `ruleSummary`; remove the `compact` prop and its conditional classes/branch from LlmRuleBuilder; drop the `export` on `formatPreviewValue`. All three are grep-verified single-context; no cross-context callers found.

## 4. PreviewStep discards fetched results on every step change — repeat live-page fetches
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: missing-caching
- **File**: src/features/scraper/EditorSteps.tsx:117
- **Scenario**: The wizard renders exactly one step body at a time (`ScrapeEditorWizard.tsx:73` swaps `Body` per step), so `PreviewStep` unmounts whenever the user navigates to Extract to tweak a rule and its `rows` state is lost. Each return to Preview requires re-clicking "Run preview", which re-fetches the external URL over the network — the natural tweak-rule → check-preview loop pays a full page download per iteration and shows a blank panel in between.
- **Root cause**: Preview results live in component-local `useState` inside a step component that the wizard unmounts on navigation, instead of in the form spine that survives step changes.
- **Impact**: Repeated network fetches of third-party pages on the hottest editor loop (rule tweaking), extra latency each cycle, and lost context for the user comparing rules against results. Bounded per-click, but it is the core workflow of the editor.
- **Fix sketch**: Lift `rows`/`error` into `useScrapeForm` (or a `useRef`-backed cache keyed by `JSON.stringify(fieldsToRuleSet(fields)) + urlList[0]` in the wizard) so results persist across step navigation; invalidate when URLs or rules actually change. Alternatively keep all step bodies mounted and toggle visibility with CSS so step-local state survives.
