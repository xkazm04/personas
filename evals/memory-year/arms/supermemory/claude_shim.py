"""OpenAI-compatible /v1/chat/completions over the memory-year harness's cached Claude CLI.

The supermemory self-hosted server takes any OpenAI-compatible endpoint for its write-time
model. The harness's engine is the Claude Code CLI, so this shim is what lets the arm run on
the same engine and the same content-addressed cache as every other arm. It counts calls and
tokens into a JSON file the adapter reads back as write cost.
"""
from __future__ import annotations

import json
import re
import sys
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(HARNESS))
from memory_year.llm import LLM  # noqa: E402

PORT = int(sys.argv[1])
SPEC = sys.argv[2] if len(sys.argv) > 2 else "claude:claude-sonnet-5@low"
STATS = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("shim-stats.json")
LOG = open(STATS.with_suffix(".log.jsonl"), "a", encoding="utf-8")

llm = LLM(SPEC, HARNESS / "out" / "cache" / "supermemory-writer.sqlite")
lock = threading.Lock()
stats = {"requests": 0, "errors": 0, "unhandled": 0, "json_repairs": 0}

JSON_RULE = ("\n\nRespond with a single valid JSON object and nothing else: no prose, no code fence.")
_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.S)


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(p.get("text", "") for p in content if isinstance(p, dict))
    return str(content or "")


def _json_only(text: str) -> str:
    m = _FENCE.search(text)
    if m:
        text = m.group(1)
    s, e = text.find("{"), text.rfind("}")
    if s >= 0 and e > s:
        cand = text[s:e + 1]
        try:
            json.loads(cand)
            return cand
        except ValueError:
            pass
    return text


def _flush():
    with lock:
        snap = dict(stats, calls=llm.calls, cache_hits=llm.cache_hits,
                    tokens_in=llm.tokens_in, tokens_out=llm.tokens_out, cli_errors=llm.errors)
    STATS.write_text(json.dumps(snap), encoding="utf-8")


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        out = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):
        self._send(200, {"object": "list", "data": [{"id": llm.model, "object": "model"}]})

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            body = json.loads(raw)
        except ValueError:
            body = {}
        if not self.path.rstrip("/").endswith("/chat/completions") or body.get("stream"):
            with lock:
                stats["unhandled"] += 1
            LOG.write(json.dumps({"unhandled": self.path, "keys": list(body)}) + "\n"); LOG.flush()
            _flush()
            return self._send(400, {"error": {"message": "shim handles non-streaming chat completions only"}})
        if body.get("tools"):
            return self._tools(body)
        system = "\n\n".join(_text(m.get("content")) for m in body.get("messages", []) if m.get("role") in ("system", "developer"))
        turns = [m for m in body.get("messages", []) if m.get("role") not in ("system", "developer")]
        if len(turns) == 1:
            prompt = _text(turns[0].get("content"))
        else:
            prompt = "\n\n".join(f"[{m.get('role')}]\n{_text(m.get('content'))}" for m in turns)
        rf = (body.get("response_format") or {}).get("type")
        if rf in ("json_object", "json_schema"):
            schema = (body.get("response_format") or {}).get("json_schema")
            prompt += JSON_RULE + (f"\nSchema: {json.dumps(schema)}" if schema else "")
        with lock:
            stats["requests"] += 1
        try:
            reply = llm.complete(prompt, system=system)
            text = reply.text
            if rf in ("json_object", "json_schema"):
                fixed = _json_only(text)
                if fixed != text:
                    with lock:
                        stats["json_repairs"] += 1
                text = fixed
        except Exception as exc:  # the server retries; the failure is counted, not hidden
            with lock:
                stats["errors"] += 1
            LOG.write(json.dumps({"error": repr(exc)[:400]}) + "\n"); LOG.flush()
            _flush()
            return self._send(500, {"error": {"message": repr(exc)[:400], "type": "server_error"}})
        _flush()
        self._send(200, {
            "id": f"chatcmpl-{int(time.time()*1000)}", "object": "chat.completion", "created": int(time.time()),
            "model": body.get("model") or llm.model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": reply.tokens_in, "completion_tokens": reply.tokens_out,
                      "total_tokens": reply.tokens_in + reply.tokens_out},
        })

    def _tools(self, body):
        """Translate an OpenAI tool-calling turn into one CLI call that returns JSON tool calls."""
        system = "\n\n".join(_text(m.get("content")) for m in body["messages"] if m.get("role") in ("system", "developer"))
        tools = []
        for t in body["tools"]:
            f = t.get("function", t)
            params = dict(f.get("parameters") or {})
            params.pop("$schema", None)
            tools.append(f"- {f['name']}: {f.get('description', '')}\n  parameters: {json.dumps(params, separators=(',', ':'))}")
        lines = []
        for m in body["messages"]:
            role = m.get("role")
            if role in ("system", "developer"):
                continue
            if role == "tool":
                lines.append(f"[tool result id={m.get('tool_call_id')}]\n{_text(m.get('content'))}")
            elif role == "assistant":
                if _text(m.get("content")):
                    lines.append(f"[assistant]\n{_text(m.get('content'))}")
                for c in m.get("tool_calls") or []:
                    fn = c.get("function", {})
                    lines.append(f"[assistant called {fn.get('name')} id={c.get('id')}] {fn.get('arguments')}")
            else:
                lines.append(f"[{role}]\n{_text(m.get('content'))}")
        choice = body.get("tool_choice")
        must = choice == "required" or isinstance(choice, dict)
        prompt = ("You are simulating the next turn of the assistant in the transcript below. You cannot execute "
                  "anything yourself and must not try to use any tool of your own: you WRITE the tool calls as JSON "
                  "text and the caller executes them and returns the results in a later turn. "
                  "The assistant has these tools:\n" + "\n".join(tools) +
                  "\n\nTRANSCRIPT\n" + "\n\n".join(lines) +
                  "\n\nDecide the assistant's next turn. Reply with ONE JSON object and nothing else.\n"
                  'To call tools: {"tool_calls": [{"name": "<tool>", "arguments": {...}}, ...]} - you may and should batch '
                  "several independent calls in one turn (for example all searches at once, or every CreateMemory at once).\n"
                  + ("You must call at least one tool this turn.\n" if must else
                     'When the work is finished and no tool is needed: {"content": "<short final message>"}.\n'))
        with lock:
            stats["requests"] += 1
            stats["tool_turns"] = stats.get("tool_turns", 0) + 1
        try:
            obj = None
            for attempt in range(3):
                salt = "" if attempt == 0 else f"\n\n(Retry {attempt}: your previous reply was not a JSON object. Output ONLY the JSON object.)"
                reply = llm.complete(prompt + salt, system=system)
                try:
                    obj = json.loads(_json_only(reply.text))
                    if isinstance(obj, dict):
                        break
                except ValueError:
                    pass
                obj = None
                with lock:
                    stats["json_retries"] = stats.get("json_retries", 0) + 1
            if obj is None:
                raise ValueError("no JSON object after 3 attempts")
        except Exception as exc:
            with lock:
                stats["errors"] += 1
            LOG.write(json.dumps({"tool_error": repr(exc)[:400]}) + "\n"); LOG.flush()
            _flush()
            return self._send(500, {"error": {"message": repr(exc)[:400], "type": "server_error"}})
        calls = obj.get("tool_calls") or []
        stamp = int(time.time() * 1000)
        message = {"role": "assistant", "content": obj.get("content") if not calls else None}
        if calls:
            message["tool_calls"] = [{"id": f"call_{stamp}_{i}", "type": "function",
                                      "function": {"name": c.get("name"), "arguments": json.dumps(c.get("arguments") or {})}}
                                     for i, c in enumerate(calls)]
            with lock:
                stats["tool_calls"] = stats.get("tool_calls", 0) + len(calls)
        _flush()
        self._send(200, {
            "id": f"chatcmpl-{stamp}", "object": "chat.completion", "created": int(time.time()),
            "model": body.get("model") or llm.model,
            "choices": [{"index": 0, "message": message, "finish_reason": "tool_calls" if calls else "stop"}],
            "usage": {"prompt_tokens": reply.tokens_in, "completion_tokens": reply.tokens_out,
                      "total_tokens": reply.tokens_in + reply.tokens_out},
        })

    def log_message(self, *a):
        pass


_flush()
ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
