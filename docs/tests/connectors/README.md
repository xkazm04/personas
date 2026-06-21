# Connectors — test docs

Scenario docs for the vault **Catalog connections** surface: the connector
catalog grid and the **Auto-add** (AI/Playwright browser) credential-setup flow.

| Doc | Proves |
|-----|--------|
| [connector-autoadd.md](connector-autoadd.md) | Clicking **Auto-add** on a non-desktop connector launches the MCP / Playwright browser session, opens the connector's first proposed site, and reaches the login / auth gate. |

## Harness

`tools/test-mcp/e2e_connectors_autoadd.py` — drives the live app through the
test-automation bridge (`:17320`) via `data-testid` only.

```bash
npm run tauri:dev:test                        # launch app + bridge
uvx --with httpx python tools/test-mcp/e2e_connectors_autoadd.py          # default subset (github, stripe, slack, linear)
uvx --with httpx python tools/test-mcp/e2e_connectors_autoadd.py --connectors notion,sentry
uvx --with httpx python tools/test-mcp/e2e_connectors_autoadd.py --all     # every non-desktop connector (slow, token-heavy)
```

> **Cost note.** Each connector spawns a real Claude CLI browser session (and,
> for connectors without cached setup steps, an extra AI "analyze" call). It
> opens a real Chromium window and spends API tokens. Prefer the default subset;
> use `--all` deliberately. `--per-timeout S` caps how long each connector's
> browser session is watched before the harness cancels it.

The harness never authenticates — reaching the auth wall is the pass condition.
