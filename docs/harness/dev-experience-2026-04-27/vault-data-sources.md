# Vault Data Sources & Dependencies — Dev Experience Scan

> Total: 10 · Critical: 1 · High: 3 · Medium: 4 · Low: 2
> Scope: client-side only
> Date: 2026-04-27

---

## 1. `escapeSqlStringLiteral` regex contradicts its own comment — silent rewrite still happens

- **Severity**: Critical
- **Category**: convention-drift
- **File**: `src/features/vault/sub_databases/introspectionQueries.ts:51-63`
- **Scenario**: Dev opens the introspection helpers because a user reports "no columns shown for `users-prod`". Reads the lengthy comment in `getListColumnsQuery` (lines 65-72) which celebrates that the previous `[^a-zA-Z0-9_]` strip-regex was replaced and that hyphens/spaces now reach the catalog. Concludes the bug is somewhere else, wastes 30+ minutes, eventually reruns `'users-prod'.replace(/[ -]/g, '')` in a REPL and gets `'usersprod'` — the new regex `[ -]` is the ASCII range space → hyphen and strips space, `!`, `"`, `#`, `$`, `%`, `&`, `'`, `(`, `)`, `*`, `+`, `,`, AND `-`. The "fix" is the same bug the comment claims it fixed.
- **Root cause**: `[ -]` was almost certainly intended as a character class containing only space and hyphen, but in regex `[a-z]` is a range. The author also added a `.replace(/'/g, "''")` SQL-quote escape AFTER stripping — but the strip already removed every `'`, so the second replace is dead code. The same regex is duplicated in `escapePostgresIdent` and `escapeMysqlIdent`.
- **Impact**: All three "fixed" call sites still mangle table names containing space or hyphen. `getSelectAllQuery('postgres', 'order-items')` returns `SELECT * FROM "orderitems" LIMIT 100;` — exactly the failure mode the comment says was fixed. Devs trust the comment, lose hours.
- **Fix sketch**: Use `.replace(/[\x00-\x1F\x7F]/g, '')` for control-character stripping (the comment says that's the intent) and rely solely on the SQL-style quote-doubling for the literal/identifier escape. Add a unit test with `'users-prod'`, `'My Table'`, and `'order"items'` so the fix is verified. Move the three escape helpers and tests to a single file or an `__tests__` neighbour — there are zero tests on this module today.

---

## 2. `simulateRevocation` is called with a hardcoded empty workflows array — feature is dead on arrival

- **Severity**: High
- **Category**: dev-loop-friction
- **File**: `src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx:86`
- **Scenario**: Dev enables simulation mode in the UI to verify the "workflows would break" panel. Sees `totalAffectedWorkflows: 0` always, regardless of credential. Spends time tracing into `simulateRevocation`, the workflow store, etc. Eventually sees the call site passes `[]` literally for `workflows`.
- **Root cause**: `simulateRevocation(selectedNodeId, graph, [], healthSignals, credentials)` — the third positional arg was never wired to a workflow store. The `AffectedWorkflow` machinery, the `'critical'` severity branch, and `MitigationSummary`'s `mitigation_pause` rule are all unreachable.
- **Impact**: A whole branch of the revocation simulator is dead code. Mitigation suggestions degrade silently. New devs reading `credentialGraph.ts` (437 LOC) are misled about what the system does.
- **Fix sketch**: Either (a) fetch workflows from the workflow/composition store and pass them, or (b) drop the `workflows` parameter and the workflow-related fields if the feature is intentionally postponed. If keeping it, make the parameter required and add a TS guard so `[]` literal at the call site shows up in code review.

---

## 3. `extractErrorMessage` duplicated three times across this module

- **Severity**: High
- **Category**: code-organization
- **File**: `src/features/vault/sub_databases/safeModeUtils.ts:71-78`, `tabs/ConsoleTab.tsx:11-19`, `src/lib/utils/apiError.ts`
- **Scenario**: Dev fixes an error-extraction edge case (e.g. Tauri's new wrapped-error envelope) in one location, ships, and the bug recurs because `ConsoleTab.tsx` has its own copy. Or imports `extractErrorMessage` from `safeModeUtils` (semantically the wrong file — safe-mode and error formatting are unrelated), wonders why the helper lives there.
- **Root cause**: `safeModeUtils.ts` exports `extractErrorMessage` even though it's about safe-mode. `ConsoleTab.tsx` has a verbatim local copy. `src/lib/utils/apiError.ts` is the canonical home but isn't used here.
- **Impact**: Three source-of-truth divergence risk. Readers grep for the helper and find conflicting copies.
- **Fix sketch**: Delete both vault copies, import from `@/lib/utils/apiError`. Add an ESLint `no-restricted-syntax`/`no-duplicate-imports` rule or a one-line lint comment to forbid local copies.

---

## 4. Missing tests for the critical credential-graph and safe-mode logic

- **Severity**: High
- **Category**: testing
- **File**: `src/features/vault/sub_dependencies/` (no `__tests__`), `src/features/vault/sub_databases/safeModeUtils.ts`, `src/features/vault/sub_databases/introspectionQueries.ts`
- **Scenario**: `credentialGraph.ts` (437 LOC) contains the `agent:<persona_id>` ID contract, `analyzeBlastRadius`, `simulateRevocation`, `severityForAgentCount`, and `buildCredentialGraph` invariant guards — pure functions, trivially testable, zero tests. Same for `safeModeUtils.isMutationQuery` (the WITH-CTE escape hatch and string-stripping logic is genuinely tricky) and `introspectionQueries.getSelectAllQuery` (where a real silent bug lives — see #1).
- **Root cause**: `__tests__` was added under `sub_databases` but covers UI components, not the pure logic where bugs hide. `sub_dependencies` has no `__tests__` directory at all.
- **Impact**: Regressions in blast-radius math, mutation detection, and SQL escaping ship undetected. The project's `tdd` skill exists but isn't being applied to the highest-risk files.
- **Fix sketch**: Add `sub_dependencies/__tests__/credentialGraph.test.ts` covering the agent-id contract, blast-radius dedupe, severity buckets, and the `simulateRevocation` failover branch. Add `sub_databases/__tests__/safeModeUtils.test.ts` (CTE mutations, comment-stripping, unclosed-comment fail-safe) and `introspectionQueries.test.ts` (the bug in #1 plus quote-escape correctness across families).

---

## 5. `tokenizeSql`/`tokenizeRedis`/`tokenizeJson` are 200+ lines of hand-rolled lexer with zero tests

- **Severity**: Medium
- **Category**: testing
- **File**: `src/features/vault/sub_databases/sqlTokenizers.ts:47-247`
- **Scenario**: Dev pastes `SELECT '/* not a comment */ \\\\' FROM x` into the editor, syntax highlight breaks on the escape sequence. Or adds a new keyword and accidentally introduces an infinite loop by forgetting to `i++`. There is no test that proves these tokenizers terminate or handle adversarial input.
- **Root cause**: The component test (`SqlEditor.test.tsx`) only checks "the pre element has at least 1 keyword span" — it does not exercise the tokenizer directly. `tokenizeSql` is exported but only consumed via the React component.
- **Impact**: The editor is in three places (`ConsoleTab`, `QueryEditorPane`, `AssistantSqlBlock`). Any tokenizer regression breaks every database-tab. Hand-rolled lexers without tests are textbook drift bait.
- **Fix sketch**: Either add `sqlTokenizers.test.ts` with cases for nested strings, dollar-quoted Postgres strings, unterminated input, multi-line comments, Redis arg parsing, and a fuzz harness; OR replace with a battle-tested library (Prism/Highlight.js token streams, Shiki, etc.) given Vite already supports it.

---

## 6. `framer-motion` mock duplicated verbatim in two test files

- **Severity**: Medium
- **Category**: testing
- **File**: `src/features/vault/sub_databases/__tests__/DatabaseListView.test.tsx:9-28`, `__tests__/SchemaManagerModal.test.tsx:9-27`
- **Scenario**: Dev adds `motion.span` usage to the schema manager, schema test fails with "motion.span is not a function". Updates one mock, the other test file still has the old shim and silently masks the issue. Or: every new vault test copies the same 20-line shim from a sibling file.
- **Root cause**: No shared test setup file for framer-motion; each test rolls its own.
- **Impact**: Test files have ~20 lines of boilerplate that drifts. Discourages writing more tests because of the copy-paste tax.
- **Fix sketch**: Add `src/test/framerMotionMock.ts` with one canonical `vi.mock('framer-motion', ...)` factory, or register the mock globally in the existing test setup (the repo already has `src/test/tauriMock.ts` so the pattern is established).

---

## 7. `O(N²)` `graph.nodes.find` chains in render path — no node-id index

- **Severity**: Medium
- **Category**: code-organization
- **File**: `src/features/vault/sub_dependencies/credentialGraph.ts:133,146,160,236,252`, `CredentialRelationshipGraph.tsx:77,84,134`, `GraphCanvas.tsx:97-98`
- **Scenario**: Dev profiles the graph view with 200 credentials × 5 dependents each. Sees long render frames. Notices `analyzeBlastRadius` does a `graph.nodes.find` per edge and `simulateRevocation` does the same — quadratic in node count. `GraphCanvas` repeats it again per edge in the relationship list.
- **Root cause**: `CredentialGraph` exposes `nodes: GraphNode[]` and `edges: GraphEdge[]` as parallel arrays without an `id → node` index. Every consumer pays the lookup cost.
- **Impact**: Doesn't bite at small scale, but becomes a click-latency papercut as soon as a user has even ~50 credentials with many dependents. New code keeps repeating the pattern.
- **Fix sketch**: Add `nodesById: Map<string, GraphNode>` to the `CredentialGraph` interface (built once in `buildCredentialGraph`) and update consumers. Or expose a `getNode(id)` helper. Either way, a single source of lookups beats six grep-able `.find()` calls.

---

## 8. `let chatIdCounter = 0` module-level mutable state

- **Severity**: Medium
- **Category**: convention-drift
- **File**: `src/features/vault/sub_databases/tabs/ChatTab.tsx:15-16`
- **Scenario**: Dev writes a test that mounts `ChatTab` twice in a single test file and asserts on message IDs — discovers IDs leak across test cases. Or HMR reloads the module mid-development and the counter resets, but `Date.now()` collisions appear in the same millisecond.
- **Root cause**: `let chatIdCounter = 0; function nextId() { return chat-${Date.now()}-${++chatIdCounter}; }` is module-scoped mutable state. Other ID generators in this codebase use `crypto.randomUUID()` or `nanoid`.
- **Impact**: Test isolation friction, HMR weirdness, drift from project convention.
- **Fix sketch**: Replace with `crypto.randomUUID()` (or the project's existing prefix-generator if there is one).

---

## 9. Magic dimensions and pixel constants scattered across panel components

- **Severity**: Low
- **Category**: convention-drift
- **File**: `sub_dependencies/SimulationControls.tsx:43,83`, `NodeDetailPanel.tsx:45`, `GraphCanvas.tsx:95,108`, `BlastRadiusPanel.tsx`, `sub_databases/QueryResultTable.tsx:9,107`
- **Scenario**: Dev wants to change the scrollable list height in the simulation panel from 140px to 180px. Greps for `max-h-\[140px\]` to find the right place — no global token, finds `max-h-[140px]`, `max-h-[100px]`, `max-h-[200px]`, `max-h-[250px]`, `max-h-[300px]`, `maxHeight: 400`, all in the same module, all unrelated.
- **Root cause**: No shared scroll-container size token in the design system; each panel hardcodes its own.
- **Impact**: Visual inconsistency, refactor friction. The CSS module cluster is the largest convention-drift source in this scan.
- **Fix sketch**: Define `SCROLL_AREA_SM/MD/LG` constants in `graphConstants.ts` (or a vault-wide `sizes.ts`) and migrate. Or audit and consolidate to fewer values (one for "compact list", one for "primary detail").

---

## 10. `dangerouslySetInnerHTML` with manually-escaped HTML — no documented contract

- **Severity**: Low
- **Category**: documentation
- **File**: `src/features/vault/sub_dependencies/SimulationPanel.tsx:69-99`
- **Scenario**: Dev adds a new severity branch and forgets to call `escapeHtml(simulation.credentialName)`, introducing a stored-XSS vector via credential name. The pattern of "build HTML string with `<strong>` tags and inject" is non-obvious; the only safety net is a single `escapeHtml` call at line 25.
- **Root cause**: The `tx()` translation helper is being used to interpolate HTML — there's no comment explaining why this can't be done with React children (e.g. via an `<I18nRich>` component). Three sibling branches replicate the same pattern, easy to miss the escape on a fourth.
- **Impact**: Latent XSS surface every time a new severity is added. Pattern is not idiomatic React.
- **Fix sketch**: Replace the four `dangerouslySetInnerHTML` blocks with a small `<RichTrans>` component that takes `tokens: { credentialName: <strong>{name}</strong>, ... }` and splices safely. Or, at minimum, add a `// XSS: every interpolated dynamic value MUST go through escapeHtml` block-comment above the `tx()` calls.
