# tauri:db/models [4/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 3 medium / 1 low)
> Context group: Backend Data & Commands | Files read: 17 | Missing: 0

## 1. `TestSuiteScenario` + `TestSuiteMockTool` are dead duplicates of `engine::test_runner::TestScenario`/`MockToolResponse`
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/db/models/test_suite.rs:29
- **Scenario**: Neither struct is referenced anywhere in Rust outside its own file (repos/commands for test suites only use `PersonaTestSuite`), and their generated bindings (`src/lib/bindings/TestSuiteScenario.ts`, `TestSuiteMockTool.ts`) are imported by nothing but each other. Meanwhile `engine/test_runner.rs:129` defines `TestScenario`/`MockToolResponse` with the exact same field set, and that is the type actually stored in `PersonaTestSuite.scenarios` JSON.
- **Root cause**: The db-model file re-declared the scenario shape (with `camelCase` serde, vs the engine's snake_case) instead of reusing the engine types; nothing was ever wired to it.
- **Impact**: Two divergent schemas for the same persisted JSON — anyone who "fixes" code to parse `scenarios` with `TestSuiteScenario` gets a silent field mismatch (camelCase vs snake_case). Plus two orphaned binding files regenerated on every `ts-rs` export.
- **Fix sketch**: Delete `TestSuiteScenario` and `TestSuiteMockTool` from `db/models/test_suite.rs` (and any `pub use` in the models mod), regenerate bindings so the orphaned TS files disappear. If a db-side type is ever needed, re-export `engine::test_runner::TestScenario` instead. Verify with `cargo check` — no cross-context Rust callers exist per repo-wide grep.

## 2. Hand-written frontend duplicates of `DesignConversation`/`AppendMessageResult`/`DesignConversationMessage` shadow the ts-rs exports
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/models/design_conversation.rs:5
- **Scenario**: All three structs carry `#[ts(export)]`, producing `src/lib/bindings/DesignConversation.ts` etc., but no frontend file outside `src/lib/bindings/` imports them. The app instead uses hand-maintained mirrors in `src/lib/types/designTypes.ts:289-315` (`api/design/design.ts` imports from there).
- **Root cause**: The types were duplicated by hand (to add narrowed string unions like `status: "active" | "completed" | "abandoned"`) instead of consuming or refining the generated bindings, leaving the exports as dead output.
- **Impact**: Classic drift hazard: a Rust field rename/addition regenerates bindings that nobody reads, while the runtime contract lives in a file the compiler can't check against Rust. The `#[serde(skip_serializing_if)]` vs `?`-optional subtleties already differ only by luck.
- **Fix sketch**: Either (a) make `designTypes.ts` re-export/extend the generated bindings (`type DesignConversation = Omit<bindings.DesignConversation, "status"> & { status: ... }`), or (b) drop `#[ts(export)]` from these three structs so no dead bindings are generated. Option (a) keeps compile-time parity and is a small mechanical change.

## 3. `append_single_design_message` ships the full conversation blob back over IPC on every turn
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src-tauri/src/db/models/design_conversation.rs:26
- **Scenario**: `AppendMessageResult.conversation` embeds the whole `DesignConversation`, whose `messages` field is the entire JSON array (capped at 500 messages, and messages include full design-result JSON payloads). The repo (`db/repos/core/design_conversations.rs:107`) even documents the command as existing to "avoid transferring the full message history over IPC — only the new message is sent" — true for the request, but the response then does a second full-row `get_by_id` read and returns everything anyway, every chat turn.
- **Root cause**: The result model was shaped for convenience (return the updated entity) rather than for the delta contract the command was created to provide.
- **Impact**: On long design conversations each append pays an extra full-row SQLite read plus serialization and IPC transfer of a potentially multi-hundred-KB blob the frontend already has locally; cost grows linearly with conversation length up to the cap, on the hottest design-chat path.
- **Fix sketch**: Slim `AppendMessageResult` to metadata the client can't compute — `{ id, truncated, message_count, updated_at }` — and have the frontend append the message it just sent to its local copy (dropping the oldest when `truncated`). Update `designTypes.ts`/`api/design/design.ts` accordingly; the `get_by_id` call in `append_single_message` then disappears.

## 4. Inconsistent serde casing across the models module leaks mixed field styles into TS bindings
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: consistency
- **File**: src-tauri/src/db/models/team_memory.rs:8
- **Scenario**: Within this one context, `TeamMemory`, `TeamMemoryStats`, `SavedView`, `ExecutionAnnotation`, `CredentialRecipe`, and `OcrDocument` serialize with default snake_case, while `CompositionWorkflow`, `SmeeRelay`, `TeamChannelMessage`, `PersonaTestSuite`, audit entries, etc. use `#[serde(rename_all = "camelCase")]` (and `tool_usage.rs` adds a no-op `rename_all = "snake_case"`). Frontend bindings therefore mix `team_id` and `teamId` styles depending on which model a component touches.
- **Root cause**: Casing convention was adopted per-file over time; older models were never migrated.
- **Impact**: Developers must remember per-type casing, and copy-paste between features silently produces `undefined` field reads. Bounded cost, but a recurring paper cut across ~20 frontend files.
- **Fix sketch**: Pick camelCase as the module convention and add `rename_all = "camelCase"` to the stragglers in a dedicated pass — this changes wire shape, so regenerate bindings and sweep frontend usages (grep for the snake_case field names) in the same commit. Do it as its own session; do not piggyback on functional fixes.
