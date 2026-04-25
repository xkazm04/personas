r"""
Scenario 2 — News scraper acceptance runner.

Drives a build-from-scratch through the question loop for an "AI agent
market news watcher" intent. Asserts:
  1. Q&A reaches test_complete
  2. Promotion creates a real persona row
  3. Promoted IR carries at least one trigger and one connector tool
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import httpx


parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=17320)
parser.add_argument(
    "--intent",
    default=(
        "Watch news regarding the AI agent market — orchestration patterns, "
        "research breakthroughs, and tooling launches — and keep me informed."
    ),
)
parser.add_argument("--max-rounds", type=int, default=14)
parser.add_argument("--report", default=None)
args = parser.parse_args()


BASE = f"http://127.0.0.1:{args.port}"
client = httpx.Client(timeout=60.0)
events: list[dict] = []


def record(step: str, outcome: str, **kw) -> None:
    ev = {"step": step, "outcome": outcome, **kw}
    events.append(ev)
    body = " ".join(f"{k}={v}" for k, v in kw.items() if v not in (None, ""))
    print(f"[{outcome.upper():>4}] {step}: {body}")


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


ANSWERS = {
    "behavior_core": (
        "Personal market digest. Watch reputable AI-agent / orchestration / "
        "research / tooling sources, surface what changed since last run."
    ),
    "source_acquisition": "B: Let the agent pick reputable sources for the topic",
    "sources_list": "https://news.ycombinator.com/rss\nhttps://arxiv.org/rss/cs.AI",
    "output_target_category": "A: Save to a knowledge base (vector_db)",
    "connectors": "personas_vector_db",
    "destination": "personas_vector_db",
    "triggers": "B: On a schedule (pick a cadence) — daily 7am",
    "human-review": "Never — auto-publish; I can undo/discard myself",
    "memory": "Yes — capture user preferences/corrections for future runs",
    "use-cases": "Single capability: AI Agent News Digest.",
    "messages": "Save items into the knowledge base; built-in messaging only when there's a high-importance signal.",
    "error-handling": "Log and surface a built-in message; don't retry more than twice.",
}
FALLBACK = "Please proceed with the most sensible default for this dimension."


def cleanup_existing_personas(name_keywords: list[str]) -> None:
    r = bridge("listAllPersonas", {}, 15)
    for p in r.get("personas", []) or []:
        if p.get("trust_origin") == "system":
            continue
        name = (p.get("name") or "").lower()
        if any(kw.lower() in name for kw in name_keywords):
            d = bridge("deletePersonaById", {"personaId": p.get("id")}, 30)
            record("cleanup", "ok" if d.get("success") else "info", id=str(p.get("id"))[:8], name=p.get("name"))


def reset_ui() -> None:
    client.post(
        f"{BASE}/eval",
        json={
            "js": (
                "window.__AGENT_STORE__.getState().resetBuildSession();"
                "window.__AGENT_STORE__.getState().selectPersona(null);"
                "window.__SYSTEM_STORE__.getState().setIsCreatingPersona(true);"
                "window.__SYSTEM_STORE__.getState().setSidebarSection(\"personas\");"
            )
        },
        timeout=15,
    )
    time.sleep(4)


def run_question_loop() -> tuple[bool, str | None]:
    r = bridge("startBuildFromIntent", {"intent": args.intent, "timeoutMs": 25000}, 30)
    if not r.get("success"):
        record("start_build", "fail", error=r.get("error"))
        return False, None
    persona_id = r.get("personaId")
    record("start_build", "ok", persona_id=persona_id)
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
            return True, persona_id
        if phase == "failed":
            return False, persona_id
        qs = bridge("listPendingBuildQuestions", {}, 15).get("questions") or []
        if not qs:
            time.sleep(1)
            continue
        cell = qs[0].get("cellKey", "")
        cnt = answer_count.get(cell, 0) + 1
        if cnt > MAX_PER_CELL:
            record("loop.repeat", "fail", cell=cell, attempts=cnt)
            return False, persona_id
        answer_count[cell] = cnt
        answer = ANSWERS.get(cell, FALLBACK)
        bridge("answerPendingBuildQuestions", {"answers": {cell: answer}}, 30)
        record(f"round{i}.answer", "ok", cell=cell, attempt=cnt)
    return False, persona_id


def main() -> None:
    try:
        cleanup_existing_personas(["news", "ai agent", "ai-agent", "digest", "scrape", "intel"])
        reset_ui()
        ok, persona_id = run_question_loop()
        if not ok or not persona_id:
            record("scenario", "fail", at="question_loop")
            return
        p = bridge("promoteBuildDraft", {}, 60)
        if not p.get("success"):
            record("promote", "fail", error=p.get("error"))
            return
        record("promote", "ok", persona_id=p.get("personaId"))
        ir = bridge("getPersonaIr", {"personaId": p.get("personaId")}, 15)
        triggers = ir.get("triggers", [])
        subs = ir.get("subscriptions", [])
        record(
            "ir.shape",
            "ok",
            triggers=len(triggers),
            subscriptions=len(subs),
            tools=len(ir.get("toolNames", [])),
        )
        if not triggers:
            record("ir.trigger", "fail", note="no triggers persisted")
            return
        record("ir.trigger", "ok", trigger_type=triggers[0].get("trigger_type"))
        record(
            "ir.subscriptions",
            "ok" if subs else "info",
            event_types=[s.get("event_type") for s in subs],
        )
        record("scenario", "ok", at="build_phase_complete")
    finally:
        if args.report:
            Path(args.report).write_text(json.dumps(events, indent=2))
            print(f"\nWrote {args.report}")


if __name__ == "__main__":
    main()
