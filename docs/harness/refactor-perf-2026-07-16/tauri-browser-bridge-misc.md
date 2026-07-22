# tauri:browser_bridge (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 0 high / 2 medium / 1 low)
> Context group: Core Libraries & State | Files read: 2 | Missing: 0

## 1. Tool-name list duplicated between descriptors and dispatch allowlist
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/browser_bridge/mcp.rs:273
- **Scenario**: A new browser tool gets added to `tool_descriptors()` (mcp.rs:115) but the author forgets the hand-maintained `known` array in `call_tool` (mcp.rs:273-282); the tool is advertised in `tools/list` yet every call returns "unknown tool" (or the inverse: dispatched but undocumented).
- **Root cause**: The nine tool names exist in two independent literals — the JSON descriptor blob and the `known: [...]` string array — with no shared source of truth.
- **Impact**: Silent drift hazard on the exact seam that will change most (adding tools is the module's expected evolution path). Also note `browser_status`/`browser_navigate`/`browser_click` names appear a third time as scattered string comparisons.
- **Fix sketch**: Introduce `const TOOL_NAMES: [&str; 9] = [...]` (or a small `struct ToolSpec { name, slow: bool }` table) and build both `tool_descriptors()` names and the `known` check from it. The per-tool timeout match (mcp.rs:260) can hang off the same table via a `slow`/`timeout` field.

## 2. Reader loop deep-clones the relay `result` payload — doubles screenshot allocations
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: allocation
- **File**: src-tauri/src/browser_bridge/relay.rs:162
- **Scenario**: `browser_screenshot` returns a frame whose `result.data` is a base64 PNG (easily 1-5 MB for a full viewport). `on_frame` parses the frame into a `Value`, then `frame.get("result").cloned()` performs a full deep copy of that multi-megabyte string before handing it to the waiter — while holding no lock, but on the single WS reader task that serializes all extension traffic.
- **Root cause**: `frame` is owned locally and dropped right after, but the code borrows-and-clones instead of moving the subtree out.
- **Impact**: 2x transient memory and an extra multi-MB memcpy per screenshot/snapshot on the bridge's hottest large-payload path; also stalls the reader loop slightly, delaying subsequent frames.
- **Fix sketch**: Make `frame` mutable and take ownership: `frame.as_object_mut().and_then(|o| o.remove("result")).unwrap_or(Value::Null)` in the `Ok` arm (same pattern applies to the `error` field). No behavior change; drops the clone entirely.

## 3. Disconnected `browser_status` builds JSON by string interpolation
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/browser_bridge/mcp.rs:215
- **Scenario**: When no extension is connected, `call_tool` hand-formats a JSON object via `format!` with `{origin}` spliced into a raw string. If an approved origin ever contained a `"` or backslash (unlikely today, but `origin_of` is upstream and evolving), the model receives syntactically invalid JSON.
- **Root cause**: Ad-hoc string templating where the file otherwise consistently uses the `json!` macro (see `augment_status` right below, which does it properly).
- **Impact**: Fragile one-off inconsistent with the module's own style; a latent malformed-output edge case rather than a live bug.
- **Fix sketch**: Build with `json!({ "connected": false, "approved_origin": origin, "hint": "..." })` and `serde_json::to_string_pretty`, mirroring `augment_status`, then wrap in `text_result`.
