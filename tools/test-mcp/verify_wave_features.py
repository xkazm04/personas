#!/usr/bin/env python3
"""
Post-sweep verification for the parameters + description + credential wave.

Runs after `e2e_12_targeted_adoption.py` to confirm each new feature actually
landed on the adopted personas. Designed to be machine-readable so the report
diffs cleanly against prior runs.

Checks per T: persona:
  1. description does NOT begin with "Adopted from template" (Bug 0a fix).
  2. For the 5 backfilled templates, the expected parameter keys are
     present in personas.parameters with the right default value.
  3. system_prompt still contains the matching {{param.KEY}} placeholders
     (so the runtime substitution layer has something to substitute).

Output: prints a table of per-persona pass/fail and a final summary.
Exit code 0 if all checks pass; 1 otherwise.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(os.environ["APPDATA"]) / "com.personas.desktop" / "personas.db"

# Expected parameter sets per backfilled template (name → list of (key, default))
EXPECTED_PARAMS: dict[str, list[tuple[str, object]]] = {
    "Idea Harvester": [("ideas_per_source", 7)],
    "Daily Personal Briefer": [("action_plan_items", 5)],
    "Product Scout": [
        ("max_candidates_per_scan", 5),
        ("target_product_definition", "AI-native tools and API services that could become new connectors or feature integrations."),
    ],
    "Newsletter Curator": [("max_articles_per_issue", 7)],
    "AI Weekly Research": [
        ("research_websites", ""),
        ("findings_per_session", 7),
    ],
}


def rows(sql, params=()):
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in c.execute(sql, params).fetchall()]
    finally:
        c.close()


def check_persona(row: dict) -> tuple[bool, list[str]]:
    """Return (all_passed, list_of_findings)."""
    findings: list[str] = []
    name = row["name"]
    short = name.removeprefix("T: ")

    # 1. Description fix
    desc = (row.get("description") or "").strip()
    if not desc:
        findings.append("FAIL  empty description")
    elif desc.lower().startswith("adopted from template"):
        findings.append(f"FAIL  description still uses fallback: '{desc[:50]}'")
    else:
        findings.append(f"PASS  description: '{desc[:60]}{'…' if len(desc)>60 else ''}'")

    # 2. Parameters
    expected = EXPECTED_PARAMS.get(short)
    raw_params = row.get("parameters") or "[]"
    try:
        actual_params = json.loads(raw_params)
    except json.JSONDecodeError as e:
        findings.append(f"FAIL  parameters JSON unparseable: {e}")
        return False, findings

    actual_by_key = {p.get("key"): p for p in actual_params if isinstance(p, dict)}

    if expected is None:
        if actual_params:
            findings.append(f"INFO  template carries no expected params; {len(actual_params)} param(s) on row")
        else:
            findings.append("INFO  template carries no params (none expected)")
    else:
        for key, default in expected:
            p = actual_by_key.get(key)
            if p is None:
                findings.append(f"FAIL  missing parameter '{key}'")
                continue
            value = p.get("value")
            default_value = p.get("default_value")
            if default_value != default:
                findings.append(f"FAIL  parameter '{key}' default mismatch: stored={default_value!r} expected={default!r}")
                continue
            if value != default_value:
                findings.append(f"INFO  parameter '{key}' value differs from default (value={value!r}, default={default_value!r}) — fine if tuned")
            findings.append(f"PASS  parameter '{key}' = {value!r} (default {default_value!r})")

    # 3. Placeholder substitution wiring
    prompt = row.get("system_prompt") or ""
    placeholders = set(re.findall(r"\{\{param\.([A-Za-z0-9_]+)\}\}", prompt))
    if expected:
        expected_keys = {k for k, _ in expected}
        missing = expected_keys - placeholders
        if missing:
            findings.append(f"FAIL  prompt missing placeholders for: {sorted(missing)}")
        else:
            findings.append(f"PASS  prompt references {sorted(expected_keys)} via {{{{param.X}}}}")

    passed = not any(f.startswith("FAIL") for f in findings)
    return passed, findings


def main():
    if not DB_PATH.exists():
        print(f"DB not found at {DB_PATH}", file=sys.stderr)
        return 2

    personas = rows(
        "SELECT id, name, description, parameters, system_prompt FROM personas "
        "WHERE name LIKE 'T:%' ORDER BY name",
    )
    if not personas:
        print("No T:-prefixed personas in DB — run the adoption sweep first.")
        return 1

    print(f"Verifying {len(personas)} adopted personas\n")
    all_passed = True
    pass_count = 0
    fail_count = 0
    backfilled_with_params = 0

    for row in personas:
        ok, findings = check_persona(row)
        if ok:
            pass_count += 1
        else:
            fail_count += 1
            all_passed = False

        print(f"=== {row['name']} ===")
        for f in findings:
            print(f"  {f}")
        print()

        short = row["name"].removeprefix("T: ")
        if short in EXPECTED_PARAMS:
            try:
                params = json.loads(row.get("parameters") or "[]")
                if params:
                    backfilled_with_params += 1
            except json.JSONDecodeError:
                pass

    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Personas verified:                {len(personas)}")
    print(f"  Passed all feature checks:        {pass_count}")
    print(f"  Failed at least one check:        {fail_count}")
    print(f"  Backfilled templates w/ params:   {backfilled_with_params}/{len(EXPECTED_PARAMS)}")
    print(f"  Overall:                          {'PASS' if all_passed else 'FAIL'}")

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
