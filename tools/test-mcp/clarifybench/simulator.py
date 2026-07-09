"""LLM user-simulator — plays a real user with a HIDDEN 'true business intent',
answering the build's clarifying questions one at a time.

The whole point of clarify-bench is to verify the build asks the RIGHT questions
and converges to the user's real intent. A canned answer map can't do that (it
only answers what you predicted it would ask); a simulated user can answer
whatever the build actually asks, revealing only what that question needs.

No API key: spawns the `claude` CLI under subscription auth (the repo rule — see
CLAUDE.md 'CLI = subscription, never API'). The nesting env markers
(CLAUDECODE / CLAUDE_CODE_*) are stripped so the child runs as a clean session
(see the 'Claude nesting env kills persistence' learning) and ANTHROPIC_API_KEY
is dropped so it never falls back to metered API billing.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass

_STRIP_PREFIXES = ("CLAUDE_CODE",)
_STRIP_EXACT = {"CLAUDECODE", "ANTHROPIC_API_KEY", "CLAUDE_CODE_SSE_PORT"}


def _clean_env() -> dict[str, str]:
    return {
        k: v
        for k, v in os.environ.items()
        if k not in _STRIP_EXACT and not any(k.startswith(p) for p in _STRIP_PREFIXES)
    }


def _claude_bin() -> str:
    # Windows resolves `claude` to claude.cmd; shutil.which finds the real target.
    return shutil.which("claude") or "claude"


@dataclass
class SimulatedAnswer:
    text: str
    ok: bool
    error: str | None = None


SIM_SYSTEM = (
    "You are role-playing a REAL, non-technical user of an AI-agent builder. You "
    "came in with a rough idea and the builder is asking you clarifying questions. "
    "Your ACTUAL goal (the builder does not fully know this yet) is:\n\n"
    "  {true_intent}\n\n"
    "Rules for how you answer:\n"
    "- Answer ONLY the specific question asked. Reveal just enough of your goal to "
    "answer it — do NOT dump your whole spec or volunteer unrelated details.\n"
    "- Be concrete and decisive (name the real tool/cadence/output you want), the "
    "way a real user with this goal would.\n"
    "- If options are offered, pick the one that best matches your goal (you may "
    "answer with the option's words or a short sentence).\n"
    "- Keep it to one or two short sentences. Natural, not robotic.\n"
    "- Output ONLY your answer — no preamble, no quotes, no explanation."
)


def simulate_answer(
    true_intent: str,
    question: str,
    options: list[str] | None = None,
    *,
    timeout_s: int = 90,
) -> SimulatedAnswer:
    """Answer one clarifying question as the hidden-intent user."""
    opts = ""
    if options:
        opts = "\n\nOptions offered:\n" + "\n".join(f"- {o}" for o in options if o)
    prompt = (
        SIM_SYSTEM.format(true_intent=true_intent.strip())
        + "\n\n=== The builder asks you ===\n"
        + question.strip()
        + opts
        + "\n\n=== Your answer (only the answer) ==="
    )
    try:
        proc = subprocess.run(
            [_claude_bin(), "-p", prompt],
            env=_clean_env(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return SimulatedAnswer(text="", ok=False, error=f"simulator timed out after {timeout_s}s")
    except Exception as e:  # noqa: BLE001 — surface any spawn failure to the caller
        return SimulatedAnswer(text="", ok=False, error=f"simulator spawn failed: {e}")

    out = (proc.stdout or "").strip()
    if proc.returncode != 0 or not out:
        return SimulatedAnswer(
            text=out,
            ok=False,
            error=f"claude exit {proc.returncode}: {(proc.stderr or '')[:200]}",
        )
    # Collapse to a compact answer; the build ingests it as free text.
    return SimulatedAnswer(text=out, ok=True)
