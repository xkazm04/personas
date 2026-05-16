# Tests

This folder holds the test-strategy playbook, test plans, scenarios, fixtures, and historical result captures.

## Strategy & workflow

| Doc | Read it when |
| --- | --- |
| [**coverage-strategy.md**](coverage-strategy.md) | Planning test coverage for a new feature, or extending coverage for an existing one. Covers the 0 → max progression (pure helpers → hooks → components → Playwright E2E) with code patterns and trade-offs at each layer. |
| [**parallel-cli-workflow.md**](parallel-cli-workflow.md) | Several CLI sessions are in flight at once and you need to know how to run your own tests (and possibly your own app) without stepping on the others. Covers Vitest's worktree isolation (parallel-safe today) and the partial multi-instance Tauri story via `PERSONAS_TEST_PORT`. |
| [`docs/development/test-automation.md`](../development/test-automation.md) | Architectural reference for the HTTP test-automation bridge and the MCP server. Read when authoring a new Playwright spec for a feature. |

## Test plans & scenarios

| Area | Docs |
| --- | --- |
| Regression plan | [regression-test-plan.md](regression-test-plan.md) |
| E2E agent lifecycle | [e2e-agent-lifecycle.md](e2e-agent-lifecycle.md) |
| Persona generation scenarios (Glyph + Template adoption + Recipe injection) | [template-adoption-scenarios.md](template-adoption-scenarios.md) |
| Matrix build scenarios | [test-matrix-build-scenarios.md](test-matrix-build-scenarios.md) |
| Vault credential creation | [vault-credential-creation.md](vault-credential-creation.md) |
| Render-plan fixtures | [fixtures/render-plan](fixtures/render-plan) |

Automation scripts live mostly in `tools/test-mcp` and `scripts`.

