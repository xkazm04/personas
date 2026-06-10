#!/usr/bin/env python3
"""
Stage B Phase 2.4 — extract recipe seed data from pre-2.2 template
content and emit a single canonical seeds JSON file.

Why this exists: Phase 2.2 (commit 34f483f1f) collapsed every template's
inline use_case content into recipe_ref pointers, on the premise that the
recipe DB rows would be derived once via Phase 1b's migration script.
That works for a developer who runs the dev app, but breaks adoption on
a fresh install where the recipe DB starts empty. Phase 2.4 closes the
loop by embedding the recipe data in the Rust binary and seeding it
during app startup.

Mechanism: walk every template at the parent commit of 34f483f1f (the
last commit before 2.2 conversion), pull the inline use_cases, mirror
the Rust `derive_recipes_from_template_inner` synthesizers
(`synthesize_prompt_template`, `extract_uc_*`, `extract_category`) to
produce the same recipe payload that the Phase 1b migration script
would have produced, and write the result to
`scripts/templates/_recipe_seeds.json` (the underscore prefix excludes
it from the Vite glob in `templateCatalog.ts`).

The deterministic recipe id (UUIDv5 over namespace +
"<template_id>:<use_case_id>") is computed identically to the Rust
side; the canary 8205b2bf-22a9-5821-9783-0e1150d620f5 for
("incident-logger", "uc_log_incident") asserts cross-language parity.

Idempotent: re-running over the same commit produces byte-identical
output. Re-running with a different `--from-ref` regenerates the seeds
against that commit's templates instead.

CAUTION — the checked-in bundle is no longer a pure function of the
default ref. Nine recipes (qa-guardian, solution-architect, code-reviewer,
release-manager, security-sentinel, docs-steward UCs) were appended after
34f483f1f^ from templates converted later; a blind re-run from the default
ref DROPS them (291 vs 298 rows). Before regenerating, diff the output's
id set against the checked-in bundle and re-merge anything missing, or
prefer an in-place transform of the checked-in file for field-level fixes
(see the 2026-06-10 title/category rewrite).

Usage:
  python scripts/generate-recipe-seeds.py             # default ref
  python scripts/generate-recipe-seeds.py --from-ref <sha>
  python scripts/generate-recipe-seeds.py --self-test
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import uuid
from pathlib import Path

# Frozen namespace — MUST match
# src-tauri/src/commands/recipes/recipe_derivation.rs::RECIPE_DERIVATION_NAMESPACE
# and scripts/convert-templates-to-recipe-refs.py.
RECIPE_DERIVATION_NAMESPACE = uuid.UUID("6f8d4f9c-3a07-4b1e-9c9d-8a3f6b2c5e10")

CANARY_INPUT = ("incident-logger", "uc_log_incident")
CANARY_OUTPUT = "8205b2bf-22a9-5821-9783-0e1150d620f5"

# The commit BEFORE Phase 2.2's catalog conversion. Templates at this ref
# still carry inline use_cases — the ground truth for recipe content.
DEFAULT_FROM_REF = "34f483f1f^"

REPO_ROOT = Path(__file__).parent.parent
TEMPLATES_DIR_REL = "scripts/templates"
SEEDS_OUTPUT_REL = "scripts/templates/_recipe_seeds.json"


def derive_recipe_id(template_id: str, use_case_id: str) -> str:
    return str(uuid.uuid5(RECIPE_DERIVATION_NAMESPACE, f"{template_id}:{use_case_id}"))


def list_template_paths_at_ref(ref: str) -> list[str]:
    """Return repo-relative paths of canonical templates at `ref`.
    Excludes overlay locale variants (filenames with extra dots) and any
    underscore-prefixed paths (debug fixtures + the seeds file itself).
    """
    out = subprocess.run(
        ["git", "ls-tree", "-r", "--name-only", ref, TEMPLATES_DIR_REL],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    paths: list[str] = []
    for line in out.stdout.splitlines():
        if not line.endswith(".json"):
            continue
        if "/_" in line or line.startswith("scripts/templates/_"):
            continue
        # Drop overlay variants like "foo.cs.json" — only the canonical
        # "foo.json" carries inline use_cases. Locale overlays patch
        # individual fields and never own the use_case shape.
        stem = line.rsplit("/", 1)[-1].removesuffix(".json")
        if "." in stem:
            continue
        paths.append(line)
    return sorted(paths)


def read_template_at_ref(ref: str, path: str) -> dict:
    out = subprocess.run(
        ["git", "show", f"{ref}:{path}"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return json.loads(out.stdout)


# -- Mirrors of Rust extractors in commands/recipes/recipe_derivation.rs ----

def extract_uc_name(uc: dict) -> str | None:
    """Mirror of Rust's `extract_uc_name`: name → title → id. Inline UCs
    name themselves with `title` (the DesignUseCase shape); without that
    arm every derived recipe falls through to the technical `uc_*` id.
    """
    name = uc.get("name")
    if isinstance(name, str):
        return name
    title = uc.get("title")
    if isinstance(title, str):
        return title
    uc_id = uc.get("id")
    if isinstance(uc_id, str):
        return uc_id
    return None


def extract_uc_category(uc: dict) -> str | None:
    """Mirror of Rust's `extract_uc_category`: the UC-level category wins
    over the template-level one (the UC declares what the work is)."""
    cat = uc.get("category")
    return cat if isinstance(cat, str) else None


def extract_uc_description(uc: dict) -> str | None:
    """Mirror of Rust's `extract_uc_description`: prefer `description`,
    fall back to `capability_summary`, truncate to 500 chars (with the
    Rust side's "…" suffix when truncated).
    """
    raw = uc.get("description")
    if not isinstance(raw, str):
        raw = uc.get("capability_summary")
    if not isinstance(raw, str):
        return None
    if len(raw) > 500:
        return raw[:499] + "…"  # matches Rust's char-counted truncation
    return raw


def extract_uc_tools_json(uc: dict) -> str | None:
    tools = uc.get("tools")
    if tools is None:
        return None
    return json.dumps(tools, separators=(",", ":"))


def extract_category(payload: dict) -> str | None:
    """Mirror of Rust's `extract_category`: persona.category first, then
    payload.category. Strings pass through; arrays return their first entry.
    """
    persona = payload.get("persona")
    persona_cat = persona.get("category") if isinstance(persona, dict) else None
    cat = persona_cat if persona_cat is not None else payload.get("category")
    if isinstance(cat, str):
        return cat
    if isinstance(cat, list) and cat and isinstance(cat[0], str):
        return cat[0]
    return None


def synthesize_prompt_template(uc: dict) -> str:
    """Serialize the entire UC dict into the recipe's prompt_template
    field. Phase 1b stores the UC JSON here verbatim so that
    hydrate_recipe_refs can round-trip back to the inline shape.

    Important: the JSON output MUST match Rust's serde_json output
    byte-for-byte for two reasons. First, hydrate_recipe_refs relies on
    serde_json::from_str(prompt_template) to deserialize. Second, the
    derive_recipes_from_template idempotency check compares
    `prev.prompt_template == synthesize_prompt_template(uc)` — drift
    here causes spurious "Updated" actions on every re-derive.

    Rust's `serde_json::to_string` writes:
    - keys in insertion order (which matches Python's dict ordering for
      JSON loaded with the default decoder)
    - no trailing whitespace, no spaces between separators
    - non-ASCII characters as escape sequences \\uXXXX (we mirror with
      ensure_ascii=True)
    """
    return json.dumps(uc, separators=(",", ":"), ensure_ascii=True)


# -- Seed-file builder -------------------------------------------------------

def build_seed_entry(template_id: str, payload: dict, uc: dict) -> dict | None:
    uc_id = uc.get("id")
    if not isinstance(uc_id, str) or not uc_id.strip():
        # Inline UC missing id is a template authoring bug at the source
        # commit; skip rather than emit a malformed seed entry.
        return None

    uc_name = extract_uc_name(uc)
    return {
        "id": derive_recipe_id(template_id, uc_id),
        "source_template_id": template_id,
        "source_use_case_id": uc_id,
        "source_use_case_name": uc_name,
        "source_version": "1.0.0",
        "name": uc_name or uc_id,
        "description": extract_uc_description(uc),
        "category": extract_uc_category(uc) or extract_category(payload),
        "prompt_template": synthesize_prompt_template(uc),
        "tool_requirements": extract_uc_tools_json(uc),
        "tags": json.dumps([template_id, "derived"], separators=(",", ":")),
    }


def build_seeds_file(ref: str) -> dict:
    template_paths = list_template_paths_at_ref(ref)
    seeds: list[dict] = []
    skipped: list[str] = []
    for path in template_paths:
        try:
            doc = read_template_at_ref(ref, path)
        except Exception as e:
            skipped.append(f"{path}: read failed ({e})")
            continue

        template_id = doc.get("id")
        if not isinstance(template_id, str):
            skipped.append(f"{path}: missing id")
            continue
        payload = doc.get("payload")
        if not isinstance(payload, dict):
            skipped.append(f"{path}: missing payload")
            continue
        use_cases = payload.get("use_cases")
        if not isinstance(use_cases, list):
            skipped.append(f"{path}: no use_cases[]")
            continue

        for uc in use_cases:
            if not isinstance(uc, dict):
                continue
            entry = build_seed_entry(template_id, payload, uc)
            if entry is not None:
                seeds.append(entry)

    seeds.sort(key=lambda r: (r["source_template_id"], r["source_use_case_id"]))
    return {
        "version": 1,
        "ref": ref,
        "recipe_count": len(seeds),
        "skipped_templates": skipped,
        "recipes": seeds,
    }


def self_test() -> int:
    failures: list[str] = []

    actual_canary = derive_recipe_id(*CANARY_INPUT)
    if actual_canary != CANARY_OUTPUT:
        failures.append(
            f"canary mismatch: got {actual_canary} expected {CANARY_OUTPUT}"
        )

    sample = {"id": "uc_x", "name": "X", "tools": ["a", "b"], "description": "y"}
    pt = synthesize_prompt_template(sample)
    if json.loads(pt) != sample:
        failures.append(f"synthesize_prompt_template not round-trippable: {pt}")

    # Compact JSON: no whitespace.
    if " " in pt:
        failures.append(f"synthesize_prompt_template has whitespace: {pt}")

    long = "x" * 600
    desc = extract_uc_description({"description": long})
    if not desc or not desc.endswith("…") or len(desc) != 500:
        failures.append(f"truncation broken: len={len(desc) if desc else 0}")

    if extract_category({"persona": {"category": "ops"}}) != "ops":
        failures.append("persona.category extraction broken")
    if extract_category({"category": ["ops", "eng"]}) != "ops":
        failures.append("array category extraction broken")
    if extract_category({"category": "ops"}) != "ops":
        failures.append("string category extraction broken")
    if extract_category({}) is not None:
        failures.append("missing-category should be None")

    if extract_uc_name({"id": "uc_x", "title": "Approval Workflow"}) != "Approval Workflow":
        failures.append("uc title fallback broken")
    if extract_uc_name({"id": "uc_x", "name": "Custom", "title": "T"}) != "Custom":
        failures.append("explicit uc name should beat title")
    if extract_uc_category({"category": "analysis"}) != "analysis":
        failures.append("uc category extraction broken")
    if extract_uc_category({"category": 3}) is not None:
        failures.append("non-string uc category should be None")

    if failures:
        print("FAILED:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print(f"All self-tests passed. canary={actual_canary}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-ref",
        default=DEFAULT_FROM_REF,
        help=f"Git ref to read template content from (default: {DEFAULT_FROM_REF})",
    )
    parser.add_argument(
        "--output",
        default=SEEDS_OUTPUT_REL,
        help=f"Seed file path (default: {SEEDS_OUTPUT_REL})",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run cross-language parity self-tests and exit.",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    print(f"Building recipe seeds from ref={args.from_ref}...")
    seeds = build_seeds_file(args.from_ref)
    out_path = REPO_ROOT / args.output

    # Pretty-print top-level metadata; compact-print individual recipe entries
    # for line-stable diffs (one recipe per line).
    out_path.write_text(
        json.dumps(seeds, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {seeds['recipe_count']} recipe seeds to {out_path}")
    if seeds["skipped_templates"]:
        print(f"\n{len(seeds['skipped_templates'])} template(s) skipped:")
        for s in seeds["skipped_templates"]:
            print(f"  - {s}")
        return 2 if any("read failed" in s for s in seeds["skipped_templates"]) else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
