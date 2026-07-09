"""build-bench — reusable side-by-side benchmark harness for the persona BUILD process.

Drives a headless one-shot build for a fixture under a named engine VARIANT
(``sequential`` = today's as-is path, ``multiagent`` = the to-be orchestrated
path once it lands), captures the promoted persona's structure straight from
SQLite, runs the fixture's hard assertions, and reports the variants
side-by-side so each phase of the rollout can be judged on speed AND quality.

Design notes
------------
* Reuses ``tools/test-mcp/lib`` (Client / DB) verbatim — no bespoke HTTP or DB code.
* Drives the raw ``/build/start`` + ``/build/status`` test-automation routes with
  ``mode="one_shot"`` so a run needs ZERO interaction.
* The engine variant is passed as a forward-compatible ``orchestration`` body
  field on ``/build/start``. The current engine ignores unknown body fields, so
  "sequential" is what actually runs until Phase 2 wires the field; "multiagent"
  becomes real per the rollout in docs/architecture/build-orchestration-plan.md.
* Per-phase wall-clock is stamped by polling ``/build/status`` (coarse BuildPhase
  granularity). Precise per-EVENT timing + token/cost arrive with Phase 0
  telemetry (``phase_timings_json`` / ``total_cost_usd`` on build_sessions),
  which the driver reads automatically when present.

Canonical usage:

    python tools/test-mcp/run_build_bench.py \
        --fixture web-research-desk --variant sequential --variant multiagent --repeat 3
"""
from __future__ import annotations

from .driver import BuildRun, run_one_build
from .capture import CapturedBuild, capture_build
from .quality import AssertionResult, evaluate_assertions, judge_bundle
from .report import aggregate, render_report

__all__ = [
    "BuildRun",
    "run_one_build",
    "CapturedBuild",
    "capture_build",
    "AssertionResult",
    "evaluate_assertions",
    "judge_bundle",
    "aggregate",
    "render_report",
]
