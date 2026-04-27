# Agent Chat & Tool Runner — Dev Experience Scan

> Total: 12 · Critical: 2 · High: 4 · Medium: 4 · Low: 2
> Scope: client-side only
> Date: 2026-04-27

---

## 1. Duplicate-but-divergent component trees in `sub_executions` (`replay/` vs `components/replay/`, `detail/` vs `components/list/`)

- **Severity**: Critical
- **Category**: code-organization
- **File**: `src/features/agents/sub_executions/index.ts:3-6`, `src/features/agents/sub_executions/replay/ReplaySandbox.tsx`, `src/features/agents/sub_executions/components/replay/ReplaySandbox.tsx`, `src/features/agents/sub_executions/replay/PipelineWaterfall.tsx`, `src/features/agents/sub_executions/components/replay/PipelineWaterfall.tsx`, `src/features/agents/sub_executions/detail/ExecutionDetail.tsx`, `src/features/agents/sub_executions/components/list/ExecutionDetail.tsx`
- **Scenario**: A developer fixes a regression in `ReplaySandbox.tsx`, runs the app, sees nothing change. Why? `index.ts` exports `components/replay/ReplaySandbox.tsx` (179 lines) but `detail/ExecutionDetail.tsx:6` imports `replay/ReplaySandbox.tsx` (179 lines, different file). `diff -q` shows the two `ReplaySandbox.tsx`, two `PipelineWaterfall.tsx`, and two `ExecutionDetail.tsx` files all differ.
- **Root cause**: A reorganization moved files into `components/<area>/` but left the originals in place; both trees evolved independently. There is no signal in either folder telling a developer which is canonical.
- **Impact**: Cross-folder editing means every replay/detail change carries a real risk of fixing the wrong copy. New developers must trace `index.ts` and individual import sites for every file. ~40+ component files affected (`replay/` 11 vs `components/replay/` 13; `detail/` 8 vs `components/detail/` 7; `components/list/` 9). This is the single biggest navigational hazard in the scanned scope.
- **Fix sketch**: Pick one canonical tree (the `components/<area>/` tree the index re-exports, with the `detail/ExecutionDetail.tsx` exception). Diff the duplicates pairwise, merge any unique fixes into the canonical copy, delete the loser, then `tsc` + ripgrep for surviving deep imports. Add an ESLint rule (`no-restricted-imports`) banning the deleted folder paths so the dead trees can't reappear.

---

## 2. Three parallel replay viewers each duplicating keyboard, fork, and transport logic

- **Severity**: Critical
- **Category**: code-organization
- **File**: `src/features/agents/sub_executions/replay/ReplaySandbox.tsx:57-86`, `src/features/agents/sub_executions/replay/ReplayTheater.tsx:62-99`, `src/features/agents/sub_executions/replay/DreamReplayTheater.tsx:75-116`
- **Scenario**: Add a new keyboard shortcut (e.g. `J`/`K` for prev/next tool step). You must edit three near-identical `useEffect` blocks, each with a slightly different switch — `ReplaySandbox` and `ReplayTheater` map `Shift+ArrowLeft` to `stepBackward`, `DreamReplayTheater` maps `Shift+ArrowLeft` to `jumpToStart`. The fork-input builder (`handleFork`) is copy-pasted twice (`ReplaySandbox.tsx:87-108` ≈ `ReplayTheater.tsx:101-129`) with the same toast/JSON-parse error path.
- **Root cause**: Three different feature waves (sandbox → theater → dream) shipped each viewer with its own copy of transport keyboard handling and fork-input assembly. Each viewer also wires up a different hook (`useReplayTimeline`, `useTheaterState`, `useDreamReplay`) with overlapping state shapes (`currentMs`, `totalMs`, `togglePlay`, `stepForward`, `jumpToStart`, …).
- **Impact**: Every new shortcut, fork tweak, or transport feature requires 3x the work and 3x the test surface. Inconsistencies (`Shift+ArrowLeft` semantics) ship to users.
- **Fix sketch**: Extract `useReplayTransportShortcuts(actions, options)` returning nothing (just registers the listener) and a `buildForkInput(execution, forkPoint, toolSteps, addToast)` helper. Have all three viewers call them. Then the three `actions` shapes can be type-aligned via a shared `ReplayActions` interface so the shortcut hook is generic.

---

## 3. Two implementations of `useToolRunner.ts` — one is dead code, the other is shipping

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/agents/sub_tool_runner/useToolRunner.ts` (116 lines, dead), `src/features/agents/sub_tool_runner/libs/useToolRunner.ts` (51 lines, used)
- **Scenario**: A bug is reported: "switching personas mid-tool-run shows the previous persona's result." The fix is in the top-level `useToolRunner.ts` — it has a `personaIdRef` snapshot, persona-mismatch detection on result write, and a 120s timeout. But `index.ts` and `ToolRunnerPanel.tsx:4` both import `libs/useToolRunner.ts`, the simpler one with no persona-snapshot guard, no timeout, and a different state shape (no `personaId` field). The "fix" is already written but never reaches production.
- **Root cause**: Refactor moved the hook to `libs/`, the original was never deleted, and the new one was simplified instead of carrying forward the safety invariants. No tests, no exports, no callers to alert on the orphan.
- **Impact**: A latent persona-bleed bug in the live hook; ~65 lines of carefully-commented "right" code rotting next to it. Every reader gets confused about which is real.
- **Fix sketch**: Delete `sub_tool_runner/useToolRunner.ts`, OR (better) port the persona-snapshot and timeout logic from it into `libs/useToolRunner.ts`, then delete the orphan. Add a knip/ts-prune step in CI to catch unused exports of this kind.

---

## 4. Advisory and Ops dispatchers are 60% identical operation-by-operation duplicates

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/agents/sub_chat/libs/chatAdvisoryDispatch.ts` (515 lines), `src/features/agents/sub_chat/libs/chatOpsDispatch.ts` (430 lines)
- **Scenario**: Add a new operation `list_tool_invocations` that both assistants should support. You write it twice, in two switch statements, with two slightly different result formatters. `health_check`, `list_executions`, `list_assertions`, `list_memories`, `list_versions`, `list_reviews`, `get_review`, `execute`, `edit_prompt`, `create_assertion`, `start_arena`, `start_matrix`, `approve_review`, `reject_review` — all 14 op handlers are duplicated, with subtle divergence (e.g. `list_executions` returns a markdown table in advisory and a padded text table in ops; `health_check` summary lines differ).
- **Root cause**: Ops shipped first; Advisory was forked from it and extended. Neither extracted the shared dispatcher. Each `extractOperations` is also duplicated — Advisory has a multi-line accumulator + control-char sanitizer (the better implementation), Ops has a single-line filter that silently drops valid multi-line operations.
- **Impact**: Every new operation, every result-format tweak, every bug fix to JSON extraction must be done twice. The divergence in `extractOperations` means Ops users silently lose multi-line ops that Advisory users see.
- **Fix sketch**: Extract `runOperation(op, personaId, opts)` and `extractOperations(text)` into `chatOperationDispatch.ts`. Pass `opts: { mode: 'advisory' | 'ops' }` to switch result-formatter and any mode-specific behavior (risk classification is advisory-only). Or use an op-handler registry: `Map<OpName, (op, ctx) => Promise<Result>>` with shared and mode-specific entries.

---

## 5. JSON `{"op"` filter logic copy-pasted between renderer and dispatcher

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/agents/sub_chat/ChatBubbles.tsx:165`, `src/features/agents/sub_chat/ChatBubbles.tsx:190`, `src/features/agents/sub_chat/libs/chatAdvisoryDispatch.ts:96`, `src/features/agents/sub_chat/libs/chatOpsDispatch.ts:38`
- **Scenario**: Operation JSON tweak ships — say the protocol now allows `{"operation": ...}` in addition to `{"op": ...}`. ChatBubbles still strips only `{"op"`, so the new shape leaks into chat bubbles as raw JSON. You have to find four places, all with a literal `'{"op"'` startsWith check.
- **Root cause**: No shared `isOperationLine(line: string): boolean` helper.
- **Impact**: Every protocol shape change becomes a 4-file ripgrep hunt; new contributors have no way to learn the protocol shape from one place.
- **Fix sketch**: Add `isOperationLine(line: string): boolean` and `stripOperationLines(text: string): string` to `libs/operationProtocol.ts` (or rename existing `chatAdvisoryDispatch.ts`). Replace all four call sites; the `StreamingBubble` filter on line 188-191 of ChatBubbles becomes a one-liner.

---

## 6. Replay viewer tab labels & shortcuts hardcoded outside translation tables

- **Severity**: High
- **Category**: convention-drift
- **File**: `src/features/agents/sub_executions/replay/ReplayTheater.tsx:212-231`, `src/features/agents/sub_executions/replay/DreamReplayTheater.tsx:275-277`, `src/features/agents/sub_executions/replay/DreamReplayTheater.tsx:43-54`
- **Scenario**: All other strings in these files go through `useTranslation()` / `t.agents.executions.*`. But `PanelTab` labels `"Tools"`, `"Trace"`, `"Output"`, `"State"`, `"Active"`, `"Cost"` are hardcoded inline. `SPAN_CONFIG` labels (`'Execution'`, `'Prompt Assembly'`, `'CLI Spawn'`, …) are hardcoded. The "PREVIOUS ERROR" / "NEXT ERROR" titles in DreamReplayTheater are English-only.
- **Root cause**: i18n was retrofit; most strings were captured but a late-shipping pass missed PanelTab and SPAN_CONFIG.
- **Impact**: Locale switching gets mixed-language UI in a high-visibility surface. A locale QA cycle finds these one by one.
- **Fix sketch**: Add `t.agents.executions.tabs.tools|trace|output|state|active|cost` and `t.agents.executions.span_types.<SpanType>`; replace inline strings. Optionally add a lint rule banning string-literal JSX content in this folder.

---

## 7. Magic streaming-recovery timeout and watchdog logic embedded directly in ChatTab

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/agents/sub_chat/ChatTab.tsx:108-145`
- **Scenario**: An eng investigates "chat input stays disabled forever". Comprehension requires reading two `useEffect`s deep in a 305-line component (one effect resets `chatStreaming` when `activeExecutionId→null`, another sets a 5-minute idle watchdog) plus understanding why `handleCancelStream` clears different fields than the watchdog. The reasoning is in 25 lines of comments — but they're inside the component, so any change requires re-reading them in context.
- **Root cause**: Stream-stuck recovery is a cross-cutting concern (it would belong in the agent store or a hook), but lives inside the view component because it grew incrementally from the original component.
- **Impact**: Two future-adjacent bug reports ("cancel doesn't fully clear", "watchdog kills my long tool run") will hit this code; both engineers will re-derive the invariants from the comments.
- **Fix sketch**: Extract `useStreamingWatchdog({ chatStreaming, activeExecutionId, streamTextLines })` from `ChatTab.tsx:108-136` into `sub_chat/hooks/useStreamingWatchdog.ts`. ChatTab keeps the cancel handler. The hook owns the timeout constant and the rationale comment; tests can target it directly.

---

## 8. AdvisoryLaunchpad and OpsLaunchpad are near-identical 200-line components

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/agents/sub_chat/AdvisoryLaunchpad.tsx` (181 lines), `src/features/agents/sub_chat/OpsLaunchpad.tsx` (206 lines)
- **Scenario**: Tweak the preset card hover scale or the options panel layout: must edit both files. The card grid, COLOR_MAP, options-panel JSX, `handleCardClick`/`handleOptionSend` plumbing are the same. Differences: preset list contents, grid columns (`grid-cols-2` vs `grid-cols-2 md:grid-cols-3 lg:grid-cols-4`), and special-case prompt assembly inside `handleOptionSend` (advisory has `improve|experiment|execute` branches, ops has `execute|improve` branches).
- **Root cause**: Forking pattern again. The data (presets) was the only intended difference; the structural duplication is incidental.
- **Impact**: 360 lines of UI to maintain in pairs.
- **Fix sketch**: Extract `<PresetLaunchpad presets={...} onSend={...} title={...} columns={...} buildPrompt={...} />`. The two existing files become 60-line preset-data files; the structural component lives once. Same for `COLOR_MAP` — already duplicated.

---

## 9. `useExperimentBridge` polling fallback adopts working memory of FIRST experiment as global persona id

- **Severity**: Medium
- **Category**: code-organization (correctness-adjacent, but pure dev-friction)
- **File**: `src/features/agents/sub_chat/hooks/useExperimentBridge.ts:181-229`
- **Scenario**: A developer reads `experiments[0]?.personaId` (line 188) and pauses. Why personaId from the first item? What if working memory has experiments belonging to multiple personas? They `git blame`, find no answer, and go ask in chat.
- **Root cause**: The hook reads working memory from the *currently loaded* `chatSessionContext`, so all experiments inside it share a session and persona — but that invariant is implicit, encoded only in the `chatSessionContext` re-render trigger. A reader can't tell from code alone.
- **Impact**: The implicit invariant burns reading time every time a developer touches this. If the context model ever changes (multi-persona session?), this becomes a silent bug.
- **Fix sketch**: Either add an explicit comment naming the invariant, or store `personaId` on the working-memory envelope so it's read once explicitly: `const personaId = ctx?.personaId; if (!personaId) return;`. Add one tiny vitest covering the empty-experiments and persona-mismatch cases.

---

## 10. No tests in the entire scope — chat dispatcher, replay state, fork builder all untested

- **Severity**: Medium
- **Category**: testing
- **File**: (negative finding) `src/features/agents/sub_chat/**`, `src/features/agents/sub_tool_runner/**`, `src/features/agents/sub_executions/**`
- **Scenario**: A `find` for `*.test.ts` / `*.spec.ts` in the scoped folders returns zero results. The advisory operation parser (with multi-line accumulator + control-char sanitizer + dedup), the fork-input builder, the streaming recovery watchdog, the persona-snapshot tool runner — all critical, all logically self-contained, none tested.
- **Root cause**: No test scaffolding established for `features/agents/sub_*`; tests likely live elsewhere (or don't exist).
- **Impact**: Every refactor to extract duplication (findings 2, 4, 8) carries unbounded regression risk. This is the main reason the duplicates haven't been collapsed already.
- **Fix sketch**: Land 5–8 vitest files covering: `extractOperations` (multi-line, control-chars, dedup, code-block skip), `runOperation` (each op with mocked `invokeWithTimeout`), `buildForkInput` (parsable input vs unparseable), `useStreamingWatchdog` (ref-tracked timer cleanup). With those in place, the dedup refactors (#1, #2, #4, #8) become safe.

---

## 11. JSON-input "default" generation in ToolInvocationCard silently drops type information

- **Severity**: Low
- **Category**: dev-loop-friction
- **File**: `src/features/agents/sub_tool_runner/components/ToolInvocationCard.tsx:188-202`
- **Scenario**: A tool defines `{ properties: { count: { type: 'integer', default: 5 }, name: { type: 'string', default: 'foo' } } }`. The default-input builder produces `{ "count": "", "name": "" }` — empty strings, no defaults, no types. The user has to retype values that the schema already declared.
- **Root cause**: The builder iterates `Object.keys(schema.properties)` and assigns `''`. It ignores `schema.properties[k].default`, `type`, and any nested objects.
- **Impact**: First-run friction on every tool. Devs adding new tools wonder why their `default` field doesn't surface.
- **Fix sketch**: Read `schema.properties[k].default` if present; otherwise emit a typed sentinel (`0` for integer, `""` for string, `null` for nullable, `[]` for array, `{}` for object). Bonus: render this in a typed form rather than raw JSON.

---

## 12. `ReplayHelpers.formatMs` reimplemented next to `formatDuration` from `@/lib/utils/formatters`

- **Severity**: Low
- **Category**: convention-drift
- **File**: `src/features/agents/sub_executions/replay/ReplayHelpers.ts:3-9`
- **Scenario**: A developer wants consistent duration formatting across replay vs pipeline. `ReplayHelpers.formatMs` returns `"42ms" | "1.2s" | "1:02"`; `formatDuration` (used in PipelineWaterfall, DreamReplayTheater, ReplayTheater) returns a different format. Output drifts visibly between adjacent panels of the same screen.
- **Root cause**: `ReplayHelpers.ts` was created early, `formatDuration` later. The local helper was never unified.
- **Impact**: Low (visual-only) but: any developer touching duration in replay must guess which helper to use. The two get reapplied inconsistently in new code.
- **Fix sketch**: Delete `formatMs` from `ReplayHelpers.ts`; switch its (very few) callers to `formatDuration` from `@/lib/utils/formatters`. Keep `SPEED_OPTIONS` and the re-exported `formatCost`.
