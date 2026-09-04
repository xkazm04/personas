"""The verbatim-archive control arm: hybrid retrieval over an unconsolidated record.

Modelled on shipped memory systems that store what was said, exactly as it was said, and
spend nothing at write time - no extraction, no belief merge, no supersedence, not one
model call - betting instead that a good hybrid retriever plus a cheap pointer index can
find the right line a year later.

The question this arm answers is the ladder's null hypothesis: **does model-driven
consolidation earn its tokens?** Its sibling `raw-retrieval` is the weak form of the same
bet (dense vectors alone); this is the strong form - dense plus BM25 plus a key-overlap
boost plus sibling hydration, i.e. everything a retrieval engineer would do before
reaching for a model. If a consolidating rung cannot beat this arm on accuracy, the write
-time tokens it spends are buying nothing that retrieval quality could not buy for free.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

import numpy as np

from . import Backend, Context, Cost
from ..clock import Clock
from ..embed import Embedder, DEFAULT_EMBEDDER
from ..llm import estimate_tokens
from ..model import Event, Probe
from .full_history import render

_BM25_K1 = 1.5
_BM25_B = 0.75
_MAX_CHUNKS = 40   # same primary-pass cap as raw-retrieval, so the arms differ only in ranking

_WORD = re.compile(r"[a-z0-9][a-z0-9_-]*")
_CAPITALISED = re.compile(r"\b[A-Z][\w-]{2,}\b")
_QUOTED = re.compile(r"[\"'`]([^\"'`]{2,40})[\"'`]")

# Capitalised-word extraction cannot tell a proper noun from a sentence-initial article,
# so the commonest sentence openers are dropped before they become index keys.
_STOP = frozenset("""
the a an and or but if for this that these those it its he she they we you i in on at to
of is are was were when what which who how why do does did use using after before from
with your my our their there here now then also not no yes please can will should would
could has have had been be by as so than into over under about new old always never only
""".split())


def _tokens(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def _keys(text: str, scope: str | None = None) -> set[str]:
    """Cheap pointer keys: proper-noun-ish capitalised words, quoted terms, scope words."""
    out = {m.group(0).lower() for m in _CAPITALISED.finditer(text)}
    for m in _QUOTED.finditer(text):
        out.update(_tokens(m.group(1)))
    if scope:
        out.update(_tokens(scope))
    return {k for k in out if k not in _STOP and len(k) > 2}


def _unit(x: np.ndarray) -> np.ndarray:
    """Min-max onto [0,1] over the candidate set; a flat list normalises to zeros."""
    lo, hi = float(x.min()), float(x.max())
    if hi - lo < 1e-12:
        return np.zeros_like(x)
    return (x - lo) / (hi - lo)


class HybridVerbatim(Backend):
    """Verbatim store, hybrid (dense + BM25) recall, key boost, sibling hydration.

    Write path: append the rendered event and index it. Zero model calls, ever.
    Read path: cosine and BM25 each normalised over the whole store, blended by weight,
    lifted by pointer-key overlap, filled to budget, hydrated with neighbours.
    """

    name = "hybrid-verbatim"

    def __init__(
        self,
        embedder: str = DEFAULT_EMBEDDER,
        cache_dir: Path | str | None = None,
        vector_weight: float = 0.6,
        lexical_weight: float = 0.4,
        siblings: int = 1,
        boost: tuple[float, float, float] = (0.40, 0.25, 0.15),
    ):
        cache_dir = Path(cache_dir) if cache_dir else None
        self.embedder = Embedder(embedder, (cache_dir / "emb.sqlite") if cache_dir else None)
        self.vector_weight = float(vector_weight)
        self.lexical_weight = float(lexical_weight)
        self.siblings = int(siblings)
        self.boost = tuple(float(b) for b in boost)

        self.ids: list[str] = []
        self.texts: list[str] = []          # rendered, dated - what the consumer reads
        self.embed_texts: list[str] = []    # date-free - what the retriever ranks on
        self.days: list[int] = []
        self.vecs: list[np.ndarray | None] = []
        self.pending: list[int] = []

        # lexical index
        self.tf: list[dict[str, int]] = []
        self.doc_len: list[int] = []
        self.postings: dict[str, list[int]] = {}
        self.total_len = 0

        # pointer index: key -> chunk ids
        self.key_index: dict[str, list[int]] = {}
        self.chunk_keys: list[set[str]] = []

        self.bytes = 0

    # ---- write -------------------------------------------------------------

    def ingest(self, event: Event, clock: Clock) -> None:
        r = render(event, clock)
        i = len(self.texts)
        self.ids.append(event.id)
        self.texts.append(r)
        self.days.append(clock.day)
        # Both retrieval views are built from date-free text. A date inside the embedded
        # (or tokenised) text leaks the simulated clock into the ranking - the same leak
        # the clock-purity check caught on the raw-retrieval rung - and would let an arm
        # score by knowing "today" rather than by remembering.
        who = "user" if event.kind in ("say", "task", "teach", "noise") else "system"
        embed_text = who + ": " + event.text
        self.embed_texts.append(embed_text)
        self.pending.append(i)

        toks = _tokens(embed_text)
        tf: dict[str, int] = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        self.tf.append(tf)
        self.doc_len.append(len(toks))
        self.total_len += len(toks)
        for t in tf:
            self.postings.setdefault(t, []).append(i)

        keys = _keys(event.text, event.scope)
        self.chunk_keys.append(keys)
        for k in keys:
            self.key_index.setdefault(k, []).append(i)

        self.bytes += len(r.encode())

    def consolidate(self, clock: Clock) -> None:
        """No-op by design: this arm is the control for consolidation, not a user of it."""
        return None

    def _flush(self) -> None:
        if not self.pending:
            return
        vecs = self.embedder.embed([self.embed_texts[i] for i in self.pending])
        for i, v in zip(self.pending, vecs):
            while len(self.vecs) <= i:
                self.vecs.append(None)
            self.vecs[i] = v
        self.pending = []

    # ---- read --------------------------------------------------------------

    def _bm25(self, query: list[str]) -> np.ndarray:
        n = len(self.texts)
        scores = np.zeros(n, dtype=np.float32)
        if not n:
            return scores
        avgdl = (self.total_len / n) or 1.0
        for term in set(query):
            posting = self.postings.get(term)
            if not posting:
                continue
            df = len(posting)
            idf = math.log(1.0 + (n - df + 0.5) / (df + 0.5))
            for i in posting:
                f = self.tf[i][term]
                denom = f + _BM25_K1 * (1.0 - _BM25_B + _BM25_B * self.doc_len[i] / avgdl)
                scores[i] += idf * (f * (_BM25_K1 + 1.0)) / denom
        return scores

    def _key_multiplier(self, question: str) -> np.ndarray:
        """Pointer boost. It only ever RAISES a score.

        A key index built from surface forms is a guess, not a fact: the probe may name
        the thing in words the chunk never used. Gating on it would silently delete the
        right chunk from the candidate set and there would be no way to tell that from a
        retrieval miss. Boosting instead keeps every chunk reachable by the hybrid score
        and lets an agreeing key only sharpen the order.
        """
        n = len(self.texts)
        mult = np.ones(n, dtype=np.float32)
        if not n:
            return mult
        qkeys = _keys(question)
        # index keys are the arm's vocabulary, so a lowercase mention ("quill") still
        # counts even though the capitalisation rule alone would miss it
        low = set(_tokens(question))
        qkeys |= (low & self.key_index.keys())
        if not qkeys:
            return mult
        overlap = np.zeros(n, dtype=np.int32)
        for k in qkeys:
            for i in self.key_index.get(k, ()):
                overlap[i] += 1
        tiers = sorted({int(c) for c in overlap if c > 0}, reverse=True)
        if not tiers:
            return mult
        rank_of = {c: min(r, len(self.boost) - 1) for r, c in enumerate(tiers)}
        for i, c in enumerate(overlap):
            if c > 0:
                mult[i] = 1.0 + self.boost[rank_of[int(c)]]
        return mult

    def recall(self, probe: Probe, clock: Clock, budget_tokens: int) -> Context:
        self._flush()
        if not self.vecs:
            return Context("", [], 0)
        q = self.embedder.embed([probe.question])[0]
        cosine = np.vstack(self.vecs) @ q
        lexical = self._bm25(_tokens(probe.question))
        scores = self.vector_weight * _unit(cosine) + self.lexical_weight * _unit(lexical)
        scores = scores * self._key_multiplier(probe.question)

        chosen: list[int] = []
        used = 0
        for i in np.argsort(-scores):
            t = estimate_tokens(self.texts[i])
            if used + t > budget_tokens:
                if used > 0:
                    break
                continue
            chosen.append(int(i))
            used += t
            if len(chosen) >= _MAX_CHUNKS:
                break

        # A verbatim archive splits a statement from the turn that gave it meaning, so the
        # neighbours of a hit are hydrated in while the budget still allows it.
        picked = set(chosen)
        if self.siblings > 0:
            for i in chosen:
                for j in range(i - self.siblings, i + self.siblings + 1):
                    if j < 0 or j >= len(self.texts) or j in picked:
                        continue
                    t = estimate_tokens(self.texts[j])
                    if used + t > budget_tokens:
                        continue
                    picked.add(j)
                    used += t

        final = sorted(picked, key=lambda i: (self.days[i], i))
        return Context("\n".join(self.texts[i] for i in final), [self.ids[i] for i in final], used)

    # ---- accounting --------------------------------------------------------

    def cost(self) -> Cost:
        return Cost(
            embeddings=self.embedder.calls,
            store_bytes=self.bytes + sum(v.nbytes for v in self.vecs if v is not None),
        )

    def describe(self) -> dict:
        return {
            "name": self.name,
            "embedder": self.embedder.name,
            "vector_weight": self.vector_weight,
            "lexical_weight": self.lexical_weight,
            "bm25": {"k1": _BM25_K1, "b": _BM25_B},
            "boost": list(self.boost),
            "siblings": self.siblings,
        }
