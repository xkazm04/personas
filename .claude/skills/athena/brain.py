#!/usr/bin/env python3
"""Athena terminal-channel brain bridge.

Read/write access to Athena's companion brain (SQLite + markdown on disk) from
OUTSIDE the Personas app, for the Claude Code `/athena` skill. The app being
down stops her tools, not her self: identity, constitution and all memory are
files. Episodes written here are byte-compatible with `brain/episodic.rs`
(`append_episode`), so the app's chat, recall keyword lane, and — the whole
point — the SLEEP CYCLE treat terminal conversation as first-class: the cycle's
`list_conversation_after` is deliberately not session-scoped, so the next cycle
compresses terminal turns into long-term facts exactly like app turns.

Zero dependencies (stdlib only). Safe next to a running app: SQLite WAL +
5s busy timeout, one small transaction per write.

Parity contract (verify against source when upgrading):
  - markdown  episodic.rs:478 format_episode_markdown
  - node row  episodic.rs append_episode INSERT (importance 3, excerpt<=500B)
  - FTS row   (node_id, body=content, tags='session:{sid} role:{role}')
  - ids       ep_{8 hex} / turn_{12 hex}   (util::short_id = uuid4 simple prefix)
  - machine markers episodic.rs:45 — terminal content must never start with one
"""

import argparse, hashlib, json, os, sqlite3, sys, uuid
from datetime import datetime, timezone
from pathlib import Path

# Windows consoles default to cp1252; episode content is arbitrary unicode.
sys.stdout.reconfigure(encoding="utf-8")

APP_DATA = Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming")) / "com.personas.desktop"
DEFAULT_DB = APP_DATA / "personas_data.db"
SESSION_ID = "cli"
MACHINE_MARKERS = ("fleet-event ", "fleet-orchestration ")

# Sleep-pressure constants mirrored from brain/sleep_cycle.rs (display only —
# the app's admission is authoritative; these just label the gauge readout).
PRESSURE_THRESHOLD = 40_000
FLOOR_HOURS = 6


def brain_root() -> Path:
    base = Path(os.environ["PERSONAS_HOME"]) if os.environ.get("PERSONAS_HOME") else Path.home() / ".personas"
    return base / "companion-brain"


def connect(db_path: str):
    con = sqlite3.connect(db_path, timeout=5.0)
    con.execute("PRAGMA busy_timeout = 5000")
    return con


def now_rfc3339() -> str:
    # chrono's to_rfc3339 shape: '2026-08-08T11:56:01.251912500+00:00'.
    # Python gives microseconds; chrono parses that fine.
    return datetime.now(timezone.utc).isoformat()


def short_id(n: int) -> str:
    return uuid.uuid4().hex[:n]


def excerpt_500(s: str) -> str:
    # util::excerpt truncates to <=500 BYTES on a char boundary.
    b = s.encode("utf-8")
    return s if len(b) <= 500 else b[:500].decode("utf-8", errors="ignore")


def fts_quote(term: str) -> str:
    return '"' + term.replace('"', '""') + '"'


def cmd_ensure_session(con):
    now = now_rfc3339()
    con.execute(
        """INSERT OR IGNORE INTO companion_session (id, title, status, origin, created_at, last_active_at)
           VALUES (?, 'Terminal (Claude Code)', 'active', 'cli', ?, ?)""",
        (SESSION_ID, now, now),
    )
    con.execute("UPDATE companion_session SET last_active_at = ? WHERE id = ?", (now, SESSION_ID))
    con.commit()


def cmd_boot(con, args):
    cmd_ensure_session(con)
    root = brain_root()
    out = {
        "brainRoot": str(root),
        "identityPath": str(root / "identity.md"),
        "constitutionPath": str(root / "constitution.md"),
        "session": SESSION_ID,
    }
    out["taxonomy"] = [
        {"tag": t, "definition": d}
        for t, d in con.execute("SELECT tag, definition FROM companion_taxonomy WHERE status='active' ORDER BY tag")
    ]
    out["facts"] = [
        {"scope": s, "key": k, "value": v, "tags": json.loads(tj) if tj else [], "confidence": cf}
        for s, k, v, tj, cf in con.execute(
            """SELECT f.scope, f.fact_key, n.body_excerpt, n.tags_json, f.confidence
               FROM companion_fact f JOIN companion_node n ON n.id = f.id
               WHERE n.importance > 0 ORDER BY f.scope, f.fact_key"""
        )
    ]
    out["procedurals"] = [
        {"trigger": t, "behavior": b}
        for t, b in con.execute(
            """SELECT p.trigger_pattern, n.body_excerpt FROM companion_procedural p
               JOIN companion_node n ON n.id = p.id WHERE n.importance > 0"""
        )
    ]
    out["recentTerminalEpisodes"] = [
        {"role": r, "created": c, "excerpt": e}
        for r, c, e in con.execute(
            """SELECT COALESCE(substr(file_path, instr(file_path, '_') + 1), '?'),
                      created_at, body_excerpt
               FROM companion_node WHERE kind='episode' AND session_id=?
               ORDER BY created_at DESC LIMIT ?""",
            (SESSION_ID, args.recent),
        )
    ][::-1]
    out["lastCycle"] = None
    row = con.execute(
        "SELECT id, finished_at, status, stats_json FROM companion_cycle ORDER BY started_at DESC LIMIT 1"
    ).fetchone()
    if row:
        out["lastCycle"] = {"id": row[0], "finishedAt": row[1], "status": row[2], "stats": json.loads(row[3] or "{}")}
    out["gauge"] = gauge(con)
    print(json.dumps(out, ensure_ascii=False, indent=1))


def gauge(con):
    # Display-only estimate mirroring sleep_cycle::measure (hydrated-body sum is
    # the app's job; the excerpt sum here UNDERSTATES — labelled as such).
    row = con.execute("SELECT finished_at, stats_json FROM companion_cycle WHERE status='completed' ORDER BY started_at DESC LIMIT 1").fetchone()
    boundary = None
    if row:
        boundary = (json.loads(row[1] or "{}")).get("consumed_through") or row[0]
    where_machine = "".join(f" AND body_excerpt NOT LIKE '{m}%'" for m in MACHINE_MARKERS)
    q = f"SELECT COUNT(*), COALESCE(SUM(LENGTH(body_excerpt)),0) FROM companion_node WHERE kind='episode' AND body_excerpt IS NOT NULL{where_machine}"
    p = ()
    if boundary:
        q += " AND created_at > ?"
        p = (boundary,)
    n, chars = con.execute(q, p).fetchone()
    return {
        "episodesWaiting": n,
        "excerptCharsWaiting_UNDERSTATES": chars,
        "thresholdChars": PRESSURE_THRESHOLD,
        "boundary": boundary,
        "note": "app's gauge sums full bodies; this excerpt sum is a floor (~45% of real volume)",
    }


def cmd_gauge(con, args):
    print(json.dumps(gauge(con), ensure_ascii=False, indent=1))


def cmd_recall(con, args):
    match = " ".join(fts_quote(t) for t in args.query.split())
    out = {}
    for kind in ("doctrine", "fact", "procedural", "episode"):
        rows = con.execute(
            """SELECT n.id, n.file_path, n.body_excerpt
               FROM companion_fts f JOIN companion_node n ON n.id = f.node_id
               WHERE companion_fts MATCH ? AND n.kind = ? AND n.importance > 0
               ORDER BY bm25(companion_fts) ASC LIMIT ?""",
            (match, kind, args.limit),
        ).fetchall()
        out[kind] = [{"id": i, "path": p, "excerpt": e} for i, p, e in rows]
    print(json.dumps(out, ensure_ascii=False, indent=1))


def cmd_append(con, args):
    content = Path(args.file).read_text(encoding="utf-8") if args.file else sys.stdin.read()
    content = content.strip()
    if not content:
        sys.exit("refusing to append an empty episode")
    if content.startswith(MACHINE_MARKERS):
        sys.exit("content starts with a machine marker — it would be classified as machine chatter")
    cmd_ensure_session(con)
    ep_id = f"ep_{short_id(8)}"
    now = datetime.now(timezone.utc)
    now_str = now.isoformat()
    rel = f"episodes/{now:%Y}/{now:%m}/{now:%d}/{ep_id}_{args.role}.md"
    body = f'---\nid: "{ep_id}"\ntype: episode\nrole: {args.role}\nsession: "{SESSION_ID}"\ncreated: "{now_str}"\n---\n\n{content}\n'
    abs_path = brain_root() / rel
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(body, encoding="utf-8", newline="\n")  # disk first — source of truth
    con.execute(
        """INSERT INTO companion_node (id, kind, session_id, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
           VALUES (?, 'episode', ?, ?, ?, 3, ?, ?, ?)""",
        (ep_id, SESSION_ID, rel, hashlib.sha256(body.encode()).hexdigest(), excerpt_500(content), now_str, now_str),
    )
    con.execute(
        "INSERT INTO companion_fts (node_id, body, tags) VALUES (?, ?, ?)",
        (ep_id, content, f"session:{SESSION_ID} role:{args.role}"),
    )
    con.commit()
    print(json.dumps({"id": ep_id, "path": rel}))


def cmd_turn(con, args):
    tid = f"turn_{short_id(12)}"
    con.execute(
        """INSERT INTO companion_turn (id, origin, trigger_kind, model, is_error, duration_ms, created_at)
           VALUES (?, 'cli', 'terminal', ?, 0, ?, ?)""",
        (tid, args.model, args.duration_ms, now_rfc3339()),
    )
    con.commit()
    print(json.dumps({"id": tid}))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default=str(DEFAULT_DB))
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("boot"); b.add_argument("--recent", type=int, default=12)
    sub.add_parser("gauge")
    r = sub.add_parser("recall"); r.add_argument("query"); r.add_argument("--limit", type=int, default=5)
    a = sub.add_parser("append"); a.add_argument("--role", choices=("user", "assistant"), required=True); a.add_argument("--file")
    t = sub.add_parser("turn"); t.add_argument("--model", default="claude-code"); t.add_argument("--duration-ms", type=int, default=0)
    args = ap.parse_args()
    con = connect(args.db)
    try:
        {"boot": cmd_boot, "gauge": cmd_gauge, "recall": cmd_recall, "append": cmd_append, "turn": cmd_turn}[args.cmd](con, args)
    finally:
        con.close()


if __name__ == "__main__":
    main()
