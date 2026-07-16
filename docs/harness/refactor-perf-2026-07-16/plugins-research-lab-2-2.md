# plugins/research-lab [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 1 medium / 2 low)
> Context group: Plugins & Companion | Files read: 8 | Missing: 0

## 1. Blob-download helper duplicated across features
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/research-lab/shared/downloadFile.ts:3
- **Scenario**: `downloadStringAsFile` here and `downloadHtmlReport` in `src/features/agents/sub_lab/libs/reportGenerator.ts:475` are the same 10-line blob→anchor→click→revoke routine, maintained independently in two feature folders. They have already drifted slightly (`a.remove()` vs `document.body.removeChild(a)`).
- **Root cause**: Each feature grew its own download helper instead of a shared lib utility; there is no `@/lib` home for browser file-save.
- **Impact**: Any fix (e.g. Tauri-specific save dialog, revoke-timing bug, filename sanitization) must be applied twice and will predictably land in only one copy.
- **Fix sketch**: Move `downloadStringAsFile(filename, content, mimeType)` to `src/lib/downloadFile.ts`, have `downloadHtmlReport` call it with `text/html;charset=utf-8` (or delete it and update its callers), and re-point `ReportPreviewDrawer.tsx` at the lib path. Delete the research-lab copy.

## 2. Deprecated `copyToClipboard` shim still has a live caller
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/plugins/research-lab/shared/downloadFile.ts:15
- **Scenario**: The file re-exports `copyText` as `copyToClipboard` with a `@deprecated` tag, but the migration was never finished — `sub_reports/ReportPreviewDrawer.tsx:13` still imports the shim (repo-wide only caller).
- **Root cause**: A rename-in-place deprecation was left half done; the single remaining import keeps the shim alive indefinitely.
- **Impact**: A misplaced clipboard export lives in a file named `downloadFile.ts`, and the deprecation notice invites future confusion about which import is canonical.
- **Fix sketch**: In `ReportPreviewDrawer.tsx`, import `copyText` from `@/hooks/utility/interaction/useCopyToClipboard` directly (aliasing if desired), then delete lines 15-16 of `downloadFile.ts`. One-caller change, verified by grep.

## 3. Ingest performs a redundant intermediate status write per source
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: redundant-write
- **File**: src/features/plugins/research-lab/shared/useIngestSource.ts:26
- **Scenario**: Every ingest click awaits `updateSourceStatus(id, 'ingesting')` and then immediately `updateSourceStatus(id, 'indexed')`. The busy spinner is driven by the local `ingestingId` state, not by the source status, so the `'ingesting'` row state is never observable in the UI.
- **Root cause**: The hook mirrors a real async-ingestion protocol (start → done), but per its own comment "the flag-flip is the actual work — there is no real KB ingestion behind it today", making the first transition pure overhead.
- **Impact**: Each ingest costs an extra Tauri invoke + SQLite write + systemStore update (with the store re-render that entails) — 2x the necessary round-trips, and 3 writes on the failure path. Bounded (one click each), but pure waste today.
- **Fix sketch**: Write `'indexed'` directly and drop the `'ingesting'` transition; keep the local `ingestingId` for the spinner. If the two-step shape is deliberately kept as a seam for future real ingestion, add a comment saying so and skip the intermediate write until it exists — the rollback-to-`'failed'` path already covers errors.
