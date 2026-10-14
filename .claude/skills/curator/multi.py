"""`/curator --multi`: several LLM providers judge conform subjects across every consumer repo.

Why conform, and only conform: a conform worker writes nothing but its own run file in the
repo it judges, the registry's merger is that repo's map's single writer, and every verdict can
be checked mechanically against the code before it lands. That makes it the one lane where a
less capable model can contribute without being trusted - its output is evidence to verify,
not a change to accept.

Where it works: every consumer repo the registry's `projects.json` places on this machine and
that carries a `.ai/registry-map.json` (Personas, pof, kp, ascent, ...). Each seat of a round
takes one (repo, subject); repos are visited in rotation so coverage grows everywhere, not only
where the backlog is biggest.

What makes a weaker provider safe here, in order of how much it carries:

* **The orchestrator does the mechanical half.** The dossier names the subject's golden path,
  every technique file, each pair's context and its REAL file list from `context-map.json`,
  so the provider never resolves an index, builds a path, or picks pairs.
* **Read-only seats, structured output.** No provider writes a file: each returns one JSON
  object, and this module writes the run file itself.
* **The validator.** Every anchor must resolve to a tracked file and a non-blank line, and the
  provider must QUOTE that line; a quote found a few lines away repairs the line number, a
  quote found nowhere rejects the anchor. The evidence floor of /conform 3 is enforced in
  code. A rejected pair becomes a `declined` row with the reason, never a verdict.
* **The reviewer (night runs).** A headless Claude session spot-checks every landed verdict of
  a round against the printed anchor line and returns withdrawals, which `withdraw` applies.

State lives outside every repo (`~/.personas/curator-multi/`, `CURATOR_MULTI_DIR` overrides):
`state.json` (dropped providers, rounds run, subjects tried, the repo cursor), `scoreboard.jsonl`
(one row per seat - the source of the provider-by-topic feel), `rounds/<n>.json` (a round's
summary), `night/<date>.{jsonl,md}` (a night's log and its morning report). A round's raw prompts
and outputs live in `rounds/<n>/` only until the round is judged.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta

import loop as L

MULTI_DIR = pathlib.Path(os.environ.get("CURATOR_MULTI_DIR") or (pathlib.Path.home() / ".personas" / "curator-multi"))

if sys.platform == "win32":
    # Nothing this driver starts may open a window on the operator's desktop (measured 2026-10-13:
    # the unattended night popped a console for every reviewer, git and node call). Every child -
    # here and in loop.py, which shares this process - gets CREATE_NO_WINDOW unless it asked for a
    # console or detachment of its own, with which the flag cannot combine.
    _popen_init = subprocess.Popen.__init__

    def _windowless_init(self, *args, **kwargs):
        flags = kwargs.get("creationflags", 0) or 0
        if not flags & (subprocess.CREATE_NEW_CONSOLE | subprocess.DETACHED_PROCESS):
            kwargs["creationflags"] = flags | subprocess.CREATE_NO_WINDOW
        _popen_init(self, *args, **kwargs)

    subprocess.Popen.__init__ = _windowless_init
HOME = pathlib.Path.home()

# --------------------------------------------------------------------------
# Providers
# --------------------------------------------------------------------------

# The seats the operator named on 2026-10-12. `model` is what the CLI is asked for; `flash`
# for agy means the newest flash slug `agy models` lists, resolved at run time.
PROVIDERS = {
    "codex": {"label": "codex-cli", "model": "gpt-6.1-sol", "effort": "high"},
    "grok": {"label": "grok-cli", "model": "grok-4.7", "effort": "high"},
    "agy": {"label": "agy-cli", "model": "latest-flash", "effort": "high"},
}

# Phrases a provider prints when its plan's quota, not the work, ended the run.
LIMIT_SIGNATURES = L.LIMIT_SIGNATURES + (
    "rate limit", "rate_limit", "quota", "resource_exhausted", "resource exhausted", "429",
    "too many requests", "insufficient_quota", "credits", "upgrade your plan",
)


def bin_of(name: str) -> str | None:
    if name == "agy":
        local = pathlib.Path(os.environ.get("LOCALAPPDATA", "")) / "agy" / "bin" / "agy.exe"
        return str(local) if local.exists() else shutil.which("agy")
    if name == "grok":
        local = HOME / ".grok" / "bin" / "grok.exe"
        return shutil.which("grok") or (str(local) if local.exists() else None)
    return shutil.which(name)


def agy_flash_model() -> str:
    """The newest `gemini-X.Y-flash-high` slug agy offers (the operator asked for the latest flash)."""
    b = bin_of("agy")
    try:
        out = subprocess.run([b, "models"], capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=60).stdout
    except Exception:
        out = ""
    found = re.findall(r"gemini-(\d+)\.(\d+)-flash-high", out)
    if not found:
        return "gemini-3.8-flash-high"
    major, minor = max((int(a), int(b)) for a, b in found)
    return f"gemini-{major}.{minor}-flash-high"


def seat_command(name: str, model: str, effort: str, prompt_file: pathlib.Path, schema_file: pathlib.Path,
                 seat_dir: pathlib.Path, session_id: str, repo: str) -> tuple[list[str], str | None, dict]:
    """(argv, stdin text, extra env). Every seat is told to stay read-only; codex's sandbox enforces it."""
    b = bin_of(name)
    prompt = prompt_file.read_text(encoding="utf-8")
    if name == "codex":
        # --ephemeral: no session files to clean. read-only sandbox: no file can be written.
        # Prompt on stdin (`-`); a closed stdin is required or it waits for more input.
        return ([b, "exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only",
                 "-C", repo, "-m", model, "-c", f'model_reasoning_effort="{effort}"',
                 "--output-schema", str(schema_file), "-o", str(seat_dir / "last.json"), "-"], prompt, {})
    if name == "grok":
        # Our own session id, so its session directory can be deleted exactly. No subagents:
        # grok's subagents run in git worktrees under ~/.grok/worktrees.
        # NO --json-schema: measured round 1 (2026-10-12), it makes grok answer in ONE turn with no
        # tool call - it judged five pairs without opening a file and wrote "DRAFT ONLY - do not keep".
        return ([b, "--prompt-file", str(prompt_file), "-m", model, "--effort", effort,
                 "--output-format", "json", "--always-approve",
                 "--permission-mode", "bypassPermissions", "--no-subagents", "--disable-web-search",
                 "-s", session_id, "--cwd", repo], None, {"GROK_MEMORY": "0", "GROK_AGENT_DASHBOARD": "0"})
    if name == "agy":
        # agy blocks on an open stdin pipe on Windows, so the prompt rides as -p (contest's adapter).
        return ([b, "-p", prompt, "--model", model, "--output-format", "json", "--json-schema", str(schema_file),
                 "--dangerously-skip-permissions", "--disable-slash-commands", "--print-timeout", "2h"], None, {})
    raise ValueError(name)


# --------------------------------------------------------------------------
# Consumer repos - where the seats judge
# --------------------------------------------------------------------------


def consumer_repos(registry: pathlib.Path, only: list[str] | None = None) -> list[dict]:
    """[{slug, root}] for every project the registry places on THIS machine that has a map.

    Resolved the registry's own way: `projects.json` checkouts keyed by machine, relative to the
    root in the gitignored `.machine.local.json` (which may also carry per-slug overrides).
    Personas is always included, first, because this driver's own map lives there.
    """
    out = [{"slug": "personas", "root": L.PERSONAS_ROOT}]
    try:
        projects = L._read_json(registry / "projects.json", {}) or {}
        machine = L._read_json(registry / ".machine.local.json", {}) or {}
    except Exception:
        projects, machine = {}, {}
    name, base = machine.get("machine"), machine.get("root")
    overrides = machine.get("overrides") or machine.get("checkouts") or {}
    for slug, pr in (projects.get("projects") or {}).items():
        rel = overrides.get(slug) or (pr.get("checkouts") or {}).get(name)
        if not rel or not base or slug == "personas":
            continue
        root = pathlib.Path(rel) if pathlib.Path(rel).is_absolute() else pathlib.Path(base) / rel
        if (root / L.MAP_REL).exists() and (root / ".git").exists():
            out.append({"slug": slug, "root": root.resolve()})
    if only:
        out = [r for r in out if r["slug"] in only]
    return out


def repo_by_root(root) -> dict:
    root = pathlib.Path(root)
    return {"slug": root.name if root.resolve() != L.PERSONAS_ROOT else "personas", "root": root}


# --------------------------------------------------------------------------
# The answer the seats must return
# --------------------------------------------------------------------------

VERDICTS = ["conformant", "deviation", "not-applicable", "unknown"]
TECH_VERDICTS = ["conformant", "deviation", "not-applicable", "unread"]

# Strict-mode shape (codex requires every property required and no extras).
_anchor = {"type": "string", "description": "repo-relative path:line, e.g. src/lib/foo.ts:41"}
_quote = {"type": "string", "description": "the exact text of that line, copied verbatim"}
SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["subject", "pairs", "declined", "notes"],
    "properties": {
        "subject": {"type": "string"},
        "pairs": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["context", "state", "anchor", "quote", "consequence", "techniques", "registryProposal",
                         "absence_terms"],
            "properties": {
                "context": {"type": "string"},
                "state": {"type": "string", "enum": VERDICTS},
                "anchor": _anchor, "quote": _quote,
                "consequence": {"type": "string", "description": "one sentence"},
                "absence_terms": {"type": "array", "items": {"type": "string"},
                                  "description": "not-applicable only: the 2-5 terms you searched for and did not find"},
                "techniques": {"type": "array", "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["technique", "verdict", "anchor", "quote", "note"],
                    "properties": {"technique": {"type": "string"},
                                   "verdict": {"type": "string", "enum": TECH_VERDICTS},
                                   "anchor": _anchor, "quote": _quote, "note": {"type": "string"}}}},
                "registryProposal": {"type": "string"}}}},
        "declined": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["context", "reason"],
            "properties": {"context": {"type": "string"}, "reason": {"type": "string"}}}},
        "notes": {"type": "string"},
    },
}

# --------------------------------------------------------------------------
# The dossier - everything mechanical, done before the seat starts
# --------------------------------------------------------------------------

DEFAULT_STACKS = ("typescript", "react", "tauri", "rust", "node", "vite", "zustand", "sqlite")
PAIR_BUDGET = 5
_INDEX_CACHE: dict[str, dict] = {}


def _json(path: pathlib.Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _json_or(path: pathlib.Path, default):
    try:
        return _json(path)
    except (OSError, ValueError):
        return default


def subject_entry(registry: pathlib.Path, domain: str, slug: str) -> dict | None:
    key = str(registry / "knowledge" / domain / "index.json")
    if key not in _INDEX_CACHE:
        _INDEX_CACHE[key] = (_json_or(pathlib.Path(key), {}) or {}).get("subjects", {})
    return _INDEX_CACHE[key].get(slug)


_TRACKED_CACHE: dict[str, set[str]] = {}


def tracked_files(root: pathlib.Path) -> set[str]:
    key = str(root)
    if key not in _TRACKED_CACHE:
        out = subprocess.run(["git", "-C", key, "ls-files"], capture_output=True, text=True,
                             encoding="utf-8", errors="replace").stdout
        _TRACKED_CACHE[key] = set(out.splitlines())
    return _TRACKED_CACHE[key]


def repo_stacks(root: pathlib.Path) -> tuple[str, ...]:
    """The repo's languages from `.ai/manifest.yaml` `repo.languages`, for picking applications."""
    try:
        m = re.search(r"^\s*languages:\s*\[([^\]]*)\]", (root / ".ai" / "manifest.yaml").read_text(encoding="utf-8"), re.M)
    except OSError:
        m = None
    langs = tuple(x.strip().strip("'\"").lower() for x in m.group(1).split(",")) if m else ()
    return tuple(x for x in langs if x) or DEFAULT_STACKS


def dossier(registry: pathlib.Path, claim: dict, repo: dict) -> dict | None:
    """The subject, its techniques, and the pairs worth a read in `repo`. None = nothing to judge."""
    root = pathlib.Path(repo["root"])
    domain, slug = claim["subject"].split("/", 1)[0], claim["subject"].split("/")[-1]
    entry = subject_entry(registry, domain, slug)
    if not entry:
        return None
    golden = registry / entry["file"]
    tdir = golden.parent / "techniques"
    techniques = [{"slug": t["slug"], "file": (tdir / f"{t['slug']}.md").as_posix(),
                   "use_when": (t.get("use_when") or [])[:2]} for t in entry.get("techniques", [])]
    stacks = repo_stacks(root)
    apps = [(registry / a["file"]).as_posix() for a in entry.get("applications", [])
            if any(s in (a.get("stack") or "").lower() for s in stacks)][:4]
    rmap = _json(root / L.MAP_REL)
    cmap = {c["id"]: c for c in (_json_or(root / "context-map.json", {}) or {}).get("contexts", [])}
    tracked = tracked_files(root)
    cands = []
    for row in rmap.get("contexts", []):
        if row.get("governance") in ("weak", "dead"):
            continue
        for p in row.get("subjects", []):
            if p.get("subject") != slug or (p.get("bundle") and p["bundle"] != domain):
                continue
            judged = p.get("state") not in (None, "unknown")
            if judged and not p.get("stale"):
                continue  # a current verdict is settled; re-judging it is not this lane's job
            rank = (0 if p.get("stale") else 1 if p.get("confidence") == "strong" else 2,
                    1 if p.get("priorNotApplicable") else 0, -float(p.get("score") or 0))
            cx = cmap.get(row["context"], {})
            # A map can outlive its tree. Measured 2026-10-12 in goat: every file of a context was
            # gone, and a seat spent five minutes proving it. Judge only files that still exist.
            listed = cx.get("file_paths") or row.get("paths") or []
            present = [f for f in listed if f in tracked]
            if listed and not present:
                continue
            cands.append((rank, {
                "context": row["name"], "context_id": row["context"],
                "description": (cx.get("description") or "")[:300],
                "files": present[:25],
                "prior": ({"state": p.get("state"), "evidence": p.get("evidence")} if judged else None),
            }))
    cands.sort(key=lambda x: x[0])
    pairs = [c for _, c in cands[:PAIR_BUDGET]]
    if not pairs:
        return None
    path = entry["file"].split("/")
    return {"repo": repo["slug"], "repo_root": str(root), "domain": domain, "slug": slug,
            "category": "/".join(path[2:-2]) or entry.get("category"),
            "golden": golden.as_posix(), "techniques": techniques, "applications": apps, "pairs": pairs}


def brief(d: dict, provider: str | None = None) -> str:
    T = len(d["techniques"])
    need = math.ceil(T / 2)
    tech = "\n".join(f"   - `{t['slug']}`: {t['file']}" + (f"  (use when: {'; '.join(t['use_when'])})" if t["use_when"] else "")
                     for t in d["techniques"])
    apps = "\n".join(f"   - {a}" for a in d["applications"]) or "   - (none for this stack)"
    pairs = []
    for i, p in enumerate(d["pairs"], 1):
        prior = f"\n   Earlier verdict (now stale, re-judge it): {p['prior']['state']} - {p['prior']['evidence']}" if p["prior"] else ""
        pairs.append(f"{i}. context `{p['context']}`: {p['description']}\n   files: "
                     + ", ".join(p["files"]) + prior)
    refused = [st for st, act in PROVIDER_POLICY.get(provider or "", {}).items() if act == "decline"]
    seat_rule = (f"- From THIS seat, {' and '.join(refused)} is not accepted: when you believe the subject does "
                 f"not apply, return state \"unknown\" (or put the pair in \"declined\") and spend your effort on "
                 f"pairs where you can show a deviation or a conformant realization.\n") if refused else ""
    return f"""You are judging ONE subject of a knowledge registry against the code of the repository at
{pathlib.Path(d['repo_root']).as_posix()} (your working directory). You are one of several model seats;
every verdict you return is checked line by line before it is kept, so an honest "unknown" is worth
more than a confident guess.

HARD RULES
- READ ONLY. Do not create, edit, move or delete any file. Do not run git commands that change
  anything. Your only output is the final JSON object described at the end.
- The standard does not bend to the code. Where the code falls short, that is a deviation.
- Never write placeholder evidence. Every anchor must be a line you actually opened.
- USE YOUR TOOLS: open the standard and the code files before answering. An answer from a seat
  that opened no file is refused whole, and so is one whose notes call itself a draft.
- An earlier verdict shown below is a claim to re-check, not an answer to copy.
{seat_rule}- Judge each context by ITS OWN code. A fact about the whole repo (a hook, a CI job) repeated
  on several contexts is a verdict about none of them: write it once in "notes", and judge the
  context on its files or mark it unknown. Repeated off-context anchors are refused.

THE SUBJECT: `{d['slug']}` (bundle `{d['domain']}`), {T} techniques.

STEP 1 - read the standard FIRST, before any code:
   golden path: {d['golden']}
   techniques (read each file; note its decision rule "when X, do Y, because Z"):
{tech}
   applications on a similar stack (teaching examples, optional):
{apps}

STEP 2 - for each pair below, read the context's files (paths are relative to the repo root;
search the repo with rg/grep when the construct lives elsewhere):
{chr(10).join(pairs)}

STEP 3 - judge each technique for that context, then the pair:
   technique verdicts: conformant (realized) | deviation (not realized, or realized the way the
   technique names as a failure) | not-applicable (its precondition does not hold here) | unread.
   pair state:
   - conformant: no technique is a deviation AND you cite at least {need} of the {T} techniques with
     an anchor, and every technique you call conformant has its own anchor.
   - deviation: at least one technique is a deviation; the pair anchor points at where it should be.
   - not-applicable: the subject's precondition does not hold; anchor the line that shows it
     (a manifest, config or module that proves the absence). Absence must be SEARCHED for, not
     assumed: grep the context's files and the repo for the subject's own terms first and say in
     the consequence what the search found. A file's first line or a struct declaration does not
     prove anything is absent (measured: two such verdicts were contradicted by tool manifests
     the context published). Put the 2-5 terms you searched for in "absence_terms" - the
     subject's own vocabulary as it would appear in code (identifiers, config keys, e.g. "mcp",
     "#[cfg(test)]", "prompt"). The driver re-runs that search over this context's directories,
     and ANY hit refuses the verdict, so search properly before you claim absence. Leave
     "absence_terms" empty for every other state.
   - unknown: you are not sure. Use it freely; a wrong verdict is worse than none.
   If you cannot judge a pair at all, put it in "declined" with the reason instead.

STEP 4 - anchors (this is where seats fail most):
   - anchor = `path:line`, the path relative to the repo root with forward slashes, exactly as
     `git ls-files` prints it (no absolute path, no basename alone).
   - Open the file and print the line before you cite it. The line must SAY what you claim,
     not be blank, a brace, or the line above the construct.
   - quote = that line's text copied verbatim (trimmed). It is compared with the file.
   - Each technique needs ITS OWN anchor. One line reused for several techniques counts as one
     piece of evidence, so a generic line (`mod tests {{`, a config include) cannot carry a verdict.
     A technique you did not check is `unread`, which costs nothing.
   - consequence = one sentence: what the code does and why it matters for the technique.

OUTPUT - reply with exactly one JSON object and nothing else:
{{"subject": "{d['slug']}",
 "pairs": [{{"context": "<context name from the list>", "state": "conformant|deviation|not-applicable|unknown",
            "anchor": "src/x/y.ts:41", "quote": "<line 41 verbatim>", "consequence": "<one sentence>",
            "techniques": [{{"technique": "<technique slug>", "verdict": "conformant|deviation|not-applicable|unread",
                            "anchor": "src/x/y.ts:41", "quote": "<that line verbatim>", "note": "<short>"}}],
            "registryProposal": "<a finding about the standard itself, or empty string>",
            "absence_terms": ["<not-applicable only: terms you searched and did not find>"]}}],
 "declined": [{{"context": "<context name>", "reason": "<why>"}}],
 "notes": "<anything the reviewer should know, or empty string>"}}
"""


# --------------------------------------------------------------------------
# Reading what a seat returned
# --------------------------------------------------------------------------


def _last_json_object(text: str, key: str = "pairs") -> dict | None:
    """The last top-level {...} in `text` that parses and carries `key`."""
    best, depth, start, in_str, esc = None, 0, None, False, False
    for i, ch in enumerate(text or ""):
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
            if depth == 0 and start is not None:
                try:
                    obj = json.loads(text[start:i + 1])
                    if isinstance(obj, dict) and key in obj:
                        best = obj
                except ValueError:
                    pass
    return best


def read_seat(name: str, seat_dir: pathlib.Path, stdout: str) -> dict:
    """{answer, session, usage, error, read_nothing} from a seat's envelope."""
    res = {"answer": None, "session": None, "usage": None, "error": None, "read_nothing": None}
    if name == "codex":
        last = seat_dir / "last.json"
        if last.exists():
            txt = last.read_text(encoding="utf-8", errors="replace")
            try:
                res["answer"] = json.loads(txt)
            except ValueError:
                res["answer"] = _last_json_object(txt)
        for line in stdout.splitlines():
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("type") == "turn.completed" and ev.get("usage"):
                res["usage"] = ev["usage"]
            if ev.get("type") in ("error", "turn.failed"):
                res["error"] = json.dumps(ev)[:600]
        if '"command_execution"' not in stdout:
            res["read_nothing"] = "codex ran no command: no file was opened"
        return res
    try:
        env = json.loads(stdout)
    except ValueError:
        env = None
    if not isinstance(env, dict):
        res["error"] = "unreadable envelope"
        res["answer"] = _last_json_object(stdout)
        return res
    if name == "grok":
        res["session"] = env.get("sessionId")
        res["usage"] = {"usage": env.get("usage"), "cost_usd": env.get("total_cost_usd"), "turns": env.get("num_turns")}
        if (env.get("num_turns") or 0) <= 1:
            res["read_nothing"] = f"grok answered in {env.get('num_turns')} turn(s): no file was opened"
        res["answer"] = env.get("structuredOutput") if isinstance(env.get("structuredOutput"), dict) else _last_json_object(env.get("text") or "")
        if env.get("stopReason") not in (None, "end_turn"):
            res["error"] = f"stopReason {env.get('stopReason')}"
    elif name == "agy":
        res["session"] = env.get("conversation_id")
        res["usage"] = {"usage": env.get("usage"), "turns": env.get("num_turns"), "seconds": env.get("duration_seconds")}
        resp = env.get("structured_output") or env.get("response")
        res["answer"] = resp if isinstance(resp, dict) else _last_json_object(resp or "")
        if env.get("status") != "SUCCESS":
            res["error"] = f"status {env.get('status')}: {str(env.get('error') or '')[:300]}"
        if env.get("denied_actions"):
            res["error"] = (res["error"] or "") + f" denied_actions {json.dumps(env['denied_actions'])[:300]}"
    return res


TRANSIENT_SIGNATURES = ("at capacity", "overloaded", "temporarily unavailable", "service unavailable",
                        "503", "502 bad gateway", "internal server error", "connection reset",
                        "timed out waiting", "econnreset", "network error")


def seat_transient(stdout: str, stderr: str, seat_error: str) -> str | None:
    """The provider failed for a reason that is neither the work nor its quota, else None.
    Only consulted when no answer came back, like the limit check."""
    blob = " ".join([(seat_error or ""), (stderr or "")[-2000:], (stdout or "")[-2000:]]).lower()
    return next((s for s in TRANSIENT_SIGNATURES if s in blob), None)


def seat_limited(stdout: str, stderr: str, exit_code: int | None, answer: dict | None) -> bool:
    """A quota ended the run. Only when no usable answer came back: an answer that MENTIONS a
    limit (a subject about rate limiting) is an answer."""
    if answer and answer.get("pairs"):
        return False
    blob = ((stderr or "")[-3000:] + "\n" + (stdout or "")[-3000:]).lower()
    return any(s in blob for s in LIMIT_SIGNATURES)


# --------------------------------------------------------------------------
# The validator - what makes a weaker seat's answer safe to merge
# --------------------------------------------------------------------------

ANCHOR = re.compile(r"^\s*`?(.+?\.[A-Za-z0-9]+)`?:(\d+)")
PLACEHOLDER = re.compile(r"placeholder|lorem|todo:|<path>|<line|example\.ts|src/x/y", re.I)


class Files:
    """Tracked files of one repo, read once, lines cached."""

    def __init__(self, root: pathlib.Path | None = None):
        self.root = pathlib.Path(root or L.PERSONAS_ROOT)
        out = subprocess.run(["git", "-C", str(self.root), "ls-files"], capture_output=True,
                             text=True, encoding="utf-8", errors="replace").stdout
        self.tracked = {p: p for p in out.splitlines()}
        self.lower = {p.lower(): p for p in self.tracked}
        self.cache: dict[str, list[str]] = {}

    def resolve(self, raw: str) -> str | None:
        p = raw.strip().strip("`'\"").replace("\\", "/")
        root = self.root.as_posix()
        for prefix in (root + "/", root.lower() + "/", "./"):
            if p.lower().startswith(prefix.lower()):
                p = p[len(prefix):]
        return self.tracked.get(p) or self.lower.get(p.lower())

    def lines(self, rel: str) -> list[str]:
        if rel not in self.cache:
            try:
                self.cache[rel] = (self.root / rel).read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                self.cache[rel] = []
        return self.cache[rel]


def _norm(s: str) -> str:
    return " ".join((s or "").split())


def check_anchor(files: Files, anchor: str, quote: str) -> tuple[str | None, str | None, str | None]:
    """(fixed 'path:line', repair note, rejection). The quote decides where the anchor really is."""
    m = ANCHOR.match(anchor or "")
    if not m:
        return None, None, f"no path:line anchor in {anchor!r}"
    rel = files.resolve(m.group(1))
    if not rel:
        return None, None, f"{m.group(1)} is not a tracked file"
    n, lines = int(m.group(2)), files.lines(rel)
    q = _norm(quote)
    if PLACEHOLDER.search(anchor) or PLACEHOLDER.search(quote or ""):
        return None, None, f"placeholder evidence at {anchor}"
    if not q or len(q) < 4:
        return None, None, f"{rel}:{n} has no quote to verify"
    probe = q[:80]
    hit = lambda i: 0 < i <= len(lines) and lines[i - 1].strip() and (probe in _norm(lines[i - 1]) or _norm(lines[i - 1]) in q)
    if hit(n):
        return f"{rel}:{n}", None, None
    for d in (1, -1, 2, -2, 3, -3):
        if hit(n + d):
            return f"{rel}:{n + d}", f"line {n}->{n + d}", None
    found = [i for i in range(1, len(lines) + 1) if hit(i)]
    if len(found) == 1:
        return f"{rel}:{found[0]}", f"line {n}->{found[0]} (quote found elsewhere)", None
    if 0 < n <= len(lines) and not lines[n - 1].strip():
        return None, None, f"{rel}:{n} is a blank line"
    return None, None, f"{rel}:{n} does not contain the quoted text"


# Statements about the ANSWER, not about scope. Measured round 3: codex's honest "hosting-platform
# enforcement was not verified" and "contain no placeholder anchors" tripped a looser pattern and
# a good answer was refused whole.
SELF_DISCLAIMER = re.compile(
    r"draft only|\bdo not keep\b|\bdon't keep\b|evidence (is |was )?not (yet )?verified|"
    r"(this|the|my) (answer|output|json|result) is (a |an )?(draft|unverified|guess|placeholder)|"
    r"placeholder (evidence|anchors?|verdicts?) (were |was )?(used|written|included|returned)|"
    r"guess(ed)? without (reading|opening)", re.I)


REF = re.compile(r"(?<![\w/:.-])((?:[\w@.-]+/)+[\w@.-]+\.[A-Za-z0-9]{1,6})(?::(\d+))?")


def mentioned_refs_problem(files: Files, text: str) -> str | None:
    """The first repo path (with a slash) the text names that is not a tracked file, or names a line
    past its end. Basenames and URLs are not checked: neither can be resolved without guessing."""
    for m in REF.finditer(text or ""):
        raw = m.group(1)
        if "://" in text[max(0, m.start() - 10):m.end()] or raw.startswith(("http", "www.")):
            continue
        rel = files.resolve(raw)
        if not rel:
            return f"{raw}, which is not a tracked file"
        if m.group(2) and int(m.group(2)) > len(files.lines(rel)):
            return f"{raw}:{m.group(2)}, past the end of the file"
    return None


def search_scope(files: list[str]) -> list[str]:
    """Where an absence claim is checked: each context file's own directory when that directory
    is specific (two or more levels deep), else the file itself. `src` or the repo root would
    turn every common word into a contradiction."""
    scope = set()
    for f in files:
        parent = pathlib.PurePosixPath(f).parent
        scope.add(str(parent) if len(parent.parts) >= 2 else f)
    return sorted(scope)


def absence_contradicted(files: Files, ctx_files: list[str], terms: list[str]) -> str | None:
    """`path:line 'term'` for the first tracked line in the context's scope that contains one of
    the terms the seat says it searched for and did not find, else None."""
    scope = search_scope([f for f in ctx_files if f in files.tracked])
    if not scope or not terms:
        return None
    args = ["git", "-C", str(files.root), "grep", "-n", "-i", "-F", "-I"]
    for t in terms:
        args += ["-e", t]
    r = subprocess.run([*args, "--", *scope], capture_output=True, text=True, encoding="utf-8", errors="replace")
    hits = [l for l in r.stdout.splitlines() if l.strip()]
    if not hits:
        return None
    path, line, text = (hits[0].split(":", 2) + ["", ""])[:3]
    term = next((t for t in terms if t.lower() in text.lower()), terms[0])
    return f"{path}:{line} contains '{term}' ({len(hits)} hit(s) in the context's directories)"


# Per-provider refusals, from measured withdrawal rates (5-hour continuous run, 2026-10-13: of
# what landed, the reviewer withdrew agy's not-applicable 29%, deviation 19%; codex's 16% / 3%;
# grok's 15% / 8%). agy's not-applicable also gamed the absence search with registry jargon. A
# refused state becomes a decline - the pair stays unknown for a seat that judges it better.
PROVIDER_POLICY = {"agy": {"not-applicable": "decline"}}


def jargon_terms(d: dict, terms: list[str]) -> list[str]:
    """Search terms that are the registry's vocabulary rather than the code's: a technique or the
    subject slug, or a hyphen/underscore compound made only of their words. A search for
    `dated-capability-matrix` finds nothing in any repo, so it proves no absence."""
    slugs = {t["slug"].lower() for t in d.get("techniques", [])} | {d.get("slug", "").lower()}
    words = {w for s in slugs for w in re.split(r"[-_]", s) if w}
    out = []
    for t in terms:
        tl = t.lower().strip()
        parts = [w for w in re.split(r"[-_\s]", tl) if w]
        if tl in slugs or (len(parts) >= 2 and all(w in words for w in parts)):
            out.append(t)
    return out


def validate(answer: dict | None, d: dict, files: Files, read_nothing: str | None = None,
             provider: str | None = None) -> dict:
    """Turn a seat's answer into run-file pairs + declines, with every repair and refusal counted."""
    out = {"pairs": [], "declined": [], "repairs": [], "rejections": [], "returned": 0}
    if not isinstance(answer, dict):
        out["rejections"].append("no JSON answer")
        return out
    # Whole-answer refusals: a seat that read nothing, or that says its own answer is not to be kept.
    whole = read_nothing or (f"the seat disclaimed its own answer: {_norm(answer.get('notes'))[:160]}"
                             if SELF_DISCLAIMER.search(answer.get("notes") or "") else None)
    if whole:
        out["returned"] = len(answer.get("pairs") or [])
        out["rejections"].append(whole)
        out["declined"] = [{"subject": d["slug"], "context": p["context"], "reason": f"curator-multi refused the seat's answer: {whole}"}
                           for p in d["pairs"]]
        return out
    names = {p["context"]: p for p in d["pairs"]}
    by_id = {p["context_id"]: p for p in d["pairs"]}
    slugs = {t["slug"] for t in d["techniques"]}
    T = len(slugs)
    need = math.ceil(T / 2)
    seen = set()
    for raw in answer.get("pairs") or []:
        out["returned"] += 1
        if not isinstance(raw, dict):
            out["rejections"].append("a pair is not an object")
            continue
        ctxname = str(raw.get("context") or "").strip().strip("`")
        ctx = names.get(ctxname) or by_id.get(ctxname)
        if not ctx:
            out["rejections"].append(f"context {ctxname!r} is not one of the dossier's")
            continue
        name = ctx["context"]
        if name in seen:
            out["rejections"].append(f"{name}: judged twice")
            continue
        seen.add(name)
        decline = lambda why: (out["declined"].append({"subject": d["slug"], "context": name, "reason": why}),
                               out["rejections"].append(f"{name}: {why}"))
        state = raw.get("state")
        if state not in VERDICTS:
            decline(f"state {state!r} not in vocabulary")
            continue
        if state == "unknown":
            out["declined"].append({"subject": d["slug"], "context": name, "reason": "the seat returned unknown"})
            continue
        if PROVIDER_POLICY.get(provider or "", {}).get(state) == "decline":
            decline(f"{state} is not accepted from {provider} (measured withdrawal rate; PROVIDER_POLICY)")
            continue
        techs, cited_anchors = [], set()
        tech_dev = False
        for t in raw.get("techniques") or []:
            slug = str(t.get("technique") or "").strip()
            v = t.get("verdict")
            if slug not in slugs:
                out["rejections"].append(f"{name}: technique {slug!r} is not this subject's")
                continue
            if v == "unread" or v not in TECH_VERDICTS:
                continue
            fixed, rep, bad = check_anchor(files, t.get("anchor") or "", t.get("quote") or "")
            if bad:
                out["rejections"].append(f"{name}/{slug}: {bad}")
                if v == "deviation":
                    tech_dev = True  # an unanchored deviation still says the pair is not conformant
                continue
            if rep:
                out["repairs"].append(f"{name}/{slug}: {rep}")
            cited_anchors.add(fixed)
            tech_dev = tech_dev or v == "deviation"
            techs.append({"technique": slug, "verdict": v,
                          "evidence": f"{fixed} {_norm(t.get('note') or '')}".strip()})
        fixed, rep, bad = check_anchor(files, raw.get("anchor") or "", raw.get("quote") or "")
        if bad:
            decline(f"pair anchor refused: {bad}")
            continue
        if rep:
            out["repairs"].append(f"{name}: {rep}")
        consequence = _norm(raw.get("consequence") or "")
        if len(consequence) < 12:
            decline("no consequence sentence")
            continue
        # Every OTHER file the text leans on must exist too. Measured 2026-10-12: the reviewer kept
        # noting "the claim rests on a file named in the evidence text" that nobody had checked.
        bad_ref = mentioned_refs_problem(files, " ".join([consequence, *[t["evidence"] for t in techs]]))
        if bad_ref:
            decline(f"evidence leans on {bad_ref}")
            continue
        if state == "conformant":
            if tech_dev:
                decline("called conformant while a technique is a deviation")
                continue
            # One anchor reused for several techniques is one piece of evidence: measured round 1,
            # agy anchored five or six "not-applicable" techniques on `mod tests {` to reach the floor.
            if len(cited_anchors) < need:
                decline(f"conformant below the evidence floor: {len(cited_anchors)} distinct anchors for {T} techniques, {need} needed")
                continue
            if sum(1 for t in techs if t["verdict"] == "conformant") < 2:
                decline("conformant with fewer than two techniques shown realized")
                continue
        if state == "deviation" and not any(t["verdict"] == "deviation" for t in techs) and not tech_dev:
            decline("deviation with no technique named as the deviation")
            continue
        terms: list[str] = []
        if state == "not-applicable":
            # Measured night 2026-10-12: a quarter of agy's not-applicable verdicts were withdrawn,
            # most because the absence they claimed was one grep away (a `#[cfg(test)]` module, an
            # `e.mcp` read). The seat names its search; the driver re-runs it and any hit refuses.
            terms = [t.strip() for t in (raw.get("absence_terms") or []) if isinstance(t, str) and len(t.strip()) >= 3][:5]
            jargon = jargon_terms(d, terms)
            if jargon:
                out["rejections"].append(f"{name}: registry vocabulary is not a code search: {jargon}")
                terms = [t for t in terms if t not in jargon]
            if len(terms) < 2:
                decline("not-applicable without the 2+ search terms that prove the absence")
                continue
            hit = absence_contradicted(files, ctx.get("files") or [], terms)
            if hit:
                decline(f"absence contradicted: {hit}")
                continue
        pair = {"context": name, "subject": d["slug"], "bundle": d["domain"], "state": state,
                "evidence": f"{fixed} {consequence}", "techniques": techs}
        if terms:
            pair["absenceTerms"] = terms
        if _norm(raw.get("registryProposal") or ""):
            pair["registryProposal"] = _norm(raw["registryProposal"])
        out["pairs"].append(pair)
    # A smear: one anchor, outside every context it is pinned on, carried by several pairs.
    # Measured round 2: codex pinned `lefthook.yml:32` on four UI contexts with one sentence - true
    # of the repo, a verdict about none of them.
    by_anchor: dict[str, list[dict]] = {}
    for p in out["pairs"]:
        by_anchor.setdefault(p["evidence"].split(" ", 1)[0], []).append(p)
    files_of = {p["context"]: set(p.get("files") or []) for p in d["pairs"]}
    for anchor, ps in by_anchor.items():
        path = anchor.rsplit(":", 1)[0]
        if len(ps) >= 2 and not any(path in files_of.get(p["context"], set()) for p in ps):
            for p in ps:
                out["pairs"].remove(p)
                why = f"repo-wide finding at {anchor} repeated on {len(ps)} contexts; not about this context's code"
                out["declined"].append({"subject": d["slug"], "context": p["context"], "reason": why})
                out["rejections"].append(f"{p['context']}: {why}")
    for dcl in answer.get("declined") or []:
        if isinstance(dcl, dict) and (dcl.get("context") in names or dcl.get("context") in by_id):
            nm = (names.get(dcl["context"]) or by_id[dcl["context"]])["context"]
            if nm not in seen:
                out["declined"].append({"subject": d["slug"], "context": nm, "reason": _norm(dcl.get("reason") or "declined")})
    return out


def write_run_file(claim: dict, d: dict, v: dict, seat: dict) -> str:
    rel = L.conform_run_file(claim)
    path = pathlib.Path(d["repo_root"]) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    ts = L.now()
    consults = [{"ts": ts, "bundle": d["domain"], "subjects": [d["slug"]],
                 "techniques": sorted({t["technique"] for t in p["techniques"]}),
                 "deviations": 1 if p["state"] == "deviation" else 0,
                 "context": p["context"], "via": f"curator-multi:{seat['name']}", "model": seat["model"]}
                for p in v["pairs"]]
    run = {"schema": "conform-run/1", "worker": pathlib.PurePosixPath(rel).stem, "subject": d["slug"],
           "evaluatedAt": ts, "provider": seat["name"], "model": seat["model"],
           "pairs": v["pairs"], "declined": v["declined"], "consults": consults}
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(run, indent=1), encoding="utf-8", newline="")  # LF, as git stores it
    os.replace(tmp, path)
    return rel


# --------------------------------------------------------------------------
# State, cleanup
# --------------------------------------------------------------------------


def load_state() -> dict:
    s = L._read_json(MULTI_DIR / "state.json", {}) or {}
    s.setdefault("rounds", 0)
    s.setdefault("dropped", {})
    s.setdefault("tried", {})
    s.setdefault("repo_cursor", 0)
    # Keys tried before repos existed carry no repo; they were all Personas.
    s["tried"] = {(k if ":" in k else f"personas:{k}"): v for k, v in s["tried"].items()}
    return s


def save_state(s: dict) -> None:
    L._write_json(MULTI_DIR / "state.json", s)


def repo_untracked(root) -> set[str]:
    out = subprocess.run(["git", "-C", str(root), "status", "--porcelain", "-uall"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    return {l[3:].strip().strip('"') for l in out.splitlines() if l.startswith("??")}


def grok_session_dir(session: str, cwd) -> pathlib.Path:
    from urllib.parse import quote
    return HOME / ".grok" / "sessions" / quote(str(cwd), safe="") / session


def clean_provider_sessions(seat: dict) -> list[str]:
    """Delete what a provider wrote OUTSIDE the repo for this seat, by its own session id only."""
    gone = []
    sid = seat.get("session")
    if not sid or not re.fullmatch(r"[0-9a-fA-F-]{16,64}", sid):
        return gone
    if seat["name"] == "grok":
        cwd = (seat.get("dossier") or {}).get("repo_root") or L.PERSONAS_ROOT
        cands = [grok_session_dir(sid, cwd)]
        # grok also appends each prompt to ONE history file per cwd, shared with the operator's own
        # sessions: drop only this seat's lines, matched by session id.
        hist = grok_session_dir(sid, cwd).parent / "prompt_history.jsonl"
        try:
            lines = hist.read_text(encoding="utf-8").splitlines(keepends=True)
            kept = [x for x in lines if f'"session_id":"{sid}"' not in x.replace(" ", "")]
            if len(kept) != len(lines):
                tmp = hist.with_name(hist.name + f".tmp-{os.getpid()}")
                tmp.write_text("".join(kept), encoding="utf-8", newline="")
                os.replace(tmp, hist)
                gone.append(f"{hist} ({len(lines) - len(kept)} line(s))")
        except OSError:
            pass
    elif seat["name"] == "agy":
        base = HOME / ".gemini" / "antigravity-cli"
        cands = [base / "annotations" / f"{sid}.pbtxt", base / "brain" / sid,
                 base / "conversations" / f"{sid}.db", base / "presence" / f"{sid}.lock"]
    else:
        cands = []
    for p in cands:
        try:
            if p.is_symlink():
                continue  # never follow a link out of the provider's home
            if p.is_dir():
                shutil.rmtree(p)
                gone.append(str(p))
            elif p.exists():
                p.unlink()
                gone.append(str(p))
        except OSError:
            pass
    return gone


# Provider-made junk that may appear at the repo root; only these are ever auto-deleted.
STRAY_OK = re.compile(r"^(\.grok|\.agents|\.gemini|\.codex|\.antigravity)(/|$)|^(tmp|temp)[^/]*\.(txt|json|md|py|js|mjs|sh)$", re.I)


# --------------------------------------------------------------------------
# Where a seat's subject comes from
# --------------------------------------------------------------------------

REQUEST_NOTE = ("Filed by /curator --multi on the operator's instruction of 2026-10-12: widen conform "
                "coverage of the consumer repos' maps with several providers. Subject chosen by /conform's own "
                "bare order (stale pairs, then strong unknowns, then probable unknowns), never by hand.")


def backlog_subjects(registry: pathlib.Path, repo: dict, exclude: set[str]) -> list[tuple[str, str, float]]:
    """(domain, slug, weight) for subjects with judgeable pairs in `repo`'s map, best first.

    This is /conform's bare order lifted to subject level - stale pairs first, then strong
    unknowns, then probable unknowns - so the subject is the map's choice, not the driver's.
    `exclude` holds `<repo>:<domain>/<slug>` keys.
    """
    root = pathlib.Path(repo["root"])
    rmap = _json_or(root / L.MAP_REL, {}) or {}
    declared = L.declared_domains(root)
    w: dict[tuple[str, str], float] = {}
    for row in rmap.get("contexts", []):
        if row.get("governance") in ("weak", "dead"):
            continue
        for p in row.get("subjects", []):
            bundle = p.get("bundle")
            if not bundle or (declared is not None and bundle not in declared):
                continue
            stale = bool(p.get("stale")) and p.get("state") not in (None, "unknown")
            unknown = p.get("state") in (None, "unknown")
            if not (stale or unknown):
                continue
            weight = 3 if stale else 2 if p.get("confidence") == "strong" else 1
            if p.get("priorNotApplicable"):
                weight *= 0.3
            w[(bundle, p["subject"])] = w.get((bundle, p["subject"]), 0) + weight
    out = [(b, s, v) for (b, s), v in w.items()
           if f"{repo['slug']}:{b}/{s}" not in exclude and subject_entry(registry, b, s)]
    return sorted(out, key=lambda x: (-x[2], x[1]))


def backlog_size(repo: dict) -> dict:
    """Unknown and stale pair counts on non-weak contexts: the coverage still owed."""
    rmap = _json_or(pathlib.Path(repo["root"]) / L.MAP_REL, {}) or {}
    unknown = stale = total = 0
    for row in rmap.get("contexts", []):
        if row.get("governance") in ("weak", "dead"):
            continue
        for p in row.get("subjects", []):
            total += 1
            if p.get("state") in (None, "unknown"):
                unknown += 1
            elif p.get("stale"):
                stale += 1
    return {"unknown": unknown, "stale": stale, "pairs": total}


def file_request(c, skill: str, argument: str, note: str) -> str:
    rid = str(uuid.uuid4())
    c.execute("INSERT INTO curator_request (id, skill, argument, note, state, created_at) VALUES (?,?,?,?, 'queued', ?)",
              (rid, skill, argument, note, L.now()))
    return rid


def _queued_keys(c) -> set[str]:
    keys = set()
    for r in c.execute("SELECT argument FROM curator_request WHERE skill='conform' AND state IN ('queued','dispatched')"):
        m = re.search(r"--subject\s+(\S+)(?:.*--repo\s+(\S+))?", r["argument"] or "")
        if m:
            keys.add(f"{m.group(2) or 'personas'}:*/{m.group(1)}")
    return keys


def acquire(c, registry, skills, repos: list[dict], held: set[str], used: dict, state: dict, rnd: int):
    """(claim, dossier) for one seat, or (None, None).

    Repos are visited in rotation from `state["repo_cursor"]`, so every consumer repo gains
    coverage. In Personas her plan comes first; everywhere the map's backlog is FILED into the
    operator's queue and claimed through it, so the ledger carries a real row for every seat.
    Within a round, a repo and a category no other seat holds are preferred.
    """
    tried = state.setdefault("tried", {})
    queued = _queued_keys(c)
    n = len(repos)
    order = [repos[(state.get("repo_cursor", 0) + i) % n] for i in range(n)] if n else []
    order.sort(key=lambda r: r["slug"] in used["repos"])  # stable: rotation order among equals
    for repo in order:
        if repo["slug"] in used.get("busy", ()):
            continue  # a live unit is judging, reviewing or committing there; one writer per repo
        if repo_busy(repo["root"]):
            continue  # the merger must not write into a tree somebody is merging or rebasing
        if repo["slug"] == "personas":
            for _ in range(4):
                claim = L.claim_one(c, registry, skills, {"plan"}, {"conform"},
                                    exclude_subjects={h.split(":", 1)[1] for h in held if h.startswith("personas:")})
                if not claim or claim.get("declined"):
                    break
                d = dossier(registry, claim, repo)
                if d:
                    claim["repo"] = repo["slug"]
                    _advance(state, repos, repo)
                    return claim, d
                L.settle(c, claim, "idled", "curator-multi: no judgeable pair (every pair weak, dead or judged and current)")
                held.add(f"personas:{claim['subject']}")
        excl = set(held) | set(tried)
        cands = [x for x in backlog_subjects(registry, repo, excl)
                 if f"{repo['slug']}:*/{x[1]}" not in queued]
        cands.sort(key=lambda x: (subject_category(registry, x[0], x[1]) in used["categories"],))
        for bundle, slug, _w in cands[:6]:
            address = f"{bundle}/{slug}"
            tried[f"{repo['slug']}:{address}"] = rnd
            rid = file_request(c, "conform", f"--subject {slug} --repo {repo['slug']}", REQUEST_NOTE)
            claim = L.claim_one(c, registry, skills, {"queue"}, None)
            if not claim or claim.get("declined") or claim.get("request_id") != rid:
                if claim and not claim.get("declined"):
                    L.release(c, claim, "curator-multi: took a request it did not file")
                c.execute("UPDATE curator_request SET state='cancelled', settled_at=?, outcome=? WHERE id=? AND state='queued'",
                          (L.now(), "curator-multi: not claimable after filing", rid))
                return None, None
            claim.update(subject=address, cwd=str(repo["root"]), repo=repo["slug"])
            d = dossier(registry, claim, repo)
            if d:
                _advance(state, repos, repo)
                return claim, d
            L.settle(c, claim, "declined", "curator-multi: no judgeable pair at claim time")
    return None, None


def _advance(state: dict, repos: list[dict], taken: dict) -> None:
    idx = next((i for i, r in enumerate(repos) if r["slug"] == taken["slug"]), 0)
    state["repo_cursor"] = (idx + 1) % max(len(repos), 1)


def subject_category(registry: pathlib.Path, domain: str, slug: str) -> str | None:
    e = subject_entry(registry, domain, slug)
    return "/".join(e["file"].split("/")[2:-2]) if e else None


# --------------------------------------------------------------------------
# One round
# --------------------------------------------------------------------------


def unfinished_round() -> int | None:
    base = MULTI_DIR / "rounds"
    for d in sorted(base.glob("*/seats.json")) if base.exists() else []:
        n = int(d.parent.name)
        if not (base / f"{n}.json").exists():
            return n
    return None


def _journal(rdir: pathlib.Path, seats: list[dict], before: dict, keep_raw: bool) -> None:
    """Every seat, written the moment it spawns: a round whose driver dies is finished from this."""
    keep = ("name", "model", "claim", "dossier", "dir", "pid", "create_time", "t0", "session", "prompt_sha")
    L._write_json(rdir / "seats.json", {"before": {k: sorted(v) for k, v in before.items()}, "keep_raw": keep_raw,
                                         "seats": [{k: (str(x[k]) if k == "dir" else x.get(k)) for k in keep} for x in seats]})


def run_round(a: argparse.Namespace) -> dict:
    pending = unfinished_round()
    if pending is not None:
        return {"ok": False, "error": f"round {pending} never finished (its driver died): run `multi finish` first"}
    state = load_state()
    n = state["rounds"] + 1
    rdir = MULTI_DIR / "rounds" / str(n)
    wanted = [p.strip() for p in a.providers.split(",") if p.strip()]
    active = [p for p in wanted if p in PROVIDERS and p not in state["dropped"] and bin_of(p)]
    skipped = {p: ("dropped: " + state["dropped"][p]["why"]) if p in state["dropped"] else "no binary"
               for p in wanted if p not in active}
    if not active:
        return {"ok": False, "round": n, "error": "no provider left to run", "skipped": skipped}
    # Rotate so no provider always takes the top-ranked subject; repeat for --per-provider.
    k = (n - 1) % len(active)
    active = (active[k:] + active[:k]) * max(1, getattr(a, "per_provider", 1) or 1)

    c = L.connect()
    registry = L.registry_root(c)
    b = L.brakes(c)
    held_brakes = [h for h in b["held_by"] if not (a.terminal_owns and h.startswith("curator_enabled"))]
    if held_brakes:
        return {"ok": False, "round": n, "error": "brake", "held_by": held_brakes}
    # Only the corpus axis matters here: the seats read the registry, and a checkout far behind its
    # origin judges against standards upstream has already moved. Her plan's projection is not read.
    fresh = L.corpus_freshness(registry)
    if (fresh["behind"] or 0) > L.STALE_CORPUS_BEHIND:
        return {"ok": False, "round": n, "error": "stale", "corpus": fresh}
    _INDEX_CACHE.clear()
    _TRACKED_CACHE.clear()
    skills = L.read_skills(registry)
    repos = consumer_repos(registry, [x.strip() for x in a.repos.split(",")] if getattr(a, "repos", None) else None)
    rdir.mkdir(parents=True, exist_ok=True)
    agy_model = agy_flash_model() if "agy" in active else None
    schema_file = rdir / "schema.json"
    schema_file.write_text(json.dumps(SCHEMA), encoding="utf-8")

    seats: list[dict] = []
    baselines: list[dict] = []
    before: dict[str, set] = {}
    used = {"repos": set(), "categories": set()}
    for i, name in enumerate(active):
        held = {f"personas:{s}" for s in L.open_dispatch_subjects(c)} | \
               {f"{s['claim']['repo']}:{s['claim']['subject']}" for s in seats}
        claim, d = acquire(c, registry, skills, repos, held, used, state, n)
        if not claim:
            skipped[f"{name}#{i}"] = "nothing claimable"
            continue
        used["repos"].add(d["repo"])
        used["categories"].add(d["category"])
        if d["repo_root"] not in before:
            before[d["repo_root"]] = repo_untracked(d["repo_root"])
            baseline = commit_as_found(pathlib.Path(d["repo_root"]), n)
            if baseline and not baseline.get("nothing"):
                print(json.dumps({**baseline, "event": "as_found_commit", "repo": d["repo"]}, default=str), flush=True)
                baselines.append({"slug": d["repo"], **baseline})
        seat = _launch(name, agy_model, claim, d, rdir / f"{name}-{i}", schema_file)
        seats.append(seat)
        _journal(rdir, seats, before, a.keep_raw)
        print(json.dumps({"event": "seat", "round": n, "provider": name, "model": seat["model"], "repo": d["repo"],
                          "subject": claim["subject"], "pairs": len(d["pairs"]), "pid": seat["pid"]}), flush=True)
    c.close()
    save_state(state)  # `tried` and the cursor were written by acquire(); settle_round reloads state
    if not seats:
        shutil.rmtree(rdir, ignore_errors=True)
        return {"ok": True, "round": n, "seats": [], "skipped": skipped, "empty": True}

    for x in seats:
        x["fo"].close(), x["fe"].close()
    wait_seats(seats, a.timeout_min)
    summary = settle_round(n, rdir, seats, before, a.keep_raw, a.timeout_min, recovered=False, skipped=skipped)
    summary["as_found_commits"] = baselines
    L._write_json(MULTI_DIR / "rounds" / f"{n}.json", summary)
    return summary


def _launch(name: str, agy_model: str | None, claim: dict, d: dict, sdir: pathlib.Path,
            schema_file: pathlib.Path) -> dict:
    """Start one provider seat on one dossier; the seat dict the settle path reads."""
    cfg = PROVIDERS[name]
    model = (agy_model or "gemini-3.8-flash-high") if name == "agy" else cfg["model"]
    sdir.mkdir(parents=True, exist_ok=True)
    pf = sdir / "prompt.md"
    prompt_text = brief(d, name)
    pf.write_text(prompt_text, encoding="utf-8")
    sid = str(uuid.uuid4())
    argv, stdin, env_extra = seat_command(name, model, cfg["effort"], pf, schema_file, sdir, sid, d["repo_root"])
    env = {**L.worker_env(), **env_extra}
    flags = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if sys.platform == "win32" else 0
    fo, fe = open(sdir / "stdout.txt", "w", encoding="utf-8"), open(sdir / "stderr.txt", "w", encoding="utf-8")
    proc = subprocess.Popen(argv, cwd=d["repo_root"], env=env, stdout=fo, stderr=fe,
                            stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                            creationflags=flags, text=True, encoding="utf-8")
    if stdin is not None:
        try:
            proc.stdin.write(stdin)
            proc.stdin.close()
        except OSError:
            pass
    return {"name": name, "model": model, "claim": claim, "dossier": d, "dir": sdir, "proc": proc,
            "prompt_sha": sha256_text(prompt_text), "pid": proc.pid, "create_time": L.proc_create_time(proc.pid),
            "fo": fo, "fe": fe, "t0": time.time(), "session": sid if name == "grok" else None}


def spawn_unit(a, c, registry, skills, repos: list[dict], name: str, held: set[str], used: dict,
               agy_model: str | None) -> dict | None:
    """ONE seat as its own unit (`rounds/<n>/`, journaled, settled alone). None = nothing claimable.

    The continuous night is made of these: a unit ends when its seat does, so a fast provider
    takes its next subject while a slow one is still reading. Reusing the round machinery for a
    one-seat round keeps the journal, `finish`, the scoreboard and the commit path unchanged.
    """
    state = load_state()
    n = state["rounds"] + 1
    claim, d = acquire(c, registry, skills, repos, held, used, state, n)
    if not claim:
        save_state(state)
        return None
    state["rounds"] = n
    save_state(state)
    rdir = MULTI_DIR / "rounds" / str(n)
    rdir.mkdir(parents=True, exist_ok=True)
    schema_file = rdir / "schema.json"
    schema_file.write_text(json.dumps(SCHEMA), encoding="utf-8")
    before = {d["repo_root"]: repo_untracked(d["repo_root"])}
    baselines = []
    baseline = commit_as_found(pathlib.Path(d["repo_root"]), n)
    if baseline and not baseline.get("nothing"):
        baselines.append({"slug": d["repo"], **baseline})
    seat = _launch(name, agy_model, claim, d, rdir / f"{name}-0", schema_file)
    _journal(rdir, [seat], before, False)
    seat["fo"].close(), seat["fe"].close()  # the child holds its own handles
    return {"n": n, "rdir": rdir, "seat": seat, "before": before, "baselines": baselines}


def _alive(s: dict) -> bool:
    if s.get("proc") is not None:
        return s["proc"].poll() is None
    return L.proc_alive(s.get("pid"), s.get("create_time"))


def wait_seats(seats: list[dict], timeout_min: int) -> None:
    deadline = (min(x["t0"] for x in seats) if seats else time.time()) + timeout_min * 60
    while time.time() < deadline:
        for x in seats:
            if "t1" not in x and not _alive(x):
                x["t1"] = time.time()
        if all("t1" in x for x in seats):
            break
        time.sleep(5)
    for x in seats:
        x["timed_out"] = _alive(x)
        if x["timed_out"]:
            L.kill_tree(int(x["pid"]))
            if x.get("proc") is not None:
                try:
                    x["proc"].wait(timeout=60)
                except subprocess.TimeoutExpired:
                    pass
        x["wall_s"] = round(x.get("t1", time.time()) - x["t0"])


def finish_round() -> dict:
    """Settle a round whose driver died, from its journal and the files its seats left.

    A seat still running is waited for. A seat that left no answer is RELEASED, never settled:
    nothing says whether the seat or the driver's death ended it, so it is not the seat's verdict.
    Its wall time is unknown (the driver was not there to see it end) and is recorded as None.
    """
    n = unfinished_round()
    if n is None:
        return {"ok": True, "note": "no unfinished round"}
    rdir = MULTI_DIR / "rounds" / str(n)
    j = L._read_json(rdir / "seats.json", {}) or {}
    seats = []
    for x in j.get("seats", []):
        x["dir"] = pathlib.Path(x["dir"])
        x["proc"] = None
        x["claim"].setdefault("repo", (x.get("dossier") or {}).get("repo", "personas"))
        if x.get("dossier") is not None:
            x["dossier"].setdefault("repo", "personas")
            x["dossier"].setdefault("repo_root", str(L.PERSONAS_ROOT))
        seats.append(x)
    before = j.get("before", {})
    if isinstance(before, list):  # a journal from before repos existed: Personas only
        before = {str(L.PERSONAS_ROOT): before}
    dead_already = {str(x["dir"]) for x in seats if not _alive(x)}
    wait_seats(seats, 35)
    for x in seats:
        if str(x["dir"]) in dead_already:
            x["wall_s"] = None  # ended before this driver looked; its real duration is unknown
    return settle_round(n, rdir, seats, {k: set(v) for k, v in before.items()}, bool(j.get("keep_raw")), 35,
                        recovered=True)


def _merge_and_judge(registry, repo_root, name: str, s: dict, exit_code, timeout_min: int) -> tuple[str, str]:
    merge = L.merge_runs(registry, only=[name], project=pathlib.Path(repo_root))
    action, evidence = L.judge_conform(merge, name, limited=False, timed_out=s.get("timed_out", False),
                                       exit_code=exit_code, out_tail="", tmp_left=False, timeout_min=timeout_min)
    if action == "retry-merge":
        merge = L.merge_runs(registry, only=[name], wait_ms=L.MERGE_WAIT_MS, project=pathlib.Path(repo_root))
        action, evidence = L.judge_conform(merge, name, limited=False, timed_out=False, exit_code=0, out_tail="",
                                           tmp_left=False, timeout_min=timeout_min)
        if action == "retry-merge":
            action, evidence = "blocked", "the merge lock stayed held; run file left for `loop.py merge`"
    return action, evidence


def settle_round(n: int, rdir: pathlib.Path, seats: list[dict], before: dict, keep_raw: bool,
                 timeout_min: int, recovered: bool, skipped: dict | None = None) -> dict:
    state = load_state()
    files_by_repo: dict[str, Files] = {}
    c = L.connect()
    registry = L.registry_root(c)
    skipped = skipped or {}
    results = []
    for s in seats:
        out = (s["dir"] / "stdout.txt").read_text(encoding="utf-8", errors="replace") if (s["dir"] / "stdout.txt").exists() else ""
        err = (s["dir"] / "stderr.txt").read_text(encoding="utf-8", errors="replace") if (s["dir"] / "stderr.txt").exists() else ""
        r = read_seat(s["name"], s["dir"], out)
        s["session"] = s["session"] or r["session"]
        claim, d = s["claim"], s["dossier"]
        repo_root = d["repo_root"]
        exit_code = s["proc"].returncode if s.get("proc") is not None else None
        limited = seat_limited(out, err, exit_code, r["answer"])
        row = {"round": n, "ts": L.now(), "provider": s["name"], "model": s["model"], "repo": d["repo"],
               "subject": claim["subject"], "domain": d["domain"], "category": d["category"],
               "pairs_offered": len(d["pairs"]), "techniques": len(d["techniques"]), "wall_s": s["wall_s"],
               "exit": exit_code, "timed_out": s["timed_out"], "usage": r["usage"], "seat_error": r["error"],
               "read_nothing": r.get("read_nothing"), "seat_dir": str(s["dir"]), "prompt_sha": s.get("prompt_sha")}
        transient = (not limited and r["answer"] is None and
                     seat_transient(out, err, r.get("error") or ""))
        lost = (recovered and not s["timed_out"] and r["answer"] is None and not limited) or transient
        tried_key = f"{d['repo']}:{claim['subject']}"
        if lost:
            # Nothing here is the seat's verdict - the driver died with it, or the provider was briefly
            # unavailable (measured 2026-10-13: codex "Selected model is at capacity" after 86 s). Give
            # the subject back so a later seat judges it; the flow backs this slot off for a while.
            why = f"provider unavailable: {transient}" if transient else "seat lost when the round's driver died"
            L.release(c, claim, f"curator-multi: {s['name']} {why}")
            if claim["lane"] == "queue":
                c.execute("UPDATE curator_request SET state='cancelled', settled_at=?, outcome=? "
                          "WHERE id=? AND state IN ('queued','dispatched')",
                          (L.now(), f"{why}; subject returned", claim["request_id"]))
            state["tried"].pop(tried_key, None)
            if transient:
                row.update(outcome="transient", accepted=0, returned=0, transient=transient)
                row["cleaned_sessions"] = clean_provider_sessions(s)
                results.append(row)
                with open(MULTI_DIR / "scoreboard.jsonl", "a", encoding="utf-8") as f:
                    f.write(json.dumps({k: v for k, v in row.items() if k not in ("landed", "seat_dir")}, default=str) + "\n")
                continue
            row.update(outcome="lost", accepted=0, returned=0)
        elif limited:
            L.release(c, claim, f"curator-multi: {s['name']} hit its usage limit; progress thrown away")
            if claim["lane"] == "queue":  # her queue must not keep a request nobody will run
                c.execute("UPDATE curator_request SET state='cancelled', settled_at=?, outcome=? "
                          "WHERE id=? AND state IN ('queued','dispatched')",
                          (L.now(), f"{s['name']} hit its usage limit; dropped from --multi", claim["request_id"]))
            state["tried"].pop(tried_key, None)
            state["dropped"][s["name"]] = {"round": n, "at": L.now(), "why": "usage limit: " + " ".join((err or out)[-240:].split())}
            row.update(outcome="dropped-limit", accepted=0, returned=0)
        else:
            files = files_by_repo.setdefault(repo_root, Files(pathlib.Path(repo_root)))
            v = validate(r["answer"], d, files, r.get("read_nothing"), provider=s["name"])
            row.update(returned=v["returned"], accepted=len(v["pairs"]), declined=len(v["declined"]),
                       repairs=v["repairs"], rejections=v["rejections"][:12],
                       states={st: sum(1 for p in v["pairs"] if p["state"] == st) for st in VERDICTS[:3]})
            if v["pairs"] or v["declined"]:
                rel = write_run_file(claim, d, v, s)
                name = pathlib.PurePosixPath(rel).name
                row["run"] = name
                action, evidence = _merge_and_judge(registry, repo_root, name, s, exit_code, timeout_min)
            else:
                why = r["error"] or ("timed out" if s["timed_out"] else "no usable answer")
                action, evidence = "blocked", f"no verdict survived: {why}; {'; '.join(v['rejections'][:3])}"
            evidence = f"[{s['name']}:{s['model']}] [{d['repo']}] {evidence}"
            action = action if action in L.TERMINAL_ITEM else "blocked"
            L.settle(c, claim, L.REQUEST_STATE[action] if claim["lane"] == "queue" else action, evidence)
            row.update(outcome=action, evidence=evidence[:500],
                       landed=[{"context": p["context"], "state": p["state"], "evidence": p["evidence"],
                                "techniques": [t["evidence"] for t in p["techniques"]][:4],
                                "absence_terms": p.get("absenceTerms") or [],
                                "files": next((q["files"] for q in d["pairs"] if q["context"] == p["context"]), [])[:12]}
                               for p in v["pairs"]] if action == "landed" else [])
        row["cleaned_sessions"] = clean_provider_sessions(s)
        results.append(row)
        with open(MULTI_DIR / "scoreboard.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({k: v for k, v in row.items() if k not in ("landed", "seat_dir")}, default=str) + "\n")
    c.close()

    # Cleanup: provider junk that appeared in any repo a seat ran in during the round.
    removed, left = [], []
    for root, was in before.items():
        for p in sorted(repo_untracked(root) - set(was)):
            if p.startswith(L.CONFORM_RUNS_REL.as_posix()):
                continue  # the merger's own files
            if STRAY_OK.search(p):
                try:
                    (pathlib.Path(root) / p).unlink()
                    removed.append(f"{root}: {p}")
                except OSError:
                    left.append(f"{root}: {p}")
            else:
                left.append(f"{root}: {p}")
            top = pathlib.Path(root) / pathlib.PurePosixPath(p).parts[0]
            if STRAY_OK.search(p) and top.is_dir() and not any(top.rglob("*")):
                shutil.rmtree(top, ignore_errors=True)
    state["rounds"] = max(state.get("rounds", 0), n)
    save_state(state)
    summary = {"ok": True, "round": n, "seats": results, "skipped": skipped,
               "dropped": state["dropped"], "repo_strays_removed": removed,
               "repo_new_untracked_not_ours_to_judge": left[:30],
               "recovered": recovered, "raw_kept": str(rdir) if keep_raw else None}
    L._write_json(MULTI_DIR / "rounds" / f"{n}.json", summary)
    if not keep_raw:  # after the summary: a crash in between leaves a journal, never a silent loss
        shutil.rmtree(rdir, ignore_errors=True)
    return summary


# --------------------------------------------------------------------------
# Withdrawing a verdict the review found should never have landed
# --------------------------------------------------------------------------

DETAIL_REL = pathlib.Path(".ai") / "conform-detail.json"


def _dump(path: pathlib.Path, obj) -> None:
    """The merger's own byte format (JSON.stringify(x, null, 2) + newline), written atomically."""
    tmp = path.with_name(path.name + f".withdraw-{os.getpid()}")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="")
    os.replace(tmp, path)


def _take_merge_lock(root: pathlib.Path, wait_s: int = 120) -> pathlib.Path:
    lock = root / L.CONFORM_RUNS_REL / ".merge.lock"
    end = time.time() + wait_s
    while True:
        try:
            fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps({"pid": os.getpid(), "at": L.now(), "by": "curator-multi withdraw"}))
            return lock
        except FileExistsError:
            if time.time() > end:
                raise RuntimeError(f"the merge lock in {root} stayed held; nothing withdrawn")
            time.sleep(1)


def find_run_repo(run_name: str) -> pathlib.Path | None:
    c = L.connect(readonly=True)
    registry = L.registry_root(c)
    c.close()
    for repo in consumer_repos(registry):
        if (pathlib.Path(repo["root"]) / L.CONFORM_RUNS_REL / "merged" / run_name).exists():
            return pathlib.Path(repo["root"])
    return None


def withdraw(run_name: str, contexts: list[str], reason: str, root: pathlib.Path | None = None) -> dict:
    """Undo verdicts one run file put in a repo's map, under that repo's merger lock.

    The merger has no withdraw and `--reapply` re-folds its archive, so this changes all three
    places at once: the map row goes back to the verdict it replaced (from conform-detail's
    `superseded`, else `unknown`), the detail records the withdrawal, and the archived run
    file moves the pair to `declined` so a later --reapply cannot bring it back. A row a later
    run has already overwritten is left alone and reported.
    """
    root = pathlib.Path(root) if root else find_run_repo(run_name)
    if root is None:
        return {"ok": False, "error": f"no consumer repo holds .ai/conform-runs/merged/{run_name}"}
    worker = pathlib.PurePosixPath(run_name).stem
    arch = root / L.CONFORM_RUNS_REL / "merged" / run_name
    if not arch.exists():
        return {"ok": False, "error": f"no archived run file {arch}"}
    lock = _take_merge_lock(root)
    try:
        run = _json(arch)
        rmap = _json(root / L.MAP_REL)
        detail = _json_or(root / DETAIL_REL, {"schema": "conform-detail/1", "pairs": {}})
        rows = {r["name"]: r for r in rmap["contexts"]}
        done, left = [], []
        keep = []
        for pair in run.get("pairs", []):
            if pair["context"] not in contexts:
                keep.append(pair)
                continue
            row = rows.get(pair["context"])
            key = f"{row['context']}/{pair['subject']}" if row else None
            ent = detail["pairs"].get(key) if key else None
            if not row or not ent or ent.get("worker") != worker:
                left.append(f"{pair['context']}: a later verdict owns the row; left alone")
                keep.append(pair)
                continue
            sub = next(x for x in row["subjects"] if x["subject"] == pair["subject"])
            prior = next((x for x in reversed(ent.get("superseded") or []) if x.get("reason") == f"replaced by {worker}"), None)
            for k in ("state", "evidence", "evaluatedAt", "evaluatedAgainst", "evaluatedRevision", "revisionsBehind"):
                sub.pop(k, None)
            if prior and prior.get("state") not in (None, "unknown"):
                sub.update(state=prior["state"], evidence=prior["evidence"], evaluatedAt=str(prior["evaluatedAt"])[:10])
            else:
                sub["state"] = "unknown"
            ent["withdrawn"] = {"worker": worker, "state": ent.get("state"), "at": L.now(), "reason": reason}
            ent["state"] = sub["state"]
            ent.pop("worker", None)
            run.setdefault("declined", []).append({"subject": pair["subject"], "context": pair["context"],
                                                   "reason": f"withdrawn after review: {reason}"})
            done.append(f"{pair['context']}/{pair['subject']} -> {sub['state']}")
        run["pairs"] = keep
        if done:
            with open(MULTI_DIR / "scoreboard.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"kind": "review", "ts": L.now(), "run": run_name, "provider": run.get("provider"),
                                    "withdrawn": len(done), "reason": reason}) + "\n")
            _dump(root / L.MAP_REL, rmap)
            _dump(root / DETAIL_REL, detail)
            _dump(arch, run)
        return {"ok": True, "repo": str(root), "withdrawn": done, "left": left}
    finally:
        lock.unlink(missing_ok=True)


# --------------------------------------------------------------------------
# Commits - what a round changed in a repo, on the branch that repo has checked out
# --------------------------------------------------------------------------

COMMIT_PATHS = (".ai/registry-map.json", ".ai/conform-detail.json", ".ai/consults.jsonl")
_HARNESS_VERSION: str | None = None


def provenance(model: str, prompt_sha: str) -> str:
    """The trailer block every consumer repo's gates accept (measured 2026-10-12).

    systedo-case refuses an agent commit with no `Agent-Harness`; kp refuses any `Agent-*` key
    outside its four-key block and checks each VALUE: harness `<name>@<version>`, prompt a
    `sha256:` digest of the prompt text, run a URL or `local`. Trailer keys are case-insensitive,
    so kp's block satisfies both. Every value is true: the harness version is the commit that
    last changed this file, the digest is of the brief the seat was actually given.
    """
    global _HARNESS_VERSION
    if _HARNESS_VERSION is None:
        _HARNESS_VERSION = _git(L.PERSONAS_ROOT, "log", "-1", "--format=%h", "--",
                                ".claude/skills/curator/multi.py").stdout.strip() or "unknown"
    return (f"Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nAgent-model: {model}\n"
            f"Agent-harness: curator-multi@{_HARNESS_VERSION}\nAgent-prompt: sha256:{prompt_sha}\nAgent-run: local")


def sha256_text(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _git(root, *args, env=None, timeout=120):
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, encoding="utf-8",
                          errors="replace", env=env, timeout=timeout)


def repo_busy(root) -> str | None:
    """A merge, rebase or cherry-pick genuinely in progress, else None.

    Not REBASE_HEAD alone: git can leave it behind after a finished rebase. Measured 2026-10-12,
    athena-everywhere carried one from 2026-09-17 with no rebase running, and the night skipped
    its commit for a rebase that did not exist.
    """
    gitdir = pathlib.Path(_git(root, "rev-parse", "--absolute-git-dir").stdout.strip())
    for x in ("rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD"):
        if (gitdir / x).exists():
            return f"{x} in progress"
    return None


def commit_repo(root: pathlib.Path, run_names: list[str], message: str, trailers: str | None = None) -> dict:
    """Commit the map, detail, consults and this round's archived run files - nothing else.

    The operator's standing approval (2026-10-12) is to commit conform results in every consumer
    repo on its CURRENTLY checked-out branch; never push. Siblings work in these checkouts, so the
    commit uses the isolated-index ritual (a temp index seeded from HEAD, explicit paths, no
    deletions, then the shared index resynced for these paths only), refuses a detached HEAD or a
    merge/rebase in progress, and leaves the files uncommitted - reported - when a hook fails.
    """
    root = pathlib.Path(root)
    branch = _git(root, "branch", "--show-current").stdout.strip()
    if not branch:
        return {"ok": False, "repo": str(root), "skipped": "detached HEAD: no active branch to commit on"}
    busy = repo_busy(root)
    if busy:
        return {"ok": False, "repo": str(root), "branch": branch, "skipped": busy}
    paths = [p for p in [*COMMIT_PATHS, *[f".ai/conform-runs/merged/{n}" for n in run_names]] if (root / p).exists()]
    ignored = set(_git(root, "check-ignore", "--", *paths).stdout.split()) if paths else set()
    paths = [p for p in paths if p not in ignored]
    if not paths or not _git(root, "status", "--porcelain", "--", *paths).stdout.strip():
        return {"ok": True, "repo": str(root), "branch": branch, "nothing": True}
    fd, idx = tempfile.mkstemp(prefix="curator-multi-idx-")
    os.close(fd)
    env = {**os.environ, "GIT_INDEX_FILE": idx}
    try:
        _git(root, "read-tree", "HEAD", env=env)
        add = _git(root, "add", "--", *paths, env=env)
        if add.returncode:
            return {"ok": False, "repo": str(root), "branch": branch, "error": f"git add: {add.stderr[-300:]}"}
        staged = _git(root, "diff", "--cached", "--name-status", env=env).stdout.splitlines()
        if any(l.startswith("D") for l in staged):
            return {"ok": False, "repo": str(root), "branch": branch, "error": "the commit would delete a file; refused"}
        if not staged:
            return {"ok": True, "repo": str(root), "branch": branch, "nothing": True}
        msg = f"{message}\n\n{trailers or provenance('none', sha256_text(message))}\n"
        r = subprocess.run(["git", "-C", str(root), "commit", "-q", "-F", "-"], input=msg, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", env=env, timeout=900)
        # Verify the commit is OURS: a sibling's commit landing in between is the documented failure.
        sha, subject = (_git(root, "log", "-1", "--format=%h%x00%s").stdout.strip().split("\x00") + [""])[:2]
        if r.returncode == 0 and subject != message.splitlines()[0]:
            found = _find_replaced_message(root, paths, message)
            if found:
                return found | {"repo": str(root), "branch": branch, "files": len(staged)}
        if r.returncode or subject != message.splitlines()[0]:
            return {"ok": False, "repo": str(root), "branch": branch,
                    "error": f"commit failed or HEAD is not ours (exit {r.returncode}): {(r.stderr or r.stdout)[-400:]}"}
        return {"ok": True, "repo": str(root), "branch": branch, "commit": sha, "files": len(staged)}
    finally:
        _git(root, "reset", "-q", "HEAD", "--", *paths)  # the shared index sees the new HEAD for OUR paths only
        try:
            os.unlink(idx)
        except OSError:
            pass


def _find_replaced_message(root: pathlib.Path, paths: list[str], message: str) -> dict | None:
    """Our commit landed under another session's message: `.git/COMMIT_EDITMSG` is ONE file per
    checkout, and a sibling committing in the same instant can swap it (measured 2026-10-13 in
    systedo-case: our three conform files committed as `refactor(app): ...`). Find the commit
    among the last few that changed exactly our paths; record our message on it as a git note
    (ref `curator`) instead of rewriting a shared branch."""
    log = _git(root, "log", "-8", "--format=%H", "--", paths[0]).stdout.split()
    want = set(paths)
    for full in log:
        changed = set(_git(root, "show", "--name-only", "--format=", full).stdout.split())
        if changed and changed <= want:
            note = f"curator --multi: this commit's real message is:\n\n{message}"
            _git(root, "notes", "--ref=curator", "add", "-f", "-m", note, full)
            subject = _git(root, "log", "-1", "--format=%s", full).stdout.strip()
            return {"ok": True, "commit": full[:10], "message_replaced": subject,
                    "note": "the true message is in `git notes --ref=curator show`"}
    return None


def commit_as_found(root: pathlib.Path, n: int) -> dict | None:
    """Commit the conform files' PRE-EXISTING uncommitted state before a round writes over it.

    Measured 2026-10-12 in goat: the map carried an uncommitted registry rebuild from ten days
    earlier, and the round's commit swept it in under the round's name. Committing it first, as
    found and said so, keeps every round commit about that round alone.
    """
    if not _git(root, "status", "--porcelain", "--", *COMMIT_PATHS).stdout.strip():
        return None
    return commit_repo(root, [], "chore(registry-map): commit conform state found uncommitted\n\n"
                                 f"These changes were already in the working tree, uncommitted, when curator --multi round {n} "
                                 "began; they are committed unchanged so the round's own commit carries only its verdicts.")


def commit_round(summary: dict, reviewed: str) -> list[dict]:
    """One commit per repo the round landed or withdrew in."""
    by_repo: dict[str, list[str]] = {}
    subjects: dict[str, list[str]] = {}
    roots = {}
    c = L.connect(readonly=True)
    registry = L.registry_root(c)
    c.close()
    for r in consumer_repos(registry):
        roots[r["slug"]] = r["root"]
    models: dict[str, list[str]] = {}
    prompts: dict[str, list[str]] = {}
    for s in summary.get("seats", []):
        if s.get("run") and s.get("repo") in roots:
            by_repo.setdefault(s["repo"], []).append(s["run"])
            subjects.setdefault(s["repo"], []).append(f"{s['subject'].split('/')[-1]} ({s['provider']})")
            models.setdefault(s["repo"], []).append(s.get("model") or "unknown")
            prompts.setdefault(s["repo"], []).append(s.get("prompt_sha") or "")
    out = []
    for slug, runs in by_repo.items():
        n_landed = sum(s.get("accepted", 0) for s in summary["seats"] if s.get("repo") == slug)
        # The subject names the ARTEFACT, in a conventional type, under 72 characters. Measured
        # 2026-10-12: kp's commit-msg gate refused a bare `conform:` type, and systedo-case's refused
        # a subject that narrated the run ("... from curator --multi round 9 ...") at 73 characters.
        names = sorted({x.split(" (")[0] for x in subjects[slug]})
        subject = f"chore(registry-map): add {n_landed} {names[0]} conform verdicts" if len(names) == 1 else ""
        if not subject or len(subject) > 72:
            subject = f"chore(registry-map): add {n_landed} conform verdicts on {len(names)} subject(s)"
        msg = (f"{subject}\n\ncurator --multi round {summary['round']}: {', '.join(subjects[slug])}. Judged by non-Claude "
               f"seats, verified anchor by anchor by the curator validator; review: {reviewed}. Committed on the "
               f"operator's standing approval for conform results.")
        ps = [p for p in prompts[slug] if p]
        prompt_sha = ps[0] if len(ps) == 1 else sha256_text("".join(sorted(ps))) if ps else sha256_text(msg)
        trailers = provenance("+".join(dict.fromkeys(models[slug])), prompt_sha)
        out.append({"slug": slug, **commit_repo(roots[slug], runs, msg, trailers)})
    return out


# --------------------------------------------------------------------------
# The reviewer - a headless Claude session spot-checks what landed
# --------------------------------------------------------------------------

REVIEW_TIMEOUT_MIN = 25


def review_brief(summary: dict) -> str | None:
    items = []
    for s in summary.get("seats", []):
        for p in s.get("landed") or []:
            items.append({"repo": s["repo"], "run": s["run"], "provider": s["provider"], "subject": s["subject"], **p})
    if not items:
        return None
    roots = {}
    c = L.connect(readonly=True)
    registry = L.registry_root(c)
    c.close()
    for r in consumer_repos(registry):
        roots[r["slug"]] = pathlib.Path(r["root"]).as_posix()
    lines = []
    for i, it in enumerate(items, 1):
        lines.append(f"{i}. repo `{it['repo']}` at {roots.get(it['repo'])} | run `{it['run']}` | seat {it['provider']} | "
                     f"subject `{it['subject']}` | context `{it['context']}` | {it['state']}\n"
                     f"   evidence: {it['evidence']}\n"
                     + "".join(f"   technique: {t}\n" for t in it["techniques"])
                     + (f"   absence searched for (driver re-ran it over the context's directories: no hit): "
                        f"{', '.join(it.get('absence_terms') or [])} - were these the RIGHT terms for this subject?\n"
                        if it.get("absence_terms") else "")
                     + f"   context files: {', '.join(it['files'])}")
    return f"""You are the reviewer of an unattended conform round. Non-Claude model seats judged code against
knowledge-registry standards; a validator already proved each anchor's file exists and that the seat
quoted the cited line correctly. What a validator cannot prove is whether the line SAYS what the
evidence claims, and whether the verdict is about THIS context's code. That is your job.

Rules: READ ONLY - do not edit, create or delete any file, do not run git commands that change state.
For every verdict below, open the anchor (path:line is relative to the repo root shown; print a few
lines around it), every technique anchor that carries the claim, and every OTHER file the evidence
text names: a claim often rests on a file beside the anchor, and that is exactly where earlier
reviews stopped checking (measured 2026-10-12: three rounds of notes said "I did not trace the
claims beyond the cited line"). Then decide:
- KEEP when the code you opened supports the claim and the verdict is about this context (its files
  or the code they call). A verdict you confirmed but would have phrased differently is a KEEP.
- WITHDRAW when the line does not say what is claimed; when a claim the verdict depends on could
  not be confirmed in the code you opened; when the claim is about a different context or the repo
  as a whole; when a conformant/not-applicable is contradicted by the code; and when a
  not-applicable's anchor is INCIDENTAL - a line that sits in the context but does not itself show
  the precondition is absent. Unconfirmed is not the same as "in doubt": if you could not confirm
  it, withdraw it and say what you could not find; the pair goes back to unknown, which costs nothing.

Verdicts to review:
{chr(10).join(lines)}

Reply with exactly one JSON object and nothing else:
{{"checked": <number of verdicts you opened>,
 "withdraw": [{{"run": "<run file name>", "contexts": ["<context>", ...], "why": "<one sentence>"}}],
 "notes": "<patterns worth fixing in the seats' brief or the validator, or empty>"}}
"""


def review_round(summary: dict, model: str) -> dict:
    prompt = review_brief(summary)
    if not prompt:
        return {"ok": True, "skipped": "nothing landed"}
    try:
        claude = L.claude_bin()
    except SystemExit:
        return {"ok": False, "error": "no claude CLI"}
    env = L.worker_env()
    argv = [claude, "--print", "--dangerously-skip-permissions", "--model", model,
            "--disallowedTools", "Edit,Write,NotebookEdit,MultiEdit"]
    try:
        r = subprocess.run(argv, input=prompt, cwd=str(MULTI_DIR), env=env, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=REVIEW_TIMEOUT_MIN * 60)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"the reviewer ran past {REVIEW_TIMEOUT_MIN} min"}
    if L.usage_limited(r.stdout or "", r.stderr or "", r.returncode):
        return {"ok": False, "limited": True, "error": "the reviewer hit the Claude usage limit"}
    verdict = _last_json_object(r.stdout or "", key="withdraw")
    if not verdict:
        return {"ok": False, "error": f"no review JSON (exit {r.returncode}): {(r.stdout or r.stderr or '')[-300:]}"}
    # Only withdrawals that name a run and contexts this round actually landed are applied.
    landed = {s["run"]: {p["context"] for p in s.get("landed") or []} for s in summary["seats"] if s.get("run")}
    applied, refused = [], []
    for w in verdict.get("withdraw") or []:
        run, ctxs = w.get("run"), [x for x in (w.get("contexts") or []) if x in landed.get(w.get("run"), set())]
        if not ctxs:
            refused.append(w)
            continue
        res = withdraw(run, ctxs, f"reviewer ({model}): {_norm(w.get('why') or '')[:300]}")
        applied.append({"run": run, "contexts": ctxs, "why": w.get("why"), "result": res.get("withdrawn") or res.get("error")})
    return {"ok": True, "model": model, "checked": verdict.get("checked"), "withdrawn": applied,
            "refused": refused, "notes": _norm(verdict.get("notes") or "")[:600]}


# --------------------------------------------------------------------------
# The night - rounds back to back until the window closes
# --------------------------------------------------------------------------

NIGHT_DIR = MULTI_DIR / "night"
NIGHT_STOP = MULTI_DIR / "STOP"
MIN_FREE_GB = 6.0
PER_SEAT_GB = 1.5
EMPTY_ROUNDS_STOP = 3


def _deadline(until: str | None, start: datetime) -> datetime | None:
    if not until:
        return None
    hh, mm = (int(x) for x in until.split(":"))
    d = start.replace(hour=hh, minute=mm, second=0, microsecond=0)
    return d if d > start else d + timedelta(days=1)


def _night_lock() -> pathlib.Path | None:
    lock = MULTI_DIR / "night.lock"
    for _ in range(2):
        try:
            fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps({"pid": os.getpid(), "create_time": L.proc_create_time(os.getpid()), "at": L.now()}))
            return lock
        except FileExistsError:
            h = L._read_json(lock, {}) or {}
            if h.get("pid") and L.proc_alive(h.get("pid"), h.get("create_time")):
                return None
            lock.unlink(missing_ok=True)
    return None


EMPTY_SEATS_STOP = 9          # consecutive finished seats that kept nothing (3 rounds' worth)
NOTHING_CLAIMABLE_RETRY_S = 600
TRANSIENT_BACKOFF_S = 300
BARREN_UNITS = 2
FLOW_POLL_S = 5


def _reviewed_phrase(review: dict, model: str) -> str:
    if review.get("ok") and not review.get("skipped"):
        return f"{model} checked {review.get('checked')}, withdrew {sum(len(w['contexts']) for w in review.get('withdrawn') or [])}"
    return f"none ({review.get('skipped') or review.get('error')})"


def run_flow(a, log, events: list, deadline, registry, repos: list[dict]) -> str:
    """Continuous seats: every provider slot takes its next subject the moment its seat settles.

    Measured 2026-10-13: rounds waited for their slowest seat (grok ~12 min against agy's ~7),
    leaving 27% of seat time idle. Here each slot runs at its own provider's speed. A finished
    seat is settled on this thread (validate, merge, ledger) and its review + commit go to a
    worker, so a 10-minute review never holds a slot empty. One live unit per repo: a repo held
    by a running, reviewing or committing unit is never assigned another, so a commit carries
    exactly its own unit's verdicts.
    """
    from concurrent.futures import ThreadPoolExecutor
    names = [p.strip() for p in a.providers.split(",") if p.strip() in PROVIDERS and bin_of(p.strip())]
    slots = [f"{p}#{i}" for i in range(max(1, a.per_provider)) for p in names]
    running: dict[str, dict] = {}
    posting: list[tuple[dict, object]] = []
    idle_until: dict[str, float] = {}
    dry_until: dict[str, float] = {}   # nothing claimable - the only idleness that can end a night
    # A repo whose last BARREN_UNITS units kept nothing is skipped for the rest of the night.
    # Measured 2026-10-13: goat's map has outlived its tree; 8 seats in 5 h found 1-2 real pairs
    # each and mostly declined. Its backlog still counts; it waits for a map rebuild.
    repo_dry: dict[str, int] = {}
    started = empty_streak = 0
    stop = None
    last_hold = None
    agy_model = agy_flash_model() if "agy" in names else None
    pool = ThreadPoolExecutor(max_workers=3)

    def post(summary: dict) -> tuple[dict, list]:
        review = review_round(summary, a.reviewer_model) if a.review != "off" else {"skipped": "--review off"}
        return review, commit_round(summary, _reviewed_phrase(review, a.reviewer_model))

    def hold(why: str):
        nonlocal last_hold
        if why != last_hold:
            log("held", why=why)
            last_hold = why

    errors = 0
    try:
        while True:
          try:
            # 1. settle every seat that ended (or ran past its ceiling)
            for slot, u in list(running.items()):
                s = u["seat"]
                over = time.time() - s["t0"] > a.timeout_min * 60
                if _alive(s) and not over:
                    continue
                s["timed_out"] = _alive(s)
                if s["timed_out"]:
                    L.kill_tree(int(s["pid"]))
                    try:
                        s["proc"].wait(timeout=60)
                    except subprocess.TimeoutExpired:
                        pass
                s["wall_s"] = round(time.time() - s["t0"])
                summary = settle_round(u["n"], u["rdir"], [s], u["before"], False, a.timeout_min, recovered=False)
                summary["as_found_commits"] = u["baselines"]
                del running[slot]
                if any(x.get("outcome") == "transient" for x in summary.get("seats", [])):
                    # The provider was briefly unavailable: back this slot off instead of handing it
                    # another subject into the same outage.
                    idle_until[slot] = time.time() + TRANSIENT_BACKOFF_S
                    log("slot_backoff", slot=slot, minutes=TRANSIENT_BACKOFF_S // 60,
                        why=summary["seats"][0].get("transient"))
                posting.append((summary, pool.submit(post, summary)))
            # 2. collect finished reviews and commits
            for item in [x for x in posting if x[1].done()]:
                posting.remove(item)
                summary, fut = item
                try:
                    review, commits = fut.result()
                except Exception as e:  # a failed post never kills the night; it is reported
                    review, commits = {"ok": False, "error": f"post crashed: {e}"}, []
                landed = sum(x.get("accepted") or 0 for x in summary["seats"]) - \
                    sum(len(w["contexts"]) for w in review.get("withdrawn") or [])
                empty_streak = 0 if landed > 0 else empty_streak + 1
                for x in summary["seats"]:
                    if x.get("outcome") == "transient":
                        continue  # an outage says nothing about the repo
                    repo_dry[x.get("repo")] = 0 if landed > 0 else repo_dry.get(x.get("repo"), 0) + 1
                    if repo_dry[x.get("repo")] == BARREN_UNITS:
                        log("repo_barren", repo=x.get("repo"), units=BARREN_UNITS)
                events.append({"round": summary["round"], "summary": summary, "review": review, "commits": commits})
                log("round", round=summary["round"], landed=landed,
                    seats=[{k: x.get(k) for k in ("provider", "repo", "subject", "accepted", "outcome", "wall_s")} for x in summary["seats"]],
                    review=review, commits=commits, dropped=list(summary.get("dropped") or {}))
            # 3. should the night stop taking new work?
            dropped = load_state()["dropped"]
            if stop is None:
                if NIGHT_STOP.exists():
                    stop = "STOP file"
                elif a.max_rounds and started >= a.max_rounds:
                    stop = f"--max-rounds {a.max_rounds} seats started"
                elif deadline and datetime.now() + timedelta(minutes=20) > deadline:
                    stop = f"the window closes at {deadline:%H:%M}"
                elif all(s.split("#")[0] in dropped for s in slots):
                    stop = "every provider hit its usage limit"
                elif empty_streak >= EMPTY_SEATS_STOP:
                    stop = f"{EMPTY_SEATS_STOP} seats in a row kept nothing"
                elif not running and not posting and slots and all(dry_until.get(s, 0) > time.time() for s in slots):
                    stop = "nothing claimable in any repo (backlog empty, or every subject tried)"
                if stop:
                    log("draining", reason=stop, running=len(running), posting=len(posting))
            if stop and not running and not posting:
                return stop
            # 4. fill idle slots
            if stop is None:
                for slot in slots:
                    if slot in running or slot.split("#")[0] in dropped or idle_until.get(slot, 0) > time.time():
                        continue
                    free = L.sample_free_gb(samples=3, gap_s=0.3)
                    if free is not None and free < MIN_FREE_GB + PER_SEAT_GB:
                        hold(f"memory: {free:.1f} GB free, {MIN_FREE_GB + PER_SEAT_GB} needed")
                        break
                    c = L.connect()
                    try:
                        b = L.brakes(c)
                        held_brakes = [h for h in b["held_by"] if not (a.terminal_owns and h.startswith("curator_enabled"))]
                        if held_brakes:
                            hold("brake: " + "; ".join(held_brakes))
                            break
                        skills = L.read_skills(registry)
                        busy = {u["seat"]["dossier"]["repo"] for u in running.values()} | \
                               {s2.get("repo") for summ, _ in posting for s2 in summ.get("seats", [])}
                        held = {f"personas:{x}" for x in L.open_dispatch_subjects(c)} | \
                               {f"{u['seat']['claim']['repo']}:{u['seat']['claim']['subject']}" for u in running.values()}
                        barren = {r for r, k in repo_dry.items() if k >= BARREN_UNITS}
                        used = {"repos": busy, "busy": busy | barren,
                                "categories": {u["seat"]["dossier"]["category"] for u in running.values()}}
                        u = spawn_unit(a, c, registry, skills, repos, slot.split("#")[0], held, used, agy_model)
                    finally:
                        c.close()
                    if u is None:
                        idle_until[slot] = dry_until[slot] = time.time() + NOTHING_CLAIMABLE_RETRY_S
                        log("slot_idle", slot=slot, retry_in_min=NOTHING_CLAIMABLE_RETRY_S // 60)
                        continue
                    last_hold = None
                    running[slot] = u
                    started += 1
                    s = u["seat"]
                    log("seat", unit=u["n"], slot=slot, provider=s["name"], model=s["model"], repo=s["dossier"]["repo"],
                        subject=s["claim"]["subject"], pairs=len(s["dossier"]["pairs"]), pid=s["pid"])
            errors = 0
          except Exception as e:  # a locked database or a transient OSError: retry; running seats are journaled
            errors += 1
            log("loop_error", error=f"{type(e).__name__}: {e}", consecutive=errors)
            if errors >= 10:
                raise
          time.sleep(FLOW_POLL_S)
    finally:
        pool.shutdown(wait=True)


def run_night(a: argparse.Namespace) -> dict:
    """Rounds back to back, each reviewed and committed, until the window closes or a stop fires.

    Stops on: `--until` (no round starts within 20 min of it), `--max-rounds`, the STOP file
    (`multi stop`), a brake, a stale corpus, every provider dropped, an empty backlog, or
    EMPTY_ROUNDS_STOP rounds in a row that landed nothing. Waits for memory rather than
    starving a sibling session. Writes `night/<date>.jsonl` as it goes and `night/<date>.md`
    at the end - the morning report.
    """
    MULTI_DIR.mkdir(parents=True, exist_ok=True)
    NIGHT_DIR.mkdir(parents=True, exist_ok=True)
    lock = _night_lock()
    if lock is None:
        return {"ok": False, "error": "another night is running (night.lock holds a live pid)"}
    start = datetime.now()
    tag = start.strftime("%Y-%m-%d-%H%M")
    log_path = NIGHT_DIR / f"{tag}.jsonl"
    deadline = _deadline(a.until, start)
    if getattr(a, "hours", None):
        deadline = start + timedelta(hours=a.hours)
    NIGHT_STOP.unlink(missing_ok=True)

    def log(event: str, **kw):
        rec = {"ts": L.now(), "event": event, **kw}
        print(json.dumps(rec, default=str), flush=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, default=str) + "\n")

    events: list[dict] = []
    stop_reason = None
    repos: list[dict] = []
    coverage_before: dict = {}
    try:
        c = L.connect(readonly=True)
        registry = L.registry_root(c)
        c.close()
        repos = consumer_repos(registry, [x.strip() for x in a.repos.split(",")] if a.repos else None)
        coverage_before = {r["slug"]: backlog_size(r) for r in repos}
        state = load_state()
        if state["dropped"]:  # a new night: last night's limits have had time to reset
            log("dropped_reset", was=list(state["dropped"]))
            state["dropped"] = {}
            save_state(state)
        log("night_started", until=a.until, max_rounds=a.max_rounds, providers=a.providers, review=a.review,
            repos=[r["slug"] for r in repos], per_provider=a.per_provider)
        while unfinished_round() is not None:  # a continuous night can leave several
            fin = finish_round()
            log("finished_stranded_round", round=fin.get("round"))
            events.append({"round": fin.get("round"), "summary": fin, "review": {"skipped": "recovered unit"},
                           "commits": commit_round(fin, "none (recovered unit)")})
        stop_reason = run_flow(a, log, events, deadline, registry, repos)
    except Exception as e:  # never die silently overnight: the report says what broke
        stop_reason = f"crashed: {type(e).__name__}: {e}"
        log("crashed", error=stop_reason)
    finally:
        lock.unlink(missing_ok=True)
    coverage_after = {r["slug"]: backlog_size(r) for r in repos}
    report_path = NIGHT_DIR / f"{tag}.md"
    report_path.write_text(night_report(tag, start, stop_reason, events, coverage_before, coverage_after), encoding="utf-8")
    log("night_ended", reason=stop_reason, report=str(report_path))
    clean_raw()
    return {"ok": True, "stopped": stop_reason, "rounds": len(events), "report": str(report_path)}


def night_report(tag, start, stop_reason, events, before, after) -> str:
    landed = sum(sum(s.get("accepted") or 0 for s in e["summary"].get("seats", [])) for e in events)
    withdrawn = sum(sum(len(w["contexts"]) for w in (e["review"].get("withdrawn") or [])) for e in events)
    lines = [f"# Curator night {tag}", "",
             f"Started {start:%Y-%m-%d %H:%M}, ended {datetime.now():%H:%M}. Stopped by: **{stop_reason}**.",
             f"{len(events)} round(s); {landed} verdict(s) landed by the validator, {withdrawn} withdrawn by the reviewer, "
             f"**{landed - withdrawn} kept**.", "", "## Coverage (unknown + stale pairs still owed)", "",
             "| repo | before | after | judged tonight |", "|---|---|---|---|"]
    for slug in before:
        b, a2 = before[slug], after.get(slug, before[slug])
        owed_b, owed_a = b["unknown"] + b["stale"], a2["unknown"] + a2["stale"]
        lines.append(f"| {slug} | {owed_b} | {owed_a} | {owed_b - owed_a} |")
    lines += ["", "## Rounds", ""]
    for e in events:
        s = e["summary"]
        lines.append(f"### Round {s.get('round')}")
        for seat in s.get("seats", []):
            lines.append(f"- {seat['provider']} on `{seat.get('repo')}` / `{seat['subject']}`: {seat.get('outcome')}, "
                         f"{seat.get('accepted', 0)} accepted of {seat.get('returned', 0)}"
                         + (f" ({seat['wall_s']} s)" if seat.get("wall_s") else ""))
        rv = e["review"]
        if rv.get("withdrawn"):
            for w in rv["withdrawn"]:
                lines.append(f"  - reviewer withdrew {', '.join(w['contexts'])} in `{w['run']}`: {w['why']}")
        if rv.get("notes"):
            lines.append(f"  - reviewer notes: {rv['notes']}")
        if rv.get("error") or rv.get("skipped"):
            lines.append(f"  - review: {rv.get('error') or rv.get('skipped')}")
        for cm in e.get("commits") or []:
            what = cm.get("commit") and f"committed {cm['commit']} on `{cm.get('branch')}`" or \
                cm.get("skipped") or cm.get("error") or ("nothing to commit" if cm.get("nothing") else "?")
            lines.append(f"  - {cm['slug']}: {what}")
        lines.append("")
    dropped = load_state()["dropped"]
    if dropped:
        lines += ["## Providers dropped on their usage limit", ""] + [f"- {k}: {v['why'][:200]}" for k, v in dropped.items()]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# Detached starts and the schedule
# --------------------------------------------------------------------------

# In the `\Personas\` Task Scheduler folder, which the app's Supply deck lists as the operator's
# scheduled work (fleet_scheduled_tasks). Its Description is `<title>|<window>`: the plate's line.
TASK_NAME = "\\Personas\\CuratorNight"
LEGACY_TASK_NAMES = ("PersonasCuratorNight",)  # the root-level name before 2026-10-13


def _detached(argv: list[str], log: pathlib.Path) -> int:
    flags = 0
    if sys.platform == "win32":
        # A HIDDEN console, never no console. Measured 2026-10-13: with DETACHED_PROCESS the driver
        # had no console, so every console program it started (the claude reviewer, git, node)
        # opened its own VISIBLE window on the operator's desktop. CREATE_NO_WINDOW gives it a
        # console without a window, which every child inherits.
        flags = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
                 | getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0x01000000))
    out = open(log, "w", encoding="utf-8")
    try:
        proc = subprocess.Popen(argv, cwd=str(L.PERSONAS_ROOT), stdout=out, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, creationflags=flags, close_fds=True)
    except OSError:  # a job that forbids breakaway: start without it, still detached
        flags &= ~0x01000000
        proc = subprocess.Popen(argv, cwd=str(L.PERSONAS_ROOT), stdout=out, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, creationflags=flags, close_fds=True)
    return proc.pid


def _common_args(a: argparse.Namespace) -> list[str]:
    out = ["--providers", a.providers, "--timeout-min", str(a.timeout_min), "--per-provider", str(a.per_provider)]
    if a.terminal_owns:
        out.append("--terminal-owns")
    if a.repos:
        out += ["--repos", a.repos]
    return out


def start_detached(a: argparse.Namespace) -> dict:
    """Launch `multi round` as a process no Claude Code shell owns.

    Measured 2026-10-12: Claude Code's low-memory reaper killed the background shell running a
    round, and the round's driver with it; the seats finished with nobody to settle them. A
    detached driver survives the reap; the session only watches `rounds/<n>.json` appear.
    """
    pending = unfinished_round()
    if pending is not None:
        return {"ok": False, "error": f"round {pending} never finished: run `multi finish` first"}
    argv = [sys.executable, str(pathlib.Path(L.__file__)), "multi", "round", *_common_args(a)]
    if a.keep_raw:
        argv.append("--keep-raw")
    pid = _detached(argv, MULTI_DIR / "round.out")
    n = load_state().get("rounds", 0) + 1
    return {"ok": True, "pid": pid, "round": n, "log": str(MULTI_DIR / "round.out"),
            "summary_will_be": str(MULTI_DIR / "rounds" / f"{n}.json")}


def night_argv(a: argparse.Namespace) -> list[str]:
    # --foreground is load-bearing: without it the detached child detaches again, forever.
    argv = [sys.executable, str(pathlib.Path(L.__file__)), "multi", "night", "--foreground", *_common_args(a),
            "--review", a.review, "--reviewer-model", a.reviewer_model]
    if a.until:
        argv += ["--until", a.until]
    if getattr(a, "hours", None):
        argv += ["--hours", str(a.hours)]
    if a.max_rounds:
        argv += ["--max-rounds", str(a.max_rounds)]
    return argv


def night_detached(a: argparse.Namespace) -> dict:
    NIGHT_DIR.mkdir(parents=True, exist_ok=True)
    held = L._read_json(MULTI_DIR / "night.lock", None)
    if held and L.proc_alive(held.get("pid"), held.get("create_time")):
        return {"ok": False, "error": f"a night is already running (pid {held.get('pid')} since {held.get('at')})"}
    if "--foreground" not in night_argv(a):  # measured 2026-10-12: without it the child re-detaches forever
        return {"ok": False, "error": "refusing to spawn a night child that would detach again"}
    pid = _detached(night_argv(a), NIGHT_DIR / "night.out")
    return {"ok": True, "pid": pid, "log": str(NIGHT_DIR / "night.out"), "stop_with": "loop.py multi stop"}


def schedule(a: argparse.Namespace) -> dict:
    """Register the night with Windows Task Scheduler: daily at `--at`, as the current user.

    The task runs `pythonw` on a tiny launcher (schtasks caps /TR at 261 characters) that starts
    `multi night` with the same flags, windowless. It was a .cmd until 2026-10-13, which held a
    visible console open on the desktop for the whole night. It runs only while the user is logged
    on, which is what the providers' stored logins need.
    """
    if not a.at or not a.until:
        return {"ok": False, "error": "schedule needs --at HH:MM and --until HH:MM"}
    NIGHT_DIR.mkdir(parents=True, exist_ok=True)
    launcher = MULTI_DIR / "night_task.py"
    launcher.write_text(
        "import subprocess, sys\n"
        f"argv = {night_argv(a)!r}\n"
        f"with open({str(NIGHT_DIR / 'task.out')!r}, 'w', encoding='utf-8') as out:\n"
        "    sys.exit(subprocess.call(argv, cwd=" + repr(str(L.PERSONAS_ROOT)) + ", stdout=out, stderr=subprocess.STDOUT,\n"
        "                             stdin=subprocess.DEVNULL, creationflags=0x08000000))\n", encoding="utf-8")
    pyw = pathlib.Path(sys.executable).with_name("pythonw.exe")
    runner = str(pyw if pyw.exists() else sys.executable)
    r = subprocess.run(["schtasks", "/Create", "/F", "/SC", "DAILY", "/TN", TASK_NAME, "/ST", a.at,
                        "/TR", f'"{runner}" "{launcher}"'],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    described = None
    if r.returncode == 0:
        # schtasks has no description flag; the plate reads `<title>|<window>` from it.
        folder, leaf = TASK_NAME.rsplit("\\", 1)
        ps = (f"$t = Get-ScheduledTask -TaskPath '{folder}\\' -TaskName '{leaf}'; "
              f"$t.Description = 'Curator night|{a.at}-{a.until}'; Set-ScheduledTask -InputObject $t | Out-Null")
        d = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        described = d.returncode == 0 or (d.stderr or "").strip()[:300]
        for legacy in LEGACY_TASK_NAMES:  # one task, one place: retire the root-level original
            subprocess.run(["schtasks", "/Delete", "/F", "/TN", legacy], capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
    return {"ok": r.returncode == 0, "task": TASK_NAME, "at": a.at, "until": a.until, "runs": f"{runner} {launcher}",
            "described": described, "schtasks": (r.stdout or r.stderr).strip()}


def unschedule() -> dict:
    r = subprocess.run(["schtasks", "/Delete", "/F", "/TN", TASK_NAME], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return {"ok": r.returncode == 0, "schtasks": (r.stdout or r.stderr).strip()}


def scheduled() -> dict | None:
    r = subprocess.run(["schtasks", "/Query", "/TN", TASK_NAME, "/FO", "LIST"], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode:
        return None
    return {k.strip(): v.strip() for k, v in (l.split(":", 1) for l in r.stdout.splitlines() if ":" in l)}


def revalidate(n: int, provider: str, why: str) -> dict:
    """Re-judge a kept raw answer under the CURRENT validator and land what now passes.

    For a validator defect found in review: the seat's answer was good and the rule was wrong.
    The run file is new (`<dispatch>-rv.json`), so the original archive stays as evidence of
    what the old rule did; the ledger row's outcome is rewritten to say so.
    """
    j = L._read_json(MULTI_DIR / "rounds" / str(n) / "seats.json", {}) or {}
    seat = next((x for x in j.get("seats", []) if x["name"] == provider), None)
    if not seat:
        L.die(f"round {n} kept no raw seat for {provider} (needs --keep-raw)")
    d = seat["dossier"]
    d.setdefault("repo", "personas")
    d.setdefault("repo_root", str(L.PERSONAS_ROOT))
    sdir = pathlib.Path(seat["dir"])
    r = read_seat(provider, sdir, (sdir / "stdout.txt").read_text(encoding="utf-8", errors="replace"))
    v = validate(r["answer"], d, Files(pathlib.Path(d["repo_root"])), r.get("read_nothing"), provider=provider)
    if not v["pairs"]:
        return {"ok": True, "landed": 0, "rejections": v["rejections"]}
    claim = dict(seat["claim"])
    claim["dispatch_id"] = f"{claim['dispatch_id']}-rv"
    rel = write_run_file(claim, d, v, seat)
    name = pathlib.PurePosixPath(rel).name
    c = L.connect()
    action, evidence = _merge_and_judge(L.registry_root(c), d["repo_root"], name, {}, 0, 0)
    note = f"[{provider}:{seat['model']}] revalidated after review ({why}): {evidence}"
    if claim["lane"] == "queue":
        c.execute("UPDATE curator_request SET state=?, outcome=? WHERE id=?",
                  (L.REQUEST_STATE.get(action, "failed"), note, claim["request_id"]))
    else:
        c.execute("UPDATE curator_plan_item SET state=?, evidence_ref=?, updated_at=? WHERE id=?",
                  (action if action in L.TERMINAL_ITEM else "blocked", note, L.now(), claim["item_id"]))
    c.close()
    with open(MULTI_DIR / "scoreboard.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"kind": "revalidated", "ts": L.now(), "round": n, "provider": provider, "run": name,
                            "accepted": len(v["pairs"]), "reason": why}) + "\n")
    return {"ok": True, "action": action, "evidence": evidence, "pairs": [(x["context"], x["state"]) for x in v["pairs"]]}


def clean_raw() -> dict:
    """Delete the raw dirs of every FINISHED round (kept by --keep-raw for the review)."""
    base, gone = MULTI_DIR / "rounds", []
    for d in sorted(x for x in base.iterdir() if x.is_dir()) if base.exists() else []:
        if (base / f"{d.name}.json").exists():
            shutil.rmtree(d, ignore_errors=True)
            gone.append(str(d))
    pending = unfinished_round()
    if pending is None:  # the driver logs are only worth anything while a round can still be finished
        for f in [MULTI_DIR / "round.out", *MULTI_DIR.glob("finish*.out")]:
            if f.exists():
                f.unlink()
                gone.append(str(f))
    return {"ok": True, "removed": gone, "pending": pending}


# --------------------------------------------------------------------------
# The feel: which provider handles which topic
# --------------------------------------------------------------------------


def report() -> dict:
    rows = []
    try:
        rows = [json.loads(x) for x in (MULTI_DIR / "scoreboard.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    except OSError:
        pass
    agg: dict = {}
    withdrawn = {}
    revalidated = {}
    for r in rows:
        if r.get("kind") == "review":
            withdrawn[r.get("run")] = withdrawn.get(r.get("run"), 0) + r.get("withdrawn", 0)
        if r.get("kind") == "revalidated":
            revalidated[(r.get("round"), r.get("provider"))] = r.get("accepted", 0)
    for r in rows:
        if r.get("kind") in ("review", "revalidated"):
            continue
        # A withdrawal counts against the seat; a revalidation (the validator was wrong) for it.
        w = withdrawn.get(r.get("run"), 0)
        rv = revalidated.get((r.get("round"), r.get("provider")), 0)
        keys = (("provider", r["provider"]), ("provider×category", f"{r['provider']} | {r.get('category')}"),
                ("provider×repo", f"{r['provider']} | {r.get('repo', 'personas')}"))
        for key in keys:
            a = agg.setdefault(key[0], {}).setdefault(key[1], {"seats": 0, "returned": 0, "accepted": 0,
                                                              "repairs": 0, "rejections": 0, "landed": 0,
                                                              "wall_s": 0, "outcomes": {}})
            a["seats"] += 1
            a["returned"] += r.get("returned") or 0
            a["accepted"] += (r.get("accepted") or 0) - w + rv
            a["withdrawn"] = a.get("withdrawn", 0) + w
            a["revalidated"] = a.get("revalidated", 0) + rv
            a["repairs"] += len(r.get("repairs") or [])
            a["rejections"] += len(r.get("rejections") or [])
            a["landed"] += 1 if r.get("outcome") == "landed" else 0
            if r.get("wall_s") is not None:  # a recovered seat's duration is unknown, not zero
                a["wall_s"] += r["wall_s"]
                a["timed"] = a.get("timed", 0) + 1
            a["outcomes"][r.get("outcome")] = a["outcomes"].get(r.get("outcome"), 0) + 1
    for table in agg.values():
        for a in table.values():
            a["accept_rate"] = round(a["accepted"] / a["returned"], 2) if a["returned"] else None
            a["avg_wall_s"] = round(a["wall_s"] / a["timed"]) if a.get("timed") else None
    return {"ok": True, "rows": len(rows), "state": load_state(), **agg}


def status() -> dict:
    c = L.connect(readonly=True)
    registry = L.registry_root(c)
    c.close()
    lock = L._read_json(MULTI_DIR / "night.lock", None)
    nights = sorted(NIGHT_DIR.glob("*.md")) if NIGHT_DIR.exists() else []
    return {"ok": True, "state": load_state(),
            "providers": {p: {"binary": bin_of(p), **PROVIDERS[p]} for p in PROVIDERS},
            "repos": [{"slug": r["slug"], "root": str(r["root"]), **backlog_size(r)} for r in consumer_repos(registry)],
            "night_running": bool(lock and L.proc_alive(lock.get("pid"), lock.get("create_time"))),
            "stop_requested": NIGHT_STOP.exists(), "last_report": str(nights[-1]) if nights else None,
            "scheduled": scheduled(), "unfinished_round": unfinished_round()}


def main(a: argparse.Namespace) -> int:
    MULTI_DIR.mkdir(parents=True, exist_ok=True)
    cmd = a.multi_cmd
    if cmd == "round":
        out = run_round(a)
    elif cmd == "night":
        out = run_night(a) if a.foreground else night_detached(a)
    elif cmd == "stop":
        NIGHT_STOP.write_text(L.now(), encoding="utf-8")
        out = {"ok": True, "stop_requested": True, "note": "the night finishes its running round, commits it, then ends"}
    elif cmd == "schedule":
        out = schedule(a)
    elif cmd == "unschedule":
        out = unschedule()
    elif cmd == "revalidate":
        if not (a.round and a.provider and a.why):
            L.die("revalidate needs --round <n> --provider <name> --why <the validator defect>")
        out = revalidate(a.round, a.provider, a.why)
    elif cmd == "start":
        out = start_detached(a)
    elif cmd == "finish":
        out = finish_round()
    elif cmd == "clean":
        out = clean_raw()
    elif cmd == "report":
        out = report()
    elif cmd == "withdraw":
        if not (a.run and a.contexts and a.why):
            L.die("withdraw needs --run <file.json> --contexts a,b --why <reason>")
        out = withdraw(a.run, [x.strip() for x in a.contexts.split(",")], a.why)
    elif cmd == "commit":
        if not a.round:
            L.die("commit needs --round <n>")
        out = {"ok": True, "commits": commit_round(L._read_json(MULTI_DIR / "rounds" / f"{a.round}.json", {}) or {},
                                                   "by hand")}
    elif cmd == "reset-dropped":
        s = load_state()
        s["dropped"] = {}
        save_state(s)
        out = {"ok": True, "dropped": {}}
    else:
        out = status()
    print(json.dumps(out, indent=2, default=str))
    return 0
