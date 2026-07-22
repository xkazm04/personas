# plugins/companion [3/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Plugins & Companion | Files read: 34 | Missing: 0

## 1. Full assignment-detail fetch on every TEAM_ASSIGNMENT_PROGRESS event, including step-level noise
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/plugins/companion/useCompanionAssignmentBridge.ts:22
- **Scenario**: While any team assignment runs (Athena-dispatched or not), the backend emits `TEAM_ASSIGNMENT_PROGRESS` for every step transition. This bridge calls `getTeamAssignmentDetail(assignment_id)` — a full assignment + steps IPC fetch — on *every* event before it can even discover `source !== 'athena'` and discard the result.
- **Root cause**: Unlike its sibling `useAthenaAssignmentReconciliation` (which filters `step_id !== null` and dedupes before invoking), this hook has no step-level filter, no debounce, and no source-known cache; the athena check happens only after the fetch completes.
- **Impact**: For a non-Athena team run with N steps, N+ wasted detail fetches (each pulling the whole steps array) per assignment, concurrent with the engine's own DB load. Multiple parallel assignments multiply it. The panel being open is common in exactly these active-orchestration moments.
- **Fix sketch**: (a) Coalesce bursts: debounce per `assignment_id` (e.g. 300ms trailing) so a rapid step cascade produces one fetch. (b) Cache the source verdict: after the first fetch resolves `source !== 'athena'`, remember the assignment_id in a `Set` and skip all future events for it. (c) Optionally have the backend include `source` in the event payload so the filter is free.

## 2. `parseBrainLinks` regex scan runs unmemoized on every render, mounted under every assistant bubble
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/companion/BrainLinksStrip.tsx:32
- **Scenario**: `BrainLinksStrip` is rendered under each assistant bubble (per its own doc comment). During a streaming turn the transcript list re-renders on every token delta, so every mounted strip re-executes `content.matchAll(TOKEN_REGEX)` over its full message body on each delta — long conversations with long markdown bodies pay a regex full-scan × bubbles × tokens.
- **Root cause**: `parseBrainLinks(content)` is called directly in the component body with no `useMemo`, and the component itself is not memoized, so parent re-renders re-run the scan even though `content` for completed bubbles never changes.
- **Impact**: O(total transcript characters) regex work per streamed token once brain links appear in a few messages; contributes to jank in exactly the hot streaming path the companion panel optimizes elsewhere.
- **Fix sketch**: `const links = useMemo(() => parseBrainLinks(content), [content]);` and wrap the export in `React.memo` (props are `content` + stable `onOpen` + `variant`). Two-line change, no behavior difference.

## 3. Each stream-json line is JSON.parsed independently by every extractor
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: redundant-parse
- **File**: src/features/plugins/companion/extractAssistantText.ts:9
- **Scenario**: `extractAssistantText`, `extractAssistantTextDelta` (same file) and `extractTodoWrite` (operationalSteps.ts:41) each start with their own `try { JSON.parse(line) }`. A streaming consumer that wants text + deltas + plan updates (the documented use — bubble fill plus the operational thread) parses every incoming line 2–3 times. With `--include-partial-messages` lines arrive at token cadence, and whole `assistant` messages carrying large tool inputs can be tens of KB.
- **Root cause**: Each helper was written as a self-contained "line in, value out" function, so the parse step is duplicated instead of shared. (Caller lives outside this context slice — verify the consumer does invoke more than one per line before restructuring.)
- **Impact**: 2–3× JSON.parse on the hottest path in the panel; for big tool_use payloads that's repeated multi-KB parses per line on the UI thread while the bubble is animating.
- **Fix sketch**: Parse once at the consumer: add a `parseStreamLine(line): StreamJson | null` helper, and refactor the extractors to accept the parsed object (`extractAssistantText(json)`, `extractTodoWrite(json)`, …) with thin string-accepting wrappers kept only if external callers need them. Also removes the triplicated silent try/catch.

## 4. Duplicated Tauri listen-lifecycle boilerplate across the two TEAM_ASSIGNMENT_PROGRESS hooks
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/companion/useAthenaAssignmentReconciliation.ts:32
- **Scenario**: `useAthenaAssignmentReconciliation` (lines 32–62) and `useCompanionAssignmentBridge` (lines 15–54) both hand-roll the identical async-unlisten dance — `let cancelled; let unlisten; void listen(...).then(u => cancelled ? u() : (unlisten = u)); return () => {...}` — for the *same* event name with the same payload type. Any future fix to this subtle pattern (e.g. the cancelled-before-resolved race) must be applied in two places.
- **Root cause**: No shared `useTauriEvent(eventName, handler)` hook in the companion feature; each bridge re-implements subscription plumbing around its 5 lines of real logic.
- **Impact**: ~30 lines of copy-pasted lifecycle code that is easy to get wrong (the race guard exists precisely because it *was* wrong once); also two separate native event subscriptions where one shared listener could fan out.
- **Fix sketch**: Extract `useTauriEvent<T>(name: EventName, handler: (payload: T) => void)` encapsulating the cancelled/unlisten pattern (keep the handler in a ref so the subscription is stable). Both hooks shrink to their filter + invoke logic. Grep the wider codebase first — this pattern very likely repeats in other bridges, making the payoff larger.

## 5. `ParsedBrainLink.id` always duplicates `raw`; captured id-tail group is unused
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/plugins/companion/parseBrainLinks.ts:63
- **Scenario**: `parseBrainLinks` pushes `{ kind, id: raw, raw }` — `id` and `raw` are the same string on every entry, and the regex's second capture group (`idTail`) is only used as a truthiness guard, never in the output.
- **Root cause**: The lookup contract changed to "pass the full matched token as `id`" (per the file's doc comment) but the two-field shape from the earlier prefix-stripped design survived.
- **Impact**: A misleading type — readers (and BrainLinksStrip, which uses `link.raw` for the key but `link.id` for the click) must discover the two fields are aliases; risk of future divergence bugs if someone "fixes" one of them.
- **Fix sketch**: Drop `id` from `ParsedBrainLink` (or drop `raw`), update the two consumers in BrainLinksStrip (`key`, `data-id`, `onOpen`) to use the single field, and remove the unused `idTail` destructuring (keep the group non-capturing or keep the guard on `match[0]`).
