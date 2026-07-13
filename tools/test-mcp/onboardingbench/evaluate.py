"""Two-layer evaluation.

LAYER 1 — deterministic gates (this file). Machine-checkable facts: did it
converge, did it ask within the expected band, did the connector picker render
for the right category, is the chosen connector bound and the decoy absent, is
the capability count inside the scope-creep guard, is there a real system prompt.
These gate CORRECTNESS and need no LLM.

LAYER 2 — a Claude-as-judge pass over the emitted bundle, scoring QUALITY
(did it ask the right things, converge to the true intent, avoid assuming,
stay inside the round cap, produce coherent metadata). See judge-prompt.md.

A scenario whose connector category has no credential on this machine is
`degraded`: the ask-gates still apply, the choose-gates are skipped, not failed.
"""
from __future__ import annotations

from typing import Any

RUBRIC = [
    ("asked_before_assuming", 2.0,
     "For each must_clarify dimension, did the build ASK rather than silently assume? "
     "One step down per dimension it resolved without asking."),
    ("no_wrong_assumptions", 1.5,
     "Did the final persona avoid every must_not_assume value that the user never confirmed? "
     "Binding the decoy connector, or auto-sending without asking, is a hard fail."),
    ("connector_choice_correctness", 2.0,
     "If a connector_category question was expected: did it appear, did the picker render for the "
     "right category, and did the promoted persona bind the connector the user actually chose "
     "(not the popular default)? If NO connector question was expected (the prompt named it), "
     "penalise asking anyway."),
    ("question_quality", 1.5,
     "Clear, relevant, well-scoped, non-redundant questions that don't re-ask what the prompt stated."),
    ("convergence", 2.0,
     "Does the composed persona (capabilities, connectors, triggers) match the hidden true_intent "
     "as revealed through the answers? Penalise drift, missing jobs, invented scope."),
    ("efficiency_round_cap", 1.5,
     "Converged inside the design's round cap (<=1 mission round + <=1 batched round of <=4). "
     "Penalise BOTH over-asking (many serial rounds) and hanging."),
    ("metadata_coherence", 1.0,
     "Do the persona's name, description, system prompt and capability titles read like the true "
     "intent — coherent, specific, non-generic?"),
]


# ---------------------------------------------------------------- extraction
def _connector_service_types(meta: dict) -> set[str]:
    out: set[str] = set()
    detail = meta.get("detail") or {}
    for t in (detail.get("tools") or []):
        name = t if isinstance(t, str) else (t.get("name") or "")
        out.add(str(name).lower())
    row = meta.get("row") or {}
    dc = row.get("design_context") or detail.get("design_context") or {}
    if isinstance(dc, dict):
        for c in (dc.get("requiredConnectors") or dc.get("required_connectors") or []):
            n = c if isinstance(c, str) else (c.get("service_type") or c.get("name") or "")
            if n:
                out.add(str(n).lower())
        for k in ("credentialLinks", "credential_links"):
            links = dc.get(k) or {}
            if isinstance(links, dict):
                out.update(str(x).lower() for x in links.keys())
    return out


def _capabilities(meta: dict) -> list[dict]:
    row = meta.get("row") or {}
    detail = meta.get("detail") or {}
    dc = row.get("design_context") or detail.get("design_context") or {}
    if isinstance(dc, dict):
        return dc.get("useCases") or dc.get("use_cases") or []
    return []


def _trigger_types(meta: dict) -> set[str]:
    detail = meta.get("detail") or {}
    return {str(t.get("trigger_type") or t.get("triggerType") or "").lower()
            for t in (detail.get("triggers") or []) if isinstance(t, dict)}


# --------------------------------------------------------------------- gates
def evaluate_scenario(scenario: dict, run: dict) -> dict[str, Any]:
    ma = scenario.get("metadata_assertions") or {}
    conn = run.get("connector_resolution") or {}
    degraded = conn.get("mode") == "degraded_no_credential"
    meta = run.get("metadata") or {}
    bound = _connector_service_types(meta)
    caps = _capabilities(meta)
    gates: list[dict] = []

    def gate(key: str, passed: bool, expected: Any, actual: Any, *, skipped: bool = False) -> None:
        gates.append({"key": key, "passed": bool(passed), "skipped": skipped,
                      "expected": str(expected), "actual": str(actual)})

    # 1. convergence
    gate("converged", run.get("converged") is True,
         ma.get("require_terminal_phase", "draft_ready"), run.get("terminal_phase"))

    # 2. question band
    band = scenario.get("expect_questions") or {}
    lo, hi = band.get("min", 0), band.get("max", 99)
    n = run.get("questions", 0)
    gate("question_band", lo <= n <= hi, f"{lo}..{hi}", n)

    # 3/4. connector ask / don't-ask
    seen = bool(run.get("connector_question_seen"))
    if scenario.get("expect_connector_question"):
        gate("connector_question_asked", seen, "a connector_category question", seen)
        cat = (scenario.get("connector_choice") or {}).get("category")
        pickers = [x.get("picker_testid_present") for x in (run.get("transcript") or [])
                   if x.get("connector_category")]
        gate("connector_picker_rendered", any(p is True for p in pickers) if pickers else False,
             f"vault-connector-picker-{cat}", pickers)
    elif scenario.get("expect_no_connector_question"):
        gate("connector_question_not_asked", not seen,
             "no connector_category question (it was named/derivable)", seen)

    # 5/6. bindings — skipped when the credential doesn't exist on this machine
    req = [r for r in (ma.get("require_connector_service_types") or [])]
    fbd = [f for f in (ma.get("forbid_connector_service_types") or [])]
    resolved_req = [conn.get("pick") if r == "{{CONNECTOR}}" else r for r in req]
    resolved_fbd = [conn.get("decoy") if f == "{{DECOY}}" else f for f in fbd]
    resolved_req = [r for r in resolved_req if r]
    resolved_fbd = [f for f in resolved_fbd if f]
    if resolved_req:
        if degraded:
            gate("connector_bound", True, resolved_req, "skipped (no credential)", skipped=True)
        else:
            gate("connector_bound", all(r.lower() in bound for r in resolved_req),
                 resolved_req, sorted(bound))
    if resolved_fbd:
        if degraded:
            gate("decoy_not_bound", True, resolved_fbd, "skipped (no credential)", skipped=True)
        else:
            gate("decoy_not_bound", not any(f.lower() in bound for f in resolved_fbd),
                 f"none of {resolved_fbd}", sorted(bound))

    # 7. scope-creep guard
    lo_c, hi_c = ma.get("min_capabilities", 1), ma.get("max_capabilities", 99)
    gate("capability_count", lo_c <= len(caps) <= hi_c, f"{lo_c}..{hi_c}", len(caps))

    # 8. real system prompt
    sp = ((meta.get("row") or {}).get("system_prompt") or "")
    gate("system_prompt", len(sp) >= ma.get("system_prompt_min_chars", 200),
         f">= {ma.get('system_prompt_min_chars', 200)} chars", len(sp))

    # 9. trigger — HARD only for hand-written controls (see generator comment)
    if ma.get("expect_trigger_type") and ma.get("trigger_assertion") == "hard":
        tt = _trigger_types(meta)
        gate("trigger_type", ma["expect_trigger_type"] in tt, ma["expect_trigger_type"], sorted(tt))

    scored = [g for g in gates if not g["skipped"]]
    return {
        "gates": gates,
        "gates_total": len(scored),
        "gates_passed": sum(1 for g in scored if g["passed"]),
        "degraded": degraded,
        "connector_resolution": conn,
    }


# -------------------------------------------------------------------- bundle
def judge_bundle(scenario: dict, run: dict, verdict: dict) -> str:
    L: list[str] = []
    L.append(f"# onboarding-bench judge bundle — {scenario['id']}")
    L.append("")
    L.append(f"- tier **{scenario['vagueness_tier']}** · area **{scenario['business_area']}** "
             f"· kind **{scenario['kind']}**")
    L.append(f"- terminal **{run.get('terminal_phase')}** · converged={run.get('converged')} "
             f"· rounds **{run.get('rounds')}** · questions **{run.get('questions')}** "
             f"· {run.get('seconds')}s")
    L.append(f"- deterministic gates: **{verdict['gates_passed']}/{verdict['gates_total']}**"
             + ("  _(DEGRADED: connector credential absent — choose-gates skipped)_" if verdict["degraded"] else ""))
    if run.get("error"):
        L.append(f"- error: {run['error']}")
    L.append("")
    L.append("## What the user typed (vague intent)")
    L.append("```\n" + scenario["vague_intent"].strip() + "\n```")
    L.append("")
    L.append("## Hidden TRUE intent (user-sim answered from this; the build never saw it)")
    L.append("```\n" + scenario["true_intent"].strip() + "\n```")
    L.append("")
    L.append("## Expectations")
    L.append(f"- must_clarify: {scenario.get('must_clarify')}")
    L.append(f"- must_not_assume: {scenario.get('must_not_assume')}")
    L.append(f"- expect_questions: {scenario.get('expect_questions')}")
    L.append(f"- connector: ask={scenario.get('expect_connector_question')} "
             f"no_ask={scenario.get('expect_no_connector_question')} "
             f"choice={scenario.get('connector_choice')} resolved={verdict['connector_resolution']}")
    L.append("")
    L.append("## Q&A transcript (through the real UI)")
    tr = run.get("transcript") or []
    if not tr:
        L.append("_(no clarifying questions were asked)_")
    for x in tr:
        cat = f" · connector_category={x['connector_category']} (picker_present={x['picker_testid_present']})" \
            if x.get("connector_category") else ""
        L.append(f"**R{x['round']} [{x['cell_key']}]**{cat} Q: {x['question']}")
        if x.get("options"):
            L.append(f"    options: {x['options']}")
        L.append(f"    A (user-sim): {x['answer']}")
    L.append("")
    L.append("## Composed persona metadata")
    row = (run.get("metadata") or {}).get("row") or {}
    caps = _capabilities(run.get("metadata") or {})
    L.append(f"- name: {row.get('name')!r} · setup_status: {row.get('setup_status')}")
    L.append(f"- description: {(row.get('description') or '')[:200]}")
    L.append(f"- system_prompt: {len(row.get('system_prompt') or '')} chars")
    L.append(f"- capabilities ({len(caps)}):")
    for c in caps:
        L.append(f"  - {c.get('title') or c.get('id')} — tool_hints={c.get('tool_hints') or c.get('toolHints')}")
    L.append(f"- connectors bound: {sorted(_connector_service_types(run.get('metadata') or {}))}")
    L.append(f"- triggers: {sorted(_trigger_types(run.get('metadata') or {}))}")
    L.append("")
    L.append("## Deterministic gate results")
    for g in verdict["gates"]:
        mark = "SKIP" if g["skipped"] else ("PASS" if g["passed"] else "FAIL")
        L.append(f"- [{mark}] {g['key']}: expected {g['expected']} · actual {g['actual']}")
    L.append("")
    L.append("## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)")
    for key, w, prompt in RUBRIC:
        L.append(f"- **{key}** (weight {w}): {prompt}")
    L.append("")
    L.append("Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: "
             "Σ(score×weight)/Σ(weight×3), notes}")
    return "\n".join(L)
