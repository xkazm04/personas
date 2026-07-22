# tauri:commands/design [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 1 high / 2 medium / 0 low)
> Context group: Backend Data & Commands | Files read: 6 | Missing: 0

## 1. list_design_conversations ships every conversation's full message history over IPC just to render a list
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src-tauri/src/db/repos/core/design_conversations.rs:23 (surface: src-tauri/src/commands/design/conversations.rs:12)
- **Scenario**: `useDesignConversation.loadConversations` (src/hooks/design/core/useDesignConversation.ts:50) runs on every persona switch and calls `list_design_conversations`, whose repo query is `SELECT * FROM design_conversations` — including the `messages` JSON blob, capped at 500 messages per conversation. A persona with a dozen past conversations serializes potentially megabytes through the Tauri IPC bridge just to show a title/status/date list.
- **Root cause**: The list query selects all columns; there is no lightweight summary shape (unlike `platform_definitions.rs`, which does exactly this with `PlatformDefinitionSummary`).
- **Impact**: O(total message history) IPC transfer + JSON serialization on a hot navigation path; grows without bound as conversations accumulate. The full history is only needed for the one conversation the user resumes.
- **Fix sketch**: Add a `DesignConversationSummary` (id, persona_id, title, status, created_at, updated_at, `json_array_length(messages) AS message_count`) and a repo fn selecting only those columns; return that from `list_design_conversations`. Fetch full messages lazily via the existing `get_design_conversation` when a conversation is resumed (`resumeConversation` already has the row it clicked, so pass it through a get-by-id).

## 2. append_single_design_message is O(1) upload but O(n) download — full conversation re-fetched and returned on every append
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src-tauri/src/db/repos/core/design_conversations.rs:149 (surface: src-tauri/src/commands/design/conversations.rs:63)
- **Scenario**: Every chat message appended during a design session (user answers, AI questions, results, errors — 4 call sites in `useDesignConversation`) triggers `get_by_id` after the UPDATE, returning the entire conversation including the full messages array (up to 500 entries) over IPC. A conversation of n messages costs O(n²) cumulative transfer across its lifetime, contradicting the command's own "O(1) IPC payload" doc comment.
- **Root cause**: `AppendMessageResult` embeds the whole `DesignConversation`; the hook then does `setActiveConversation(result.conversation)` even though it already holds the prior state and the message it just sent.
- **Impact**: Bounded (500-message cap) but repeated waste on the hottest write path of the design chat: re-read of the full row from SQLite + serialization + IPC per keystroke-level event. Also note the count-then-update runs as two non-transactional statements, so the returned `truncated`/`message_count` can be stale under concurrent appends (the frontend queue serializes appends, so low practical risk).
- **Fix sketch**: Return only `{ truncated, message_count, updated_at }` from `append_single_message` (drop the embedded conversation) and have `enqueueAppend` apply the message locally to `activeConversation` — it already contains identical local-merge logic in its catch fallback branch. Optionally fold count+update into a single statement (`RETURNING json_array_length(messages)`) to remove the TOCTOU.

## 3. Dead legacy full-array append chain: append_design_conversation_message command + repo append_message + unused TS wrapper
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/commands/design/conversations.rs:51 (also src-tauri/src/db/repos/core/design_conversations.rs:80, src/api/design/design.ts:46)
- **Scenario**: The TS wrapper `appendDesignConversationMessage` (design.ts:46) has zero callers in src/ — the only consumer, `useDesignConversation`, was migrated to `appendSingleDesignMessage`. The Rust command remains registered in lib.rs:1953 and keeps the repo's `append_message` alive.
- **Root cause**: The 2026-06-09 audit (`bug__persona-chat-conversations.md`) recommended retiring the full-array append because it is a lost-update hazard (last-writer-wins overwrite of the whole messages blob); the caller was migrated but the legacy command/repo/wrapper were left in place.
- **Impact**: ~50 LOC of dead surface, plus a still-invokable IPC command that bypasses the 500-message cap and can silently clobber concurrent appends if any future code (or the webview) calls it. Removing it also closes the previously-documented race for good.
- **Fix sketch**: Delete `appendDesignConversationMessage` from design.ts, the `append_design_conversation_message` command, its lib.rs registration, and `conv_repo::append_message`; regenerate commandNames.generated.ts. Verify no dynamic `invoke("append_design_conversation_message")` remains (grep found none) and that no Rust-side test exercises `append_message` (grep found none).
