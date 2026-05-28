r"""
Aggregate overnight run report.

Pulls the latest adoption_*.json and glyph-sweep-*.json from
docs/tests/results/, joins with persona-level DB facts (cost, duration,
artifact counts), and writes a single persona-generation-{run_id}.json
report matching the §8 schema from
docs/tests/e2e/template-adoption-scenarios.md.

Usage:
  uvx python tools/test-mcp/aggregate_run_report.py
  uvx python tools/test-mcp/aggregate_run_report.py --out docs/tests/results/persona-generation-20260511.json
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


RESULTS_DIR = Path(__file__).parent.parent.parent / "docs" / "tests" / "results"


def latest(pattern: str) -> Path | None:
    files = sorted(RESULTS_DIR.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adoption-file", type=str, default=None)
    parser.add_argument("--glyph-file", type=str, default=None)
    parser.add_argument("--out", type=str, default=None)
    args = parser.parse_args()

    adoption_path = Path(args.adoption_file) if args.adoption_file else latest("adoption_*.json")
    glyph_path = Path(args.glyph_file) if args.glyph_file else latest("glyph-sweep-*.json")
    if not adoption_path:
        sys.exit("no adoption_*.json result file found")
    print(f"Adoption file:  {adoption_path.name}")
    print(f"Glyph file:     {glyph_path.name if glyph_path else '(missing)'}")

    db_path = Path.home() / "AppData" / "Roaming" / "com.personas.desktop" / "personas.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    adoption = json.loads(adoption_path.read_text())
    adoption_results = adoption.get("results", {})

    glyph_payload = json.loads(glyph_path.read_text()) if glyph_path else {"results": []}
    glyph_results = glyph_payload.get("results", [])

    # ── Enrich adoption rows with DB facts ───────────────────────────────────
    adoption_rows = []
    for name, r in adoption_results.items():
        pid = r.get("persona_id")
        row = {
            "scenario_id": name.lower().replace(" ", "-").replace(":", ""),
            "intake_path": "adoption",
            "persona_id": pid,
            "persona_name": r.get("persona_name") or name,
            "adopt": r.get("adopt", False),
            "execute": r.get("execute", False),
            "verify": r.get("verify", {}),
            "matrix": r.get("matrix", False),
            "exec_status": "completed" if r.get("execute") else "missing",
        }
        if pid:
            e = conn.execute(
                "SELECT cost_usd, duration_ms, model_used FROM persona_executions "
                "WHERE persona_id = ? AND status = 'completed' "
                "ORDER BY created_at DESC LIMIT 1",
                (pid,),
            ).fetchone()
            if e:
                row["cost_usd"] = e["cost_usd"]
                row["duration_ms"] = e["duration_ms"]
                row["model_used"] = e["model_used"]
            counts = {}
            for table, col in [
                ("persona_messages", "persona_id"),
                ("persona_memories", "persona_id"),
                ("persona_events", "source_id"),
                ("persona_manual_reviews", "persona_id"),
            ]:
                counts[table] = conn.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE {col} = ?", (pid,)
                ).fetchone()[0]
            row["artifact_counts"] = counts
        adoption_rows.append(row)

    # ── Enrich glyph rows with DB facts ──────────────────────────────────────
    glyph_rows = []
    for r in glyph_results:
        pid = r.get("persona_id")
        row = {
            "scenario_id": r.get("scenario_id"),
            "intake_path": "glyph",
            "tier": r.get("tier"),
            "intent": r.get("intent"),
            "persona_id": pid,
            "phase_reached": r.get("phase_reached"),
            "exec_status": r.get("exec_status"),
            "exec_cost_usd": r.get("exec_cost_usd"),
            "exec_duration_ms": r.get("exec_duration_ms"),
            "error": r.get("error"),
        }
        if pid:
            persona_row = conn.execute(
                "SELECT name FROM personas WHERE id = ?", (pid,)
            ).fetchone()
            row["persona_name"] = persona_row["name"] if persona_row else None
            counts = {}
            for table, col in [
                ("persona_messages", "persona_id"),
                ("persona_memories", "persona_id"),
                ("persona_events", "source_id"),
                ("persona_manual_reviews", "persona_id"),
            ]:
                counts[table] = conn.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE {col} = ?", (pid,)
                ).fetchone()[0]
            row["artifact_counts"] = counts
        glyph_rows.append(row)

    # ── Aggregate summary ────────────────────────────────────────────────────
    adoption_total = len(adoption_rows)
    adoption_executed = sum(1 for r in adoption_rows if r["exec_status"] == "completed")
    glyph_total = len(glyph_rows)
    glyph_promoted = sum(1 for r in glyph_rows if r["phase_reached"] == "promoted")
    glyph_executed = sum(1 for r in glyph_rows if r["exec_status"] == "completed")

    adoption_cost = sum((r.get("cost_usd") or 0) for r in adoption_rows)
    glyph_cost = sum((r.get("exec_cost_usd") or 0) for r in glyph_rows)

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = (
        Path(args.out)
        if args.out
        else RESULTS_DIR / f"persona-generation-{run_id}.json"
    )

    summary = {
        "run_id": f"run-{run_id}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "adoption_file": str(adoption_path.name),
            "glyph_file": glyph_path.name if glyph_path else None,
        },
        "intake_summary": {
            "adoption": {
                "scenarios": adoption_total,
                "executed_completed": adoption_executed,
                "total_cost_usd": round(adoption_cost, 4),
            },
            "glyph": {
                "scenarios": glyph_total,
                "promoted": glyph_promoted,
                "executed_completed": glyph_executed,
                "total_cost_usd": round(glyph_cost, 4),
            },
        },
        "adoption_results": adoption_rows,
        "glyph_results": glyph_rows,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2))
    print(f"\nWrote {out_path}")
    print(
        f"Adoption: {adoption_executed}/{adoption_total} executed; "
        f"Glyph: {glyph_executed}/{glyph_total} executed; "
        f"total cost ${adoption_cost + glyph_cost:.3f}"
    )


if __name__ == "__main__":
    main()
