"""
Personas Build MCP Server

Exposes the persona-build session lifecycle as MCP tools so a Claude Code
client (or any MCP client) can drive a build end-to-end without going
through the Personas desktop UI.

Two modes
---------
**Production mode (default for shipped builds, recommended)**:
  - Talks to the always-on management HTTP server on
    `http://127.0.0.1:9420` (engine/webhook.rs:118).
  - Auth-gated by Bearer token — set `PERSONAS_API_KEY` to a key
    generated in Settings → API Keys.
  - Endpoint shape: `/api/build`, `/api/build/{id}`, etc.

**Test mode (dev only)**:
  - Talks to the test-automation HTTP server on `http://127.0.0.1:17320`
    (only present when the desktop app is built with
    `--features test-automation`, e.g. `npm run tauri:dev:test`).
  - No auth — endpoint set is unsafe-broad (DOM eval, click, etc.) and
    is gated off in shipped builds for that reason.
  - Endpoint shape: `/build/start`, `/build/{id}/status`, etc. (POST-only).

Mode selection: if `PERSONAS_API_KEY` is set, production mode is used.
Otherwise the client tries test mode. Override the base URL with
`PERSONAS_API_BASE` (production) or `PERSONAS_TEST_BASE` (test).

Usage
-----
  PERSONAS_API_KEY=pk_… python server.py    # production (Claude Code, etc.)
  python server.py                          # test mode (dev only)
  python server.py --check                  # connectivity probe
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
import mcp.types as types

# ── Mode + transport configuration ──────────────────────────────────────────

PROD_BASE = os.environ.get("PERSONAS_API_BASE", "http://127.0.0.1:9420")
TEST_BASE = os.environ.get("PERSONAS_TEST_BASE", "http://127.0.0.1:17320")
API_KEY = os.environ.get("PERSONAS_API_KEY")

# Mode is locked at startup. PRODUCTION_MODE means we hit the auth-gated
# management API; otherwise we fall back to the legacy test-automation
# endpoints (only useful with --features test-automation).
PRODUCTION_MODE = API_KEY is not None
BASE_URL = PROD_BASE if PRODUCTION_MODE else TEST_BASE
TIMEOUT = 60.0

server = Server("personas-build")

_headers: dict[str, str] = {}
if API_KEY:
    _headers["Authorization"] = f"Bearer {API_KEY}"

http = httpx.AsyncClient(base_url=BASE_URL, timeout=TIMEOUT, headers=_headers)


# ── HTTP helpers ────────────────────────────────────────────────────────────


def _connect_error_message() -> str:
    if PRODUCTION_MODE:
        return (
            f"Cannot reach Personas at {BASE_URL}. Start the desktop app — the "
            "management HTTP server is always-on once the app is running."
        )
    return (
        f"Cannot reach Personas test server at {BASE_URL}. Either set "
        "PERSONAS_API_KEY to use the production server (recommended), or "
        "start the app with `npm run tauri:dev:test` for unauthenticated "
        "test endpoints."
    )


async def _post(path: str, body: dict[str, Any]) -> str:
    """POST JSON to the build endpoint, return response text or a
    structured error string the LLM can read directly."""
    try:
        r = await http.post(path, json=body)
        r.raise_for_status()
        return r.text
    except httpx.ConnectError:
        return json.dumps({"success": False, "error": _connect_error_message()})
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            return json.dumps({
                "success": False,
                "error": (
                    "Authentication failed. Make sure PERSONAS_API_KEY is set "
                    "to a non-revoked key from Settings → API Keys."
                ),
            })
        return json.dumps({
            "success": False,
            "error": f"HTTP {e.response.status_code}: {e.response.text}",
        })
    except httpx.ReadTimeout:
        return json.dumps({
            "success": False,
            "error": (
                f"Timeout after {TIMEOUT}s on {path}. The CLI subprocess may "
                "still be running; poll the status endpoint to confirm."
            ),
        })


async def _get(path: str) -> str:
    try:
        r = await http.get(path)
        r.raise_for_status()
        return r.text
    except httpx.ConnectError:
        return json.dumps({"success": False, "error": _connect_error_message()})
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            return json.dumps({
                "success": False,
                "error": "Authentication failed — check PERSONAS_API_KEY.",
            })
        return json.dumps({
            "success": False,
            "error": f"HTTP {e.response.status_code}: {e.response.text}",
        })


# ── Bridge-method passthrough (for promote — uses a frontend bridge method) ─


async def _bridge_exec(method: str, params: dict[str, Any], timeout_secs: int = 90) -> str:
    """Dispatch a method through `/bridge-exec` to the JS bridge.

    Used for build_promote because the existing Tauri `promote_build_draft`
    command is wired through the bridge for refresh side effects (it calls
    `navigate` post-promote so the persona list re-renders). Going direct
    would skip that refresh; routing through the bridge keeps headless
    promotes consistent with UI promotes.
    """
    body = {"method": method, "params": params, "timeout_secs": timeout_secs}
    return await _post("/bridge-exec", body)


# ── Tool definitions ────────────────────────────────────────────────────────


TOOLS: list[types.Tool] = [
    types.Tool(
        name="health",
        description=(
            "Check whether the Personas test server is reachable. Returns "
            "`{status, server, version}` on success. Call this first when "
            "diagnosing connectivity issues — every other tool will fail "
            "with the same root cause."
        ),
        inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
    ),
    types.Tool(
        name="build_start",
        description=(
            "Start a new persona build session. Returns the session ID. "
            "The build runs asynchronously in the background — poll "
            "`build_status` to track progress.\n\n"
            "**Mode**: `\"interactive\"` (default) waits for clarifying "
            "questions you'll answer via `build_answer`. `\"one_shot\"` is "
            "autonomous: the LLM resolves every gate, retries test "
            "failures up to 3× via fix-passes, and auto-promotes on "
            "success. With one_shot you should ONLY poll `build_status` — "
            "do not call `build_answer` (no questions are emitted). "
            "Terminal phases for one_shot: `promoted` (success) or "
            "`failed` (after retries exhausted)."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "persona_id": {
                    "type": "string",
                    "description": (
                        "Pre-existing persona row to attach this build to. "
                        "Create one first via the personas API if you "
                        "don't already have a target."
                    ),
                },
                "intent": {
                    "type": "string",
                    "description": (
                        "Plain-English description of what the persona "
                        "should do. The LLM uses this to drive Phase A "
                        "(behavior_core) and Phase B (capabilities)."
                    ),
                },
                "mode": {
                    "type": "string",
                    "enum": ["interactive", "one_shot"],
                    "description": (
                        "`interactive` (default) emits clarifying questions; "
                        "`one_shot` decides every gate autonomously."
                    ),
                },
                "language": {
                    "type": "string",
                    "description": (
                        "ISO 639-1 code for human-facing strings in the "
                        "build output (descriptions, agent name). JSON "
                        "keys, connector names, and crons stay English."
                    ),
                },
                "companion_session_id": {
                    "type": "string",
                    "description": (
                        "Optional Companion chat session that originated "
                        "this build. When set, the BuildWatcher posts a "
                        "result message into that chat on terminal phase."
                    ),
                },
                "workflow_json": {
                    "type": "string",
                    "description": "Optional workflow import (n8n/etc.) JSON.",
                },
                "parser_result_json": {
                    "type": "string",
                    "description": "Optional pre-parsed AgentIR for import flow.",
                },
            },
            "required": ["persona_id", "intent"],
            "additionalProperties": False,
        },
    ),
    types.Tool(
        name="build_status",
        description=(
            "Read a build session's current state: phase, pending "
            "question (if interactive), resolved cells, mode, and "
            "whether it's reached a terminal phase. Poll this every "
            "few seconds while a build is in flight."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
            },
            "required": ["session_id"],
            "additionalProperties": False,
        },
    ),
    types.Tool(
        name="build_list_questions",
        description=(
            "Read only the pending clarifying question (if any) for an "
            "interactive build session. Returns `null` when no question "
            "is awaiting an answer (e.g. between turns, in one_shot "
            "mode, or after promotion)."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
            },
            "required": ["session_id"],
            "additionalProperties": False,
        },
    ),
    types.Tool(
        name="build_answer",
        description=(
            "Submit an answer to the currently-pending clarifying "
            "question on an interactive build session. The `cell_key` "
            "must match the pending question's scope/field (read it "
            "from `build_list_questions` first). Resumes the session "
            "asynchronously — poll `build_status` for the next state."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "cell_key": {
                    "type": "string",
                    "description": (
                        "Scope identifier for the question being answered. "
                        "For v3 capability questions: `mission`, "
                        "`capability:<id>`, `field:<capability_id>:<field>` "
                        "(e.g. `field:uc_morning_digest:connectors`), or "
                        "`connector_category:<id>:<category>`. The build "
                        "engine matches loosely — exact format depends on "
                        "the pending question's scope."
                    ),
                },
                "answer": {
                    "type": "string",
                    "description": "Free-text answer or selected option label.",
                },
            },
            "required": ["session_id", "cell_key", "answer"],
            "additionalProperties": False,
        },
    ),
    types.Tool(
        name="build_test",
        description=(
            "Run the pre-promote tool tests on a session that has reached "
            "`draft_ready`. Each tool defined in agent_ir is invoked "
            "against its real API with resolved credentials. Returns a "
            "structured report (`tools_passed`, `tools_failed`, per-tool "
            "results, summary). On failure the session phase reverts to "
            "`draft_ready` so you can call `build_promote` only after "
            "you've confirmed the tests pass — or call `build_test` "
            "again after correcting the IR."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "persona_id": {"type": "string"},
            },
            "required": ["session_id", "persona_id"],
            "additionalProperties": False,
        },
    ),
    types.Tool(
        name="build_promote",
        description=(
            "Promote a tested build draft to a real persona. Creates the "
            "tool definitions, triggers, event subscriptions, and "
            "design_context records the editor surfaces expect. Only "
            "valid after `build_test` reports `tools_failed: 0` (or "
            "after a one_shot build auto-promotes itself)."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "persona_id": {"type": "string"},
                "excluded_use_case_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Capability IDs to drop from the promote (LLM-emitted "
                        "Structured-variant IDs, NOT post-promote UUIDs). "
                        "Optional; default empty = promote everything."
                    ),
                },
            },
            "required": ["session_id", "persona_id"],
            "additionalProperties": False,
        },
    ),
    types.Tool(
        name="build_cancel",
        description=(
            "Cancel an in-progress build session. Kills the CLI subprocess, "
            "marks the session `cancelled`, and frees the slot in the "
            "session manager. Idempotent — safe to call on a session "
            "already in a terminal phase."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
            },
            "required": ["session_id"],
            "additionalProperties": False,
        },
    ),
]


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return TOOLS


@server.call_tool()
async def call_tool(
    name: str, arguments: dict[str, Any] | None
) -> list[types.TextContent]:
    args = arguments or {}

    if name == "health":
        result = await _get("/health")
    elif name == "build_start":
        body: dict[str, Any] = {
            "persona_id": args["persona_id"],
            "intent": args["intent"],
        }
        for opt in (
            "mode",
            "language",
            "companion_session_id",
            "workflow_json",
            "parser_result_json",
        ):
            if opt in args and args[opt] is not None:
                body[opt] = args[opt]
        result = await _post("/api/build" if PRODUCTION_MODE else "/build/start", body)
    elif name == "build_status":
        sid = args["session_id"]
        if PRODUCTION_MODE:
            result = await _get(f"/api/build/{sid}")
        else:
            result = await _post("/build/status", {"session_id": sid})
    elif name == "build_list_questions":
        sid = args["session_id"]
        if PRODUCTION_MODE:
            result = await _get(f"/api/build/{sid}/pending")
        else:
            result = await _post("/build/list-questions", {"session_id": sid})
    elif name == "build_answer":
        sid = args["session_id"]
        if PRODUCTION_MODE:
            result = await _post(
                f"/api/build/{sid}/answer",
                {"cell_key": args["cell_key"], "answer": args["answer"]},
            )
        else:
            result = await _post(
                "/build/answer",
                {"session_id": sid, "cell_key": args["cell_key"], "answer": args["answer"]},
            )
    elif name == "build_test":
        sid = args["session_id"]
        if PRODUCTION_MODE:
            result = await _post(
                f"/api/build/{sid}/test",
                {"persona_id": args["persona_id"]},
            )
        else:
            result = await _post(
                "/build/test",
                {"session_id": sid, "persona_id": args["persona_id"]},
            )
    elif name == "build_promote":
        sid = args["session_id"]
        if PRODUCTION_MODE:
            body = {"persona_id": args["persona_id"]}
            if "excluded_use_case_ids" in args:
                body["excluded_use_case_ids"] = args["excluded_use_case_ids"]
            result = await _post(f"/api/build/{sid}/promote", body)
        else:
            # Test mode: route through the JS bridge so the persona list
            # refreshes after the row lands.
            body = {"session_id": sid, "persona_id": args["persona_id"]}
            if "excluded_use_case_ids" in args:
                body["excluded_use_case_ids"] = args["excluded_use_case_ids"]
            result = await _post("/promote-build", body)
    elif name == "build_cancel":
        sid = args["session_id"]
        if PRODUCTION_MODE:
            result = await _post(f"/api/build/{sid}/cancel", {})
        else:
            result = await _post("/build/cancel", {"session_id": sid})
    else:
        result = json.dumps({"success": False, "error": f"Unknown tool: {name}"})

    return [types.TextContent(type="text", text=result)]


async def main() -> None:
    if "--check" in sys.argv:
        r = await _get("/health")
        print(r)
        return

    async with stdio_server() as (read, write):
        await server.run(
            read,
            write,
            server.create_initialization_options(),
        )


if __name__ == "__main__":
    asyncio.run(main())
