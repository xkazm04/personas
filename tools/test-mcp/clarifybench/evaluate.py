"""Judge bundle for the clarify-bench quality pass (Claude-Code-as-judge).

Correctness here is not a promote/gate — it's whether the build ASKED the right
questions and CONVERGED to the user's real intent without assuming or hanging.
So there are no hard assertions; the bundle carries the vague intent, the hidden
true intent, the must-clarify / must-not-assume expectations, the full Q&A
transcript, and the final resolved design, for the operator's Claude judge to
score against the rubric below.
"""
from __future__ import annotations

from .driver import ClarifyRun

# Default rubric (a fixture may override via fixture["rubric"]["dimensions"]).
DEFAULT_DIMENSIONS = [
    {
        "key": "asked_before_assuming",
        "weight": 2.0,
        "prompt": "For EACH dimension in must_clarify, did the build ASK a question targeting it "
        "(present in the transcript) rather than silently assuming a value? Score down one step per "
        "must-clarify dimension it resolved without asking. This is the anti-'assumed too much' check.",
    },
    {
        "key": "no_wrong_assumptions",
        "weight": 1.5,
        "prompt": "Did the final design AVOID baking in any value listed in must_not_assume that the "
        "user never confirmed through an answer (e.g. assuming Slack/Gmail/a specific source the user "
        "wasn't asked about)? Any unconfirmed wrong assumption is a hard fail on this dimension.",
    },
    {
        "key": "question_quality",
        "weight": 1.5,
        "prompt": "Were the questions clear, relevant, and well-scoped — offering sensible options or "
        "competing directions where useful, non-redundant, and not asking for things already stated in "
        "the intent? Penalise vague, duplicate, or leading questions.",
    },
    {
        "key": "convergence",
        "weight": 2.0,
        "prompt": "Does the FINAL resolved persona (capabilities + connectors + triggers) match the "
        "hidden true_intent as it was revealed through the answers? Penalise drift, missing jobs, or "
        "invented scope.",
    },
    {
        "key": "efficiency_round_cap",
        "weight": 1.5,
        "prompt": "Did it converge efficiently — within the design's round cap (≤1 mission round + ≤1 "
        "Phase-C round of ≤4 questions)? Penalise BOTH over-asking (many rounds / >4 per round / "
        "redundant rounds) AND hanging (never reached a terminal phase). A build that never terminated "
        "or exceeded the round cap scores 0-1 here.",
    },
]


def _fmt_transcript(run: ClarifyRun) -> str:
    if not run.transcript:
        return "_(no clarifying questions were asked)_"
    lines = []
    for x in run.transcript:
        opts = f"  · options: {x.options}" if x.options else ""
        cat = f"  · connector_category: {x.connector_category}" if x.connector_category else ""
        lines.append(f"**R{x.round} [{x.cell_key}]** Q: {x.question}{opts}{cat}")
        lines.append(f"    A (user-sim): {x.answer}")
        if not x.sim_ok:
            lines.append(f"    ⚠ simulator error: {x.sim_error}")
    return "\n".join(lines)


def judge_bundle(fixture: dict, run: ClarifyRun, cap) -> str:
    dims = (fixture.get("rubric") or {}).get("dimensions") or DEFAULT_DIMENSIONS
    L: list[str] = []
    L.append(f"# clarify-bench judge bundle — {fixture['id']} / variant={run.variant}")
    L.append("")
    L.append(f"- terminal phase: **{run.terminal_phase}** (ok={run.ok}, hung={run.hung})")
    L.append(f"- rounds: **{run.num_rounds}** · questions asked: **{run.num_questions}** · "
             f"time: {run.total_seconds}s")
    if run.error_message:
        L.append(f"- error: {run.error_message}")
    L.append("")
    L.append("## Vague intent the user typed")
    L.append("```\n" + run.vague_intent.strip() + "\n```")
    L.append("")
    L.append("## Hidden TRUE business intent (the user-sim answered from this — the build never saw it directly)")
    L.append("```\n" + run.true_intent.strip() + "\n```")
    L.append("")
    L.append("## Expectations")
    L.append(f"- **must_clarify** (should ASK about each): {fixture.get('must_clarify', [])}")
    L.append(f"- **must_not_assume** (must NOT bake in unasked): {fixture.get('must_not_assume', [])}")
    exp_q = fixture.get("expect_questions")
    if exp_q is not None:
        L.append(f"- **expect_questions**: {exp_q}  (e.g. a fully-specified control expects ~0)")
    L.append("")
    L.append("## Q&A transcript (what the build actually asked, in order)")
    L.append(_fmt_transcript(run))
    L.append("")
    L.append(f"## Final resolved persona (source: {getattr(cap, 'source', '?')})")
    L.append(f"- capabilities ({len(cap.capabilities)}):")
    for c in cap.capabilities:
        L.append(f"  - **{c.get('title') or c.get('id')}** — tool_hints={c.get('tool_hints')} "
                 f"trigger={c.get('trigger')}")
    L.append(f"- required_connectors: {[c.get('service_type') for c in cap.connectors]}")
    L.append("")
    L.append("## Score each dimension 0-3 (3=fully meets, 2=minor gap, 1=real gap, 0=fails)")
    for d in dims:
        L.append(f"- **{d['key']}** (weight {d['weight']}): {d['prompt']}")
    L.append("")
    L.append("Return JSON: {scores:{<key>:{score,rationale}}, weighted_total: Σ(score×weight)/Σ(weight×3), notes}")
    return "\n".join(L)
