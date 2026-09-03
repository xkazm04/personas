"""Local model access with a content-addressed cache.

Every call is keyed by (model, prompt, options) so a ladder re-run costs nothing and a
scenario re-run is reproducible. Ollama is the default; a hosted model can be added
behind the same function. Token counts are the provider's when it reports them, else an
estimate that is labelled as such.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

OLLAMA = "http://localhost:11434"


@dataclass
class Reply:
    text: str
    tokens_in: int
    tokens_out: int
    latency_ms: int
    cached: bool
    estimated: bool = False


class LLM:
    def __init__(self, model: str, cache_path: Path, temperature: float = 0.0, num_ctx: int = 8192):
        self.model, self.temperature, self.num_ctx = model, temperature, num_ctx
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(cache_path))
        self.db.execute("CREATE TABLE IF NOT EXISTS calls (k TEXT PRIMARY KEY, reply TEXT, tin INT, tout INT, ms INT)")
        self.calls = 0
        self.tokens_in = 0
        self.tokens_out = 0
        self.cache_hits = 0

    def _key(self, system: str, prompt: str) -> str:
        return hashlib.sha256(json.dumps([self.model, self.temperature, self.num_ctx, system, prompt]).encode()).hexdigest()

    def complete(self, prompt: str, system: str = "") -> Reply:
        k = self._key(system, prompt)
        row = self.db.execute("SELECT reply,tin,tout,ms FROM calls WHERE k=?", (k,)).fetchone()
        if row:
            self.cache_hits += 1
            self.tokens_in += row[1]; self.tokens_out += row[2]; self.calls += 1
            return Reply(row[0], row[1], row[2], row[3], True)
        body = json.dumps({"model": self.model, "prompt": prompt, "system": system, "stream": False,
                           "options": {"temperature": self.temperature, "num_ctx": self.num_ctx}}).encode()
        req = urllib.request.Request(f"{OLLAMA}/api/generate", data=body, headers={"Content-Type": "application/json"})
        t0 = time.time()
        data = None
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=900) as r:
                    data = json.loads(r.read().decode())
                break
            except (TimeoutError, OSError) as exc:   # a stalled server is an instrument fault, not a miss
                if attempt == 3:
                    raise
                time.sleep(15 * (attempt + 1))
        ms = int((time.time() - t0) * 1000)
        text = data.get("response", "")
        tin = int(data.get("prompt_eval_count") or 0)
        tout = int(data.get("eval_count") or 0)
        est = False
        if not tin:
            tin, est = estimate_tokens(system + prompt), True
        self.db.execute("INSERT OR REPLACE INTO calls VALUES (?,?,?,?,?)", (k, text, tin, tout, ms))
        self.db.commit()
        self.calls += 1; self.tokens_in += tin; self.tokens_out += tout
        return Reply(text, tin, tout, ms, False, est)


def estimate_tokens(text: str) -> int:
    """A labelled estimate: ~4 characters per token for English prose."""
    return max(1, len(text) // 4)
