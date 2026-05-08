# Personas Build MCP Server

MCP server that exposes the persona-build session lifecycle as tools any
MCP client (Claude Code, Claude Desktop, custom clients, headless e2e
drivers) can call.

The same Tauri commands the in-app Companion uses are surfaced over a
stdio MCP transport — your client gets the build flow without needing
the Personas desktop UI to be open.

## What it gives you

- `health` — connectivity check.
- `build_start` — start a session (`interactive` or `one_shot`).
- `build_status` — read phase + pending question + resolved cells.
- `build_list_questions` — read just the pending clarifying question.
- `build_answer` — submit an answer (interactive mode only).
- `build_test` — run pre-promote tool tests.
- `build_promote` — promote a tested draft to a real persona.
- `build_cancel` — terminate a running session.

## Two modes

### Production mode (recommended for shipped builds)

The Personas desktop app runs an always-on management HTTP server on
`http://127.0.0.1:9420` (defined in `engine/webhook.rs`). It's
auth-gated by Bearer tokens managed in **Settings → API Keys**.

1. Open Personas. Settings → API Keys → **New key**. Pick the
   `personas:build` scope. Copy the plaintext token (shown once).
2. Set `PERSONAS_API_KEY` to that token before launching the MCP server.
3. The MCP server hits `/api/build/*` with `Authorization: Bearer …`.

This is the path for Claude Desktop, third-party clients, scripts —
anything you'd normally consider "external".

### Test mode (dev only — no auth)

If `PERSONAS_API_KEY` is **not** set, the MCP server falls back to the
test-automation HTTP server on `http://127.0.0.1:17320`. That server
only exists when the desktop app is built with
`--features test-automation` (e.g. `npm run tauri:dev:test`) — it's
gated off in shipped builds because it also exposes broad surfaces
(DOM eval, click, etc.).

This mode is convenient for local e2e drivers; **never** rely on it for
external clients.

## Install

```bash
cd tools/build-mcp
pip install -r requirements.txt
```

## Run

```bash
# Production mode (set the key from Settings → API Keys)
PERSONAS_API_KEY=pp_xxxx python server.py

# Test mode — only useful with `npm run tauri:dev:test`
python server.py

# Health-check only
python server.py --check
```

## Wire into Claude Desktop / Claude Code

Add to your MCP config (`~/.claude/mcp.json` or per-project equivalent).
The "Created key" dialog in Settings → API Keys generates this snippet
with your token pre-substituted — copy it from there.

```json
{
  "mcpServers": {
    "personas-build": {
      "command": "python",
      "args": ["/absolute/path/to/personas/tools/build-mcp/server.py"],
      "env": {
        "PERSONAS_API_KEY": "pp_<your-token>",
        "PERSONAS_API_BASE": "http://127.0.0.1:9420"
      }
    }
  }
}
```

## Environment variables

| Variable             | Default                     | Purpose                                                 |
|----------------------|-----------------------------|---------------------------------------------------------|
| `PERSONAS_API_KEY`   | (unset → test mode)         | Bearer token. Setting this enables production mode.     |
| `PERSONAS_API_BASE`  | `http://127.0.0.1:9420`     | Production base URL. Override for non-default ports.    |
| `PERSONAS_TEST_BASE` | `http://127.0.0.1:17320`    | Test-automation base URL (only used when no API key).   |

## Typical interactive build flow (production mode)

```python
sid = build_start(persona_id="abc", intent="…", mode="interactive")
while True:
    status = build_status(session_id=sid)
    if status["is_terminal"] or status["phase"] == "draft_ready":
        break
    if status["pending_question"]:
        cell_key = derive_cell_key(status["pending_question"])
        answer = decide_answer(status["pending_question"])
        build_answer(session_id=sid, cell_key=cell_key, answer=answer)
    sleep(2)

report = build_test(session_id=sid, persona_id="abc")
if report["report"]["tools_failed"] == 0:
    build_promote(session_id=sid, persona_id="abc")
```

## One-shot flow

```python
sid = build_start(persona_id="abc", intent="…", mode="one_shot")
while True:
    status = build_status(session_id=sid)
    if status["is_terminal"]:
        break
    sleep(3)

# status["phase"] is now "promoted" or "failed".
# On failure, status["error_message"] carries the short label;
# the persona's `last_test_report` carries the per-tool detail of
# the final attempt.
```

## Security model

- Plaintext keys leave the backend exactly **once**, on creation. We
  store SHA-256 only.
- Revoking a key from Settings → API Keys takes effect on the next
  request (auth lookup is per-request, no cache).
- Server binds `127.0.0.1` only — no LAN exposure. Tunnelling via SSH
  or wireguard is on the user; the Personas auth model assumes the
  attacker can already reach localhost.
- The `health` endpoint is the only unauthenticated route.

## Endpoint reference (production mode)

All routes require `Authorization: Bearer <PERSONAS_API_KEY>` except
`/health`.

| Method | Path                                | Body / params                              |
|--------|-------------------------------------|--------------------------------------------|
| GET    | `/health`                           | —                                          |
| POST   | `/api/build`                        | `{persona_id, intent, mode?, …}`           |
| GET    | `/api/build/{session_id}`           | —                                          |
| GET    | `/api/build/{session_id}/pending`   | —                                          |
| POST   | `/api/build/{session_id}/answer`    | `{cell_key, answer}`                       |
| POST   | `/api/build/{session_id}/test`      | `{persona_id}`                             |
| POST   | `/api/build/{session_id}/promote`   | `{persona_id, excluded_use_case_ids?}`     |
| POST   | `/api/build/{session_id}/cancel`    | —                                          |
