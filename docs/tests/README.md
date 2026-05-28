# Tests — documentation hub

The single entry point for how this project is tested. Test **docs** live here;
the **code** that runs them lives under `tools/`, `scripts/`, `tests/`, and
`src/` — the [code index](#code-index) below maps each doc area to its harness.

> Authoring a new scenario doc? Start from
> [`_templates/scenario-template.md`](_templates/scenario-template.md) — it's the
> canonical shape so every E2E doc reads the same way.

## Where things live

| Folder | What's in it | Read it when |
|--------|--------------|--------------|
| [`strategy/`](strategy/) | The testing philosophy + cross-cutting workflow: the 0→max coverage progression, parallel-CLI test isolation, the test-DB submodule. | Planning coverage for a feature, or running tests alongside other CLI sessions. |
| [`e2e/`](e2e/) | Concrete end-to-end scenario + regression plans (agent lifecycle, resilience, vault credentials, template adoption, build matrix). | Writing or running a full user-flow regression. |
| [`autonomy-eval/`](autonomy-eval/) | The **Team Autonomy Evaluation Framework** — a separate workstream that runs persona teams and scores production-quality output. Has its own rubric, run protocol, seed bank, and a golden sample run. | Working on team-autonomy measurement, not day-to-day feature tests. |
| [`athena/`](athena/) | The Athena chat **quality suite** — conversational regression with hard assertions + an LLM judge. | After any change to Athena's prompt, constitution, dispatcher, or doctrine. |
| [`fixtures/`](fixtures/) | Shared, version-controlled test inputs (render-plan fixtures, the large use-case catalog). | You need a stable input set instead of inventing one. |
| [`_templates/`](_templates/) | The scenario-doc template. | Before writing any new scenario doc. |

## Strategy & workflow

| Doc | Read it when |
|-----|--------------|
| [strategy/coverage-strategy.md](strategy/coverage-strategy.md) | Planning coverage for a feature — the layered progression from pure helpers → hooks → components → Playwright E2E, with patterns and trade-offs per layer. |
| [strategy/parallel-cli-workflow.md](strategy/parallel-cli-workflow.md) | Several CLI sessions are running and you need to test without stepping on them (Vitest worktree isolation; the partial multi-instance Tauri story via `PERSONAS_TEST_PORT`). |
| [strategy/test-database-submodule.md](strategy/test-database-submodule.md) | Working on DB introspection / schema test fixtures. |
| [`../development/test-automation.md`](../development/test-automation.md) | Architectural reference for the HTTP test-automation bridge + MCP server (tool list, `data-testid` inventory). Read before authoring a bridge-driven spec. |

## Code index

Docs describe intent; these are the runnable harnesses.

| Doc area | Harness (code) | Run |
|----------|----------------|-----|
| `strategy/coverage-strategy` (unit/component layer) | Vitest specs `src/**/*.test.ts` | `npm run test` |
| `e2e/*` scenarios | Python MCP harnesses `tools/test-mcp/*.py` + Playwright specs `tests/playwright/` | `uvx --with httpx python tools/test-mcp/<file>.py` |
| `e2e/template-adoption-*` | `tests/playwright/template-marathon-*` (driver + spec + fixtures) | `node tests/playwright/template-marathon-driver.mjs --golden` |
| Athena guided walkthrough E2E ([feature doc](../features/companion/athena-guided-walkthroughs.md) §E2E) | `tests/playwright/athena-guided-walkthrough.spec.ts` | `npm run test:playwright:guidance` |
| `autonomy-eval/*` | Node autonomy harness `scripts/test/*.mjs` (run / gather / evaluate / health-lint / judge-packet) | per [`autonomy-eval/run-protocol.md`](autonomy-eval/run-protocol.md) |
| `athena/*` | `tools/test-mcp/athena_quality_suite.py` (pass 1 driver + pass 2 aggregator) | see [`athena/README.md`](athena/README.md) |
| bridge plumbing all of the above ride on | `src/test/automation/bridge.ts` ↔ `tools/test-mcp/server.py` | `npm run tauri:dev:test` (bridge on `:17320`) |

## Run artifacts

Run output is **not** committed (it's large and non-deterministic). Each suite
keeps a local-only output dir gitignored next to its docs:
`autonomy-eval/runs/` (one golden `_example-run/` is kept), `athena/results/`,
and the scratch `results/` dir (root-gitignored). Don't commit run dumps.
