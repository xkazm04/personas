"""
Batch Arena Test — Programmatic multi-persona, multi-model testing via Management API.

Runs arena tests across all (or selected) personas, comparing Claude models
against local Ollama models. Designed for mass validation of BYOM viability.

Prerequisites:
  1. Personas app running (the Management API starts automatically on port 9420)
  2. Ollama running at localhost:11434 with target models (gemma4, qwen3.5)
  3. At least one persona exists in the app

Usage:
  # Test all personas with Sonnet vs Gemma4
  python tools/test-mcp/batch_arena_test.py

  # Test specific persona with custom models
  python tools/test-mcp/batch_arena_test.py --persona "Code Reviewer" --models sonnet,ollama:gemma4

  # Dry run (list personas without executing)
  python tools/test-mcp/batch_arena_test.py --dry-run

  # Use custom API port
  python tools/test-mcp/batch_arena_test.py --port 9420
"""

import httpx
import json
import time
import sys
import argparse
from datetime import datetime

# ── Args ──────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description="Batch Arena Test via Management API")
parser.add_argument("--port", type=int, default=9420, help="Management API port (default: 9420)")
parser.add_argument("--ollama-port", type=int, default=11434, help="Ollama port (default: 11434)")
parser.add_argument("--persona", type=str, help="Test only this persona (partial name match)")
parser.add_argument("--models", type=str, default="sonnet,ollama:gemma4",
                    help="Comma-separated model IDs (default: sonnet,ollama:gemma4)")
parser.add_argument("--dry-run", action="store_true", help="List personas without running tests")
parser.add_argument("--timeout", type=int, default=300, help="Max wait per arena run (seconds)")
parser.add_argument("--poll-interval", type=int, default=5, help="Poll interval (seconds)")
args = parser.parse_args()

BASE = f"http://127.0.0.1:{args.port}"
OLLAMA = f"http://127.0.0.1:{args.ollama_port}"

# ── Model catalog (matches frontend modelCatalog.ts) ──────────────────────

MODEL_CONFIGS = {
    "haiku": {"id": "haiku", "provider": "anthropic", "model": "haiku"},
    "sonnet": {"id": "sonnet", "provider": "anthropic", "model": "sonnet"},
    "opus": {"id": "opus", "provider": "anthropic", "model": "opus"},
    "ollama:gemma4": {"id": "ollama:gemma4", "provider": "ollama", "model": "gemma4", "base_url": "http://localhost:11434"},
    "ollama:qwen3.5": {"id": "ollama:qwen3.5", "provider": "ollama", "model": "qwen3.5", "base_url": "http://localhost:11434"},
}

# ── Helpers ───────────────────────────────────────────────────────────────

def get_api_key():
    """Read the system API key from the app settings DB."""
    import sqlite3
    import os
    db_path = os.path.expandvars(r"%APPDATA%\com.personas.desktop\personas.db")
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.execute(
            "SELECT value FROM app_settings WHERE key = 'system_api_key'"
        )
        row = cursor.fetchone()
        conn.close()
        if row:
            return row[0].strip('"')
    except Exception:
        pass
    return None


def make_client():
    """Create HTTP client with auth header."""
    api_key = get_api_key()
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return httpx.Client(base_url=BASE, timeout=30, headers=headers)


# ── Main ──────────────────────────────────────────────────────────────────

print(f"""
╭──────────────────────────────────────────────────────╮
│  Batch Arena Test — Personas × Ollama                │
│  Management API: {BASE:<34} │
│  Ollama: {OLLAMA:<43} │
│  Models: {args.models:<43} │
╰──────────────────────────────────────────────────────╯
""")

# 0. Verify connectivity
print("=== 0. Connectivity ===")

try:
    ollama_r = httpx.get(f"{OLLAMA}/api/tags", timeout=5)
    ollama_models = [m["name"] for m in ollama_r.json().get("models", [])]
    print(f"  ✓ Ollama: {', '.join(ollama_models)}")
except Exception as e:
    print(f"  ✗ Ollama not reachable: {e}")
    sys.exit(1)

c = make_client()
try:
    # Try health or list personas
    r = c.get("/api/personas")
    if r.status_code == 401:
        print(f"  ✗ Management API auth failed (401). Check API key in app_settings.")
        print(f"    Tip: The system_api_key is auto-generated on app startup.")
        sys.exit(1)
    elif r.status_code != 200:
        print(f"  ✗ Management API error: {r.status_code} {r.text[:200]}")
        sys.exit(1)
    personas = r.json()
    print(f"  ✓ Management API: {len(personas)} personas found")
except httpx.ConnectError:
    print(f"  ✗ Management API not running on port {args.port}")
    print(f"    The Management API starts automatically with the Personas app.")
    print(f"    Make sure the app is running (not just `tauri dev` — needs full startup).")
    sys.exit(1)

# 1. Select personas
print(f"\n=== 1. Personas ===")

if args.persona:
    personas = [p for p in personas if args.persona.lower() in p.get("name", "").lower()]
    if not personas:
        print(f"  ✗ No persona matching '{args.persona}'")
        sys.exit(1)

for p in personas:
    print(f"  • {p['name']} (id: {p['id'][:12]}...)")

if args.dry_run:
    print(f"\n  [DRY RUN] Would test {len(personas)} personas with models: {args.models}")
    sys.exit(0)

# 2. Resolve model configs
print(f"\n=== 2. Model Configs ===")

model_ids = [m.strip() for m in args.models.split(",")]
models = []
for mid in model_ids:
    if mid in MODEL_CONFIGS:
        models.append(MODEL_CONFIGS[mid])
        print(f"  • {mid} → {MODEL_CONFIGS[mid]['provider']}/{MODEL_CONFIGS[mid].get('model', mid)}")
    else:
        print(f"  ✗ Unknown model: {mid}. Available: {', '.join(MODEL_CONFIGS.keys())}")
        sys.exit(1)

# 3. Run arena tests
print(f"\n=== 3. Running Arena Tests ({len(personas)} personas × {len(models)} models) ===")

results = []
for i, persona in enumerate(personas):
    pid = persona["id"]
    pname = persona["name"]
    print(f"\n  [{i+1}/{len(personas)}] {pname}")

    # Start arena
    try:
        r = c.post(f"/api/lab/arena/{pid}", json={
            "models": models,
            "use_case_filter": None,
        })
        if r.status_code != 200:
            print(f"    ✗ Failed to start: {r.status_code} {r.text[:100]}")
            results.append({"persona": pname, "status": "start_failed", "error": r.text[:100]})
            continue

        run = r.json()
        run_id = run.get("run_id") or run.get("id")
        print(f"    → Arena started (run_id: {run_id[:12]}...)")
    except Exception as e:
        print(f"    ✗ Exception: {e}")
        results.append({"persona": pname, "status": "exception", "error": str(e)})
        continue

    # Poll for completion
    started_at = time.time()
    final_status = "timeout"

    while time.time() - started_at < args.timeout:
        time.sleep(args.poll_interval)
        elapsed = int(time.time() - started_at)

        try:
            # Check run status via results endpoint
            r = c.get(f"/api/lab/arena/{pid}/runs")
            if r.status_code == 200:
                runs = r.json()
                current_run = next((r for r in runs if r.get("id") == run_id), None)
                if current_run:
                    status = current_run.get("status", "unknown")
                    if status in ("completed", "failed", "cancelled"):
                        final_status = status
                        break
                    if elapsed % 15 == 0:
                        print(f"    ... {status} ({elapsed}s)")
        except Exception:
            pass

    # Collect results
    if final_status == "completed":
        try:
            r = c.get(f"/api/lab/arena/{run_id}/results")
            if r.status_code == 200:
                arena_results = r.json()
                # Summarize scores per model
                model_scores = {}
                for result in arena_results:
                    mid = result.get("model_id", "?")
                    score = (
                        result.get("tool_accuracy_score", 0) +
                        result.get("output_quality_score", 0) +
                        result.get("protocol_compliance", 0)
                    ) / 3
                    if mid not in model_scores:
                        model_scores[mid] = []
                    model_scores[mid].append(score)

                summary = {k: sum(v)/len(v) if v else 0 for k, v in model_scores.items()}
                print(f"    ✓ Completed in {int(time.time() - started_at)}s")
                for mid, avg in sorted(summary.items(), key=lambda x: -x[1]):
                    print(f"      {mid}: {avg:.1f}/100")
                results.append({"persona": pname, "status": "completed", "scores": summary, "duration_s": int(time.time() - started_at)})
            else:
                print(f"    ✓ Completed (couldn't fetch results: {r.status_code})")
                results.append({"persona": pname, "status": "completed", "scores": {}})
        except Exception as e:
            print(f"    ✓ Completed (results fetch error: {e})")
            results.append({"persona": pname, "status": "completed", "scores": {}})
    else:
        print(f"    ✗ Final status: {final_status} (after {int(time.time() - started_at)}s)")
        results.append({"persona": pname, "status": final_status})

# 4. Summary
print(f"\n{'=' * 60}")
print(f"BATCH ARENA RESULTS — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
print(f"{'=' * 60}")

completed = [r for r in results if r["status"] == "completed"]
failed = [r for r in results if r["status"] != "completed"]

print(f"\n  Completed: {len(completed)}/{len(results)}")
if failed:
    print(f"  Failed:    {len(failed)}")
    for f in failed:
        print(f"    • {f['persona']}: {f['status']} — {f.get('error', '')[:80]}")

if completed:
    print(f"\n  Model Comparison (avg across personas):")
    # Aggregate scores across all personas
    all_model_scores = {}
    for r in completed:
        for mid, score in r.get("scores", {}).items():
            if mid not in all_model_scores:
                all_model_scores[mid] = []
            all_model_scores[mid].append(score)

    for mid, scores in sorted(all_model_scores.items(), key=lambda x: -sum(x[1])/len(x[1]) if x[1] else 0):
        avg = sum(scores) / len(scores) if scores else 0
        print(f"    {mid:20s}  avg={avg:5.1f}/100  (n={len(scores)} runs)")

# Save results to file
output_file = f"test-results/arena-batch-{datetime.now().strftime('%Y%m%d-%H%M')}.json"
try:
    import os
    os.makedirs("test-results", exist_ok=True)
    with open(output_file, "w") as f:
        json.dump({"timestamp": datetime.now().isoformat(), "models": model_ids, "results": results}, f, indent=2)
    print(f"\n  Results saved to: {output_file}")
except Exception:
    pass

sys.exit(1 if failed else 0)
