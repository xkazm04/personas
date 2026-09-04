"""Rung: consolidation at admission - judge every new fact against its nearest
neighbours AT WRITE TIME, instead of distilling the record later in an idle pass.

THE CLAIM. The design this arm is compared against (Athena's sleep cycle) does its
thinking when nothing is happening: it batches a day of episodes, distils facts, and
resolves contradictions after the fact - and loses about a third of its cycles to
timeouts, which is a third of the year's contradictions never resolved. This arm asks
whether the same work is affordable at the moment of writing, where it cannot be skipped:
one model pass per small batch of messages that both extracts durable facts AND emits a
seven-way verdict (create | merge | skip | support | contextualize | contradict |
supersede) for each one against the memory items nearest to it. It is modelled on a real
system that refuses to write a fact until it has said how that fact relates to what it
already believes.

WHAT A RESULT WOULD MEAN. If this arm matches or beats the idle-pass arm on `reversal`
and `expired` probes at a comparable write cost, then the idle pass is not buying
correctness - it is buying deferral, and the deferral is what leaks. If it loses, the
verdict histogram says why: a store that is nearly all `create` never resolved anything
(the gate saw no neighbours), and a store heavy with `contradict` resolved nothing either
(the gate saw the conflict and declined to rule). Either failure is legible here in a way
it is not in a design that simply drops a cycle. The histogram is a result, not telemetry.

WHAT IT IS NOT. This arm does not re-read its store in the background, does not decay,
and never deletes: a superseded fact is soft-invalidated and kept, so the store's growth
is the true cost of admission-time resolution.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np

from . import Backend, Context, Cost
from ..clock import Clock
from ..embed import DEFAULT_EMBEDDER, Embedder
from ..llm import LLM, estimate_tokens
from ..model import Event, Probe

DEFAULT_MODEL = "claude:claude-sonnet-5@low"

# exactly the vocabulary the gate may return; anything else is coerced to `create`
VERDICTS: tuple[str, ...] = ("create", "merge", "skip", "support", "contextualize", "contradict", "supersede")
# the verdicts that are meaningless without a neighbour to be a verdict *about*
NEEDS_NEIGHBOUR: frozenset[str] = frozenset({"merge", "skip", "support", "contextualize", "contradict", "supersede"})
# below this cosine the "nearest" active fact is not about the same subject at all, so a
# neighbour-bearing verdict is downgraded rather than applied to an unrelated item
MIN_NEIGHBOUR_SIM = 0.40

SYSTEM = (
    "You are the admission gate of a long-running assistant's memory. You are shown a small batch of new "
    "messages and the memory items already nearest to them. In ONE reply you do two things: extract the "
    "durable facts worth remembering, and for each one rule on how it relates to existing memory. "
    "You are the only chance these messages get: nothing re-reads them later. "
    "Reply with a single JSON object and nothing else."
)


@dataclass
class StoredFact:
    """One admitted fact plus the lifecycle the gate gave it."""

    id: str
    scope: str
    key: str
    value: str
    day: int                                  # simulated day it was admitted
    verdict: str                              # the verdict that admitted it
    confidence: int = 1                       # bumped by `support`
    context_of: Optional[str] = None          # `contextualize`: the item this narrows
    contradicts: Optional[str] = None         # `contradict`: the item this conflicts with
    contradicted_by: list[str] = field(default_factory=list)
    invalidated_at: Optional[int] = None      # `supersede`: the simulated day it stopped counting
    superseded_by: Optional[str] = None
    vec: Optional[np.ndarray] = None

    @property
    def active(self) -> bool:
        return self.invalidated_at is None

    def render(self) -> str:
        return f"[{self.scope}] {self.key}: {self.value}"

    def embed_text(self) -> str:
        # the embedded text is the subject of the fact only: no day, no id, no verdict.
        # a date inside the vector leaks the clock into the ranking (the rule the
        # clock-purity check enforces on every rung of this harness)
        return f"{self.key}: {self.value}"


def _first_json_object(text: str) -> Optional[str]:
    """The first brace-balanced object in `text`, ignoring braces inside strings.

    A model that fences its JSON, prefaces it with 'Here is the result:', or appends a
    paragraph of commentary after the closing brace must not kill a 443-event replay.
    """
    depth, start, in_str, esc = 0, -1, False, False
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth:
            depth -= 1
            if depth == 0 and start >= 0:
                return text[start:i + 1]
    return None


class WriteVerdict(Backend):
    """Admission-time consolidation: buffer, one pass per batch, one verdict per fact."""

    name = "write-verdict"

    def __init__(self, model: str = DEFAULT_MODEL, cache_dir: Path | str | None = None,
                 embedder: str = DEFAULT_EMBEDDER, watermark: int = 4, neighbours: int = 3):
        # the runner forwards cache_dir only to the rungs it names, so fall back to the
        # harness's own out/cache: the sqlite content cache is what makes a re-run free
        cd = Path(cache_dir) if cache_dir else Path(__file__).resolve().parents[2] / "out" / "cache"
        self.model = model
        self.llm = LLM(model, cd / "llm.sqlite")
        self.embedder = Embedder(embedder, cd / "emb.sqlite")
        self.watermark = max(1, int(watermark))
        self.neighbours = max(1, int(neighbours))

        self.facts: list[StoredFact] = []
        self.buffer: list[tuple[Event, Clock]] = []
        self.verdict_counts: dict[str, int] = {v: 0 for v in VERDICTS}
        self.pass_failures: list[tuple[int, str]] = []
        self.passes = 0
        self.extracted = 0
        self.downgraded = 0            # neighbour-bearing verdicts with no credible neighbour
        self._cost = Cost()
        self._seq = 0

    # ---------------------------------------------------------------- write path

    def ingest(self, event: Event, clock: Clock) -> None:
        """Cheap: append and return. The gate runs once the batch is worth a call."""
        self.buffer.append((event, clock))
        if len(self.buffer) >= self.watermark:
            self._pass(clock)

    def consolidate(self, clock: Clock) -> None:
        """There is no idle pass here - this only drains a short tail of the buffer."""
        self._flush(clock)

    def _flush(self, clock: Clock) -> None:
        if self.buffer:
            self._pass(clock)

    # ------------------------------------------------------------------ the pass

    def _pass(self, clock: Clock) -> None:
        batch, self.buffer = self.buffer, []
        self.passes += 1
        pool = self._candidate_pool([e for e, _ in batch])
        prompt = self._prompt(batch, pool, clock)
        try:
            reply = self.llm.complete(prompt, SYSTEM)
        except RuntimeError as exc:
            # the CLI gave up after its own retries. A lost pass is a lost admission -
            # data about a design that does its thinking on the hot path, not a harness fault
            self.pass_failures.append((clock.day, f"model call failed: {str(exc)[:240]}"))
            return
        self._cost.model_calls += 1
        self._cost.tokens_in += reply.tokens_in
        self._cost.tokens_out += reply.tokens_out

        items = self._parse(reply.text, clock)
        if items is None:
            return
        for item in items:
            self._apply(item, batch, clock)

    def _parse(self, text: str, clock: Clock) -> Optional[list[dict[str, Any]]]:
        """Defensive by policy: record the failure and continue, never raise upward."""
        blob = _first_json_object(text)
        if blob is None:
            self.pass_failures.append((clock.day, f"no JSON object in reply: {text[:160]!r}"))
            return None
        try:
            data = json.loads(blob)
        except (json.JSONDecodeError, ValueError) as exc:
            self.pass_failures.append((clock.day, f"unparseable JSON ({exc}): {blob[:160]!r}"))
            return None
        facts = data.get("facts") if isinstance(data, dict) else None
        if facts is None and isinstance(data, dict) and {"scope", "key", "value"} <= set(data):
            facts = [data]                     # a single bare fact object, not wrapped
        if not isinstance(facts, list):
            self.pass_failures.append((clock.day, f"no 'facts' list in object: {blob[:160]!r}"))
            return None
        return [f for f in facts if isinstance(f, dict)]

    # -------------------------------------------------------------- neighbours

    def _active(self) -> list[StoredFact]:
        return [f for f in self.facts if f.active]

    def _candidate_pool(self, events: list[Event]) -> list[StoredFact]:
        """What the gate is shown: the active facts nearest the batch's own messages.

        The verdict must be decided in the same call as the extraction (see `_prompt`), so
        the pool cannot be keyed on the extracted fact - it is keyed on the text the fact
        will come from, and the extracted fact's true top-`neighbours` set is recomputed
        afterwards to resolve which stored item a verdict is actually about.
        """
        active = self._active()
        if not active:
            return []
        scopes = {e.scope for e in events} | {"user"}
        pool_ix = [i for i, f in enumerate(active) if f.scope in scopes]
        if not pool_ix:
            return []
        M = np.vstack([active[i].vec for i in pool_ix])
        Q = self.embedder.embed([e.text for e in events])
        scores = (M @ Q.T).max(axis=1)          # nearest to ANY message in the batch
        order = np.argsort(-scores)[: max(self.neighbours * 2, 8)]
        return [active[pool_ix[int(j)]] for j in order]

    def _nearest(self, scope: str, key: str, value: str) -> list[tuple[StoredFact, float]]:
        """Top-`neighbours` ACTIVE facts by cosine over the fact's own "key: value" text.

        Scoped: `scope` is this data model's join key, and five projects each own a
        "framework", so an unscoped nearest-neighbour is a coin flip between them.
        """
        pool = [f for f in self._active() if f.scope == scope]
        if not pool:
            return []
        q = self.embedder.embed([f"{key}: {value}"])[0]
        scores = np.vstack([f.vec for f in pool]) @ q
        order = np.argsort(-scores)[: self.neighbours]
        return [(pool[int(i)], float(scores[int(i)])) for i in order]

    # ----------------------------------------------------------------- prompting

    def _prompt(self, batch: list[tuple[Event, Clock]], pool: list[StoredFact], clock: Clock) -> str:
        msgs = []
        for i, (e, c) in enumerate(batch, 1):
            who = "assistant" if e.kind == "outcome" else "user"
            msgs.append(f"{i}. [{who} · scope={e.scope} · day {c.day}] {e.text}")
        mem = "\n".join(f"{f.id} | [{f.scope}] {f.key}: {f.value}   (admitted day {f.day})" for f in pool) or "(memory is empty)"
        scopes = ", ".join(sorted({e.scope for e, _ in batch} | {"user"}))
        return (
            f"Today is {clock.iso[:10]} (day {clock.day}).\n\n"
            f"NEW MESSAGES:\n{chr(10).join(msgs)}\n\n"
            f"NEAREST EXISTING MEMORY:\n{mem}\n\n"
            "Extract the DURABLE facts in the new messages: stack choices, people, schedules, personal "
            "details, standing preferences, standing instructions, and the causes of repeated failures. "
            "Ignore small talk, one-off task requests, and outcomes that teach nothing. Zero facts is a "
            "normal answer.\n"
            f"Each fact needs: scope (one of: {scopes} - use the scope of the message it came from), "
            "key (a short slug such as database, framework, deploy-day, standup-time, editor, tone), "
            "and value (short, no sentence).\n\n"
            "Then rule on each fact against the nearest existing memory item, using EXACTLY one of:\n"
            "  create        - nothing in memory covers this subject\n"
            "  merge         - the same item said better or more completely; replace its value, keep the item\n"
            "  skip          - already in memory, nothing new\n"
            "  support       - already in memory, and this message confirms it again\n"
            "  contextualize - true alongside the existing item, in a narrower situation\n"
            "  contradict    - incompatible with the existing item, and you cannot tell which one holds\n"
            "  supersede     - the same subject, and this NEW value replaces the old one (an explicit change,\n"
            "                  a move, a switch, a 'no longer', a 'from X to Y')\n"
            "Set neighbour_id to the id of the memory item you ruled against, or null for create.\n\n"
            "Reply with ONLY this JSON object:\n"
            '{"facts":[{"scope":"...","key":"...","value":"...","verdict":"...","neighbour_id":"m00007 or null",'
            '"why":"at most 10 words"}]}'
        )

    # ------------------------------------------------------------------- applying

    def _apply(self, item: dict[str, Any], batch: list[tuple[Event, Clock]], clock: Clock) -> None:
        key = str(item.get("key") or "").strip().lower()
        value = str(item.get("value") or "").strip()
        if not key or not value:
            return
        allowed = {e.scope for e, _ in batch} | {"user"}
        scope = str(item.get("scope") or "").strip()
        if scope not in allowed:
            scope = batch[0][0].scope           # a hallucinated scope would orphan the fact
        self.extracted += 1

        verdict = str(item.get("verdict") or "").strip().lower()
        if verdict not in VERDICTS:
            verdict = "create"
        near = self._nearest(scope, key, value)
        neighbour = self._resolve(item.get("neighbour_id"), near)
        if verdict in NEEDS_NEIGHBOUR and neighbour is None:
            verdict, self.downgraded = "create", self.downgraded + 1

        self.verdict_counts[verdict] += 1
        if verdict == "skip":
            return
        if verdict == "support":
            neighbour.confidence += 1           # type: ignore[union-attr]
            return
        if verdict == "merge":
            neighbour.value = value             # type: ignore[union-attr]
            neighbour.vec = self.embedder.embed([neighbour.embed_text()])[0]   # type: ignore[union-attr]
            return
        new = self._insert(scope, key, value, clock, verdict)
        if verdict == "contextualize":
            new.context_of = neighbour.id       # type: ignore[union-attr]
        elif verdict == "contradict":
            # both stay retrievable and both stay active: a contradiction the gate could
            # not rule on is not a resolution, and hiding either half would fake one
            new.contradicts = neighbour.id      # type: ignore[union-attr]
            neighbour.contradicted_by.append(new.id)   # type: ignore[union-attr]
        elif verdict == "supersede":
            # soft invalidation, never a delete: the old value must stay on disk (it is the
            # store's real cost) and must stay out of recall for ever after, which is the
            # only thing that can move a `reversal` probe off the stale answer
            neighbour.invalidated_at = clock.day        # type: ignore[union-attr]
            neighbour.superseded_by = new.id            # type: ignore[union-attr]

    def _resolve(self, raw_id: Any, near: list[tuple[StoredFact, float]]) -> Optional[StoredFact]:
        """Which stored fact the verdict is about: the model's pick if it is credible,
        otherwise the true nearest neighbour, otherwise nothing."""
        if not near:
            return None
        nid = str(raw_id).strip() if raw_id not in (None, "", "null") else ""
        if nid:
            for f, _ in near:
                if f.id == nid:
                    return f
            hit = next((f for f in self._active() if f.id == nid), None)
            if hit is not None and hit.scope == near[0][0].scope:
                return hit
        top, sim = near[0]
        return top if sim >= MIN_NEIGHBOUR_SIM else None

    def _insert(self, scope: str, key: str, value: str, clock: Clock, verdict: str) -> StoredFact:
        self._seq += 1
        f = StoredFact(id=f"m{self._seq:05d}", scope=scope, key=key, value=value, day=clock.day, verdict=verdict)
        f.vec = self.embedder.embed([f.embed_text()])[0]
        self.facts.append(f)
        return f

    # ----------------------------------------------------------------- read path

    def recall(self, probe: Probe, clock: Clock, budget_tokens: int) -> Context:
        # the flush admits events the timeline already delivered, so nothing is stranded
        # behind a probe; the probe itself writes nothing - no usage counter, no feedback,
        # no re-ranking - so a read leaves the store exactly as it found it
        self._flush(clock)
        active = self._active()
        if not active:
            return Context("", [], 0)
        q = self.embedder.embed([probe.question])[0]
        scores = np.vstack([f.vec for f in active]) @ q
        chosen: list[int] = []
        used = 0
        for i in np.argsort(-scores):
            line = active[int(i)].render()
            t = estimate_tokens(line) + 1
            if used + t > budget_tokens:
                if used:
                    break
                continue
            chosen.append(int(i))
            used += t
            if len(chosen) >= 60:
                break
        chosen.sort(key=lambda i: (active[i].day, active[i].id))
        return Context("\n".join(active[i].render() for i in chosen), [active[i].id for i in chosen], used)

    # --------------------------------------------------------------------- meta

    def cost(self) -> Cost:
        self._cost.embeddings = self.embedder.calls
        # invalidated facts count too: never deleting is what this design pays for recall purity
        self._cost.store_bytes = sum(len(f.render().encode()) for f in self.facts) + sum(
            f.vec.nbytes for f in self.facts if f.vec is not None)
        return self._cost

    def describe(self) -> dict:
        return {
            "name": self.name, "model": self.model, "watermark": self.watermark, "neighbours": self.neighbours,
            "passes": self.passes, "facts_extracted": self.extracted,
            "facts_active": len(self._active()), "facts_stored": len(self.facts),
            "verdicts": dict(self.verdict_counts),
            "downgraded_to_create": self.downgraded,
            "pass_failures": len(self.pass_failures),
            "pass_failure_samples": [f"day {d}: {m[:160]}" for d, m in self.pass_failures[:3]],
        }
