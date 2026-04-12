r"""
Pre-Release Test Suite — Unified Runner

Runs both layers in sequence:
  Layer 1: Deterministic smoke test (34 assertions, ~30s)
  Layer 2: LLM-driven exploratory test (intelligent probing, ~3-5min)

Layer 2 only runs if Layer 1 passes. Use --skip-layer2 for fast gate checks.

Usage:
  python tools/test-mcp/run_pre_release.py                    # both layers
  python tools/test-mcp/run_pre_release.py --skip-layer2      # Layer 1 only
  python tools/test-mcp/run_pre_release.py --port 17321       # production build
  python tools/test-mcp/run_pre_release.py --model sonnet     # cheaper Layer 2
"""
import subprocess
import sys
import time
import io
import argparse
from pathlib import Path
from datetime import datetime

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

parser = argparse.ArgumentParser(description="Pre-release test suite")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument("--skip-layer2", action="store_true", help="Run Layer 1 only")
parser.add_argument("--model", type=str, default=None, help="Model for Layer 2")
parser.add_argument("--slow", action="store_true", help="Add extra waits for slower machines")
args = parser.parse_args()

SCRIPT_DIR = Path(__file__).parent

print("=" * 64)
print("  PRE-RELEASE TEST SUITE")
print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M')}")
print(f"  Port: {args.port}")
print(f"  Layer 2: {'SKIP' if args.skip_layer2 else 'ENABLED'}")
print("=" * 64)

# ── Layer 1: Deterministic Smoke ─────────────────────────────

print("\n\n" + "=" * 64)
print("  LAYER 1: DETERMINISTIC SMOKE TEST")
print("=" * 64 + "\n")

layer1_cmd = [
    sys.executable,
    str(SCRIPT_DIR / "pre_release_smoke.py"),
    "--port", str(args.port),
]
if args.slow:
    layer1_cmd.append("--slow")

start = time.perf_counter()
layer1 = subprocess.run(layer1_cmd, encoding="utf-8", errors="replace")
layer1_time = time.perf_counter() - start

if layer1.returncode != 0:
    print(f"\n{'!' * 64}")
    print(f"  LAYER 1 FAILED — aborting Layer 2")
    print(f"  Fix the deterministic failures before running exploratory tests.")
    print(f"{'!' * 64}")
    sys.exit(1)

print(f"\n  Layer 1 completed in {layer1_time:.0f}s — ALL PASSED")

# ── Layer 2: LLM Exploratory ─────────────────────────────────

if args.skip_layer2:
    print(f"\n{'=' * 64}")
    print(f"  LAYER 2: SKIPPED (--skip-layer2)")
    print(f"{'=' * 64}")
    print(f"\n  PRE-RELEASE GATE: PASSED (Layer 1 only)")
    sys.exit(0)

print(f"\n\n{'=' * 64}")
print(f"  LAYER 2: LLM EXPLORATORY SMOKE TEST")
print(f"{'=' * 64}\n")

layer2_cmd = [
    sys.executable,
    str(SCRIPT_DIR / "exploratory_smoke.py"),
    "--port", str(args.port),
]
if args.model:
    layer2_cmd.extend(["--model", args.model])

start = time.perf_counter()
layer2 = subprocess.run(layer2_cmd, encoding="utf-8", errors="replace")
layer2_time = time.perf_counter() - start

# ── Combined Result ──────────────────────────────────────────

print(f"\n\n{'=' * 64}")
print(f"  PRE-RELEASE TEST SUITE RESULTS")
print(f"{'=' * 64}")
print(f"  Layer 1 (deterministic): PASSED ({layer1_time:.0f}s)")
print(f"  Layer 2 (exploratory):   {'PASSED' if layer2.returncode == 0 else 'ISSUES FOUND'} ({layer2_time:.0f}s)")
print(f"  Total time:              {layer1_time + layer2_time:.0f}s")
print(f"{'=' * 64}")

if layer2.returncode != 0:
    print(f"\n  Layer 2 found issues — review the report in tools/test-mcp/reports/")
    print(f"  Note: Layer 2 issues are advisory. Layer 1 passed, so the app is functional.")
    sys.exit(2)  # Exit 2 = advisory issues (vs 1 = hard failure)

print(f"\n  PRE-RELEASE GATE: PASSED")
sys.exit(0)
