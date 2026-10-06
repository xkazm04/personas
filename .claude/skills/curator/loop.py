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

* **One worker at a time.** The app holds a fleet with a worker cap; this has a
  terminal. `--workers` is not offered because two children writing one registry
  checkout is the single-writer violation harvest's own law names.
* **No fleet session.** `curator_dispatch.session_id` carries `cli:<uuid>`, so a
  reader can tell which driver started a run. The Gaps drawer's "no dispatch row"
  case is about the inverse and is unaffected.
* **This script settles its own work.** In the app the reconcile sleep does it.
  Here there is no sleep, so each pass settles before it takes the next item;
  an abandoned pass is `release`d rather than left claimed forever.

Usage:
    loop.py status                 what the ladder would do next, and what stops her
    loop.py gaps                   impediments, attrition and growth (read-only)
    loop.py next                   decide AND claim the next piece of work -> JSON
    loop.py release --claim <json> put an unstarted claim back
    loop.py settle  --claim <json> --state <s> --evidence <text>
    loop.py work    --claim <json> [--timeout-min N]   spawn the worker, wait, report
    loop.py commits --claim <json> --since <sha>       record what it committed
    loop.py growth                 take one growth sample from the instruments
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from typing import NoReturn

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
        out.append(
            "\nYou are running inside the consumer repository, not the registry. Write verdicts "
            "to `.ai/registry-map.json` only and change no other file. Do NOT commit, push, "
            "stash, or touch any file you did not write; the operator reads the diff and "
            "commits it."
        )
    else:
        out.append("\n" + authorization())
    out.append(
        "\n\nRun the skill named on the first line and nothing else. If the skill's own "
        "instrument reports that there is no work, say so and stop - a pass that honestly found "
        "nothing is a result and is recorded as one."
    )
    return "".join(out)


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
) -> dict | None:
    """Decide AND claim, in the app's own order. `None` = nothing to take.

    The claim is a compare-and-set inside an IMMEDIATE transaction, so if the app
    is running too, whichever driver gets there first wins and the other reads
    zero affected rows.
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
                    "limit resets", "hit your")


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
    claude = shutil.which("claude") or shutil.which("claude.cmd")
    if not claude:
        die("no `claude` on PATH - this skill drives the CLI and cannot run without it")
    env = {k: v for k, v in os.environ.items()
           if k not in SUBSCRIPTION_RESERVED_ENV and k not in CLAUDE_NESTING_ENV}
    env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
    # 0 = wait for background tasks indefinitely. The default 600 s ceiling killed a
    # `harvest auto` mid fan-out (6 of 7 lanes returned, edit uncommitted); the work
    # timeout (--timeout-min) is the real bound.
    env["CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS"] = "0"
    argv = [claude, "--print", "--dangerously-skip-permissions", claim["brief"]]
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
    screen = f"{out}\n{err}".lower()
    limited = any(s in screen for s in LIMIT_SIGNATURES)
    print(json.dumps({
        "ok": code == 0 and not limited,
        "exit": code,
        "usage_limited": limited,
        "stdout_tail": out[-4000:],
        "stderr_tail": err[-2000:],
    }, indent=2))
    return 0


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
    a = ap.parse_args()

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
        claim = take_next(c, root, skills, dry=a.dry, lanes=lanes, plan_engines=plan_engines)
        if claim and not claim.get("declined") and not a.dry:
            claim["head"] = claim.get("head") or git_head(root)
            claim["dispatch_id"] = record_dispatch(c, claim, root)
            claim["brief"] = compose(claim)
            claim["cwd"] = claim.get("cwd") or str(root)
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
