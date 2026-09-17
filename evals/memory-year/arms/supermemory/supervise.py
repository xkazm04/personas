"""Run the supermemory arm across as many model-budget windows as the year needs.

A year of write-time extraction costs more Claude CLI calls than one subscription window
holds. The adapter stops the run after three consecutive failed documents; this supervisor
waits for the window to reset and resumes, which is safe because the adapter skips ingested
days and replays each probe's recorded context.

usage: py supervise.py <tag> [--start-at HH:MM] [--windows N]
"""
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(os.environ.get("SM_ARM_ROOT", r"C:\t\sm-arm"))   # stores and logs: machine scratch, never the repo
HERE = Path(__file__).resolve().parent
tag = sys.argv[1]
args = sys.argv[2:]
start_at = args[args.index("--start-at") + 1] if "--start-at" in args else None
windows = int(args[args.index("--windows") + 1]) if "--windows" in args else 6
log = open(ROOT / f"supervise-{tag}.log", "a", encoding="utf-8")
RESET = re.compile(r"resets (\d{1,2})(?::(\d{2}))?\s*(am|pm)", re.I)


def say(m):
    log.write(f"{datetime.now():%m-%d %H:%M:%S} {m}\n"); log.flush()


def sleep_until(when: datetime):
    secs = (when - datetime.now()).total_seconds()
    if secs > 0:
        say(f"sleeping {secs/60:.0f} min until {when:%H:%M}")
        time.sleep(secs)


def reset_time() -> datetime:
    """The reset the CLI itself named, from the shim's error log; else one hour on."""
    p = ROOT / f"shim-stats-{tag}.log.jsonl"
    text = p.read_text(encoding="utf-8", errors="replace")[-8000:] if p.exists() else ""
    hits = RESET.findall(text)
    if hits:
        h, m, ap = hits[-1]
        hour = int(h) % 12 + (12 if ap.lower() == "pm" else 0)
        when = datetime.now().replace(hour=hour, minute=int(m or 0), second=0, microsecond=0)
        if when < datetime.now():
            when += timedelta(days=1)
        return when + timedelta(minutes=3)
    return datetime.now() + timedelta(minutes=60)


if start_at:
    h, m = start_at.split(":")
    when = datetime.now().replace(hour=int(h), minute=int(m), second=0, microsecond=0)
    if when < datetime.now():
        when += timedelta(days=1)
    sleep_until(when)

for window in range(1, windows + 1):
    say(f"window {window}: starting")
    rc = subprocess.call(["py", str(HERE / "run_arm.py"), tag], cwd=str(ROOT))
    say(f"window {window}: run_arm rc={rc}")
    if (ROOT / f"done-{tag}.flag").exists():
        say("harness completed the year; stopping")
        break
    sleep_until(reset_time())
say("supervisor done")
