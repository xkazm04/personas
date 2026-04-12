#!/usr/bin/env python3
"""
Guide Screenshot Runner

Drives the running Personas desktop app (with --features test-automation)
through a set of YAML recipes, capturing one PNG per topic per locale into
the personas-web marketing site.

Prerequisites:
    1. Start the app:  npm run tauri dev -- --features test-automation
    2. `pip install httpx pyyaml`  (or run via `uvx --with httpx --with pyyaml python runner.py`)

Usage:
    python runner.py                               # all recipes, all locales
    python runner.py --topic installing-personas   # single recipe
    python runner.py --locales en,de,ja            # subset of locales
    python runner.py --max-width 960               # smaller output
    python runner.py --dry-run                     # list what would run

Output:
    personas-web/public/imgs/guide/topics/<topic-id>-<locale>.png
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import httpx
import yaml

# ── Constants ───────────────────────────────────────────────────────────

BASE_URL = "http://127.0.0.1:17320"
TIMEOUT = 30.0

# All 14 languages shipped by the desktop + marketing apps.
ALL_LOCALES = [
    "en", "zh", "ar", "hi", "ru", "id", "es", "fr",
    "bn", "ja", "vi", "de", "ko", "cs",
]

DEFAULT_MAX_WIDTH = 1280  # lightweight, not HD — guide images do not need retina
DARK_THEME = "dark-midnight"

REPO_ROOT = Path(__file__).resolve().parent.parent.parent  # tools/guide-screenshots/runner.py → repo root
WEB_ROOT_DEFAULT = REPO_ROOT.parent / "personas-web"
OUTPUT_SUBDIR = Path("public") / "imgs" / "guide" / "topics"
RECIPES_DIR = Path(__file__).resolve().parent / "recipes"

# ── HTTP helpers ────────────────────────────────────────────────────────

class AppClient:
    def __init__(self, base_url: str = BASE_URL):
        self.http = httpx.Client(base_url=base_url, timeout=TIMEOUT)

    def health(self) -> bool:
        try:
            r = self.http.get("/health")
            return r.status_code == 200
        except httpx.RequestError:
            return False

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        r = self.http.post(path, json=body)
        r.raise_for_status()
        try:
            return r.json()
        except json.JSONDecodeError:
            return {"raw": r.text}

    def get(self, path: str) -> dict[str, Any]:
        r = self.http.get(path)
        r.raise_for_status()
        return r.json()

    # ── High-level verbs used by recipes ────────────────────────────

    def set_language(self, lang: str) -> None:
        # Desktop uses a Zustand store with persist() — setting via
        # setState keeps the persisted key in localStorage in sync.
        js = (
            f"(() => {{ "
            f"const m = window.__STORES__ || {{}}; "
            f"if (window.useI18nStore) {{ window.useI18nStore.getState().setLanguage('{lang}'); }} "
            f"else {{ "
            f"  import('/src/stores/i18nStore.ts').then(m => m.useI18nStore.getState().setLanguage('{lang}')); "
            f"}} "
            f"}})()"
        )
        self.post("/eval", {"js": js})

    def set_theme(self, theme_id: str) -> None:
        js = (
            f"(() => {{ "
            f"if (window.useThemeStore) {{ window.useThemeStore.getState().setTheme('{theme_id}'); }} "
            f"else {{ document.documentElement.setAttribute('data-theme', '{theme_id}'); }} "
            f"}})()"
        )
        self.post("/eval", {"js": js})

    def navigate(self, section: str) -> None:
        self.post("/navigate", {"section": section})

    def click_testid(self, test_id: str) -> None:
        self.post("/click-testid", {"test_id": test_id})

    def fill_field(self, test_id: str, value: str) -> None:
        self.post("/fill-field", {"test_id": test_id, "value": value})

    def wait_for(self, selector: str, timeout_ms: int = 5000) -> None:
        self.post("/wait", {"selector": selector, "timeout_ms": timeout_ms})

    def screenshot(self, save_dir: Path, filename: str, max_width: int) -> dict[str, Any]:
        return self.post(
            "/screenshot",
            {
                "save_dir": str(save_dir),
                "filename": filename,
                "max_width": max_width,
            },
        )

# ── Recipe execution ────────────────────────────────────────────────────

KNOWN_STEPS = {"navigate", "click_testid", "fill_field", "wait_for", "wait", "set_theme"}


def execute_steps(app: AppClient, steps: list[dict[str, Any]]) -> None:
    """Run a recipe's step list. Each step is a single-key dict."""
    for step in steps:
        if not isinstance(step, dict) or len(step) != 1:
            raise ValueError(f"Each step must be a single-key dict, got: {step!r}")
        (verb, arg), = step.items()
        if verb not in KNOWN_STEPS:
            raise ValueError(f"Unknown step verb: {verb!r}. Known: {sorted(KNOWN_STEPS)}")

        if verb == "navigate":
            app.navigate(arg)
        elif verb == "click_testid":
            app.click_testid(arg)
        elif verb == "fill_field":
            # arg is {test_id, value}
            app.fill_field(arg["test_id"], arg["value"])
        elif verb == "wait_for":
            app.wait_for(arg if isinstance(arg, str) else arg["selector"])
        elif verb == "wait":
            time.sleep(float(arg) / 1000.0)  # milliseconds
        elif verb == "set_theme":
            app.set_theme(arg)


def run_recipe(
    app: AppClient,
    recipe_path: Path,
    locales: list[str],
    output_dir: Path,
    max_width: int,
    dry_run: bool,
) -> tuple[int, int]:
    with open(recipe_path, encoding="utf-8") as f:
        recipe = yaml.safe_load(f)

    topic_id = recipe["topic"]
    recipe_locales = recipe.get("locales") or locales
    steps = recipe.get("steps") or []

    ok = 0
    fail = 0
    for locale in recipe_locales:
        out_name = f"{topic_id}-{locale}.png"
        if dry_run:
            print(f"  would capture {out_name}")
            ok += 1
            continue

        try:
            app.set_theme(DARK_THEME)
            app.set_language(locale)
            time.sleep(0.25)  # let React re-render after locale/theme change
            execute_steps(app, steps)
            time.sleep(0.4)  # let animations settle before capture
            result = app.screenshot(output_dir, out_name, max_width)
            print(f"  ✓ {out_name}  ({result.get('width')}×{result.get('height')})")
            ok += 1
        except Exception as e:  # noqa: BLE001 — surface any recipe failure
            print(f"  ✗ {out_name}  — {e}")
            fail += 1
    return ok, fail


# ── CLI ─────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Generate guide screenshots per topic × locale.")
    parser.add_argument("--topic", help="Run a single recipe by topic id.")
    parser.add_argument("--locales", help="Comma-separated locale codes. Default: all 14.")
    parser.add_argument("--max-width", type=int, default=DEFAULT_MAX_WIDTH,
                        help=f"Resize wider captures to this width. Default: {DEFAULT_MAX_WIDTH}.")
    parser.add_argument("--web-root", type=Path, default=WEB_ROOT_DEFAULT,
                        help=f"personas-web repo root. Default: {WEB_ROOT_DEFAULT}")
    parser.add_argument("--dry-run", action="store_true", help="Do not capture, just print the plan.")
    args = parser.parse_args()

    locales = args.locales.split(",") if args.locales else ALL_LOCALES
    output_dir = args.web_root / OUTPUT_SUBDIR

    if not RECIPES_DIR.exists():
        print(f"ERROR: recipes dir not found: {RECIPES_DIR}", file=sys.stderr)
        return 2

    recipes = sorted(RECIPES_DIR.glob("*.yaml"))
    if args.topic:
        recipes = [r for r in recipes if r.stem == args.topic]
        if not recipes:
            print(f"ERROR: no recipe for topic {args.topic!r}", file=sys.stderr)
            return 2

    if not recipes:
        print(f"No recipes found in {RECIPES_DIR}")
        return 0

    app = AppClient()
    if not args.dry_run and not app.health():
        print("ERROR: Personas test server not reachable on port 17320.", file=sys.stderr)
        print("Start it with:  npm run tauri dev -- --features test-automation", file=sys.stderr)
        return 3

    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output dir:  {output_dir}")
    print(f"Recipes:     {len(recipes)}")
    print(f"Locales:     {', '.join(locales)}")
    print(f"Max width:   {args.max_width}px  (dark theme only)")
    print()

    total_ok = 0
    total_fail = 0
    for recipe_path in recipes:
        print(f"[{recipe_path.stem}]")
        ok, fail = run_recipe(app, recipe_path, locales, output_dir, args.max_width, args.dry_run)
        total_ok += ok
        total_fail += fail
        print()

    print(f"Done.  {total_ok} ok, {total_fail} failed.")
    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
