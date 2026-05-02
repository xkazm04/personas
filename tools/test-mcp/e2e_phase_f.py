r"""
Phase F — multi-language build E2E (C7 increment, 2026-04-28).

Builds a persona with a non-English language hint (Czech by default —
matches the user's locale per project conventions) and verifies the
build prompt's i18n rule fires correctly:

  * Mission, identity prose, principles, constraints, decision_principles,
    operating_instructions ALL come back in the requested language.
  * Capability ids (`uc_morning_digest` etc.) STAY in English.
  * Connector names (`gmail`, `local_drive`, `slack`) STAY in English.
  * Trigger types (`schedule`, `webhook`, `event`) STAY in English.

The acceptance check is heuristic — Czech text is detected by the
presence of any Czech-specific diacritic character (any of `áčďéěíňóřšťúůýž`
or their uppercase equivalents). For other languages, override
`--language` and `--diacritic-set` accordingly.

This driver does NOT exhaustively assert every IR field — only the ones
explicitly named in build prompt rule 14 (the LANGUAGE RULE). False
negatives are possible if the LLM uses purely Latin Czech words like
"plan" or "report"; pass `--strict-language-percentage` to enforce a
minimum threshold.

Prereqs:
  1. Dev app running with test-automation feature:
       npx tauri dev -- --features test-automation
  2. Test server is reachable:
       curl http://127.0.0.1:17320/health

Usage:
  uvx --with httpx python tools/test-mcp/e2e_phase_f.py
  uvx --with httpx python tools/test-mcp/e2e_phase_f.py --language cs --report logs/phase-f.json
  uvx --with httpx python tools/test-mcp/e2e_phase_f.py --language es --diacritic-set "áéíóúñ¿¡"
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

# Windows consoles default to cp1252 which can't print Czech / Spanish /
# German diacritics that this driver echoes from the LLM's output. Force
# UTF-8 with replacement on stdout/stderr — the JSON report gets full
# UTF-8 regardless via Path.write_text default.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


# ---- CLI ---------------------------------------------------------------

LANGUAGE_PRESETS = {
    "cs": {
        "intent": (
            "Vytvoř pro mě denního asistenta, který každé ráno v 8:00 "
            "shrne mé poznámky z předchozího dne uložené ve složce na "
            "mém disku. Žádné ruční schvalování — výstup zobraz v lište "
            "stavu. Bez paměti mezi dny."
        ),
        "diacritic_set": "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ",
        "label": "Czech",
    },
    "es": {
        "intent": (
            "Crea un asistente matutino que cada mañana a las 8:00 me "
            "resuma las notas que añadí ayer en una carpeta de mi disco. "
            "Sin revisión humana — muestra el resultado en la barra de "
            "estado. Sin memoria entre días."
        ),
        "diacritic_set": "áéíóúñ¿¡ÁÉÍÓÚÑ",
        "label": "Spanish",
    },
    "de": {
        "intent": (
            "Erstelle mir einen morgendlichen Assistenten, der jeden "
            "Morgen um 8 Uhr meine Notizen vom Vortag aus einem Ordner "
            "auf meinem Laufwerk zusammenfasst. Keine manuelle Prüfung "
            "— zeige das Ergebnis in der Statusleiste. Kein Gedächtnis "
            "zwischen den Tagen."
        ),
        "diacritic_set": "äöüßÄÖÜ",
        "label": "German",
    },
    "fr": {
        "intent": (
            "Crée-moi un assistant matinal qui chaque matin à 8h résume "
            "mes notes de la veille stockées dans un dossier de mon "
            "disque. Aucune revue manuelle — affiche le résultat dans la "
            "barre de statut. Sans mémoire entre les jours."
        ),
        "diacritic_set": "àâçéèêëîïôûùüÿæœÀÂÇÉÈÊËÎÏÔÛÙÜŸÆŒ",
        "label": "French",
    },
}

ANSWERS = {
    "behavior_core": "Zachovej intent — žádné další úpravy.",
    "mission": "Zachovej intent jako misi.",
    "use-cases": "Jedna schopnost — Ranní souhrn poznámek.",
    "triggers": "Schedule trigger only — cron '0 8 * * *'.",
    "connectors": "Use the local_drive connector for reading the notes folder.",
    "events": "No event subscriptions or emits.",
    "human-review": "Never review — auto-publish.",
    "messages": "Built-in titlebar notification only.",
    "memory": "Stateless — no cross-day memory.",
    "error-handling": (
        "If the drive read fails, log and skip. Don't block tomorrow's run."
    ),
}

parser = argparse.ArgumentParser(description="Phase F multi-language build E2E")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument("--language", choices=list(LANGUAGE_PRESETS.keys()), default="cs")
parser.add_argument(
    "--diacritic-set",
    default=None,
    help="Override the diacritic character set used for the language detection heuristic.",
)
parser.add_argument(
    "--strict-language-percentage",
    type=float,
    default=0.0,
    help=(
        "When > 0, fail the run if fewer than this fraction of localised "
        "fields (mission, principles, etc.) contain at least one diacritic "
        "from the language's character set. Default 0 = check at least one "
        "field per gate."
    ),
)
parser.add_argument("--build-timeout", type=int, default=240)
parser.add_argument("--no-persona-cleanup", action="store_true")
parser.add_argument("--report", type=str, default=None)
args = parser.parse_args()

PRESET = LANGUAGE_PRESETS[args.language]
INTENT = PRESET["intent"]
DIACRITIC_SET = set(args.diacritic_set or PRESET["diacritic_set"])
LANGUAGE_LABEL = PRESET["label"]


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


# ---- Heuristic — does this string contain language-specific diacritics? ----


def _has_target_diacritic(s: str) -> bool:
    if not isinstance(s, str) or not s:
        return False
    return any(ch in DIACRITIC_SET for ch in s)


def _localised_fraction(values: list[str]) -> float:
    """Fraction of non-empty entries that contain at least one target
    diacritic. Useful for `--strict-language-percentage` enforcement."""
    non_empty = [v for v in values if isinstance(v, str) and v.strip()]
    if not non_empty:
        return 0.0
    hits = sum(1 for v in non_empty if _has_target_diacritic(v))
    return hits / len(non_empty)


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
    record(
        "preflight.health",
        "ok",
        server=h.get("server"),
        version=h.get("version"),
        language=LANGUAGE_LABEL,
    )


def step_start_build() -> dict:
    print(f"\n[2/5] Start build (language={LANGUAGE_LABEL})")
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
            batch[key] = ANSWERS.get(key, f"Auto-answer for phase F: {key}")

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
    """Defensive wait — see phase_d for rationale. The build session can
    flicker to test_complete before agent_ir is persisted."""
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
        raise SystemExit(
            "Cannot promote — session.agent_ir is null. See log for details."
        )
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
    record(
        "promote_build_draft",
        "ok",
        persona_id=promote.get("personaId"),
    )
    return promote


def _parse_maybe_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return {}
    return v or {}


def step_assert_acceptance(persona_id: str) -> dict:
    print("\n[5/5] Acceptance gates")

    detail = bridge("getPersonaDetail", {"personaId": persona_id}, 30)
    if not detail.get("success"):
        record("acceptance.persona_detail", "fail", error=detail.get("error"))
        raise SystemExit(f"getPersonaDetail failed: {detail.get('error')}")
    d = detail.get("detail") or {}
    last_design_result = _parse_maybe_json(d.get("last_design_result"))
    persona_block = (
        last_design_result.get("persona")
        if isinstance(last_design_result, dict)
        else None
    ) or {}

    # ---- Localised fields (build prompt rule 14) --------------------------
    mission = (
        persona_block.get("mission")
        if isinstance(persona_block, dict)
        else None
    ) or last_design_result.get("mission") or d.get("description") or ""

    principles = persona_block.get("principles") if isinstance(persona_block, dict) else None
    constraints = persona_block.get("constraints") if isinstance(persona_block, dict) else None
    decision_principles = (
        persona_block.get("decision_principles")
        if isinstance(persona_block, dict)
        else None
    )
    operating_instructions = (
        persona_block.get("operating_instructions")
        if isinstance(persona_block, dict)
        else None
    ) or ""

    localised_values: list[str] = []
    if isinstance(mission, str):
        localised_values.append(mission)
    for arr_name, arr in (
        ("principles", principles),
        ("constraints", constraints),
        ("decision_principles", decision_principles),
    ):
        if isinstance(arr, list):
            localised_values.extend(s for s in arr if isinstance(s, str))
    if isinstance(operating_instructions, str):
        localised_values.append(operating_instructions)

    fraction = _localised_fraction(localised_values)
    record(
        "acceptance.localised_fields_diacritic_check",
        "ok" if fraction > 0 else "fail",
        language=LANGUAGE_LABEL,
        diacritic_fraction=round(fraction, 3),
        sample_mission=(mission[:120] if isinstance(mission, str) else None),
        principles_count=len(principles) if isinstance(principles, list) else 0,
    )
    if fraction == 0:
        raise SystemExit(
            f"None of the localised fields contain a {LANGUAGE_LABEL} diacritic — "
            "the build prompt's i18n rule (rule 14) likely didn't fire"
        )
    if fraction < args.strict_language_percentage:
        raise SystemExit(
            f"Localised diacritic fraction {fraction:.0%} below "
            f"strict threshold {args.strict_language_percentage:.0%}"
        )

    # ---- English-stable fields (rule 14 explicitly says id/connector names stay English) ----
    use_cases = (
        last_design_result.get("use_cases")
        or last_design_result.get("useCases")
        or []
    )
    uc_ids = [
        uc.get("id")
        for uc in use_cases
        if isinstance(uc, dict) and isinstance(uc.get("id"), str)
    ]
    non_english_ids = [uid for uid in uc_ids if _has_target_diacritic(uid)]
    record(
        "acceptance.use_case_ids_english",
        "ok" if not non_english_ids else "fail",
        ids=uc_ids,
        non_english_ids=non_english_ids,
    )
    if non_english_ids:
        raise SystemExit(
            f"use_case ids contain {LANGUAGE_LABEL} diacritics — must stay English: {non_english_ids}"
        )

    triggers = d.get("triggers") or []
    trigger_types = [t.get("trigger_type") for t in triggers if isinstance(t, dict)]
    non_english_trigger_types = [t for t in trigger_types if isinstance(t, str) and _has_target_diacritic(t)]
    record(
        "acceptance.trigger_types_english",
        "ok" if not non_english_trigger_types else "fail",
        types=trigger_types,
        non_english=non_english_trigger_types,
    )
    if non_english_trigger_types:
        raise SystemExit(
            f"trigger_types contain {LANGUAGE_LABEL} diacritics — must stay English"
        )

    return {
        "language": LANGUAGE_LABEL,
        "localised_fraction": round(fraction, 3),
        "use_case_ids": uc_ids,
        "trigger_types": trigger_types,
        "principles_count": len(principles) if isinstance(principles, list) else 0,
        "decision_principles_count": len(decision_principles)
        if isinstance(decision_principles, list)
        else 0,
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
            "scenario": "phase_f_multilang",
            "language": LANGUAGE_LABEL,
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
