# Split Engine — Phase 1: remote HTTP inference (Qwen canary)

Status: **implemented (behind per-capability opt-in)** · 2026-06-22 · worktree `qwen-http-engine`

## Goal

Let a persona's **inference** run on a remote HTTP LLM provider (Qwen via the
DashScope OpenAI-compatible API) instead of spawning the local Claude CLI —
while **orchestration stays local** (Mode A event-chain + Mode B assignment DAG,
team memory, goals, reviewer/feedback edges are untouched). Qwen is the **first
provider (canary)** that validates an abstraction built to grow to OpenAI /
Gemini / etc.

Phase 1 is deliberately **text-only**: no tools, no MCP, no connector
credentials on the remote path (those execute as local child processes of the
Claude CLI — see `cli_mcp_config.rs`). The tool-execution bridge is a later
phase (it is in the long-term vision).

## Routing key: per-capability `provider`

Engine choice is **per capability** (the `DesignUseCase` seam). The effective
`ModelProfile` is already resolved per-capability in the runner: a capability's
`model_override: { "provider": "qwen", "model": "qwen3-coder-plus" }` flows into
`model_profile.provider` (runner/mod.rs:299-304). We route on that string.

**Why a string, not a new `EngineKind` variant:** `EngineKind` is `#[ts(export)]`
with an `assert_all_covered` compile guard; adding a variant forces ts-rs regen,
frontend `CliEngine` changes, and touches `resolve_provider`/`FromStr`/`as_setting`.
Routing on `model_profile.provider` (plain serde string) avoids all of it.

## The seam

`engine/runner/mod.rs`, immediately before the `'failover` CLI block
(~line 1319). At that point `prompt_text` (the fully assembled prompt, incl.
memory + human-feedback injection), `model_profile`, `tools`, `emitter`, `pool`,
`execution_id`, `cancelled`, `start_time` are all in scope:

```rust
if let Some(p) = model_profile.as_ref().and_then(|m| m.provider.as_deref()) {
    if http_engine::is_remote_http_provider(p) {
        return http_engine::run_http_execution(
            &*emitter, &pool, &execution_id, &persona,
            model_profile.as_ref().unwrap(), &prompt_text, &tools,
            &cancelled, start_time,
        ).await;
    }
}
```

Returning early skips the entire CLI failover/spawn/stream block and lands in
`handle_execution_result`, which persists the returned `ExecutionResult`
(status/cost/output/tokens/model). The HTTP path therefore **only emits live
events + returns the result** — it does NOT write terminal DB status itself
(avoids the status-flip zombie bug the runner warns about).

## Text-only guard (Phase 1)

`run_http_execution` fails fast if the persona/capability has tools:

> Remote provider 'qwen' is text-only in Phase 1; this capability uses tools.
> Assign it the Claude engine.

This is honest and safe: tool-using capabilities must stay on Claude until the
tool-bridge (Phase 3) exists.

## Config & secrets

- **base_url** (non-secret): setting `qwen_base_url`, filled into
  `model_profile.base_url` by `resolve_global_provider_settings`
  (runner/globals.rs). Default `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`.
- **model**: `model_profile.model` (per-capability), default `qwen3-coder-plus`.
- **API key** (secret): resolved in order — `model_profile.auth_token` →
  OS keyring (`personas-desktop` / `qwen-api-key`) → env `QWEN_API_KEY` /
  `DASHSCOPE_API_KEY`. The key reaches the provider (inherent); it is **not** a
  connector credential and is distinct from the local-first credential rule.
  > Data note: the **prompt content** also leaves to Qwen — a per-persona
  > data-residency choice. Tool/connector data stays local (text-only path).

## Provider abstraction (forward-looking)

`is_remote_http_provider` + `run_http_execution` are written so provider #2
(OpenAI/Gemini) is mostly a price-table + endpoint addition. The OpenAI-compatible
chat-completions + SSE shape already covers DashScope and OpenAI; Anthropic-style
(`/v1/messages`) would be a sibling parser. A capability descriptor + price
registry is the Phase 2 generalization.

## What this is NOT (later phases)

- **Phase 3 — tool bridge:** remote model emits a tool call → desktop executes
  locally via MCP/connectors → result fed back. Unlocks tool-using cloud
  personas (the n8n-like non-dev use case).
- **Phase 4 — cross-provider failover, per-capability routing UI, cost governance.**

## Files

- `engine/http_engine.rs` — the HTTP inference path (new).
- `engine/mod.rs` — `pub mod http_engine;`.
- `engine/runner/mod.rs` — the dispatch branch.
- `engine/types.rs` — `providers::QWEN`.
- `engine/runner/globals.rs` — Qwen arm in `resolve_global_provider_settings`.
- `db/settings_keys.rs` — `QWEN_BASE_URL` (+ allow-list).
