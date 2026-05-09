#!/usr/bin/env python3
r"""
Stage B Phase 2.2 — convert template JSON files from inline UC shape to
recipe_ref shape.

For each template under `scripts/templates/<category>/*.json`, walks
`payload.use_cases[]` and replaces every inline UC definition with:

    { "recipe_ref": { "id": "<deterministic-uuid>",
                      "version": "1.0.0",
                      "bindings": {} } }

The `id` is computed via UUIDv5 with namespace
`6f8d4f9c-3a07-4b1e-9c9d-8a3f6b2c5e10` (matches Rust's
`commands::recipes::recipe_derivation::RECIPE_DERIVATION_NAMESPACE`) and
name `"<template_id>:<use_case_id>"`. This produces the same recipe id
that Phase 1b's `derive_recipes_from_template` writes to the DB, so the
two stay in sync without DB access.

PREREQUISITE: Phase 1b's migration script
(`scripts/migrate-template-usecases-to-recipes.py`) MUST run against a
populated DB before this script's output is committed and shipped.
Otherwise templates point at recipes that don't exist yet, and adoption
will fail with `recipe X not found` errors.

DEFAULTS TO --dry-run. Pass `--apply` to actually rewrite files.

Usage:
  python scripts/convert-templates-to-recipe-refs.py            # dry-run
  python scripts/convert-templates-to-recipe-refs.py --apply    # write
  python scripts/convert-templates-to-recipe-refs.py --template-id X  # single

Verification:
  Run the script's built-in self-tests (no deps):
    python scripts/convert-templates-to-recipe-refs.py --self-test
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

# MUST match RECIPE_DERIVATION_NAMESPACE in
# src-tauri/src/commands/recipes/recipe_derivation.rs.
# Changing this orphans every previously-derived recipe.
RECIPE_DERIVATION_NAMESPACE = uuid.UUID("6f8d4f9c-3a07-4b1e-9c9d-8a3f6b2c5e10")

# Frozen-output canary. The Rust side (`derive_recipe_id_frozen_canary`)
# asserts this exact id against the same inputs. If you change the
# namespace, re-compute the canary, update both sides together, AND plan
# a coordinated re-key migration.
CANARY_INPUT = ("incident-logger", "uc_log_incident")
CANARY_OUTPUT = "8205b2bf-22a9-5821-9783-0e1150d620f5"

# Path to the template JSON files.
TEMPLATES_ROOT = Path(__file__).parent / "templates"


def derive_recipe_id(template_id: str, use_case_id: str) -> str:
    """Mirror of Rust's `derive_recipe_id` — UUIDv5 over
    namespace + "<template_id>:<use_case_id>". MUST match Rust output
    byte-for-byte; the cross-language canary in `--self-test` enforces this."""
    name = f"{template_id}:{use_case_id}"
    return str(uuid.uuid5(RECIPE_DERIVATION_NAMESPACE, name))


def convert_template(template: dict) -> tuple[dict, int, int]:
    """Return (converted_template, ucs_converted, ucs_already_recipe_ref).
    Idempotent: a UC that's already in `recipe_ref` shape is left alone.
    Mutates a copy; the original `template` is untouched."""
    converted = json.loads(json.dumps(template))  # deep copy
    template_id = converted.get("id")
    if not template_id:
        raise ValueError("template missing id field")
    payload = converted.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("template missing payload object")

    use_cases = payload.get("use_cases")
    if not isinstance(use_cases, list):
        return converted, 0, 0  # no use_cases — nothing to convert

    converted_count = 0
    skipped_count = 0
    new_use_cases = []
    for uc in use_cases:
        if not isinstance(uc, dict):
            new_use_cases.append(uc)
            continue
        if "recipe_ref" in uc:
            # Already converted — leave as-is. Idempotency case.
            new_use_cases.append(uc)
            skipped_count += 1
            continue
        uc_id = uc.get("id")
        if not uc_id:
            raise ValueError(
                f"template {template_id} has a use_case with no id field"
            )
        recipe_id = derive_recipe_id(template_id, uc_id)
        new_use_cases.append({
            "recipe_ref": {
                "id": recipe_id,
                "version": "1.0.0",
                "bindings": {},
            },
        })
        converted_count += 1

    payload["use_cases"] = new_use_cases
    return converted, converted_count, skipped_count


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


def self_test() -> int:
    """Verify cross-language parity + basic invariants. No deps required."""
    failures: list[str] = []

    # Canary parity with Rust.
    actual_canary = derive_recipe_id(*CANARY_INPUT)
    if actual_canary != CANARY_OUTPUT:
        failures.append(
            f"CANARY MISMATCH: derive_recipe_id{CANARY_INPUT}\n"
            f"  expected: {CANARY_OUTPUT}\n"
            f"  got:      {actual_canary}\n"
            f"  cross-language parity broken — Rust + Python disagree."
        )

    # Determinism.
    a = derive_recipe_id("foo", "uc_x")
    b = derive_recipe_id("foo", "uc_x")
    if a != b:
        failures.append("non-deterministic: same inputs produced different ids")

    # Distinct inputs → distinct outputs.
    if derive_recipe_id("a", "uc") == derive_recipe_id("b", "uc"):
        failures.append("template_id collision: 'a:uc' vs 'b:uc' produced same id")
    if derive_recipe_id("t", "uc1") == derive_recipe_id("t", "uc2"):
        failures.append("use_case_id collision: 't:uc1' vs 't:uc2' produced same id")

    # convert_template behaviour: inline UC → recipe_ref shape.
    fixture = {
        "id": "test-template",
        "payload": {
            "use_cases": [
                {"id": "uc_x", "name": "X", "tools": ["http"]},
                {"id": "uc_y", "name": "Y"},
            ],
        },
    }
    out, n_conv, n_skip = convert_template(fixture)
    if n_conv != 2 or n_skip != 0:
        failures.append(f"convert_template counts wrong: conv={n_conv}, skip={n_skip}")
    new_ucs = out["payload"]["use_cases"]
    expected_x = derive_recipe_id("test-template", "uc_x")
    expected_y = derive_recipe_id("test-template", "uc_y")
    if new_ucs[0] != {
        "recipe_ref": {"id": expected_x, "version": "1.0.0", "bindings": {}}
    }:
        failures.append(f"uc_x converted to wrong shape: {new_ucs[0]}")
    if new_ucs[1] != {
        "recipe_ref": {"id": expected_y, "version": "1.0.0", "bindings": {}}
    }:
        failures.append(f"uc_y converted to wrong shape: {new_ucs[1]}")

    # Idempotency: re-running on already-converted template is a no-op.
    out2, n_conv2, n_skip2 = convert_template(out)
    if n_conv2 != 0 or n_skip2 != 2:
        failures.append(
            f"idempotency broken: re-run produced conv={n_conv2}, skip={n_skip2}"
        )
    if out2 != out:
        failures.append("idempotency broken: re-run mutated the template")

    if failures:
        print("FAILED:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print(f"All self-tests passed. canary={actual_canary}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert template UCs from inline to recipe_ref (Stage B Phase 2.2)"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write changes. Default is dry-run.",
    )
    parser.add_argument(
        "--template-id",
        type=str,
        default=None,
        help="If set, run on a single template only.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run built-in cross-language parity tests and exit.",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    paths = find_templates(args.template_id)
    if not paths:
        print(f"No templates found under {TEMPLATES_ROOT}.", file=sys.stderr)
        return 1

    print(f"Found {len(paths)} template(s). apply={args.apply}\n")

    total_converted = 0
    total_skipped = 0
    written = 0
    failures: list[tuple[Path, str]] = []

    for path in paths:
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
            new_doc, n_conv, n_skip = convert_template(doc)
        except Exception as e:
            failures.append((path, str(e)))
            print(f"  [FAIL] {path.relative_to(TEMPLATES_ROOT.parent)}: {e}",
                  file=sys.stderr)
            continue

        total_converted += n_conv
        total_skipped += n_skip

        rel = path.relative_to(TEMPLATES_ROOT.parent)
        if n_conv == 0 and n_skip == 0:
            print(f"  [skip] {rel} — no use_cases")
            continue
        if n_conv == 0:
            print(f"  [noop] {rel} — already converted ({n_skip} ucs)")
            continue
        if args.apply:
            # Preserve the original 2-space indent + trailing newline that the
            # template files use, so git diff is readable.
            path.write_text(
                json.dumps(new_doc, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            written += 1
            print(f"  [write] {rel} — {n_conv} ucs converted ({n_skip} already)")
        else:
            print(f"  [DRY ]  {rel} — would convert {n_conv} ucs ({n_skip} already)")

    print()
    print(f"Templates processed: {len(paths)}")
    print(f"UCs converted:       {total_converted}")
    print(f"UCs already done:    {total_skipped}")
    if args.apply:
        print(f"Files written:       {written}")
    else:
        print("DRY-RUN — no files written. Pass --apply to write.")

    if failures:
        print(f"\n{len(failures)} template(s) failed:", file=sys.stderr)
        for path, err in failures:
            print(f"  {path}: {err}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
