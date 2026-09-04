"""Judging: deterministic wherever the gold is a value; a model only for form classes.

The deterministic judge distinguishes four outcomes the doctrine says must never be
collapsed: correct, wrong, wrong-with-the-OLD-value (the supersedence failure), and
abstained. A refusal is not a wrong answer and a stale answer is not merely wrong.
"""
from __future__ import annotations

import re

from .llm import LLM
from .model import Probe

EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


def norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[`*_\"'()\[\].,;:!?]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


NO_RECORD_PHRASES = (
    "i don t have", "i do not have", "i don t know of", "no record", "no entry",
    "nothing on file", "nothing recorded", "nothing about", "never been recorded",
    "not recorded", "don t have that", "don t have one", "have not recorded",
)


def is_abstention(text: str) -> bool:
    t = norm(text)
    if not t:
        return False
    if t.startswith("unknown") or t in ("i don t know", "i do not know", "not known"):
        return True
    # a design answering in its own voice abstains in a sentence, not with a marker; the
    # marker is the harness consumer's convention and must not be the only accepted form
    return any(ph in t for ph in NO_RECORD_PHRASES)


ARTICLES = ("a ", "an ", "the ")


def strip_article(v: str) -> str:
    for art in ARTICLES:
        if v.startswith(art):
            return v[len(art):]
    return v


def contains_value(answer: str, value: str) -> bool:
    a, v = norm(answer), strip_article(norm(value))
    if not v:
        return False
    if v in a:
        return True
    # tolerate the value's head token for multi-word values ("Postgres 16" -> "postgres")
    head = v.split(" ")[0]
    return len(head) >= 4 and head in a


ASSERT_SYSTEM = (
    "You extract, you never judge. You are given a question and a reply someone gave to it. "
    "Report only which value the reply asserts is CURRENT."
)


def asserted_value(llm: LLM, question: str, answer: str) -> str:
    """The value a verbose reply ASSERTS, stripped of the history it narrates.

    A judge written for a terse consumer reads 'Django, changed from Axum in April' as an
    answer that names both values and scores it stale. That is the judge's defect, not the
    design's: the reply asserts one value and dates the other. This collapses such a reply
    to its assertion before the deterministic comparison runs, so a design answering in its
    own conversational voice is scored on what it claims, not on what it mentions.
    """
    prompt = (
        f"Question: {question}\n\nReply:\n{answer}\n\n"
        "What value does the reply assert is CURRENT for that question? Answer with the value "
        "alone, no sentence, no punctuation. A value the reply mentions only as history - what "
        "something used to be, what it changed from, what was dropped - is NOT the current "
        "value. If the reply asserts no value, or says it has no record of one, answer exactly "
        "NONE."
    )
    try:
        return llm.complete(prompt, system=ASSERT_SYSTEM).text.strip().splitlines()[0][:120]
    except Exception:
        return ""


def needs_extraction(probe: Probe, answer: str) -> bool:
    """When the deterministic reading is unsafe: a long reply, or one naming the gold and a
    superseded value together. Terse answers keep the deterministic path untouched, so the
    ladder's other rungs are judged exactly as before."""
    if probe.cls == "procedure" or probe.gold == "FORM":
        return False
    if len(answer) > 200:
        return True
    if probe.gold and probe.gold != "UNKNOWN" and contains_value(answer, probe.gold):
        return any(contains_value(answer, w) and norm(w) not in norm(probe.gold) for w in probe.wrong)
    return False


def judge_value(probe: Probe, answer: str, llm: LLM | None = None) -> tuple[str, str]:
    """-> (verdict, note)"""
    if llm is not None and needs_extraction(probe, answer):
        v = asserted_value(llm, probe.question, answer)
        if v:
            if norm(v) in ("none", "no value", "unknown"):
                answer = "UNKNOWN"
            else:
                answer = v
    if probe.gold == "UNKNOWN":
        if is_abstention(answer):
            return "correct", "abstained as required"
        for w in probe.wrong:
            if contains_value(answer, w):
                return "wrong-old", f"stated expired/absent value {w!r}"
        # a confident-looking non-abstention is wrong for a distractor; a "no longer"/"dropped" statement is right for expired
        if probe.cls == "expired" and re.search(r"no longer|dropped|wound down|removed|nothing replaces|doesn t have|does not have", norm(answer)):
            return "correct", "stated it no longer holds"
        return "wrong", "answered a question with no answer"
    if probe.gold and probe.cls == "procedure":
        steps = [norm(s) for s in probe.gold.split(" -> ")]
        a = norm(answer)
        hits = sum(1 for s in steps if s in a or (len(s.split()) > 1 and all(w in a for w in s.split()[-2:])))
        if hits == len(steps):
            return "correct", f"{hits}/{len(steps)} steps"
        if hits >= max(1, len(steps) - 1):
            return "correct", f"{hits}/{len(steps)} steps (one missing tolerated)"
        return ("abstained" if is_abstention(answer) else "wrong"), f"{hits}/{len(steps)} steps"
    if is_abstention(answer):
        return "abstained", ""
    if contains_value(answer, probe.gold):
        # an answer that names the old value alongside the new one has not superseded it
        for w in probe.wrong:
            if contains_value(answer, w) and norm(w) not in norm(probe.gold):
                return "wrong-old", f"named both {probe.gold!r} and old {w!r}"
        return "correct", ""
    for w in probe.wrong:
        if contains_value(answer, w):
            return "wrong-old", f"stated old value {w!r}"
    return "wrong", ""


def judge_form(probe: Probe, answer: str, llm: LLM | None, strict: bool = True) -> tuple[str, str, str]:
    """-> (verdict, note, judge-name). Deterministic where the form is checkable; model otherwise."""
    form = probe.form or ""
    if form == "no-emoji":
        return ("wrong" if EMOJI_RE.search(answer) else "correct"), "emoji check", "deterministic"
    if form == "no-em-dash":
        return ("wrong" if "—" in answer else "correct"), "em-dash check", "deterministic"
    if form == "asks-confirmation":
        t = norm(answer)
        asks = "?" in answer and re.search(r"confirm|are you sure|proceed|go ahead|should i|do you want", t)
        return ("correct" if asks else "wrong"), "confirmation-question check", "deterministic"
    if form == "cite-source":
        t = norm(answer)
        cites = re.search(r"you told me|you said|you mentioned|from (our|your)|on \d{4}-\d{2}-\d{2}|as noted|according to", t)
        return ("correct" if cites else "wrong"), "citation check", "deterministic"
    if form.startswith("applies:"):
        fix = form.split(":", 1)[1]
        # deterministic first: the fix's key phrase ("check that X is handled") present in the answer
        m = re.search(r"check that (.+?) is handled", norm(fix))
        if m and m.group(1) in norm(answer):
            return "correct", "fix phrase present", "deterministic"
        if is_abstention(answer):
            return "abstained", "", "deterministic"
        if llm is None:
            return "error", "model judge required", "none"
        mode = "strict" if strict else "lenient"
        rubric = ("Answer YES only if the reply explicitly applies or mentions this fix as the first thing it does; otherwise NO."
                  if strict else "Answer YES if the reply mentions or applies the fix anywhere; otherwise NO.")
        prompt = f"FIX: {fix}\n\nREPLY:\n{answer}\n\n{rubric} Reply with YES or NO only."
        r = llm.complete(prompt, "You are a strict grader. Output only YES or NO.")
        return ("correct" if r.text.strip().upper().startswith("YES") else "wrong"), f"model-{mode}", f"model-{mode}"
    return "error", f"unknown form {form}", "none"
