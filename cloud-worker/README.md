# Personas Cloud Worker (Path A — proof of concept)

A minimal, zero-dependency HTTP server that implements the **same contract the
desktop app already speaks** (`src-tauri/src/cloud/client.rs`), but runs
inference on **Qwen cloud** (Alibaba Model Studio / DashScope) instead of
Claude.

It exists to answer one question cheaply: **can we deploy a persona from the
desktop, have it run remotely on a Qwen engine, and report the result back —
safely?** If yes, the sophisticated pipeline (teams, tools, sandboxing) is worth
building. If no, we throw the idea off the table having spent ~150 lines.

## Why this is the right first probe

- **No credentials, no tools.** The test persona just tells a joke — a single
  LLM text turn. There's no shell, no filesystem, no MCP, nothing that can reach
  back to your machine. The only secret involved is *this worker's* DashScope
  key, which lives only on the worker side.
- **Outbound-only / pull-based.** The desktop never opens a listening port. It
  makes outbound HTTPS calls and polls for the result (`cloud/runner.rs`). The
  cloud cannot initiate a connection to your computer at all.
- **Zero desktop changes.** The app ships a complete cloud client already. You
  use it exactly as-is and just point it at this worker.

Sandboxing (Firecracker/E2B/gVisor) only becomes necessary when the cloud agent
gets *tools*. The joke deliberately stays on the safe side of that line.

## Quick start — mock mode (no API key, proves the transport spine)

```bash
cd cloud-worker
npm start              # or: node server.mjs
```

With no `DASHSCOPE_API_KEY` set it runs in **MOCK** mode: `/api/execute` returns
a canned joke instead of calling Qwen. This validates the full
desktop ↔ worker round-trip with zero external dependencies.

Then, in the desktop app:

1. Go to the **Cloud** deployment tab → Connect.
2. URL = `http://localhost:8080` (the app allows `http` for localhost only),
   API key = anything non-empty.
3. Create a persona named e.g. *Comedian* with system prompt
   *"You are a comedian. Tell one short, clean programming joke, then stop."*
   and **no tools / no connectors**.
4. Deploy it, then run it.
5. The joke streams into the normal execution view, with a cost + duration
   stamped on the row — identical to a local run.

## Connection methods (verified against qwencloud.com docs, June 2026)

"Qwen Cloud" (`qwencloud.com`) is the current portal; DashScope is still the API
plane underneath. This worker uses the **pay-as-you-go OpenAI-compatible** path,
which is what the qwencloud.com quickstart documents:

- OpenAI-compatible: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (this worker)
- Anthropic-compatible (`/v1/messages`): `https://dashscope-intl.aliyuncs.com/apps/anthropic`
- Coding-Plan subscription (CLIs only — Claude Code/qwen-code, **not** custom
  backends): `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic`

Get a general `sk-...` key at <https://home.qwencloud.com/api-keys>. (The
`sk-sp-...` Coding Plan key is for interactive CLIs, not this server.)

## Switch to real Qwen

Get a general `sk-...` API key from <https://home.qwencloud.com/api-keys>, then:

```bash
# PowerShell
$env:DASHSCOPE_API_KEY="sk-..."; npm start
# Bash
DASHSCOPE_API_KEY=sk-... npm start
```

Now `/api/execute` calls the DashScope OpenAI-compatible endpoint. Defaults:
international (Singapore) base URL, model `qwen3-coder-plus`. Override via
`QWEN_BASE_URL` / `QWEN_MODEL` (see `.env.example`).

## Deploy remotely (cross-internet proof)

`http://` is localhost-only; for a remote host the app requires **HTTPS**. Put
this server behind any HTTPS host (Fly.io, Render, Deno Deploy, a reverse proxy,
Alibaba Function Compute, …) and reconnect with the `https://…` URL. Same code.

## The contract it implements

| Endpoint | Returns | Desktop caller |
| --- | --- | --- |
| `GET /health` | `{status:"ok"}` | `cloud_connect` reachability |
| `GET /api/status` | worker counts / queue (camelCase) | status panel |
| `POST /api/personas` | `200` (body ignored) | deploy upsert |
| `POST /api/deployments` | a `CloudDeployment` | deploy |
| `GET /api/deployments` | `[CloudDeployment]` | dashboard list |
| `POST /api/execute` | `{executionId,status}` | run |
| `GET /api/executions/:id` | poll: `output[]`, `status`, `totalCostUsd`, … | poll loop |
| `POST /api/executions/:id/cancel` | `200` | cancel button |
| `GET /api/executions` | history list | history panel |
| `POST/DELETE /api/deployments/:id[/pause\|/resume]` | lifecycle | dashboard actions |

**Terminal status semantics** (`cloud/runner.rs:175`): `completed` = success;
`failed`/`cancelled`/`error` = failure; anything else = keep polling. `output`
is a growing string array the desktop diffs against `totalOutputLines`.

## Headless mode (create → deploy → run, no GUI)

The desktop's `create_persona` / `cloud_deploy_persona` are auth-gated Tauri IPC
commands — not callable without the running app. So the **headless** persona
lifecycle lives here, on the worker (which is the model-agnostic execution home
anyway). `headless.mjs` drives the whole loop over the worker API:

```bash
npm start                                   # terminal 1: the worker
node headless.mjs --engine qwen             # terminal 2: create → deploy → run → verify
node headless.mjs --engine claude           # same, via the Anthropic protocol
node headless.mjs --instruction "Write a haiku about Rust"
```

It POSTs `/api/personas` (create), `/api/deployments` (deploy), `/api/execute`
(run — **omitting `prompt`**, so the worker self-assembles from the persona's
`systemPrompt`), then polls to completion and prints output + cost + model.
Exit 0 on success / 1 on failure (CI- and loop-friendly).

## Engine wrapper (Claude / Qwen behind one interface)

A persona carries the desktop's `ModelProfile`
(`{ provider, model, base_url, auth_token }`). The worker routes on `provider`:

| `provider` | Protocol | Default endpoint |
| --- | --- | --- |
| `qwen` / `dashscope` / *(default)* | OpenAI chat-completions | `…/compatible-mode/v1` |
| `claude` / `anthropic` | Anthropic Messages (`/v1/messages`) | `api.anthropic.com` (or Qwen's `…/apps/anthropic`) |

This is the same `modelProfile` field the desktop already uploads on deploy
(`cloud.rs:868`) — so a desktop-created persona with `provider: "qwen"` flows
through this wrapper unchanged. The Anthropic path runs against **real Claude or
Qwen-via-Anthropic-compat** by base_url alone. Both paths are verified live on
Qwen (see below). Keys never travel from the caller — the worker supplies them
from its own env; `auth_token` in the profile is an optional override.

## Two-persona chain (`chain.mjs`)

Sequential cooperation A → B: A's output is forwarded as B's input, and **each
persona runs on its own engine/model** (mix per step — "any capacity"). Mirrors
the desktop's sequential `persona_team_connections` edge + Mode-A handoff, run in
the worker so it's headless.

```bash
npm start
node chain.mjs                          # Comedian (qwen3-coder-plus) -> Critic (qwen3.7-plus)
node chain.mjs --topic "recursion"
node chain.mjs --engineB claude         # B via the Anthropic protocol
```

Endpoints: `POST /api/chains` (define steps) · `POST /api/chains/:id/execute`
(run, `{input}`) · `GET /api/chain-executions/:id` (poll per-step + final).
On a step failure the remaining steps **cascade-skip** and the chain fails.

Verified live on Qwen: Comedian drafts a joke (~2s, qwen3-coder-plus), Critic
rates + rewrites it (qwen3.7-plus). Note: reasoning models (qwen3.7-plus) are
much slower and latency **compounds across a chain** — tier models per step
(fast for drafts, deep only where it pays).

## Go / no-go

- ✅ **Green** = the joke appears in the desktop execution stream, sourced from
  Qwen, cost/duration written back. The whole spine (deploy → execute → Qwen →
  report-back) works; remaining questions (teams, tools+sandbox, credentials)
  are the ones worth investing in.
- ❌ **Red** fails in exactly one place — connect / execute / poll — each cheap
  to diagnose against the table above.

## Out of scope (deliberately)

- **Teams.** Single persona only. Team orchestration is still local-only Rust.
- **Tools & sandboxing.** Arrives exactly when the cloud agent needs to *do*
  something; that's when the credential decision re-enters.
- **Webhooks / triggers / OAuth / reviews / marketplace.** Not needed for the
  round-trip proof.

This is a PoC: in-memory state (jobs/deployments are lost on restart),
accept-any-Bearer auth, non-streaming inference. Production-hardening is a later
step gated on the go/no-go above.
