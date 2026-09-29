"""Refusal classification: plant the CLI's refusal envelopes and count what the harness does.

A usage-limit refusal from `claude -p --output-format json` is not an error to retry and
not a result to store. The CLI has been observed returning it as `subtype: "success"` with
`is_error: true`, exit 0 and zero API time, the reason only in the `result` prose; newer
versions forward the API status as `api_error_status`. Before this check, `LLM.complete`
retried every error four times (50 s of sleeps) and the judge's extraction swallowed the
final error - so a judge seat that closed mid-run stored a degraded verdict for every
remaining probe, and `--resume` counted each one as done.

Model-free and offline: `subprocess.run` and `time.sleep` are replaced for the duration, so
no CLI is launched and no time passes.

    py -m memory_year.checks.refusal_classification

Exit 0 = every planted envelope handled as constructed. Exit 1 = the report names each miss.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from .. import llm as llm_mod
from ..judge import judge_value
from ..llm import LLM, SeatLimit, failure_cause
from ..model import Probe

ZERO = {"input_tokens": 0, "output_tokens": 0}

# (name, envelope, expected cause, expected outcome of one complete() call, expected CLI invocations)
CASES: list[tuple[str, dict, str, str, int]] = [
    ("session limit, status forwarded",
     {"type": "result", "subtype": "success", "is_error": True, "api_error_status": 429,
      "result": "You've hit your session limit · resets 3:40pm", "duration_api_ms": 0, "usage": ZERO},
     "refused-allowance", "SeatLimit", 1),
    ("per-model rate limit, no status (older CLI)",
     {"type": "result", "subtype": "success", "is_error": True, "stop_reason": "stop_sequence",
      "result": "API Error: Rate limit reached", "duration_api_ms": 0, "usage": ZERO},
     "refused-allowance", "SeatLimit", 1),
    ("provider overloaded",
     {"type": "result", "subtype": "success", "is_error": True, "api_error_status": 529,
      "result": "API Error: Overloaded", "duration_api_ms": 0, "usage": ZERO},
     "refused-capacity", "RuntimeError", 4),
    ("server error",
     {"type": "result", "subtype": "success", "is_error": True, "api_error_status": 500,
      "result": "API Error: 500 Internal server error", "usage": ZERO},
     "error", "RuntimeError", 4),
    ("a real reply that quotes a limit",
     {"type": "result", "subtype": "success", "is_error": False,
      "result": "Their API rate limit is 100 requests per minute.", "usage": {"input_tokens": 40, "output_tokens": 12}},
     "error", "Reply", 1),
]


class _FakeCLI:
    def __init__(self, envelope: dict):
        self.envelope = envelope
        self.calls = 0
        self.slept = 0.0

    def run(self, *a, **k):
        self.calls += 1
        return subprocess.CompletedProcess(a[0] if a else [], 0, json.dumps(self.envelope), "")

    def sleep(self, secs):
        self.slept += secs


def _with_fake(envelope: dict, fn):
    fake = _FakeCLI(envelope)
    real_run, real_sleep = llm_mod.subprocess.run, llm_mod.time.sleep
    llm_mod.subprocess.run, llm_mod.time.sleep = fake.run, fake.sleep
    try:
        try:
            out = fn()
            kind = type(out).__name__
        except SeatLimit:
            kind = "SeatLimit"
        except RuntimeError:
            kind = "RuntimeError"
    finally:
        llm_mod.subprocess.run, llm_mod.time.sleep = real_run, real_sleep
    return kind, fake


def main() -> int:
    misses: list[str] = []
    tmp = Path(tempfile.mkdtemp(prefix="refusal-check-"))
    for i, (name, env, cause, outcome, calls) in enumerate(CASES):
        got = failure_cause(env) if env.get("is_error") else "error"
        if got != cause:
            misses.append(f"{name}: cause {got}, expected {cause}")
        model = LLM("claude:claude-sonnet-5@low", tmp / f"c{i}.sqlite", workdir=tmp)
        kind, fake = _with_fake(env, lambda: model.complete(f"probe {i}", "sys"))
        if kind != outcome or fake.calls != calls:
            misses.append(f"{name}: {kind} after {fake.calls} call(s), expected {outcome} after {calls}")
        print(f"  {name:45s} cause={got:18s} -> {kind} after {fake.calls} call(s), {fake.slept:.0f}s slept")

    # the judge path: a reply that needs extraction, judged while the judge's seat is closed
    probe = Probe(id="p1", day=1, minute=0, cls="reversal", scope="s", question="Which web framework?",
                  gold="Django", wrong=["Axum"])
    reply = "Django, changed from Axum in April."
    model = LLM("claude:claude-sonnet-5@low", tmp / "judge.sqlite", workdir=tmp)
    kind, fake = _with_fake(CASES[0][1], lambda: judge_value(probe, reply, model))
    if kind != "SeatLimit":
        misses.append(f"judge on a closed seat stored a verdict ({kind}) instead of stopping")
    print(f"  {'judge extraction on a closed seat':45s} -> {kind} after {fake.calls} call(s)")

    if misses:
        print("MISCLASSIFIED:")
        for m in misses:
            print("  - " + m)
        return 1
    print(f"ok - {len(CASES) + 1} planted cases handled as constructed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
