> Context: api (misc 2)
> Total: 7
> Critical: 0  High: 0  Medium: 3  Low: 4

## 1. Recipe cancel commands are unscoped — cancel can target the wrong in-flight job
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/api/recipes/recipes.ts:59-60, 72-73, 92-93
- **Scenario**: `startRecipeExecution` / `startRecipeGeneration(credentialId,…)` / `startRecipeVersioning(recipeId,…)` each return a distinct id (`execution_id` / `generation_id` / `versioning_id`), but the matching `cancelRecipeExecution()`, `cancelRecipeGeneration()`, `cancelRecipeVersioning()` take **no argument**. If the user kicks off a generation for credential A, then starts a second for credential B before the first finishes, a "Cancel" click resolves against a single backend slot (`CancelResult.cancelled_id`) — it can abort the newer job or report `was_running:false` for the one the user meant to stop.
- **Root cause**: the cancel API assumes exactly one running job of each kind, but the start API hands out per-job ids and nothing prevents concurrent starts. Contrast `cancelN8nTransform(transformId)` in the sibling module, which *does* scope by id.
- **Impact**: UX / lost work — a long generation the user wanted to keep gets cancelled, or the intended cancel silently no-ops.
- **Fix sketch**: thread the returned id through cancel (`cancelRecipeGeneration(generationId)`), and have the backend reject/return `was_running:false` when the id doesn't match the active slot; or enforce single-flight at the start boundary.

## 2. `acceptRecipeVersion` takes six positional `string | null` args — silent mis-mapping risk
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/api/recipes/recipes.ts:95-108
- **Scenario**: `promptTemplate, inputSchema, sampleInputs, description, changesSummary, expectedUpdatedAt` are all `string | null`. TypeScript cannot catch a caller that transposes two of them (e.g. swaps `description` and `changesSummary`, or passes `sampleInputs` where `inputSchema` belongs). The values then persist into the wrong recipe columns with no type error and no runtime complaint.
- **Root cause**: a long flat positional signature over homogeneously-typed nullable strings — the compiler's only defense (distinct types) is absent.
- **Impact**: data integrity — a mis-ordered call corrupts stored recipe metadata / defeats the optimistic-lock token (`expectedUpdatedAt`) silently.
- **Fix sketch**: take a single options object (`{ promptTemplate, inputSchema, … }`) so call sites are keyed by name; the one caller (RecipeVersionsTab.tsx:73) is easy to migrate.

## 3. Dead & redundant network metric wrappers (`getConnectionHealth`, `getMessagingMetrics`)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/api/network/discovery.ts:125-126, 131-132
- **Scenario**: grep across all of `src/` finds `getConnectionHealth` and `getMessagingMetrics` referenced only in their own definition file — no store slice, component, hook, or test calls them. Both are already covered by `getNetworkSnapshot`, whose `NetworkSnapshot` bundles `health: ConnectionHealth` and `messagingMetrics: MessagingMetrics` (networkSlice consumes the snapshot). They are duplicate one-off IPC round-trips no one uses.
- **Root cause**: individual metric commands predate the aggregated `get_network_snapshot`; the snapshot superseded them but the singles were never removed.
- **Impact**: maintainability — two unused exports plus their Rust command handlers to keep in lockstep.
- **Fix sketch**: delete both wrappers (and their backend commands if likewise unreferenced); callers already use `getNetworkSnapshot`.

## 4. Dead wrappers: `getUseCaseRecipes`, `listN8nSessions`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/api/recipes/recipes.ts:79-80; src/api/templates/n8nTransform.ts:312-315
- **Scenario**: `getUseCaseRecipes` is referenced nowhere outside recipes.ts (the used sibling is `getCredentialRecipes`). `listN8nSessions` (full-row list) is referenced nowhere — N8nSessionList.tsx uses `listN8nSessionSummaries` instead; only the summaries variant is live.
- **Root cause**: superseded API surface left in place after callers moved to the summary/credential variants.
- **Impact**: maintainability — dead exports invite accidental resurrection and keep unused backend commands wired.
- **Fix sketch**: remove both wrappers (verify the Rust commands `get_use_case_recipes` / `list_n8n_sessions` have no other consumer, then drop them too).

## 5. `update_exposed_resource` is registered + typed but has no frontend path
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src/api/network/exposure.ts:54-61
- **Scenario**: the backend command `"update_exposed_resource"` exists (commandNames.generated.ts:1405) and `UpdateExposedResourceInput` is generated (lib/bindings/UpdateExposedResourceInput.ts), but exposure.ts exposes only `listExposedResources`, `createExposedResource`, `deleteExposedResource` — no `updateExposedResource` wrapper, and grep finds no caller. ExposureManager.tsx can create/delete but never edit. Either the edit feature is unreachable (functional gap) or the backend command + binding are dead surface.
- **Root cause**: the update path was scaffolded on the Rust side and never wired through the TS api layer / UI.
- **Impact**: maintainability / product gap — users must delete-and-recreate to change an exposed resource; dead backend command otherwise.
- **Fix sketch**: add `export const updateExposedResource = (id, input: UpdateExposedResourceInput) => invoke(...)` and wire an edit action, OR delete the command + binding if the delete-recreate flow is intended.

## 6. Redundant `key: key` self-assignments in invoke arg objects
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/api/templates/n8nTransform.ts:243-249, 275, 285; src/api/templates/templateFeedback.ts:53-57
- **Scenario**: several invoke payloads spell out `adjustmentRequest: adjustmentRequest`, `previousDraftJson: previousDraftJson`, `sessionId: sessionId`, `executionId: executionId`, `comment: comment`, `source: source` — explicit self-mappings that shorthand property syntax already covers. Verified purely cosmetic (identical identifier on both sides).
- **Root cause**: mechanical param forwarding never collapsed to shorthand.
- **Impact**: maintainability — noise that obscures the few keys that *are* renamed (e.g. `channelType`).
- **Fix sketch**: use object shorthand (`{ adjustmentRequest, previousDraftJson, sessionId }`); leave genuinely-renamed keys explicit.

## 7. Inline `import('@/lib/bindings/…')` type refs repeated across n8n session helpers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/api/templates/n8nTransform.ts:299-340
- **Scenario**: `N8nSessionResponse`, `SessionStatus`, `N8nSessionSummary` are referenced via inline `import('…').Type` expressions repeated ~5 times across `createN8nSession` / `getN8nSession` / `listN8nSessions` / `listN8nSessionSummaries` / `updateN8nSession`, while the rest of the file uses hoisted top-level `import type` statements.
- **Root cause**: incremental additions used inline imports instead of adding to the top-of-file type imports.
- **Impact**: maintainability / readability only.
- **Fix sketch**: hoist to `import type { N8nSessionResponse, N8nSessionSummary } from '@/lib/bindings/…'` at the top and reference the short names.
