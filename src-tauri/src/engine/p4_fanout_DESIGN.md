# P4 — in-CLI Workflow/Task fan-out: design + Phase 0 findings

Co-located design for the future sub-agent fan-out feature. **Phase 0 (empirical
validation) is DONE** — the unknowns that gated Phases 2–3 are resolved with hard
data captured from a real `claude -p` Task fan-out (CLI 2.1.177, Opus 4.8, Max
account), mirroring personas' exact `build_cli_args` flag set.

## Why P4

Personas orchestrates multi-step work **externally** (N separate `claude -p`
processes, no shared context — see codebase-stack §2). The `Workflow`/`Task` tools
let ONE `claude -p` fan out internally, paying the system prompt **once** and
**sharing the prompt cache** across subagents. Prerequisite (P2 aggregate budget)
is shipped.

## Phase 0 findings (empirically captured)

### Availability (capability gate)
`system/init` exposes `tools` (40, incl **`Task`** + **`Workflow`** on Max) plus
`agents` (subagent types: `claude`, `Explore`, `general-purpose`, …), `skills`,
`mcp_servers`, `permissionMode`, `claude_code_version`. Personas' parser
(`parser.rs:39`) reads init for model/session_id/plugin_errors but **drops `tools`
+ `agents`** — Phase 1 captures these as the gate.

### Token-efficiency thesis — CONFIRMED
A 2-subagent Task fan-out's final `result.usage`:
`input_tokens=3877`, **`cache_read_input_tokens=43037`**, `cache_creation_input_tokens=6225`.
→ ~**92% of input served from cache** — subagents reused the cached system prompt,
exactly the P4 premise. (P1's cache-token capture surfaces this per-execution.)

### Budget bound — CONFIRMED
The process-level `result.total_cost_usd` ($0.28) **aggregates ALL subagent cost**.
So personas' per-execution `--max-budget-usd` (`prompt/cli_args.rs`) is the natural
ceiling for an in-CLI fan-out — no new budget primitive needed; **enabling fan-out
must require a `--max-budget-usd`**.

### Sub-agent event shape (the Phase 3 unknown — RESOLVED)
A Task fan-out emits these new event lines (beyond personas' current set):

```jsonc
// subagent launched
{ "type":"system", "subtype":"task_started",
  "task_id":"a036ce6…", "tool_use_id":"toolu_01Hx…",   // tool_use_id = PARENT Task call
  "description":"Reply ALPHA", "subagent_type":"claude", "task_type":"local_agent",
  "prompt":"…", "uuid":"…", "session_id":"…" }

// subagent progress / completion (carries PER-SUBAGENT usage)
{ "type":"system", "subtype":"task_notification",
  "task_id":"a036ce6…", "tool_use_id":"toolu_01Hx…", "status":"completed",
  "summary":"Reply ALPHA", "output_file":"",
  "usage":{ "total_tokens":14235, "tool_uses":0, "duration_ms":1598 } }
```

Plus **every** `assistant`/`user` message carries a top-level **`parent_tool_use_id`**
— `null` for the root agent, `= <Task tool_use_id>` for a subagent's messages. That
field is the linking key for attribution.

**Tree reconstruction:**
- `task_started` → a subagent node, parented to its `tool_use_id` (the Task call).
- `task_notification` → updates the node (status + `usage.total_tokens`/`duration_ms`).
- messages with `parent_tool_use_id == tool_use_id` → belong to that subagent.

## Phases

| Phase | Status | Notes |
|---|---|---|
| **0 — Empirical validation** | ✅ DONE | this doc |
| **1 — Capability gate** | ✅ DONE | `engine/cli_capabilities.rs` probes a bounded `claude -p` (mirrors `build_cli_args`), reads init `tools`+`agents` → `CliCapabilities{has_workflow,has_task,deep_fanout_available,…}` (cached); `probe_cli_capabilities` command. Phase 2 gates the persona capability on this. |
| **3 — Sub-agent observability** | ✅ DONE | parse `task_started`/`task_notification` + `parent_tool_use_id` → new `StreamLineType` variants + `StructuredExecutionEvent`s (the lockstep triplet: `types.rs` + `terminalEvents.ts` + `eventRegistry.ts` + `useStructuredStream.ts`) → render a fan-out tree in the execution inspector. Mirrors the P1/TodoWrite pattern. |
| **2 — Opt-in fan-out capability** | ✅ DONE (backend) | a persona param `deep_fanout` that (when enabled + Workflow/Task available) injects an `assemble_prompt` directive to delegate parallel sub-tasks via Task/Workflow; **requires** a `--max-budget-usd`; tier-gated. Do AFTER Phase 3 so fan-out isn't a black box. |

**Risk (unchanged):** trades Rust-side orchestration control (conditional nodes,
approval gates, per-node memory, `review_decision.*` chaining) for opaque in-CLI
fan-out; tier-gated (Max/Team). A **narrow opt-in** for fan-out-and-synthesize
persona shapes (research surveys, batch review, multi-source gather), not a general
re-architecture. Recommended order: 1 → 3 → 2 (observe before you enable).

## Reproduce the probe
```bash
printf 'Use the Task tool to launch 2 subagents in parallel …' | \
  env -u CLAUDECODE -u CLAUDE_CODE claude -p - --output-format stream-json --verbose \
  --dangerously-skip-permissions --exclude-dynamic-system-prompt-sections --effort medium \
  --max-turns 12 --max-budget-usd 0.80
```
Run in a non-repo dir (avoids local `.claude/settings.json` hook noise). Strip
`CLAUDECODE`/`CLAUDE_CODE` (as `build_cli_args` does) so the nested spawn isn't
detected as self-recursion.
