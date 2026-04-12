r"""
Layer 2: LLM-Driven Exploratory Smoke Test

Spawns a Claude Code session with the exploratory prompt to intelligently
inspect the app beyond what deterministic scripts can catch.

Usage:
  python tools/test-mcp/exploratory_smoke.py
  python tools/test-mcp/exploratory_smoke.py --port 17321  # production

Prerequisites:
  - Test automation server running (app in dev or PERSONAS_TEST_PORT set)
  - Claude Code CLI (`claude`) on PATH
"""
import subprocess
import sys
import os
import argparse
import json
import time
import io
from pathlib import Path
from datetime import datetime

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

parser = argparse.ArgumentParser(description="LLM-driven exploratory smoke test")
parser.add_argument("--port", type=int, default=17320, help="Test automation server port")
parser.add_argument("--model", type=str, default=None, help="Model override (e.g. sonnet)")
parser.add_argument("--dry-run", action="store_true", help="Print prompt without running Claude")
args = parser.parse_args()

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent
PROMPT_FILE = SCRIPT_DIR / "exploratory_smoke.md"
REPORTS_DIR = SCRIPT_DIR / "reports"

# Ensure reports directory exists
REPORTS_DIR.mkdir(exist_ok=True)

# Read the exploration prompt
prompt_text = PROMPT_FILE.read_text(encoding="utf-8")

# Replace port if non-default
if args.port != 17320:
    prompt_text = prompt_text.replace("127.0.0.1:17320", f"127.0.0.1:{args.port}")

# Verify server is reachable before spawning Claude
try:
    import httpx
    r = httpx.get(f"http://127.0.0.1:{args.port}/health", timeout=5)
    health = r.json()
    print(f"Test server: {health.get('server')} (port {args.port})")
except Exception as e:
    print(f"ERROR: Test server not reachable at port {args.port}: {e}")
    print("Start the app with test automation enabled first.")
    sys.exit(1)

today = datetime.now().strftime("%Y-%m-%d")
report_path = REPORTS_DIR / f"exploratory-{today}.md"

# Build the Claude Code command
task = (
    f"Read the exploratory smoke test instructions below and execute them against the "
    f"running Personas Desktop app. Use curl via Bash tool to interact with the test "
    f"automation server at http://127.0.0.1:{args.port}. "
    f"Write your report to {report_path}.\n\n"
    f"{prompt_text}"
)

if args.dry_run:
    print("=== DRY RUN — would send this prompt to Claude Code ===")
    print(task[:2000])
    print(f"\n... ({len(task)} chars total)")
    sys.exit(0)

print(f"\nStarting Layer 2 exploratory smoke test...")
print(f"Report will be written to: {report_path}")
print(f"This may take 2-5 minutes depending on model speed.\n")

# Build command — use claude.cmd on Windows, claude on Unix
import shutil
claude_bin = shutil.which("claude") or shutil.which("claude.cmd") or "claude"
cmd = [claude_bin, "--print", "--verbose", "--dangerously-skip-permissions"]
if args.model:
    cmd.extend(["--model", args.model])
cmd.extend(["--max-turns", "30"])
cmd.append(task)

start = time.perf_counter()

try:
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=600,  # 10 minute hard cap
        cwd=str(REPO_ROOT),
    )
    elapsed = time.perf_counter() - start

    # Print Claude's output
    if result.stdout:
        print(result.stdout[-3000:] if len(result.stdout) > 3000 else result.stdout)

    if result.returncode != 0:
        print(f"\nClaude Code exited with code {result.returncode}")
        if result.stderr:
            print(f"stderr: {result.stderr[-1000:]}")

    # Check if report was written
    if report_path.exists():
        report = report_path.read_text(encoding="utf-8")
        print(f"\n{'=' * 64}")
        print(f"EXPLORATORY SMOKE COMPLETE ({elapsed:.0f}s)")
        print(f"{'=' * 64}")
        print(f"Report: {report_path}")

        # Quick parse for critical findings
        if "Critical" in report:
            critical_section = report.split("Critical")[1].split("####")[0] if "####" in report.split("Critical")[1] else report.split("Critical")[1][:300]
            if "None" not in critical_section and "none" not in critical_section.lower():
                print(f"\n!! CRITICAL FINDINGS DETECTED — review report !!")
                sys.exit(1)

        print("No critical findings. Layer 2 PASSED.")
        sys.exit(0)
    else:
        print(f"\nWARNING: Report not written to {report_path}")
        print("Claude may not have completed the exploration.")
        sys.exit(1)

except subprocess.TimeoutExpired:
    print(f"\nERROR: Claude Code timed out after 600s")
    sys.exit(1)
except FileNotFoundError:
    print("ERROR: 'claude' CLI not found on PATH.")
    print("Install Claude Code: https://docs.anthropic.com/claude-code")
    sys.exit(1)
