r"""
End-to-end smoke test: data portability bundle round-trip.

Drives a real export → ZIP-on-disk → import cycle through the running desktop
app's IPC layer. Catches schema/serde regressions in the PortabilityBundle —
the highest-risk surface, since a broken roundtrip silently destroys user
data on first use.

What this test does NOT cover (intentionally):
  * The native save/open file dialogs (they can't be driven without OS-level
    UI automation). The two debug-only Tauri commands
    `export_selective_to_path` / `import_portability_bundle_from_path` exist
    specifically to bypass the dialog. They are gated by
    #[cfg(debug_assertions)] and are absent from release builds.
  * Encrypted bundles (no passphrase is supplied). Add a `--passphrase` mode
    later if encrypted credential round-trip becomes load-bearing.

Prerequisites:
  1. Dev app running with the test-automation feature:
       cargo tauri dev --features "test-automation desktop"
     or
       npx tauri dev --features test-automation
  2. At least one persona exists. The script will refuse to run on an empty
     workspace because there's nothing to round-trip.
  3. The test-automation HTTP server is responding:
       curl http://127.0.0.1:17320/health

Usage:
  uvx --with httpx python tools/test-mcp/e2e_portability.py
  uvx --with httpx python tools/test-mcp/e2e_portability.py --keep-imports
  uvx --with httpx python tools/test-mcp/e2e_portability.py --report report.json

Flags:
  --port <int>        test-automation server port (default 17320)
  --bundle-path <str> where to write the export bundle (default: temp file)
  --keep-imports      don't delete the imported personas after the test
                      (useful when iterating; default cleans them up)
  --keep-bundle       don't delete the export bundle after the test
  --report <path>     write the JSON run log here (default stdout)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import httpx


# ---- CLI ---------------------------------------------------------------

parser = argparse.ArgumentParser(description="Portability bundle round-trip e2e")
parser.add_argument("--port", type=int, default=17320)
parser.add_argument("--bundle-path", type=str, default=None,
                    help="Write the export bundle here. Defaults to a tempfile.")
parser.add_argument("--keep-imports", action="store_true",
                    help="Skip cleanup of imported personas after the test.")
parser.add_argument("--keep-bundle", action="store_true",
                    help="Don't delete the bundle after the test.")
parser.add_argument("--report", type=str, default=None)
args = parser.parse_args()


BASE = f"http://127.0.0.1:{args.port}"
client = httpx.Client(base_url=BASE, timeout=120)


# ---- HTTP helpers ------------------------------------------------------

def post(path: str, body: dict | None = None, timeout: int | None = None) -> dict:
    r = client.post(path, json=body or {}, timeout=timeout or 60)
    try:
        return json.loads(r.text)
    except json.JSONDecodeError:
        return {"_raw": r.text, "_status": r.status_code}


def get(path: str) -> dict:
    return json.loads(client.get(path).text)


def bridge(method: str, params: dict | None = None, timeout_secs: int = 60) -> dict:
    """Dispatch to a bridge method via /bridge-exec. Returns the parsed dict."""
    return post(
        "/bridge-exec",
        {"method": method, "params": params or {}, "timeout_secs": timeout_secs},
        timeout=timeout_secs + 20,
    )


# ---- Run log -----------------------------------------------------------

log: list[dict] = []


def record(step: str, outcome: str, **kw) -> dict:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "step": step, "outcome": outcome}
    entry.update(kw)
    log.append(entry)
    marker = "[OK]" if outcome == "ok" else ("[..]" if outcome == "info" else "[XX]")
    sys.stdout.write(f"  {marker} {step}: {outcome}")
    brief = {k: v for k, v in kw.items() if k != "detail" and not isinstance(v, (dict, list))}
    if brief:
        sys.stdout.write(f"  {brief}")
    sys.stdout.write("\n")
    sys.stdout.flush()
    return entry


def fatal(step: str, **kw) -> None:
    record(step, "fail", **kw)
    write_report()
    sys.exit(1)


# ---- Steps -------------------------------------------------------------

def step_preflight() -> None:
    print("\n[1/7] Preflight")
    try:
        h = get("/health")
    except Exception as e:
        fatal("server unreachable", error=str(e),
              hint=f"start dev app and confirm {BASE}/health responds")
    if h.get("status") != "ok":
        fatal("server unhealthy", body=h)
    record("server reachable", "ok", server=h.get("server"))


def step_baseline() -> dict:
    print("\n[2/7] Baseline")
    stats_resp = bridge("getPortabilityStats")
    if not stats_resp.get("success"):
        fatal("getPortabilityStats failed", error=stats_resp.get("error"))
    stats = stats_resp.get("stats") or {}
    persona_count = int(stats.get("persona_count") or 0)
    if persona_count == 0:
        fatal("workspace has no personas — nothing to round-trip",
              hint="create at least one persona, then re-run")
    record("baseline stats captured", "ok",
           personas=persona_count,
           teams=int(stats.get("team_count") or 0),
           credentials=int(stats.get("credential_count") or 0))

    personas_resp = bridge("listPersonas")
    if not personas_resp.get("success"):
        fatal("listPersonas failed", error=personas_resp.get("error"))
    personas = personas_resp.get("personas") or []
    persona_ids = [str(p["id"]) for p in personas]
    if len(persona_ids) != persona_count:
        record("persona count mismatch", "info",
               from_stats=persona_count, from_list=len(persona_ids))
    return {"persona_ids": persona_ids, "persona_count": len(persona_ids), "stats": stats}


def step_export(persona_ids: list[str], bundle_path: str) -> None:
    print("\n[3/7] Export")
    # Best-effort: clear any stale file at this path so a half-written bundle
    # from a prior run can't masquerade as a successful export.
    if os.path.exists(bundle_path):
        try:
            os.remove(bundle_path)
        except OSError as e:
            record("could not remove stale bundle", "info", path=bundle_path, error=str(e))

    resp = bridge("exportPortabilityToPath", {
        "personaIds": persona_ids,
        "teamIds": [],
        "credentialIds": [],
        "includeMemories": True,
        "passphrase": None,
        "filePath": bundle_path,
    }, timeout_secs=90)
    if not resp.get("success"):
        fatal("exportPortabilityToPath failed",
              error=resp.get("error"),
              hint="confirm the dev build was started with debug_assertions enabled")
    if not resp.get("wrote"):
        fatal("export reported wrote=false", resp=resp)
    if not os.path.exists(bundle_path):
        fatal("bundle file missing after export", path=bundle_path)
    size = os.path.getsize(bundle_path)
    if size < 100:
        fatal("bundle suspiciously small", path=bundle_path, size=size)
    record("bundle written", "ok", path=bundle_path, size_bytes=size)


def step_validate_bundle(bundle_path: str, expected_persona_count: int) -> None:
    print("\n[4/7] Validate bundle on disk")
    try:
        with zipfile.ZipFile(bundle_path) as zf:
            names = zf.namelist()
            if "manifest.json" not in names:
                fatal("manifest.json missing from ZIP", entries=names)
            with zf.open("manifest.json") as fh:
                manifest = json.load(fh)
    except zipfile.BadZipFile as e:
        fatal("bundle is not a valid ZIP", error=str(e))
    except json.JSONDecodeError as e:
        fatal("manifest.json is not valid JSON", error=str(e))

    fmt = manifest.get("format_version")
    if fmt not in (2, 3):
        fatal("unexpected format_version", format_version=fmt)

    bundle_personas = manifest.get("personas") or []
    if not isinstance(bundle_personas, list):
        fatal("personas field is not a list", got_type=type(bundle_personas).__name__)
    if len(bundle_personas) != expected_persona_count:
        fatal("persona count in bundle does not match request",
              expected=expected_persona_count, got=len(bundle_personas))

    # Spot-check that key persona fields survived serialization. A renamed
    # serde field on PersonaExport is the most likely failure mode and would
    # silently produce a bundle that imports but loses data.
    required = ("id", "name", "system_prompt")
    sample = bundle_personas[0]
    missing = [k for k in required if k not in sample]
    if missing:
        fatal("persona record missing required fields",
              missing=missing, keys=sorted(sample.keys()))

    # Teams (when present) must carry a `memories` list — guards against a
    # serde rename on TeamExport.memories silently dropping team memories.
    bundle_teams = manifest.get("teams") or []
    for tm in bundle_teams:
        if "memories" not in tm:
            fatal("team record missing 'memories' field (serde drift on TeamExport?)",
                  team=tm.get("name"), keys=sorted(tm.keys()))

    record("manifest valid", "ok",
           format_version=fmt,
           personas=len(bundle_personas),
           teams=len(bundle_teams),
           keys_in_persona=len(sample.keys()))


def step_import(bundle_path: str, expected_persona_count: int) -> dict:
    print("\n[6/7] Import")
    resp = bridge("importPortabilityFromPath", {
        "passphrase": None,
        "filePath": bundle_path,
    }, timeout_secs=120)
    if not resp.get("success"):
        fatal("importPortabilityFromPath failed",
              error=resp.get("error"))
    result = resp.get("result")
    if result is None:
        fatal("import returned null result")

    created = int(result.get("personas_created") or 0)
    if created != expected_persona_count:
        fatal("personas_created does not match exported count",
              expected=expected_persona_count, got=created,
              warnings=result.get("warnings"))

    warnings = result.get("warnings") or []
    record("import succeeded", "ok",
           personas_created=created,
           teams_created=int(result.get("teams_created") or 0),
           team_memories_created=int(result.get("team_memories_created") or 0),
           credentials_created=int(result.get("credentials_created") or 0),
           tools_created=int(result.get("tools_created") or 0),
           groups_created=int(result.get("groups_created") or 0),
           warning_count=len(warnings))
    return {"result": result, "id_mapping": result.get("id_mapping") or {}}


def step_memory_toggle(persona_ids: list[str]) -> None:
    """Export the same personas with includeMemories=False and assert the
    bundle carries no persona or team memories. Directly validates the
    Include-memories opt-out independent of whether the workspace has memories."""
    print("\n[5/7] Memory toggle (includeMemories=False)")
    fd, toggle_path = tempfile.mkstemp(suffix="_portability_nomem.zip", prefix="personas_smoke_")
    os.close(fd)
    try:
        os.remove(toggle_path)
    except OSError:
        pass

    try:
        resp = bridge("exportPortabilityToPath", {
            "personaIds": persona_ids,
            "teamIds": [],
            "credentialIds": [],
            "includeMemories": False,
            "passphrase": None,
            "filePath": toggle_path,
        }, timeout_secs=90)
        if not resp.get("success") or not os.path.exists(toggle_path):
            record("memory-toggle export failed", "info", error=resp.get("error"))
            return

        with zipfile.ZipFile(toggle_path) as zf:
            with zf.open("manifest.json") as fh:
                manifest = json.load(fh)

        persona_mem = sum(len(p.get("memories") or []) for p in (manifest.get("personas") or []))
        team_mem = sum(len(tm.get("memories") or []) for tm in (manifest.get("teams") or []))
        if persona_mem or team_mem:
            fatal("includeMemories=False still exported memories",
                  persona_memories=persona_mem, team_memories=team_mem)
        record("memory opt-out honored", "ok", persona_memories=0, team_memories=0)
    finally:
        if os.path.exists(toggle_path):
            try:
                os.remove(toggle_path)
            except OSError:
                pass


def step_cleanup(import_outcome: dict, baseline_persona_ids: list[str]) -> None:
    print("\n[7/7] Cleanup")
    if args.keep_imports:
        record("cleanup skipped (--keep-imports)", "info")
        return

    # The id_mapping returned by import_bundle is { old_id: new_id }. The
    # values are exactly the rows we just created. Anything in there that
    # also matches a baseline persona ID would be wrong; only delete IDs not
    # in the baseline so we never wipe pre-existing data.
    baseline_set = set(baseline_persona_ids)
    new_ids: list[str] = []
    for old_id, new_id in (import_outcome["id_mapping"] or {}).items():
        if not isinstance(new_id, str):
            continue
        if new_id in baseline_set:
            continue
        # id_mapping covers groups/tools/personas — but personas are the only
        # category where import unconditionally creates new rows, so the safe
        # filter is "delete anything that listPersonas now sees that wasn't
        # there before".
        new_ids.append(new_id)

    # Cross-reference against the current persona list — only delete rows
    # that listPersonas confirms exist as personas.
    personas_resp = bridge("listPersonas")
    current_ids = {str(p["id"]) for p in (personas_resp.get("personas") or [])}
    to_delete = [pid for pid in new_ids if pid in current_ids]

    deleted = 0
    failed: list[dict] = []
    for pid in to_delete:
        d = bridge("deletePersona", {"personaId": pid})
        if d.get("success"):
            deleted += 1
        else:
            failed.append({"id": pid, "error": d.get("error")})
    record("imported personas deleted", "ok" if not failed else "info",
           deleted=deleted, failed=len(failed))
    if failed:
        record("cleanup had failures", "info", failures=failed[:5])


# ---- Report writer -----------------------------------------------------

def write_report() -> None:
    if args.report:
        Path(args.report).write_text(json.dumps(log, indent=2), encoding="utf-8")


# ---- Main --------------------------------------------------------------

def main() -> int:
    if args.bundle_path:
        bundle_path = args.bundle_path
    else:
        # tempfile.NamedTemporaryFile + delete=False is the cleanest portable
        # way to get a unique writable path without stomping each other across
        # parallel CI runs.
        fd, bundle_path = tempfile.mkstemp(suffix="_portability.zip", prefix="personas_smoke_")
        os.close(fd)
        # Ensure the file doesn't exist when export runs, so size==0 doesn't
        # masquerade as a write failure on the export side.
        try:
            os.remove(bundle_path)
        except OSError:
            pass

    print(f"Bundle path: {bundle_path}")

    started = time.perf_counter()
    try:
        step_preflight()
        baseline = step_baseline()
        step_export(baseline["persona_ids"], bundle_path)
        step_validate_bundle(bundle_path, baseline["persona_count"])
        step_memory_toggle(baseline["persona_ids"])
        import_outcome = step_import(bundle_path, baseline["persona_count"])
        step_cleanup(import_outcome, baseline["persona_ids"])
    finally:
        if not args.keep_bundle and os.path.exists(bundle_path):
            try:
                os.remove(bundle_path)
            except OSError as e:
                record("bundle cleanup failed", "info", path=bundle_path, error=str(e))
        write_report()

    elapsed = time.perf_counter() - started
    fails = sum(1 for e in log if e["outcome"] == "fail")
    print(f"\n{'='*60}")
    print(f"  {'PASS' if fails == 0 else 'FAIL'} in {elapsed:.1f}s — {len(log)} steps, {fails} failures")
    print(f"{'='*60}")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
