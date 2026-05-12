# Code-refactor scan — Agent Chat & Sessions

> Total: 12 findings (3 high, 6 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack (Tauri/React/Rust)
> Date: 2026-05-12
> Note: All paths below live under the active worktree
> `C:/Users/mkdol/dolla/personas/.claude/worktrees/delegated-splashing-wolf/` —
> the master branch does not yet contain `sub_chat`, `chatSlice`, or the
> chat-related Rust modules (they are still on the worktree branch).

## 1. `ChatThread.tsx` is fully orphaned

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/agents/components/ChatThread.tsx:1-80` (80 LOC)
- **Scenario**: This component is a self-contained chat renderer
  (welcome / messages / thinking / error). Nothing in the runtime imports
  it. The only reference outside the file itself is a string literal
  `'ChatThread.tsx'` inside `src/lib/harness/scenario-parser.ts:194`, used
  for harness-scoping metadata — that is **not a JSX/import reference**.
  The actual chat view used by the app is `sub_chat/ChatTab.tsx` +
  `ChatBubbles.tsx`.
- **Root cause**: ChatThread was an earlier iteration; the rewrite landed
  in `sub_chat/` and the predecessor was never deleted.
- **Impact**: 80 LOC of dead UI plus its `LoadingSpinner`, `i18n`, and
  `ChatMessage` import edges hang around; greppers and AI tools surface
  both implementations side-by-side and confuse downstream refactors.
- **Fix sketch**: Delete `src/features/agents/components/ChatThread.tsx`.
  In `src/lib/harness/scenario-parser.ts:194`, drop `'ChatThread.tsx'`
  from the `features` array of the `typo-agents-core` module (it is just
  a label and has no runtime effect).

## 2. `appendChatStreamLine` is a documented no-op action on the slice

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/stores/slices/agents/chatSlice.ts:59` (decl) and `:238-241`
  (body)
- **Scenario**: The action exists in the slice interface and the
  implementation literally is `(_line) => { /* no-op; ChatTab reads
  executionOutput directly */ }`. It is never called anywhere in `src/`
  — `grep "appendChatStreamLine"` returns only its declaration and
  definition.
- **Root cause**: The slice was carved out of a callback-driven listener
  design; once the listener was rewritten to push into `executionOutput`
  directly (see `setupChatExecListeners` at `chatSlice.ts:415`), the
  action became a stub that nobody removed.
- **Impact**: Pollutes the `ChatSlice` interface, leaks a misleading API
  surface (other devs grepping for "where is the streaming line
  appended?" find a no-op), and ships dead code in the bundle.
- **Fix sketch**: Remove both the `appendChatStreamLine` declaration
  (line 59) and its definition (lines 238-241) from `chatSlice.ts`. Then
  remove it from the `AgentStore` storeTypes union if it's listed there.

## 3. `system_prompt_hash` is plumbed end-to-end but never written

- **Severity**: high
- **Category**: dead-code
- **File**: `src-tauri/src/db/models/chat.rs:104,121` |
  `src-tauri/src/db/repos/communication/chat.rs:160,195,200,210` |
  `src-tauri/src/db/migrations/schema.rs:1413` |
  `src/api/agents/chat.ts:51,62` |
  `src/lib/bindings/ChatSessionContext.ts:3` |
  `src/lib/bindings/UpsertSessionContextInput.ts:3`
- **Scenario**: A `system_prompt_hash` column exists in
  `chat_session_context`, has a Rust `Option<String>` field on both
  `ChatSessionContext` and `UpsertSessionContextInput`, is wired into
  the upsert SQL with a `COALESCE(?5, system_prompt_hash)` clause, gets
  exported via `ts-rs` bindings, **and** the JS API client accepts it.
  No caller in TS or Rust ever sets a non-null value. Every
  `saveChatSessionContext(...)` site in `chatSlice.ts`,
  `backgroundChatSlice.ts`, `useExperimentBridge.ts` omits the field.
- **Root cause**: A "detect system-prompt drift across resumes" feature
  was scaffolded but never wired up (the resume-vs-fresh-context branch
  in `chatSlice.ts:179-206` could have used it but chose
  `claude_session_id` instead).
- **Impact**: Schema/binding noise across 6 files, a misleading
  surface that suggests drift detection works, and a maintenance
  burden every time the session-context shape changes (every site that
  builds the upsert object has to keep typing this field as optional).
- **Fix sketch**: Either land the drift-detection feature or remove the
  column. To remove: drop `system_prompt_hash` from
  `db/models/chat.rs:104,121`, the SELECT/INSERT/UPDATE list in
  `db/repos/communication/chat.rs:155-216`, the migration column at
  `db/migrations/schema.rs:1413` (or land a follow-up migration that
  drops it), the two TS bindings, and the `api/agents/chat.ts:51,62`
  field. Regenerate `ts-rs` bindings.

## 4. `lab_get_versions` shape is duplicated inline at 3 sites

- **Severity**: medium
- **Category**: duplication
- **File**: `src/api/agents/lab.ts:140` (canonical typed wrapper) |
  `src/features/agents/sub_chat/libs/chatAdvisoryDispatch.ts:249-253` |
  `src/features/agents/sub_chat/panels/OpsLabPanel.tsx:40-49`
- **Scenario**: There is a well-typed `getLabVersions()` API wrapper at
  `lab.ts:140` returning `PersonaPromptVersion[]`. Two callers inside
  the chat feature ignore it and re-invoke the command directly with
  inline `<{ id; tag?; created_at; change_summary? }[]>` shapes. If the
  `PersonaPromptVersion` schema changes, both copies will silently
  drift.
- **Root cause**: Quick-and-dirty inline calls during advisory hub +
  ops panel buildout instead of importing the existing wrapper.
- **Impact**: Three different shapes for one query; refactor risk on the
  Rust side cannot be type-checked across the chat surface; minor bundle
  bloat from duplicate ad-hoc interfaces.
- **Fix sketch**: Replace both inline `invokeWithTimeout("lab_get_versions", ...)`
  call sites with `getLabVersions(personaId, limit)` from
  `@/api/agents/lab`. Drop the local typed shape and use
  `PersonaPromptVersion` directly.

## 5. Persona-data fetching duplicated in 5 ops/lab/run actions

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/agents/sub_chat/panels/OpsRunPanel.tsx:49-56`
  | `OpsLabPanel.tsx:59-70` | `OpsDirectorPanel.tsx` (no copy — uses
  director API) | `chatAdvisoryDispatch.ts` (executes via op
  dispatch) | `AdvisoryLaunchpad.tsx` (sends as preset)
- **Scenario**: Both `OpsRunPanel.handleExecute` and
  `OpsLabPanel.handleQuickLaunch` (and `AdvisoryLaunchpad.handleOptionSend`
  for the "execute" preset) duplicate the same 5-line `ensure-session →
  sendMessage` pattern: read `activeChatSessionId`, call
  `startNewChatSession()` if null, bail on null return, then
  `sendMessage(personaId, sessionId, '<canned prompt>')`. The canned
  prompts that originate the same "execute this agent now" intent are
  also duplicated across these sites.
- **Root cause**: Each ops panel was written in isolation; no shared
  helper exists for "kick off a chat-driven command".
- **Impact**: 3+ sites that must keep their session-creation logic in
  sync. If session creation grows another guard (e.g. persona-changed
  check like `ChatTab.tsx:228-236`), the panels will silently bypass it.
- **Fix sketch**: Add `sendCannedPrompt(personaId, prompt): Promise<void>`
  to `chatSlice.ts` that internalises the `activeChatSessionId ??
  startNewChatSession()` chain. Replace the three call sites with a
  single store-action invocation. Move canned prompts to a single map
  exported from `chatSlice.ts` so they are findable.

## 6. Per-execution Tauri listener setup duplicated across two slices

- **Severity**: medium
- **Category**: duplication
- **File**: `src/stores/slices/agents/chatSlice.ts:412-492` (≈ 80 LOC) |
  `src/stores/slices/agents/backgroundChatSlice.ts:325-501` (≈ 180 LOC)
- **Scenario**: Both `setupChatExecListeners` and
  `setupBackgroundExecListeners` perform the same dance: dynamic-import
  `@tauri-apps/api/event`, `@/lib/eventRegistry`,
  `@/lib/execution/executionState`, `@/lib/utils/terminalColors`;
  install an EXECUTION_OUTPUT listener that filters by `execution_id`;
  install an EXECUTION_STATUS listener that bails until
  `isTerminalState` then assembles a `textLines.filter(classifyLine ===
  'text').join('\n').trim()` response; both manage an `aborted`/
  `finalized` flag pair, both clean up the unlisten handles, both
  swallow listener-setup failures and reset to "not streaming".
- **Root cause**: backgroundChat was forked from chatSlice's listener
  scaffold and never deduplicated.
- **Impact**: ~80 LOC of structural duplication; bug fixes (e.g. the
  `aborted` flag pattern at `chatSlice.ts:432`) have to be repeated;
  three different cleanup-tracking strategies (singleton
  `chatExecCleanup` vs `activeCleanups: Map`) coexist.
- **Fix sketch**: Extract `lib/chatExecListenerSetup.ts` exposing
  `installExecutionListeners({ executionId, onOutputLine, onTerminal,
  onSetupError }): cleanupFn`. Have both slices call it and supply
  thin closures for their slot-specific finalisation. Lands at
  `chatSlice.ts:415` and `backgroundChatSlice.ts:333`.

## 7. Triple-rendered loading spinner div with the same Tailwind classes

- **Severity**: low
- **Category**: duplication
- **File**: `src/features/agents/sub_chat/OpsSidebar.tsx:139` |
  `panels/OpsAssertionsPanel.tsx:88` | `panels/OpsLabPanel.tsx:111` |
  `panels/OpsRunPanel.tsx:98`
- **Scenario**: The identical 1-line
  `<div className="w-4 h-4 border-2 border-primary/30 border-t-primary
  rounded-full animate-spin" />` appears verbatim in 4 chat-feature
  files. A `LoadingSpinner` component already exists at
  `@/features/shared/components/feedback/LoadingSpinner` (used in
  `ChatTab.tsx:3,367`).
- **Root cause**: Copy-paste during panel scaffolding.
- **Impact**: Inconsistent loading affordance across the app if the
  shared spinner is restyled. Minor maintenance — but with 4 identical
  sites in one feature it crosses the duplication threshold.
- **Fix sketch**: Replace each inline div with `<LoadingSpinner />`
  (already imported in `ChatTab.tsx`). For `OpsSidebar.tsx:139` keep
  the existing `PanelLoadingFallback` shell but swap the inner div.

## 8. `executePersona` wrapping logic forked between chat slices

- **Severity**: medium
- **Category**: duplication
- **File**: `src/stores/slices/agents/chatSlice.ts:158-221`
  (`sendChatMessage`) | `backgroundChatSlice.ts:148-275`
  (`startFeedbackChat`)
- **Scenario**: Both slices build a near-identical "advisory JSON
  wrapper around a user message", then call `executePersona(personaId,
  undefined, conversationInput, undefined, continuation,
  crypto.randomUUID())`. The wrappers diverge subtly:
  `chatSlice.ts:200-205` sends `{ _advisory: true, conversation,
  latest_message }` while `backgroundChatSlice.ts:213-217` sends an
  identical shape but with `conversation: \`Human: ${instruction}\``
  (no role-prefix line-break formatting). Both record the result on the
  same session-context store but key them differently.
- **Root cause**: backgroundChat was written without consulting the
  formatting in chatSlice; the `Human:` prefix style is duplicated from
  `buildSummary()` at `chatSlice.ts:79-85`.
- **Impact**: Two slightly different JSON shapes sent to the same Rust
  endpoint mean a prompt change has to be made in two places; risk that
  one drifts and the persona behaves differently for foreground vs
  feedback chats.
- **Fix sketch**: Extract `lib/chatRequestBuilder.ts` exposing
  `buildAdvisoryFirstTurn(messages, latestMessage, mode)` and
  `buildResumeTurn(latestMessage)`. Both slices call it; the `Human:
  ${msg}` formatting lives in exactly one place alongside `buildSummary`
  at `chatSlice.ts:79`.

## 9. `MAX_CHAT_MESSAGES` cap repeated as hardcoded `500` in background slice

- **Severity**: low
- **Category**: duplication
- **File**: `src/stores/slices/agents/chatSlice.ts:70` (declared) vs
  `backgroundChatSlice.ts:113` (`.slice(-500)`)
- **Scenario**: `chatSlice.ts:70` defines `const MAX_CHAT_MESSAGES =
  500;` and uses it at 7 sites. `backgroundChatSlice.ts:113` uses
  `.slice(-500)` inline when promoting messages into the active chat
  after a background result arrives. If the cap changes in chatSlice,
  background promotion silently keeps the old behaviour.
- **Root cause**: Constant not exported.
- **Impact**: Silent drift; only surfaces as "background chats keep
  longer history than foreground" or vice-versa after a bump.
- **Fix sketch**: Export `MAX_CHAT_MESSAGES` from `chatSlice.ts:70`
  (named export at the top of the module) and import it in
  `backgroundChatSlice.ts:113`. Or move it to
  `lib/chatLimits.ts` if shared elsewhere.

## 10. `chatMode === 'agent'` branch is unreachable from any UI

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/stores/slices/agents/chatSlice.ts:22,30,49,92,105-116,
  181,353,395`
- **Scenario**: The slice models `ChatMode = 'advisory' | 'agent'` and
  branches on it in three places (the wrapper-key choice at line 202,
  the restore decisions at lines 353 + 395, the `setChatMode` persistor
  at 105). No UI component or external caller invokes `setChatMode` —
  `grep "setChatMode"` finds only the slice definition and uses
  `useAgentStore.*setChatMode` returns zero results in `*.tsx`. The
  agentStore migration at `stores/agentStore.ts:73` even preserves the
  field across persists, suggesting it was once toggleable. Initial
  default `'advisory'` is the only value ever written.
- **Root cause**: A mode toggle was planned (probably a "talk to the
  agent vs talk about the agent" switch) but never built.
- **Impact**: 30+ LOC of conditional logic that will never execute,
  obscures the actual single-mode wrapper shape, and gives the false
  impression that the codebase supports a second chat mode.
- **Fix sketch**: Either expose `setChatMode` in `OpsSidebar.tsx` near
  the new-session button, or strip the entire `chatMode` field — remove
  it from the slice (`chatSlice.ts:22-116`), unwrap the two `chatMode
  === 'agent'` ternaries at lines 353/395, simplify the `isAdvisory`
  check at line 181, and drop the agentStore persist migration block
  in `agentStore.ts:72-74`. Decide direction first.

## 11. `getLatestChatSession` / `get_latest_chat_session` is registered but never invoked

- **Severity**: low
- **Category**: dead-code
- **File**: `src/api/agents/chat.ts:72-73` |
  `src-tauri/src/commands/core/chat.rs:71-77` |
  `src-tauri/src/db/repos/communication/chat.rs:229-248` |
  `src-tauri/src/lib.rs:1074` |
  `src/lib/commandNames.generated.ts:503`
- **Scenario**: A full vertical slice exists — TS wrapper, Tauri
  command handler, repo query, generated command-name union entry — for
  `get_latest_chat_session`. No caller in TS invokes
  `getLatestChatSession`. The restore-the-latest-session flow that
  would naturally use it is implemented inline in
  `chatSlice.restoreChatSession` (`chatSlice.ts:382-396`) using
  `sessions.reduce(...)` over the already-fetched list, with an
  explicit comment justifying the choice.
- **Root cause**: Inline derivation superseded the dedicated query, but
  the original command wasn't retired.
- **Impact**: 20 LOC dead across 5 files + an unused command in the
  IPC surface (additional attack surface for `require_auth_sync`
  vetting). Verified registered in `lib.rs:1074`.
- **Fix sketch**: Remove the export at `api/agents/chat.ts:72-73`,
  the command function at `commands/core/chat.rs:70-77`, the repo
  function at `db/repos/communication/chat.rs:229-248`, the
  `commands::core::chat::get_latest_chat_session` line at
  `lib.rs:1074`, and regenerate `commandNames.generated.ts`.

## 12. `isOperationLine` alias in `ChatBubbles.tsx` adds an indirection layer

- **Severity**: low
- **Category**: cruft
- **File**: `src/features/agents/sub_chat/ChatBubbles.tsx:7-13`
- **Scenario**: `ChatBubbles.tsx:7` imports `isOperationStart` from
  `./libs/chatAdvisoryDispatch`, then line 13 immediately rebinds it as
  `const isOperationLine = isOperationStart;` and references the alias
  at lines 169 and 191. The comment explains the rename is "to keep
  rendering and dispatch aligned" — but the import and the alias point
  to the same function, so the alias adds nothing beyond a rename. The
  exported name in `chatAdvisoryDispatch.ts:47` is already
  `isOperationStart` with a docstring explicitly calling out the
  shared-rendering contract.
- **Root cause**: Refactor leftover when the predicate was hoisted out
  of `ChatBubbles.tsx` into the dispatch module.
- **Impact**: Minor cognitive overhead; greppers searching for
  `isOperationLine` find one file, searching for `isOperationStart`
  find another, masking that the two refer to the same predicate.
- **Fix sketch**: Drop the alias line at `ChatBubbles.tsx:13` and
  rename the two call sites (`:169`, `:191`) to use `isOperationStart`
  directly. The header comment at lines 10-12 can be deleted as the
  exported function already documents the contract.
