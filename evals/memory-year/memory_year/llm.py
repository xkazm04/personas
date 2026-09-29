"""Model access through the Claude Code CLI, with a content-addressed cache.

The engine is the operator's Claude Code subscription: every call is `claude -p` with a
replaced system prompt, JSON output, no session persistence, no tools. That is the same
engine Athena ships with, so the consumer in a ladder is the consumer in production, and
the arms differ only in what memory they were shown.

"No tools" is enforced by ISOLATION, not by the empty working directory. Until 2026-09-27
the argv said nothing about tools or settings, and a call from an empty directory still
loaded the operator's user settings: 25 tools, 30 skills, a plugin, and three user hooks
that posted every prompt to a local app - 23,277 input tokens for a 7-word prompt that
costs 479 isolated. `py -m memory_year.checks.cli_isolation` reads what a call loaded.

Model specs are `claude:<model>@<effort>`, e.g. `claude:claude-opus-4-8@low` (Athena's
main turn), `claude:claude-sonnet-5@low`. Calls are cached by (spec, CLI_PROFILE, system,
prompt) so a re-run, a re-judge or a second rung over the same probe costs nothing. The
profile is in the key because a reply cached under a different invocation is a replay of a
different configuration, not a result of this one. The cache is process-shared and
thread-safe; concurrent calls are the normal mode.
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

import re
import shutil

CLAUDE = shutil.which("claude") or "claude"   # the resolved shim, so no shell is needed and argv stays short

DEFAULT_CONSUMER = "claude:claude-opus-4-8@medium"
DEFAULT_JUDGE = "claude:claude-sonnet-5@low"

# What a call must not inherit from the machine it runs on: built-in tools, the user,
# project and local settings files (hooks, plugins, permissions, model settings), MCP
# servers, and skills. Changing this list changes what the model reads, so bump
# CLI_PROFILE with it - the profile is part of every cache key.
ISOLATION = ["--tools", "", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands"]
CLI_PROFILE = "isolated-1"


def cli_args(model: str, effort: str, system_file: Path, output_format: str = "json",
             isolated: bool = True) -> list[str]:
    """The argv of one headless call. `isolated=False` exists for the isolation check's control."""
    args = [CLAUDE, "-p", "--no-session-persistence", "--output-format", output_format,
            "--model", model, "--effort", effort, "--system-prompt-file", str(system_file)]
    return args + ISOLATION if isolated else args


class SeatLimit(RuntimeError):
    """The seat refused: a session, weekly or per-model allowance is exhausted until a reset.

    A refusal is not a result and not a failure to retry. Retrying into a closed window only
    spends attempts and log lines, and a caller that swallows a generic error (the judge does,
    by design) would store a degraded verdict for a probe that was never judged. So this is
    raised on the first refusal, and callers that tolerate model failures let it through: the
    run stops, and `--resume` redoes the refused probe after the reset the message names.
    """


# Fallback vocabulary, read only from the error text of an envelope that says it errored -
# never from a successful reply, whose content may quote a limit message.
_ALLOWANCE = re.compile(r"usage limit|session limit|weekly limit|hit your limit|rate limit|quota|out of (extra )?usage", re.I)
_CAPACITY = re.compile(r"overloaded|at capacity|server is busy|temporarily unavailable", re.I)


def failure_cause(data: dict | None) -> str:
    """-> 'refused-allowance' | 'refused-capacity' | 'turn-cap' | 'spend-cap' | 'error'.

    Structured fields first. The CLI has been observed returning `subtype: "success"` with
    `is_error: true` and exit 0 on a rejected request, so neither the subtype nor the exit code
    is read as the outcome; the forwarded API status is, where the CLI version carries it
    (429 = your allowance, 529 = provider capacity). The text is the fallback.
    """
    if not data:
        return "error"
    status = data.get("api_error_status")
    if status == 429:
        return "refused-allowance"
    if status == 529:
        return "refused-capacity"
    subtype = str(data.get("subtype") or "")
    if subtype == "error_max_turns":
        return "turn-cap"
    if subtype == "error_max_budget_usd":
        return "spend-cap"
    text = str(data.get("result") or "")
    if _ALLOWANCE.search(text):
        return "refused-allowance"
    if _CAPACITY.search(text):
        return "refused-capacity"
    return "error"


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
        self.refusals = 0

    def _key(self, system: str, prompt: str) -> str:
        return hashlib.sha256(json.dumps([self.spec, CLI_PROFILE, system, prompt]).encode()).hexdigest()

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
        args = cli_args(self.model, self.effort, sys_path)
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
                if data and failure_cause(data) == "refused-allowance":
                    with self._lock:
                        self.refusals += 1
                    raise SeatLimit(f"claude CLI refused (allowance): {last_err}")
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
