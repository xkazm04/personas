#!/usr/bin/env python3
"""
Post-sweep verification of the credential-category-match fix.

For each adopted T: persona, drives the live UI to the Connectors tab and
inspects what AgentCredentialDemands renders. The bug fix widened the
match in useUnfulfilledCredentials so a credential with service_type
`github` now satisfies a tool requirement of `source_control` (the
category-shaped requirement V3 templates emit).

Before the fix, every category-shaped requirement showed in the demand
list with "no matching credentials". After the fix, those slots get
flagged as `reusable` (matching credential exists; just needs link),
which surfaces in the UI as "Reuse existing credential" affordance.

Verification logic:
  1. /navigate personas
  2. For each T: persona:
     a. /select-agent
     b. /open-editor-tab connectors
     c. Query DOM for demand cards + reuse affordances
     d. Aggregate counts
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:17320"
DB_PATH = Path(os.environ["APPDATA"]) / "com.personas.desktop" / "personas.db"

client = httpx.Client(base_url=BASE, timeout=60.0)


def list_t_personas() -> list[dict]:
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    try:
        return [
            dict(r)
            for r in c.execute(
                "SELECT id, name FROM personas WHERE name LIKE 'T:%' ORDER BY name"
            ).fetchall()
        ]
    finally:
        c.close()


def query_count(selector: str) -> int:
    """Return how many DOM elements match `selector`. Bridge /query returns
    an array of element descriptors; len of that array is our count."""
    r = client.post("/query", json={"selector": selector})
    try:
        arr = r.json()
        return len(arr) if isinstance(arr, list) else 0
    except Exception:
        return 0


def find_text_count(text: str) -> int:
    """Return how many visible elements contain `text`."""
    r = client.post("/find-text", json={"text": text})
    try:
        arr = r.json()
        return len(arr) if isinstance(arr, list) else 0
    except Exception:
        return 0


def measure_persona(persona_id: str, name: str) -> dict:
    """Drive the UI for one persona and return a count snapshot."""
    # Select + open Connectors tab
    sel = client.post("/select-agent", json={"name_or_id": persona_id}).json()
    if not sel.get("success"):
        return {"name": name, "error": f"select failed: {sel.get('error')}"}

    # The connectors tab id is 'connectors' per editor tab convention
    tab = client.post("/open-editor-tab", json={"tab": "connectors"}).json()
    if not tab.get("success"):
        return {"name": name, "error": f"open-connectors failed: {tab.get('error')}"}
    time.sleep(1.5)

    # AgentCredentialDemands renders nothing when totalDemands == 0 or
    # unfulfilledCount == 0. When it renders, each demand becomes a card
    # with a connector icon and either a "Set up" or "Reuse" affordance.
    # We probe the rendered DOM:
    #   - "Set up" button → unfulfilled with no reusable credential
    #   - "Reuse existing" / "Reuse" button → unfulfilled BUT a candidate exists
    #   - "ConnectorStatusCard" → linked-and-tested slots in the lower section
    setup_btns = find_text_count("Set up")
    reuse_btns = find_text_count("Reuse")
    connector_demand_cards = query_count(
        '[class*="rounded-modal"][class*="border-primary"]'
    )

    # Also pull the banner counts from the demand summary. The banner shows
    # something like "3 credentials needed · 2 of 5 fulfilled · 1 reusable".
    # We grab anything matching that pattern.
    needed_hits = find_text_count("credentials needed")

    return {
        "name": name,
        "id": persona_id[:8],
        "setup_buttons": setup_btns,
        "reuse_buttons": reuse_btns,
        "demand_cards": connector_demand_cards,
        "banner_present": needed_hits > 0,
    }


def main():
    personas = list_t_personas()
    if not personas:
        print("No T: personas — run the adoption sweep first.")
        return 1

    # Prime the UI
    client.post("/navigate", json={"section": "personas"})
    time.sleep(1)
    client.post("/refresh-personas")
    time.sleep(0.5)

    print(f"Inspecting credential demands UI for {len(personas)} personas\n")
    print(
        f"{'Persona':<42}{'Demand':>8}{'Setup':>7}{'Reuse':>7}{'Banner':>8}"
    )
    print("-" * 72)

    sums = {"demand_cards": 0, "setup_buttons": 0, "reuse_buttons": 0}
    banner_count = 0

    for p in personas:
        m = measure_persona(p["id"], p["name"])
        if "error" in m:
            print(f"{p['name'][:40]:<42}  ERROR: {m['error']}")
            continue
        for k in sums:
            sums[k] += m.get(k, 0)
        if m["banner_present"]:
            banner_count += 1
        print(
            f"{p['name'][:40]:<42}"
            f"{m['demand_cards']:>8}"
            f"{m['setup_buttons']:>7}"
            f"{m['reuse_buttons']:>7}"
            f"{'YES' if m['banner_present'] else 'no':>8}"
        )

    print("-" * 72)
    print(
        f"{'TOTAL':<42}"
        f"{sums['demand_cards']:>8}"
        f"{sums['setup_buttons']:>7}"
        f"{sums['reuse_buttons']:>7}"
        f"{banner_count:>8}"
    )
    print()
    print("Interpretation:")
    print("  - Demand: number of demand cards rendered (= unfulfilled slots).")
    print("  - Setup:  'Set up' button hits = slots without any candidate.")
    print("  - Reuse:  'Reuse' button hits = slots WITH a viable candidate")
    print("            in the vault. Pre-fix was ~0 for category-shaped")
    print("            requirements; post-fix should be non-zero on personas")
    print("            that use category names like 'source_control',")
    print("            'codebase', 'messaging', 'knowledge_base'.")
    print("  - Banner: count of personas where the 'X credentials needed'")
    print("            summary banner appears. Lower is better, but a banner")
    print("            with high Reuse count means the fix is working.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
