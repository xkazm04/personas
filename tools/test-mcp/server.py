"""
Personas Test Automation MCP Server

Bridges Claude Code (via MCP protocol) to the Personas Tauri app's
test automation HTTP server (localhost:17320).

Usage:
  python server.py              # stdio transport (for Claude Code)
  python server.py --check      # health check only
"""
import asyncio
import json
import sys
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
import mcp.types as types

BASE_URL = "http://127.0.0.1:17320"
TIMEOUT = 20.0

server = Server("personas-test")
http = httpx.AsyncClient(base_url=BASE_URL, timeout=TIMEOUT)


async def _post(path: str, body: dict[str, Any]) -> str:
    """POST JSON to the test automation server, return response text."""
    try:
        r = await http.post(path, json=body)
        r.raise_for_status()
        return r.text
    except httpx.ConnectError:
        return json.dumps({"error": "Cannot connect to Personas test server on port 17320. Is the app running with test-automation feature?"})
    except httpx.HTTPStatusError as e:
        return json.dumps({"error": f"HTTP {e.response.status_code}: {e.response.text}"})


async def _get(path: str) -> str:
    """GET from the test automation server, return response text."""
    try:
        r = await http.get(path)
        r.raise_for_status()
        return r.text
    except httpx.ConnectError:
        return json.dumps({"error": "Cannot connect to Personas test server on port 17320. Is the app running with test-automation feature?"})
    except httpx.HTTPStatusError as e:
        return json.dumps({"error": f"HTTP {e.response.status_code}: {e.response.text}"})


# ── Tool definitions ─────────────────────────────────────────────────────────

TOOLS = [
    types.Tool(
        name="navigate",
        description=(
            "Navigate the Personas app to a specific section. "
            "Valid sections: home, overview, personas, events, credentials, "
            "design-reviews, team, cloud, settings, dev-tools"
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "section": {
                    "type": "string",
                    "enum": [
                        "home", "overview", "personas", "events", "credentials",
                        "design-reviews", "team", "cloud", "settings", "dev-tools",
                    ],
                    "description": "The app section to navigate to",
                },
            },
            "required": ["section"],
        },
    ),
    types.Tool(
        name="click",
        description=(
            "Click an element in the Personas app by CSS selector. "
            "Supports standard selectors, data-testid attributes, etc. "
            "Example: button, [data-testid='save-btn'], .my-class"
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "selector": {
                    "type": "string",
                    "description": "CSS selector of the element to click",
                },
            },
            "required": ["selector"],
        },
    ),
    types.Tool(
        name="type_text",
        description=(
            "Type text into an input or textarea element by CSS selector. "
            "Works with React controlled components."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "selector": {
                    "type": "string",
                    "description": "CSS selector of the input element",
                },
                "text": {
                    "type": "string",
                    "description": "Text to type into the element",
                },
            },
            "required": ["selector", "text"],
        },
    ),
    types.Tool(
        name="query",
        description=(
            "Query DOM elements by CSS selector. Returns tag, text content, "
            "visibility, bounding rect, testId, and class for each match."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "selector": {
                    "type": "string",
                    "description": "CSS selector to query",
                },
            },
            "required": ["selector"],
        },
    ),
    types.Tool(
        name="find_text",
        description=(
            "Find elements containing specific text content. "
            "Returns matching elements with their selectors for subsequent interaction."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "Text to search for in the DOM",
                },
            },
            "required": ["text"],
        },
    ),
    types.Tool(
        name="get_state",
        description=(
            "Get the current application state: active section, selected persona, "
            "persona count, loading state, errors, and tab states."
        ),
        inputSchema={
            "type": "object",
            "properties": {},
        },
    ),
    types.Tool(
        name="wait_for",
        description=(
            "Wait for an element matching a CSS selector to appear and become visible. "
            "Polls every 100ms up to the timeout. Useful after navigation or async operations."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "selector": {
                    "type": "string",
                    "description": "CSS selector to wait for",
                },
                "timeout_ms": {
                    "type": "integer",
                    "description": "Maximum wait time in milliseconds (default: 5000)",
                    "default": 5000,
                },
            },
            "required": ["selector"],
        },
    ),
    types.Tool(
        name="list_interactive",
        description=(
            "List all visible interactive elements (buttons, links, inputs, tabs, "
            "menu items) in the current view. Returns text, aria-label, testId, "
            "selector, and disabled state for each."
        ),
        inputSchema={
            "type": "object",
            "properties": {},
        },
    ),
    types.Tool(
        name="eval_js",
        description=(
            "Execute arbitrary JavaScript in the Personas app WebView. "
            "Fire-and-forget — does not return the JS result. "
            "Use for side effects like scrolling, toggling debug flags, etc."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "js": {
                    "type": "string",
                    "description": "JavaScript code to execute",
                },
            },
            "required": ["js"],
        },
    ),
    types.Tool(
        name="health",
        description="Check if the Personas test automation server is running and responsive.",
        inputSchema={
            "type": "object",
            "properties": {},
        },
    ),
    # ── Workflow macros ──────────────────────────────────────────────────
    types.Tool(
        name="select_agent",
        description=(
            "Select an agent by name (partial match) or ID. "
            "Opens the agent in the editor. Example: select_agent('Email') matches 'Email Labeler'."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "name_or_id": {
                    "type": "string",
                    "description": "Agent name (partial match) or UUID",
                },
            },
            "required": ["name_or_id"],
        },
    ),
    types.Tool(
        name="open_editor_tab",
        description=(
            "Switch to a specific editor tab for the currently selected agent. "
            "Valid tabs: use-cases, prompt, lab, connectors, chat, design, health, settings"
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "tab": {
                    "type": "string",
                    "enum": ["use-cases", "prompt", "lab", "connectors", "chat", "design", "health", "settings"],
                },
            },
            "required": ["tab"],
        },
    ),
    types.Tool(
        name="start_create_agent",
        description=(
            "Start the agent creation flow. Opens the build wizard with intent input. "
            "After calling this, use fill_field('agent-intent-input', '...') then click_testid('agent-launch-btn')."
        ),
        inputSchema={"type": "object", "properties": {}},
    ),
    types.Tool(
        name="snapshot",
        description=(
            "Get a semantic snapshot of the current view: route, selected agent, "
            "visible modals, toasts, errors, form fields with values, page title. "
            "Use this instead of screenshots for understanding what the user sees."
        ),
        inputSchema={"type": "object", "properties": {}},
    ),
    types.Tool(
        name="agent_cards",
        description="Get structured info about all visible agent cards (name, testId, visibility).",
        inputSchema={"type": "object", "properties": {}},
    ),
    types.Tool(
        name="fill_field",
        description=(
            "Fill a form field by its data-testid. Works with React controlled components. "
            "Common fields: agent-name, agent-description, agent-intent-input, agent-search, credential-search"
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "test_id": {"type": "string", "description": "data-testid of the input field"},
                "value": {"type": "string", "description": "Text to fill"},
            },
            "required": ["test_id", "value"],
        },
    ),
    types.Tool(
        name="click_testid",
        description=(
            "Click an element by its data-testid attribute. "
            "Common testids: create-agent-btn, agent-launch-btn, agent-cancel-btn, "
            "agent-delete-btn, agent-delete-confirm, sidebar-personas, sidebar-settings, "
            "editor-tab-settings, editor-tab-prompt, ctx-duplicate, ctx-delete"
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "test_id": {"type": "string", "description": "data-testid value"},
            },
            "required": ["test_id"],
        },
    ),
    types.Tool(
        name="search_agents",
        description="Search/filter agents by typing into the agent search bar.",
        inputSchema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query text"},
            },
            "required": ["query"],
        },
    ),
    types.Tool(
        name="open_settings_tab",
        description=(
            "Navigate to settings and open a specific tab. "
            "Valid tabs: account, appearance, notifications, engine, byom, portability, network, admin"
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "tab": {
                    "type": "string",
                    "enum": ["account", "appearance", "notifications", "engine", "byom", "portability", "network", "admin"],
                },
            },
            "required": ["tab"],
        },
    ),
    types.Tool(
        name="wait_toast",
        description="Wait for a toast/notification containing specific text to appear.",
        inputSchema={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Text to find in toast"},
                "timeout_ms": {"type": "integer", "default": 5000},
            },
            "required": ["text"],
        },
    ),
    types.Tool(
        name="answer_question",
        description=(
            "Answer a build question during agent creation. Opens the question popover "
            "and clicks the option at the given index (0-based). The cellKey parameter is "
            "informational — the method clicks whichever answer button is currently visible."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "cell_key": {"type": "string", "description": "Cell key (e.g., 'use-cases', 'triggers')"},
                "option_index": {"type": "integer", "description": "0-based option index to select"},
            },
            "required": ["cell_key", "option_index"],
        },
    ),
    types.Tool(
        name="delete_agent",
        description=(
            "Delete an agent by name (partial match) or ID. Handles both regular agents "
            "and draft agents (cleans up build state). Returns success/failure."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "name_or_id": {"type": "string", "description": "Agent name (partial match) or UUID"},
            },
            "required": ["name_or_id"],
        },
    ),
]


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return TOOLS


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any] | None) -> list[types.TextContent]:
    arguments = arguments or {}

    if name == "navigate":
        result = await _post("/navigate", {"section": arguments["section"]})
    elif name == "click":
        result = await _post("/click", {"selector": arguments["selector"]})
    elif name == "type_text":
        result = await _post("/type", {
            "selector": arguments["selector"],
            "text": arguments["text"],
        })
    elif name == "query":
        result = await _post("/query", {"selector": arguments["selector"]})
    elif name == "find_text":
        result = await _post("/find-text", {"text": arguments["text"]})
    elif name == "get_state":
        result = await _get("/state")
    elif name == "wait_for":
        result = await _post("/wait", {
            "selector": arguments["selector"],
            "timeout_ms": arguments.get("timeout_ms", 5000),
        })
    elif name == "list_interactive":
        result = await _get("/list-interactive")
    elif name == "eval_js":
        result = await _post("/eval", {"js": arguments["js"]})
    elif name == "health":
        result = await _get("/health")
    # Workflow macros
    elif name == "select_agent":
        result = await _post("/select-agent", {"name_or_id": arguments["name_or_id"]})
    elif name == "open_editor_tab":
        result = await _post("/open-editor-tab", {"tab": arguments["tab"]})
    elif name == "start_create_agent":
        result = await _post("/start-create-agent", {})
    elif name == "snapshot":
        result = await _get("/snapshot")
    elif name == "agent_cards":
        result = await _get("/agent-cards")
    elif name == "fill_field":
        result = await _post("/fill-field", {
            "test_id": arguments["test_id"],
            "value": arguments["value"],
        })
    elif name == "click_testid":
        result = await _post("/click-testid", {"test_id": arguments["test_id"]})
    elif name == "search_agents":
        result = await _post("/search-agents", {"query": arguments["query"]})
    elif name == "open_settings_tab":
        result = await _post("/open-settings-tab", {"tab": arguments["tab"]})
    elif name == "wait_toast":
        result = await _post("/wait-toast", {
            "text": arguments["text"],
            "timeout_ms": arguments.get("timeout_ms", 5000),
        })
    elif name == "answer_question":
        result = await _post("/answer-question", {
            "cell_key": arguments["cell_key"],
            "option_index": arguments["option_index"],
        })
    elif name == "delete_agent":
        result = await _post("/delete-agent", {"name_or_id": arguments["name_or_id"]})
    else:
        result = json.dumps({"error": f"Unknown tool: {name}"})

    return [types.TextContent(type="text", text=result)]


async def main():
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
