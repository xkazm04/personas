r"""
End-to-end verification of the full translation chronology, including step 7:

  Intent → Q&A loop → promoted persona → drive.document.added fires →
  persona executes → translated sibling file materialises.

Builds on e2e_question_loop.py (which proves rounds 0–N reach test_complete),
adds the promotion step and the drive-event / execution / output-file asserts.

Usage:
  python tools/test-mcp/e2e_full_translation.py --report /tmp/full.json
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx


parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=17320)
parser.add_argument(
    "--intent",
    default=(
        "Translate every document I drop into my local drive from English to "
        "Czech and save the translated copy next to the source file."
    ),
)
parser.add_argument("--doc-path", default="inbox/eng-sample.md")
parser.add_argument(
    "--doc-content",
    default=(
        "# Quarterly update\n\n"
        "Hello team,\n\n"
        "Our revenue grew 17% in Q1. Thanks for the great work.\n"
    ),
)
parser.add_argument("--max-rounds", type=int, default=12)
parser.add_argument("--exec-timeout", type=int, default=240)
parser.add_argument("--report", default=None)
args = parser.parse_args()


BASE = f"http://127.0.0.1:{args.port}"
client = httpx.Client(timeout=60.0)
events: list[dict] = []


def record(step: str, outcome: str, **kw) -> None:
    ev = {"step": step, "outcome": outcome, **kw}
    events.append(ev)
    body = " ".join(f"{k}={v}" for k, v in kw.items() if v not in (None, ""))
    print(f"[{outcome.upper():>2}] {step}: {body}")


def bridge(method: str, params: dict | None = None, timeout_secs: int = 30) -> dict:
    payload = {"method": method, "params": params or {}}
    r = client.post(f"{BASE}/bridge-exec", json=payload, timeout=timeout_secs + 5)
    try:
        raw = r.json()
    except Exception:
        return {"success": False, "error": f"non-json response: {r.text[:200]}"}
    if isinstance(raw, dict) and "result" in raw and isinstance(raw["result"], str):
        try:
            return json.loads(raw["result"])
        except Exception:
            return {"success": False, "error": raw["result"]}
    return raw


def query(selector: str) -> list[dict]:
    return bridge("query", {"selector": selector}, 15) or []


# Same deterministic answers as e2e_question_loop.py.
ANSWERS = {
    "behavior_core": (
        "Translate incoming English documents to Czech. Monitor the built-in "
        "local drive, translate new arrivals, and save the Czech copy next to "
        "the source file."
    ),
    "connectors": "local_drive",
    "triggers": "Fire on drive.document.added from the built-in local drive.",
    "human-review": "No review — translations are reversible.",
    "messages": "Save the Czech translation next to the source with a _cs suffix before the extension.",
    "memory": "No memory. Each translation is independent.",
    "error-handling": "Log and surface a built-in message. Do not retry more than twice.",
    "use-cases": "Single capability: Translate Incoming Document from English to Czech.",
}
FALLBACK = "Please proceed with the most sensible default for this dimension."


def cleanup_existing_personas(name_keywords: list[str]) -> None:
    """Delete prior personas whose name contains any of `name_keywords`.
    Each scenario run creates a new persona; without cleanup, a single drive
    event fans out to every prior copy and the fresh persona's execution
    competes for the cascade-guard slot."""
    r = bridge("listPersonas", {}, 15)
    for p in r.get("personas", []) or []:
        name = (p.get("name") or "").lower()
        origin = p.get("trust_origin")
        if origin == "system":
            continue  # never touch the Director / system personas
        if any(kw.lower() in name for kw in name_keywords):
            d = bridge("deletePersona", {"personaId": p.get("id")}, 30)
            record(
                "cleanup",
                "ok" if d.get("success") else "info",
                id=str(p.get("id"))[:8],
                name=p.get("name"),
                error=(d.get("error") or "")[:80],
            )


def run_question_loop() -> bool:
    cleanup_existing_personas(["translat", "translation", "drive", "czech", "english"])
    r = bridge("startBuildFromIntent", {"intent": args.intent, "timeoutMs": 25000}, 30)
    if not r.get("success"):
        record("start_build", "fail", error=r.get("error"))
        return False
    record("start_build", "ok", persona_id=r.get("personaId"))
    # Track how often each cell was answered so we can short-circuit a true
    # infinite loop (LLM rejecting answer N times) without false-failing on
    # legitimate re-asks (e.g. multi-UC build asking the same dimension once
    # per capability, or the LLM asking a follow-up after a 2-step rule).
    answer_count: dict[str, int] = {}
    MAX_PER_CELL = 4
    for i in range(args.max_rounds):
        deadline = time.time() + 240
        phase = None
        while time.time() < deadline:
            w = bridge(
                "waitForBuildPhase",
                {
                    "phases": ["awaiting_input", "test_complete", "promoted", "failed"],
                    "timeoutMs": 20000,
                },
                25,
            )
            phase = w.get("phase")
            if w.get("success"):
                break
        record(f"round{i}.wait", "ok" if phase else "fail", phase=phase)
        if phase in ("test_complete", "promoted"):
            return True
        if phase == "failed":
            return False
        qs = bridge("listPendingBuildQuestions", {}, 15).get("questions") or []
        if not qs:
            time.sleep(1)
            continue
        cell = qs[0].get("cellKey", "")
        cnt = answer_count.get(cell, 0) + 1
        if cnt > MAX_PER_CELL:
            record("loop.repeat", "fail", cell=cell, attempts=cnt)
            return False
        answer_count[cell] = cnt
        answer = ANSWERS.get(cell, FALLBACK)
        bridge("answerPendingBuildQuestions", {"answers": {cell: answer}}, 30)
        record(f"round{i}.answer", "ok", cell=cell, attempt=cnt)
    return False


def promote() -> dict:
    r = bridge("promoteBuildDraft", {}, 60)
    if not r.get("success"):
        record("promote", "fail", error=r.get("error"))
        return {}
    record("promote", "ok", persona_id=r.get("personaId"))
    return r


def drive_write() -> bool:
    r = bridge(
        "driveWriteText",
        {"relPath": args.doc_path, "content": args.doc_content},
        20,
    )
    if not r.get("success"):
        record("drive.write", "fail", error=r.get("error"))
        return False
    record("drive.write", "ok", path=args.doc_path)
    return True


def wait_execution(persona_id: str, since_iso: str) -> dict:
    deadline = time.time() + args.exec_timeout
    while time.time() < deadline:
        r = bridge(
            "waitForPersonaExecution",
            {"personaId": persona_id, "sinceIso": since_iso, "timeoutMs": 20000},
            25,
        )
        if r.get("success"):
            return r
        if not r.get("timedOut"):
            return r
    return {"success": False, "error": f"exec wait > {args.exec_timeout}s"}


def assert_output() -> dict:
    base = Path(args.doc_path)
    stem = base.stem
    suffix = base.suffix
    parent = str(base.parent).replace("\\", "/") if str(base.parent) != "." else ""
    candidates = []
    for variant in (f"{stem}_cs{suffix}", f"{stem}.cs{suffix}", f"{stem}-cs{suffix}"):
        candidates.append(f"{parent}/{variant}" if parent else variant)
    for candidate in candidates:
        r = bridge("driveReadText", {"relPath": candidate}, 15)
        if r.get("success") and (r.get("content") or "").strip():
            record("drive.read_translation", "ok", path=candidate, bytes=len(r["content"]))
            return {"path": candidate, "content": r["content"]}
    record("drive.read_translation", "fail", note=f"no sibling found among {candidates}")
    return {}


def main() -> None:
    try:
        if not run_question_loop():
            record("scenario", "fail", at="question_loop")
            return
        p = promote()
        if not p:
            record("scenario", "fail", at="promote")
            return
        persona_id = p.get("personaId") or ""
        if not persona_id:
            record("scenario", "fail", at="persona_id_missing")
            return
        since = datetime.now(timezone.utc).isoformat()
        if not drive_write():
            record("scenario", "fail", at="drive_write")
            return
        ex = wait_execution(persona_id, since)
        record("exec.wait", "ok" if ex.get("success") else "fail", **{k: v for k, v in ex.items() if k in ("executionId", "status", "error", "costUsd")})
        if ex.get("success"):
            time.sleep(2)
            assert_output()
    finally:
        if args.report:
            Path(args.report).write_text(json.dumps(events, indent=2))
            print(f"\nWrote {args.report}")


if __name__ == "__main__":
    main()
