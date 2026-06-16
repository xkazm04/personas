# Guide test results (`docs/tests/results/`)

Machine-readable output from the guide tests in
[`../guides/`](../guides/). Each run writes `guide-<tag>.json` with a per-stage
PASS/FAIL summary (`save_result` in the guidekit runner). Re-running a guide
overwrites its file, so this folder always holds the **latest** run per guide.

Schema (`guide-<tag>.json`):

```jsonc
{
  "guide": "<name>",
  "passed": 5, "total": 5,          // stages whose action points were all reachable
  "stages": [
    { "stage": "1 · …", "ok": true,
      "checks": [ { "testid": "…", "ok": true, "detail": "present + visible (1)" } ],
      "notes": "…" }
  ]
}
```

## Latest runs

| Guide | Result | File |
| --- | --- | --- |
| Teams & Orchestration pipeline | **5 / 5 stages reachable** | [`guide-teams-orchestration-pipeline.json`](./guide-teams-orchestration-pipeline.json) |

### Teams & Orchestration pipeline — run notes

First live run against a `npm run tauri:dev:test` instance walked all five
stages (register repo → context-map → KPIs → preset team → orchestrate) and
**surfaced two real gaps, both fixed in the same session** — which is exactly
what running a guide against the live app is for:

1. **Runner crashed on a Windows console** — the report prints Unicode (`→ · ✓`)
   and died with `UnicodeEncodeError` under the legacy cp1250 code page. Fixed by
   forcing UTF-8 stdout/stderr in `guidekit/runner.py`.
2. **No clickable path to the Dev Tools sub-tabs** — the dev-tools sub-tabs
   (Overview / Projects / Context Map / …) are **sidebar** L3 items, not an
   in-page tab bar, and `SidebarLevel3` stamped no `data-testid`, so stage 2
   (Context Map) was unreachable by a test or a precise tour ring. Fixed by
   stamping `data-testid="l3-nav-<id>"` on every L3 nav item; the guide now
   reaches Context Map via `l3-nav-context-map`.

After both fixes the pipeline is **5/5 reachable**. Surface-reachability only —
the test deliberately does not complete the native folder dialog, the
minutes-long codebase/KPI scans, or a real agent run.

To reproduce: launch `npm run tauri:dev:test`, then
`python docs/tests/guides/teams_orchestration_pipeline.py`.
