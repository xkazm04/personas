# Browser control — web-app control for Athena and other agents

> Design record for the `browser-control` spark (2026-09-15). The buildable brief
> lives in the operator's Spark vault; this file is the part that outlives the
> build: what was migrated from `athena-portable`, what was rewritten, and when an
> agent should be told to use which browser.

## 1. Why this exists

Athena and the personas already act through connectors, CLIs and MCP servers. The
work a freelancer or a small studio actually has is inside web apps nobody wrote
an API for: an invoicing tool, a bank portal, a CRM, a support inbox. The
`athena-portable` hackathon build proved the pattern (the apps are the agent's
environment, not its plug-ins). This arc brings that capability into Personas
with Personas' own vault, approvals inbox, styling and companion, instead of a
second daemon, brain and UI beside them.

Two premises the scouting inverted before a line was written:

- **Personas already had an origin gate.** `src-tauri/src/browser_bridge/` is an
  MCP endpoint (`POST /browser-bridge/mcp`, per-session token) with a WebSocket
  relay to a companion Chrome extension and a Playwright fallback, exposing the
  `browser_*` tools. It pinned one origin per browser-test session. The
  Whitelist is the persistent, multi-origin generalisation of that slot, not a
  new subsystem.
- **The embedded page host needed one Cargo flag, not a new window model.**
  `athena-portable` embeds page webviews in its window through Tauri's `unstable`
  feature (multi-webview, `WebviewBuilder` + `add_child`). Personas opened remote
  URLs only in a detached OAuth window. The flag is now on, scoped to
  `browser_bridge/webview/`.

## 2. The shape

```
                      ┌──────────────── policy (Rust, browser_bridge) ───────────────┐
 Athena op ──┐        │ whitelist rows · tighten-only overrides · budget · tab lease  │
 fleet CLI ──┼─MCP──▶ │ effect class: read = auto · write = companion_approval (orb)  │
 persona  ───┘        └───────────────┬───────────────────┬───────────────┬──────────┘
                                      ▼                   ▼               ▼
                              embedded webview     Chrome extension    Playwright
                              (in-app, WP2)        (relay, Phase 1)    (fallback)
```

One vocabulary: the `browser_*` MCP tools. Three backends behind it. Policy runs
before any backend and never inside one; the module doctrine that already stood
at `browser_bridge/mod.rs` ("the extension is hands and eyes; the bridge is the
gate") now covers all three.

| Surface | What it is |
|---|---|
| **Browser > Whitelist** | The origin gate. Deny-by-default rows: `enabled`, per-tool overrides that may only tighten a class to GATED, a per-turn call budget, an optional vault credential, and the result of an LLM controllability scan (tier 0 read-only / 1 generic hands / 2 the page's own WebMCP tools) filed as `proposed` until the operator confirms. |
| **Browser > Webview** | The embedded multi-webview host the operator and agents share. Address bar and tabs for the operator; a per-tab lease with a visible badge while an agent acts. |
| **Orb** | Every write (click, type, select, submit, page tool call, login) is a `companion_approval` row with a screenshot, decided on the orb. Reads and navigation to a whitelisted origin auto-fire. Same gate for Athena, fleet sessions and personas. |

Agents that want a page off the list are refused with an error naming the
Whitelist, and may file one `browser_request_site` approval: agents unblock
themselves through the operator, never around them. Personas reach the tools by
binding the builtin `browser` connector; the runner then appends the bridge MCP
config with a scoped session token, so access is visible on the persona's
Connectors tab and has an off switch.

## 3. What was migrated from athena-portable, what was rewritten, what was dropped

Measured against `C:\Users\kazda\kiro\athena-portable` (32,601 LOC: 14,098 Python
under `src/athena`, 6,205 Rust + injected JS in `apps/desktop/src-tauri`, 7,176
TS in `apps/desktop/src`, 1,499 in `packages/athena-bridge`).

### Ported near-verbatim (self-contained, no daemon coupling)

| Source | LOC | Lands in | Note |
|---|---|---|---|
| `src-tauri/src/layout.rs` + `tabs.rs` | 650 | `browser_bridge/webview/{layout,tabs}.rs` | Multi-webview-per-window with Rust-owned rects; one shared `data_directory` profile; `on_navigation` keeps the tab record current. The cleanest implementation of this anywhere in reach. |
| `src-tauri/src/bridge.rs` | 631 | `browser_bridge/webview/relay` | Nonce + oneshot pending map between the shell and page JS; two namespaces so page tools and hands never double-answer. |
| `src-tauri/src/hands.rs` + `hands.js` | 1,306 | `browser_bridge/webview/hands.*` | Nine generic hands. Refs are minted `ref_<generation>_<hex>` and the generation bumps on navigation so a stale ref fails as `unknown_ref` instead of clicking whatever now holds that slot. This is the registry's references-over-selectors technique, already built. |
| `packages/athena-bridge/inject.js` | 318 | `browser_bridge/webview/inject.js` | WebMCP detection (native `document.modelContext` or polyfill), meta-tag page identity, everything untrusted. A page that froze its globals reads as "zero tools". |
| `packages/athena-bridge/gate.js` (class derivation) | ~120 of 378 | Rust `policy.rs` | `AUTO` iff `reversible && side_effects != external`, else `GATED`; overrides may tighten, never loosen (`refused_loosening`). Re-typed in Rust rather than run as JS, because policy belongs in the process the operator trusts. |
| `src-tauri/src/capture.rs` | 371 | `browser_bridge/webview/capture.rs` | Win32 `PrintWindow` crop of the page rect. Windows-only; other platforms answer `unsupported_platform` rather than pretending. |
| `store.rs` `origins` table | schema only | `browser_sites` migration | `enabled DEFAULT 0` deny-by-default is kept; the row grows the override/budget/credential/scan columns. |

### Re-implemented as policy (Python -> Rust, ~1,800 -> ~1,200 LOC)

`contracts/` (ToolClass, HostManifest, "a host tool has no executor"),
`core/catalog.py` (whole-or-nothing origin merge), `harness/policy.py` (rules as
data, first refusal wins), the approvals replay (`describe`/`matches` on
canonical JSON, expiry checked at resolve), and the ledger row. These are pure
policy with no Python-specific value; Personas' backend is Rust and its approvals
table already exists, so they were re-expressed there and merged into
`companion_approval` + `fleet_decisions` instead of adding a table.

### Replaced by what Personas already has

| athena-portable | Personas equivalent | Why not port |
|---|---|---|
| Python daemon (`daemon/`, 1,954 LOC; token-checked HTTP + SSE) | Tauri commands + the shared `local_http` axum server | A second local server with its own token is exactly the duplication this arc removes. The SSE event vocabulary survives as event names. |
| CLI harness (`harness/cli_harness.py`, 949 LOC) | Fleet headless spawn + the companion's own turn runner | Personas already drives `claude` sessions with `--mcp-config`; only the `engines.probe()` idea (never raises, existence-only login signal) is worth remembering. |
| Connector vault (`connectors/`, 1,809 LOC; DPAPI seals) | The credential vault + `browser_automation` connector category | Personas' vault is AES-256-GCM with rotation, OAuth refresh and env injection; a second seal format would be a regression. The one idea kept: a connector merges into the gate exactly like a page (`connector:<id>` origin, same class derivation). |
| Brain (`core/brain/`, `recall.py`, ~1,400 LOC) | The companion brain (episodes, sleep-cycle consolidation) | Parallel implementation of the same idea. Two rules kept: provenance at write, and per-block honest truncation `(showing N of M)`. |
| Panel / connectors / setup modules (React) | Personas styling, `BrowserBridgePanel`, the orb | The layouts are ordinary; the models are daemon-shaped. |
| Voice channel | Athena's existing voice I/O | Independent of the browser arc. |

### Genuinely novel, carried over as doctrine

- **The lane holds no executor for a host tool.** The model proposes, the gate
  decides, the surface executes. In Personas this is the split between the
  approval executor and the backend.
- **Host-state delta frame, nonce-fenced.** Only what changed since the last
  finished turn rides in the user message; nothing that can move is composed
  into the system prompt. Applied to how open tabs and their origins reach a
  turn.
- **A closed refusal vocabulary with a mandatory hint.** Every refusal names the
  next command. An error the agent cannot act on without a human is a defect in
  the tool (`browser_bridge/backend.rs::RefusalCode`).
- **Honest truncation everywhere.** Snapshots and reads are capped and say so.

### Dropped

The OP-line grammar with its closed three-repair set (only needed for CLIs with
no tool-call API), the `layered-ui-formula` and camera contract (design law for
the demo apps, not the shell), and the WebMCP-first catalog merge (real sites
rarely register WebMCP today; page tools are reachable through two generic
tools, `browser_page_tools` and `browser_call_page_tool`, without becoming
first-class catalog entries).

## 4. Three browsers, one instruction

An agent working with Personas can meet three different browsers. They are not
interchangeable, and the instruction an operator or a skill gives should name
which one.

| | **Embedded Webview** (Browser > Webview) | **Chrome extension** (browser bridge relay) | **`claude-in-chrome`** (Claude Code's own MCP extension) |
|---|---|---|---|
| Who can use it | Athena, fleet CLI sessions, personas with the `browser` connector | The same callers, when the extension is paired | Only an interactive Claude Code session on the operator's machine. Zero references in this repo; not reachable from Fleet or persona runs. |
| Where the page lives | Inside the Personas window, its own browsing profile, shared with the operator | The operator's real Chrome, real cookies and logins | The operator's real Chrome, driven through the session's harness |
| Gate | Whitelist + orb approval per write, budget, tab lease | Same gate, same vocabulary | The harness's own per-site permission prompt; Personas' Whitelist does not apply |
| Naming elements | Minted refs, generation-scoped; stale refs fail loudly | Playwright-style snapshot refs from the extension | Its own `read_page` / `find` references and coordinate clicks |
| Audit | `companion_approval` + `fleet_decisions`, screenshot per write | Same | The session transcript only |
| Best for | Unattended or semi-attended work on known apps: the invoicing chase, the CRM update, anything that should be repeatable and gated | Work that needs the operator's real logged-in Chrome (SSO, MFA already done, extensions installed) and the operator is present | The operator pairing with Claude Code live: exploratory QA of a UI, reproducing a bug, reading a page while coding |

**How to instruct:**

- Say **"use the Personas browser"** (or nothing: it is the default for Athena and
  personas) when the site is on the Whitelist, the work should be gated and
  audited, and it may run without the operator watching.
- Say **"use my Chrome"** when the task depends on the operator's real session in
  Chrome and the extension is paired; the same gate applies and the operator is
  expected to be present.
- Say **"use the Chrome tool"** only inside an interactive Claude Code session,
  for the developer's own exploratory browsing. It is a developer's tool, not a
  product surface: no Whitelist, no orb, no persona can reach it, and nothing it
  does lands in the Personas audit trail.

The wrong pairing to avoid: instructing a persona or a skill dispatched through
Fleet to "use the Chrome extension tools" from the Claude Code harness. Those
sessions never see that server; the instruction fails silently as a tool the
model cannot find.

## 5. Standards consulted

`agent-browser-control` (references over selectors, effect-classed commands,
persistent daemon, agent-actionable errors, socket-scoped surface),
`hitl-approval` (consent gates, gate state machines, decision records;
unattended mode deliberately deferred to a per-origin autonomy dial in v2),
`browser-credential-boundary` (the broker attaches the secret: `browser_login`
is executed by Rust and the model never sees a value), `extension-trust-boundary`.

## 6. Deferred, on purpose

Per-origin autonomy dial (`writes: ask | auto-reversible | auto`), Chrome cookie
or session import into the embedded profile, non-Windows screenshots, WebMCP
tools as first-class catalog entries, changes to the Playwright fallback.
