# templates/n8n [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 2 medium / 3 low)
> Context group: Templates & Recipes | Files read: 22 | Missing: 0

## 1. `credentialGapAnalysis.ts` is a dead file that also forks the matching heuristic
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_n8n/edit/credentialGapAnalysis.ts:27
- **Scenario**: `analyzeCredentialGaps` (and its exported `CredentialGap*` types) has zero importers anywhere in `src/` — a repo-wide grep hits only the file itself, `context-map.json`, and stale `lint-output.json` artifacts. Anyone editing connector matching must reason about this file for nothing.
- **Root cause**: The gap-analysis surface was superseded by `buildConnectorRailItems` (connectorHealth.ts) + `useConnectorStatuses`/`N8nConfirmStep`, but the file was left behind. Worse, lines 51–59 re-implement the fuzzy-match rules inline (hard-coded `4` instead of `MIN_FUZZY_LENGTH`, no prefix-ambiguity guard), so it has already drifted from `matchCredentialToConnector`.
- **Impact**: ~92 lines of unmaintained duplicate business logic; a future caller resurrecting it would get subtly different match results than the live picker/rail paths.
- **Fix sketch**: Delete `credentialGapAnalysis.ts`. If the ambiguity concept is wanted later, add an `findAllCandidates(credentials, connectorName)` helper inside `connectorMatching.ts` so the ranking rules stay single-sourced. Verify no dynamic import via a final repo grep (done here for `src/`; only artifacts matched).

## 2. Test stream lines are double-buffered — two renders and two 5000-line copies per CLI output line
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/sub_n8n/hooks/useN8nTest.ts:41
- **Scenario**: While a draft test streams, every CLI output line triggers `setLines` inside `useCorrelatedCliStream` (render 1), then the `useEffect` at line 41 dispatches `TEST_LINES` copying the entire lines array into the wizard reducer (render 2 across the whole wizard tree). With the hook's `MAX_STREAM_LINES = 5000` cap, the same up-to-5000-entry buffer is held twice.
- **Root cause**: `useN8nTest` keeps the hook's default `bufferLines: true` and mirrors the state into the reducer via an effect, even though `useCorrelatedCliStream` explicitly provides `bufferLines: false` + `onOutputLine` for exactly this pipe-to-external-buffer case (see the option's doc comment at useCorrelatedCliStream.ts:26-31).
- **Impact**: 2× renders per streamed line on a hot path (LLM/CLI tests emit many lines quickly) plus a duplicated multi-thousand-line buffer; the extra effect round-trip also delays line visibility by one render.
- **Fix sketch**: Pass `bufferLines: false` and an `onOutputLine` callback that dispatches an appending action (e.g. `TEST_LINE_APPENDED`), letting `testReducer` own the single buffer (apply the same dedup/cap there). Drop the `TEST_LINES` mirror effect and the now-unused `lines` return usage. The same pattern likely applies to the transform-stream twin hook (verify).

## 3. `TEST_STARTED` action is never dispatched
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_n8n/reducers/testReducer.ts:38
- **Scenario**: Grep across `src/` finds `TEST_STARTED` only in the action union (useN8nImportReducer.ts:159) and the reducer case — no `dispatch({ type: 'TEST_STARTED' })` exists; `TEST_STREAM_STARTED` is what the lifecycle handlers fire.
- **Root cause**: Leftover from before the correlated-stream refactor introduced `TEST_STREAM_STARTED`, which supersedes it (sets everything `TEST_STARTED` sets, plus run id/lines/phase).
- **Impact**: Dead branch in the reducer and a phantom member in the action union that readers must reason about.
- **Fix sketch**: Remove the `TEST_STARTED` case from `testReducer` and the variant from the `N8nImportAction` union. One grep to confirm no test file constructs it.

## 4. Stray `PLATFORM_COLORS` re-export from `SelectionCheckbox.tsx`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/templates/sub_n8n/steps/SelectionCheckbox.tsx:3
- **Scenario**: `SelectionCheckbox.tsx` re-exports `PLATFORM_COLORS` from `../colorTokens`, but the only consumer (`N8nParserResults.tsx:7`) imports it from `colorTokens` directly — nothing imports it via the checkbox module.
- **Root cause**: Leftover compatibility re-export from when the token was extracted out of this file into `colorTokens.ts`.
- **Impact**: Misleading coupling — a checkbox component advertising a color-token export invites future imports through the wrong path.
- **Fix sketch**: Delete line 3. No call-site changes needed.

## 5. Pasted-content validation JSON.parses on every keystroke for content up to 50 KB
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/templates/sub_n8n/steps/upload/usePasteImport.ts:52
- **Scenario**: The debounce in `validatePastedContent` only engages for text ≥ 50,000 chars; below that, every keystroke in the paste textarea runs `JSON.parse` + `countElements` + `detectPlatformLabel` synchronously. A user tweaking a 40 KB pasted workflow re-parses the whole document per character.
- **Root cause**: The immediate-path condition `text.length < 50_000` was meant as a "cheap enough" fast path, but parse + element counting on tens of KB is not free when it runs on the keystroke hot path.
- **Impact**: Bounded (sub-millisecond to low-millisecond per keystroke), but it is pure waste — the preview does not need per-keystroke fidelity.
- **Fix sketch**: Debounce all non-trivial content (e.g. immediate only for empty text and the over-limit error; debounce 150–300 ms otherwise). The existing `pasteDebounceRef` machinery already supports this — just tighten the immediate-path condition.
