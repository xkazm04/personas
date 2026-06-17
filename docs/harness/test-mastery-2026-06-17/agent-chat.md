# Test Mastery — Agent Chat
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

## 1. Duplicate-assistant-message idempotency guard in finishChatStream is wholly untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/stores/slices/agents/chatSlice.ts:268-322 (guard at :277-278)
- **Current test state**: none
- **Scenario**: A single terminal `EXECUTION_STATUS` event is observed by BOTH chatSlice's per-execution listener AND `executionSlice.finishExecution` (and `cancelExecution` is a third entry). The synchronous `if (!get().chatStreaming) return; set({ chatStreaming:false ... })` before the first `await createChatMessage` is the only thing preventing two callers from each INSERTing an assistant row. The header comment documents that removing/reordering it previously caused permanent duplicate messages + doubled session-context upsert. Today, nothing fails if someone moves the `set` back below the `await`, or refactors `finishChatStream` to be `async`-first.
- **Root cause**: The guard is pure store logic (no Tauri needed) but there is zero coverage of the chat slice; the regression is invisible until users see doubled replies in production.
- **Impact**: Permanent duplicate assistant messages in every chat thread, doubled summary writes, and a corrupted `claude_session_id` capture — directly degrades the core chat product and pollutes persisted history.
- **Fix sketch**: vitest test instantiating the slice (mock `@/api/agents/chat` `createChatMessage`/`saveChatSessionContext`/`getExecution`). Set `chatStreaming:true`, fire `finishChatStream(resp,...)` TWICE concurrently (await Promise.all) → assert `createChatMessage` called exactly once and `chatMessages` length grew by 1. Invariant: **at most one assistant row per terminal event regardless of concurrent callers**. Add a second case: `finishChatStream` with empty/whitespace `fullResponse` flips `chatStreaming` false and inserts NOTHING.

## 2. makeStreamSafe (streaming code-fence repair) has no tests despite branchy parsing
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/agents/components/ChatMessageContent.tsx:28-45
- **Current test state**: none
- **Scenario**: `makeStreamSafe` rebalances an unterminated trailing ``` fence so streamed markdown never flashes raw half-parsed text. It counts `^```` matches, finds the last `\n```` (falling back to the first `\n```` … actually `content.indexOf('```')` when no newline-prefixed fence), and rewrites the tail to `\`\`\`\n\`\`\``. Edge cases — fence at column 0 of line 1 (no leading `\n`), inline backticks vs block fences, language-tagged fences (```` ```ts ````), an already-balanced even count, content with `> ```` inside a blockquote — each take a different branch. A refactor that mis-handles "no preceding newline" (the `start === -1` path is currently unreachable because indexOf finds it, so a closed fence body could be silently truncated) slips through today.
- **Root cause**: Pure string→string function, trivially unit-testable, but never covered; behavior is load-bearing for streaming UX.
- **Impact**: Broken/duplicated code blocks render mid-stream (the exact flicker this function exists to prevent), or — worse — earlier message content gets sliced away by a bad `start` offset.
- **Fix sketch**: LLM-generatable batch over input/output pairs. Invariant to assert: **output always has an even number of `^```` fences AND never drops any text that precedes the last opening fence** (`output.startsWith(content.slice(0, start))`). Cover: balanced passes through unchanged; single unterminated fence with/without language; fence as very first chars; no fence present.

## 3. extractCodeText recursion (drives copy + Send-to-Lab payload) is untested
- **Severity**: high
- **Category**: missing-assertion
- **File**: src/features/agents/components/ChatMessageContent.tsx:37-45, 197-209
- **Current test state**: none
- **Scenario**: `extractCodeText` walks the react-markdown AST (strings, numbers, arrays, nested `{props:{children}}`) to reconstruct the raw code text that is both copied to clipboard and handed to `onSendToLab(rawText, language)`. The `pre` renderer also parses the language via `/language-([\w+-]+)/` and trims a trailing newline. If react-markdown changes its node shape (common across major versions) or a nested element type isn't handled, `extractCodeText` silently returns `''` or a partial string — the copy button "succeeds" and Send-to-Lab fires an empty/garbled command, with no test catching it.
- **Root cause**: The function is exported-able pure logic but lives inline and untested; failure mode is silent (empty string), the classic success-theater trap.
- **Impact**: Users copy or "Send to Lab" a shell/json snippet and get empty or mangled text — a broken core affordance that looks like it worked.
- **Fix sketch**: Extract `extractCodeText` (and the language-regex) and unit-test: nested `{props:{children:['echo ', {props:{children:'hi'}}]}}` → `'echo hi'`; trailing-newline stripped; `language-ts` parsed to `ts`, no class → `null`. Invariant: **reconstructed rawText equals the concatenation of all leaf text in source order**.

## 4. Content mutation + length-validation ordering in chat repo create() is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/communication/chat.rs:84-132; src-tauri/src/validation/chat.rs:9-67; src-tauri/src/validation/mod.rs:17-27
- **Current test state**: none (validation/chat.rs has NO `#[cfg(test)]` mod; sibling validation/trigger.rs:257 and persona.rs:516 DO — the convention exists)
- **Scenario**: `create()` validates `content` length on the ORIGINAL input (byte length via `.len()`), then stores `strip_html_tags(content)` — a DIFFERENT, possibly mutated string. `strip_html_tags` decodes entities in a fixed order (`&lt;`→`<`, …, `&amp;`→`&` LAST), so input like `&amp;lt;` double-decodes to `<`, and legitimate code containing `<div>` is silently stripped to empty. There is no test asserting (a) empty/whitespace content is rejected, (b) >100KB content is rejected, (c) invalid role rejected, or (d) that benign code/math text round-trips through `strip_html_tags` without corruption.
- **Root cause**: Pure validators + a deterministic string transform, perfectly unit-testable, but completely uncovered; the strip-then-store step can silently alter what the agent actually said.
- **Impact**: Stored chat messages silently lose or corrupt code snippets (the dominant chat payload), or an XSS-bypass case slips through unnoticed. Both are business-critical for a chat product.
- **Fix sketch**: Add `#[cfg(test)] mod tests` to validation/chat.rs (LLM-generatable): `validate_content("")`/`"   "` → required error; oversized → max_length; `validate_role("admin")` → error, all four valid roles → empty; `validate_metadata` boundary at MAX_METADATA_BYTES. Separately test `strip_html_tags`: `<script>` removed; `a < b && c > d` and ``` `let x = vec![]` ``` round-trip unchanged; assert NO double-decode of `&amp;lt;`. Invariant: **strip_html_tags is idempotent and never alters tag-free text**.

## 5. Background-chat success/failure classification and listener-leak cleanup untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/stores/slices/agents/backgroundChatSlice.ts:331-498 (classify at :378; cleanup at :470,496,80-91)
- **Current test state**: none
- **Scenario**: A background feedback chat is marked `succeeded` iff `fullResponse.length > 0 && !terminalStatus.toLowerCase().includes("fail")`. This drives whether an assistant message is persisted, whether a success-vs-failure notification fires, and whether the per-feedbackId cleanup is released (preventing a `Map` leak of one closure per call). The substring `"fail"` check is brittle (a status like `"FAILURE"` matches, but `"errored"`/`"timeout"` would be classified as success). `registerCleanup` also fires the prior cleanup on re-register — none of this is verified.
- **Root cause**: Logic is entangled with dynamic `import()` + Tauri `listen`, so it was skipped; but the classifier and the cleanup map are extractable pure units.
- **Impact**: Failed background chats mis-reported as success (user told the agent "replied" when it errored), or `activeCleanups` leaks listeners over a long session.
- **Fix sketch**: Extract the classifier `succeeded(fullResponse, terminalStatus)` and unit-test the truth table (empty resp → false; "completed"+text → true; "failed"/"FAILURE" → false; "timeout"/"error" → assert the intended decision). Test `registerCleanup`/`releaseCleanup`: re-registering a feedbackId invokes the previous cleanup once; `releaseCleanup` removes the entry. Invariant: **no assistant message and no "success" notification is ever emitted for a non-successful terminal status**.

## 6. deriveTitle / buildSummary truncation helpers untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/stores/slices/agents/chatSlice.ts:85-97 (deriveTitle, buildSummary); backgroundChatSlice.ts:106-117 (shortPreview, firstLine)
- **Current test state**: none
- **Scenario**: `deriveTitle` collapses whitespace and truncates to 57 chars + `...` past 60; `buildSummary` takes the last 20 messages and slices each to 300 chars with `Human:`/`Assistant:` prefixes. These determine the persisted session title and the conversation summary re-injected as LLM context on first turn. Off-by-one in the boundary (exactly 60 chars), an empty message list, or a role-prefix swap would silently degrade titles/summaries with no test.
- **Root cause**: Pure helpers, currently module-private and uncovered.
- **Impact**: Mislabeled chat sessions in the sidebar and a malformed summary fed back to the model (worse continuation quality) — low blast radius but cheap to lock down.
- **Fix sketch**: Export and LLM-generate a batch: `deriveTitle` at lengths 59/60/61 (boundary), whitespace collapse, leading/trailing trim; `buildSummary` with 0, 1, and >20 messages (asserts only last 20 kept, correct `Human/Assistant` prefix, 300-char cap). Invariant: **title length ≤ 60 and summary contains only the last 20 messages with correct role labels**.

## 7. miniPlayerSlice reducers have no coverage
- **Severity**: low
- **Category**: coverage-gap
- **File**: src/stores/slices/agents/miniPlayerSlice.ts:24-45
- **Current test state**: none
- **Scenario**: `unpinMiniPlayer` must also collapse (`miniPlayerExpanded:false`) — a coupling that's easy to drop in a refactor. `toggleMiniPlayerExpanded` flips state. These are simple but the unpin→collapse coupling is a real behavioral contract for the mini-player UX.
- **Root cause**: Trivial reducers, never tested.
- **Impact**: Minor — a stale-expanded mini-player after unpin. Low risk, low cost.
- **Fix sketch**: Tiny vitest: pin then unpin → both `miniPlayerPinned:false` AND `miniPlayerExpanded:false`; toggle twice returns to start. Invariant: **unpin always implies collapsed**. (Borderline-trivial; include only if batching the other slice tests.)
