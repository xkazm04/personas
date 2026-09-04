"""Model access through the Claude Code CLI, with a content-addressed cache.

The engine is the operator's Claude Code subscription: every call is `claude -p` with a
replaced system prompt, JSON output, no session persistence, no tools. That is the same
engine Athena ships with, so the consumer in a ladder is the consumer in production, and
the arms differ only in what memory they were shown.

Model specs are `claude:<model>@<effort>`, e.g. `claude:claude-opus-4-8@low` (Athena's
main turn), `claude:claude-sonnet-5@low`. Calls are cached by (spec, system, prompt) so a
re-run, a re-judge or a second rung over the same probe costs nothing. The cache is
process-shared and thread-safe; concurrent calls are the normal mode.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import shutil

CLAUDE = shutil.which("claude") or "claude"   # the resolved shim, so no shell is needed and argv stays short

DEFAULT_CONSUMER = "claude:claude-opus-4-8@medium"
DEFAULT_JUDGE = "claude:claude-sonnet-5@low"


@dataclass
class Reply:
    text: str
    tokens_in: int
    tokens_out: int
    latency_ms: int
    cached: bool
    estimated: bool = False


def parse_spec(spec: str) -> tuple[str, str]:
    """'claude:<model>@<effort>' -> (model, effort). Effort defaults to low."""
    if not spec.startswith("claude:"):
        raise SystemExit(f"model spec must start with 'claude:' (the engine is the Claude Code CLI): {spec!r}")
    rest = spec[len("claude:"):]
    model, _, effort = rest.partition("@")
    return model or "claude-sonnet-5", effort or "low"


class LLM:
    def __init__(self, spec: str, cache_path: Path, workdir: Path | None = None):
        self.spec = spec
        self.model, self.effort = parse_spec(spec)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path = cache_path
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(cache_path), check_same_thread=False)
        self._db.execute("CREATE TABLE IF NOT EXISTS calls (k TEXT PRIMARY KEY, reply TEXT, tin INT, tout INT, ms INT)")
        self._db.commit()
        # an empty working directory so no project instruction file leaks into the system prompt
        self.workdir = workdir or Path(tempfile.mkdtemp(prefix="memory-year-cli-"))
        self.calls = 0
        self.tokens_in = 0
        self.tokens_out = 0
        self.cache_hits = 0
        self.errors = 0

    def _key(self, system: str, prompt: str) -> str:
        return hashlib.sha256(json.dumps([self.spec, system, prompt]).encode()).hexdigest()

    def complete(self, prompt: str, system: str = "") -> Reply:
        k = self._key(system, prompt)
        with self._lock:
            row = self._db.execute("SELECT reply,tin,tout,ms FROM calls WHERE k=?", (k,)).fetchone()
        if row:
            with self._lock:
                self.cache_hits += 1; self.calls += 1; self.tokens_in += row[1]; self.tokens_out += row[2]
            return Reply(row[0], row[1], row[2], row[3], True)
        # the system prompt goes through a file and the prompt through stdin: a 6k-token context
        # on the command line exceeds the platform's argument length limit
        sys_path = self.workdir / f"system-{hashlib.sha256((system or 'x').encode()).hexdigest()[:12]}.txt"
        if not sys_path.exists():
            sys_path.write_text(system or "You are a helpful assistant.", encoding="utf-8")
        args = [CLAUDE, "-p", "--no-session-persistence", "--output-format", "json",
                "--model", self.model, "--effort", self.effort, "--system-prompt-file", str(sys_path)]
        env = dict(os.environ)
        env.pop("CLAUDECODE", None)   # allow a nested headless call from inside a Claude Code session
        t0 = time.time()
        data = None
        last_err = ""
        for attempt in range(4):
            try:
                out = subprocess.run(args, input=prompt, capture_output=True, text=True, encoding="utf-8", timeout=600, cwd=str(self.workdir), env=env)
                data = json.loads(out.stdout) if out.stdout.strip() else None
                if data and not data.get("is_error"):
                    break
                last_err = (data or {}).get("result") or out.stderr[-400:] or "empty output"
            except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as exc:
                last_err = repr(exc)
            time.sleep(5 * (attempt + 1))
        ms = int((time.time() - t0) * 1000)
        if not data or data.get("is_error"):
            with self._lock:
                self.errors += 1
            raise RuntimeError(f"claude CLI failed after retries: {last_err}")
        text = str(data.get("result", ""))
        u = data.get("usage") or {}
        tin = int(u.get("input_tokens") or 0) + int(u.get("cache_read_input_tokens") or 0) + int(u.get("cache_creation_input_tokens") or 0)
        tout = int(u.get("output_tokens") or 0)
        est = False
        if not tin:
            tin, est = estimate_tokens(system + prompt), True
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO calls VALUES (?,?,?,?,?)", (k, text, tin, tout, ms))
            self._db.commit()
            self.calls += 1; self.tokens_in += tin; self.tokens_out += tout
        return Reply(text, tin, tout, ms, False, est)


def estimate_tokens(text: str) -> int:
    """A labelled estimate: ~4 characters per token for English prose."""
    return max(1, len(text) // 4)
