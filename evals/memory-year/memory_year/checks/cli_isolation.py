"""CLI isolation: read what one headless call actually loaded, isolated and not.

The harness's model calls claim "no tools" and nothing from the machine. An empty working
directory keeps a project's instruction file out, and nothing else: until 2026-09-27 a call
still loaded the operator's user settings - 25 tools, 30 skills, a plugin and three user
hooks that posted each prompt to a local app - and 23,277 input tokens for a 7-word prompt
that costs 479 isolated. A docstring is not evidence of isolation; the CLI's own init
event is. This check makes two real calls with the same trivial prompt:

- isolated: the harness's own argv (`llm.cli_args`), which must load no tools, skills,
  MCP servers or hooks;
- control: the same argv without `llm.ISOLATION`. It is the positive control. If it also
  loads nothing, this machine has nothing to leak and the check cannot see a leak here -
  a pass is then uninformative, and it says so.

Two model calls on the judge's spec (small). Exit 0 = isolated arm clean. Exit 1 = the
isolated arm loaded something, named in the report. Exit 2 = a call failed.

    py -m memory_year.checks.cli_isolation
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from ..llm import DEFAULT_JUDGE, cli_args, parse_spec

PROMPT = "Reply with the single word OK."


def probe(isolated: bool) -> dict:
    model, effort = parse_spec(DEFAULT_JUDGE)
    work = Path(tempfile.mkdtemp(prefix="memory-year-isolation-"))
    sys_path = work / "system.txt"
    sys_path.write_text("You are a helpful assistant.", encoding="utf-8")
    args = cli_args(model, effort, sys_path, output_format="stream-json", isolated=isolated)
    args += ["--verbose", "--include-hook-events"]
    env = dict(os.environ)
    env.pop("CLAUDECODE", None)
    out = subprocess.run(args, input=PROMPT, capture_output=True, text=True, encoding="utf-8",
                         timeout=300, cwd=str(work), env=env)
    events = []
    for line in out.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            pass
    init = next((e for e in events if e.get("type") == "system" and e.get("subtype") == "init"), None)
    result = next((e for e in events if e.get("type") == "result"), None)
    if not init or not result or result.get("is_error"):
        return {"error": (result or {}).get("result") or out.stderr[-400:] or "no init/result event"}
    u = result.get("usage") or {}
    return {
        "tools": len(init.get("tools") or []),
        "skills": len(init.get("skills") or []),
        "mcp_servers": len(init.get("mcp_servers") or []),
        # the builtin instruction-file plugin is part of the CLI, not the machine
        "plugins": [p.get("name") for p in init.get("plugins") or [] if p.get("path") != "builtin"],
        "hooks": sorted({e.get("hook_event") or e.get("hook_name") or "?" for e in events
                         if e.get("type") == "system" and e.get("subtype") == "hook_started"}),
        "input_tokens": int(u.get("input_tokens") or 0) + int(u.get("cache_read_input_tokens") or 0)
                        + int(u.get("cache_creation_input_tokens") or 0),
    }


def loaded(r: dict) -> list[str]:
    return [k for k in ("tools", "skills", "mcp_servers", "plugins", "hooks") if r.get(k)]


def main() -> int:
    iso, ctl = probe(True), probe(False)
    print(f"isolated: {json.dumps(iso)}")
    print(f"control:  {json.dumps(ctl)}")
    if "error" in iso or "error" in ctl:
        print("a call failed - no verdict")
        return 2
    leaks = loaded(iso)
    if leaks:
        print(f"FAIL: the isolated call loaded {', '.join(leaks)}")
        return 1
    if not loaded(ctl):
        print("pass, UNINFORMATIVE: the control loaded nothing either, so this machine has nothing to leak")
    else:
        print(f"pass: control loaded {', '.join(loaded(ctl))}; isolated loaded none "
              f"({ctl['input_tokens']} -> {iso['input_tokens']} input tokens)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
