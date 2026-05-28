"""Live-app e2e: Director Phase 3 — verdict scoring.

Picks 1-2 healthy personas from the live sqlite DB + the built-in Director,
stars them (so they enter the Director's coaching scope), runs the Director on
each via the test-automation bridge (:17320), and asserts a 0-5
`director_score` landed on each target's latest execution.

Requires the app running with test-automation:
    npm run tauri:dev:test        (HTTP server on :17320)

Usage:
    python tools/test-mcp/e2e_director.py [--port 17320] [--max 2]

Note: each Director review is a real LLM run (cost + minutes). The DB is the
source of truth for PASS/FAIL — we assert the score column, not the bridge
response envelope.
"""
from __future__ import annotations

import argparse
import sys

from lib import Client, Bridge, DB

DIRECTOR_REVIEW_LIKE = '%"source":"director"%'


def invoke(bridge: Bridge, command: str, params: dict | None = None, timeout: int = 300) -> dict:
    return bridge.exec(
        "invokeCommand",
        {"command": command, "params": params or {}},
        timeout_secs=timeout,
    )


def pick_targets(db: DB, director_id: str, limit: int) -> list[dict]:
    """Healthy personas = >=1 non-simulation completed execution, excluding the Director."""
    return db.query(
        """
        SELECT p.id AS id, p.name AS name,
               SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS completed
        FROM personas p
        JOIN persona_executions e ON e.persona_id = p.id
        WHERE p.id != ? AND COALESCE(e.is_simulation, 0) = 0
        GROUP BY p.id
        HAVING completed >= 1
        ORDER BY completed DESC
        LIMIT ?
        """,
        (director_id, limit),
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=17320)
    ap.add_argument("--max", type=int, default=2)
    args = ap.parse_args()

    client = Client(port=args.port, default_timeout=340)
    bridge = Bridge(client)
    db = DB()

    try:
        print(f"[preflight] health: {client.get('/health')}")
    except Exception as e:  # noqa: BLE001 — preflight only
        print(f"FAIL: app not reachable on :{args.port} ({e}). Start `npm run tauri:dev:test`.")
        return 1

    director = db.find_persona_by_name("Director")
    if not director:
        print("FAIL: Director persona not found (app not initialised?).")
        return 1
    director_id = director["id"]
    print(f"[preflight] Director id: {director_id}")

    targets = pick_targets(db, director_id, args.max)
    if not targets:
        print("FAIL: no healthy personas with completed executions to coach.")
        return 1
    print(f"[setup] targets: {[t['name'] for t in targets]}")

    # Star the targets so they're in the Director's scope.
    for t in targets:
        print(f"[setup] star {t['name']}: {invoke(bridge, 'set_persona_starred', {'id': t['id'], 'starred': True}, timeout=30)}")

    results = []
    for t in targets:
        latest = db.latest_execution(t["id"])
        exec_id = latest["id"] if latest else None
        print(f"[run] Director on {t['name']} (anchor exec {exec_id}) ...")
        resp = invoke(bridge, "run_director_on_persona", {"personaId": t["id"]}, timeout=320)
        print(f"[run]   bridge -> {resp}")

        row = db.query(
            "SELECT director_score, director_review_md FROM persona_executions WHERE id = ?",
            (exec_id,),
        ) if exec_id else []
        score = row[0]["director_score"] if row else None
        has_md = bool(row[0]["director_review_md"]) if row else False
        reviews = db.scalar(
            "SELECT COUNT(*) FROM persona_manual_reviews WHERE persona_id = ? AND context_data LIKE ?",
            (t["id"], DIRECTOR_REVIEW_LIKE),
        )
        ok = isinstance(score, int) and 0 <= score <= 5
        results.append((t["name"], score, has_md, reviews, ok))
        print(f"[verify] {t['name']}: score={score} md={'y' if has_md else 'n'} director_reviews={reviews} -> {'PASS' if ok else 'FAIL'}")

    print("\n=== Director verdict scorecard ===")
    for name, score, has_md, reviews, ok in results:
        stars = ("★" * int(score) + "☆" * (5 - int(score))) if isinstance(score, int) else "—"
        print(f"  {name:<28} {stars:<7} score={score} md={'y' if has_md else 'n'} reviews={reviews} {'PASS' if ok else 'FAIL'}")

    passed = all(ok for *_, ok in results)
    print(f"\n{'ALL PASS' if passed else 'SOME FAILED'}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
