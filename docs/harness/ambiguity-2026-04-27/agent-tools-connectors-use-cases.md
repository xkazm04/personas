# Ambiguity Audit — Agent Tools, Connectors & Use Cases

> Total: 12 findings (2 critical, 4 high, 5 medium, 1 low)
> Files read: ~28
> Scope: Per-agent tool selection, connector bindings, automation setup, use-case detail/scheduling, and persona health-check surfaces.

## 1. Two divergent `useToolImpactData` implementations live side-by-side

- **Severity**: critical
- **Category**: undocumented-decision
- **File**: src/features/agents/sub_tools/useToolImpactData.ts:80-204 ; src/features/agents/sub_tools/libs/useToolImpactData.ts:14-129
- **Scenario**: There are two `useToolImpactData` hooks with the same exported name but different cost/co-occurrence math. The root file builds the co-used map with an inner double-loop that mutates `toolCoMap` once per tool *per execution*, while the `libs/` variant uses an `i<j` combination pattern. Outputs are slightly different and neither file states which is canonical.
- **Root cause**: A refactor split the hook into `libs/` but left the original file in place. There is no re-export bridge or deprecation notice — both files are imported by name by different callers via `index.ts`.
- **Impact**: Different ToolImpactPanel instances may show different cost/co-occurrence numbers depending on the import path. A future bugfix applied to one copy is silently lost on the other.
- **Fix sketch**:
  - Replace the root `useToolImpactData.ts` with a thin re-export of `./libs/useToolImpactData`.
  - Add a comment in `libs/useToolImpactData.ts` declaring it the source of truth.
  - Add a unit test asserting the co-occurrence count for a known fixture is identical across import paths.

## 2. Two divergent tool-selector hooks with different undo-window semantics

- **Severity**: critical
- **Category**: requirements-unclear
- **File**: src/features/agents/sub_tools/useToolSelectorState.ts:90-167 ; src/features/agents/sub_tools/libs/useToolSelectorActions.ts:23-50
- **Scenario**: `useToolSelectorState` captures `personaId` inside the undo toast and routes the undo back to the *origin* persona; the parallel `useToolSelectorActions` (in `libs/`) stores only `{toolId, toolName}` and re-assigns to whatever persona is currently selected. The first one has a long pinned-2026-04-20 contract block; the second silently does the opposite.
- **Root cause**: The codebase appears mid-refactor between a monolithic hook and a split persona/search/actions trio. There is no comment in `libs/useToolSelectorActions.ts` explaining whether the cross-persona safety was intentionally dropped or simply forgotten.
- **Impact**: If consumers switch to the `libs/` hook, the documented "switching personas mid-undo doesn't re-assign to the wrong agent" guarantee silently disappears. Tools could be re-assigned to an unintended persona on undo — a data-correctness bug that *no test would catch* because both hooks export the same shape.
- **Fix sketch**:
  - Pick one hook, delete the other, or have the deprecated one re-export with a `@deprecated` JSDoc.
  - If `libs/useToolSelectorActions.ts` is the new home, port the `personaId`-in-toast invariant and the pinned-contract docblock verbatim.
  - Add a test that fakes a persona switch mid-undo and asserts the assign target.

## 3. `useUnfulfilledCredentials` hook signature implies multi-persona but only ever processes one

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/features/agents/sub_connectors/libs/useUnfulfilledCredentials.ts:33-76, 82-121
- **Scenario**: `computeUnfulfilled` accepts an array of personas and a `Map<personaId, Record<credType, credId>>`, but the only caller (`useUnfulfilledCredentials`) wraps the selected persona into a length-1 array and a length-1 map. The "global" hook below it explicitly says it cannot enumerate per-persona demands and falls back to a stub.
- **Root cause**: The shared signature was written for a multi-persona dashboard that was never built. There is no comment explaining whether `computeUnfulfilled` is intended public API or vestigial scaffolding.
- **Impact**: A future caller will reasonably assume "pass an array of personas, get aggregated demands" works — and silently get wrong numbers because the second hook (`useGlobalUnfulfilledCredentials`) ignores the per-persona path entirely. The two hooks return the same `CredentialDemandSummary` shape, hiding the semantic gap.
- **Fix sketch**:
  - Add a JSDoc on `computeUnfulfilled` calling out that callers must supply pre-resolved `tools` arrays and that the shared global hook does NOT use this function.
  - Either delete the unused `personas: [...]` parameter or write the multi-persona variant.
  - If the dashboard is planned, leave a TODO with the linked plan number; otherwise narrow the signature.

## 4. Stale-closure trap on `executePersona`: real money paid for the *wrong* agent if persona switches mid-render

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:79-120
- **Scenario**: `handleManualRun` re-reads the live store inside the callback and aborts if the live persona changed. Good. But the same hook's `handleSaveFixture` / `handleDeleteFixture` / `handleUpdateFixture` (lines 149-188) still use the closure's `selectedPersona` directly, and `mutateSingleUseCase` is called with the (potentially stale) id without the same guard.
- **Root cause**: The defensive re-read pattern was applied surgically to the manual-run path because the author noticed the cost/event-emit hazard, but the same race exists for fixture mutations and would write fixtures into the wrong persona's `design_context`.
- **Impact**: A fast persona-switch + click on "Save fixture" can silently persist test fixtures onto the previously-selected persona. The user sees no error and the fixture appears on the wrong agent's grid, hard to discover.
- **Fix sketch**:
  - Promote the `liveSelectedId !== expectedPersonaId` guard from `handleManualRun` into a helper used by all four mutation handlers.
  - Or capture the persona id at hook entry via a ref and pass that to `mutateSingleUseCase` consistently.
  - Add a code comment naming this pattern as the project's official defense for this class of stale-closure bug.

## 5. `parseUseCaseTitles` accepts both `use_cases` and `useCases` keys — silently masks schema drift

- **Severity**: medium
- **Category**: implicit-assumption
- **File**: src/features/agents/sub_tools/libs/toolImpactTypes.ts:53-69 ; src/features/agents/sub_tools/useToolImpactData.ts:58-74
- **Scenario**: The parser tries `ctx?.use_cases ?? ctx?.useCases ?? []`. The "use_cases" snake_case form is not used anywhere else in the design-context schema (which is camelCase per `DesignContextData`), but the fallback is silent — neither a comment nor a log explains why both shapes are accepted.
- **Root cause**: Likely a defensive remnant from a backend rename. With no comment or telemetry, future readers cannot tell whether `use_cases` is a legacy migration path that can be dropped or a still-active producer.
- **Impact**: If the snake_case path is dead, the OR fallback will hide a future schema mismatch (parser returns empty Map → tool impact panel shows IDs instead of titles). If it's still live, removing it during a cleanup will silently break agents whose `design_context` is in the older shape.
- **Fix sketch**:
  - Add a `logger.warn` (rate-limited) when only the snake_case path matched, so we know whether it's still in use.
  - Add a JSDoc "until migration N is complete, both shapes are accepted" with a link or remove the fallback and centralize parsing in `parseDesignContext`.

## 6. `STAGE_DEFS` has 4 entries but `deriveStageIndex` returns up to 4 (out of bounds intent unclear)

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/agents/sub_connectors/libs/automationSetupConstants.ts:16-32 ; duplicated at src/features/agents/sub_connectors/libs/useAutomationSetup.ts:43-59
- **Scenario**: `STAGE_DEFS` defines 4 stages (indices 0..3). `deriveStageIndex` returns 4 when the output line says "design complete" — a value that has no corresponding stage entry. Consumers in `AutomationSetupModal`/progress UI presumably interpret 4 as "all stages complete," but the contract is implicit.
- **Root cause**: The "completion" sentinel was added on top of an array-indexed enum without renaming. There is no `STAGE_DONE = STAGE_DEFS.length` named constant.
- **Impact**: A future contributor who adds a fifth real stage will conflict with the silent 4-as-done convention and break the progress bar's "complete" rendering.
- **Fix sketch**:
  - Define `export const STAGE_DONE_INDEX = STAGE_DEFS.length;` and return it from `deriveStageIndex`.
  - Or model stages as `'connecting' | ... | 'done'` discriminated union instead of a numeric index.
  - Either way, deduplicate `STAGE_DEFS` between `automationSetupConstants.ts` and `useAutomationSetup.ts` (already two definitions, divergence-prone).

## 7. Cost-per-tool attribution silently splits cost equally across all tools in an execution

- **Severity**: high
- **Category**: trade-off-hidden
- **File**: src/features/agents/sub_tools/useToolImpactData.ts:112-140 ; src/features/agents/sub_tools/libs/useToolImpactData.ts:46-61
- **Scenario**: `costPerTool = executionCost / toolNames.length`. A run that called `read_file` 19 times and `web_fetch` once gets each tool credited with 50% of cost. The UI label says "Estimated average cost per invocation."
- **Root cause**: Equal-distribution is a placeholder for proper per-step cost attribution that doesn't exist. The choice is undocumented and the word "Estimated" is doing all the disclaimer work.
- **Impact**: Users will compare tools by `avgCostPerInvocation` and arrive at wrong conclusions ("web_fetch is just as expensive as read_file"). Engineering decisions to drop expensive tools may be made on the basis of a fundamentally distorted number.
- **Fix sketch**:
  - Add a docblock to the function naming the attribution model ("uniform per unique tool") and its limitations.
  - Add a `cost_attribution: 'uniform' | 'weighted'` field to `ToolImpactData` so the UI can label it.
  - Track per-step cost in `tool_steps` if available, and prefer that when present.

## 8. `health_digest` schedule has a "one attempt per app session" retry policy that's only documented inline

- **Severity**: medium
- **Category**: undocumented-decision
- **File**: src/features/agents/health/useHealthDigestScheduler.ts:67-75, 97-99
- **Scenario**: When the digest IPC call fails, the hook latches `ran.current = true` and never retries until the app restarts. The reasoning lives in a 6-line inline comment ("retry storm" prevention). There is no exposed "retry now" button, no log entry that surfaces the latch state, and the docblock at the hook level doesn't mention this contract.
- **Root cause**: A real bug (retry storm) was fixed in place without bubbling the contract up to the function-level JSDoc or a docs page.
- **Impact**: A user whose first launch races the IPC layer will silently miss the weekly digest until the next restart, and a future contributor reading only the JSDoc will not know the latch exists. They might "fix" what looks like a missing retry and reintroduce the storm.
- **Fix sketch**:
  - Move the inline comment up into the hook's JSDoc, including the explicit failure mode ("latches for the session — restart or trigger via Settings").
  - Add an explicit Settings UI action `runFullHealthDigestNow()` referenced in the JSDoc.
  - Log a single `logger.warn` when the latch engages so support can see it.

## 9. Health scoring penalty constants documented in the wrong direction

- **Severity**: low
- **Category**: magic-number
- **File**: src/features/agents/health/useHealthCheck.ts:43-57
- **Scenario**: The docblock claims "warningPenalty 10 → warnings tip a healthy persona into 'degraded' after 3 before dragging it toward 'unhealthy'." 100 - 3*10 = 70, which is below `degradedCutoff` (80) but above `unhealthyCutoff` (50) — fine. But the same block says "errorPenalty 25 → four unresolved errors = score 0" without noting that *three* errors already hit 25 (well below 50/unhealthy), which contradicts an implicit reading that "errors stay degraded until 4."
- **Root cause**: The rationale comments describe the math but not the *grade transitions*, leaving readers to redo the arithmetic.
- **Impact**: Mostly cosmetic — but a designer adjusting these to balance health distribution will misread the existing intent and pick wrong values.
- **Fix sketch**:
  - Re-phrase the rationale in terms of grade boundaries: "1 error → degraded; 3 errors → unhealthy; 4+ errors → 0."
  - Or replace the block with a small ASCII table showing score for {1,2,3,4} errors and {1..5} warnings.

## 10. JSON parse fallback in `dependencyGraph.ts` silently drops broken automation credential mappings

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/agents/sub_connectors/libs/dependencyGraph.ts:175-200
- **Scenario**: `auto.credentialMapping` is parsed as JSON; on parse failure the catch block is empty (`// ignore invalid JSON`). The graph then renders the automation node with NO edges to its credentials, looking healthy in the dependency viewer.
- **Root cause**: The mapping field is loosely-typed JSON in the DB and a corruption (manual edit, partial migration, encoding issue) produces a parse error. The current handling treats "couldn't parse" the same as "no mapping" — visually identical to an automation that genuinely doesn't depend on credentials.
- **Impact**: The DependencyGraphPanel says the automation has no dependency demands, the user thinks it's safe to delete the underlying credential, and the automation breaks at the next run with no UI warning.
- **Fix sketch**:
  - Replace the empty catch with `silentCatch('dependencyGraph:credentialMapping')(err)` so Sentry sees it.
  - Add a fallback edge with `broken: true, label: 'mapping invalid'` so the panel shows a red dependency the user can investigate.
  - Document the contract: `credentialMapping` is JSON-shaped `Record<string, string>` and any deviation is treated as broken.

## 11. `useConnectorStatuses` auto-test guard keyed only by name+credentialId, not by persona

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/agents/sub_connectors/libs/useConnectorStatuses.ts:77-135
- **Scenario**: `lastAutoTestedCredentialRef` is cleared in a useEffect when `selectedPersona?.id` changes, but the inner auto-test useEffect runs on every `statuses` change and may re-fire before the persona-id effect cleanup has settled. The `inFlightTestsRef.current` guard is global to the hook instance.
- **Root cause**: Two effects share two refs to coordinate, plus an asynchronous `testConnector`. The order in which the persona-id-cleanup effect and the statuses-rebuild effect fire on a fast persona switch is implementation-defined by React.
- **Impact**: On rapid persona switching, a healthcheck initiated against persona A may complete and write `result` into the new persona B's row (because connector names are the same). User sees a "passed/failed" state that doesn't actually correspond to anything they tested for the now-selected persona.
- **Fix sketch**:
  - Key the auto-test guard by `${personaId}:${connectorName}:${credentialId}` rather than just connectorName.
  - Cancel in-flight tests via AbortController bound to `selectedPersona.id` (already a ref pattern in `subscriptionLifecycle.ts`).
  - Add a comment in `useConnectorStatuses` clarifying which races are explicitly handled and which are out-of-scope.

## 12. `mergeSubscriptions` emits `'__global__'` magic key for null `use_case_id` but iterates `useCases` only

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/agents/sub_connectors/libs/subscriptionHelpers.ts:64-143
- **Scenario**: Triggers/subscriptions with `use_case_id == null` are bucketed under the literal key `'__global__'`. The merge loop then iterates `for (const uc of useCases)` and looks up that bucket via `triggersByUc.get(uc.id)`. There is no explicit pass that emits items for the `__global__` bucket — so any DB trigger or subscription not tied to a use case is silently dropped from the unified view.
- **Root cause**: The `__global__` sentinel was added to the bucketing pass but the consuming loop never looks it up. The sentinel string is inline (not a named constant) so a grep doesn't reveal both sites at once.
- **Impact**: Triggers created via legacy paths (or future global cron triggers) become invisible in the subscription pipeline UI. The user sees "no triggers" while a trigger is firing in the background — the worst kind of UI/state divergence.
- **Fix sketch**:
  - Promote `'__global__'` to a named exported constant `GLOBAL_USE_CASE_KEY`.
  - After the use-case loop, iterate the leftover `__global__` bucket and emit items with `useCaseTitle: 'Global'`.
  - Add a unit test: a trigger with `use_case_id = null` produces exactly one `UnifiedSubscription` item.
