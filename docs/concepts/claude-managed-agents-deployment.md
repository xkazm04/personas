# Claude Managed Agents as a deployment target

**Status:** Design (2026-06-10). **Spike fully verified live** — all three risks (secret isolation, host-side credential pattern, MCP wiring) green; see [Spike results](#spike-results).
**Owner direction:** add a third `DeployTarget` (`'claude'`) backed by Anthropic's Claude Managed Agents (CMA) API, positioned as the zero-infrastructure cloud deployment default. The existing self-hosted orchestrator (`cloud`) and GitLab targets stay.

---

## 1. Why

Today's "Cloud" target requires the user (or us) to host and operate the personas-cloud orchestrator: a server, a SQLite DB with a `MASTER_KEY`, Smee relays, workers shelling out to Claude CLI. GitLab deployment delegates hosting to GitLab but loses the execution feedback loop entirely (no history, no pause, no budgets).

Claude Managed Agents is an Anthropic-hosted agent runtime (beta header `managed-agents-2026-04-01`, enabled by default for API accounts) with a fully programmatic REST surface:

- **Agent** (`POST /v1/agents`) — persisted, versioned config: model + system prompt + tools + MCP servers + skills. Maps ~1:1 onto what `cloud_deploy_persona` already packages.
- **Environment** (`POST /v1/environments`) — sandbox template (Anthropic cloud container, or self-hosted worker).
- **Session** (`POST /v1/sessions`) — one run: per-session container, SSE event stream, send/receive events, mid-run steer/interrupt.

Everything the desktop needs — create, version, run, observe, archive — is plain REST with an API key. No server to operate, no credential master-key custody, no webhook relay.

Alternatives evaluated and rejected as the primary target (June 2026 research):

| Option | Verdict |
| --- | --- |
| **Claude Code Routines** (claude.ai scheduled cloud agents) | Right shape, wrong door: creation is web-UI / interactive `/schedule` only. Only *firing* an existing routine is API-able (`POST /v1/claude_code/routines/{id}/fire`, one-time bearer token). Cannot be automated by a third-party app. Possible later as a semi-manual "power user" integration. |
| **Claude Code on the web** (`claude --remote`) | Interactive, GitHub-repo-centric sessions; no REST API; wrong shape for autonomous personas. |
| **Agent SDK self-hosting** (containers/Bedrock/Vertex) | That's what personas-cloud already is. Doesn't remove the infra burden. |

## 2. Trade-offs vs the orchestrator target (be honest in UI copy)

| Concern | Orchestrator (`cloud`) | CMA (`claude`) |
| --- | --- | --- |
| Infra to operate | A server you host | None |
| Billing | Anthropic **subscription** token via OAuth (`has_claude_token`) — burns the user's Max plan | **API credits**, metered per token. Requires a funded Console account |
| Data custody | Your server, your SQLite | Session history + state persisted at Anthropic (no ZDR/HIPAA). Needs a disclosure note given our local-first positioning |
| Always-on schedules | Yes (server is up 24/7) | Sessions are fired by the caller — desktop must be running (same constraint as local execution today). See §6 |
| Credential injection | `CONNECTOR_*` env vars on workers | **No container env vars.** MCP vaults + host-side custom tools only (§5) |
| Execution feedback | Polling REST | SSE event stream with typed events, per-request token usage, steer/interrupt |

Positioning: CMA is the default for users who want cloud execution without running anything; the orchestrator remains for subscription-token billing and full data custody.

## 3. Concept mapping

| Personas Desktop | Claude Managed Agents |
| --- | --- |
| Persona (assembled prompt, model_profile, timeouts) | **Agent** — `system` = output of `engine::prompt::assemble_prompt`, `model` = model_profile, `name`/`description` verbatim |
| Persona version / redeploy | **Agent version** — `POST /v1/agents/{id}` creates an immutable version; sessions pin `{id, version}`. Maps cleanly onto `persona_versions` + `deployment_history` |
| Deployment record | Local row + stored `agent_id` + `version` + `environment_id` (new `claude_agent_deployments` table) |
| Execution | **Session** — one session per run; `title` = execution label; result mapped into the existing `persona_executions` row shape |
| Execution trace | **SSE events** (`agent.message`, `agent.tool_use`, `span.model_request_*`) → `execution_traces` |
| Protocol messages (`user_message`, `emit_event`, `agent_memory`, `manual_review`) | **Custom tools** (§4) — typed tool calls instead of stdout marker parsing. Strictly better than the CLI path |
| Connector tools | Host-side **custom tools** (desktop executes with vault creds) or **MCP servers + Anthropic vaults** (§5) |
| Persona long-term memory / Brain | **Memory store** attached as a session resource (`/mnt/memory/...`), or keep host-side via the `agent_memory` custom tool initially |
| Budget caps (`max_monthly_budget_usd`) | Enforced **locally**: accumulate `span.model_request_end.model_usage` per session into execution cost; refuse to create sessions past the cap (§7) |
| Pause / resume deployment | Local flag (don't create sessions). CMA has no pause concept; archive = permanent, never use it for pause |

### The protocol upgrade

The orchestrator/CLI path makes personas emit magic markers in stdout (`user_message`, `DIRECTOR_VERDICT`, …) that we regex out. On CMA, each protocol message becomes a **declared custom tool** with a JSON schema. The agent calls `emit_user_message{title, body}`; the session goes idle; the desktop's event loop executes the protocol action (persist message, fire event bus, open manual review) and replies `user.custom_tool_result`. Typed, validated, no marker parsing, and the desktop is in the loop *during* the run, not after.

## 4. Architecture

```
Desktop (Rust)                                Anthropic
─────────────                                 ─────────
commands/infrastructure/claude_agents.rs
  claude_deploy_persona ───────────────────▶  POST /v1/agents (create or update→new version)
                                              POST /v1/environments (once per workspace, reused)
  claude_execute_persona ──────────────────▶  POST /v1/sessions {agent:{id,version}, environment_id}
                                              POST /v1/sessions/{id}/events  (kickoff user.message)
engine: claude_session_runner (tokio task)
  ◀── SSE /v1/sessions/{id}/events/stream ──  agent.message / tool_use / span.* / status_*
  ├─ agent.custom_tool_use("github_api", …) → execute with vault credential → user.custom_tool_result
  ├─ agent.custom_tool_use("emit_user_message", …) → protocol bridge → event bus
  ├─ span.model_request_end.model_usage → cost accumulation → budget check
  └─ session.status_idle(end_turn) → finalize persona_executions row, archive session
```

Key loop rules (verified against SDK client patterns):

- **Stream-first, then send** the kickoff — the stream has no replay.
- Reconnect = re-open stream + `GET /events` + dedupe by event id (SSE has no replay; a dropped stream while a custom tool is pending deadlocks the session otherwise).
- Break only on `status_terminated` or `status_idle` with `stop_reason.type != "requires_action"`; `requires_action` means *we* owe a tool result **or a tool confirmation**.
- **MCP tool calls arrive with `evaluated_permission: "ask"` by default** (observed live, spike v3): the session idles on `requires_action` with `stop_reason.event_ids` pointing at the MCP tool-use until the client sends `user.tool_confirmation {tool_use_id, result: "allow"|"deny"}`. Without handling this, the session hangs indefinitely — spike v1/v2 stalled exactly here. This is also the natural hook for per-persona tool-approval policies (auto-allow for trusted connectors, surface-to-user for sensitive ones); `permission_policy: {type: "always_allow"}` on the `mcp_toolset` config should remove the prompt for trusted servers.
- Post-idle status-write race: poll `sessions.retrieve` until `status != running` before archive.
- One environment per workspace, created lazily and reused — environments are rate-limited to 60 RPM / 5 concurrent ops org-wide; sessions are 300 RPM create. Never create environments per run.

### Module plan (per CLAUDE.md "Adding a New Integration")

1. `src-tauri/src/claude_agents/` — `mod.rs`, `client.rs` (reqwest + `eventsource-stream` for SSE), `config.rs` (API key via keyring, service `"personas-desktop"`; **must** keep `windows-native`/`apple-native` keyring features), `types.rs` (`#[derive(TS)] #[ts(export)]`, camelCase serde).
2. `src-tauri/src/commands/infrastructure/claude_agents.rs` — `claude_set_api_key`, `claude_status`, `claude_deploy_persona`, `claude_undeploy_persona` (archive agent — confirm-gated, it's permanent), `claude_execute_persona`, `claude_list_deployments`, `claude_get_execution_output`.
3. DB migration: `claude_agent_deployments(persona_id, agent_id, agent_version, environment_id, status, invocation_count, last_invoked_at, current_month_cost_usd, budget_month, created_at)`.
4. `AppError::ClaudeAgents` variant; engine module `claude_session_runner.rs` mirroring `cloud::runner`.
5. Frontend: `src/api/system/claudeAgents.ts`, `stores/slices/system/claudeAgentsSlice.ts`, `DeployTarget` union gains `'claude'` (`deploymentTypes.ts:9`) + `mapClaudeStatus`, `UnifiedDeploymentDashboard` merges the third source, deploy panel alongside `CloudDeployPanel` (reuse shared components; i18n keys under a new `claude_deploy` section).
6. Bindings regen (`cargo test export_bindings`), command names codegen, catalog/docs/onboarding/marketing per the Stop-hook map (new `feature-doc-map.json` entry → `docs/features/deployment` area).

## 5. Credentials & security model

Hard constraint verified in docs: **there is no way to set environment variables in the CMA cloud sandbox, and vaults hold MCP credentials only.** The orchestrator's `CONNECTOR_*` env-var pattern does not port. Three sanctioned paths:

1. **Host-side custom tools (default, ships first).** Every connector tool a persona owns is declared on the agent as a `custom` tool (we already have `input_schema` per tool in `persona_tool_definitions`). When the agent calls it, the **desktop** executes the real API call with the decrypted vault credential and returns the result. The credential never leaves the machine — this is *stronger* custody than the orchestrator (which stores AES-encrypted copies server-side) and is Anthropic's documented pattern for non-MCP secrets. Cost: desktop must stay online for the run (already true — it drives the SSE loop).
2. **MCP servers + Anthropic vaults (Phase 4).** For services with hosted MCP servers (GitHub, Linear, Notion, Asana…), declare `mcp_servers` on the agent and sync the credential into an Anthropic vault (`POST /v1/vaults/{id}/credentials`, OAuth shape with refresh block; write-only, auto-refreshed, injected by Anthropic-side proxy — never enters the sandbox). Note: hosted MCP servers want **OAuth tokens**, not native API keys; only connectors where we hold OAuth tokens qualify.
3. **GitHub repos** via the `github_repository` session resource — PAT injected by Anthropic's git proxy, unreadable from inside the sandbox.

Never put secrets in `system` or `user.message` — event history is durably persisted and readable via the API.

Sandbox/egress: environments support `networking: {type: "limited", allowed_hosts: [...], allow_package_managers, allow_mcp_servers}`. Default our environment to `limited` with `allow_mcp_servers: true` and no extra hosts — personas reach external services through custom tools (host-side) anyway, so the sandbox needs almost no egress. That's a materially tighter posture than orchestrator workers.

Privacy disclosure (UI copy on the deploy panel): "Runs on Anthropic's cloud. Session transcripts and working files are stored by Anthropic for the life of the session." Archive sessions after finalizing executions to bound retention.

## 6. Scheduling

CMA has no cron. The desktop's existing trigger/scheduler engine remains the source of schedule truth and fires `claude_execute_persona` exactly as it fires local executions today. Consequences:

- Schedules only fire while the desktop runs — **same** as local execution, **worse** than the orchestrator. Say so in the deploy panel.
- Hybrid guidance: users needing 24/7 keep the orchestrator target; CMA covers "cloud-quality execution without infrastructure" not "always-on".
- Future option (not in scope): Anthropic webhooks (`session.status_*`) are Console-registered and need a public HTTPS endpoint — a possible personas-web relay later; SSE suffices now.

## 7. Cost & budgets

- Per-request usage arrives on `span.model_request_end.model_usage` (`input_tokens`, `output_tokens`, `cache_*`); session totals on `sessions.retrieve().usage`. Both verified present in the spike (zeros, since inference was billing-blocked).
- Desktop computes cost from the model price table (already maintained for local executions), persists per-execution, rolls up into `current_month_cost_usd`/`budget_month` (same columns as cloud deployments), and refuses `sessions.create` once `max_monthly_budget_usd` is hit.
- `max_turns`/`timeout_ms`: enforce with a wall-clock deadline in the session runner + `user.interrupt` (jumps the queue, forces idle) — CMA has no per-session token cap of its own.

## 8. Rollout phases

| Phase | Scope | Exit criterion |
| --- | --- | --- |
| 0 | **Spike completion** (account top-up): sandbox secret probe, custom-tool round trip, live MCP call, usage events | All three risks observed live; `tmp/cma-spike/spike.mjs` re-run green |
| 1 | Rust client + config (keyring) + `claude_status` + deploy/undeploy (agents CRUD, env bootstrap) + Settings key entry | Deploy a persona from the UI; agent visible in Console |
| 2 | Session runner: execute, SSE→traces, protocol custom tools (`emit_user_message`, `emit_event`, `agent_memory`, `manual_review`), execution rows + output | A deployed persona runs end-to-end from the agent player with full trace |
| 3 | Trigger/scheduler wiring, budget caps, third target in `UnifiedDeploymentDashboard`, connector custom tools w/ host-side credentials | Scheduled persona fires on CMA; budget cap blocks over-spend |
| 4 | MCP + Anthropic vault sync for OAuth connectors; memory stores for Brain; docs/onboarding/marketing surfaces | GitHub persona uses hosted MCP with vaulted OAuth |

## 9. Open questions

1. **Tier gating** — Builder tier only? CMA needs the user's own funded API account, so the marginal cost to us is zero; gating is product positioning.
2. **API key UX** — reuse `external_api_keys.rs` storage or the connector/credential catalog? Leaning external_api_keys (it's an app-level key, not a persona connector).
3. **Self-hosted sandbox** (`config:{type:"self_hosted"}`) — would let tool execution run on the user's machine with Anthropic only orchestrating; interesting privacy middle-ground, but the worker helpers are Python/TS/Go only (no Rust) — would mean shipping the `ant` CLI worker or a Node sidecar. Defer.
4. **Beta risk** — `managed-agents-2026-04-01` is beta; shapes can change. Pin SDK-equivalent behavior behind our own `client.rs` and version the header in one place.

## Spike results

Spike artifacts: `tmp/cma-spike/` (gitignored), `spike.mjs` re-runnable. Final run 2026-06-10 (session `sesn_01QBQXxD2B7Pqj5VSWYN7jZy`) against the live API with a real persona payload (*PR Security Guardian*, claude-sonnet-4-6, structured prompt + tools from the app DB). End-to-end: **~50 s, 4 model requests, $0.052** (estimated from accumulated `model_usage`; matched `session.usage` exactly).

| Risk | Result |
| --- | --- |
| Control plane (env/agent/session CRUD, SSE, archive/delete cleanup) | ✅ all green across 3 runs |
| **(a) Secret isolation** — agent ran `env \| sort` in its sandbox | ✅ zero credential-shaped vars; only `IS_SANDBOX=yes` marker. Nothing to leak |
| **(a) Host-side credential pattern** — custom tool `github_list_open_prs` | ✅ full round-trip: `agent.custom_tool_use` → idle `requires_action` naming the event → `user.custom_tool_result` from host → agent resumed and summarized. Credential never left the desktop |
| **(b) MCP wiring** — DeepWiki `ask_question` | ✅ succeeded **after** `user.tool_confirmation(allow)` — MCP calls default to `evaluated_permission: "ask"`; unhandled, the session hangs (cost spike v1/v2 their runs). Runner must implement the confirmation loop |
| **(c) Usage/cost** — `span.model_request_end.model_usage` + `sessions.retrieve().usage` | ✅ per-request tokens incl. cache creation/read; accumulated total matched API session totals exactly — budget caps enforceable locally |
| Billing-failure shape (run 1, unfunded account) | ✅ surfaced as `session.error {type: billing_error}` + `status_idle(retries_exhausted)` — maps directly to deployment `failed` |
