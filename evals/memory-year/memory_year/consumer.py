"""The consumer: one model, one prompt, one elaboration regime, every rung.

The prompt permits UNKNOWN. That is not politeness: an answerer forbidden from abstaining
turns every miss into a guess, and a lenient judge then rewards the guess.
"""
from __future__ import annotations

from .llm import LLM, Reply

SYSTEM_DIRECT = (
    "You are the user's long-running assistant. Answer the user's question using ONLY the memory "
    "context provided. If the context does not contain the answer, reply exactly: UNKNOWN. "
    "Be brief: one line for a value, an ordered list for steps. Do not explain your reasoning."
)
SYSTEM_ELABORATE = (
    "You are the user's long-running assistant. First, in a section titled REASONING, quote the lines "
    "of the memory context that bear on the question and reason about which is current. Then, in a "
    "section titled ANSWER, give the answer, or exactly UNKNOWN if the context does not contain it."
)


def answer(llm: LLM, question: str, context: str, elaboration: str = "direct", clock_iso: str = "") -> Reply:
    system = SYSTEM_DIRECT if elaboration == "direct" else SYSTEM_ELABORATE
    prompt = f"Today is {clock_iso[:10]}.\n\nMEMORY CONTEXT:\n{context if context else '(empty)'}\n\nQUESTION: {question}\n"
    return llm.complete(prompt, system)


def final_answer(text: str, elaboration: str) -> str:
    if elaboration == "direct":
        return text.strip()
    if "ANSWER" in text:
        return text.split("ANSWER", 1)[1].lstrip(":").strip()
    return text.strip()
