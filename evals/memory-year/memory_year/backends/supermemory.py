"""The supermemory self-hosted server as an arm: an agentic extractor over a versioned memory graph.

The design under test is a hosted-product engine shipped as a local binary. It stores every
document verbatim as chunks AND runs a tool-calling extraction agent over it that searches
existing memories, creates atomic memories, and links them with `updates | extends | derives`
relations; a superseded memory keeps its version chain and drops out of search. The arm drives
the real binary over HTTP, with its write-time model routed through `claude_shim.py` onto the
same Claude CLI engine and cache discipline as every other arm.

CLAIM UNDER TEST: agentic extraction with explicit supersedence relations answers reversals
from the current value (low wrong-old) without losing the detail a verbatim store keeps,
because the hybrid read path returns both the distilled memory and the raw chunk.

A WIN looks like: accuracy at or above hybrid-verbatim (0.87) with stale answers at or below
the rewriting arms (3-9), at a write cost the report can state.

A LOSS looks like any of: (a) the chunk half of hybrid recall re-injects the stale raw text
the memory half retired, so wrong-old tracks the verbatim arms; (b) the agent misses the
`updates` relation on a changed value, leaving two live versions; (c) expiry fires on the
server's WALL CLOCK - the scenario is dated 2025 and the server runs in 2026, so any
`forgetAfter` the agent writes has already passed the moment it is written, which reads as
good `expired` scores and silently hurts everything else. The describe() block says so.

DESIGN CHOICES THE REPORT MUST CARRY (not properties of the engine):
- one document per simulated day (the vendor's "medium-sized, self-contained documents"
  rule); a probe that lands mid-day flushes the partial day as its own document;
- documents are sent strictly in order and each is waited on until `status` and
  `dreamingStatus` are both `done` (the vendor's rule that ingestion order is the temporal
  authority), so every probe sees a fully processed store;
- recall uses `/v4/search` in `hybrid` mode with `limit` 100 and `threshold` 0, so the
  harness's token budget binds and not the engine's default cap of 10 at 0.5.

SIDE RECORDINGS: at each probe the arm also captures the context the same store returns
under other read modes (default: `memories` only) into `side_contexts.jsonl` in the data
directory. The `recorded` backend replays one of those as its own rung, which yields a
one-variable pair - same store, same instant, different read path - for the price of the
consumer and the judge alone.

RESUMING ACROSS A MODEL-BUDGET WINDOW. A year costs more write-time model calls than one
subscription window holds, so the run must survive being killed and restarted, and doing that
naively corrupts the result: the store keeps growing, so re-running the replay would answer an
early probe against a store that already holds the rest of the year. Two records prevent it.
The checkpoint lists the documents already ingested, so ingestion is skipped rather than
repeated (and a document whose extraction FAILED is deleted and re-sent, in day order, because
a day stored as chunks with no memories is a hole in the design under test, not a property of
it). Every probe's own context is recorded at the instant it was captured and replayed
verbatim on a later run, so a probe is answered against the store as it stood on its own day,
whichever window it was first reached in. Replayed contexts are identical strings, so the
consumer and judge calls come back from the harness cache and cost nothing.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import Backend, Context, Cost
from ..clock import Clock
from ..llm import estimate_tokens
from ..model import Event, Probe
from .full_history import render

DOC_TIMEOUT_S = 1200


def _http(method: str, url: str, body: dict | None = None, timeout: int = 120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read() or b"{}")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            if attempt == 5:
                raise
            time.sleep(5 * (attempt + 1))


def _dir_bytes(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


class Supermemory(Backend):
    name = "supermemory"

    def __init__(self, base_url: str = "http://127.0.0.1:6792", data_dir: str = r"C:\t\sm-arm\data-year",
                 shim_stats: str = r"C:\t\sm-arm\shim-stats-year.json", container: str = "memyear",
                 search_mode: str = "hybrid", limit: int = 100, threshold: float = 0.0,
                 side_modes: str = "memories", writer: str = "claude:claude-sonnet-5@low"):
        self.url = base_url.rstrip("/")
        self.data_dir = Path(data_dir)
        self.shim_stats = Path(shim_stats)
        self.container = container
        self.search_mode = search_mode
        self.limit = limit
        self.threshold = threshold
        self.side_modes = [m for m in side_modes.split(",") if m]
        self.writer = writer
        self.buffer: list[tuple[Event, Clock]] = []
        self.buffer_day = -1
        self.part = 0
        self.checkpoint = self.data_dir / "arm-checkpoint.jsonl"
        self.done_ids: dict[str, dict] = {}
        if self.checkpoint.exists():
            for line in self.checkpoint.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    self.done_ids[row["customId"]] = row
        self.ctx_path = self.data_dir / "side_contexts.jsonl"
        self.recorded: dict[tuple[str, str], dict] = {}
        if self.ctx_path.exists():
            for line in self.ctx_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    row = json.loads(line)
                    self.recorded[(row["probe"], row["mode"])] = row
        self.side = open(self.ctx_path, "a", encoding="utf-8")
        self.replayed = 0
        self.docs_sent = 0
        self.docs_resent = 0
        self.docs_failed = 0
        self.docs_timed_out = 0
        self.consecutive_failures = 0
        self.wait_s = 0.0

    # ---- write path ----------------------------------------------------------------
    def ingest(self, event: Event, clock: Clock) -> None:
        if self.buffer and event.day != self.buffer_day:
            self._flush()
        if not self.buffer:
            self.buffer_day = event.day
        self.buffer.append((event, clock))

    def consolidate(self, clock: Clock) -> None:
        self._flush()

    def _flush(self) -> None:
        if not self.buffer:
            return
        events, self.buffer = self.buffer, []
        day = events[0][1].day
        custom_id = f"day-{day:03d}-{self.part}"
        self.part += 1
        prior = self.done_ids.get(custom_id)
        if prior is not None:
            if prior.get("status") == "done":
                return
            # a day whose extraction failed is a hole in the store, not a result: drop it and re-send
            try:
                _http("DELETE", f"{self.url}/v3/documents/{prior['id']}")
            except Exception:
                pass
            self.docs_resent += 1
        content = "\n".join(render(e, c).replace(f"[{c.at.date().isoformat()}]", f"[{c.at.strftime('%Y-%m-%d %H:%M')}]")
                            for e, c in events)
        first = events[0][1]
        r = _http("POST", f"{self.url}/v3/documents", {
            "content": content, "containerTag": self.container, "customId": custom_id,
            "documentDate": first.at.isoformat().replace("+00:00", "Z"),
            "metadata": {"day": day, "events": len(events)},
        })
        self.docs_sent += 1
        # the id is recorded BEFORE the wait: a run killed mid-processing leaves a document the
        # next window must delete rather than duplicate, and only this row knows its id
        self._checkpoint({"customId": custom_id, "id": r["id"], "status": "in-flight", "events": [e.id for e, _ in events]})
        status = self._wait(r["id"])
        self._checkpoint({"customId": custom_id, "id": r["id"], "status": status, "events": [e.id for e, _ in events]})
        self._note(status)

    def _checkpoint(self, row: dict) -> None:
        with open(self.checkpoint, "a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        self.done_ids[row["customId"]] = row

    def _note(self, status: str) -> str:
        """Three failed documents in a row is the model budget, not the design. Stop the run so
        the supervisor can resume it in the next window; a day silently stored without memories
        would be measured as if the design had produced none."""
        if status == "done":
            self.consecutive_failures = 0
        else:
            self.consecutive_failures += 1
            if self.consecutive_failures >= 3:
                raise RuntimeError(f"3 consecutive documents failed extraction (last: {status}) - "
                                   "stopping so the run can resume in the next model-budget window")
        return status

    def _wait(self, doc_id: str) -> str:
        t0 = time.time()
        while True:
            d = _http("GET", f"{self.url}/v3/documents/{doc_id}")
            st, dream = d.get("status"), d.get("dreamingStatus")
            if st == "failed" or dream == "failed":
                self.docs_failed += 1
                self.wait_s += time.time() - t0
                return f"failed:{st}/{dream}"
            if st == "done" and dream in ("done", None):
                self.wait_s += time.time() - t0
                return "done"
            if time.time() - t0 > DOC_TIMEOUT_S:
                self.docs_timed_out += 1
                self.wait_s += time.time() - t0
                return f"timeout:{st}/{dream}"
            time.sleep(3)

    # ---- read path -----------------------------------------------------------------
    def _search(self, q: str, mode: str, budget_tokens: int) -> Context:
        d = _http("POST", f"{self.url}/v4/search", {
            "q": q, "containerTag": self.container, "searchMode": mode,
            "limit": self.limit, "threshold": self.threshold,
        })
        lines, items, used = [], [], 0
        for r in d.get("results") or []:
            if r.get("memory"):
                dates = ((r.get("metadata") or {}).get("temporalContext") or {}).get("eventDate") or []
                text = f"- {r['memory']}" + (f" (as of {', '.join(dates)})" if dates else "") + (f" [v{r['version']}]" if (r.get("version") or 1) > 1 else "")
            elif r.get("chunk"):
                text = r["chunk"]
            else:
                continue
            t = estimate_tokens(text)
            if used + t > budget_tokens:
                if used > 0:
                    break
                continue
            lines.append(text); items.append(r.get("id", "")); used += t
        return Context("\n".join(lines), items, used)

    def _context(self, probe: Probe, mode: str, budget_tokens: int) -> Context:
        """The store as it stood at this probe's own instant: replayed if an earlier window
        already reached it, because the store has grown since and a live search would answer
        an early probe with the rest of the year."""
        row = self.recorded.get((probe.id, mode))
        if row is not None:
            self.replayed += 1
            return Context(row["text"], row["items"], row["tokens"])
        ctx = self._search(probe.question, mode, budget_tokens)
        self.side.write(json.dumps({"probe": probe.id, "mode": mode, "text": ctx.text,
                                    "items": ctx.items, "tokens": ctx.tokens}) + "\n")
        self.side.flush()
        self.recorded[(probe.id, mode)] = {"text": ctx.text, "items": ctx.items, "tokens": ctx.tokens}
        return ctx

    def recall(self, probe: Probe, clock: Clock, budget_tokens: int) -> Context:
        self._flush()
        ctx = self._context(probe, self.search_mode, budget_tokens)
        for mode in self.side_modes:
            if mode != self.search_mode:
                self._context(probe, mode, budget_tokens)
        return ctx

    # ---- accounting ----------------------------------------------------------------
    def cost(self) -> Cost:
        s = {}
        if self.shim_stats.exists():
            try:
                s = json.loads(self.shim_stats.read_text(encoding="utf-8"))
            except ValueError:
                s = {}
        return Cost(model_calls=int(s.get("calls", 0)), tokens_in=int(s.get("tokens_in", 0)),
                    tokens_out=int(s.get("tokens_out", 0)), store_bytes=_dir_bytes(self.data_dir))

    def describe(self) -> dict:
        s = {}
        if self.shim_stats.exists():
            try:
                s = json.loads(self.shim_stats.read_text(encoding="utf-8"))
            except ValueError:
                pass
        return {"name": self.name, "engine": "supermemory-server 0.0.8 (windows-x64, sha256 d8fb2ac0)",
                "writer": self.writer, "writer_route": "OpenAI-compatible shim over the Claude CLI; tool calls batched per turn",
                "embedder": "server default, local Xenova/bge-base-en-v1.5 768d",
                "unit": "one document per simulated day, partial day flushed at a probe",
                "order": "sequential; each document waited on to status=done and dreamingStatus=done",
                "search": {"endpoint": "/v4/search", "mode": self.search_mode, "limit": self.limit, "threshold": self.threshold},
                "side_modes": self.side_modes,
                "clock_hazard": "server stamps and expires on its wall clock (2026); scenario is dated 2025",
                "docs_sent": self.docs_sent, "docs_resent": self.docs_resent,
                "docs_failed": self.docs_failed, "docs_timed_out": self.docs_timed_out,
                "contexts_replayed": self.replayed,
                "wait_s": round(self.wait_s), "shim": s}

    def close(self) -> None:
        self.side.close()


class Recorded(Backend):
    """Replays a context another arm recorded at the same probe instant (a read-path-only rung)."""

    name = "recorded"

    def __init__(self, path: str = r"C:\t\sm-arm\data-year\side_contexts.jsonl", mode: str = "memories", label: str = ""):
        self.mode = mode
        self.label = label or f"recorded-{mode}"
        self.name = self.label
        self.path = path
        self.ctx: dict[str, dict] = {}
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                if row["mode"] == mode:
                    self.ctx[row["probe"]] = row

    def ingest(self, event: Event, clock: Clock) -> None:
        return None

    def recall(self, probe: Probe, clock: Clock, budget_tokens: int) -> Context:
        row = self.ctx.get(probe.id)
        if row is None:
            return Context("", [], 0)
        return Context(row["text"], row["items"], row["tokens"])

    def describe(self) -> dict:
        return {"name": self.name, "replays": self.path, "mode": self.mode, "probes": len(self.ctx)}
