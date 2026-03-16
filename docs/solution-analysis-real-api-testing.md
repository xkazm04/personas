# Solution Analysis: Real API Testing in PersonaMatrix Build Flow

## Problem Statement

The current "Test Agent" button in the PersonaMatrix build flow does NOT execute real API calls. It sends a `_test` message to the Claude CLI, which reads the tool specifications and generates a theoretical `test_report` — essentially hallucinating test results. The user has no way to verify that their agent's tools actually work against live services before promoting to production.

The n8n import wizard has the same limitation. Neither path validates credentials, API endpoints, or permissions with real HTTP calls.

## Goal

After the build session reaches `draft_ready` (all 8 dimensions resolved), the "Test Agent" phase should:

1. **Execute each tool** against the real API using stored credentials from the vault
2. **Report real results** — HTTP status codes, response previews, latency
3. **Auto-correct** when API calls fail due to incorrect tool design (wrong endpoint, wrong auth pattern)
4. **Require user action** when failures are caused by missing/invalid credentials or insufficient permissions
5. **Update the agent_ir** automatically when the CLI corrects tool specifications

## Existing Infrastructure (Already Built)

### Direct Tool Execution
**File:** `src-tauri/src/engine/tool_runner.rs`

`invoke_tool_direct()` already executes tools against real APIs:
- Resolves credentials via `runner::resolve_credential_env_vars()`
- Extracts curl commands from `implementation_guide`
- Substitutes `$ENV_VAR` placeholders with decrypted credential values
- Executes via `Command::new("curl")` (no shell injection risk)
- Returns actual HTTP response (status, body, headers)
- Has rate limiting and audit logging built in

### Credential Resolution
**File:** `src-tauri/src/engine/runner.rs` (lines 1089-1231)

`resolve_credential_env_vars()` handles the full credential lifecycle:
- Looks up credential by connector name from the DB
- Decrypts field values
- Auto-refreshes OAuth tokens if expired (with per-credential locking)
- Converts to env vars: `$CONNECTOR_UPPER_FIELD_UPPER`
- Logs audit entries for compliance

### Connector Auth Strategies
**File:** `src-tauri/src/engine/connector_strategy.rs`

Per-service OAuth refresh strategies for Google, Microsoft, GitHub, ClickUp, CircleCI, Buffer. Token refresh is locked per credential ID to prevent race conditions.

### Agent IR Tool Schema
Each tool in the agent_ir includes:
```json
{
  "name": "gmail_list_messages",
  "category": "email",
  "description": "List recent Gmail messages",
  "requires_credential_type": "google",
  "implementation_guide": "API: GET https://www.googleapis.com/gmail/v1/users/me/messages\nAuth: -H 'Authorization: Bearer $GOOGLE_ACCESS_TOKEN'\nParams: maxResults=5\nCurl: curl -s -H 'Authorization: Bearer $GOOGLE_ACCESS_TOKEN' 'https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=5'"
}
```

The `implementation_guide` contains everything needed to make a real API call.

## Proposed Architecture

### Phase Flow

```
draft_ready → User clicks "Test Agent"
    ↓
[Phase: testing]
    ↓
For each tool in agent_ir.tools:
    ├─ 1. Resolve credentials from vault
    ├─ 2. Execute tool via invoke_tool_direct()
    ├─ 3. Classify result:
    │     ├─ SUCCESS (2xx) → Mark tool as tested ✅
    │     ├─ AUTH_ERROR (401/403) → Credential issue → requires user action
    │     ├─ NOT_FOUND (404) → Wrong endpoint → auto-correct via CLI
    │     ├─ RATE_LIMIT (429) → Backoff and retry
    │     └─ SERVER_ERROR (5xx) → Service down → note and skip
    ├─ 4. If auto-correctable: send refinement to CLI with error details
    └─ 5. Emit test progress events to frontend
    ↓
[Phase: test_complete]
    ↓
Show test results:
  - Per-tool pass/fail with HTTP status
  - Credential issues → "Fix in Keys" button → redirect to vault
  - Permission issues → "Update in Apps & Services" → highlight connectors cell
  - Auto-corrected tools → yellow "updated" state on affected dimensions
```

### Backend Implementation

#### New Tauri Command: `test_build_draft`

**File:** `src-tauri/src/commands/design/build_sessions.rs`

```rust
#[tauri::command]
pub async fn test_build_draft(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    session_id: String,
    persona_id: String,
) -> Result<serde_json::Value, AppError>
```

Flow:
1. Load build session from DB, parse agent_ir
2. Extract `tools[]` and `required_connectors[]`
3. For each tool:
   a. Resolve credentials via `runner::resolve_credential_env_vars()`
   b. If credential missing → add to `missing_credentials` list, skip tool
   c. Call `tool_runner::invoke_tool_direct()` with safe test input
   d. Classify HTTP response
   e. Emit progress event via `app.emit("build-test-progress", ...)`
4. For failed tools (4xx): compose refinement prompt with error details
5. Send refinement to CLI as new turn: "Tool X failed with HTTP 404. The endpoint may be wrong. Here's the actual error: ... Fix the implementation_guide."
6. CLI responds with corrected tool specs → update agent_ir
7. Return test report: `{ tools_tested, tools_passed, tools_failed, credential_issues, auto_corrections }`

#### Test Input Generation

For each tool, generate a minimal safe test input:
- **GET endpoints**: Use minimal query params (e.g., `?maxResults=1&limit=1`)
- **POST endpoints**: Use empty body or minimal valid payload
- **Dangerous operations** (DELETE, PUT): Skip or use dry-run mode if available
- **Time-filtered tools**: Use narrow time window (last 1 hour) to minimize data

The CLI prompt already includes `execution_mode` per use case:
- `"e2e"` → test with real API calls
- `"mock"` → generate example output only
- `"non_executable"` → skip testing

#### Error Classification

```rust
enum TestResult {
    Success { status: u16, latency_ms: u64, preview: String },
    AuthError { status: u16, message: String, connector: String },
    PermissionError { status: u16, message: String, scope_needed: String },
    EndpointError { status: u16, message: String, suggested_fix: String },
    RateLimit { retry_after: Option<u64> },
    ServiceDown { status: u16, message: String },
    CredentialMissing { connector: String },
}
```

#### Auto-Correction Loop

When a tool fails with a correctable error (wrong endpoint, wrong auth pattern):

1. Compose a refinement message:
```
Tool "gmail_list_messages" failed:
- HTTP 404: Not Found
- URL attempted: https://www.googleapis.com/gmail/v1/users/me/messages
- Actual error: {"error":{"code":404,"message":"Not Found"}}

Please fix the implementation_guide for this tool. The API endpoint or parameters may be incorrect.
Also update any affected dimensions (error-handling, use-cases) if needed.
```

2. Send as a new CLI turn (same multi-turn mechanism as Q&A)
3. CLI responds with corrected tool spec → parse and update agent_ir
4. Re-test the corrected tool
5. Max 2 auto-correction attempts per tool (prevent infinite loops)

#### User Action Required

When failures need user intervention:

- **Missing credential**: Emit event with connector name → frontend shows "Add credential in Keys" button on the connectors cell
- **Insufficient permissions**: Emit event with required scope → frontend shows "Update permissions" message
- **OAuth expired / refresh failed**: Emit event → frontend shows "Re-authenticate" button

Frontend routes these to the Apps & Services dimension:
- Connectors cell shows red status dots for affected services
- "Fix in Keys" button navigates to the vault module
- After user fixes the credential, they can re-run the test

### Frontend Implementation

#### Test Progress Events

New Tauri events emitted during testing:

```typescript
// Per-tool test result
"build-test-tool-result": {
  session_id: string;
  tool_name: string;
  status: "passed" | "failed" | "skipped" | "correcting";
  http_status?: number;
  latency_ms?: number;
  error?: string;
  connector?: string;
}

// Overall test progress
"build-test-progress": {
  session_id: string;
  tested: number;
  total: number;
  phase: "testing_tools" | "auto_correcting" | "complete";
}

// Test complete summary
"build-test-complete": {
  session_id: string;
  passed: number;
  failed: number;
  skipped: number;
  auto_corrected: number;
  credential_issues: Array<{ connector: string; issue: string }>;
}
```

#### Updated TestResultsPanel

Replace the current simple pass/fail with a detailed per-tool report:

```
┌─────────────────────────────────────────┐
│ Test Results                            │
│                                         │
│ ✅ gmail_list_messages    200  120ms    │
│ ✅ gmail_get_message      200   85ms    │
│ ❌ slack_post_message     401  Needs    │
│    → Missing Slack credential           │
│    [Add in Keys]                        │
│ 🔄 notion_query_database  404 → Fixed  │
│    Auto-corrected endpoint              │
│                                         │
│ 3/4 tools passed, 1 needs credentials  │
│                                         │
│ [Re-test Failed]  [Promote Agent]       │
└─────────────────────────────────────────┘
```

#### Connectors Cell Integration

When test reveals credential issues:
- Connectors cell data updated with test results
- Red dots for failed connectors
- "Add in Keys" / "Re-authenticate" actions per connector
- After user fixes, "Re-test" button available

### Sequence Diagram

```
User clicks "Test Agent"
    │
    ├──→ Frontend: handleStartTest()
    │         │
    │         ├──→ Tauri: test_build_draft(session_id, persona_id)
    │         │         │
    │         │         ├──→ Parse agent_ir, extract tools[]
    │         │         │
    │         │         ├──→ For each tool:
    │         │         │     ├──→ resolve_credential_env_vars()
    │         │         │     │     └──→ DB lookup + OAuth refresh
    │         │         │     │
    │         │         │     ├──→ invoke_tool_direct(tool, test_input)
    │         │         │     │     └──→ curl command execution
    │         │         │     │
    │         │         │     ├──→ emit("build-test-tool-result", {...})
    │         │         │     │     └──→ Frontend updates per-tool status
    │         │         │     │
    │         │         │     └──→ If 4xx: compose_refinement()
    │         │         │           └──→ CLI turn: fix implementation_guide
    │         │         │                 └──→ Re-test corrected tool
    │         │         │
    │         │         ├──→ emit("build-test-complete", {...})
    │         │         │
    │         │         └──→ Return test report
    │         │
    │         └──→ Update UI: TestResultsPanel with per-tool results
    │
    ├──→ If credential issues:
    │     └──→ Highlight connectors cell with "Fix in Keys" actions
    │
    └──→ If all passed:
          └──→ Enable "Promote Agent" button
```

## Files to Modify

### Backend (Rust)

| File | Change |
|------|--------|
| `src-tauri/src/commands/design/build_sessions.rs` | Add `test_build_draft` command |
| `src-tauri/src/engine/build_session.rs` | Add test orchestration function using tool_runner |
| `src-tauri/src/engine/tool_runner.rs` | Add `test_tool_safe()` wrapper with timeout + rate limit |
| `src-tauri/src/lib.rs` | Register new command |

### Frontend (TypeScript)

| File | Change |
|------|--------|
| `src/api/agents/buildSession.ts` | Add `testBuildDraft()` API wrapper |
| `src/features/agents/components/matrix/useMatrixLifecycle.ts` | Rewrite handleStartTest to call real test |
| `src/stores/slices/agents/matrixBuildSlice.ts` | Add test result state (per-tool results) |
| `src/features/templates/sub_generated/gallery/matrix/MatrixCommandCenterParts.tsx` | Rewrite TestResultsPanel with per-tool display |
| `src/lib/eventBridge.ts` | Add build-test-* event listeners |
| `src/lib/types/buildTypes.ts` | Add test result types |
| `src/lib/commandNames.overrides.ts` | Register test_build_draft command |

## Safety Considerations

1. **Rate limiting**: Max 1 API call per tool per test run. Use `tool_runner`'s built-in rate limiter.
2. **Read-only preference**: Default to GET requests for testing. Skip DELETE/PUT unless `execution_mode: "e2e"`.
3. **Timeout**: 10-second timeout per tool call. Abort and mark as "timeout" on exceed.
4. **Credential audit**: All credential accesses logged via existing audit system.
5. **Auto-correction limit**: Max 2 correction attempts per tool to prevent infinite loops.
6. **No side effects**: Test inputs should be minimal and non-destructive (e.g., `maxResults=1`).

## Estimated Effort

- **Backend (Rust)**: ~300 lines across 4 files. Main work is the test orchestration loop and error classification.
- **Frontend (TypeScript)**: ~200 lines across 6 files. Main work is the TestResultsPanel rewrite and event listeners.
- **Prompt refinement**: ~50 lines. Auto-correction prompt templates.
- **Testing**: Full E2E test with test-automation framework.

## Dependencies

- `invoke_tool_direct()` in tool_runner.rs (EXISTS)
- `resolve_credential_env_vars()` in runner.rs (EXISTS)
- Multi-turn CLI conversation in build_session.rs (EXISTS — used for Q&A)
- Tauri event emission pattern (EXISTS — used for build events)
- Per-tool test result state in Zustand (NEW)
