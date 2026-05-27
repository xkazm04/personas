r"""Compact one-screen-per-turn summary of an Athena suite run dir.

Reads docs/tests/athena/results/<stamp>/bundles/ and prints a terse
overview — scenario, turn, hard-assertion roll-up, reply head, the
ops/cards/approvals actually emitted. Use when judging a run in pass 2
to triage where to focus first.

    python tools/test-mcp/athena_summarize_bundles.py docs/tests/athena/results/2026-05-26-2156
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Windows console can default to cp1250/cp1252 which can't encode the unicode
# arrows / smart quotes Athena emits — force stdout to utf-8 so the summarizer
# doesn't crash mid-line.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: athena_summarize_bundles.py <run_dir>", file=sys.stderr)
        sys.exit(2)
    run_dir = Path(sys.argv[1])
    bundles_root = run_dir / "bundles"
    if not bundles_root.exists():
        print(f"no bundles in {run_dir}", file=sys.stderr)
        sys.exit(2)

    for scenario_dir in sorted(p for p in bundles_root.iterdir() if p.is_dir()):
        snapshot_path = scenario_dir / "scenario.json"
        if not snapshot_path.exists():
            continue
        snap = json.loads(snapshot_path.read_text(encoding="utf-8"))
        sid = snap["id"]
        hard = snap["hard_status"]
        print(f"\n{'=' * 78}")
        print(f"# {sid}  — hard={hard.upper()}")
        if snap.get("setup_error"):
            print(f"  SETUP ERROR: {snap['setup_error']}")
            continue
        for idx, turn in enumerate(snap.get("turns") or []):
            tid = turn["turn_id"]
            hp = turn["hard_passed"]
            dur = turn.get("duration_ms", 0)
            mark = "PASS" if hp else "FAIL"
            print(f"\n  t{idx} {tid}  [{mark}]  {dur}ms")
            user = turn["user_message"]
            print(f"    user:  {user[:160]}")
            # Pull the bundle's structured turn capture from the markdown
            md_path = scenario_dir / f"t{idx}-{tid}.md"
            if md_path.exists():
                body = md_path.read_text(encoding="utf-8")
                # crude reply extraction (between "## Athena's reply" and next ##)
                if "## Athena's reply" in body:
                    s = body.split("## Athena's reply", 1)[1]
                    s = s.split("##", 1)[0].strip()
                    s = s.replace("```", "").strip()
                    print(f"    reply: {s[:200]}")
            # Assertion summary
            failed = [a for a in turn.get("assertions") or [] if not a["passed"]]
            if failed:
                for a in failed:
                    print(f"    FAIL: {a['name']} — {a.get('detail', '')[:140]}")
            else:
                names = [a["name"] for a in turn.get("assertions") or []]
                print(f"    pass: {', '.join(names) or '(no assertions)'}")


if __name__ == "__main__":
    main()
