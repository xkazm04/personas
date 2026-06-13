#!/usr/bin/env python3
"""One-shot field-level transform: flip every capability's model tier from
`haiku` to `sonnet` in the checked-in recipe seed bundle.

Rationale: 2026-06-13 quality-over-cost safety pass. A 3-model Lab arena
cross-test (haiku/sonnet/opus @ medium thinking) measured haiku ~27% lower
output quality than sonnet even on its canonical triage use case, with no
demonstrable quality gain from opus over sonnet. The bundle's 103 haiku
tiers were a cost optimization with no empirical backing; we choose the
sonnet floor everywhere until per-capability model selection is decided by
the planned large-scale Template→Persona→Execution→Lab test harness.

In-place transform of `_recipe_seeds.json` per generate-recipe-seeds.py's
own guidance (the tiers were baked in after the generator's source ref, so
a regen would not reproduce them). Only `model_override` and
`model_rationale` inside each recipe's `prompt_template` change; key order
and compact separators are preserved so the diff is field-scoped.
"""
import io
import json
import sys

SEED = "scripts/templates/_recipe_seeds.json"
NOTE = "[2026-06-13 quality-over-cost safety pass: haiku->sonnet] "


def main():
    raw = io.open(SEED, encoding="utf-8").read()
    bundle = json.loads(raw)
    changed = 0
    for r in bundle["recipes"]:
        inner = json.loads(r["prompt_template"])
        if inner.get("model_override") == "haiku":
            inner["model_override"] = "sonnet"
            prior = (inner.get("model_rationale") or "").strip()
            inner["model_rationale"] = (NOTE + prior) if prior else NOTE.strip()
            # Re-serialize compact (no spaces) to match the bundle's style;
            # ensure_ascii=False keeps the original raw UTF-8 punctuation.
            r["prompt_template"] = json.dumps(
                inner, ensure_ascii=False, separators=(",", ":")
            )
            changed += 1
    if "--check" in sys.argv:
        print(f"would convert {changed} haiku capabilities to sonnet")
        return
    out = json.dumps(bundle, ensure_ascii=False, indent=2) + "\n"
    io.open(SEED, "w", encoding="utf-8", newline="\n").write(out)
    # verify
    verify = json.loads(io.open(SEED, encoding="utf-8").read())
    remaining = sum(
        1
        for r in verify["recipes"]
        if json.loads(r["prompt_template"]).get("model_override") == "haiku"
    )
    sonnet = sum(
        1
        for r in verify["recipes"]
        if json.loads(r["prompt_template"]).get("model_override") == "sonnet"
    )
    print(f"converted {changed} haiku->sonnet | remaining haiku={remaining} | explicit sonnet now={sonnet}")


if __name__ == "__main__":
    main()
