#!/usr/bin/env python
"""Curator's loop, driven from a terminal instead of from the Personas app.

The app's tick (`src-tauri/src/commands/curator/tick.rs`) and this script are two
drivers of ONE ledger. Everything here writes the same tables the app writes and
takes the same claims, so a run driven from the CLI shows up on the Blueprint,
in the Gaps drawer and in her commit history exactly as an in-app run does. That
is the whole point: not a second Curator, a second steering wheel.

What is deliberately the SAME as the app:

* **The ladder.** Operator queue, then her plan, then the method lane, then the
  standing lane's two rungs. Mirrored from `tick.rs::choose_work`.
* **The claim.** `UPDATE ... WHERE id = ? AND state = 'planned'` inside an
  IMMEDIATE transaction, and the affected-row count is the only evidence it
  held. If the app is also running, whichever driver claims first wins and the
  other sees zero rows - which is a real answer, not a lost race.
* **The refusal to invent an invocation.** A skill whose `SKILL.md` documents no
  `## Invocation` block has `runs_bare = None`, and None is unknown, not "runs
  bare". Her own lanes may never dispatch one.
* **The worker.** A headless `claude -p` child in the registry checkout, with the
  subscription-auth and nesting env stripped exactly as `fleet/headless.rs` does.

What is deliberately DIFFERENT, and said out loud rather than papered over:

* **Parallel for `conform` only.** `run-pool` runs several workers at once, but
  only `conform` workers run beside each other: each writes ONE run file,
  `.ai/conform-runs/<dispatch-id>.json`, in this repo and never the map, and the
  registry's `merge-conform-runs.mjs` is the single writer that folds run files
  into `.ai/registry-map.json` under a lock. Every lane that writes the REGISTRY
  checkout (deepen, apply, reconcile, the queue, method and standing lanes) has
  ONE slot, because two children writing one checkout is the single-writer
  violation harvest's own law names. No two running workers share a subject.
* **No fleet session.** `curator_dispatch.session_id` carries `cli:<uuid>`, so a
  reader can tell which driver started a run. The Gaps drawer's "no dispatch row"
  case is about the inverse and is unaffected.
* **This script settles its own work.** In the app the reconcile sleep does it.
  Here there is no sleep, so each pass settles before it takes the next item;
  an abandoned pass is `release`d rather than left claimed forever, and
  `release-stranded` releases one whose worker process is provably gone.

Usage:
    loop.py status                 what the ladder would do next, and what stops her
    loop.py gaps                   impediments, attrition and growth (read-only)
    loop.py next                   decide AND claim the next piece of work -> JSON
    loop.py release --claim <json> put an unstarted claim back
    loop.py release-stranded [--dispatch <id>] [--dry]   release claims whose worker is dead
    loop.py settle  --claim <json> --state <s> --evidence <text>
    loop.py work    --claim <json> [--timeout-min N]   spawn the worker, wait, report
    loop.py merge   [--only <file.json>] [--reapply] [--dry]   fold conform run files into the map
    loop.py run-pool [--max N] [--dry | --stop | --status]  N workers, RAM-scaled, until a brake
    loop.py commits --claim <json> --since <sha>       record what it committed
    loop.py growth                 take one growth sample from the instruments
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
import sqlite3
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import NoReturn

try:  # pid liveness with a creation time, and free memory; `run-pool` refuses without it
    import psutil
except ImportError:  # pragma: no cover - degrade, never pretend
    psutil = None

# --------------------------------------------------------------------------
# Where things are
# --------------------------------------------------------------------------

APPDATA = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
DB = pathlib.Path(APPDATA) / "com.personas.desktop" / "personas.db"

# The two env families the app strips before spawning a child Claude, for two
# different reasons. Copied from `engine/src/cli_process.rs` and
# `commands/fleet/pty.rs` - a child that inherits either one is a child on the
# wrong account, or a child that thinks it is a nested session and drops its
# persistence.
SUBSCRIPTION_RESERVED_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL")
CLAUDE_NESTING_ENV = (
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_EFFORT",
)

# `standing.rs`: a section must be able to furnish a batch of this many rows
# before the drain is the honest rung.
MIN_BATCH = 4
QUEUE_REL = pathlib.Path("librarian") / "harvest" / "queue.md"

# The engines her plan can turn into a command, and the skill that answers each.
# Mirrors `dispatch.rs::PLAN_ROUTES` - two, and the list is short because the
# honest answer is short.
PLAN_ROUTES = {"reconcile": "reconcile", "deepen": "deepen", "apply": "intake", "conform": "conform"}
# Engines whose argument is DERIVED at claim time rather than read off the item: the
# item carries a COUNT of techniques (apply) or no project (conform), and the command
# needs a name. Derivation can come back empty, and then the item is skipped, not
# dispatched with a guess.
DERIVED_ROUTES = {"apply", "conform"}
PERSONAS_ROOT = pathlib.Path(__file__).resolve().parents[3]
# Every engine and the skill that WOULD answer it, whether or not a command can
# be written today. Mirrors `impediment.rs::ENGINE_SKILL`.
ENGINE_SKILL = {
    "reconcile": "reconcile",
    "deepen": "deepen",
    "intake": "intake",
    "apply": "intake",
    "conform": "conform",
    "forge": "forge",
}

AUTHORIZED_BY = "Operator (xkazm04)"
AUTHORIZED_ON = "2026-09-24"
METHOD_AUTHORIZED_ON = "2026-09-26"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def die(msg: str) -> NoReturn:
    print(json.dumps({"ok": False, "error": msg}, indent=2))
    sys.exit(1)


def connect(readonly: bool = False) -> sqlite3.Connection:
    if not DB.exists():
        die(f"no Personas database at {DB} - this machine has no Curator to drive")
    uri = f"file:{DB}?mode=ro" if readonly else f"file:{DB}"
    c = sqlite3.connect(uri, uri=True, timeout=15, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout = 15000")
    return c


def setting(c: sqlite3.Connection, key: str) -> str | None:
    try:
        row = c.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    except sqlite3.Error:
        return None
    if not row:
        return None
    v = (row["value"] or "").strip()
    return v or None


def registry_root(c: sqlite3.Connection) -> pathlib.Path:
    """The registry she curates, resolved the way the app resolves it.

    `dev_registries` joined to a workspace, first row whose `clone_path` is a
    real directory on this disk. A path that is configured but absent is not a
    registry, which is the same reading `companions::curator_registry` takes.
    """
    rows = c.execute(
        "SELECT r.clone_path FROM dev_registries r "
        "JOIN dev_workspace_registries l ON l.registry_id = r.id"
    ).fetchall()
    for r in rows:
        p = pathlib.Path((r["clone_path"] or "").strip())
        if str(p) and p.is_dir():
            return p
    die("Curator has no registry on this disk: map one in Dev Tools > Workspaces")


# --------------------------------------------------------------------------
# The registry's own skill lane - what may be invoked at all
# --------------------------------------------------------------------------

INVOCATION_HEAD = re.compile(r"^#{1,6}\s*invocation", re.I)


def read_skills(root: pathlib.Path) -> dict[str, dict]:
    """Every skill on the registry's two lanes, and what its file documents.

    `runs_bare` is `None` when the file documents NO invocation - unknown, which
    is not the same as "runs bare" and is never permission. This is the whole
    reason the app refuses to dispatch `forge`, and the CLI must refuse
    identically or the two drivers disagree about what is allowed.
    """
    out: dict[str, dict] = {}
    for lane in (".claude/skills", "skills"):
        base = root / lane
        if not base.is_dir():
            continue
        for d in sorted(p for p in base.iterdir() if p.is_dir()):
            f = next((d / n for n in ("SKILL.md", "skill.md") if (d / n).exists()), None)
            if not f:
                continue
            raw = f.read_text(encoding="utf-8", errors="replace")
            lines = raw.splitlines()
            start = next((i for i, l in enumerate(lines) if INVOCATION_HEAD.match(l.strip())), None)
            found: list[str] = []
            documented = start is not None
            if documented:
                in_fence = False
                for l in lines[start + 1 :]:
                    t = l.lstrip()
                    fence = t.startswith("```") or t.startswith("~~~")
                    if not in_fence:
                        if fence:
                            in_fence = True
                        elif t.startswith("#"):
                            break
                        continue
                    if fence:
                        break
                    if t.startswith(f"/{d.name}"):
                        found.append(t)
                documented = bool(found)
            out.setdefault(
                d.name,
                {
                    "lane": "native" if lane.startswith(".claude") else "shared",
                    "path": str(f.relative_to(root)).replace("\\", "/"),
                    "documented": documented,
                    "runs_bare": (any(l.strip() == f"/{d.name}" for l in found) if documented else None),
                },
            )
    return out


def vet_autonomous(skills: dict, name: str, argument: str | None) -> str | None:
    """Refuse an invocation she would be INVENTING. `None` = allowed."""
    s = skills.get(name)
    if not s:
        return f"the registry has no skill called '{name}'"
    if s["runs_bare"] is None:
        return (
            f"'{name}' documents no invocation, so there is no command to run - "
            "only an explicit request from the operator may name it"
        )
    if s["runs_bare"] is False and not argument:
        return f"'{name}' documents no bare invocation, so it needs an argument"
    return None


# --------------------------------------------------------------------------
# The brakes
# --------------------------------------------------------------------------


def quiet_now(window: str | None) -> bool:
    """`22:00-07:00` in LOCAL time; a window that starts after it ends wraps."""
    if not window or "-" not in window:
        return False
    try:
        a, b = (x.strip() for x in window.split("-", 1))
        ah, am = (int(x) for x in a.split(":"))
        bh, bm = (int(x) for x in b.split(":"))
    except ValueError:
        return False
    n = datetime.now()
    cur, start, end = n.hour * 60 + n.minute, ah * 60 + am, bh * 60 + bm
    return (start <= cur < end) if start <= end else (cur >= start or cur < end)


def brakes(c: sqlite3.Connection) -> dict:
    """Every reason she would not start more work right now.

    **There is deliberately no budget brake.** The operator has declared no daily
    ceiling on purpose: the loop runs until the subscription's usage limit ends
    it. A cap read as `0` would be a ceiling nobody set, so an unset cap stays
    `None` here and is reported as "no ceiling declared".
    """
    enabled = (setting(c, "curator_enabled") or "").lower() in ("1", "true", "yes", "on")
    quiet = setting(c, "curator_quiet_hours")
    backpressure = int(setting(c, "curator_backpressure_n") or 8)
    # `status = 'awaiting'`, exactly as `repos::curator::awaiting_decisions` reads
    # it. An `answered_at IS NULL` guess looked right and named a column that
    # does not exist, which SQLite reports at query time rather than at review.
    awaiting = (
        c.execute("SELECT COUNT(id) n FROM curator_decision WHERE status = 'awaiting'").fetchone()["n"]
        if table_exists(c, "curator_decision")
        else 0
    )
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    runs_today = c.execute(
        "SELECT COUNT(*) n FROM curator_dispatch WHERE substr(created_at,1,10) = ?", (today,)
    ).fetchone()["n"]

    held: list[str] = []
    if not enabled:
        held.append("curator_enabled is off - the operator has not switched her on")
    if quiet_now(quiet):
        held.append(f"inside her quiet hours ({quiet})")
    if awaiting >= backpressure:
        held.append(f"{awaiting} decisions awaiting a person (backpressure {backpressure})")
    return {
        "enabled": enabled,
        "quiet_hours": quiet,
        "in_quiet_hours": quiet_now(quiet),
        "awaiting_decisions": awaiting,
        "backpressure_n": backpressure,
        "runs_today": runs_today,
        "daily_budget_usd": setting(c, "curator_daily_budget_usd"),
        "daily_run_cap": setting(c, "curator_daily_run_cap"),
        "daily_commit_cap": setting(c, "curator_daily_commit_cap"),
        "held_by": held,
        "may_start": not held,
    }


def table_exists(c: sqlite3.Connection, name: str) -> bool:
    return bool(
        c.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
    )


# --------------------------------------------------------------------------
# The standing lane
# --------------------------------------------------------------------------


def harvest_lane(root: pathlib.Path) -> dict:
    """`queue.md` as it stands: per-section queued rows, and a byte fingerprint.

    **Reads the STATUS COLUMN, which is the last cell of each row.** The first
    version scanned the whole line for `mined:`/`parked` tokens and counted every
    remaining `|` line as queued - including each section's own header row. With
    ten sections that over-counted by exactly ten: it reported 267 queued against
    a real 257, and named the section `software-engineering / core (57)` when only
    51 of those 57 rows were queued.

    A dispatched worker caught it, recounted, and refused to admit a batch on
    numbers it could not reproduce - which is the behaviour the brief asks for and
    the reason the count travels in the brief at all. The fix is this function;
    the worker was right.

    The fingerprint is over the whole file, exactly as the app's is, so the two
    drivers' marks stay comparable.
    """
    f = root / QUEUE_REL
    if not f.exists():
        return {"exists": False, "queued": 0, "rows": 0, "sections": [], "fingerprint": None}
    import hashlib

    raw = f.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    sections: list[dict] = []
    cur = None
    for line in text.splitlines():
        if line.startswith("## "):
            # The heading carries its own total in parentheses and that total
            # counts EVERY row, not the queued ones. Kept for display, stripped
            # from the name the brief quotes, so no reader confuses the two again.
            name = line[3:].strip()
            cur = {"name": re.sub(r"\s*\(\d+\)\s*$", "", name), "heading": name,
                   "rows": 0, "queued": 0}
            sections.append(cur)
            continue
        if cur is None or not line.lstrip().startswith("|"):
            continue
        cells = [x.strip() for x in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        if set(cells[0]) <= set("-: "):
            continue                      # the |---|---| rule
        if cells[0].lower() == "id":
            continue                      # the header row - this is the +10
        cur["rows"] += 1
        if cells[-1].lower().startswith("queued"):
            cur["queued"] += 1
    return {
        "exists": True,
        "queued": sum(s["queued"] for s in sections),
        "rows": sum(s["rows"] for s in sections),
        "sections": sections,
        "fingerprint": hashlib.sha256(raw).hexdigest()[:8],
    }


def standing_rung(lane: dict, drain_mark: str | None, refill_mark: str | None) -> dict | None:
    """Drain, refill, or neither. Mirrors `standing.rs::standing_rung`.

    `None` is not idling by choice: it is both rungs having been run against
    exactly these bytes and neither having moved them, which is the one state
    where another dispatch is a charge with a known-zero return.
    """
    fp = lane.get("fingerprint")
    if not fp:
        return None
    best = max(lane["sections"], key=lambda s: s["queued"], default=None)
    thin = None
    if not best or best["queued"] == 0:
        thin = "not one row in the queue is still queued"
    elif best["queued"] < MIN_BATCH:
        thin = (
            f"{lane['queued']} rows are queued but no section can furnish a batch of "
            f"{MIN_BATCH}; the fullest is '{best['name']}' with {best['queued']}"
        )

    if thin is None and drain_mark != fp:
        return {
            "rung": "drain",
            "argument": "auto",
            "because": (
                f"{lane['queued']} of {lane['rows']} rows are queued; the fullest section "
                f"'{best['name']}' has {best['queued']} queued of its {best['rows']}"
            ),
            "mark": fp,
            "mark_key": "curator_harvest_drain_mark",
        }
    if refill_mark == fp:
        return None
    return {
        "rung": "refill",
        "argument": "research",
        "because": thin
        or f"{lane['queued']} rows are queued but the last drain left the file byte-identical",
        "mark": fp,
        "mark_key": "curator_harvest_refill_mark",
    }


# --------------------------------------------------------------------------
# Impediments - what her plan cannot dispatch, and whose fix it is
# --------------------------------------------------------------------------


ITEM_LACKS = {
    "intake": "the finding is a citation that DIED; /intake needs a replacement source the item does not carry",
    "apply": "/intake apply needs a technique's NAME; the item carries a technique COUNT",
    "conform": "/conform judges a CONSUMER repo; the item names no project",
    "forge": "/forge creates a subject that does not exist yet; a plan item is always about one that does",
}


def impediments(c: sqlite3.Connection, skills: dict) -> list[dict]:
    """Ranked by what closing each would FREE, then by what it holds.

    `blocks` and `frees` are different numbers whenever two things are missing at
    once - measured 2026-09-26, `conform` holds 99 plan items and frees none of
    them, because documenting its invocation still leaves an item that cannot
    carry the project that invocation needs.
    """
    rows = c.execute(
        "SELECT engine, COUNT(*) n FROM curator_plan_item "
        " WHERE plan_run_id = (SELECT id FROM curator_plan_run WHERE superseded_by IS NULL)"
        "   AND state = 'planned' GROUP BY engine"
    ).fetchall()
    out = []
    for r in rows:
        engine, n = r["engine"], r["n"]
        skill = ENGINE_SKILL.get(engine)
        if not skill:
            continue  # `none` - nothing was recognised; a matcher finding, not work
        derivable = engine in PLAN_ROUTES
        if derivable and vet_autonomous(skills, skill, "probe") is None:
            continue  # she can dispatch it; not an impediment
        s = skills.get(skill)
        if not s:
            kind, self_fix, why = "skill_missing", False, f"the registry has no skill called '{skill}'"
        elif s["runs_bare"] is None:
            kind, self_fix = "undocumented_invocation", True
            why = f"'{skill}' documents no invocation: its SKILL.md has no `## Invocation` block"
        else:
            lacks = ITEM_LACKS.get(engine)
            if not lacks:
                continue
            kind, self_fix, why = "item_lacks_argument", False, f"'{skill}' documents an invocation, but {lacks}"
        out.append(
            {
                "id": f"{kind}:{skill}",
                "kind": kind,
                "engine": engine,
                "skill": skill,
                "blocks": n,
                "frees": n if derivable else 0,
                "file": s["path"] if s else None,
                "summary": why,
                "self_fixable": self_fix,
            }
        )
    out.sort(key=lambda i: (-i["frees"], -i["blocks"], not i["self_fixable"], i["id"]))
    return out


# --------------------------------------------------------------------------
# The brief a worker is given
# --------------------------------------------------------------------------


def authorization() -> str:
    return (
        f"STANDING AUTHORIZATION - {AUTHORIZED_BY}, {AUTHORIZED_ON}, for Curator's dispatched "
        "runs only.\n"
        "You may commit, merge and push to the default branch of this checkout and of any "
        "project this run touches, without asking. The fleet has one owner and the "
        "repositories' own gates are the guard. This OVERRIDES the \"never push\" / \"open a "
        "pull request instead\" line in the skill file you are about to run - that line is the "
        "safe default for a human running it by hand, and it has not been edited, so read it as "
        "still binding for every invocation except this one.\n"
        "It does NOT cover, and nothing in this run may do: `--no-verify`, `LEFTHOOK=0`, "
        "`HUSKY=0`, any `*_SKIP_GATE`, or force-pushing a default branch - a gate that blocks is "
        "an answer; discarding uncommitted changes anywhere; touching a worktree under "
        "`AppData/Roaming/com.personas.desktop/worktrees/`, which the Personas app owns; "
        "resolving or dismissing a secret-scanning alert, which is a human act.\n"
        "Every commit you make here is read back from this checkout's git log and recorded "
        f"against {AUTHORIZED_BY}'s ledger, so commit normally and do not rewrite history you "
        "did not create in this run."
    )


def method_authorization() -> str:
    return (
        f"METHOD AUTHORIZATION - {AUTHORIZED_BY}, {METHOD_AUTHORIZED_ON}. This run edits the "
        "registry's own METHOD files - a SKILL.md, not a subject - because a gap in one is what "
        "is blocking her plan.\n"
        "What this covers: writing down an invocation the file's own prose ALREADY implies, "
        "bumping its `version:`, and appending the lesson that records why. That is the whole "
        "grant.\n"
        "What it does NOT cover: inventing a mode the file does not describe; changing what the "
        "skill DOES; editing any rule, limit or anti-pattern; deleting anything. If the honest "
        "answer is that the file describes no invocation because its author had not decided on "
        "one, say exactly that and stop - an undocumented skill is a better outcome than a "
        "documented fiction. It also does not cover the Personas application source at any path."
    )


def declared_domains() -> set[str] | None:
    """The bundles this repo consumes: `knowledge.domains` in `.ai/manifest.yaml`.

    `None` means UNKNOWN (no manifest, no such key, unreadable) and the caller must
    not filter on it - an absent declaration is not an empty one. The manifest's
    flow-list shape is read with a regex so the driver stays stdlib-only.
    """
    try:
        text = (PERSONAS_ROOT / ".ai" / "manifest.yaml").read_text(encoding="utf-8")
    except OSError:
        return None
    m = re.search(r"^knowledge:\s*\n(?:[ \t]+.*\n)*?[ \t]+domains:\s*\[([^\]]*)\]", text, re.M)
    if not m:
        return None
    names = {d.strip().strip("'\"") for d in m.group(1).split(",")}
    names.discard("")
    return names or None


def derive_plan_argument(row, root: pathlib.Path) -> tuple[str, str | None] | None:
    """(argument, cwd override) for an engine whose item cannot carry its own, else None.

    `apply`: `/intake apply <technique>` wants a NAME. The first technique in the
    subject's own index entry that has no application row is the one that still needs
    applying; when every technique has one there is nothing to apply and the item is
    skipped rather than sent with an invented name.
    `conform`: `/conform --subject <slug>` judges that subject's pairs wherever the
    consumer's registry map lists them. The consumer is THIS repo (it owns
    `.ai/registry-map.json`), so the worker runs here, not in the registry.
    """
    slug = row["subject_id"].split("/")[-1]
    if row["engine"] == "conform":
        # The scan ranks a subject with no knowledge of which bundles THIS repo
        # consumes, so a bundle it never declared still scores. Measured 2026-10-05:
        # `recruiting/candidate-consent-and-retention` idled because the manifest's
        # `knowledge.domains` omits recruiting and `scope.does_not` excludes it.
        declared = declared_domains()
        if declared is not None and row["domain"] not in declared:
            return None
        return f"--subject {slug}", str(PERSONAS_ROOT)
    index = root / "knowledge" / row["domain"] / "index.json"
    try:
        entry = json.loads(index.read_text(encoding="utf-8"))["subjects"][slug]
    except (OSError, ValueError, KeyError):
        return None
    applied = {a.get("technique") for a in entry.get("applications", [])}
    for t in entry.get("techniques", []):
        if t["slug"] not in applied:
            return f"apply {t['slug']}", None
    return None


def compose(claim: dict) -> str:
    lane = claim["lane"]
    out = []
    if lane == "method":
        imp = claim["impediment"]
        out.append(
            "You are a worker Curator dispatched from a terminal session. She is the companion "
            "who keeps this knowledge registry world-class and applied.\n\n"
            "Lane: her METHOD lane. She is not asking you to do registry work; she is asking you "
            "to repair the instruction that stops her doing it.\n"
        )
        out.append(
            f"\nWhat is blocking her, measured from her standing plan at dispatch:\n"
            f"- skill: {imp['skill']}\n- file: {imp.get('file') or '(none)'}\n"
            f"- it holds: {imp['blocks']} ranked plan item(s)\n"
            f"- closing it releases: {imp['frees']} of them\n"
            f"- what is missing: {imp['summary']}\n"
        )
        out.append(
            "\nRecount that before you write anything. If the file already documents an "
            "invocation, the finding is about her projection rather than about this file, and "
            "saying so is the result. Do not add a heading to make a number go down.\n\n"
            "If it is genuinely missing: read the WHOLE file first and write only the invocation "
            "its prose already describes; match the house shape of the lane's other skills (a "
            "fenced block under `## Invocation`); say which forms deliberately do NOT exist and "
            "why; bump `version:`; append to the skill's LESSONS.md in that file's own format if "
            "one exists; commit that file and nothing else. Other sessions write this checkout: "
            "stage by pathspec, never `git add -A`, and never stash work that is not yours.\n"
        )
        out.append("\n" + authorization() + "\n\n" + method_authorization())
        out.append(
            "\n\nOne file, one gap, one commit. If you find a second thing wrong with the file, "
            "write it in your report rather than fixing it."
        )
        return "".join(out)

    head = f"/{claim['skill']}"
    if claim.get("argument"):
        head += f" {claim['argument']}"
    out.append(head + "\n\n")
    out.append(
        "You are a worker Curator dispatched from a terminal session. She is the companion who "
        "keeps this knowledge registry world-class and applied, and she is running unattended.\n\n"
        f"Lane: {claim['lane_sentence']}\n"
    )
    if claim.get("head"):
        out.append(f"Registry HEAD at dispatch: {claim['head']}\n")
    if claim.get("subject"):
        out.append(f"Subject: {claim['subject']}\n")
    if claim.get("finding"):
        out.append(f"The finding that ranked it: {claim['finding']}\n")
    if claim.get("measurement"):
        out.append(
            f"What was measured before dispatching you: {claim['measurement']}. Recount it - if "
            "the queue says otherwise, say so and stop; a contradiction backed by evidence is the "
            "result this lane most needs.\n"
        )
    if claim.get("note"):
        out.append(f"\nThe operator wrote, verbatim:\n{claim['note']}\n")
    if claim["skill"] == "conform":
        # Runs in the CONSUMER repo (Personas), whose own rules forbid pushing and whose
        # working tree other sessions share, so the registry-side authorization is replaced.
        out.append("\n" + conform_run_protocol(claim))
    else:
        out.append("\n" + authorization())
    out.append(
        "\n\nRun the skill named on the first line and nothing else. If the skill's own "
        "instrument reports that there is no work, say so and stop - a pass that honestly found "
        "nothing is a result and is recorded as one."
    )
    return "".join(out)


CONFORM_RUNS_REL = pathlib.Path(".ai") / "conform-runs"


def conform_run_file(claim: dict) -> str:
    """The ONE file a conform worker writes, relative to this repo. Named by the
    dispatch id, so two workers can never be handed the same path."""
    return (CONFORM_RUNS_REL / f"{claim.get('dispatch_id') or claim['session_id'].split(':')[-1]}.json").as_posix()


def conform_run_protocol(claim: dict) -> str:
    """What a conform worker writes instead of the map: the merger's input contract.

    Every conform worker gets this, alone or in a pool. A worker that edits
    `.ai/registry-map.json` in place races every sibling judging another subject
    in the same checkout, so the map has exactly one writer: the registry's
    `scripts/merge-conform-runs.mjs`, which takes a lock and folds run files in
    newest-verdict-wins.
    """
    rel = conform_run_file(claim)
    worker = pathlib.PurePosixPath(rel).stem
    return (
        "You are running inside the consumer repository, not the registry, and other conform "
        "workers may be judging other subjects in this same checkout at the same time. So you "
        "do NOT edit `.ai/registry-map.json`. Write every verdict to ONE run file, "
        f"`{rel}`, and a single merger folds it into the map under a lock after you exit. "
        f"Write it whole to `{rel}.tmp` first and rename it to `{rel}` when it is complete: a "
        "half-written file is treated as no result. Its shape is the merger's contract:\n\n"
        "```json\n"
        f'{{"schema": "conform-run/1", "worker": "{worker}", "subject": "<slug>",\n'
        ' "evaluatedAt": "<ISO-8601 UTC timestamp of when you finished judging>",\n'
        ' "pairs": [{"context": "<the context id from the map>", "subject": "<slug>", '
        '"bundle": "<bundle>",\n'
        '            "state": "conformant | deviation | not-applicable | unknown",\n'
        '            "evidence": "<path>:<line> <consequence> - one line, the path as git ls-files prints it",\n'
        '            "techniques": [{"technique": "<slug>", "verdict": "...", "evidence": "<path>:<line> ..."}],\n'
        '            "registryProposal": "<optional: a finding about the registry>"}],\n'
        ' "declined": [{"subject": "<slug>", "context": "<context id>", "reason": "<why it is left unjudged>"}],\n'
        ' "consults": [<each object step 5 would append to .ai/consults.jsonl>]}\n'
        "```\n\n"
        "That one file replaces every other write in the skill's steps 4 and 5: do not append to "
        "`.ai/consults.jsonl` (the merger appends your `consults`), do not write the step-5 "
        "run-result file (this file is the result), and do not add a pair (name a missing "
        "pairing in `registryProposal`). Change no other file. Do NOT commit, push, stash, or "
        "touch any file you did not write."
    )


LANE_SENTENCE = {
    "queue": "the operator's own request queue, which she drains before her own plan",
    "plan": "her projection of the registry's own attention scan",
    "refill": "her standing lane over the registry's source queue",
    "method": "her method lane",
}


# --------------------------------------------------------------------------
# The ladder
# --------------------------------------------------------------------------


def take_next(
    c: sqlite3.Connection,
    root: pathlib.Path,
    skills: dict,
    dry: bool,
    lanes: set[str] | None = None,
    plan_engines: set[str] | None = None,
    exclude_subjects: set[str] | None = None,
) -> dict | None:
    """Decide AND claim, in the app's own order. `None` = nothing to take.

    The claim is a compare-and-set inside an IMMEDIATE transaction, so if the app
    is running too, whichever driver gets there first wins and the other reads
    zero affected rows.

    `exclude_subjects` skips plan items whose subject a running worker already
    holds - the pool's "never two workers on one subject" rule. Like the lane
    filter it only SKIPS; the next item down is taken, never a reordered one.
    """
    stamp = now()
    # `None` means every lane, which is the loop's normal shape. A filter never
    # REORDERS the ladder - it only skips rungs - so a restricted run still takes
    # the operator's queue before her plan.
    want = (lambda name: lanes is None or name in lanes)

    # 1. The operator's queue, oldest first, always.
    row = c.execute(
        "SELECT * FROM curator_request WHERE state = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1"
    ).fetchone()
    if row and want("queue"):
        why = vet_autonomous(skills, row["skill"], row["argument"])
        # The operator's lane may name an undocumented skill - a request IS an
        # explicit invocation somebody typed - so only a MISSING skill refuses.
        if why and "documents no invocation" not in why:
            if not dry:
                c.execute(
                    "UPDATE curator_request SET state='declined', settled_at=?, failure_reason=? "
                    "WHERE id=? AND state='queued'",
                    (stamp, why, row["id"]),
                )
            return {"lane": "queue", "declined": why, "request_id": row["id"]}
        session = f"cli:{uuid.uuid4()}"
        if not dry:
            n = c.execute(
                "UPDATE curator_request SET state='dispatched', started_at=?, session_id=? "
                "WHERE id=? AND state='queued'",
                (stamp, session, row["id"]),
            ).rowcount
            if n != 1:
                return None  # another driver took it between the read and the claim
        return {
            "lane": "queue",
            "lane_sentence": LANE_SENTENCE["queue"],
            "request_id": row["id"],
            "session_id": session,
            "skill": row["skill"],
            "argument": row["argument"],
            "note": row["note"],
        }

    # 2. Her own plan.
    engines = [e for e, s in PLAN_ROUTES.items() if vet_autonomous(skills, s, "probe") is None]
    # Like `lanes`, a filter only SKIPS plan items; it never reorders the ladder.
    if plan_engines is not None:
        engines = [e for e in engines if e in plan_engines]
    if engines and want("plan"):
        ph = ",".join("?" for _ in engines)
        rows = c.execute(
            f"SELECT i.* FROM curator_plan_item i JOIN curator_plan_run r ON r.id = i.plan_run_id "
            f" WHERE r.superseded_by IS NULL AND i.state='planned' AND i.suppressed_by_saturation=0 "
            f"   AND i.engine IN ({ph}) ORDER BY i.points DESC, i.subject_id ASC",
            engines,
        ).fetchall()
        row, derived = None, None
        for cand in rows:
            if exclude_subjects and cand["subject_id"] in exclude_subjects:
                continue  # a running worker holds this subject
            if cand["engine"] in DERIVED_ROUTES:
                derived = derive_plan_argument(cand, root)
                if derived is None:
                    continue  # nothing derivable: leave it planned, never guess
            row = cand
            break
        if row:
            session = f"cli:{uuid.uuid4()}"
            if not dry:
                n = c.execute(
                    "UPDATE curator_plan_item SET state='dispatched', updated_at=?, "
                    "dispatched_run_id=? WHERE id=? AND state='planned'",
                    (stamp, session, row["id"]),
                ).rowcount
                if n != 1:
                    return None
            reasons = json.loads(row["reasons_json"] or "[]")
            finding = reasons[0].get("detail") if reasons and isinstance(reasons[0], dict) else None
            # `reconcile` takes the bundle; `deepen` takes the subject ADDRESS,
            # which is the item's own id and is never rebuilt from its parts.
            arg = row["domain"] if row["engine"] == "reconcile" else row["subject_id"]
            out = {
                "lane": "plan",
                "lane_sentence": LANE_SENTENCE["plan"],
                "item_id": row["id"],
                "session_id": session,
                "skill": PLAN_ROUTES[row["engine"]],
                "argument": arg,
                "subject": row["subject_id"],
                "finding": finding,
            }
            if derived:
                out["argument"], cwd = derived
                if cwd:
                    out["cwd"] = cwd
            return out

    # 3. The method lane - widen what she can dispatch. Eligibility is what an
    #    impediment HOLDS; the rank is what closing it would free.
    head = git_head(root)
    if head and want("method"):
        mark = setting(c, "curator_method_mark")
        for imp in impediments(c, skills):
            if not imp["self_fixable"] or imp["blocks"] == 0:
                continue
            if mark == f"{imp['id']}@{head}":
                break  # already attempted against exactly this corpus
            return {
                "lane": "method",
                "lane_sentence": LANE_SENTENCE["method"],
                "session_id": f"cli:{uuid.uuid4()}",
                "skill": None,
                "argument": None,
                "impediment": imp,
                "head": head,
                "mark_key": "curator_method_mark",
                "mark": f"{imp['id']}@{head}",
            }

    # 4. The standing lane's two rungs.
    if not want("refill"):
        return None
    lane = harvest_lane(root)
    rung = standing_rung(lane, setting(c, "curator_harvest_drain_mark"), setting(c, "curator_harvest_refill_mark"))
    if rung:
        why = vet_autonomous(skills, "harvest", rung["argument"])
        if why:
            return {"lane": "refill", "declined": why}
        return {
            "lane": "refill",
            "lane_sentence": LANE_SENTENCE["refill"],
            "session_id": f"cli:{uuid.uuid4()}",
            "skill": "harvest",
            "argument": rung["argument"],
            "measurement": rung["because"],
            "head": head,
            "mark_key": rung["mark_key"],
            "mark": rung["mark"],
        }
    return None


def corpus_freshness(root: pathlib.Path, fetch: bool = False) -> dict:
    """How far the checkout the plan was ranked from is from its own origin.

    **The single most expensive thing this loop can get wrong.** Measured
    2026-09-28 on the first live run: the registry's local `main` was 242 commits
    behind `origin/main`, so every projection was ranked from a corpus two
    hundred commits stale, and subjects that upstream runs had already deepened
    kept scoring as needing attention. The day's 43 dispatches settled 39
    `blocked` and 2 `idled` for 1 commit - a ~2% yield, every pass paid for in
    full. A worker diagnosed it from inside; nothing in the loop was looking.

    `behind`/`ahead` are `None` when there is no upstream or git could not answer
    - unknown, which is not zero and must not read as "fresh".
    """
    out: dict = {"behind": None, "ahead": None, "upstream": None, "fetched": False}
    try:
        up = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
            capture_output=True, text=True, timeout=30,
        )
        if up.returncode != 0 or not up.stdout.strip():
            return out
        out["upstream"] = up.stdout.strip()
        if fetch:
            subprocess.run(["git", "-C", str(root), "fetch", "--quiet"],
                           capture_output=True, text=True, timeout=180)
            out["fetched"] = True
        counts = subprocess.run(
            ["git", "-C", str(root), "rev-list", "--left-right", "--count", "@{u}...HEAD"],
            capture_output=True, text=True, timeout=60,
        )
        if counts.returncode == 0:
            parts = counts.stdout.split()
            if len(parts) == 2:
                out["behind"], out["ahead"] = int(parts[0]), int(parts[1])
    except Exception:
        pass
    return out


# Above this many commits behind, a projection is ranked from a corpus so stale
# that a dispatch is near-certain to rediscover work already done upstream. Not a
# hard stop - `next --allow-stale` proceeds - because an unreachable origin must
# not make the loop unusable.
STALE_CORPUS_BEHIND = 50


def projection_freshness(c: sqlite3.Connection, root: pathlib.Path) -> dict:
    """Whether her standing plan was projected from the checkout as it stands.

    **The SECOND staleness axis, and it is not the corpus one.** A checkout can be
    perfectly in step with origin while the plan ranked from it is hundreds of
    commits old, because a projection is a snapshot the app wrote at a moment. Both
    have to be fresh before the plan lane is worth a dispatch, and conflating them
    is how a merge looked like a fix: measured 2026-09-28, merging brought the
    checkout to 0 behind while the standing plan was still the one projected at
    `bd295204`, 256 commits earlier.

    `behind` is `None` when either sha is unknown - never `0`, which would read as
    "projected from exactly this commit".
    """
    row = c.execute(
        "SELECT id, registry_head_sha, created_at FROM curator_plan_run "
        " WHERE superseded_by IS NULL"
    ).fetchone()
    head = git_head(root)
    out = {
        "plan_run": row["id"][:8] if row else None,
        "projected_at": row["registry_head_sha"] if row else None,
        "projected_when": row["created_at"] if row else None,
        "head": head,
        "behind": None,
        "matches_head": None,
    }
    if not row or not row["registry_head_sha"] or not head:
        return out
    out["matches_head"] = row["registry_head_sha"].startswith(head) or head.startswith(
        row["registry_head_sha"]
    )
    if out["matches_head"]:
        out["behind"] = 0
        return out
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "rev-list", "--count",
             f"{row['registry_head_sha']}..HEAD"],
            capture_output=True, text=True, timeout=60,
        )
        if r.returncode == 0 and r.stdout.strip().isdigit():
            out["behind"] = int(r.stdout.strip())
    except Exception:
        pass
    return out


# Above this many commits between the projection and the checkout, the plan lane
# is ranking subjects from a corpus that has moved under it. Same threshold as
# the corpus brake, for the same reason.
STALE_PROJECTION_BEHIND = 50


def project_binary(root_repo: pathlib.Path) -> pathlib.Path | None:
    """The headless re-projection binary, release preferred over debug."""
    exe = "personas-curator-project" + (".exe" if sys.platform == "win32" else "")
    for profile in ("release", "debug"):
        cand = root_repo / "src-tauri" / "target" / profile / exe
        if cand.exists():
            return cand
    return None


def reproject(repo: pathlib.Path) -> dict:
    """Re-project her plan without the app.

    Runs `personas-curator-project`, which is the app's OWN instrument and
    projection behind a `main` - not a re-implementation. A Python port of the
    1,300-line scoring function would be a second source of truth for the one
    number her whole loop is ranked on, which is the thing not to build.
    """
    exe = project_binary(repo)
    if not exe:
        return {
            "ok": False,
            "error": "personas-curator-project is not built; run: cargo build --release "
                     "-p personas-engine --bin personas-curator-project "
                     "--manifest-path src-tauri/Cargo.toml",
        }
    try:
        # It spawns up to four node processes over the whole registry; eleven
        # seconds cold is normal and a cold cache on a big corpus is slower.
        r = subprocess.run([str(exe)], capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "the re-projection timed out after 15 minutes"}
    try:
        out = json.loads(r.stdout.strip() or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "error": f"unreadable output: {r.stdout[-400:]}",
                "stderr": r.stderr[-400:]}
    if r.stderr.strip():
        # The binary reports unmatched clauses and arithmetic drift on stderr.
        # Carried, not swallowed: a projection missing a clause still lands, and
        # the operator is the one who needs to know the matcher drifted.
        out["notes"] = r.stderr.strip().splitlines()[-12:]
    return out


def app_running() -> bool | None:
    """Whether the Personas app is also driving. `None` when it cannot be told.

    Hoisted out of the session's own shell because the boot ritual needs it every
    time and a hand-rolled process query is one typo from reporting "not running"
    for an app that is.
    """
    try:
        if sys.platform == "win32":
            r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq personas-desktop.exe", "/NH"],
                               capture_output=True, text=True, timeout=30)
            return "personas-desktop" in r.stdout.lower()
        r = subprocess.run(["pgrep", "-f", "personas-desktop"], capture_output=True, text=True, timeout=30)
        return r.returncode == 0
    except Exception:
        return None


def git_head(root: pathlib.Path) -> str | None:
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=30,
        )
        return r.stdout.strip() or None if r.returncode == 0 else None
    except Exception:
        return None


# --------------------------------------------------------------------------
# Bookkeeping - the same rows the app writes
# --------------------------------------------------------------------------


AUTH_LEVEL = {"harvest": "curator_level_research", "intake": "curator_level_research",
              "assay": "curator_level_research", "deepen": "curator_level_research",
              "research": "curator_level_research", "forge": "curator_level_forge",
              "conform": "curator_level_conform"}


def record_dispatch(c: sqlite3.Connection, claim: dict, root: pathlib.Path) -> str:
    level_key = "curator_level_method" if claim["lane"] == "method" else AUTH_LEVEL.get(
        claim.get("skill") or "", "curator_level_sweep"
    )
    level = (setting(c, level_key) or "L0").upper()
    if level not in ("L0", "L1", "L2", "L3"):
        level = "L0"
    did = str(uuid.uuid4())
    c.execute(
        "INSERT INTO curator_dispatch (id, lane, request_id, plan_item_id, session_id, skill, "
        " argument, level_that_authorised, repo_path, head_at_dispatch, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            did, claim["lane"], claim.get("request_id"), claim.get("item_id"), claim["session_id"],
            claim.get("skill") or "method", claim.get("argument"), level, str(root),
            claim.get("head") or git_head(root), now(),
        ),
    )
    return did


# --------------------------------------------------------------------------
# Settling, releasing, and what a run produced
# --------------------------------------------------------------------------

TERMINAL_ITEM = ("landed", "declined", "idled", "blocked")
TERMINAL_REQUEST = ("landed", "declined", "failed", "cancelled")


def close_dispatch(c: sqlite3.Connection, claim: dict) -> None:
    if claim.get("dispatch_id"):
        c.execute(
            "UPDATE curator_dispatch SET settled_at = ? WHERE id = ? AND settled_at IS NULL",
            (now(), claim["dispatch_id"]),
        )


def settle(c: sqlite3.Connection, claim: dict, state: str, evidence: str) -> None:
    """Record the outcome, and close the dispatch row with it.

    In the app the reconcile sleep settles; there is no sleep here, so each pass
    settles before the next is taken. A pass that settled nothing would leave the
    item `dispatched` forever, which is exactly the leak the Gaps drawer counts.
    """
    stamp = now()
    if claim["lane"] in ("queue", "plan") and not state:
        die(f"the {claim['lane']} lane settles a row, so --state is required")
    if claim["lane"] == "queue":
        if state not in TERMINAL_REQUEST:
            die(f"'{state}' is not terminal for a request: {TERMINAL_REQUEST}")
        c.execute(
            "UPDATE curator_request SET state=?, settled_at=?, outcome=? "
            "WHERE id=? AND state='dispatched'",
            (state, stamp, evidence, claim["request_id"]),
        )
    elif claim["lane"] == "plan":
        if state not in TERMINAL_ITEM:
            die(f"'{state}' is not terminal for a plan item: {TERMINAL_ITEM}")
        c.execute(
            "UPDATE curator_plan_item SET state=?, evidence_ref=?, updated_at=? "
            "WHERE id=? AND state IN ('planned','dispatched')",
            (state, evidence, stamp, claim["item_id"]),
        )
    # The standing and method lanes claim no row in THIS database - the registry's
    # own files are the state - so their only settle is the mark, and it is
    # written after the worker ran rather than before, because a rung that never
    # started has not been tried.
    if claim.get("mark_key") and claim.get("mark"):
        c.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (claim["mark_key"], claim["mark"]),
        )
    close_dispatch(c, claim)


def release(c: sqlite3.Connection, claim: dict, why: str) -> None:
    """Put an UNSTARTED claim back, so an aborted pass does not strand it."""
    if claim["lane"] == "queue":
        c.execute(
            "UPDATE curator_request SET state='queued', started_at=NULL, session_id=NULL "
            "WHERE id=? AND state='dispatched'",
            (claim["request_id"],),
        )
    elif claim["lane"] == "plan":
        c.execute(
            "UPDATE curator_plan_item SET state='planned', updated_at=?, dispatched_run_id=NULL "
            "WHERE id=? AND state='dispatched'",
            (now(), claim["item_id"]),
        )
    close_dispatch(c, claim)


def record_commits(c: sqlite3.Connection, claim: dict, root: pathlib.Path, since: str) -> int:
    """Every commit this checkout gained since `since`, recorded as hers.

    **Read the caveat before trusting the number.** The range is `since..HEAD` in
    a checkout other sessions also write, so a commit somebody else landed inside
    the window is credited here too. The app has the same defect and it has been
    observed live. Pass the sha this run actually started from, and prefer a
    narrow window.
    """
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "log", "--format=%H%x1f%an%x1f%s", f"{since}..HEAD"],
            capture_output=True, text=True, timeout=60,
        )
    except Exception:
        return 0
    if r.returncode != 0:
        return 0
    n = 0
    slug = registry_slug(c, root)
    # The branch the commits landed on, as the checkout reports it. NOT NULL in
    # the table, so an unreadable branch is recorded as the literal "(unknown)"
    # rather than left out - the row is evidence about a commit that exists.
    br = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True, text=True, timeout=30,
    )
    branch = br.stdout.strip() if br.returncode == 0 and br.stdout.strip() else "(unknown)"
    for line in r.stdout.splitlines():
        parts = line.split("\x1f")
        if len(parts) < 3:
            continue
        sha = parts[0]
        files = subprocess.run(
            ["git", "-C", str(root), "show", "--name-only", "--format=", sha],
            capture_output=True, text=True, timeout=60,
        ).stdout.split()
        # EVERY not-null column, and the affected-row count as the evidence.
        #
        # The first version named six of the ten columns and counted attempts.
        # `INSERT OR IGNORE` does not raise on a NOT NULL violation - it skips the
        # row - so the insert "succeeded", the counter advanced, and `commits`
        # reported "recorded 3" having written nothing. Twice. The app's own
        # `record_commit` gets this right by returning `written == 1`, which is
        # the shape copied here: a writer that cannot say how many rows it wrote
        # is a writer that will eventually claim work it did not do, and this one
        # feeds `commits_today`, one of her three daily brakes.
        cur = c.execute(
            "INSERT OR IGNORE INTO curator_commit "
            "  (id, project_slug, repo_path, branch, sha, files_json, decision_id,"
            "   level_that_authorised, run_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
            (
                str(uuid.uuid4()),
                slug,
                str(root),
                branch,
                sha,
                json.dumps(files),
                "L0",
                claim.get("session_id"),
                now(),
            ),
        )
        # `OR IGNORE` also absorbs the LEGITIMATE case - this sha is already
        # recorded, because two of her terminals saw overlapping ranges - so a
        # zero here is not necessarily a failure. It is still not a write, and
        # only the rows actually written are reported.
        n += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    return n


def registry_slug(c: sqlite3.Connection, root: pathlib.Path) -> str:
    row = c.execute(
        "SELECT id FROM dev_registries WHERE clone_path = ?", (str(root),)
    ).fetchone()
    return row["id"] if row else str(root)


# --------------------------------------------------------------------------
# Reading what the Gaps drawer reads
# --------------------------------------------------------------------------


def plan_summary(c: sqlite3.Connection) -> dict:
    run = c.execute(
        "SELECT id, created_at, item_count FROM curator_plan_run WHERE superseded_by IS NULL"
    ).fetchone()
    if not run:
        return {"standing": None}
    by_state = {
        r["state"]: r["n"]
        for r in c.execute(
            "SELECT state, COUNT(*) n FROM curator_plan_item WHERE plan_run_id=? GROUP BY state",
            (run["id"],),
        )
    }
    by_engine = {
        r["engine"]: r["n"]
        for r in c.execute(
            "SELECT engine, COUNT(*) n FROM curator_plan_item "
            "WHERE plan_run_id=? AND state='planned' GROUP BY engine",
            (run["id"],),
        )
    }
    return {
        "standing": run["id"][:8],
        "created_at": run["created_at"],
        "items": run["item_count"],
        "by_state": by_state,
        "planned_by_engine": by_engine,
    }


def attrition(c: sqlite3.Connection) -> dict:
    """Her runs in limbo and what they cost - the same figures the drawer shows.

    Read from `fleet_sessions` rather than from the app's in-memory registry,
    because without the app there is no registry to ask. That is a real
    difference and is why the app's own door stays the authority while it runs.
    """
    runs = []
    if table_exists(c, "fleet_sessions"):
        for r in c.execute(
            "SELECT s.id, s.state, s.state_reason, s.created_at_ms, s.last_activity_ms, "
            "       d.lane, d.skill, d.argument, d.settled_at "
            "  FROM fleet_sessions s LEFT JOIN curator_dispatch d ON d.session_id = s.id "
            " WHERE s.origin = 'curator' AND s.state IN ('stale','hibernated') "
            " ORDER BY s.created_at_ms DESC LIMIT 40"
        ):
            quiet = None
            if r["last_activity_ms"]:
                delta = datetime.now(timezone.utc).timestamp() * 1000 - r["last_activity_ms"]
                if delta >= 0:
                    quiet = int(delta // 60000)
            runs.append({
                "session_id": r["id"], "state": r["state"], "reason": r["state_reason"],
                "lane": r["lane"], "skill": r["skill"], "argument": r["argument"],
                "quiet_minutes": quiet, "settled": r["settled_at"] is not None,
            })
    written_off = c.execute(
        "SELECT COUNT(*) n FROM curator_plan_item "
        " WHERE plan_run_id = (SELECT id FROM curator_plan_run WHERE superseded_by IS NULL) "
        "   AND state='blocked' AND dispatched_run_id IS NOT NULL"
    ).fetchone()["n"]
    abandoned = c.execute(
        "SELECT COUNT(*) n FROM curator_dispatch WHERE settled_at IS NULL"
    ).fetchone()["n"]
    return {"runs": runs, "written_off": written_off, "open_dispatches": abandoned,
            "stale_after_secs": 360}


GROWTH_METRICS = ("projects", "judged_pairs", "stale_verdicts", "applied_subjects",
                  "subjects", "techniques", "applications")
HIGHER_IS_BETTER = {m: (m != "stale_verdicts") for m in GROWTH_METRICS}


def growth_reading(c: sqlite3.Connection, window: int = 12) -> dict:
    if not table_exists(c, "curator_growth"):
        return {"samples": 0, "verdict": "unknown", "deltas": []}
    rows = [dict(r) for r in c.execute(
        "SELECT * FROM curator_growth ORDER BY measured_at DESC, id DESC LIMIT ?", (window,)
    )]
    if len(rows) < 2:
        return {"samples": len(rows), "verdict": "unknown", "deltas": [],
                "latest": rows[0] if rows else None}
    now_s, then_s = rows[0], rows[1]
    deltas = []
    for m in GROWTH_METRICS:
        a, b = then_s.get(m), now_s.get(m)
        if a is None or b is None:
            deltas.append({"metric": m, "trend": "unknown", "change": None})
            continue
        if a == b:
            trend = "flat"
        else:
            trend = "grew" if ((b > a) == HIGHER_IS_BETTER[m]) else "shrank"
        deltas.append({"metric": m, "trend": trend, "change": b - a})
    if any(d["trend"] == "shrank" for d in deltas):
        verdict = "shrank"
    elif any(d["trend"] == "grew" for d in deltas):
        verdict = "grew"
    elif any(d["trend"] == "flat" for d in deltas):
        verdict = "flat"
    else:
        verdict = "unknown"
    # Consecutive pairs in which nothing grew. A pair nobody could read BREAKS
    # the streak rather than extending it: an unreadable sample is not evidence
    # of stagnation, and a brake on missing data stops her for nothing.
    streak = 0
    for i in range(len(rows) - 1):
        n2, t2 = rows[i], rows[i + 1]
        grew = known = False
        for m in GROWTH_METRICS:
            a, b = t2.get(m), n2.get(m)
            if a is None or b is None:
                continue
            known = True
            if a != b and ((b > a) == HIGHER_IS_BETTER[m]):
                grew = True
        if grew or not known:
            break
        streak += 1
    return {"samples": len(rows), "verdict": verdict, "deltas": deltas,
            "flat_streak": streak, "latest": now_s, "previous": then_s}


def take_growth(c: sqlite3.Connection, root: pathlib.Path) -> dict:
    """One sample, from the registry's own instruments.

    Runs the same two scripts the app's instrument runs. A script that cannot be
    read leaves its metrics NULL rather than zero: `0` projects is a collapsed
    ecosystem and NULL is a report nobody could read, and this is the one place
    the two could be confused.
    """
    sample = {m: None for m in GROWTH_METRICS}
    node = shutil.which("node")
    if node:
        scan = run_json(node, root, ["scripts/librarian-scan.mjs", "--json"], 240)
        if isinstance(scan, dict):
            subjects = scan.get("subjects") or []
            domains = scan.get("domains") or []
            sample["subjects"] = len(subjects) or None
            sample["techniques"] = sum(d.get("techniques", 0) for d in domains) or None
            sample["applications"] = sum(d.get("applications", 0) for d in domains) or None
        mp = run_json(node, root, ["scripts/build-registry-map.mjs", "--check", "--json"], 300)
        if isinstance(mp, dict):
            t = mp.get("totals") or {}
            sample["projects"] = t.get("projects")
            sample["judged_pairs"] = t.get("evaluated")
            sample["stale_verdicts"] = t.get("staleVerdicts", t.get("stale_verdicts"))
    # Distinct SUBJECTS named in the applied ledger's third column.
    #
    # Parsed as a table, not grepped. A slug-shaped regex over the whole file read
    # 458 of 475 subjects as applied - it was matching doc paths and anything else
    # slug-shaped in the prose, and the number was plausible enough to ship. A
    # metric whose entire purpose is honesty is the worst possible place for a
    # matcher that is approximately right.
    applied = root / "librarian" / "applied.md"
    if applied.exists():
        subs: set[str] = set()
        for line in applied.read_text(encoding="utf-8", errors="replace").splitlines():
            t = line.strip()
            if not t.startswith("|"):
                continue
            cells = [x.strip() for x in t.strip("|").split("|")]
            # A data row leads with a date; the header and its rule do not.
            if len(cells) < 3 or not re.match(r"^\d{4}-\d{2}-\d{2}$", cells[0]):
                continue
            # Slug-shaped only. Not every row keeps the column order - a handful
            # carry `(handoff)`, a bare `-`, or a figure in the subject cell - and
            # counting those inflated the figure by a few percent. Loose in ONE
            # direction only: a real subject is always a lowercase slug, so this
            # can under-count a malformed row but never invents one.
            if re.fullmatch(r"[a-z][a-z0-9-]*", cells[2]):
                subs.add(cells[2])
        sample["applied_subjects"] = len(subs)
    c.execute(
        "INSERT INTO curator_growth (measured_at, projects, judged_pairs, stale_verdicts, "
        " applied_subjects, subjects, techniques, applications) VALUES (?,?,?,?,?,?,?,?)",
        (now(), sample["projects"], sample["judged_pairs"], sample["stale_verdicts"],
         sample["applied_subjects"], sample["subjects"], sample["techniques"], sample["applications"]),
    )
    return sample


def run_json(node: str, cwd: pathlib.Path, args: list[str], timeout: int):
    try:
        r = subprocess.run([node, *args], cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
        return json.loads(r.stdout) if r.stdout.strip() else None
    except Exception:
        return None


# --------------------------------------------------------------------------
# The worker
# --------------------------------------------------------------------------

LIMIT_SIGNATURES = ("usage limit", "session limit", "usage-credits", "limit will reset",
                    "limit resets", "hit your", "limit reached")
# A limit banner is the LAST thing a limited run prints, and a limited run prints little.
# The tail and the length bound exist because a conform worker judging the subject
# `usage-limit-governance` writes "usage limit" all through an honest, finished report.
LIMIT_TAIL_CHARS = 800
LIMIT_MAX_STDOUT = 1500


def usage_limited(out: str, err: str, exit_code: int | None) -> bool:
    """Whether a run ended on the subscription's usage limit, not on its work.

    stderr is read whole; stdout only in its tail, and only when the run failed or
    said almost nothing - a long successful report that MENTIONS a limit is a report.
    """
    if any(s in (err or "").lower() for s in LIMIT_SIGNATURES):
        return True
    out = out or ""
    if exit_code not in (None, 0) or len(out.strip()) < LIMIT_MAX_STDOUT:
        return any(s in out[-LIMIT_TAIL_CHARS:].lower() for s in LIMIT_SIGNATURES)
    return False


def claude_bin() -> str:
    claude = shutil.which("claude") or shutil.which("claude.cmd")
    if not claude:
        die("no `claude` on PATH - this skill drives the CLI and cannot run without it")
    return claude


def worker_env() -> dict:
    """The child's environment: both env families stripped, as `fleet/headless.rs` does."""
    env = {k: v for k, v in os.environ.items()
           if k not in SUBSCRIPTION_RESERVED_ENV and k not in CLAUDE_NESTING_ENV}
    env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
    # 0 = wait for background tasks indefinitely. The default 600 s ceiling killed a
    # `harvest auto` mid fan-out (6 of 7 lanes returned, edit uncommitted); the work
    # timeout (--timeout-min) is the real bound.
    env["CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS"] = "0"
    return env


def run_worker(c: sqlite3.Connection, claim: dict, timeout_min: int) -> int:
    """Spawn one headless `claude` in the registry checkout and wait for it.

    The same shape as `fleet/headless.rs`: `--print`, permissions skipped (the
    worker is unattended and the authorization in its brief is what bounds it),
    cwd the registry, and BOTH env families stripped - the subscription-auth vars
    so it runs on the operator's subscription rather than an API account, and the
    nesting markers so it behaves as a top-level session rather than a child that
    drops its own persistence.

    A usage-limit banner in the output is reported as its own outcome. It is not
    a failure of the work and must not settle the item as blocked: the item goes
    back to `planned` so the next pass, after the limit resets, can take it.
    """
    env = worker_env()
    argv = [claude_bin(), "--print", "--dangerously-skip-permissions", claim["brief"]]
    # `--print` buffers the whole run, so there is no progress until it exits. The
    # pid is printed first and written beside the claim so the driving session can
    # watch the process rather than reconstruct it from a command-line grep - the
    # first live run needed three PowerShell attempts to find its own child.
    pidfile = pathlib.Path(claim.get("pidfile") or "")
    # `claude` writes UTF-8 whatever the console code page is. Bare `text=True`
    # decodes with the locale's (cp1250 on this machine), which first garbled every
    # quote and section sign in the tail and then, on 2026-09-29, raised inside the
    # reader thread on byte 0x98 and left `out` as None - after the worker had
    # landed and pushed three commits the driver could no longer report.
    try:
        proc = subprocess.Popen(argv, cwd=claim["cwd"], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", errors="replace")
    except OSError as e:
        die(f"could not spawn the worker: {e}")
    print(json.dumps({"event": "spawned", "pid": proc.pid, "cwd": claim["cwd"]}), file=sys.stderr)
    if str(pidfile):
        try:
            pidfile.write_text(str(proc.pid), encoding="utf-8")
        except OSError:
            pass
    try:
        out, err = proc.communicate(timeout=timeout_min * 60)
        code = proc.returncode
    except subprocess.TimeoutExpired:
        proc.kill()
        out, err = proc.communicate()
        err = f"{err or ''}\ntimed out after {timeout_min} min"
        code = 124
    out, err = out or "", err or ""
    limited = usage_limited(out, err, code)
    print(json.dumps({
        "ok": code == 0 and not limited,
        "exit": code,
        "usage_limited": limited,
        "stdout_tail": out[-4000:],
        "stderr_tail": err[-2000:],
    }, indent=2))
    return 0


# --------------------------------------------------------------------------
# Memory - how many workers this machine can hold right now
# --------------------------------------------------------------------------

# The method is /appmaster's (`appmaster/lib/memory.mjs` sampleFreeGb, `contract.mjs`
# MEM), so the two loops read one machine the same way: the MEDIAN of five readings of
# AVAILABLE physical memory, 0.6 s apart, so one spike does not flip a decision.
#
# RESERVE_GB     6.0  free memory the pool never spends. It is MEM.gateMinFreeGb, what one
#                     gate run needs (a ~2.6 GB typecheck plus a test run): while this pool
#                     runs, a sibling session can still verify its own work.
# PER_WORKER_GB  2.5  charged per worker. Two live `claude.exe` sessions read 0.27 and 0.83 GB
#                     resident on 2026-10-09; a conform worker adds rg/node children and grows
#                     over a 30-minute read. MEM charges an /appmaster builder 1.5 GB above a
#                     4 GB floor; this is the same order with headroom, and NOT a measurement
#                     of a conform worker - re-measure before tightening it.
# MAX_WORKERS    4    the ceiling memory never sets. The subscription's usage window is the
#                     binding constraint, and four workers spend it four times as fast.
#
# N is a TARGET TOTAL, recomputed from a fresh sample before every claim. A running worker
# has already taken its memory out of `free`, so the formula charges it twice. That is
# deliberate, the same conservatism as MEM's per-builder reserve: a worker that has just
# started has not grown yet, and the next claim must not be admitted against memory the
# last one is about to take.
RESERVE_GB = 6.0
PER_WORKER_GB = 2.5
MAX_WORKERS = 4
MEM_SAMPLES = 5
MEM_SAMPLE_GAP_S = 0.6


def _read_free_bytes() -> int | None:
    if psutil is not None:
        try:
            return int(psutil.virtual_memory().available)
        except Exception:
            return None
    node = shutil.which("node")  # os.freemem() is what /appmaster reads
    if not node:
        return None
    try:
        r = subprocess.run([node, "-e", "process.stdout.write(String(require('os').freemem()))"],
                           capture_output=True, text=True, timeout=20)
        return int(r.stdout.strip())
    except Exception:
        return None


def sample_free_gb(samples: int = MEM_SAMPLES, gap_s: float = MEM_SAMPLE_GAP_S,
                   read=_read_free_bytes, sleep=time.sleep) -> float | None:
    """Median available memory in GB, or None when it cannot be read.

    `CURATOR_FAKE_FREE_GB` overrides the machine (tests, and a dry run that wants to
    show what a smaller machine would do).
    """
    fake = os.environ.get("CURATOR_FAKE_FREE_GB")
    if fake:
        try:
            return float(fake)
        except ValueError:
            pass
    xs: list[float] = []
    for i in range(samples):
        v = read()
        if v is not None:
            xs.append(v / 2 ** 30)
        if i < samples - 1:
            sleep(gap_s)
    if not xs:
        return None
    xs.sort()
    return xs[len(xs) // 2]


def workers_allowed(free_gb: float | None, max_workers: int = MAX_WORKERS,
                    reserve_gb: float = RESERVE_GB, per_worker_gb: float = PER_WORKER_GB) -> int:
    """`min(max, floor((free - reserve) / per_worker))`, never below zero.

    Unreadable memory allows ONE worker - the serial loop this replaced. Unknown is not
    plenty, and refusing every claim on a missing reading would stop her for nothing.
    """
    if max_workers <= 0:
        return 0
    if free_gb is None or math.isnan(free_gb):
        return 1
    return max(0, min(max_workers, math.floor((free_gb - reserve_gb) / per_worker_gb)))


# --------------------------------------------------------------------------
# Processes - liveness by pid AND creation time, never by a row's age
# --------------------------------------------------------------------------

# A process whose image starts with one of these can be a worker: the native `claude.exe`,
# or the npm build under node/bun.
WORKER_IMAGES = ("claude", "node", "bun")


def proc_alive(pid: int | None, create_time: float | None = None, tolerance_s: float = 2.0) -> bool:
    """Whether THIS process still runs. A pid that exists with a different creation time
    is a reused pid, not our worker. Anything that cannot be decided answers alive: a
    wrong "alive" costs a held claim, a wrong "dead" releases a live worker's subject."""
    if not pid:
        return False
    if psutil is None:
        return True
    try:
        p = psutil.Process(int(pid))
        if not p.is_running() or p.status() == psutil.STATUS_ZOMBIE:
            return False
        if create_time is not None and abs(p.create_time() - float(create_time)) > tolerance_s:
            return False
        return True
    except psutil.NoSuchProcess:
        return False
    except Exception:
        return True


def proc_create_time(pid: int) -> float | None:
    try:
        return psutil.Process(pid).create_time() if psutil is not None else None
    except Exception:
        return None


def live_workers_matching(needles: list[str]) -> list[dict]:
    """Live worker-image processes whose command line names any needle.

    A CLI worker carries its whole brief in argv (dispatch id, subject, argument); a
    fleet worker carries `--session-id <claude session>`. Needles under six characters
    are dropped - too short to identify anything.
    """
    needles = [n for n in needles if n and len(n) >= 6]
    if not needles or psutil is None:
        return []
    hits = []
    for p in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            name = (p.info.get("name") or "").lower()
            if not name.startswith(WORKER_IMAGES):
                continue
            cmd = " ".join(p.info.get("cmdline") or [])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        hit = next((n for n in needles if n in cmd), None)
        if hit:
            hits.append({"pid": p.info["pid"], "name": p.info.get("name"), "matched": hit})
    return hits


def kill_tree(pid: int) -> None:
    """End a worker and its children. Called only on a pid whose creation time matched."""
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True, timeout=60)
            return
        if psutil is not None:
            p = psutil.Process(pid)
            for ch in p.children(recursive=True):
                ch.kill()
            p.kill()
    except Exception:
        pass


# --------------------------------------------------------------------------
# The merger - the map's one writer
# --------------------------------------------------------------------------

MERGER_CANDIDATES = (pathlib.Path("scripts") / "merge-conform-runs.mjs",
                     pathlib.Path("scripts") / "experiments" / "merge-conform-runs.mjs")
# How long one merge call waits for another merger's lock. A merge takes about a
# second; two minutes is a stuck holder, and the pool retries on its next tick.
MERGE_WAIT_MS = 120_000
MAP_REL = pathlib.Path(".ai") / "registry-map.json"


def merger_script(registry: pathlib.Path) -> pathlib.Path | None:
    return next((registry / rel for rel in MERGER_CANDIDATES if (registry / rel).exists()), None)


def _is_merger(pid: int) -> bool:
    try:
        return "merge-conform-runs" in " ".join(psutil.Process(pid).cmdline())
    except psutil.NoSuchProcess:
        return False
    except Exception:
        return True


def merge_runs(registry: pathlib.Path, only: list[str] | None = None, reapply: bool = False,
               dry: bool = False, wait_ms: int = MERGE_WAIT_MS, _retry: bool = True) -> dict:
    """Run the registry's merger over THIS repo; its JSON result, plus `exit`."""
    script = merger_script(registry)
    if not script:
        return {"ok": False, "error": f"no merge-conform-runs.mjs under {registry / 'scripts'}"}
    node = shutil.which("node")
    if not node:
        return {"ok": False, "error": "no `node` on PATH - the merger is a node script"}
    argv = [node, str(script), str(PERSONAS_ROOT), "--json", "--wait-lock-ms", str(wait_ms)]
    if only:
        argv += ["--only", ",".join(only)]
    if reapply:
        argv.append("--reapply")
    if dry:
        argv.append("--dry")
    try:
        r = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=wait_ms / 1000 + 300)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "the merger did not finish"}
    try:
        out = json.loads(r.stdout)
    except ValueError:
        out = {"ok": False, "error": f"unreadable merger output (exit {r.returncode}): "
                                     f"{(r.stdout or '')[-300:]} {(r.stderr or '')[-300:]}"}
    out["exit"] = r.returncode
    holder = (out.get("holder") or {}).get("pid") if out.get("contended") else None
    if holder and _retry and psutil is not None and not _is_merger(int(holder)):
        # Alive, but not a merger: a merger died holding the lock and its pid was reused.
        # Re-read before removing, so a lock a NEW merger just took is never the one deleted.
        lock = PERSONAS_ROOT / CONFORM_RUNS_REL / ".merge.lock"
        now_holder = _read_json(lock, {}) or {}
        if now_holder.get("pid") == holder:
            try:
                lock.unlink()
            except OSError:
                pass
        out = merge_runs(registry, only, reapply, dry, wait_ms, _retry=False)
        out["lock_cleared"] = f"pid {holder} held the merge lock but is not a merger"
    return out


def map_digest() -> str | None:
    try:
        return hashlib.sha256((PERSONAS_ROOT / MAP_REL).read_bytes()).hexdigest()
    except OSError:
        return None


# --------------------------------------------------------------------------
# Judging what a pool worker left behind - mechanical, and only on evidence it can read
# --------------------------------------------------------------------------


def judge_conform(merge: dict | None, run_name: str, *, limited: bool, timed_out: bool,
                  exit_code: int | None, out_tail: str, tmp_left: bool, timeout_min: int) -> tuple[str, str]:
    """(action, evidence). Action: a plan-item state, `release`, or `retry-merge`.

    The run file is the worker's verdict and the merger is the reader: a pool never settles
    a conform item from an exit code. `landed` means the merger accepted verdicts, and the
    counts it reports are the evidence.
    """
    if merge is not None:
        if merge.get("contended"):
            h = merge.get("holder") or {}
            return "retry-merge", f"the merge lock is held by live pid {h.get('pid')} since {h.get('at')}"
        if not merge.get("ok"):
            return "blocked", (f"the merger could not run ({merge.get('error')}); the run file is "
                               f"left at {CONFORM_RUNS_REL.as_posix()}/{run_name}")
        f = next((x for x in merge.get("files") or [] if x.get("file") == run_name), None)
        if f is None:
            return "blocked", "the merger did not report this run file"
        st = f.get("status")
        if st == "incomplete":
            return "blocked", "the worker exited and its run file is not valid JSON"
        if st == "not-a-run-file":
            return "blocked", "the run file carries no pairs[] - not the conform-run shape"
        if st in ("skipped", "missing"):
            return "blocked", f"the merger refused the run file: {f.get('note') or st}"
        mine = lambda xs: [s.split(": ", 1)[1] for s in xs or [] if s.startswith(run_name + ": ")]
        counts = (f"{f.get('merged', 0)} merged, {f.get('unchanged', 0)} unchanged, "
                  f"{f.get('older', 0)} older than the map, {f.get('declined', 0)} declined, "
                  f"{f.get('skipped', 0)} below the floor, of {f.get('pairs', 0)} pair verdict(s)")
        if f.get("status") == "already-merged":
            return "landed", f"the run file was already merged; {counts}"
        if f.get("merged", 0) + f.get("unchanged", 0) > 0:
            return "landed", (f"{counts}; states {json.dumps(merge.get('states') or {})}; archived at "
                              f"{CONFORM_RUNS_REL.as_posix()}/merged/{run_name}")
        if f.get("pairs", 0) == 0 and f.get("declined", 0) == 0:
            return "idled", f"the run file judged no pair; the worker's last words: {out_tail}"
        if f.get("skipped", 0) > 0:
            return "declined", f"{counts}; the merger refused: {'; '.join(mine(merge.get('skipped'))[:3])}"
        if f.get("declined", 0) > 0:
            return "declined", f"{counts}; {'; '.join(mine(merge.get('declined'))[:3])}"
        return "idled", f"{counts} - every verdict was older than the one the map holds"
    if limited:
        return "release", "the worker hit the subscription's usage limit before writing a run file"
    if tmp_left:
        return "blocked", "the worker left only a half-written run file (.tmp)"
    if timed_out:
        # The ceiling is a symptom, not a cause: what the worker was doing when it fired is the
        # tell, and nothing else keeps it once the process is gone (fault-signature-catalogue).
        return "blocked", f"timed out after {timeout_min} min with no run file; the worker's last words: {out_tail}"
    return "blocked", f"exit {exit_code}, no run file; the worker's last words: {out_tail}"


def judge_serial(claim: dict, *, commits: int, limited: bool, timed_out: bool,
                 exit_code: int | None, out_tail: str, timeout_min: int) -> tuple[str, str]:
    """(action, evidence) for a lane that writes the registry. Commits are the evidence."""
    if limited and commits == 0:
        return "release", "the worker hit the subscription's usage limit before committing anything"
    if timed_out:
        return "blocked", (f"timed out after {timeout_min} min; {commits} registry commit(s) since dispatch; "
                           f"the worker's last words: {out_tail}")
    if exit_code not in (None, 0):
        return "blocked", f"exit {exit_code}; the worker's last words: {out_tail}"
    if commits > 0:
        return "landed", (f"{commits} registry commit(s) since {claim.get('head')} - the range can include "
                          f"a sibling's commits; the worker's last words: {out_tail}")
    return "idled", f"no registry commit; the worker's last words: {out_tail}"


REQUEST_STATE = {"landed": "landed", "idled": "declined", "declined": "declined", "blocked": "failed"}


def slot_of(claim: dict) -> str:
    """`parallel` only for a conform worker that runs in THIS repo and writes its own run
    file. Everything that writes the registry checkout shares the one `serial` slot."""
    cwd = claim.get("cwd")
    if claim.get("skill") == "conform" and cwd and pathlib.Path(cwd).resolve() == PERSONAS_ROOT:
        return "parallel"
    return "serial"


def admission_filters(lanes: set[str], engines: set[str], serial_busy: bool) -> tuple[set[str], set[str]]:
    """The lanes and engines the NEXT claim may come from. While the serial slot is
    taken, only conform plan items - the one parallel-safe kind - stay admissible."""
    if serial_busy:
        return lanes & {"plan"}, engines & {"conform"}
    return set(lanes), set(engines)


def open_dispatch_subjects(c: sqlite3.Connection) -> set[str]:
    """Subjects any driver (this pool, another terminal, the app) has an open dispatch on."""
    rows = c.execute(
        "SELECT i.subject_id FROM curator_dispatch d JOIN curator_plan_item i ON i.id = d.plan_item_id "
        " WHERE d.settled_at IS NULL"
    ).fetchall()
    return {r["subject_id"] for r in rows if r["subject_id"]}


def claim_one(c: sqlite3.Connection, root: pathlib.Path, skills: dict, lanes: set[str] | None,
              plan_engines: set[str] | None, exclude_subjects: set[str] | None = None) -> dict | None:
    """`next`'s claim and bookkeeping, shared with the pool. A claim whose dispatch row
    cannot be written is released, never left `dispatched` with nothing behind it."""
    claim = take_next(c, root, skills, dry=False, lanes=lanes, plan_engines=plan_engines,
                      exclude_subjects=exclude_subjects)
    if claim and not claim.get("declined"):
        try:
            claim["head"] = claim.get("head") or git_head(root)
            claim["dispatch_id"] = record_dispatch(c, claim, root)
            claim["cwd"] = claim.get("cwd") or str(root)
            claim["brief"] = compose(claim)
        except Exception:
            release(c, claim, "the claim could not be recorded")
            raise
    return claim


# --------------------------------------------------------------------------
# Stranded claims - released only when their worker is provably gone
# --------------------------------------------------------------------------

POOL_DIR = pathlib.Path(os.environ.get("CURATOR_POOL_DIR") or (pathlib.Path.home() / ".personas" / "curator-pool"))


def _read_json(path: pathlib.Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _write_json(path: pathlib.Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    tmp.write_text(json.dumps(obj, indent=2, default=str), encoding="utf-8")
    os.replace(tmp, path)


def pool_holder(pool_dir: pathlib.Path) -> dict | None:
    """The live pool's lock record, or None when no pool runs."""
    h = _read_json(pool_dir / "pool.lock")
    if h and proc_alive(h.get("pid"), h.get("create_time")):
        return h
    return None


def stranded(c: sqlite3.Connection, pool_dir: pathlib.Path, dispatch: str | None = None) -> list[dict]:
    """Every unsettled dispatch, with the evidence for whether its worker still runs.

    **Liveness is a process, never a row's age** (the 2026-09-10 incident: three live
    workers killed because their rows had not moved in nine hours). In order: the pool's
    own record of the worker (pid AND creation time), then any live worker process whose
    command line names the dispatch, its session, the fleet's claude session id, or its
    argument. Only when all of that comes back empty is the worker gone.
    """
    holder = pool_holder(pool_dir)
    q = "SELECT * FROM curator_dispatch WHERE settled_at IS NULL"
    args: tuple = ()
    if dispatch:
        q += " AND id LIKE ?"
        args = (dispatch + "%",)
    out = []
    for d in c.execute(q + " ORDER BY created_at", args).fetchall():
        rec = _read_json(pool_dir / "workers" / f"{d['id']}.json")
        alive, why = False, ""
        if rec and holder:
            alive, why = True, f"owned by the running pool (pid {holder.get('pid')})"
        elif rec and rec.get("pid") and proc_alive(rec["pid"], rec.get("create_time")):
            alive, why = True, f"its worker pid {rec['pid']} is alive"
        else:
            sid = d["session_id"] or ""
            needles = [d["id"], sid, sid.split(":", 1)[-1], d["argument"] or ""]
            if sid and not sid.startswith("cli:") and table_exists(c, "fleet_sessions"):
                row = c.execute("SELECT claude_session_id FROM fleet_sessions WHERE id = ?", (sid,)).fetchone()
                if row and row["claude_session_id"]:
                    needles.append(row["claude_session_id"])
            hits = live_workers_matching(needles)
            if hits:
                alive, why = True, f"live process {hits[0]['pid']} ({hits[0]['name']}) names {hits[0]['matched']!r}"
            else:
                why = ("no pool record with a live pid, and no live claude/node process names its "
                       "dispatch, session or argument")
        item = None
        if d["plan_item_id"]:
            item = c.execute(
                "SELECT i.state, i.subject_id, r.superseded_by FROM curator_plan_item i "
                "JOIN curator_plan_run r ON r.id = i.plan_run_id WHERE i.id = ?", (d["plan_item_id"],)
            ).fetchone()
        out.append({
            "dispatch_id": d["id"], "lane": d["lane"], "skill": d["skill"], "argument": d["argument"],
            "session_id": d["session_id"], "created_at": d["created_at"],
            "plan_item_id": d["plan_item_id"], "request_id": d["request_id"],
            "item_state": item["state"] if item else None,
            "subject": item["subject_id"] if item else None,
            "plan_superseded": bool(item and item["superseded_by"]),
            "alive": alive, "evidence": why,
        })
    return out


# --------------------------------------------------------------------------
# The pool
# --------------------------------------------------------------------------

POOL_POLL_SEC = 15           # how often a running pool looks at its workers
FRESHNESS_EVERY_SEC = 120    # how often it re-measures the projection and corpus axes
LIMIT_DOZE_MIN = 30          # --on-limit doze: minutes between usage-limit probes
MAX_LOOP_ERRORS = 5          # consecutive failed iterations before the pool stops itself
MERGE_RETRY_WAIT_MS = 10_000  # a retried merge waits briefly; the next tick tries again


class Pool:
    """N workers, RAM-scaled; conform in parallel, everything else through one slot.

    State lives OUTSIDE the repo (`~/.personas/curator-pool/`), so a weekend run does not
    dirty a checkout other sessions commit in: `pool.lock`, `pool.jsonl` (every event),
    `workers/<dispatch>.json` + `.out` + `.err` while a worker runs, `done/` after, and
    `STOP`, whose presence ends the pool after its running workers settle.

    Workers are their own process group, so a pool that dies leaves them running; the next
    pool ADOPTS them from `workers/` by pid and creation time, and settles the ones that
    finished meanwhile from the files they left.
    """

    def __init__(self, a: argparse.Namespace, pool_dir: pathlib.Path = POOL_DIR):
        self.a = a
        self.dir = pool_dir
        self.workers_dir = pool_dir / "workers"
        self.done_dir = pool_dir / "done"
        self.running: list[dict] = []
        self.claimed = 0
        self.limit_hit = False
        self.doze_until = 0.0
        self.need_replan = False
        self.fresh_at = 0.0
        self.map_digest = map_digest()
        self.last_hold = None
        self.lanes = {x.strip() for x in a.lane.split(",")} if a.lane else {"plan"}
        self.engines = {x.strip() for x in a.engine.split(",")} if a.engine else {"conform"}

    # ---- bookkeeping
    def log(self, event: str, **kw) -> None:
        rec = {"ts": now(), "event": event, **kw}
        line = json.dumps(rec, default=str)
        print(line, flush=True)
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            with open(self.dir / "pool.jsonl", "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass

    def save(self, w: dict) -> None:
        _write_json(self.workers_dir / f"{w['dispatch_id']}.json", {k: v for k, v in w.items() if k != "popen"})

    def retire(self, w: dict, outcome: dict) -> None:
        self.done_dir.mkdir(parents=True, exist_ok=True)
        rec = {k: v for k, v in w.items() if k != "popen"}
        rec["outcome"] = outcome
        _write_json(self.done_dir / f"{w['dispatch_id']}.json", rec)
        for suffix in (".json", ".out", ".err"):
            src = self.workers_dir / f"{w['dispatch_id']}{suffix}"
            if suffix == ".json":
                src.unlink(missing_ok=True)
            elif src.exists():
                os.replace(src, self.done_dir / src.name)

    def subjects_held(self, c: sqlite3.Connection) -> set[str]:
        return {w["subject"] for w in self.running if w.get("subject")} | open_dispatch_subjects(c)

    # ---- lifecycle
    def take_lock(self) -> dict | None:
        """Exclusive create; a lock whose pid (and creation time) is dead is replaced once."""
        self.dir.mkdir(parents=True, exist_ok=True)
        path = self.dir / "pool.lock"
        body = json.dumps({"pid": os.getpid(), "create_time": proc_create_time(os.getpid()),
                           "started_at": now(), "argv": sys.argv[1:]})
        for _ in range(2):
            try:
                fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(body)
                return None
            except FileExistsError:
                held = pool_holder(self.dir)
                if held:
                    return held
                path.unlink(missing_ok=True)
        return _read_json(path, {}) or {"pid": None, "started_at": "unknown"}

    def drop_lock(self) -> None:
        h = _read_json(self.dir / "pool.lock")
        if h and h.get("pid") == os.getpid():
            (self.dir / "pool.lock").unlink(missing_ok=True)

    def adopt(self, c: sqlite3.Connection) -> None:
        """Pick up workers a previous pool started. Never kills; settles the finished."""
        if not self.workers_dir.exists():
            return
        for f in sorted(self.workers_dir.glob("*.json")):
            w = _read_json(f)
            if not w or not w.get("dispatch_id"):
                continue
            row = c.execute("SELECT settled_at FROM curator_dispatch WHERE id = ?", (w["dispatch_id"],)).fetchone()
            if row is None or row["settled_at"]:
                self.retire(w, {"action": "already-settled", "evidence": "settled outside this pool"})
                continue
            if not w.get("pid"):
                hits = live_workers_matching([w["dispatch_id"]])
                if hits:
                    w["pid"], w["create_time"] = hits[0]["pid"], proc_create_time(hits[0]["pid"])
            w["popen"] = None
            self.running.append(w)
            self.log("adopted", dispatch=w["dispatch_id"], subject=w.get("subject"), pid=w.get("pid"),
                     alive=proc_alive(w.get("pid"), w.get("create_time")))

    # ---- spawning
    def spawn(self, claim: dict) -> None:
        did = claim["dispatch_id"]
        self.workers_dir.mkdir(parents=True, exist_ok=True)
        w = {
            "dispatch_id": did, "claim": claim, "slot": slot_of(claim), "subject": claim.get("subject"),
            "skill": claim.get("skill"), "argument": claim.get("argument"), "lane": claim.get("lane"),
            "pid": None, "create_time": None, "started_at": now(), "started_ts": time.time(),
            "timeout_min": self.a.timeout_min,
            "stdout": str(self.workers_dir / f"{did}.out"), "stderr": str(self.workers_dir / f"{did}.err"),
        }
        self.save(w)
        flags = 0
        if sys.platform == "win32":
            # Its own group: a Ctrl+C or a reaped shell that ends the pool does not end the worker.
            flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        with open(w["stdout"], "w", encoding="utf-8") as fo, open(w["stderr"], "w", encoding="utf-8") as fe:
            proc = subprocess.Popen(
                [claude_bin(), "--print", "--dangerously-skip-permissions", claim["brief"]],
                cwd=claim["cwd"], env=worker_env(), stdin=subprocess.DEVNULL, stdout=fo, stderr=fe,
                creationflags=flags,
            )
        w["pid"], w["create_time"], w["popen"] = proc.pid, proc_create_time(proc.pid), proc
        self.save(w)
        self.running.append(w)
        self.claimed += 1
        self.log("spawned", dispatch=did, slot=w["slot"], subject=w["subject"], skill=w["skill"],
                 argument=w["argument"], pid=proc.pid, running=len(self.running))

    # ---- reaping
    def reap(self, c: sqlite3.Connection, root: pathlib.Path) -> None:
        for w in list(self.running):
            if w.get("merging"):
                self.finish(c, root, w, w.get("exit_code"))
                continue
            popen = w.get("popen")
            ended = popen.poll() is not None if popen else not proc_alive(w.get("pid"), w.get("create_time"))
            timed_out = time.time() - float(w.get("started_ts") or time.time()) > float(w["timeout_min"]) * 60
            if not ended and not timed_out:
                continue
            if not ended:
                kill_tree(int(w["pid"]))
                if popen:
                    try:
                        popen.wait(timeout=60)
                    except subprocess.TimeoutExpired:
                        pass
                w["timed_out"] = True
            w["exit_code"] = popen.returncode if popen else None
            self.finish(c, root, w, w["exit_code"])

    def finish(self, c: sqlite3.Connection, root: pathlib.Path, w: dict, exit_code: int | None) -> None:
        read = lambda p: pathlib.Path(p).read_text(encoding="utf-8", errors="replace") if pathlib.Path(p).exists() else ""
        out, err = read(w["stdout"]), read(w["stderr"])
        limited = usage_limited(out, err, exit_code)
        tail = " ".join(out.strip()[-400:].split()) or " ".join(err.strip()[-300:].split()) or "(no output)"
        claim = w["claim"]
        if w["slot"] == "parallel":
            run_name = f"{w['dispatch_id']}.json"
            run_path = PERSONAS_ROOT / CONFORM_RUNS_REL / run_name
            tmp = run_path.with_name(run_name + ".tmp")
            merge = None
            archived = PERSONAS_ROOT / CONFORM_RUNS_REL / "merged" / run_name
            if not run_path.exists() and archived.exists():
                # A hand-run `loop.py merge` (or the previous pool) folded it in first.
                merge = {"ok": True, "states": {}, "files": [{"file": run_name, "status": "already-merged"}]}
            elif run_path.exists() or w.get("merging"):
                current = map_digest()
                if current != self.map_digest:
                    # Something other than the merger wrote the map since the last merge: a
                    # worker that ignored the run-file protocol, or a sibling session.
                    self.log("map_written_outside_merger", dispatch=w["dispatch_id"])
                merge = merge_runs(root, only=[run_name],
                                   wait_ms=MERGE_RETRY_WAIT_MS if w.get("merging") else MERGE_WAIT_MS)
                if merge.get("ok"):
                    self.map_digest = map_digest()
            action, evidence = judge_conform(
                merge, run_name, limited=limited, timed_out=bool(w.get("timed_out")), exit_code=exit_code,
                out_tail=tail, tmp_left=tmp.exists() and not run_path.exists(), timeout_min=w["timeout_min"])
            if action == "retry-merge":
                if not w.get("merging"):
                    self.log("merge_deferred", dispatch=w["dispatch_id"], why=evidence)
                w["merging"] = True
                self.save(w)
                return  # keeps its slot until the merge lands; nothing is settled unread
            if tmp.exists() and not run_path.exists():
                inc = self.dir / "incomplete"
                inc.mkdir(parents=True, exist_ok=True)
                os.replace(tmp, inc / tmp.name)
        else:
            commits = 0
            head = claim.get("head")
            if head:
                r = subprocess.run(["git", "-C", str(root), "rev-list", "--count", f"{head}..HEAD"],
                                   capture_output=True, text=True, timeout=60)
                commits = int(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip().isdigit() else 0
            action, evidence = judge_serial(claim, commits=commits, limited=limited,
                                            timed_out=bool(w.get("timed_out")), exit_code=exit_code,
                                            out_tail=tail, timeout_min=w["timeout_min"])
            if action == "landed" and head:
                record_commits(c, claim, root, head)
        if action == "release":
            release(c, claim, evidence)
            self.limit_hit = True
            self.doze_until = time.time() + self.a.doze_min * 60
        else:
            state = REQUEST_STATE[action] if claim["lane"] == "queue" else action
            settle(c, claim, state if claim["lane"] in ("queue", "plan") else None, evidence)
        self.running.remove(w)
        self.retire(w, {"action": action, "evidence": evidence, "exit_code": exit_code,
                        "usage_limited": limited, "finished_at": now()})
        self.log("settled", dispatch=w["dispatch_id"], subject=w.get("subject"), action=action,
                 evidence=evidence[:600], running=len(self.running))

    # ---- admission
    def probe_limit(self) -> bool:
        """True while the usage limit still holds. A one-line prompt, no claim, no row.
        Run from the pool's own directory, so the probe loads no project's instructions."""
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            r = subprocess.run([claude_bin(), "--print", "Reply with the single word OK."],
                               cwd=str(self.dir), env=worker_env(), stdin=subprocess.DEVNULL,
                               capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
        except subprocess.TimeoutExpired:
            return True
        return usage_limited(r.stdout or "", r.stderr or "", r.returncode)

    def hold(self, why: str, key: str | None = None) -> None:
        """Log a hold once per KIND of hold. `key` names the kind when `why` carries a
        changing figure: keyed on the text, a memory hold logged every poll as free memory
        moved (seen live on 2026-10-09, a line every 15 s)."""
        key = key or why
        if key != self.last_hold:
            self.log("held", why=why, running=len(self.running))
            self.last_hold = key

    def admit(self, c: sqlite3.Connection, root: pathlib.Path, skills: dict) -> str | None:
        """Claim and spawn at most one worker. Returns a reason to STOP the pool, or None."""
        b = brakes(c)
        if self.a.terminal_owns and not b["enabled"]:
            b["held_by"] = [h for h in b["held_by"] if not h.startswith("curator_enabled")]
        if any(h.startswith("curator_enabled") for h in b["held_by"]):
            return b["held_by"][0] + " (pass --terminal-owns when the operator handed her to this terminal)"
        if b["held_by"]:
            self.hold("; ".join(b["held_by"]))
            return None
        if time.time() - self.fresh_at > FRESHNESS_EVERY_SEC:
            self.fresh_at = time.time()
            if "plan" in self.lanes:
                proj = projection_freshness(c, root)
                if (proj["behind"] or 0) > STALE_PROJECTION_BEHIND:
                    self.need_replan = True
                    self.log("projection_stale", behind=proj["behind"], projected_at=proj["projected_at"])
            fresh = corpus_freshness(root)
            if not self.a.allow_stale and (fresh["behind"] or 0) > STALE_CORPUS_BEHIND:
                return (f"the registry checkout is {fresh['behind']} commits behind {fresh['upstream']}: the "
                        "plan is ranked from a stale corpus - the operator brings it up to date")
        if self.need_replan:
            if self.running:
                self.hold("the projection is stale; draining running workers before re-projecting")
                return None
            self.log("reprojecting")
            out = reproject(PERSONAS_ROOT)
            if not out.get("ok"):
                return f"the re-projection failed: {out.get('error')}"
            self.need_replan = False
            self.log("reprojected", **{k: out.get(k) for k in ("run_id", "items", "changed") if k in out})
            return None
        free = sample_free_gb()
        n = workers_allowed(free, self.a.max)
        if len(self.running) >= n:
            self.hold(f"{len(self.running)} running of {n} allowed ({free if free is None else round(free, 1)} GB free)",
                      key=f"memory:{len(self.running)}/{n}")
            return None
        # The registry checkout has at most one writer: while it does, only parallel-safe work.
        lanes, engines = admission_filters(self.lanes, self.engines,
                                           any(w["slot"] == "serial" for w in self.running))
        if not lanes or not engines:
            self.hold("the serial slot is busy and no parallel-safe lane is enabled")
            return None
        claim = claim_one(c, root, skills, lanes, engines, exclude_subjects=self.subjects_held(c))
        if claim is None:
            if not self.running:
                return "the ladder is empty for the lanes this pool drives"
            self.hold("nothing claimable while the running workers hold their subjects")
            return None
        if claim.get("declined"):
            self.log("declined", lane=claim["lane"], why=claim["declined"])
            return None
        self.last_hold = None
        try:
            self.spawn(claim)
        except Exception as e:  # a claim with no worker behind it goes straight back
            release(c, claim, f"spawn failed: {e}")
            return f"could not spawn a worker: {e}"
        return None

    def run(self) -> int:
        if psutil is None:
            die("run-pool needs psutil (pid liveness with a creation time): pip install psutil")
        claude_bin()
        held = self.take_lock()
        if held:
            die(f"a pool is already running (pid {held.get('pid')}, since {held.get('started_at')})")
        stop_file = self.dir / "STOP"
        if stop_file.exists():
            stop_file.unlink()
            self.log("stale_stop_cleared")
        self.log("started", pid=os.getpid(), max=self.a.max, lanes=sorted(self.lanes), engines=sorted(self.engines),
                 timeout_min=self.a.timeout_min, on_limit=self.a.on_limit, max_items=self.a.max_items)
        stop_reason, errors = None, 0
        try:
            c = connect()
            root = registry_root(c)
            self.adopt(c)
            c.close()
            while True:
                admitted = False
                try:
                    c = connect()
                    try:
                        self.reap(c, root)
                        if stop_reason is None and stop_file.exists():
                            stop_reason = "STOP file"
                        if stop_reason is None and self.a.max_items and self.claimed >= self.a.max_items:
                            stop_reason = f"--max-items {self.a.max_items} claimed"
                        if stop_reason and not self.running:
                            break
                        admitted = False
                        if stop_reason is None and self.limit_hit:
                            if self.a.on_limit == "stop":
                                stop_reason = "the subscription's usage limit"
                            elif not self.running and time.time() >= self.doze_until:
                                if self.probe_limit():
                                    self.doze_until = time.time() + self.a.doze_min * 60
                                    self.log("still_limited", next_probe_in_min=self.a.doze_min)
                                else:
                                    self.limit_hit = False
                                    self.log("limit_lifted")
                            else:
                                self.hold("dozing on the usage limit")
                        elif stop_reason is None:
                            before = self.claimed
                            stop_reason = self.admit(c, root, read_skills(root))
                            admitted = self.claimed > before
                    finally:
                        c.close()
                    errors = 0
                except Exception as e:  # a locked database, a transient OSError: retry, then stop
                    errors += 1
                    self.log("loop_error", error=f"{type(e).__name__}: {e}", consecutive=errors)
                    admitted = False
                    if errors >= MAX_LOOP_ERRORS:
                        stop_reason = stop_reason or f"{errors} consecutive failed iterations: {e}"
                        if not self.running or errors >= MAX_LOOP_ERRORS * 4:
                            break
                if not admitted:
                    time.sleep(self.a.poll_sec)
        except KeyboardInterrupt:
            stop_reason = "interrupted - running workers continue and the next pool adopts them"
        finally:
            self.drop_lock()
        self.log("stopped", reason=stop_reason, claimed=self.claimed, still_running=len(self.running))
        return 0


def pool_status(pool_dir: pathlib.Path) -> dict:
    holder = pool_holder(pool_dir)
    workers = []
    for f in sorted((pool_dir / "workers").glob("*.json")) if (pool_dir / "workers").exists() else []:
        w = _read_json(f) or {}
        if not w.get("dispatch_id"):
            continue
        workers.append({
            "dispatch_id": w["dispatch_id"], "slot": w.get("slot"), "subject": w.get("subject"),
            "pid": w.get("pid"), "alive": proc_alive(w.get("pid"), w.get("create_time")),
            "merging": bool(w.get("merging")),
            "minutes": round((time.time() - float(w.get("started_ts") or time.time())) / 60, 1),
            "timeout_min": w.get("timeout_min"),
        })
    done = sorted((pool_dir / "done").glob("*.json"), key=lambda p: p.stat().st_mtime) if (pool_dir / "done").exists() else []
    recent = []
    for f in done[-10:]:
        d = _read_json(f) or {}
        o = d.get("outcome") or {}
        recent.append({"dispatch_id": d.get("dispatch_id"), "subject": d.get("subject"),
                       "action": o.get("action"), "evidence": (o.get("evidence") or "")[:240]})
    tail = []
    try:
        tail = [json.loads(x) for x in (pool_dir / "pool.jsonl").read_text(encoding="utf-8").splitlines()[-15:]]
    except (OSError, ValueError):
        pass
    return {"ok": True, "pool_dir": str(pool_dir), "pool": holder, "running": holder is not None,
            "stop_requested": (pool_dir / "STOP").exists(), "workers": workers,
            "settled_recent": recent, "log_tail": tail}


def pool_dry(a: argparse.Namespace) -> dict:
    """What `run-pool` would claim right now, in order, without claiming anything."""
    c = connect(readonly=True)
    root = registry_root(c)
    skills = read_skills(root)
    lanes = {x.strip() for x in a.lane.split(",")} if a.lane else {"plan"}
    engines = {x.strip() for x in a.engine.split(",")} if a.engine else {"conform"}
    free = sample_free_gb()
    n = workers_allowed(free, a.max)
    b = brakes(c)
    if a.terminal_owns and not b["enabled"]:
        b["held_by"] = [h for h in b["held_by"] if not h.startswith("curator_enabled")]
        b["waived"] = "curator_enabled (--terminal-owns)"
    proj = projection_freshness(c, root)
    excl = open_dispatch_subjects(c)
    planned, serial_busy = [], False
    for _ in range(min(n, a.max_items) if a.max_items else n):
        ln, en = admission_filters(lanes, engines, serial_busy)
        if not ln or not en:
            break
        claim = take_next(c, root, skills, dry=True, lanes=ln, plan_engines=en, exclude_subjects=excl)
        if not claim or claim.get("declined"):
            if claim:
                planned.append({"declined": claim["declined"], "lane": claim["lane"]})
            break
        claim["cwd"] = claim.get("cwd") or str(root)
        slot = slot_of(claim)
        serial_busy = serial_busy or slot == "serial"
        planned.append({"slot": slot, "lane": claim["lane"], "item_id": claim.get("item_id"),
                        "subject": claim.get("subject"), "skill": claim.get("skill"),
                        "argument": claim.get("argument"), "cwd": claim["cwd"]})
        if claim.get("subject"):
            excl.add(claim["subject"])
    return {
        "ok": True, "dry": True,
        "memory": {"free_gb": None if free is None else round(free, 1), "reserve_gb": RESERVE_GB,
                   "per_worker_gb": PER_WORKER_GB, "max": a.max, "workers_allowed": n,
                   "formula": "min(max, floor((free_gb - reserve_gb) / per_worker_gb))"},
        "lanes": sorted(lanes), "engines": sorted(engines),
        "brakes": {"held_by": b["held_by"], "waived": b.get("waived")},
        "projection": proj,
        "would_reproject_first": (proj["behind"] or 0) > STALE_PROJECTION_BEHIND and "plan" in lanes,
        "subjects_already_held": sorted(open_dispatch_subjects(c)),
        "planned_claims": planned,
        "pool": {"running": pool_holder(POOL_DIR) is not None, "dir": str(POOL_DIR)},
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sub.add_parser("gaps")
    sub.add_parser("growth")
    sub.add_parser("project")
    p = sub.add_parser("next")
    p.add_argument("--dry", action="store_true")
    p.add_argument("--allow-stale", action="store_true", help="dispatch even from a stale corpus")
    p.add_argument("--terminal-owns", action="store_true", help="the operator switched the APP's tick off so this terminal drives her: waive ONLY the curator_enabled brake (quiet hours and backpressure still hold)")
    p.add_argument("--fetch", action="store_true", help="git fetch before measuring the lag")
    p.add_argument("--lane", help="restrict the ladder to these lanes, comma separated "
                                  "(queue,plan,method,refill); the order never changes")
    p.add_argument("--engine", help="restrict the PLAN lane to these engines, comma separated "
                                    "(reconcile,deepen,apply,conform); `conform` runs in this repo "
                                    "and never touches the registry")
    p = sub.add_parser("work")
    p.add_argument("--claim", required=True)
    p.add_argument("--timeout-min", type=int, default=45)
    p.add_argument("--pidfile", help="write the worker pid here so a watcher can find it")
    p = sub.add_parser("settle")
    p.add_argument("--claim", required=True)
    # Only the queue and plan lanes own a row whose state this writes. The
    # standing and method lanes have no row in THIS database - the registry's own
    # files are the state - so requiring a state there forced the caller to
    # invent one that nothing reads, which is a fact waiting to be misread.
    p.add_argument("--state", help="terminal state; required for the queue and plan lanes only")
    p.add_argument("--evidence", required=True)
    p = sub.add_parser("release"); p.add_argument("--claim", required=True); p.add_argument("--why", default="released by the terminal driver")
    p = sub.add_parser("commits"); p.add_argument("--claim", required=True); p.add_argument("--since", required=True)
    p = sub.add_parser("release-stranded", help="release open dispatches whose worker process is provably gone")
    p.add_argument("--dispatch", help="only this dispatch id (a prefix is enough)")
    p.add_argument("--dry", action="store_true", help="report the evidence, release nothing")
    p = sub.add_parser("merge", help="fold conform run files into .ai/registry-map.json (the registry's merger)")
    p.add_argument("--only", help="comma-separated run file names in .ai/conform-runs/")
    p.add_argument("--reapply", action="store_true", help="re-fold the merged/ archive (recovery after a revert)")
    p.add_argument("--dry", action="store_true")
    p = sub.add_parser("run-pool", help="N workers, RAM-scaled: conform in parallel, registry lanes serial")
    p.add_argument("--max", type=int, default=MAX_WORKERS, help=f"worker ceiling (default {MAX_WORKERS}); memory may allow fewer")
    p.add_argument("--lane", help="ladder lanes this pool drives (default: plan)")
    p.add_argument("--engine", help="plan engines this pool drives (default: conform). Any engine but "
                                    "conform runs in the ONE serial slot, because it writes the registry")
    p.add_argument("--terminal-owns", action="store_true", help="waive ONLY the curator_enabled brake, as `next` does")
    p.add_argument("--allow-stale", action="store_true", help="keep claiming from a corpus behind its origin")
    p.add_argument("--timeout-min", type=int, default=45, help="a worker older than this is ended and settled")
    p.add_argument("--max-items", type=int, default=0, help="stop claiming after this many claims (0 = no cap)")
    p.add_argument("--on-limit", choices=("stop", "doze"), default="stop",
                   help="on the usage limit: stop after the running workers settle, or doze and probe")
    p.add_argument("--doze-min", type=int, default=LIMIT_DOZE_MIN, help="minutes between usage-limit probes")
    p.add_argument("--poll-sec", type=int, default=POOL_POLL_SEC)
    g = p.add_mutually_exclusive_group()
    g.add_argument("--dry", action="store_true", help="show what it would claim now, claim nothing")
    g.add_argument("--stop", action="store_true", help="ask a running pool to stop after its workers settle")
    g.add_argument("--status", action="store_true", help="the running pool, its workers, its last events")
    a = ap.parse_args()

    if a.cmd == "run-pool":
        for flag, known, given in (("--lane", LANE_SENTENCE, a.lane), ("--engine", PLAN_ROUTES, a.engine)):
            bad = {x.strip() for x in (given or "").split(",") if x.strip()} - set(known)
            if bad:
                die(f"unknown {flag} value(s): {sorted(bad)}; known: {sorted(known)}")
        if a.status:
            print(json.dumps(pool_status(POOL_DIR), indent=2, default=str))
            return 0
        if a.stop:
            POOL_DIR.mkdir(parents=True, exist_ok=True)
            (POOL_DIR / "STOP").write_text(now(), encoding="utf-8")
            print(json.dumps({"ok": True, "stop_requested": True, "pool": pool_holder(POOL_DIR),
                              "note": "the pool claims nothing more and exits once its running workers settle"}, indent=2))
            return 0
        if a.dry:
            print(json.dumps(pool_dry(a), indent=2, default=str))
            return 0
        if a.lane and "refill" in a.lane and app_running():
            die("the app is running and the standing lane writes the registry's queue file it also writes; "
                "drive --lane queue,plan, or switch her off in the app first")
        return Pool(a).run()

    if a.cmd == "merge":
        c = connect(readonly=True)
        root = registry_root(c)
        only = [x.strip() for x in a.only.split(",") if x.strip()] if a.only else None
        out = merge_runs(root, only=only, reapply=a.reapply, dry=a.dry)
        print(json.dumps(out, indent=2, default=str))
        return 0 if out.get("ok") else 1

    if a.cmd == "release-stranded":
        if psutil is None:
            die("release-stranded needs psutil to prove a worker is gone: pip install psutil")
        c = connect(readonly=a.dry)
        rows = stranded(c, POOL_DIR, a.dispatch)
        released = []
        for r in rows:
            if r["alive"] or a.dry:
                continue
            claim = {"lane": r["lane"], "item_id": r["plan_item_id"], "request_id": r["request_id"],
                     "dispatch_id": r["dispatch_id"]}
            release(c, claim, f"release-stranded: {r['evidence']}")
            r["released"] = True
            released.append(r["dispatch_id"])
        print(json.dumps({"ok": True, "dry": a.dry, "stranded": rows, "released": released}, indent=2, default=str))
        return 0

    if a.cmd in ("status", "gaps"):
        c = connect(readonly=True)
        root = registry_root(c)
        skills = read_skills(root)
        if a.cmd == "gaps":
            print(json.dumps({"ok": True, "registry": str(root),
                              "impediments": impediments(c, skills),
                              "attrition": attrition(c),
                              "growth": growth_reading(c)}, indent=2, default=str))
            return 0
        lane = harvest_lane(root)
        fresh = corpus_freshness(root)
        proj = projection_freshness(c, root)
        print(json.dumps({
            "ok": True, "registry": str(root), "head": git_head(root),
            "corpus": fresh,
            "corpus_is_stale": (fresh["behind"] or 0) > STALE_CORPUS_BEHIND,
            "projection": proj,
            "projection_is_stale": (proj["behind"] or 0) > STALE_PROJECTION_BEHIND,
            "app_running": app_running(),
            "pool_running": pool_holder(POOL_DIR) is not None,
            "brakes": brakes(c),
            "plan": plan_summary(c),
            "queue_file": {k: lane[k] for k in ("exists", "queued", "fingerprint")},
            "next": take_next(c, root, skills, dry=True),
            "lanes": sorted(LANE_SENTENCE),
            "stops_her": "no daily ceiling is declared; the hard stop is the subscription's usage limit",
        }, indent=2, default=str))
        return 0

    c = connect()
    root = registry_root(c)
    skills = read_skills(root)

    if a.cmd == "next":
        b = brakes(c)
        if a.terminal_owns and not b["enabled"]:
            # The flag gates the APP's tick. Switching it off is how the operator hands the
            # standing lane to this terminal, so refusing on it would make that handover
            # impossible. Only this brake is waived, and the waiver is reported.
            b["held_by"] = [h for h in b["held_by"] if not h.startswith("curator_enabled")]
            b["may_start"] = not b["held_by"]
            b["waived"] = "curator_enabled (--terminal-owns)"
        if not b["may_start"] and not a.dry:
            print(json.dumps({"ok": True, "claim": None, "held_by": b["held_by"]}, indent=2))
            return 0
        # The corpus brake. A projection ranked from a checkout hundreds of
        # commits behind its origin sends workers at subjects upstream already
        # handled, and they come back idled having paid full price. Overridable,
        # because an unreachable origin must not make the loop unusable - but
        # never silent, because silence is what made it cost 43 dispatches.
        # The projection axis, checked before the corpus one because it is the
        # one a merge does NOT fix and the one with a remedy this driver owns.
        proj = projection_freshness(c, root)
        wants_plan = not a.lane or "plan" in {x.strip() for x in a.lane.split(",")}
        if (
            not a.dry
            and not a.allow_stale
            and wants_plan
            and (proj["behind"] or 0) > STALE_PROJECTION_BEHIND
        ):
            print(json.dumps({
                "ok": True, "claim": None,
                "held_by": [
                    f"her standing plan was projected at {proj['projected_at']}, "
                    f"{proj['behind']} commits behind this checkout, so the plan lane would rank "
                    "subjects from a corpus that has moved under it - run `loop.py project` "
                    "first, or --lane refill to drive a lane that reads the tree directly"
                ],
                "projection": proj,
            }, indent=2))
            return 0
        fresh = corpus_freshness(root, fetch=a.fetch)
        if not a.dry and not a.allow_stale and (fresh["behind"] or 0) > STALE_CORPUS_BEHIND:
            print(json.dumps({
                "ok": True, "claim": None,
                "held_by": [
                    f"the registry checkout is {fresh['behind']} commits behind "
                    f"{fresh['upstream']} ({fresh['ahead']} ahead), so the plan was ranked from a "
                    "stale corpus - bring it up to date, or pass --allow-stale to proceed anyway"
                ],
                "corpus": fresh,
            }, indent=2))
            return 0
        lanes = {x.strip() for x in a.lane.split(",")} if a.lane else None
        if lanes and not lanes <= set(LANE_SENTENCE):
            die(f"unknown lane(s): {sorted(lanes - set(LANE_SENTENCE))}; known: {sorted(LANE_SENTENCE)}")
        plan_engines = {x.strip() for x in a.engine.split(",")} if a.engine else None
        if plan_engines and not plan_engines <= set(PLAN_ROUTES):
            die(f"unknown engine(s): {sorted(plan_engines - set(PLAN_ROUTES))}; known: {sorted(PLAN_ROUTES)}")
        if a.dry:
            claim = take_next(c, root, skills, dry=True, lanes=lanes, plan_engines=plan_engines)
        else:
            # Subjects another driver (a running pool, the app) holds are skipped, never doubled.
            claim = claim_one(c, root, skills, lanes, plan_engines, exclude_subjects=open_dispatch_subjects(c))
        print(json.dumps({"ok": True, "claim": claim}, indent=2, default=str))
        return 0

    # `growth` takes no claim, so it is answered BEFORE the claim file is read -
    # the ordering bug this line replaces made the one subcommand that needs no
    # argument fail on a missing one.
    if a.cmd == "growth":
        print(json.dumps({"ok": True, "sample": take_growth(c, root)}, indent=2, default=str))
        return 0
    if a.cmd == "project":
        # `parents[3]` from `.claude/skills/curator/loop.py` is the repo root.
        out = reproject(pathlib.Path(__file__).resolve().parents[3])
        print(json.dumps(out, indent=2, default=str))
        return 0 if out.get("ok") else 1

    claim = json.loads(pathlib.Path(a.claim).read_text(encoding="utf-8"))
    # `next` prints `{"ok":…, "claim":{…}}` and every other subcommand wants the
    # claim itself. Unwrapping here rather than making each caller do it: the
    # session had to hand-normalise the file three times in the first live run,
    # which is three chances to hand a half-written file to a settle.
    if isinstance(claim, dict) and "claim" in claim:
        claim = claim["claim"]
    if not isinstance(claim, dict) or "lane" not in claim:
        die(f"{a.claim} does not hold a claim - run `next` and pass the file it wrote")

    if a.cmd == "work":
        if a.pidfile:
            claim["pidfile"] = a.pidfile
        return run_worker(c, claim, a.timeout_min)
    if a.cmd == "settle":
        settle(c, claim, a.state, a.evidence)
        print(json.dumps({"ok": True, "settled": a.state}, indent=2))
        return 0
    if a.cmd == "release":
        release(c, claim, a.why)
        print(json.dumps({"ok": True, "released": True}, indent=2))
        return 0
    if a.cmd == "commits":
        print(json.dumps({"ok": True, "recorded": record_commits(c, claim, root, a.since)}, indent=2))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
