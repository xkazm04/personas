"""Aggregate runs per variant and render a side-by-side markdown report.

Reporting style lifted from ``run_haiku_benchmark.py`` (baseline-delta table):
one variant is the baseline (``sequential`` = as-is), the other shows Δ speedup
and Δ quality so you can see whether the to-be path is actually moving forward.
"""
from __future__ import annotations

import json
import statistics
from typing import Any


def _median(xs: list[float]) -> float:
    return round(statistics.median(xs), 2) if xs else 0.0


def aggregate(runs: list[dict]) -> dict[str, Any]:
    """runs: list of per-build dicts {variant, run: BuildRun-as-dict, capture, assertions, gate_pass_rate}."""
    by_variant: dict[str, list[dict]] = {}
    for r in runs:
        by_variant.setdefault(r["variant"], []).append(r)

    summary: dict[str, Any] = {}
    for variant, items in by_variant.items():
        totals = [i["run"]["total_seconds"] for i in items]
        promoted = [i for i in items if i["run"]["ok"]]
        caps = [len(i["capture"]["capabilities"]) for i in items]
        gate_rates = [i["gate_pass_rate"] for i in items]
        costs = [i["run"].get("cost_usd") for i in items if i["run"].get("cost_usd") is not None]

        # union of coarse per-phase timings across runs (median per phase)
        phase_acc: dict[str, list[float]] = {}
        for i in items:
            for ph, secs in (i.get("per_phase_seconds") or {}).items():
                phase_acc.setdefault(ph, []).append(secs)

        summary[variant] = {
            "runs": len(items),
            "promote_rate": round(len(promoted) / len(items), 3) if items else 0,
            "total_seconds_median": _median(totals),
            "total_seconds_min": round(min(totals), 2) if totals else 0,
            "total_seconds_max": round(max(totals), 2) if totals else 0,
            "capabilities_median": _median([float(c) for c in caps]),
            "gate_pass_rate_median": _median(gate_rates),
            "cost_usd_median": _median(costs) if costs else None,
            "per_phase_seconds_median": {k: _median(v) for k, v in phase_acc.items()},
        }
    return summary


def render_report(fixture: dict, runs: list[dict], summary: dict[str, Any], *, baseline: str = "sequential") -> str:
    lines: list[str] = []
    lines.append(f"# Build-bench report — {fixture['id']}")
    lines.append("")
    lines.append(f"> {fixture.get('description', '')}")
    lines.append("")
    variants = list(summary.keys())
    lines.append("## Side-by-side")
    lines.append("")
    header = "| Metric | " + " | ".join(variants) + " |"
    sep = "|" + "---|" * (len(variants) + 1)
    lines.append(header)
    lines.append(sep)

    def row(label: str, fn) -> str:
        return "| " + label + " | " + " | ".join(str(fn(summary[v])) for v in variants) + " |"

    lines.append(row("runs", lambda s: s["runs"]))
    lines.append(row("promote rate", lambda s: f"{s['promote_rate']*100:.0f}%"))
    lines.append(row("total time (median s)", lambda s: s["total_seconds_median"]))
    lines.append(row("total time (min–max s)", lambda s: f"{s['total_seconds_min']}–{s['total_seconds_max']}"))
    lines.append(row("capabilities (median)", lambda s: s["capabilities_median"]))
    lines.append(row("gate pass rate (median)", lambda s: f"{s['gate_pass_rate_median']*100:.0f}%"))
    lines.append(row("cost USD (median)", lambda s: s["cost_usd_median"] if s["cost_usd_median"] is not None else "n/a (Phase 0)"))
    lines.append("")

    # Delta vs baseline
    if baseline in summary and len(variants) > 1:
        base = summary[baseline]
        lines.append(f"## Δ vs baseline (`{baseline}`)")
        lines.append("")
        lines.append("| Variant | speedup | quality Δ (gate) | verdict |")
        lines.append("|---|---|---|---|")
        for v in variants:
            if v == baseline:
                continue
            s = summary[v]
            bt = base["total_seconds_median"] or 1
            speedup = (bt - s["total_seconds_median"]) / bt * 100
            qd = (s["gate_pass_rate_median"] - base["gate_pass_rate_median"]) * 100
            faster = speedup > 0
            no_regress = qd >= 0
            verdict = "FORWARD" if (faster and no_regress) else (
                "faster but quality regressed" if faster else
                "quality up but slower" if no_regress else "REGRESSED")
            lines.append(f"| {v} | {speedup:+.0f}% | {qd:+.0f} pts | **{verdict}** |")
        lines.append("")

    # Per-phase breakdown
    lines.append("## Per-phase median seconds (coarse, from polling)")
    lines.append("")
    all_phases: list[str] = []
    for v in variants:
        for ph in summary[v]["per_phase_seconds_median"]:
            if ph not in all_phases:
                all_phases.append(ph)
    lines.append("| Phase | " + " | ".join(variants) + " |")
    lines.append("|" + "---|" * (len(variants) + 1))
    for ph in all_phases:
        cells = [str(summary[v]["per_phase_seconds_median"].get(ph, "-")) for v in variants]
        lines.append(f"| {ph} | " + " | ".join(cells) + " |")
    lines.append("")
    lines.append("_Precise per-event timing + cost land with Phase 0 telemetry "
                 "(`phase_timings_json` / `total_cost_usd` on build_sessions)._")
    return "\n".join(lines)
