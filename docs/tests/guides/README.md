# Guide tests (`docs/tests/guides/`)

Reusable harness for testing **guided flows** — onboarding tours, how-to guides,
documented pipelines — against the **live desktop app, from the UI**. A guide
test walks the same surfaces a guided tour rings and asserts each step's action
point is reachable + present, proving the whole flow is achievable and flagging
any missing/broken step. Because it asserts the same `data-testid`s a tour
targets, the tour and the test keep each other honest.

This is **surface-reachability** testing — it navigates to each stage and checks
the action point exists; it does **not** complete actions that trigger native
dialogs or minutes-long LLM work (folder pickers, codebase scans, real agent
runs). That makes it fast, deterministic, and CI-friendly.

## How it works

`guidekit/` is a thin layer over the existing test-automation client in
[`tools/test-mcp/lib`](../../../tools/test-mcp/lib) (the port-17320 server
exposed by `npm run tauri:dev:test`). You write a guide as **data**:

```python
from guidekit import Guide, Stage, navigate, click, plugin_tab, settle, run_and_save

GUIDE = Guide(
    name="My flow",
    description="...",
    stages=[
        Stage(
            "Step 1 · do a thing",
            reach=[navigate("teams"), settle(300), click("teams-kpis-nav")],
            assert_present=["kpi-scan-button"],   # the action point that must exist
            notes="optional caveat (e.g. needs a project selected)",
        ),
        # ...
    ],
)

if __name__ == "__main__":
    run_and_save(GUIDE, "my-flow")   # preflight → run → print → save JSON
```

### Vocabulary

| Helper | Effect |
| --- | --- |
| `navigate(section)` | Set the L1 sidebar section (`home`/`overview`/`personas`/`teams`/`plugins`/…) via `/navigate`. |
| `plugin_tab(tab)` | Select a plugin surface under Plugins (e.g. `'dev-tools'`) via the bridge `setPluginTab`. |
| `click(testid)` | Click any element by `data-testid` (L2/L3 nav items, buttons) via `/click-testid`. |
| `settle(ms)` | Pause for the UI to mount after a navigation. |
| `Stage(name, reach=[...], assert_present=[...], notes="")` | One step: how to reach it + the testids that must be present + visible. |

The runner reports `PASS`/`FAIL` per stage (a missing surface is a **finding**,
not a crash) and writes a JSON summary to
[`docs/tests/results/guide-<tag>.json`](../results).

## Running

1. Launch the app with the test-automation server:
   ```bash
   npm run tauri:dev:test          # serves the bridge on 127.0.0.1:17320
   ```
   (Override the port with `PERSONAS_TEST_PORT`; `guidekit` honors it via the
   shared client.)
2. Run a guide (needs `httpx`, already used by `tools/test-mcp`):
   ```bash
   python docs/tests/guides/teams_orchestration_pipeline.py
   ```

## Guides

| Guide | What it walks |
| --- | --- |
| [`teams_orchestration_pipeline.py`](./teams_orchestration_pipeline.py) | The 5-stage **Teams & Orchestration** pipeline: register a repo → context-map scan → KPI scan → team-from-preset → orchestrate. Mirrors the `teams-orchestration` tour. |

## Adding a guide

1. Add the `data-testid`s the flow's action points need (if missing) — that gap
   is itself worth closing; a tour and a test can then both target them.
2. Author a `Guide` (copy `teams_orchestration_pipeline.py`).
3. If the flow has a matching tour, assert the tour's `highlightTestId`s so the
   two stay in lockstep.
