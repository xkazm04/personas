r"""Generate the onboarding-bench scenario suite (~300) from the REAL catalog.

Everything is grounded in shipped data, not invented prose:
  * `scripts/templates/_recipe_seeds.json` — 299 recipes, each a concrete business
    job (name, description, category, source_template_id).
  * `scripts/templates/<area>/*.json`      — 124 templates: business area +
    `service_flow` (the source→destination service chain) + use_cases.
  * `scripts/connectors/builtin/*.json`    — 133 connectors grouped by category.

Two axes carry most of the signal:

  VAGUENESS  specified | partial | vague | extreme
    How much of the job the user states. Weighted toward vague/extreme because
    "guiding vague needs" is the thing we most need to prove.

  CONNECTOR  choice | named | none
    A template's `service_flow` is either CATEGORY-valued ("email", "messaging",
    "CRM") — the build MUST ask a connector_category question and the user picks
    a specific credential — or CONCRETE-valued ("GitHub", "Linear", "Stripe") —
    the build should bind directly and NOT ask. That gives a free ask/don't-ask
    oracle straight from real data. For `choice` we always pick a NON-default
    connector (outlook, not gmail) and record the obvious default as a `decoy`,
    so a build that silently assumes the popular option fails the scenario.

Usage:  python tools/test-mcp/onboardingbench/generate_scenarios.py [--out DIR]
"""
from __future__ import annotations

import argparse
import collections
import glob
import hashlib
import json
import os
import re
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

REPO = Path(__file__).resolve().parents[3]
TPL_DIR = REPO / "scripts" / "templates"
CONN_DIR = REPO / "scripts" / "connectors" / "builtin"
DEFAULT_OUT = REPO / "docs" / "tests" / "onboarding-bench" / "scenarios"

# Business areas = template subdirectories.
AREAS = [
    "content", "development", "devops", "email", "finance", "hr", "legal",
    "marketing", "productivity", "project-management", "research", "sales",
    "security", "support",
]

# service_flow token -> connector category. The catalog is case-inconsistent
# ("messaging"/"Messaging"/"Messages"), so normalise hard.
SERVICE_TO_CATEGORY = {
    "email": "email",
    "messaging": "messaging", "messages": "messaging", "in-app messaging": "messaging",
    "knowledge base": "knowledge_base",
    "spreadsheet": "spreadsheet",
    "crm": "crm",
    "source control": "source_control",
    "local database": "database", "database": "database",
    "analytics tool": "analytics",
    "web research": "research",
    "finance platform": "finance",
}
# service_flow tokens that name a CONCRETE connector -> the build should bind it
# without asking a connector_category question.
SERVICE_TO_NAMED = {
    "linear": "linear", "jira": "jira", "github": "github", "stripe": "stripe",
    "supabase": "supabase", "codebase": "codebase", "notion": "notion",
    "slack": "slack", "gmail": "gmail",
}

# For a category we deliberately pick a NON-obvious connector and name the obvious
# one as the decoy the build must not silently assume.
CHOICE_PICKS = {
    "email": ("microsoft_outlook", "gmail"),
    "messaging": ("microsoft_teams", "slack"),
    "spreadsheet": ("airtable", "google_sheets"),
    "knowledge_base": ("confluence", "notion"),
    "crm": ("pipedrive", "hubspot"),
    "source_control": ("gitlab", "github"),
    "project_management": ("linear", "jira"),
    "storage": ("dropbox", "google_drive"),
    "database": ("neon", "postgres"),
    "research": ("arxiv", "news_api"),
}

# Vagueness mix — weighted toward vague/extreme (the thing under test).
TIER_WEIGHTS = [("vague", 40), ("partial", 25), ("specified", 20), ("extreme", 15)]
TIER_QUESTION_BAND = {
    "specified": (0, 1),   # well-designed prompt: should barely ask
    "partial": (1, 3),
    "vague": (2, 5),
    "extreme": (2, 6),
}


def _h(s: str) -> int:
    return int(hashlib.sha256(s.encode("utf-8")).hexdigest()[:8], 16)


def load_connectors() -> dict[str, list[str]]:
    by_cat: dict[str, list[str]] = collections.defaultdict(list)
    for f in glob.glob(str(CONN_DIR / "*.json")):
        try:
            c = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        cat = c.get("category")
        name = c.get("name")
        if cat and name:
            by_cat[cat].append(name)
    return {k: sorted(v) for k, v in by_cat.items()}


def load_templates() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for area in AREAS:
        for f in glob.glob(str(TPL_DIR / area / "*.json")):
            try:
                d = json.load(open(f, encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(d, dict) or "id" not in d:
                continue
            payload = d.get("payload") or {}
            out[d["id"]] = {
                "id": d["id"],
                "name": d.get("name") or d["id"],
                "description": d.get("description") or "",
                "area": area,
                "service_flow": d.get("service_flow") or payload.get("service_flow") or [],
                "use_cases": payload.get("use_cases") or [],
                "adoption_questions": payload.get("adoption_questions") or [],
            }
    return out


def classify_service_flow(service_flow: list[str], connectors: dict[str, list[str]]):
    """-> ('choice', category, pick, decoy) | ('named', connector) | ('none',)"""
    named = None
    for raw in service_flow:
        t = str(raw).strip().lower()
        if t in SERVICE_TO_NAMED and named is None:
            named = SERVICE_TO_NAMED[t]
        cat = SERVICE_TO_CATEGORY.get(t)
        if cat and cat in CHOICE_PICKS and len(connectors.get(cat, [])) >= 2:
            pick, decoy = CHOICE_PICKS[cat]
            if pick in connectors.get(cat, []) and decoy in connectors.get(cat, []):
                return ("choice", cat, pick, decoy)
    if named:
        return ("named", named)
    return ("none",)


def _clean(text: str) -> str:
    """Seed prose carries mojibake (`�`) and arrows from the original export."""
    t = (text or "").replace("�", "-").replace("→", "to").replace("–", "-")
    return re.sub(r"\s+", " ", t).strip()


def _first_sentence(text: str, limit: int = 220) -> str:
    text = _clean(text)
    m = re.split(r"(?<=[.!?])\s", text)
    s = m[0] if m else text
    return (s[:limit].rstrip() + "...") if len(s) > limit else s


# Recipe category -> the trigger the composed persona should end up with. Used
# both to phrase a `specified` intent concretely and to assert trigger_type.
_CATEGORY_TRIGGER = {
    "reporting": "schedule", "analytics": "schedule", "monitoring": "schedule",
    "maintenance": "schedule", "research": "schedule",
    "ingestion": "event", "notifications": "event", "integration": "event",
    "review": "event", "support": "event", "communication": "event",
    "outreach": "event", "recruiting_ops": "event",
    "analysis": "manual", "content": "manual", "development": "manual",
    "strategy": "manual", "personal_productivity": "manual", "operations": "manual",
    "automation": "schedule", "workflow": "event", "hr": "schedule",
}

_TRIGGER_CLAUSE = {
    "schedule": "Every weekday morning at 8am:",
    "event": "Whenever a new item arrives:",
    "manual": "On demand, when I ask:",
}


def infer_trigger(recipe_category: str | None) -> str:
    return _CATEGORY_TRIGGER.get((recipe_category or "").lower(), "manual")


_DOMAIN_NOUN = {
    "content": "content", "development": "our codebase", "devops": "our deploys",
    "email": "my inbox", "finance": "our finances", "hr": "our people ops",
    "legal": "our contracts", "marketing": "our marketing", "productivity": "my day",
    "project-management": "our projects", "research": "my research",
    "sales": "our sales", "security": "our security", "support": "our support queue",
}


def synth_intents(recipe: dict, tpl: dict, conn_axis, tier: str, trigger: str) -> tuple[str, str]:
    """(vague_intent, true_intent).

    `true_intent` is the hidden ground truth the simulated user answers from;
    `vague_intent` is what the user actually types.

    For the `choice` axis the concrete connector is left as a `{{CONNECTOR}}`
    placeholder — the runner substitutes a credential that ACTUALLY EXISTS in the
    nightly machine's vault (see DESIGN.md "runtime connector resolution"), so the
    suite never asserts on a credential that isn't installed.
    """
    job = _clean(recipe["name"])
    desc = _first_sentence(recipe.get("description") or "")
    area = tpl["area"]
    domain = _DOMAIN_NOUN.get(area, area)
    sf = [_clean(str(s)) for s in (tpl.get("service_flow") or [])]
    src = sf[0] if sf else "the source system"
    dest = sf[-1] if len(sf) > 1 else "somewhere I can read it"
    clause = _TRIGGER_CLAUSE[trigger]

    kind = conn_axis[0]
    conn_token = "{{CONNECTOR}}"
    conn_generic = conn_axis[1].replace("_", " ") if kind == "choice" else ""
    named = conn_axis[1].replace("_", " ") if kind == "named" else ""

    # ---- ground truth: always fully concrete -------------------------------
    true_parts = [f"{job}: {desc}"]
    if kind == "choice":
        true_parts.append(
            f"For the {conn_generic} side use {conn_token} specifically — "
            f"not {{{{DECOY}}}}, which is the popular default I do NOT want."
        )
    elif kind == "named":
        true_parts.append(f"It works against {named}.")
    if len(sf) > 1:
        true_parts.append(f"It reads from {src} and delivers to {dest}.")
    true_parts.append(f"It should run on a {trigger} trigger.")
    true_intent = " ".join(true_parts)

    # ---- what the user types, by tier --------------------------------------
    if tier == "specified":
        # A genuinely WELL-DESIGNED prompt: trigger + job + source + destination
        # + the exact connector. A correct build should barely need to ask.
        bits = [f"{clause} {desc if desc else job}".rstrip(".") + "."]
        if kind == "choice":
            bits.append(f"Use {conn_token} for the {conn_generic} side.")
        elif kind == "named":
            bits.append(f"It runs against {named}.")
        if len(sf) > 1:
            bits.append(f"Read from {src} and deliver the result to {dest}.")
        vague = " ".join(bits)
    elif tier == "partial":
        # The job is clear; the trigger and/or which connector is left open.
        bits = [desc.rstrip(".") + "."]
        if kind == "choice":
            bits.append(f"It should write to our {conn_generic}.")  # category, not which one
        vague = " ".join(bits)
    elif tier == "vague":
        vague = f"I need something to help with {job.lower()} for {domain}."
    else:  # extreme
        vague = f"{domain.capitalize()} is a mess - build me something to sort it out."
    return vague, true_intent


def build_expectations(recipe: dict, tpl: dict, conn_axis, tier: str, trigger: str,
                       *, multi: bool = False) -> dict:
    must_clarify: list[str] = []
    must_not_assume: list[str] = []
    expect_connector_question = False
    expect_no_connector_question = False
    connector_choice = None
    require: list[str] = []
    forbid: list[str] = []

    kind = conn_axis[0]
    if kind == "choice":
        _, cat, pick, decoy = conn_axis
        connector_choice = {"category": cat, "preferred_pick": pick, "decoy": decoy}
        if tier == "specified":
            # The user NAMED the connector in the prompt -> re-asking is over-asking,
            # but the binding must still land (and must not silently be the decoy).
            expect_no_connector_question = True
            must_not_assume.append(f"{decoy} when the prompt named a different {cat.replace('_',' ')} tool")
        else:
            expect_connector_question = True
            must_clarify.append(f"which {cat.replace('_',' ')} connector to use")
            must_not_assume.append(f"{decoy} (the popular default) without asking")
        require = ["{{CONNECTOR}}"]   # resolved by the runner against the live vault
        forbid = ["{{DECOY}}"]
    elif kind == "named":
        expect_no_connector_question = True
        must_not_assume.append(f"a different connector than {conn_axis[1]}")
        require = [conn_axis[1]]

    if tier in ("vague", "extreme"):
        must_clarify += ["what the agent should actually do", "the trigger / cadence", "where the output goes"]
        must_not_assume.append("inventing capabilities the user never asked for")
    if tier == "partial":
        must_clarify.append("the trigger / cadence")
    if tier == "extreme":
        must_clarify.append("narrowing to one concrete first job")

    lo, hi = TIER_QUESTION_BAND[tier]
    n_uc = max(1, len(tpl.get("use_cases") or []))
    if multi:
        min_caps, max_caps = max(2, min(n_uc, 5)), n_uc + 3
    else:
        # A single recipe = ONE job. More than 3 capabilities is scope creep.
        min_caps, max_caps = 1, 3

    return {
        "must_clarify": must_clarify,
        "must_not_assume": must_not_assume,
        "expect_questions": {"min": lo, "max": hi},
        "expect_connector_question": expect_connector_question,
        "expect_no_connector_question": expect_no_connector_question,
        "connector_choice": connector_choice,
        "metadata_assertions": {
            "min_capabilities": min_caps,
            "max_capabilities": max_caps,
            "system_prompt_min_chars": 200,
            "require_connector_service_types": require,
            "forbid_connector_service_types": forbid,
            "require_terminal_phase": "draft_ready",
            # Trigger is inferred from the recipe CATEGORY, which is a weak signal
            # (a "Support Digest" filed under `development` is really a schedule).
            # So it is a judge signal, not a hard gate. Hand-written controls set
            # `expect_trigger_type` with `trigger_assertion: "hard"` instead.
            "expect_trigger_type": trigger,
            "trigger_assertion": "soft",
        },
    }


def assign_tier(key: str, area_counter: collections.Counter) -> str:
    """Deterministic, roughly weighted, and balanced within a business area."""
    pool: list[str] = []
    for t, w in TIER_WEIGHTS:
        pool += [t] * w
    return pool[_h(key) % len(pool)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--recipe-count", type=int, default=250)
    ap.add_argument("--template-count", type=int, default=40)
    args = ap.parse_args()

    connectors = load_connectors()
    templates = load_templates()
    recipes = json.load(open(TPL_DIR / "_recipe_seeds.json", encoding="utf-8"))["recipes"]

    scenarios: list[dict] = []
    area_counter: collections.Counter = collections.Counter()

    # --- 1. recipe-derived single-job scenarios, stratified across areas -----
    by_area: dict[str, list[dict]] = collections.defaultdict(list)
    for r in recipes:
        tpl = templates.get(r["source_template_id"])
        if not tpl:
            continue
        by_area[tpl["area"]].append(r)

    # round-robin across areas so no area dominates (development has 48 recipes)
    ordered: list[dict] = []
    pools = {a: sorted(v, key=lambda x: x["id"]) for a, v in by_area.items()}
    while len(ordered) < args.recipe_count and any(pools.values()):
        for a in sorted(pools):
            if pools[a] and len(ordered) < args.recipe_count:
                ordered.append(pools[a].pop(0))

    for r in ordered:
        tpl = templates[r["source_template_id"]]
        axis = classify_service_flow(tpl["service_flow"], connectors)
        tier = assign_tier(r["id"], area_counter)
        area_counter[tpl["area"]] += 1
        trig = infer_trigger(r.get("category"))
        vague, true = synth_intents(r, tpl, axis, tier, trig)
        exp = build_expectations(r, tpl, axis, tier, trig)
        scenarios.append({
            "id": f"rec-{r['id'][:8]}",
            "kind": "recipe",
            "business_area": tpl["area"],
            "recipe_category": r.get("category"),
            "source_template_id": tpl["id"],
            "recipe_name": r["name"],
            "vagueness_tier": tier,
            "vague_intent": vague,
            "true_intent": true,
            **exp,
        })

    # --- 2. template-derived MULTI-capability scenarios ----------------------
    multi = sorted(
        (t for t in templates.values() if len(t["use_cases"]) >= 3),
        key=lambda t: (-len(t["use_cases"]), t["id"]),
    )[: args.template_count]
    for t in multi:
        axis = classify_service_flow(t["service_flow"], connectors)
        tier = assign_tier("tpl-" + t["id"], area_counter)
        n = len(t["use_cases"])
        desc = _first_sentence(t["description"])
        domain = _DOMAIN_NOUN.get(t["area"], t["area"])
        trig = "schedule"
        vague = (
            f"{desc}" if tier == "specified"
            else f"I need an agent for {domain} that can do a few related things."
            if tier in ("vague", "extreme") else f"{desc} It has a few distinct jobs."
        )
        true = f"{_clean(t['name'])}: {desc} It has {n} distinct capabilities."
        exp = build_expectations({"name": t["name"], "description": t["description"]},
                                 t, axis, tier, trig, multi=True)
        exp["metadata_assertions"].pop("expect_trigger_type", None)  # multi-cap: mixed triggers
        scenarios.append({
            "id": f"tpl-{t['id'][:22]}",
            "kind": "template-multi",
            "business_area": t["area"],
            "recipe_category": None,
            "source_template_id": t["id"],
            "recipe_name": t["name"],
            "vagueness_tier": tier,
            "vague_intent": vague,
            "true_intent": true,
            **exp,
        })

    # --- 3. hand-written controls + adversarial traps ------------------------
    controls_path = Path(__file__).parent / "controls.json"
    controls = json.load(open(controls_path, encoding="utf-8")) if controls_path.exists() else []
    for c in controls:
        # Controls are hand-authored with a concrete `pick`; normalise onto the
        # generated shape so the runner has one contract. Their picks are NOT
        # placeholders — the runner degrades the scenario if that credential is
        # absent from the vault rather than failing it.
        cc = c.get("connector_choice")
        if cc and "pick" in cc and "preferred_pick" not in cc:
            cc["preferred_pick"] = cc.pop("pick")
    scenarios.extend(controls)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "scenarios.json").write_text(
        json.dumps({"version": 1, "count": len(scenarios), "scenarios": scenarios}, indent=1),
        encoding="utf-8",
    )

    # index for humans
    tiers = collections.Counter(s["vagueness_tier"] for s in scenarios)
    areas = collections.Counter(s["business_area"] for s in scenarios)
    kinds = collections.Counter(s["kind"] for s in scenarios)
    conn_q = sum(1 for s in scenarios if s.get("expect_connector_question"))
    no_q = sum(1 for s in scenarios if s.get("expect_no_connector_question"))
    lines = ["# onboarding-bench scenario index", "", f"**{len(scenarios)} scenarios**", "",
             "## Vagueness tiers", ""]
    for t, n in tiers.most_common():
        lines.append(f"- `{t}`: {n}")
    lines += ["", "## Kinds", ""] + [f"- `{k}`: {n}" for k, n in kinds.most_common()]
    lines += ["", "## Business areas", ""] + [f"- `{a}`: {n}" for a, n in sorted(areas.items())]
    lines += ["", "## Connector axis", "",
              f"- expect a connector_category question (user must choose): **{conn_q}**",
              f"- expect NO connector question (named/derivable): **{no_q}**", ""]
    (out / "index.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"wrote {len(scenarios)} scenarios -> {out/'scenarios.json'}")
    print("tiers:", dict(tiers))
    print("kinds:", dict(kinds))
    print("connector: ask=", conn_q, " no-ask=", no_q)


if __name__ == "__main__":
    main()
