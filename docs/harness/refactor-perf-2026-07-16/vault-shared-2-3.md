# vault/shared [2/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 2 medium / 3 low)
> Context group: Credentials & Connectors | Files read: 18 | Missing: 0

## 1. Orphaned files: `useCredentialTags.ts` and `RecipeListItem.tsx` have no importers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/vault/shared/hooks/useCredentialTags.ts:14 (also src/features/vault/shared/playground/tabs/RecipeListItem.tsx:15)
- **Scenario**: Repo-wide grep finds zero imports of `useCredentialTags` or `RecipeListItem` anywhere in `src/` — only their own definitions plus mentions in docs, `context-map.json`, and `lint-output.json`. Both are full feature files (tag persistence with an `updateCredential` API write path; a recipe row with delete/playground actions) that render/execute nowhere.
- **Root cause**: The tag UI and the recipe list these served were removed or rebuilt elsewhere, and the files were left behind.
- **Impact**: ~200 LOC of dead surface that still compiles against `credApi.updateCredential`, `vaultStore`, and `RecipeDefinition` bindings — future refactors of those APIs pay a tax to keep dead code type-checking, and readers assume a tag feature exists.
- **Fix sketch**: Delete both files (plus `SUGGESTED_TAGS`/`buildMetadataWithTags` in `utils/credentialTags.ts` if `useCredentialTags` was their last consumer — verify that file's other importers first). Update `context-map.json` on the next map refresh.

## 2. `formatContent` re-parses/re-stringifies full MCP result JSON on every render
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/shared/playground/tabs/McpToolResultDisplay.tsx:52
- **Scenario**: After executing an MCP tool, `ToolResultDisplay` stays mounted under `ToolDetail`. Every keystroke in `McpToolInputForm` updates `inputValues` state in `McpToolsTab`, re-rendering the whole subtree — and each render runs `formatContent` (`JSON.parse` + `JSON.stringify(…, null, 2)`) over every content block. MCP tool results are routinely tens-to-hundreds of KB.
- **Root cause**: `ToolResultDisplay` is not memoized and the pretty-print is computed inline in JSX instead of derived once per `result`.
- **Impact**: Per-keystroke synchronous JSON parse/serialize of the entire result payload — visible input lag as soon as a large result is on screen and the user tweaks args for a re-run.
- **Fix sketch**: Wrap `ToolResultDisplay` in `React.memo` (its `result` prop is referentially stable between executions), or compute the formatted blocks with `useMemo(() => result.content.map(b => formatContent(b.text)), [result])` inside the component. Either one line of the two fixes it.

## 3. Discovered MCP tool list is discarded on every tab switch
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: caching
- **File**: src/features/vault/shared/playground/PlaygroundTabContent.tsx:88 (state in tabs/McpToolsTab.tsx:20)
- **Scenario**: `PlaygroundTabContent` conditionally renders `{activeTab === 'mcp-tools' && <McpToolsTab …/>}`, so switching to Overview/Executions unmounts `McpToolsTab` and throws away `tools`, the selected tool, and any typed input values. Returning to the tab shows the empty state and forces a fresh `listMcpTools` round trip to the MCP server.
- **Root cause**: Discovery results live in component-local `useState` of a component that unmounts on tab change; nothing caches per-credential tool lists.
- **Impact**: Repeated network/IPC discovery calls to the MCP server and lost user input during a normal check-result-then-return workflow inside the same modal session.
- **Fix sketch**: Lift `tools` (keyed by `credentialId`) into `CredentialPlaygroundModal` or a module-level cache (the codebase already has `createModuleCache` used by `useBulkHealthcheck`), or keep all tab panels mounted and toggle visibility with CSS. Input values can stay local; the tool list is the expensive part.

## 4. `formatSchema` duplicated between `BuilderParams.tsx` and `EndpointRow.tsx`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/shared/playground/BuilderParams.tsx:100
- **Scenario**: `BuilderParams.tsx` exports `formatSchema` (pretty-print JSON with parse fallback), and `EndpointRow.tsx:145` in the same directory defines a private, byte-identical copy while `RequestBuilder.tsx` imports the exported one.
- **Root cause**: `EndpointRow` re-implemented the helper instead of importing it from its sibling.
- **Impact**: Two copies of the same fallback logic in one folder drift independently (e.g., if error rendering or truncation is added to one).
- **Fix sketch**: Delete the local copy in `EndpointRow.tsx` and import `formatSchema` from `./BuilderParams` (or move it to a tiny `playground/format.ts` if importing a component file for a helper feels wrong).

## 5. `PlaygroundTab` type and OAuth scopes-split logic duplicated across the playground modal
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/shared/playground/CredentialPlaygroundModal.tsx:18
- **Scenario**: `type PlaygroundTab = 'overview' | 'executions' | 'api-explorer' | 'mcp-tools' | 'rotation'` is declared verbatim in both `CredentialPlaygroundModal.tsx:18` and `PlaygroundTabContent.tsx:13`. Separately, the `values.scopes?.trim() ? values.scopes.trim().split(/\s+/) : undefined` extraScopes derivation appears in both `CredentialPlaygroundModal.tsx:71` and `useCredentialOAuth.ts:67-69`.
- **Root cause**: Parent and child each re-declare the shared tab union instead of exporting it once; the scopes parsing was copy-pasted between the two OAuth entry points.
- **Impact**: Adding a tab or changing scope-delimiter handling requires touching two files each; the duplicated unions can silently diverge since they only meet through prop typing.
- **Fix sketch**: Export `PlaygroundTab` (and `TabDef`) from one module and import it in the other. Extract `parseExtraScopes(scopes?: string): string[] | undefined` next to `useGoogleOAuth` and call it from both `handleOAuthConsent` and `useCredentialOAuth.startConsent`.
