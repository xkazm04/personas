"""Live UI test for the Teams & Orchestration pipeline (the 5-stage tour).

Walks the same five surfaces the `teams-orchestration` tour rings and asserts
each stage's action point is reachable + present from the UI — proving the whole
process is achievable, and flagging any missing/broken step. Surface-reachability
(not full execution): completing each action triggers slow/native operations
(folder dialog, minutes-long LLM scans, real agent runs) that aren't driven here.

Run (with the app up via `npm run tauri:dev:test`):
    python docs/tests/guides/teams_orchestration_pipeline.py

The testids asserted here are exactly the `highlightTestId`s in
`src/stores/slices/system/tourSlice.ts` TEAMS_ORCHESTRATION_STEPS, so this test
and the tour keep each other honest.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make `guidekit` importable regardless of CWD.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from guidekit import Guide, Stage, navigate, click, plugin_tab, settle, run_and_save  # noqa: E402


PIPELINE = Guide(
    name="Teams & Orchestration pipeline",
    description=(
        "Register a repo → map it → define success (KPIs) → assemble a team "
        "from a preset → put it to work. Asserts each stage's surface + action "
        "point is reachable from the UI."
    ),
    stages=[
        Stage(
            "1 · Register your repo",
            # Plugins → Dev Tools (default sub-tab is Projects).
            reach=[navigate("plugins"), plugin_tab("dev-tools"), settle(500)],
            assert_present=["dev-tools-page", "dev-project-new"],
            notes="Dev Tools › Projects → New project. Completing it needs a native folder dialog.",
        ),
        Stage(
            "2 · Map the codebase",
            # Plugins → Dev Tools → Context Map (an L3 sidebar nav item; the
            # dev-tools sub-tabs are sidebar items, not an in-page tab bar, so
            # we click the `l3-nav-<id>` testid SidebarLevel3 stamps on each).
            reach=[navigate("plugins"), plugin_tab("dev-tools"), settle(300), click("l3-nav-context-map"), settle(400)],
            assert_present=["context-scan-button"],
            notes="Dev Tools › Context Map → Scan. The scan button renders on the empty state too; actually running the scan needs a registered project + repo path.",
        ),
        Stage(
            "3 · Define success with KPIs",
            # Teams → KPIs sub-nav.
            reach=[navigate("teams"), settle(300), click("teams-kpis-nav"), settle(400)],
            assert_present=["kpi-scan-button"],
            notes="Teams › KPIs → Scan for KPIs.",
        ),
        Stage(
            "4 · Assemble a team from a preset",
            # Teams → Workspace (team list).
            reach=[navigate("teams"), settle(300), click("team-nav"), settle(400)],
            assert_present=["teams-table", "team-preset-btn"],
            notes="Teams workspace → Preset Team opens the preset studio.",
        ),
        Stage(
            "5 · Put the team to work",
            # Teams → Workspace; the Orchestrate goal input (team-goal-input /
            # team-assign-button) needs a SELECTED team, so we assert the
            # workspace surface is reachable as the entry point.
            reach=[navigate("teams"), settle(300), click("team-nav"), settle(400)],
            assert_present=["teams-table"],
            notes="Orchestrate (team-goal-input / team-assign-button) requires opening a team first.",
        ),
    ],
)


if __name__ == "__main__":
    run_and_save(PIPELINE, "teams-orchestration-pipeline")
