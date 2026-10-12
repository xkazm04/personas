"""`/curator --multi`: several LLM providers judge different conform subjects in one round.

Why conform, and only conform: a conform worker writes nothing but its own run file in THIS
repo, the registry's merger is the map's single writer, and every verdict can be checked
mechanically against the code before it lands. That makes it the one lane where a less
capable model can contribute without being trusted - its output is evidence to verify, not a
change to accept.

What makes a weaker provider safe here, in order of how much it carries:

* **The orchestrator does the mechanical half.** The dossier names the subject's golden path,
  every technique file, each pair's context and its REAL file list from `context-map.json`,
  so the provider never resolves an index, builds a path, or picks pairs.
* **Read-only seats, structured output.** No provider writes a file: each returns one JSON
  object through its CLI's schema flag, and this module writes the run file itself.
* **The validator.** Every anchor must resolve to a tracked file and a non-blank line, and the
  provider must QUOTE that line; a quote found a few lines away repairs the line number, a
  quote found nowhere rejects the anchor. The evidence floor of /conform 3 is enforced in
  code. A rejected pair becomes a `declined` row with the reason, never a verdict.

State lives outside the repo (`~/.personas/curator-multi/`, `CURATOR_MULTI_DIR` overrides):
`state.json` (dropped providers, rounds run), `scoreboard.jsonl` (one row per seat per
round - the source of the provider-by-topic feel), `rounds/<n>.json` (the round's summary).
Each round's raw prompts and outputs live in `rounds/<n>/` only until the round is judged,
then they are deleted with every session file the providers wrote for it.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time
import uuid

import loop as L

MULTI_DIR = pathlib.Path(os.environ.get("CURATOR_MULTI_DIR") or (pathlib.Path.home() / ".personas" / "curator-multi"))
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
                 seat_dir: pathlib.Path, session_id: str) -> tuple[list[str], str | None, dict]:
    """(argv, stdin text, extra env). Every seat is told to stay read-only; codex's sandbox enforces it."""
    b = bin_of(name)
    repo = str(L.PERSONAS_ROOT)
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
            "required": ["context", "state", "anchor", "quote", "consequence", "techniques", "registryProposal"],
            "properties": {
                "context": {"type": "string"},
                "state": {"type": "string", "enum": VERDICTS},
                "anchor": _anchor, "quote": _quote,
                "consequence": {"type": "string", "description": "one sentence"},
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

OUR_STACKS = ("typescript", "react", "tauri", "rust", "node", "vite", "zustand", "sqlite")
PAIR_BUDGET = 5


def _json(path: pathlib.Path):
    return json.loads(path.read_text(encoding="utf-8"))


def subject_entry(registry: pathlib.Path, domain: str, slug: str) -> dict | None:
    try:
        return _json(registry / "knowledge" / domain / "index.json")["subjects"][slug]
    except (OSError, ValueError, KeyError):
        return None


def dossier(registry: pathlib.Path, claim: dict) -> dict | None:
    """The subject, its techniques, and the pairs worth a read. None = nothing to judge."""
    domain, slug = claim["subject"].split("/", 1)[0], claim["subject"].split("/")[-1]
    entry = subject_entry(registry, domain, slug)
    if not entry:
        return None
    golden = registry / entry["file"]
    tdir = golden.parent / "techniques"
    techniques = [{"slug": t["slug"], "file": (tdir / f"{t['slug']}.md").as_posix(),
                   "use_when": (t.get("use_when") or [])[:2]} for t in entry.get("techniques", [])]
    apps = [(registry / a["file"]).as_posix() for a in entry.get("applications", [])
            if any(s in (a.get("stack") or "").lower() for s in OUR_STACKS)][:4]
    rmap = _json(L.PERSONAS_ROOT / L.MAP_REL)
    cmap = {c["id"]: c for c in _json(L.PERSONAS_ROOT / "context-map.json").get("contexts", [])}
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
            cands.append((rank, {
                "context": row["name"], "context_id": row["context"],
                "description": (cx.get("description") or "")[:300],
                "files": (cx.get("file_paths") or row.get("paths") or [])[:25],
                "prior": ({"state": p.get("state"), "evidence": p.get("evidence")} if judged else None),
            }))
    cands.sort(key=lambda x: x[0])
    pairs = [c for _, c in cands[:PAIR_BUDGET]]
    if not pairs:
        return None
    path = entry["file"].split("/")
    return {"domain": domain, "slug": slug, "category": "/".join(path[2:-2]) or entry.get("category"),
            "golden": golden.as_posix(), "techniques": techniques, "applications": apps, "pairs": pairs}


def brief(d: dict) -> str:
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
    return f"""You are judging ONE subject of a knowledge registry against the code of the repository at
{L.PERSONAS_ROOT.as_posix()} (your working directory). You are one of several model seats; every
verdict you return is checked line by line before it is kept, so an honest "unknown" is worth more
than a confident guess.

HARD RULES
- READ ONLY. Do not create, edit, move or delete any file. Do not run git commands that change
  anything. Your only output is the final JSON object described at the end.
- The standard does not bend to the code. Where the code falls short, that is a deviation.
- Never write placeholder evidence. Every anchor must be a line you actually opened.
- USE YOUR TOOLS: open the standard and the code files before answering. An answer from a seat
  that opened no file is refused whole, and so is one whose notes call itself a draft.
- An earlier verdict shown below is a claim to re-check, not an answer to copy.
- Judge each context by ITS OWN code. A fact about the whole repo (a hook, a CI job) repeated
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
     (a manifest, config or module that proves the absence).
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
            "registryProposal": "<a finding about the standard itself, or empty string>"}}],
 "declined": [{{"context": "<context name>", "reason": "<why>"}}],
 "notes": "<anything the reviewer should know, or empty string>"}}
"""


# --------------------------------------------------------------------------
# Reading what a seat returned
# --------------------------------------------------------------------------


def _last_json_object(text: str) -> dict | None:
    """The last top-level {...} in `text` that parses and looks like an answer."""
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
                    if isinstance(obj, dict) and "pairs" in obj:
                        best = obj
                except ValueError:
                    pass
    return best


def read_seat(name: str, seat_dir: pathlib.Path, stdout: str) -> dict:
    """{answer, session, usage, error} from a seat's envelope."""
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
    """Tracked files of this repo, read once, lines cached."""

    def __init__(self):
        out = subprocess.run(["git", "-C", str(L.PERSONAS_ROOT), "ls-files"], capture_output=True,
                             text=True, encoding="utf-8", errors="replace").stdout
        self.tracked = {p: p for p in out.splitlines()}
        self.lower = {p.lower(): p for p in self.tracked}
        self.cache: dict[str, list[str]] = {}

    def resolve(self, raw: str) -> str | None:
        p = raw.strip().strip("`'\"").replace("\\", "/")
        root = L.PERSONAS_ROOT.as_posix()
        for prefix in (root + "/", root.lower() + "/", "./"):
            if p.lower().startswith(prefix.lower()):
                p = p[len(prefix):]
        return self.tracked.get(p) or self.lower.get(p.lower())

    def lines(self, rel: str) -> list[str]:
        if rel not in self.cache:
            try:
                self.cache[rel] = (L.PERSONAS_ROOT / rel).read_text(encoding="utf-8", errors="replace").splitlines()
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


def validate(answer: dict | None, d: dict, files: Files, read_nothing: str | None = None) -> dict:
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
        pair = {"context": name, "subject": d["slug"], "bundle": d["domain"], "state": state,
                "evidence": f"{fixed} {consequence}", "techniques": techs}
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
    path = L.PERSONAS_ROOT / rel
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
    tmp.write_text(json.dumps(run, indent=1), encoding="utf-8")
    os.replace(tmp, path)
    return rel


# --------------------------------------------------------------------------
# State, cleanup
# --------------------------------------------------------------------------


def load_state() -> dict:
    return L._read_json(MULTI_DIR / "state.json", {}) or {"rounds": 0, "dropped": {}}


def save_state(s: dict) -> None:
    L._write_json(MULTI_DIR / "state.json", s)


def repo_untracked() -> set[str]:
    out = subprocess.run(["git", "-C", str(L.PERSONAS_ROOT), "status", "--porcelain", "-uall"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    return {l[3:].strip().strip('"') for l in out.splitlines() if l.startswith("??")}


def grok_session_dir(session: str) -> pathlib.Path:
    from urllib.parse import quote
    return HOME / ".grok" / "sessions" / quote(str(L.PERSONAS_ROOT), safe="") / session


def clean_provider_sessions(seat: dict) -> list[str]:
    """Delete what a provider wrote OUTSIDE the repo for this seat, by its own session id only."""
    gone = []
    sid = seat.get("session")
    if not sid or not re.fullmatch(r"[0-9a-fA-F-]{16,64}", sid):
        return gone
    if seat["name"] == "grok":
        cands = [grok_session_dir(sid)]
        # grok also appends each prompt to ONE history file per cwd, shared with the operator's own
        # sessions: drop only this seat's lines, matched by session id.
        hist = grok_session_dir(sid).parent / "prompt_history.jsonl"
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
                "coverage of this repo's map with several providers. Subject chosen by /conform's own bare "
                "order (stale pairs, then strong unknowns, then probable unknowns), never by hand.")


def backlog_subjects(root: pathlib.Path, exclude: set[str]) -> list[tuple[str, str, float]]:
    """(domain, slug, weight) for subjects with judgeable pairs in THIS repo's map, best first.

    This is /conform's bare order lifted to subject level - stale pairs first, then strong
    unknowns, then probable unknowns - so the subject is the map's choice, not the driver's.
    """
    rmap = _json(L.PERSONAS_ROOT / L.MAP_REL)
    declared = L.declared_domains()
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
    out = [(b, s, v) for (b, s), v in w.items() if f"{b}/{s}" not in exclude and subject_entry(root, b, s)]
    return sorted(out, key=lambda x: (-x[2], x[1]))


def file_request(c, skill: str, argument: str, note: str) -> str:
    rid = str(uuid.uuid4())
    c.execute("INSERT INTO curator_request (id, skill, argument, note, state, created_at) VALUES (?,?,?,?, 'queued', ?)",
              (rid, skill, argument, note, L.now()))
    return rid


def acquire(c, root, skills, held: set[str], used_categories: set[str], state: dict, rnd: int):
    """(claim, dossier) for one seat, or (None, None). Her plan first; then the map's backlog,
    filed into the operator's queue so the ledger carries a real row for every seat."""
    for _ in range(4):
        claim = L.claim_one(c, root, skills, {"plan"}, {"conform"}, exclude_subjects=held)
        if not claim or claim.get("declined"):
            break
        d = dossier(root, claim)
        if d:
            return claim, d
        L.settle(c, claim, "idled", "curator-multi: no judgeable pair (every pair weak, dead or judged and current)")
        held.add(claim["subject"])
    tried = state.setdefault("tried", {})
    queued = {f"{r['argument']}" for r in c.execute("SELECT argument FROM curator_request WHERE state IN ('queued','dispatched')")}
    excl = set(held) | {k for k in tried} | {a.replace("--subject ", "") for a in queued}
    cands = backlog_subjects(root, excl)
    # Different topics in one round: prefer a category no other seat of this round holds.
    cands.sort(key=lambda x: (subject_category(root, x[0], x[1]) in used_categories,))
    for bundle, slug, _w in cands[:6]:
        address = f"{bundle}/{slug}"
        tried[address] = rnd
        rid = file_request(c, "conform", f"--subject {slug}", REQUEST_NOTE)
        claim = L.claim_one(c, root, skills, {"queue"}, None)
        if not claim or claim.get("declined") or claim.get("request_id") != rid:
            if claim and not claim.get("declined"):
                L.release(c, claim, "curator-multi: took a request it did not file")
            c.execute("UPDATE curator_request SET state='cancelled', settled_at=?, outcome=? WHERE id=? AND state='queued'",
                      (L.now(), "curator-multi: not claimable after filing", rid))
            return None, None
        claim["subject"] = address
        claim["cwd"] = str(L.PERSONAS_ROOT)
        d = dossier(root, claim)
        if d:
            return claim, d
        L.settle(c, claim, "declined", "curator-multi: no judgeable pair at claim time")
    return None, None


def subject_category(root: pathlib.Path, domain: str, slug: str) -> str | None:
    e = subject_entry(root, domain, slug)
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


def _journal(rdir: pathlib.Path, seats: list[dict], before: set[str], keep_raw: bool) -> None:
    """Every seat, written the moment it spawns: a round whose driver dies is finished from this."""
    keep = ("name", "model", "claim", "dossier", "dir", "pid", "create_time", "t0", "session")
    L._write_json(rdir / "seats.json", {"before": sorted(before), "keep_raw": keep_raw,
                                         "seats": [{k: (str(x[k]) if k == "dir" else x.get(k)) for k in keep} for x in seats]})


def run_round(a: argparse.Namespace) -> dict:
    pending = unfinished_round()
    if pending is not None:
        return {"ok": False, "error": f"round {pending} never finished (its driver died): run `multi finish` first"}
    state = load_state()
    n = state["rounds"] + 1
    rdir = MULTI_DIR / "rounds" / str(n)
    rdir.mkdir(parents=True, exist_ok=True)
    wanted = [p.strip() for p in a.providers.split(",") if p.strip()]
    active = [p for p in wanted if p in PROVIDERS and p not in state["dropped"] and bin_of(p)]
    skipped = {p: ("dropped: " + state["dropped"][p]["why"]) if p in state["dropped"] else "no binary"
               for p in wanted if p not in active}
    if not active:
        return {"ok": False, "round": n, "error": "no provider left to run", "skipped": skipped}
    # Rotate so no provider always takes the top-ranked subject.
    k = (n - 1) % len(active)
    active = active[k:] + active[:k]

    c = L.connect()
    root = L.registry_root(c)
    b = L.brakes(c)
    held = [h for h in b["held_by"] if not (a.terminal_owns and h.startswith("curator_enabled"))]
    if held:
        return {"ok": False, "round": n, "error": "brake", "held_by": held}
    proj = L.projection_freshness(c, root)
    fresh = L.corpus_freshness(root)
    if (proj["behind"] or 0) > L.STALE_PROJECTION_BEHIND or (fresh["behind"] or 0) > L.STALE_CORPUS_BEHIND:
        return {"ok": False, "round": n, "error": "stale", "projection": proj, "corpus": fresh}
    skills = L.read_skills(root)
    before = repo_untracked()
    agy_model = agy_flash_model() if "agy" in active else None
    schema_file = rdir / "schema.json"
    schema_file.write_text(json.dumps(SCHEMA), encoding="utf-8")

    seats = []
    used_categories: set[str] = set()
    for name in active:
        held_subjects = L.open_dispatch_subjects(c) | {s["claim"]["subject"] for s in seats}
        claim, d = acquire(c, root, skills, held_subjects, used_categories, state, n)
        if not claim:
            skipped[name] = "nothing claimable"
            continue
        used_categories.add(d["category"])
        cfg = PROVIDERS[name]
        model = agy_model if name == "agy" else cfg["model"]
        sdir = rdir / name
        sdir.mkdir(exist_ok=True)
        pf = sdir / "prompt.md"
        pf.write_text(brief(d), encoding="utf-8")
        sid = str(uuid.uuid4())
        argv, stdin, env_extra = seat_command(name, model, cfg["effort"], pf, schema_file, sdir, sid)
        env = {**L.worker_env(), **env_extra}
        flags = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if sys.platform == "win32" else 0
        fo, fe = open(sdir / "stdout.txt", "w", encoding="utf-8"), open(sdir / "stderr.txt", "w", encoding="utf-8")
        proc = subprocess.Popen(argv, cwd=str(L.PERSONAS_ROOT), env=env, stdout=fo, stderr=fe,
                                stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                                creationflags=flags, text=True, encoding="utf-8")
        if stdin is not None:
            try:
                proc.stdin.write(stdin)
                proc.stdin.close()
            except OSError:
                pass
        seats.append({"name": name, "model": model, "claim": claim, "dossier": d, "dir": sdir, "proc": proc,
                      "pid": proc.pid, "create_time": L.proc_create_time(proc.pid),
                      "fo": fo, "fe": fe, "t0": time.time(), "session": sid if name == "grok" else None})
        _journal(rdir, seats, before, a.keep_raw)
        print(json.dumps({"event": "seat", "round": n, "provider": name, "model": model, "subject": claim["subject"],
                          "pairs": len(d["pairs"]), "pid": proc.pid}), flush=True)
    c.close()
    save_state(state)  # `tried` was written by acquire(); settle_round reloads state from disk

    for x in seats:
        x["fo"].close(), x["fe"].close()
    wait_seats(seats, a.timeout_min)
    return settle_round(n, rdir, seats, set(before), a.keep_raw, a.timeout_min, recovered=False, skipped=skipped)


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
        seats.append(x)
    dead_already = {x["name"] for x in seats if not _alive(x)}
    wait_seats(seats, 35)
    for x in seats:
        if x["name"] in dead_already:
            x["wall_s"] = None  # ended before this driver looked; its real duration is unknown
    return settle_round(n, rdir, seats, set(j.get("before", [])), bool(j.get("keep_raw")), 35, recovered=True)


def settle_round(n: int, rdir: pathlib.Path, seats: list[dict], before: set[str], keep_raw: bool,
                 timeout_min: int, recovered: bool, skipped: dict | None = None) -> dict:
    state = load_state()
    state.setdefault("tried", {})
    files = Files()
    c = L.connect()
    root = L.registry_root(c)
    skipped = skipped or {}
    results = []
    for s in seats:
        out = (s["dir"] / "stdout.txt").read_text(encoding="utf-8", errors="replace")
        err = (s["dir"] / "stderr.txt").read_text(encoding="utf-8", errors="replace")
        r = read_seat(s["name"], s["dir"], out)
        s["session"] = s["session"] or r["session"]
        claim, d = s["claim"], s["dossier"]
        exit_code = s["proc"].returncode if s.get("proc") is not None else None
        limited = seat_limited(out, err, exit_code, r["answer"])
        row = {"round": n, "ts": L.now(), "provider": s["name"], "model": s["model"], "subject": claim["subject"],
               "domain": d["domain"], "category": d["category"], "pairs_offered": len(d["pairs"]),
               "techniques": len(d["techniques"]), "wall_s": s["wall_s"], "exit": exit_code,
               "timed_out": s["timed_out"], "usage": r["usage"], "seat_error": r["error"],
               "read_nothing": r.get("read_nothing")}
        lost = recovered and not s["timed_out"] and r["answer"] is None and not limited
        if lost:
            # The driver died with it; nothing here is the seat's verdict. Give the subject back.
            L.release(c, claim, f"curator-multi: {s['name']} seat lost when the round's driver died")
            if claim["lane"] == "queue":
                c.execute("UPDATE curator_request SET state='cancelled', settled_at=?, outcome=? "
                          "WHERE id=? AND state IN ('queued','dispatched')",
                          (L.now(), "seat lost with the round's driver; subject returned", claim["request_id"]))
            state["tried"].pop(claim["subject"], None)
            row.update(outcome="lost", accepted=0, returned=0)
        elif limited:
            L.release(c, claim, f"curator-multi: {s['name']} hit its usage limit; progress thrown away")
            if claim["lane"] == "queue":  # her queue must not keep a request nobody will run
                c.execute("UPDATE curator_request SET state='cancelled', settled_at=?, outcome=? WHERE id=? AND state='queued'",
                          (L.now(), f"{s['name']} hit its usage limit; dropped from --multi", claim["request_id"]))
                state["tried"].pop(claim["subject"], None)
            state["dropped"][s["name"]] = {"round": n, "at": L.now(), "why": "usage limit: " + " ".join((err or out)[-240:].split())}
            row.update(outcome="dropped-limit", accepted=0, returned=0)
        else:
            v = validate(r["answer"], d, files, r.get("read_nothing"))
            row.update(returned=v["returned"], accepted=len(v["pairs"]), declined=len(v["declined"]),
                       repairs=v["repairs"], rejections=v["rejections"][:12],
                       states={st: sum(1 for p in v["pairs"] if p["state"] == st) for st in VERDICTS[:3]})
            if v["pairs"] or v["declined"]:
                rel = write_run_file(claim, d, v, s)
                row["run"] = pathlib.PurePosixPath(rel).name
                merge = L.merge_runs(root, only=[pathlib.PurePosixPath(rel).name])
                action, evidence = L.judge_conform(merge, pathlib.PurePosixPath(rel).name, limited=False,
                                                   timed_out=s["timed_out"], exit_code=exit_code,
                                                   out_tail="", tmp_left=False, timeout_min=timeout_min)
                if action == "retry-merge":
                    merge = L.merge_runs(root, only=[pathlib.PurePosixPath(rel).name], wait_ms=L.MERGE_WAIT_MS)
                    action, evidence = L.judge_conform(merge, pathlib.PurePosixPath(rel).name, limited=False,
                                                       timed_out=False, exit_code=0, out_tail="", tmp_left=False,
                                                       timeout_min=timeout_min)
                    if action == "retry-merge":
                        action, evidence = "blocked", "the merge lock stayed held; run file left for `loop.py merge`"
            else:
                why = r["error"] or ("timed out" if s["timed_out"] else "no usable answer")
                action, evidence = "blocked", f"no verdict survived: {why}; {'; '.join(v['rejections'][:3])}"
            evidence = f"[{s['name']}:{s['model']}] {evidence}"
            action = action if action in L.TERMINAL_ITEM else "blocked"
            L.settle(c, claim, L.REQUEST_STATE[action] if claim["lane"] == "queue" else action, evidence)
            row.update(outcome=action, evidence=evidence[:500],
                       sample=[{"context": p["context"], "state": p["state"], "evidence": p["evidence"][:300]}
                               for p in v["pairs"][:3]])
        row["cleaned_sessions"] = clean_provider_sessions(s)
        results.append(row)
        with open(MULTI_DIR / "scoreboard.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(row, default=str) + "\n")
    c.close()

    # Cleanup: the raw round dir, and provider junk that appeared in the repo during the round.
    new = sorted(repo_untracked() - before)
    removed, left = [], []
    for p in new:
        if p.startswith(L.CONFORM_RUNS_REL.as_posix()):
            continue  # the merger's own files
        if STRAY_OK.search(p):
            try:
                (L.PERSONAS_ROOT / p).unlink()
                removed.append(p)
            except OSError:
                left.append(p)
        else:
            left.append(p)
    for top in {pathlib.PurePosixPath(p).parts[0] for p in removed}:
        tp = L.PERSONAS_ROOT / top
        if tp.is_dir() and not any(tp.rglob("*")):
            shutil.rmtree(tp, ignore_errors=True)
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


def _take_merge_lock(wait_s: int = 120) -> pathlib.Path:
    lock = L.PERSONAS_ROOT / L.CONFORM_RUNS_REL / ".merge.lock"
    end = time.time() + wait_s
    while True:
        try:
            fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps({"pid": os.getpid(), "at": L.now(), "by": "curator-multi withdraw"}))
            return lock
        except FileExistsError:
            if time.time() > end:
                L.die("the merge lock stayed held; nothing withdrawn")
            time.sleep(1)


def start_detached(a: argparse.Namespace) -> dict:
    """Launch `multi round` as a process no Claude Code shell owns.

    Measured 2026-10-12: Claude Code's low-memory reaper killed the background shell running a
    round, and the round's driver with it; the seats finished with nobody to settle them. A
    detached driver survives the reap; the session only watches `rounds/<n>.json` appear.
    """
    pending = unfinished_round()
    if pending is not None:
        return {"ok": False, "error": f"round {pending} never finished: run `multi finish` first"}
    argv = [sys.executable, str(pathlib.Path(L.__file__)), "multi", "round", "--providers", a.providers,
            "--timeout-min", str(a.timeout_min)]
    if a.terminal_owns:
        argv.append("--terminal-owns")
    if a.keep_raw:
        argv.append("--keep-raw")
    flags = 0
    if sys.platform == "win32":
        flags = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                 | getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0x01000000) | subprocess.CREATE_NO_WINDOW)
    log = open(MULTI_DIR / "round.out", "w", encoding="utf-8")
    try:
        proc = subprocess.Popen(argv, cwd=str(L.PERSONAS_ROOT), stdout=log, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, creationflags=flags, close_fds=True)
    except OSError:  # a job that forbids breakaway: start without it, still detached
        flags &= ~0x01000000
        proc = subprocess.Popen(argv, cwd=str(L.PERSONAS_ROOT), stdout=log, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, creationflags=flags, close_fds=True)
    n = load_state().get("rounds", 0) + 1
    return {"ok": True, "pid": proc.pid, "round": n, "log": str(MULTI_DIR / "round.out"),
            "summary_will_be": str(MULTI_DIR / "rounds" / f"{n}.json")}


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
    sdir = pathlib.Path(seat["dir"])
    r = read_seat(provider, sdir, (sdir / "stdout.txt").read_text(encoding="utf-8", errors="replace"))
    v = validate(r["answer"], seat["dossier"], Files(), r.get("read_nothing"))
    if not v["pairs"]:
        return {"ok": True, "landed": 0, "rejections": v["rejections"]}
    claim = dict(seat["claim"])
    claim["dispatch_id"] = f"{claim['dispatch_id']}-rv"
    rel = write_run_file(claim, seat["dossier"], v, seat)
    name = pathlib.PurePosixPath(rel).name
    c = L.connect()
    merge = L.merge_runs(L.registry_root(c), only=[name])
    action, evidence = L.judge_conform(merge, name, limited=False, timed_out=False, exit_code=0, out_tail="",
                                       tmp_left=False, timeout_min=0)
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


def withdraw(run_name: str, contexts: list[str], reason: str) -> dict:
    """Undo verdicts one run file put in the map, under the merger's lock.

    The merger has no withdraw and `--reapply` re-folds its archive, so this changes all three
    places at once: the map row goes back to the verdict it replaced (from conform-detail's
    `superseded`, else `unknown`), the detail records the withdrawal, and the archived run
    file moves the pair to `declined` so a later --reapply cannot bring it back. A row a later
    run has already overwritten is left alone and reported.
    """
    worker = pathlib.PurePosixPath(run_name).stem
    arch = L.PERSONAS_ROOT / L.CONFORM_RUNS_REL / "merged" / run_name
    if not arch.exists():
        L.die(f"no archived run file {arch}")
    lock = _take_merge_lock()
    try:
        run = _json(arch)
        rmap = _json(L.PERSONAS_ROOT / L.MAP_REL)
        detail = _json(L.PERSONAS_ROOT / DETAIL_REL)
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
            _dump(L.PERSONAS_ROOT / L.MAP_REL, rmap)
            _dump(L.PERSONAS_ROOT / DETAIL_REL, detail)
            _dump(arch, run)
        return {"ok": True, "withdrawn": done, "left": left}
    finally:
        lock.unlink(missing_ok=True)


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
        for key in (("provider", r["provider"]), ("provider×category", f"{r['provider']} | {r.get('category')}")):
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


def main(a: argparse.Namespace) -> int:
    MULTI_DIR.mkdir(parents=True, exist_ok=True)
    if a.multi_cmd == "round":
        out = run_round(a)
    elif a.multi_cmd == "revalidate":
        if not (a.round and a.provider and a.why):
            L.die("revalidate needs --round <n> --provider <name> --why <the validator defect>")
        out = revalidate(a.round, a.provider, a.why)
    elif a.multi_cmd == "start":
        out = start_detached(a)
    elif a.multi_cmd == "finish":
        out = finish_round()
    elif a.multi_cmd == "clean":
        out = clean_raw()
    elif a.multi_cmd == "report":
        out = report()
    elif a.multi_cmd == "withdraw":
        if not (a.run and a.contexts and a.why):
            L.die("withdraw needs --run <file.json> --contexts a,b --why <reason>")
        out = withdraw(a.run, [x.strip() for x in a.contexts.split(",")], a.why)
    elif a.multi_cmd == "reset-dropped":
        s = load_state()
        s["dropped"] = {}
        save_state(s)
        out = {"ok": True, "dropped": {}}
    else:
        out = {"ok": True, "state": load_state(), "providers": {p: {"binary": bin_of(p), **PROVIDERS[p]} for p in PROVIDERS}}
    print(json.dumps(out, indent=2, default=str))
    return 0
