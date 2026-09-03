"""Rung 4: Athena's own brain, driven headlessly through `personas-memory-sim`.

The adapter speaks one JSON object per line over the binary's stdin/stdout. The binary
owns a throwaway user DB and brain root, a simulated clock set by every call's `at`, and
runs the sleep cycle's model legs through the tree's own production path (the Claude
Code CLI, with the model routing the tree assigns per leg). The harness never reads Athena's tables directly: what the consumer sees is the
rendered memory block the production prompt assembler would have rendered.

Protocol (request -> reply, one line each):
  {"op":"ingest","role":"user"|"assistant","text":str,"at":unix,"conversation":str,"scope":str}
      -> {"ok":true,"episode_id":str}
  {"op":"consolidate","at":unix,"force":bool}
      -> {"ok":true,"admitted":bool,"facts_written":int,"procedurals_written":int,"supersedes":int,
          "llm_calls":int,"tokens_in":int,"tokens_out":int}
  {"op":"recall","query":str,"at":unix,"budget_chars":int,"probe":true}
      -> {"ok":true,"text":str,"items":[str],"chars":int,"trace":{...}}
  {"op":"cost"} -> {"ok":true,"llm_calls":int,"tokens_in":int,"tokens_out":int,"embeddings":int,"store_bytes":int}
  {"op":"quit"} -> {"ok":true}
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from . import Backend, Context, Cost
from ..clock import Clock
from ..llm import estimate_tokens
from ..model import Event, Probe

DEFAULT_BIN = os.environ.get("MEMORY_YEAR_ATHENA_BIN", "")


class Athena(Backend):
    name = "athena"

    def __init__(self, binary: str = DEFAULT_BIN, leg_model: str | None = None, ml: bool = False,
                 consolidate_force: bool = False, workdir: str | None = None):
        if not binary:
            raise SystemExit("athena backend needs --backend-kw '{\"binary\": \"<path to personas-memory-sim>\"}' or MEMORY_YEAR_ATHENA_BIN")
        self.workdir = Path(workdir or tempfile.mkdtemp(prefix="memory-year-athena-"))
        self.db = self.workdir / "personas_data.db"
        self.home = self.workdir / "home"
        self.home.mkdir(parents=True, exist_ok=True)
        args = [binary, "--db", str(self.db), "--home", str(self.home)]
        if leg_model:
            args += ["--leg-model", leg_model]   # an override of the tree's own routing; absent = production routing
        if ml:
            args.append("--ml")
        env = dict(os.environ, PERSONAS_HOME=str(self.home), PERSONAS_ALLOW_FALLBACK_KEY="1", PERSONAS_SIM="1")
        self.proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(self.workdir / "stderr.log", "ab"),
                                     text=True, encoding="utf-8", env=env, bufsize=1)
        self.force = consolidate_force
        self.leg_model = leg_model
        self.ml = ml
        self._cost = Cost()
        self.consolidations = 0

    def _call(self, req: dict) -> dict:
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError(f"personas-memory-sim exited (see {self.workdir / 'stderr.log'})")
        rep = json.loads(line)
        if not rep.get("ok"):
            raise RuntimeError(f"personas-memory-sim error on {req.get('op')}: {rep.get('error')}")
        return rep

    def ingest(self, event: Event, clock: Clock) -> None:
        role = "assistant" if event.kind == "outcome" else "user"
        self._call({"op": "ingest", "role": role, "text": event.text, "at": clock.unix, "conversation": "sim-year", "scope": event.scope})

    def consolidate(self, clock: Clock) -> None:
        rep = self._call({"op": "consolidate", "at": clock.unix, "force": self.force})
        if rep.get("admitted"):
            self.consolidations += 1
        self._cost.model_calls += int(rep.get("llm_calls", 0))
        self._cost.tokens_in += int(rep.get("tokens_in", 0))
        self._cost.tokens_out += int(rep.get("tokens_out", 0))

    def recall(self, probe: Probe, clock: Clock, budget_tokens: int) -> Context:
        rep = self._call({"op": "recall", "query": probe.question, "at": clock.unix, "budget_chars": budget_tokens * 4, "probe": True})
        text = rep.get("text", "")
        return Context(text=text, items=list(rep.get("items", [])), tokens=estimate_tokens(text))

    def cost(self) -> Cost:
        try:
            rep = self._call({"op": "cost"})
            self._cost.embeddings = int(rep.get("embeddings", 0))
            self._cost.store_bytes = int(rep.get("store_bytes", 0))
        except Exception:
            pass
        return self._cost

    def describe(self) -> dict:
        return {"name": self.name, "leg_model": self.leg_model, "ml": self.ml, "consolidate_force": self.force, "consolidations": self.consolidations}


class AthenaTurn(Athena):
    """Athena answering the probe herself: her prompt assembler, her recall, her model
    routing, her CLI invocation, her episode append - through the driver's `turn` op.
    Reported beside the ladder (the consumer is hers, not the harness's)."""

    name = "athena-turn"

    def answers_itself(self) -> bool:
        return True

    def answer(self, probe: Probe, clock: Clock) -> Context:
        rep = self._call({"op": "turn", "text": probe.question, "at": clock.unix, "conversation": "sim-year"})
        self._cost.model_calls += 1
        self._cost.tokens_in += int(rep.get("tokens_in", 0))
        self._cost.tokens_out += int(rep.get("tokens_out", 0))
        return Context(text=str(rep.get("reply", "")), items=list(rep.get("recall_items", [])), tokens=int(rep.get("prompt_chars", 0)) // 4)

    def close(self) -> None:
        try:
            self._call({"op": "quit"})
        except Exception:
            pass
        try:
            self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()
