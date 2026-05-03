r"""
Phase K — video narration build-shape E2E (C8 increment, 2026-04-28).

Verifies the build pipeline can compose a "narrated video" persona that
correctly enumerates the heavier multi-modal connector set the C8 doc
flagged as requiring this scenario:
  - Google Gemini (vision — to caption each frame)
  - ElevenLabs   (TTS — to synthesise narration audio)

This is a BUILD-SHAPE test only, mirroring Phase D's pattern. The C8
handoff doc estimated this scenario at 3-4h because runtime would also
need:
  - An ElevenLabs TTS command (today only an `ElevenLabs` enum variant
    of `transcribe_audio` exists, returning `NotImplemented` per
    `commands/artist/transcribe.rs` — TTS is not wired at all).
  - A persona-callable video-composition tool (today
    `commands/artist/ffmpeg.rs` exists but is invoked from creative
    sessions, not exposed as a connector for personas to invoke).

Phase K verifies the BUILD layer can wire a persona that names these
connectors, without trying to execute the persona — runtime depends on
those two follow-ups landing first.

Acceptance gates after promote:
  1. The IR has at least one use_case.
  2. The promoted persona's design_context references the
     `google_gemini` connector somewhere on a use_case (vision use).
  3. The promoted persona's design_context references the `elevenlabs`
     connector somewhere on a use_case (TTS use).
  4. NO webhook trigger landed (this is on-demand only — UC may have a
     manual trigger or no trigger row).

Prereqs:
  1. Dev app running with test-automation feature:
       npx tauri dev -- --features test-automation
  2. Test server is reachable:
       curl http://127.0.0.1:17320/health

Usage:
  uvx --with httpx python tools/test-mcp/e2e_phase_k.py
  uvx --with httpx python tools/test-mcp/e2e_phase_k.py --report logs/phase-k.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx


# Force UTF-8 stdout — narration output strings can include diacritics.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


# ---- CLI ---------------------------------------------------------------

# Kept narrow per C8 §Lessons #1. Single capability — captioning +
# synthesis + (vague) composition. Naming the two SDKs by service name
# in the intent helps the LLM converge on those connectors during
# resolution rather than inventing siblings (e.g. "openai-vision",
# "azure-speech").
INTENT = (
    "Make a narrated video on demand. I drop a folder of image frames "
    "into local-drive. For each frame, use Gemini Vision to write a "
    "one-sentence caption describing what's happening. Then use "
    "ElevenLabs to turn the captions into spoken audio. Final output: "
    "a video file with frames + spoken narration. Manual / on-demand "
    "trigger only — I'll invoke when frames are ready. Auto-publish, "
    "no human review."
)

parser = argparse.ArgumentParser(description="Phase K video narration build-shape E2E")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument("--build-timeout", type=int, default=240)
parser.add_argument("--no-persona-cleanup", action="store_true")
parser.add_argument("--report", type=str, default=None)
args = parser.parse_args()


BASE = f"http://127.0.0.1:{args.port}"
client = httpx.Client(base_url=BASE, timeout=240)


def post(path: str, body: dict | None = None, timeout: int | None = None) -> dict:
    r = client.post(path, json=body or {}, timeout=timeout or 120)
    try:
        return json.loads(r.text)
    except json.JSONDecodeError:
        return {"_raw": r.text, "_status": r.status_code}


def get(path: str) -> dict:
    return json.loads(client.get(path).text)


def bridge(method: str, params: dict | None = None, timeout_secs: int = 180) -> dict:
    return post(
        "/bridge-exec",
        {"method": method, "params": params or {}, "timeout_secs": timeout_secs},
        timeout=timeout_secs + 20,
    )


# ---- Event log ---------------------------------------------------------

log: list[dict] = []


def record(step: str, outcome: str, **kw) -> dict:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "step": step, "outcome": outcome}
    entry.update(kw)
    log.append(entry)
    marker = "[OK]" if outcome == "ok" else ("[..]" if outcome == "info" else "[XX]")
    sys.stdout.write(f"  {marker} {step}: {outcome}")
    if kw:
        brief = {k: v for k, v in kw.items() if not isinstance(v, (dict, list))}
        if brief:
            sys.stdout.write(f"  {brief}")
    sys.stdout.write("\n")
    sys.stdout.flush()
    return entry


# ---- Answer recipes ----------------------------------------------------
# Compact answers — verbose ones make the LLM stay in resolving for too
# many rounds (C8 §Lessons #1). The connector ANSWERS are the most
# important — name `google_gemini` and `elevenlabs` verbatim so the LLM
# locks onto the registry connector ids rather than inventing siblings.

ANSWERS = {
    "behavior_core": (
        "Frame-to-narrated-video composer. Reads frames from local-drive, "
        "captions each via Gemini Vision, narrates via ElevenLabs, "
        "emits a video file."
    ),
    "mission": "Turn a frame folder into a narrated video on demand.",
    "use-cases": (
        "ONE capability — Frame Narration. Inputs: folder of image frames. "
        "Pipeline: gemini-vision caption per frame → elevenlabs TTS for "
        "each caption → ffmpeg-style composition into a single video. "
        "Output: video file path."
    ),
    "triggers": (
        "Manual / on-demand trigger ONLY. No schedule, no webhook, no "
        "event subscription. The user invokes the persona explicitly "
        "when a frame folder is ready."
    ),
    "connectors": (
        "Three connectors: (1) `google_gemini` — vision captioning per "
        "frame. (2) `elevenlabs` — TTS for the captions. (3) `local-drive` "
        "— read input frames + write output video."
    ),
    "events": "No internal events emitted. No subscriptions.",
    "human-review": "Auto-publish. No review.",
    "messages": (
        "Single completion message with the output video file path. "
        "No intermediate progress messages."
    ),
    "memory": "Stateless. Each invocation is independent.",
    "error-handling": (
        "On vision/TTS API failure for a single frame: log + skip that "
        "frame. On video-composition failure: surface the error and abort."
    ),
}


# ---- Helpers -----------------------------------------------------------


def _parse_maybe_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return v or {}


def _connector_names_anywhere(uc: dict) -> set[str]:
    """Collect connector names from every place the LLM could place
    them on a UC: structured `connectors[]`, `tool_hints[]`, and
    free-form `tool_recommendations`. Returns a lowercase set."""
    names: set[str] = set()

    def add(value):
        if isinstance(value, str):
            names.add(value.lower())
        elif isinstance(value, dict):
            for k in ("name", "id", "connector", "service"):
                v = value.get(k)
                if isinstance(v, str):
                    names.add(v.lower())

    for key in ("connectors", "tool_hints", "tool_recommendations", "tools"):
        v = uc.get(key)
        if isinstance(v, list):
            for entry in v:
                add(entry)

    return names


# ---- Steps -------------------------------------------------------------


def step_preflight() -> None:
    print("\n[1/5] Preflight")
    try:
        h = get("/health")
    except Exception as e:
        record("preflight.health", "fail", error=str(e))
        raise SystemExit(
            "Test-automation server not responding. Launch the app with "
            "`npx tauri dev -- --features test-automation` first."
        ) from e
    record("preflight.health", "ok", server=h.get("server"), version=h.get("version"))


def step_start_build() -> dict:
    print("\n[2/5] Start build")
    r = bridge("startBuildFromIntent", {"intent": INTENT, "timeoutMs": 30_000}, 40)
    if not r.get("success"):
        record("start_build", "fail", error=r.get("error"))
        raise SystemExit(f"startBuildFromIntent failed: {r.get('error')}")
    record(
        "start_build",
        "ok",
        session_id=r.get("sessionId"),
        persona_id=r.get("personaId"),
    )
    return r


def step_answer_dimensions() -> str:
    print("\n[3/5] Answer build clarifying questions")

    max_rounds = 30
    for round_ix in range(max_rounds):
        phase_r = bridge(
            "waitForBuildPhase",
            {
                "phases": [
                    "awaiting_input",
                    "draft_ready",
                    "test_complete",
                    "promoted",
                    "failed",
                ],
                "timeoutMs": args.build_timeout * 1000,
            },
            args.build_timeout + 10,
        )
        phase = phase_r.get("phase")
        record(
            f"wait.phase.round{round_ix}",
            "ok" if phase_r.get("success") else "info",
            phase=phase,
            pending=phase_r.get("pendingCount"),
        )
        if phase == "failed":
            raise SystemExit(f"Build failed mid-flight: {phase_r.get('error')}")
        if phase in ("draft_ready", "test_complete", "promoted"):
            record("answer_dimensions", "ok", final_phase=phase, rounds=round_ix)
            return phase
        if phase != "awaiting_input":
            continue

        qs = bridge("listPendingBuildQuestions", {}, 20).get("questions") or []
        if not qs:
            time.sleep(1.0)
            continue

        batch = {}
        for q in qs:
            key = q.get("cellKey") or q.get("cell_key")
            if not key:
                continue
            batch[key] = ANSWERS.get(key, f"Auto-answer for phase K: {key}")

        if not batch:
            record(
                f"answer.round{round_ix}",
                "info",
                note="no recognizable cellKeys",
                qs=qs,
            )
            time.sleep(1.0)
            continue

        submit = bridge("answerPendingBuildQuestions", {"answers": batch}, 60)
        record(
            f"answer.round{round_ix}",
            "ok" if submit.get("success") else "fail",
            answered=submit.get("answered"),
            error=submit.get("error"),
        )
        if not submit.get("success"):
            raise SystemExit(f"answerPendingBuildQuestions failed: {submit.get('error')}")

    raise SystemExit(
        f"Exceeded max answer rounds ({max_rounds}) without reaching draft_ready"
    )


def _wait_for_agent_ir(persona_id: str, max_seconds: int = 60) -> bool:
    deadline = time.time() + max_seconds
    last_phase = None
    while time.time() < deadline:
        sess_resp = bridge("getActiveBuildSession", {"personaId": persona_id}, 15)
        if sess_resp.get("success"):
            session = sess_resp.get("session") or {}
            phase = session.get("phase")
            if phase != last_phase:
                record(
                    "wait_for_agent_ir.phase_change",
                    "info",
                    phase=phase,
                    has_agent_ir=session.get("agentIr") is not None,
                )
                last_phase = phase
            if session.get("agentIr") is not None:
                return True
        time.sleep(2.0)
    return False


def step_test_and_promote(persona_id: str) -> dict:
    print("\n[4/5] Test + promote draft")

    if not _wait_for_agent_ir(persona_id, max_seconds=60):
        record(
            "wait_for_agent_ir",
            "fail",
            error="session.agent_ir never landed within 60s",
        )
        raise SystemExit("Cannot promote — session.agent_ir is null")
    record("wait_for_agent_ir", "ok")

    test = bridge("triggerBuildTest", {}, 60)
    record(
        "test_build_draft",
        "ok" if test.get("success") else "info",
        report_keys=list((test.get("report") or {}).keys()) if test.get("success") else None,
        error=test.get("error"),
    )

    promote = bridge("promoteBuildDraft", {}, 90)
    if not promote.get("success"):
        record("promote_build_draft", "fail", error=promote.get("error"))
        raise SystemExit(f"promoteBuildDraft failed: {promote.get('error')}")
    result = promote.get("result") or {}
    record(
        "promote_build_draft",
        "ok",
        persona_id=promote.get("personaId"),
        triggers_created=result.get("triggers_created"),
    )
    return promote


def step_assert_acceptance(persona_id: str) -> dict:
    print("\n[5/5] Acceptance gates")

    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        record("acceptance.persona_detail", "fail", error=detail.get("error"))
        raise SystemExit(f"getPersonaDetail failed: {detail.get('error')}")
    d = detail.get("detail") or {}
    triggers = d.get("triggers") or []

    design_context = _parse_maybe_json(d.get("design_context"))
    use_cases = (
        design_context.get("useCases")
        or design_context.get("use_cases")
        or []
    )

    # Gate 1 — at least one UC.
    record(
        "acceptance.use_cases_count_ge_1",
        "ok" if len(use_cases) >= 1 else "fail",
        count=len(use_cases),
        titles=[uc.get("title") for uc in use_cases if isinstance(uc, dict)],
    )
    if len(use_cases) < 1:
        raise SystemExit("Phase K expected >=1 use_case, got 0")

    # Build the union of connector names referenced anywhere on any UC.
    # The LLM may also surface them via persona-level
    # `last_design_result.persona.connectors[]` (see C8 §Lessons #3) so
    # probe both planes.
    union: set[str] = set()
    for uc in use_cases:
        if isinstance(uc, dict):
            union |= _connector_names_anywhere(uc)

    last_design_result = _parse_maybe_json(d.get("last_design_result"))
    persona_block = (
        last_design_result.get("persona")
        if isinstance(last_design_result, dict)
        else None
    )
    if isinstance(persona_block, dict):
        for entry in persona_block.get("connectors") or []:
            if isinstance(entry, str):
                union.add(entry.lower())
            elif isinstance(entry, dict):
                for k in ("name", "id"):
                    v = entry.get(k)
                    if isinstance(v, str):
                        union.add(v.lower())

    # Gate 2 — google_gemini referenced.
    has_gemini = any(
        n == "google_gemini" or n == "gemini" or "gemini" in n
        for n in union
    )
    record(
        "acceptance.gemini_connector_referenced",
        "ok" if has_gemini else "fail",
        all_connector_names=sorted(union),
    )
    if not has_gemini:
        raise SystemExit(
            "No google_gemini connector reference on any UC or on persona "
            "block — LLM picked a sibling vision provider instead."
        )

    # Gate 3 — elevenlabs referenced.
    has_elevenlabs = any(
        n == "elevenlabs" or "elevenlabs" in n or "eleven_labs" in n
        for n in union
    )
    record(
        "acceptance.elevenlabs_connector_referenced",
        "ok" if has_elevenlabs else "fail",
        all_connector_names=sorted(union),
    )
    if not has_elevenlabs:
        raise SystemExit(
            "No elevenlabs connector reference on any UC or on persona "
            "block — LLM picked a sibling TTS provider instead."
        )

    # Gate 4 — NO webhook trigger (scenario is on-demand).
    webhook_triggers = [t for t in triggers if t.get("trigger_type") == "webhook"]
    record(
        "acceptance.no_webhook_trigger",
        "ok" if not webhook_triggers else "fail",
        webhook_count=len(webhook_triggers),
        all_trigger_types=[t.get("trigger_type") for t in triggers],
    )
    if webhook_triggers:
        raise SystemExit(
            "Phase K is on-demand only but a webhook trigger landed — "
            "build prompt rule 24 misfired."
        )

    return {
        "use_cases_count": len(use_cases),
        "all_connector_names": sorted(union),
        "trigger_types": [t.get("trigger_type") for t in triggers],
        "trigger_count": len(triggers),
    }


def step_cleanup(persona_id: str | None) -> None:
    if args.no_persona_cleanup or not persona_id:
        return
    print("\n[cleanup] deleteAgent")
    r = bridge("deleteAgent", {"nameOrId": persona_id}, 30)
    record(
        "cleanup.deleteAgent",
        "ok" if r.get("success") else "info",
        **{k: v for k, v in r.items() if k != "success"},
    )


# ---- Main --------------------------------------------------------------


def main() -> None:
    started = datetime.now(timezone.utc)
    persona_id = None
    summary_payload = None
    try:
        step_preflight()
        build = step_start_build()
        persona_id = build.get("personaId")
        step_answer_dimensions()
        promote = step_test_and_promote(persona_id)
        persona_id = promote.get("personaId") or persona_id
        summary_payload = step_assert_acceptance(persona_id)
        step_cleanup(persona_id)
    except SystemExit as e:
        record("scenario.abort", "fail", error=str(e))
    except Exception as e:
        record("scenario.crash", "fail", error=repr(e))
        raise
    finally:
        finished = datetime.now(timezone.utc)
        summary = {
            "scenario": "phase_k_video_narration_build_shape",
            "started": started.isoformat(),
            "finished": finished.isoformat(),
            "duration_s": (finished - started).total_seconds(),
            "result": summary_payload,
            "log": log,
        }
        if args.report:
            Path(args.report).parent.mkdir(parents=True, exist_ok=True)
            Path(args.report).write_text(json.dumps(summary, indent=2))
            print(f"\nWrote {args.report}")
        else:
            print("\n-- summary --")
            print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
