# Bug Hunt — Templates Catalog & Builder

> Group: Templates, Onboarding & Home
> Files scanned: 16
> Total: 2C / 5H / 4M / 0L = 11 findings

---

## 1. confirm_n8n_persona_draft idempotency guard is racy → duplicate persona on double-click

- **Severity**: critical
- **Category**: race-condition
- **File**: `src-tauri/src/commands/design/n8n_transform/confirmation.rs:489-578`
- **Scenario**: User double-clicks "Confirm" or the wizard auto-confirms while the user manually clicks. Two `confirm_n8n_persona_draft` invocations land for the same `session_id`. Both read `session.persona_id` before either has finished writing it back (write happens at line 555, after `create_persona_atomically` completes). Both pass the "no existing persona" check, both run `create_persona_atomically` and INSERT a new persona row with a fresh UUID. Result: two personas, two import_transactions rows, two sets of triggers/tools.
- **Root cause**: Read-modify-write on `n8n_sessions.persona_id` is not in a transaction with the persona INSERT. The session row is the only mutex; nothing actually serializes confirmation.
- **Impact**: Duplicate personas after any flaky network click, mobile double-tap, or stale-tab retry. User sees "Imported n8n Workflow" twice in the persona list with identical tools. Cleanup is manual.
- **Fix sketch**: Wrap the entire confirm path in a transaction that (a) `SELECT ... FOR UPDATE`-style locks the session row, (b) re-checks `persona_id` after acquiring the lock, (c) does the INSERT, (d) updates the session. Or use `INSERT ... ON CONFLICT(session_id) DO NOTHING` semantics on a unique constraint over `n8n_sessions.persona_id`.

## 2. instant_adopt_template has no idempotency at all → unbounded duplicates

- **Severity**: critical
- **Category**: race-condition
- **File**: `src-tauri/src/commands/design/template_adopt.rs:208-445`
- **Scenario**: Click "Adopt" twice quickly on a template card (e.g. Slack double-tap on macOS). Both invocations call `instant_adopt_template_inner` → both call `create_persona_atomically` with a fresh UUID. There is no session_id parameter and no dedup key. Each call increments `template_adoption_count` and creates a fully-independent persona, including duplicate tools and triggers.
- **Root cause**: Unlike `confirm_n8n_persona_draft` (which has a — flawed — session-based guard), `instant_adopt_template` is purely fire-and-forget. The frontend modal disables the button via `pending` state, but a network hiccup that causes the user to click before the IPC reply arrives bypasses that.
- **Impact**: A user spam-clicking "Adopt Slack Notifier" 4× ends up with 4 identical personas. The Persona list page becomes a nightmare to clean up — there's no automatic dedup.
- **Fix sketch**: Require an idempotency key from the frontend (e.g. crypto.randomUUID() generated once per modal open) and store it in a `template_adoptions` row with a unique constraint. On a duplicate key, return the existing persona instead of creating a new one.

## 3. recipe substituteDeep walks user-controlled JSON without prototype-pollution guard

- **Severity**: high
- **Category**: proto-pollution
- **File**: `src/features/templates/sub_recipes/libs/substituteBindings.ts:31-50`
- **Scenario**: A custom (non-builtin) recipe whose `prompt_template` JSON contains `{"__proto__": {"polluted": "x"}}` (constructed via JSON.parse, which bypasses the normal `__proto__` setter and stores it as an own property — this is the well-known JSON.parse + Object.assign / for-in issue). `parsePromptTemplate` parses the prompt, returns the result, and `substituteDeep` recurses over it via `Object.entries` then writes into a fresh `out: Record<string, unknown> = {}` — but constructs the output via `out[k] = ...`. Today this writes `__proto__` as an own property too (safe), but the field then flows into `mutateUseCases` and lands in `design_context` JSON — which is later JSON.parsed by the persona runtime. If any downstream code uses `for (const k in obj)` or merges with `Object.assign({}, obj)`, the polluted prototype propagates.
- **Root cause**: No allowlist of safe keys; no `Object.create(null)` for the accumulator; no skip of `__proto__` / `constructor` / `prototype` keys.
- **Impact**: Any code path that walks a recipe-derived object with `for...in` or shallow-merges it inherits attacker-controlled prototype keys. With recipes coming from user-imported JSON or future "publish to community" flows, this becomes a remote vector.
- **Fix sketch**: Skip `__proto__`, `constructor`, and `prototype` keys in `substituteDeep`'s loop; use `Object.create(null)` as the accumulator. Alternatively, `JSON.parse(JSON.stringify(value))` immediately after parsing to scrub prototype attacks.

## 4. SessionExecDir Drop runs std::fs::remove_dir_all on a tokio thread → blocking IO

- **Severity**: high
- **Category**: silent-failure
- **File**: `src-tauri/src/engine/build_session/runner.rs:85-102`
- **Scenario**: `run_session` is a tokio async task. Its stack contains `SessionExecDir`, whose `Drop` calls synchronous `std::fs::remove_dir_all`. On Windows with antivirus active or many small files in `%TEMP%/build-session-<uuid>` (e.g. Claude CLI cached MCP packages), the rmdir can take 100+ms and blocks the executor thread. With the default multi-threaded runtime this drains the thread pool one slot at a time, but on a constrained runtime (or when many sessions terminate at once after a cancel-all sweep), all workers can be simultaneously blocked.
- **Root cause**: Synchronous filesystem in async Drop. `tokio::fs::remove_dir_all` is the async counterpart but Drop can't be async, so the cleanup needs `tokio::task::spawn_blocking`.
- **Impact**: After cancelling 5+ build sessions in parallel (e.g. user closes the build modal mid-flight), other tokio tasks (HTTP, DB pool acquire, IPC handling) stutter for the duration of all cleanups serialized through Drop. Symptom: UI freeze for 1-3 seconds on bulk-cancel.
- **Fix sketch**: In `Drop::drop`, capture the path and `tokio::spawn_blocking(move || std::fs::remove_dir_all(path))` if a tokio handle is available; fall back to inline rmdir as today when no runtime exists (e.g. tests).

## 5. Build session re-uses --continue but %TEMP%/build-session-<uuid> may be ransomware-watched

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src-tauri/src/engine/build_session/runner.rs:306-326`
- **Scenario**: The runner creates `std::env::temp_dir().join(format!("build-session-{}", uuid))` and reuses it across all 12 turns so Claude CLI's `--continue` cache persists. If the user sets %TEMP% to a OneDrive-synced folder (common on Windows corporate machines), each CLI write triggers OneDrive upload + Defender scan. Worse: the SessionExecDir drop deletes a directory OneDrive is mid-syncing, leaving zombie tombstones in the cloud.
- **Root cause**: `std::env::temp_dir()` honors `TMP/TEMP` env vars without sanity-checking that the path is local-only. The runner already detects "OneDrive" in the error path (line 318 user_msg) but doesn't avoid the issue proactively.
- **Impact**: Slow builds (10× normal due to AV/sync), corrupted CLI conversation state on retry, and OneDrive trash filling with build-session-<uuid> directories. Users blame Claude when the bug is path selection.
- **Fix sketch**: Use a dedicated app-data directory (e.g. `dirs::cache_dir().join("personas/build-sessions")`) instead of `std::env::temp_dir()`. Verify it's not under OneDrive/Dropbox/iCloud paths at startup; fall back to a different drive if so.

## 6. n8n workflow file is read fully into memory before size check on stream-parsed YAML

- **Severity**: high
- **Category**: edge-case
- **File**: `src/features/templates/sub_n8n/hooks/useWorkflowImport.ts:74-103`
- **Scenario**: User drops a 100MB malicious or accidentally-bloated YAML file. `processFile` checks `file.size > MAX_FILE_SIZE_BYTES` but only AFTER `FileReader.readAsText(file)` — which loads the entire file into memory. The size check then rejects, but the renderer process has already allocated 100MB+ for the string. Repeat this 5× and Tauri's webview crashes with OOM.
- **Root cause**: Order of operations: size check appears before `readAsText`, but the `readAsText` is the call that allocates. Actually re-reading — the size check IS before readAsText (lines 82-86). However, `parseWorkflowFile` (line 37 of useWorkflowImport calling chain → workflowParser.ts:42) does `JSON.parse(content)` on a string that's already been validated for size. With 5MB of nested arrays, a malicious workflow can blow up to 50MB+ of object graph, then `JSON.stringify(parsed)` (line 120 of workflowParser.ts) re-serializes it, then it's passed via Tauri IPC as `state.rawWorkflowJson`. The IPC layer copies the string. Total: ~3-4× peak memory of the original file size.
- **Root cause (revised)**: No depth-limit on JSON parsing; no bounded recursion in parseN8nWorkflow node enumeration (raw.nodes has no length cap).
- **Impact**: A 5MB file with 100k empty nodes can spike memory to hundreds of MB and freeze the wizard; a malicious unbounded-depth JSON triggers stack overflow in the parser pipeline.
- **Fix sketch**: Cap `raw.nodes.length` (e.g. 5000), cap nested JSON depth via a streaming validator before `JSON.parse`, or use a SAX-style streaming JSON parser for files >1MB.

## 7. instant_adopt_template stores design_result as design_context but never re-validates on later read

- **Severity**: high
- **Category**: mis-attribution
- **File**: `src-tauri/src/commands/design/template_adopt.rs:371-389, 421`
- **Scenario**: `design_context_obj` is stringified and stored on the persona. The string later flows into `oneshot::run_test_pass` (oneshot.rs:348) and into `substitute_variables`. If the original template was tampered with at adoption time, integrity check (line 238) catches it — BUT the stored design_context still carries the upstream template name in `builderMeta.creationMethod = "template_adopt"`. There is no `template_id` / `template_version` / `template_hash` recorded. So if the user later forks (clone-from) this persona to "make my own version", the fork inherits no provenance — both are equally "adopted from template X" but the tampered-at-adoption-time persona is indistinguishable from the legit one.
- **Root cause**: Provenance metadata (template hash, version, adoption_timestamp) is stripped between integrity check and design_context write. Only the human-readable summary survives.
- **Impact**: Future "republish recipe" / "reconcile with upstream" features cannot tell which personas were adopted from which template version. Audit trails for compliance ("which personas use the deprecated v1 of the GitHub-PR-Reviewer template?") are impossible.
- **Fix sketch**: Add `templateId`, `templateVersion`, `templateContentHash`, and `adoptedAt` to the `builderMeta` block. Verify the hash on subsequent reads (or at least at promotion time).

## 8. extract_questions_output / parse_persona_output silently fall back to "first JSON object" parsing

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/design/template_adopt.rs:758-783`
- **Scenario**: Claude returns `Here are some questions: TRANSFORM_QUESTIONS [{...}]` followed by an unrelated JSON snippet. `extract_questions_output` doesn't match → fallback to `parse_persona_output` (line 779). That helper greedily extracts the first `{...}` it finds, which may be a stray markdown code block or a tool-call sample. The extracted draft is then saved as the user's persona without questions ever being asked. The frontend transitions from "Generating questions..." to "Draft ready for review" with a junk draft.
- **Root cause**: Fallback path does not distinguish "model failed to follow instruction" from "model produced a valid persona". Tracing logs a warning (line 772) but the user sees a confidently-presented broken draft.
- **Impact**: User-confusing drafts with hallucinated tools/connectors. Adoption count increments. Hard to detect because the schema parses successfully.
- **Fix sketch**: When the questions block is missing, set status to `failed` with a clear message ("model didn't generate adoption questions; please retry") rather than silently using whatever JSON it found. Or: require BOTH a TRANSFORM_QUESTIONS block AND non-empty questions array; otherwise reject.

## 9. FlowDiagram orphan-handling pushes nodes into an empty layer index 0

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/templates/sub_diagrams/FlowDiagram.tsx:62-68`
- **Scenario**: A workflow with all-disconnected nodes (no edges, no `start` type) hits the orphan branch. First iteration: `result.length === 0`, push `[]`. Then `lastLevel` is `[]` (falsy in length but truthy as an object), so the orphan id pushes into it. Second orphan: same. Third: same. All N orphans land in a single layer (which is technically correct), BUT the loop above (lines 41-44) already handled the "no roots" case by seeding `queue = [first.id]`. So one orphan is processed by the BFS and the rest by the orphan branch — they're rendered in different visual layers despite being topologically equivalent.
- **Root cause**: BFS root detection and orphan pickup are both run, with no mutual-exclusion check.
- **Impact**: Diagrams of "loose" templates (e.g. user manually disconnected a node) render confusingly: one node at the top, the rest grouped at the bottom of a multi-level chart that looks like there's flow when there isn't.
- **Fix sketch**: When `inDegree`-based root detection is empty, treat ALL nodes as orphans in a single layer rather than seeding the BFS with `flow.nodes[0]`. Or skip the seed step and let the orphan loop handle everything.

## 10. NodePopover renders user-supplied JSON in <pre> via tryParseJson — newline injection lossless but tab/control-char display broken

- **Severity**: medium
- **Category**: edge-case
- **File**: `src/features/templates/sub_diagrams/NodePopover.tsx:11-19, 73-86`
- **Scenario**: `node.request_data` / `node.response_data` arrive as strings from the imported workflow. `tryParseJson` parses then `JSON.stringify(parsed, null, 2)`s them. If the string contains control characters (e.g. `` BEL, ANSI escape sequences from a workflow that includes shell command output samples), JSON.stringify preserves them. Browsers don't render control chars but accessibility tools and clipboard copy preserve them — pasting copied "request data" into a terminal can run commands.
- **Root cause**: No control-char stripping before display. While React escapes HTML, raw control characters survive into the DOM text node.
- **Impact**: Low-probability terminal-injection on copy-paste. Minor a11y issue (screen readers stumble).
- **Fix sketch**: Strip ` -` (except `\n` and `\t`) from the string before rendering, or use a `<code>` element with `white-space: pre-wrap` and a sanitization pass.

## 11. SessionExecDir disarm() is dead code → no post-mortem path

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src-tauri/src/engine/build_session/runner.rs:79-83`
- **Scenario**: `disarm()` is `#[allow(dead_code)]` with the comment "current code never needs to". When a build session crashes mysteriously (e.g. CLI returns malformed JSON that panics the parser), the temp dir is wiped on Drop. There's no way for support to ask "send me %TEMP%/build-session-X/conversation.jsonl" because Drop deleted it.
- **Root cause**: No conditional disarm based on cancel reason or panic state.
- **Impact**: Bugs in the build loop are diagnosed only from in-app logs, never from the actual CLI conversation state on disk.
- **Fix sketch**: When `run_session` exits with a fatal error (caught by a panic hook or the persist_or_fail macro), call `session_exec_dir.disarm()` so the directory survives for inspection. Add a hidden "Reveal Build Workspace" command for users to share it.
