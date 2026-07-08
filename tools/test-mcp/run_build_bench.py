r"""Build-bench entry point — benchmark the persona BUILD process, as-is vs to-be.

Runs a fixture's headless one-shot build under one or more engine VARIANTS,
N times each, captures the produced structure, runs the fixture's hard
assertions, and writes a side-by-side report + per-run judge bundles.

Prerequisites:
  1. Dev app running WITH the test-automation feature:
       npm run tauri:dev:test          (or tauri:dev:test:full for ML paths)
  2. Health check: curl http://127.0.0.1:17320/health
  3. For the connector reactions to go green: healthy Airtable + Notion
     credentials in the vault (service_type 'airtable' and 'notion').

Usage:
  uvx --with httpx python tools/test-mcp/run_build_bench.py \
      --fixture web-research-desk --variant sequential --repeat 3
  # once the multi-agent path lands (Phase 2+):
  uvx --with httpx python tools/test-mcp/run_build_bench.py \
      --fixture web-research-desk --variant sequential --variant multiagent --repeat 3

Flags:
  --fixture <id>         fixture id under docs/tests/build-bench/fixtures/ (no .json)
  --variant <name>       engine variant; repeatable (default: sequential)
  --repeat <int>         builds per variant (default: 2)
  --persona-id <id>      build onto an existing draft persona (pre-Phase-0 auto-create)
  --port <int>           test-automation port (default 17320 / $PERSONAS_TEST_PORT)
  --timeout <sec>        per-build terminal timeout (default 900)
  --out <dir>            report dir (default docs/tests/results/build-bench)
  --keep-personas        do not delete benchmarked personas afterward
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# UTF-8 stdout (Windows cp1250 console crashes on Unicode) — repo convention.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

from lib import Bridge, Client, DB
from buildbench import (
    aggregate,
    capture_build,
    evaluate_assertions,
    judge_bundle,
    render_report,
    run_one_build,
)
from buildbench.quality import gate_pass_rate

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / "docs" / "tests" / "build-bench" / "fixtures"
DEFAULT_OUT = REPO_ROOT / "docs" / "tests" / "results" / "build-bench"


def load_fixture(fixture_id: str) -> dict:
    path = FIXTURE_DIR / f"{fixture_id}.json"
    if not path.exists():
        raise SystemExit(f"Fixture not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    ap = argparse.ArgumentParser(description="Persona build benchmark (as-is vs to-be)")
    ap.add_argument("--fixture", required=True)
    ap.add_argument("--variant", action="append", default=None)
    ap.add_argument("--repeat", type=int, default=2)
    ap.add_argument("--persona-id", type=str, default=None)
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--out", type=str, default=str(DEFAULT_OUT))
    ap.add_argument("--keep-personas", action="store_true")
    args = ap.parse_args()

    fixture = load_fixture(args.fixture)
    variants = args.variant or fixture.get("variants") or ["sequential"]
    intent = fixture["intent"]
    mode = fixture.get("mode", "one_shot")

    client = Client(port=args.port, default_timeout=max(120, args.timeout))
    client.health()  # aborts with an actionable message if the app isn't up
    db = DB()
    bridge = Bridge(client)

    out_dir = Path(args.out)
    (out_dir / "bundles" / args.fixture).mkdir(parents=True, exist_ok=True)

    runs: list[dict] = []
    for variant in variants:
        for n in range(args.repeat):
            tag = f"{variant}-{n+1}"
            print(f"\n=== build {args.fixture} · {tag} ===", flush=True)
            run = run_one_build(
                client, args.fixture, intent, variant,
                persona_id=args.persona_id, mode=mode, timeout_s=args.timeout,
                answers=fixture.get("answers"), default_answer=fixture.get("default_answer"),
            )
            cap = capture_build(db, session_id=run.session_id, persona_id=run.persona_id)
            results = evaluate_assertions(fixture, cap)
            gpr = gate_pass_rate(results)
            extra = f" · {run.questions_answered}q" if run.questions_answered else ""
            if run.stuck_question:
                extra += f" · STUCK:{run.stuck_question}"
            print(f"    -> {run.terminal_phase} in {run.total_seconds}s · "
                  f"{len(cap.capabilities)} caps · gate {gpr*100:.0f}%{extra}", flush=True)

            # judge bundle (athena-style, for the operator's Claude judge pass)
            bundle = judge_bundle(fixture, cap, run, results)
            (out_dir / "bundles" / args.fixture / f"{tag}.md").write_text(bundle, encoding="utf-8")

            runs.append({
                "variant": variant,
                "tag": tag,
                "run": run.__dict__,
                "per_phase_seconds": run.per_phase_seconds(),
                "capture": cap.__dict__,
                "assertions": [r.as_dict() for r in results],
                "gate_pass_rate": gpr,
            })

            if not args.keep_personas and run.persona_id:
                try:
                    bridge.exec("deleteAgent", {"nameOrId": run.persona_id}, 30)
                except Exception:
                    pass  # best-effort cleanup; benchmark result already captured

    summary = aggregate(runs)
    report_md = render_report(fixture, runs, summary)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    (out_dir / f"{args.fixture}-{stamp}.md").write_text(report_md, encoding="utf-8")
    (out_dir / f"{args.fixture}-{stamp}.json").write_text(
        json.dumps({"fixture": args.fixture, "summary": summary, "runs": runs}, indent=2, default=str),
        encoding="utf-8",
    )
    print("\n" + report_md)
    print(f"\n[written] {out_dir / f'{args.fixture}-{stamp}.md'}")


if __name__ == "__main__":
    main()
