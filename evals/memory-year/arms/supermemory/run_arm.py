"""Launch shim + supermemory server + one harness run, and tear both down on exit.

usage: py run_arm.py <tag> [extra harness args...]
Data lives in $SM_ARM_ROOT/data-<tag>; shim stats in shim-stats-<tag>.json. Re-running with the
same tag resumes: the server reopens the same store and the adapter skips finished documents.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get("SM_ARM_ROOT", r"C:\t\sm-arm"))   # binary, stores, logs: machine scratch, never the repo
HERE = Path(__file__).resolve().parent
HARNESS = HERE.parents[1]
tag = sys.argv[1]
extra = sys.argv[2:]
data = ROOT / f"data-{tag}"
data.mkdir(exist_ok=True)
stats = ROOT / f"shim-stats-{tag}.json"
log = open(ROOT / f"run-{tag}.log", "a", encoding="utf-8")


def say(msg):
    log.write(f"{time.strftime('%H:%M:%S')} {msg}\n"); log.flush()


shim = subprocess.Popen(["py", str(HERE / "claude_shim.py"), "6791", "claude:claude-sonnet-5@low", str(stats)],
                        stdout=open(ROOT / f"shim-{tag}.out", "a"), stderr=subprocess.STDOUT)
env = dict(os.environ, OPENAI_API_KEY="shim", OPENAI_BASE_URL="http://127.0.0.1:6791/v1", OPENAI_MODEL="claude-sonnet-5",
           SUPERMEMORY_DATA_DIR=str(data), PORT="6792", SUPERMEMORY_DISABLE_TELEMETRY="1")
server = subprocess.Popen([str(ROOT / "supermemory-server-windows-x64.exe")], env=env, stdin=subprocess.DEVNULL,
                          stdout=open(ROOT / f"server-{tag}.out", "a", encoding="utf-8"), stderr=subprocess.STDOUT)
try:
    for _ in range(120):
        try:
            urllib.request.urlopen("http://127.0.0.1:6792/", timeout=2)
            break
        except Exception:
            time.sleep(2)
    say("server up")
    kw = json.dumps({"data_dir": str(data), "shim_stats": str(stats)})
    cmd = ["py", "-m", "memory_year", "run", "--scenario", str(HARNESS / "out" / "s7-d365-x10"),
           "--rungs", "supermemory", "--backend-kw", kw, *extra]
    say("harness: " + " ".join(cmd))
    rc = subprocess.call(cmd, cwd=str(HARNESS), stdout=log, stderr=subprocess.STDOUT)
    say(f"harness exit {rc}")
    if rc == 0:
        (ROOT / f"done-{tag}.flag").write_text(time.strftime("%F %T"), encoding="utf-8")
finally:
    server.terminate(); shim.terminate()
    time.sleep(2)
    subprocess.call(["taskkill", "/F", "/T", "/PID", str(server.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.call(["taskkill", "/F", "/T", "/PID", str(shim.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    say("torn down")
