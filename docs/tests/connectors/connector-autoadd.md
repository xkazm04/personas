# Connector Auto-add — MCP browser opens first site → auth gate

Proves that the vault **Catalog connections → Auto-add** flow launches the
MCP / Playwright browser automation for a non-desktop connector, navigates to
the connector's first proposed site, and reaches the login / auth gate. The
auth wall is the success state — the automation cannot (and must not) sign in.
Guards `docs/features/connections/README.md`.

## Preconditions

- **App:** `npm run tauri:dev:test` (bridge on `http://127.0.0.1:17320`;
  confirm `curl -s http://127.0.0.1:17320/health`).
- **Vault / data:** the built-in connector catalog (seeded from
  `scripts/connectors/builtin/*.json`). No credentials need pre-exist — the
  flow is exercised up to the auth wall, never completed.
- **Environment:** Claude CLI on PATH. Playwright MCP (`npx @playwright/mcp`)
  enables real browser mode; without it the flow falls back to **guided** mode,
  which still opens the connector's first site in the default browser. The
  harness records which mode it observed; both satisfy the scenario.
- **Isolation:** runs against the normal data dir on the main checkout (the
  app is a single-instance, data-dir singleton). See
  `../strategy/parallel-cli-workflow.md`.

## Steps

Each step is a bridge action via `data-testid`. All Auto-add test IDs were added
under `src/features/vault/sub_catalog/components/autoCred/`.

| # | Action | Expected |
|---|--------|----------|
| 1 | `navigate("credentials")` | Credential manager mounts |
| 2 | `click_testid("tab-from-template")` | Catalog grid (`catalog-connector-*` cards) |
| 3 | `click_testid("catalog-connector-<name>")` | Template form for that connector |
| 4 | `click_testid("vault-auto-add-btn")` | `vault-catalog-auto-setup` mounts |
| 5 | wait for `vault-autocred-start` | Consent screen (after optional AI analyze step) |
| 6 | `click_testid("vault-autocred-start")` | `vault-autocred-browser` mounts; CLI session spawns |
| 7 | observe | `vault-autocred-url` (a site opened) and/or `vault-autocred-waiting` (auth gate) |
| 8 | `click_testid("vault-autocred-cancel")` | Session cancelled, CLI subprocess killed |

### Test IDs this scenario relies on

`tab-from-template`, `tab-graph`, `catalog-connector-<name>`, `vault-auto-add-btn`,
`vault-catalog-auto-setup`, `vault-autocred-consent`, `vault-autocred-start`,
`vault-autocred-browser`, `vault-autocred-url`, `vault-autocred-waiting`,
`vault-autocred-error`, `vault-autocred-cancel`.

## Assertions (per connector)

The "truth" here is the live browser session's emitted progress (Tauri
`auto-cred-browser-progress` / `auto-cred-open-url` events, surfaced in the UI),
not a toast. Per connector the harness records:

- [ ] Browser session reached (`vault-autocred-browser` mounted).
- [ ] A first site was opened — a URL surfaced in `vault-autocred-url` or the
      browser log, **or** an auth gate (`vault-autocred-waiting` / a `WAITING:`
      line) was reached.
- [ ] No infra error (`cli_not_found`, `spawn_failed`, `env_conflict`).

## Pass / fail

- **Pass** — browser session launched and either reached the auth gate or
  opened the connector's first site (a login wall blocking credential
  extraction, e.g. `extraction_failed` / `timeout` *after* a URL, still passes —
  it proves the flow reached the service).
- **Partial** — browser ran but no clear site/gate signal within `--per-timeout`.
- **Skip** — connector absent, or it offers no Auto-add affordance (OAuth-only /
  MCP / desktop-bridge connectors hide it).
- **Hard-fail** — infra error (CLI missing, spawn failed, env conflict).

## Cleanup

Each connector's session is cancelled (`vault-autocred-cancel` → kills the CLI
subprocess and sweeps orphaned Chromium). No credentials are created. Nothing to
reset.

## Harness entrypoint

- **Driver:** `tools/test-mcp/e2e_connectors_autoadd.py`.
- **Command:** `uvx --with httpx python tools/test-mcp/e2e_connectors_autoadd.py`
  (subset) · `--connectors a,b,c` · `--all` · `--per-timeout S`.
- **Output:** stdout summary only (no run artifacts committed).
