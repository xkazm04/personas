"""clarify-bench — verify the persona build ASKS the right clarifying questions
on ambiguous intent and converges to the user's real business intent (rather than
assuming), within the design's round cap.

Sibling to build-bench: build-bench measures a headless one-shot build's speed +
structure; clarify-bench measures interactive question QUALITY against vague input,
with an LLM-simulated user answering from a hidden true intent.
"""
from __future__ import annotations

from .driver import ClarifyRun, QAExchange, run_clarify_build
from .evaluate import judge_bundle
from .simulator import simulate_answer

__all__ = [
    "ClarifyRun",
    "QAExchange",
    "run_clarify_build",
    "judge_bundle",
    "simulate_answer",
]
