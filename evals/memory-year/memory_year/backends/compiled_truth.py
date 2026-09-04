"""Document-level rewrite as the unit of memory - the arm against fact-level flagging.

The design this arm is modelled on does not store facts as rows. Its unit of memory is a
page per subject, in two zones: a `compiled truth` section that is REWRITTEN in full
whenever enough new information has landed, and an append-only `timeline` that is never
edited. Retiring a stale value is not a flag on a row; it is the disappearance of a
sentence from the current text.

CLAIM UNDER TEST: rewriting the document makes staleness structurally unretrievable. A
row-based store can only mark a stale fact - and a marked row is still a row, still
embedded, still eligible to be retrieved and read out by a consumer that skims. A
rewritten page has nowhere for the old value to hide: it is not in the text at all.

A WIN looks like: reversal and expired probes answered from the current value with
wrong-old near zero, at a write cost of roughly one model call per `dirty_threshold`
events on a page rather than one per event - cheaper than per-event extraction and
strictly better on supersedence than raw retrieval.

A LOSS looks like any of: (a) the rewrite drops still-true detail, so stable probes that
raw retrieval answers from the raw record go UNKNOWN - the rewrite is lossy compression
and the loss is silent; (b) the rewrite is timid, keeping "previously X, now Y", which
reintroduces exactly the stale string the design claimed to make unreachable; (c) recall
degrades on a busy page, because a page is the retrieval unit and a page about a busy
project is a single blob that either fits the budget or does not.

Either result is evidence. A recompile the model fails to produce is also evidence (see
`recompile_failures`) - it is a fact about the design's dependence on a model call at
consolidation time, not a harness fault.
"""
from __future__ import annotations

import re
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import Backend, Context, Cost
from ..clock import Clock
from ..embed import DEFAULT_EMBEDDER, Embedder
from ..llm import LLM, Reply, estimate_tokens
from ..model import Event, Probe
from .full_history import render

# the same cache the runner uses, so a re-run of this rung costs nothing; resolved from the
# module, not the working directory, because `make()` does not hand this rung a cache_dir
DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[2] / "out" / "cache"

SCOPE_BONUS = 0.25          # additive, on top of a cosine in [-1, 1]
USER_SCOPES = {"user", "me", "self"}
_FIRST_PERSON = re.compile(r"\b(my|mine|me|i|myself)\b", re.I)
_ISO_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
_FENCED = re.compile(r"```[a-zA-Z0-9_-]*\s*\n?(.*?)(?:\n?\s*```|\Z)", re.S)
_PREFACE = re.compile(
    r"^\s*(here (is|are)|this is|updated|rewritten|revised|new)\b[^\n]{0,80}:\s*$", re.I)
_HEADING = re.compile(r"^\s*#{1,6}\s*(compiled\s+truth|current\s+truth|truth)\s*:?\s*$", re.I)

SYSTEM = (
    "You maintain one page of long-term memory about one subject. The page has two zones: "
    "an append-only TIMELINE of dated entries, which is the evidence and is never edited, "
    "and a COMPILED TRUTH, which is the current reading of that evidence. You are asked "
    "only ever to rewrite the compiled truth. Output the rewritten compiled truth and "
    "nothing else: no preamble, no code fence, no closing remark."
)


@dataclass
class Page:
    """One subject's page. `timeline` is append-only; see `_append`."""

    scope: str
    compiled_truth: str = ""
    timeline: list[str] = field(default_factory=list)
    dirty: int = 0              # lines appended since the last SUCCESSFUL recompile
    compiled_through: int = 0   # timeline index the current compiled truth was written from
    recompiles: int = 0

    def render(self) -> str:
        return (f"# {self.scope}\n\n## compiled truth\n{self.compiled_truth}\n\n"
                f"## timeline\n" + "\n".join(self.timeline) + "\n")


class CompiledTruth(Backend):
    """Pages, not rows: a rewritten compiled-truth block over an append-only timeline."""

    name = "compiled-truth"

    def __init__(self, model: str = "claude:claude-sonnet-5@low",
                 cache_dir: Path | str | None = None,
                 embedder: str = DEFAULT_EMBEDDER,
                 timeline_tail: int = 12,
                 dirty_threshold: int = 6) -> None:
        cache = Path(cache_dir) if cache_dir else DEFAULT_CACHE_DIR
        self.model = model
        self.llm = LLM(model, cache / "llm.sqlite")
        self.embedder = Embedder(embedder, cache / "emb.sqlite")
        self.timeline_tail = int(timeline_tail)
        self.dirty_threshold = int(dirty_threshold)
        self.pages: dict[str, Page] = {}
        # derived retrieval index: page key -> (text that was embedded, vector)
        self._vecs: dict[str, tuple[str, np.ndarray]] = {}
        self._cost = Cost()
        self._lock = threading.Lock()
        self.recompiles = 0
        self.recompile_failures: list[tuple[int, str, str]] = []   # (day, page, message)

    # ---------------------------------------------------------------- write path

    def _append(self, page: Page, line: str) -> None:
        """The ONLY mutator of a timeline, and it only ever appends.

        Rewriting history is the one thing this design forbids. The compiled truth is a
        lossy, model-authored reading of the evidence; if the evidence could also be
        rewritten, a bad recompile would be unrecoverable and the page could never be
        rebuilt. Append-only means every compiled truth in this run is reproducible from
        the timeline alone - which is what makes a lost fact diagnosable as a rewrite
        failure rather than an ingestion failure.
        """
        before = len(page.timeline)
        page.timeline.append(line)
        assert len(page.timeline) == before + 1, "timeline is append-only"
        page.dirty += 1

    def ingest(self, event: Event, clock: Clock) -> None:
        # no model call here: the write path is a string append. The whole trade of this
        # design is that thinking happens at consolidation, not at ingestion.
        page = self.pages.get(event.scope)
        if page is None:
            page = self.pages[event.scope] = Page(event.scope)
        self._append(page, render(event, clock))

    # ---------------------------------------------------------------- recompile

    def _prompt(self, page: Page, new_lines: list[str]) -> str:
        truth = page.compiled_truth.strip() or "(nothing recorded yet)"
        lines = "\n".join(new_lines) if new_lines else "(none)"
        return (
            f"SUBJECT: {page.scope}\n\n"
            f"CURRENT COMPILED TRUTH:\n{truth}\n\n"
            f"NEW TIMELINE ENTRIES since that truth was written "
            f"({len(new_lines)}, oldest first):\n{lines}\n\n"
            "Rewrite the compiled truth for this subject.\n"
            "Rules:\n"
            "1. The timeline is the evidence; the compiled truth is the current reading of "
            "it. Write only what is true NOW.\n"
            "2. When a new entry supersedes an older statement, DELETE the older statement. "
            "Do not keep it annotated, dated, parenthesised, or introduced by "
            "'previously'/'formerly'/'used to'/'no longer'. The old value must not appear "
            "in your output at all.\n"
            "3. When something was dropped with nothing replacing it, remove it entirely "
            "rather than recording that it was dropped.\n"
            "4. Keep every detail that is still true, whether it comes from the current "
            "compiled truth or from the new entries: values, names, times, preferences, "
            "standing instructions, recurring failure causes and their fixes. This text is "
            "the only thing a later question can see, so a true detail you drop is lost.\n"
            "5. One short declarative claim per line. No dates or 'as of' qualifiers on a "
            "claim - the timeline carries the dates.\n"
            "6. Ignore small talk and chatter that asserts nothing about the subject.\n"
            "7. Output the compiled truth only."
        )

    @staticmethod
    def _usable(text: str) -> str:
        """Take the usable compiled truth out of a reply that may be fenced, prefaced or
        truncated. A malformed reply must cost this arm a recompile, not the run."""
        t = (text or "").strip()
        if not t:
            return ""
        if "```" in t:
            m = _FENCED.search(t)          # tolerates an unterminated fence (truncation)
            if m and m.group(1).strip():
                t = m.group(1).strip()
            else:
                t = t.replace("```", "").strip()
        out: list[str] = []
        for line in t.splitlines():
            if not out and (not line.strip() or _PREFACE.match(line) or _HEADING.match(line)):
                continue                    # drop a preamble line or a restated heading
            out.append(line.rstrip())
        while out and not out[-1].strip():
            out.pop()
        return "\n".join(out).strip()

    def _recompile_one(self, page: Page, new_lines: list[str]) -> tuple[str, Reply | None, str]:
        """-> (compiled truth or "", reply for costing, failure message)."""
        try:
            reply = self.llm.complete(self._prompt(page, new_lines), system=SYSTEM)
        except Exception as exc:                     # model/CLI failure is data, not a crash
            return "", None, repr(exc)[:300]
        truth = self._usable(reply.text)
        return truth, reply, "" if truth else "empty reply after cleanup"

    def consolidate(self, clock: Clock) -> None:
        """Rewrite the compiled truth of every page that has reached `dirty_threshold`.

        Threshold, not per-event: a rewrite of the whole document per event would cost one
        model call per event - more than the row-based design it is being compared with -
        and most events move nothing. Batching also gives the rewrite several entries to
        weigh at once, which is when a supersedence is visible as a supersedence.
        """
        due = [p for p in self.pages.values() if p.dirty >= self.dirty_threshold]
        if not due:
            return
        # each page carries its own window; snapshot it so a concurrent ingest cannot widen it
        work = [(p, p.timeline[p.compiled_through:], len(p.timeline)) for p in sorted(due, key=lambda p: p.scope)]
        with ThreadPoolExecutor(max_workers=min(4, len(work))) as ex:
            results = list(ex.map(lambda w: self._recompile_one(w[0], w[1]), work))
        for (page, _lines, upto), (truth, reply, err) in zip(work, results):
            if reply is not None:
                self._cost.model_calls += 1
                self._cost.tokens_in += reply.tokens_in
                self._cost.tokens_out += reply.tokens_out
            if err:
                # KEEP the previous compiled truth. `compiled_through` stays put, so the next
                # successful recompile still sees every unfolded line: no evidence is lost.
                self.recompile_failures.append((clock.day, page.scope, err))
                page.dirty = 0               # do not retry every day; wait for a fresh window
                continue
            page.compiled_truth = truth
            page.compiled_through = upto
            page.dirty = 0
            page.recompiles += 1
            self.recompiles += 1
        self._refresh_vectors()

    # ---------------------------------------------------------------- read path

    @staticmethod
    def _embed_text(page: Page) -> str:
        # date-free: an instant inside the vector leaks the clock into the ranking, and this
        # rung must rank the same at any base date (see memory_year.checks.clock_purity).
        # The dates live in the timeline, which is not what is embedded.
        return f"{page.scope}: {_ISO_DATE.sub('', page.compiled_truth)}".strip()

    def _refresh_vectors(self) -> None:
        """(Re-)embed pages whose compiled truth changed. Derived index only - it holds no
        memory of its own, and rebuilding it never touches a page."""
        todo = [(k, self._embed_text(p)) for k, p in self.pages.items()
                if p.compiled_truth.strip() and self._vecs.get(k, ("", None))[0] != self._embed_text(p)]
        if not todo:
            return
        vecs = self.embedder.embed([t for _, t in todo])
        for (k, t), v in zip(todo, vecs):
            self._vecs[k] = (t, v)

    def _scope_hit(self, scope: str, question: str) -> bool:
        if scope.lower() in USER_SCOPES:
            return bool(_FIRST_PERSON.search(question))
        return re.search(rf"\b{re.escape(scope)}\b", question, re.I) is not None

    def recall(self, probe: Probe, clock: Clock, budget_tokens: int) -> Context:
        # a probe read: it ranks and renders, and writes nothing back - no page, no timeline
        # line, no dirty count, no usage feedback. Only the derived vector index is filled in.
        self._refresh_vectors()
        if not self._vecs:
            return Context("", [], 0)
        keys = sorted(self._vecs)
        q = self.embedder.embed([probe.question])[0]
        M = np.vstack([self._vecs[k][1] for k in keys])
        scores = M @ q
        for i, k in enumerate(keys):
            if self._scope_hit(k, probe.question):
                scores[i] += SCOPE_BONUS
        order = [keys[i] for i in np.argsort(-scores)]

        chosen: list[str] = []
        used = 0
        for rank, k in enumerate(order):
            page = self.pages[k]
            block = f"# {k}\n{page.compiled_truth.strip()}"
            if rank == 0 and self.timeline_tail > 0 and page.timeline:
                tail = page.timeline[-self.timeline_tail:]
                block += "\n\n## recent timeline for " + k + "\n" + "\n".join(tail)
            t = estimate_tokens(block)
            if used + t > budget_tokens:
                if used:
                    break
                block = block[: budget_tokens * 4]        # the best page alone overruns: truncate
                t = estimate_tokens(block)
            chosen.append(block)
            used += t
            if used >= budget_tokens:
                break
        items = order[: len(chosen)]
        return Context("\n\n".join(chosen), items, used)

    # ---------------------------------------------------------------- reporting

    def cost(self) -> Cost:
        c = Cost(self._cost.model_calls, self._cost.tokens_in, self._cost.tokens_out)
        c.embeddings = self.embedder.calls
        c.store_bytes = sum(len(p.render().encode()) for p in self.pages.values())
        c.store_bytes += sum(v.nbytes for _, v in self._vecs.values())
        return c

    def describe(self) -> dict:
        lens = [len(p.compiled_truth) for p in self.pages.values() if p.compiled_truth]
        return {
            "name": self.name, "model": self.model, "embedder": self.embedder.name,
            "timeline_tail": self.timeline_tail, "dirty_threshold": self.dirty_threshold,
            "pages": len(self.pages),
            "timeline_lines": sum(len(p.timeline) for p in self.pages.values()),
            "recompiles": self.recompiles,
            "mean_truth_chars": round(sum(lens) / len(lens), 1) if lens else 0.0,
            "recompile_failures": len(self.recompile_failures),
            "recompile_failure_samples": [f"day {d} · {s}: {m[:160]}"
                                          for d, s, m in self.recompile_failures[:3]],
        }
