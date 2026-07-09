r"""clarify-bench entry point — does the build ASK the right questions on vague
intent and converge to the real business intent?

Runs a fixture's VAGUE intent through an INTERACTIVE build, answers each
clarifying question as a hidden-intent user (LLM-simulated), and writes a per-run
judge bundle + a summary. Score the bundles with the operator's Claude judge pass
(see docs/tests/clarify-bench/judge-prompt.md).

Prereqs:
  1. Dev app WITH test-automation: npm run tauri:dev:test  (bridge :17320)
  2. `claude` CLI on PATH (subscription auth) — the user-simulator spawns it.

Usage:
  python tools/test-mcp/run_clarify_bench.py --fixture emails-vague
  python tools/test-mcp/run_clarify_bench.py --all --variant sequential --repeat 1
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

from lib import Client, DB
from buildbench.capture import capture_build
from clarifybench import run_clarify_build, judge_bundle

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / "docs" / "tests" / "clarify-bench" / "fixtures"
DEFAULT_OUT = REPO_ROOT / "docs" / "tests" / "clarify-bench" / "results"


def load_fixture(fid: str) -> dict:
    p = FIXTURE_DIR / f"{fid}.json"
    if not p.exists():
        raise SystemExit(f"Fixture not found: {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def main() -> None:
    ap = argparse.ArgumentParser(description="clarify-bench — ambiguity / question-quality harness")
    ap.add_argument("--fixture", action="append", default=None, help="fixture id (repeatable)")
    ap.add_argument("--all", action="store_true", help="run every fixture in the fixtures dir")
    ap.add_argument("--variant", action="append", default=None, help="sequential|multiagent (repeatable)")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--out", type=str, default=str(DEFAULT_OUT))
    ap.add_argument("--keep-personas", action="store_true", default=True)
    args = ap.parse_args()

    if args.all:
        fids = sorted(p.stem for p in FIXTURE_DIR.glob("*.json"))
    elif args.fixture:
        fids = args.fixture
    else:
        raise SystemExit("Pass --fixture <id> (repeatable) or --all")
    variants = args.variant or ["sequential"]

    client = Client(port=args.port, default_timeout=max(120, args.timeout))
    client.health()
    db = DB()

    out_dir = Path(args.out)
    (out_dir / "bundles").mkdir(parents=True, exist_ok=True)

    runs: list[dict] = []
    for fid in fids:
        fixture = load_fixture(fid)
        for variant in variants:
            for n in range(args.repeat):
                tag = f"{fid}-{variant}-{n+1}"
                print(f"\n=== clarify {fid} · {variant} ({n+1}/{args.repeat}) ===", flush=True)
                run = run_clarify_build(client, fixture, variant, timeout_s=args.timeout)
                cap = capture_build(db, session_id=run.session_id, persona_id=run.persona_id)
                flag = "HUNG" if run.hung else run.terminal_phase
                print(f"    -> {flag} · {run.num_rounds} rounds · {run.num_questions} questions "
                      f"· {run.total_seconds}s · {len(cap.capabilities)} caps", flush=True)
                bundle = judge_bundle(fixture, run, cap)
                (out_dir / "bundles" / f"{tag}.md").write_text(bundle, encoding="utf-8")
                runs.append({"tag": tag, "fixture": fid, "variant": variant, "run": run.as_dict(),
                             "capabilities": [c for c in cap.capabilities]})

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    summary = {
        "runs": [
            {"tag": r["tag"], "terminal": r["run"]["terminal_phase"], "hung": r["run"]["hung"],
             "rounds": r["run"]["num_rounds"], "questions": r["run"]["num_questions"],
             "seconds": r["run"]["total_seconds"], "caps": len(r["capabilities"])}
            for r in runs
        ]
    }
    (out_dir / f"summary-{stamp}.json").write_text(
        json.dumps({"summary": summary, "runs": runs}, indent=2, default=str), encoding="utf-8"
    )
    print("\n=== summary ===")
    for r in summary["runs"]:
        print(f"  {r['tag']}: {'HUNG' if r['hung'] else r['terminal']} · "
              f"{r['rounds']}r/{r['questions']}q · {r['seconds']}s · {r['caps']}caps")
    print(f"\n[written] {out_dir / f'summary-{stamp}.json'}  ·  bundles in {out_dir/'bundles'}")


if __name__ == "__main__":
    main()
