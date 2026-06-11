#!/usr/bin/env python3
"""In-place bake of per-capability model tiers into _recipe_seeds.json.

Reads the merged classification (result_*.json), applies a safety guard
(review_mode=="always" can never be haiku), and writes `model_override` +
`model_rationale` into each recipe's `prompt_template` inner JSON:

  haiku  -> model_override="haiku"  + rationale
  opus   -> model_override="opus"   + rationale
  sonnet -> model_override=null     (default; rationale cleared)

Sonnet recipes that already had null override are left byte-identical.
Idempotent. Pass --apply to write; default is dry-run.
"""
import json, glob, sys, os, collections

D = os.path.dirname(os.path.abspath(__file__))
SEEDS = os.path.join(D, "..", "..", "..", "scripts", "templates", "_recipe_seeds.json")
SEEDS = os.path.normpath(SEEDS)
APPLY = "--apply" in sys.argv

ex = {r["id"]: r for r in json.load(open(os.path.join(D, "recipes_extract.json"), encoding="utf-8"))}
tier = {}
for f in sorted(glob.glob(os.path.join(D, "result_*.json"))):
    for o in json.load(open(f, encoding="utf-8")):
        tier[o["id"]] = {"tier": o["tier"], "rationale": (o.get("rationale") or "").strip()}

# Safety guard: consequential output (always-review) must not run on haiku.
bumped = 0
for rid, v in tier.items():
    if v["tier"] == "haiku" and ex.get(rid, {}).get("review_mode") == "always":
        v["tier"] = "sonnet"
        v["rationale"] = ""
        bumped += 1

raw = open(SEEDS, "r", encoding="utf-8").read()
data = json.loads(raw)
recipes = data["recipes"]

changed = 0
dist = collections.Counter()
for r in recipes:
    rid = r["id"]
    t = tier.get(rid)
    if not t:
        continue
    dist[t["tier"]] += 1
    inner = json.loads(r["prompt_template"])
    old_override = inner.get("model_override")
    old_rat = inner.get("model_rationale")

    if t["tier"] == "sonnet":
        new_override = None
        new_rat = None
    else:
        new_override = t["tier"]  # bare alias; CLI + runner resolve it
        new_rat = t["rationale"] or None

    if old_override == new_override and old_rat == new_rat:
        continue  # no change -> leave byte-identical

    # Rebuild inner preserving key order, with model_rationale right after
    # model_override for readability.
    rebuilt = {}
    for k, val in inner.items():
        if k == "model_rationale":
            continue  # we re-place it next to model_override
        if k == "model_override":
            rebuilt["model_override"] = new_override
            if new_rat is not None:
                rebuilt["model_rationale"] = new_rat
        else:
            rebuilt[k] = val
    if "model_override" not in inner:
        rebuilt["model_override"] = new_override
        if new_rat is not None:
            rebuilt["model_rationale"] = new_rat
    r["prompt_template"] = json.dumps(rebuilt, separators=(",", ":"), ensure_ascii=False)
    changed += 1

data["recipe_count"] = len(recipes)
print("recipes:", len(recipes), "| classified:", len(tier), "| safety-bumped:", bumped)
print("distribution:", dict(dist))
print("changed prompt_templates:", changed)

if APPLY:
    out = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    open(SEEDS, "w", encoding="utf-8").write(out)
    # re-validate
    chk = json.load(open(SEEDS, encoding="utf-8"))
    assert chk["recipe_count"] == 298 and len(chk["recipes"]) == 298
    print("APPLIED + re-validated. recipe_count=", chk["recipe_count"])
else:
    print("DRY RUN (pass --apply to write)")
