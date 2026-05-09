#!/usr/bin/env python3
r"""
Stage B Phase 1b — one-time + idempotent migration.

Walks `scripts/templates/<category>/*.json` and invokes the Tauri command
`derive_recipes_from_template` once per template. Emits a JSON migration
report aggregating per-template Created / Updated / Unchanged counts.

Idempotency:
  - The Rust command's `(source_template_id, source_use_case_id)` partial
    unique index makes each derivation a deterministic upsert.
  - Re-running this script after no template edits produces all-Unchanged.
  - If a template's UC was edited, that single recipe shows as Updated
    with `source_version` bumped; the rest stay Unchanged.

Prerequisites:
  1. Dev app running with test-automation feature:
       npm run tauri:dev:test
     or
       cargo tauri dev --features "test-automation desktop"
  2. Confirm the test bridge responds:
       curl http://127.0.0.1:17320/health
  3. Run from the repo root:
       uvx --with httpx python scripts/migrate-template-usecases-to-recipes.py

Usage:
  uvx --with httpx python scripts/migrate-template-usecases-to-recipes.py
  uvx --with httpx python scripts/migrate-template-usecases-to-recipes.py --port 17320
  uvx --with httpx python scripts/migrate-template-usecases-to-recipes.py \
        --template-id incident-logger
  uvx --with httpx python scripts/migrate-template-usecases-to-recipes.py \
        --report docs/tests/results/recipe-migration-{run_id}.json

Flags:
  --port <int>          test-automation server port (default 17320)
  --template-id <str>   limit to a single template (debugging)
  --report <path>       write JSON report here (default stdout)
  --dry-run             walk templates and parse them but skip the Tauri call
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx


# Path to the template JSON files. Resolved relative to this script's
# location so it works regardless of cwd.
TEMPLATES_ROOT = Path(__file__).parent / "templates"


def find_templates(template_id_filter: str | None) -> list[Path]:
    """Walk every <category>/<id>.json under scripts/templates/."""
    out: list[Path] = []
    for category_dir in sorted(TEMPLATES_ROOT.iterdir()):
        if not category_dir.is_dir():
            continue
        for path in sorted(category_dir.glob("*.json")):
            if template_id_filter and path.stem != template_id_filter:
                continue
            out.append(path)
    return out


def derive_one(
    client: httpx.Client,
    port: int,
    template_id: str,
    payload_json: str,
) -> list[dict]:
    """Call the Tauri command via test-bridge eval_js."""
    js = (
        "return await window.__TAURI__.core.invoke("
        "'derive_recipes_from_template', "
        f"{{ templateId: {json.dumps(template_id)}, "
        f"templatePayloadJson: {json.dumps(payload_json)} }})"
    )
    resp = client.post(
        f"http://127.0.0.1:{port}/eval-js",
        json={"script": js},
        timeout=30.0,
    )
    resp.raise_for_status()
    body = resp.json()
    # Test bridge returns { ok: true, result: <command return> } on success.
    if not body.get("ok"):
        raise RuntimeError(f"derive_recipes_from_template failed: {body}")
    return body.get("result", [])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Migrate template use cases to recipes (Stage B Phase 1b)"
    )
    parser.add_argument("--port", type=int, default=17320)
    parser.add_argument(
        "--template-id",
        type=str,
        default=None,
        help="If set, run on a single template only.",
    )
    parser.add_argument(
        "--report",
        type=str,
        default=None,
        help="Write JSON report here. Defaults to stdout.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse templates but skip the Tauri command. Useful for"
        " confirming the script can find every template.",
    )
    args = parser.parse_args()

    paths = find_templates(args.template_id)
    if not paths:
        print(
            f"No templates found under {TEMPLATES_ROOT}. "
            "Check --template-id spelling.",
            file=sys.stderr,
        )
        return 1

    run_id = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
    started_at = datetime.now(tz=timezone.utc).isoformat()
    per_template: list[dict] = []
    aggregate = {"created": 0, "updated": 0, "unchanged": 0}
    failed: list[dict] = []

    print(f"Found {len(paths)} template(s) to process. dry_run={args.dry_run}")

    if args.dry_run:
        for path in paths:
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
            except Exception as e:
                failed.append({"path": str(path), "error": f"json parse: {e}"})
                continue
            ucs = doc.get("payload", {}).get("use_cases", [])
            per_template.append(
                {
                    "template_id": doc.get("id") or path.stem,
                    "category": path.parent.name,
                    "use_case_count": len(ucs),
                    "actions": [],
                }
            )
        report = {
            "run_id": run_id,
            "started_at": started_at,
            "dry_run": True,
            "templates": per_template,
            "failed": failed,
        }
    else:
        with httpx.Client() as client:
            for path in paths:
                try:
                    doc = json.loads(path.read_text(encoding="utf-8"))
                except Exception as e:
                    failed.append({"path": str(path), "error": f"json parse: {e}"})
                    continue
                template_id = doc.get("id") or path.stem
                payload = doc.get("payload")
                if not isinstance(payload, dict):
                    failed.append(
                        {"path": str(path), "error": "no payload object"}
                    )
                    continue
                payload_json = json.dumps(payload)
                t0 = time.time()
                try:
                    results = derive_one(client, args.port, template_id, payload_json)
                except Exception as e:
                    failed.append(
                        {"path": str(path), "template_id": template_id, "error": str(e)}
                    )
                    continue
                elapsed_ms = int((time.time() - t0) * 1000)
                actions: dict[str, int] = {
                    "created": 0,
                    "updated": 0,
                    "unchanged": 0,
                }
                for r in results:
                    a = r.get("action", "unchanged")
                    actions[a] = actions.get(a, 0) + 1
                    aggregate[a] = aggregate.get(a, 0) + 1
                per_template.append(
                    {
                        "template_id": template_id,
                        "category": path.parent.name,
                        "use_case_count": len(results),
                        "elapsed_ms": elapsed_ms,
                        "actions": actions,
                        "results": results,
                    }
                )
                print(
                    f"[{actions['created']:>2}c {actions['updated']:>2}u "
                    f"{actions['unchanged']:>2}=] {template_id}"
                )

        report = {
            "run_id": run_id,
            "started_at": started_at,
            "finished_at": datetime.now(tz=timezone.utc).isoformat(),
            "dry_run": False,
            "aggregate": aggregate,
            "templates_total": len(paths),
            "templates_succeeded": len(per_template),
            "templates_failed": len(failed),
            "templates": per_template,
            "failed": failed,
        }

    output = json.dumps(report, indent=2)
    if args.report:
        Path(args.report).write_text(output, encoding="utf-8")
        print(f"\nReport written to {args.report}")
    else:
        print(output)

    if failed:
        print(f"\n{len(failed)} template(s) failed; see report.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
