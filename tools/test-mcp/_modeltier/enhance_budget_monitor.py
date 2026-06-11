#!/usr/bin/env python3
"""Enhance budget-spending-monitor: repurpose uc_weekly_spending_check into an
always-delivered Weekly Cost & Resource Report, and add a new daily threshold
tracker (alert-only). In-place transform of _recipe_seeds.json. --apply to write."""
import json, os, sys, uuid, copy
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SEEDS = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "..",
                                      "scripts", "templates", "_recipe_seeds.json"))
APPLY = "--apply" in sys.argv
NS = uuid.UUID("6f8d4f9c-3a07-4b1e-9c9d-8a3f6b2c5e10")
TID = "budget-spending-monitor"
def rid(uc): return str(uuid.uuid5(NS, f"{TID}:{uc}"))
assert rid("uc_weekly_spending_check") == "8da6a5c2-b3d4-564b-bce3-13d6fe886089", "namespace mismatch"
DAILY_ID = rid("uc_daily_threshold_check")

data = json.load(open(SEEDS, encoding="utf-8"))
recipes = data["recipes"]
byid = {r["id"]: r for r in recipes}

# already applied? (idempotent)
if any(r["id"] == DAILY_ID for r in recipes):
    print("daily tracker recipe already present — nothing to do"); sys.exit(0)

# --- 1. Repurpose uc_weekly_spending_check -> always-delivered weekly report ---
w = byid["8da6a5c2-b3d4-564b-bce3-13d6fe886089"]
wi = json.loads(w["prompt_template"])
wi["title"] = "Weekly Cost & Resource Report"
wi["capability_summary"] = ("Always-delivered weekly report of per-service cloud usage and cost with "
                            "WoW deltas; flags anomalies inline.")
wi["description"] = ("Every week, pull the last 7 days of billing plus per-service resource usage, compute "
                     "WoW deltas against the rolling baseline, and ALWAYS deliver a concise report via Messages "
                     "(per-service cost table, top movers, total vs threshold). Also emit anomaly events when a "
                     "service spikes >50% WoW, a new service appears, or the threshold is crossed.")
wi["model_override"] = "haiku"
wi["model_rationale"] = ("Fetch billing + format a fixed weekly report with WoW deltas — mechanical "
                         "compose-and-format, no narrative synthesis.")
wi["notification_channels"] = [{
    "type": "built-in", "role": "report",
    "description": "Weekly cost & resource report delivered to the in-app inbox (plus any messaging channel the adopter wires)."
}]
wi["error_handling"] = ("Auth/rate/partial/empty -> emit `budget.access.failure` for uc_api_recovery to handle, "
                        "and still deliver a report noting the gap. First run without history -> absolute values "
                        "only, no WoW flagging. Missing threshold -> default and note it in the report.")
w["name"] = "Weekly Cost & Resource Report"
w["prompt_template"] = json.dumps(wi, separators=(",", ":"), ensure_ascii=False)

# --- 2. New uc_daily_threshold_check (alert-only) ---
di = copy.deepcopy(wi)
di["id"] = "uc_daily_threshold_check"
di["title"] = "Daily Threshold Tracker"
di["capability_summary"] = ("Daily spend check that messages ONLY when projected/MTD spend breaches the "
                            "threshold; silent otherwise.")
di["description"] = ("Every day, pull month-to-date spend plus today's run-rate, project the end-of-period total, "
                     "and compare against the threshold. Stay SILENT when under budget; send a single concise "
                     "alert via Messages ONLY when MTD or the projection crosses the threshold (or a sharp daily "
                     "spike). Emit budget.threshold.exceeded on breach.")
di["model_override"] = "haiku"
di["model_rationale"] = ("Daily MTD-vs-threshold comparison with a conditional single alert — rule-based check, "
                         "no synthesis.")
di["suggested_trigger"] = {"trigger_type": "schedule", "config": {"cron": "0 8 * * *", "timezone": "local"},
                           "description": "Default daily 8:00 AM — final cadence set at the trigger-composition step."}
di["review_policy"] = {"mode": "never", "context": None}
di["notification_channels"] = []  # alert-only: emits user_message only on breach
di["memory_policy"] = {"enabled": True,
                       "context": "`daily_spend.json` — rolling daily MTD snapshots for run-rate projection and to "
                                  "suppress duplicate alerts within the same breach window."}
di["event_subscriptions"] = [
    {"event_type": "budget.threshold.exceeded", "direction": "emit",
     "description": "Payload: { date, mtd_total, projected_total, threshold, over_amount }. Emitted when MTD or projected spend crosses the threshold."},
    {"event_type": "budget.access.failure", "direction": "emit",
     "description": "Payload: { reason, detail }. Consumed by uc_api_recovery to surface a credential-troubleshooting message."},
]
di["sample_input"] = {"spending_threshold": "{{param.aq_spending_threshold}}", "currency": "{{param.aq_currency}}"}
di["input_schema"] = [s for s in wi.get("input_schema", []) if s.get("name") in ("spending_threshold", "currency")]
di["error_handling"] = ("Auth/rate/partial/empty -> emit `budget.access.failure` for uc_api_recovery. No prior daily "
                        "snapshot -> use MTD only (no run-rate projection). Already alerted this breach window (per "
                        "memory) -> stay silent to avoid duplicate daily alerts. Missing threshold -> default and note it.")
di["use_case_flow"] = {
    "nodes": [
        {"id": "n1", "type": "start", "label": "Daily schedule"},
        {"id": "n2", "type": "connector", "label": "Pull MTD + today's spend", "connector": "cloud",
         "detail": "Billing API: month-to-date cost + today's cost by service"},
        {"id": "n3", "type": "action", "label": "Project end-of-period total",
         "detail": "run-rate = MTD / days_elapsed * days_in_period"},
        {"id": "n4", "type": "decision", "label": "Projected/MTD > threshold?"},
        {"id": "n5", "type": "action", "label": "Compose single breach alert"},
        {"id": "n6", "type": "event", "label": "Emit budget.threshold.exceeded"},
        {"id": "n7", "type": "end", "label": "Silent (under budget)"},
        {"id": "n8", "type": "end", "label": "Alert sent"},
    ],
    "edges": [
        {"id": "e1", "source": "n1", "target": "n2"},
        {"id": "e2", "source": "n2", "target": "n3"},
        {"id": "e3", "source": "n3", "target": "n4"},
        {"id": "e4", "source": "n4", "target": "n5", "variant": "yes"},
        {"id": "e5", "source": "n4", "target": "n7", "variant": "no"},
        {"id": "e6", "source": "n5", "target": "n6"},
        {"id": "e7", "source": "n6", "target": "n8"},
    ],
}
di["test_fixtures"] = []

new_recipe = {
    "id": DAILY_ID,
    "source_template_id": TID,
    "source_use_case_id": "uc_daily_threshold_check",
    "source_use_case_name": "Daily Threshold Tracker",
    "source_version": "1.0.0",
    "name": "Daily Threshold Tracker",
    "description": di["description"],
    "category": "monitoring",
    "prompt_template": json.dumps(di, separators=(",", ":"), ensure_ascii=False),
    "tool_requirements": None,
    # tags is a JSON-encoded STRING (SeedRecipe.tags is Option<String>); a real
    # array fails the whole bundle parse.
    "tags": json.dumps([TID, "derived"], ensure_ascii=False),
}
# insert right after the weekly recipe for locality
widx = next(i for i, r in enumerate(recipes) if r["id"] == "8da6a5c2-b3d4-564b-bce3-13d6fe886089")
recipes.insert(widx + 1, new_recipe)
data["recipe_count"] = len(recipes)

print("daily recipe id:", DAILY_ID)
print("recipe_count:", data["recipe_count"])
print("uc_weekly retiered title:", wi["title"], "| channels:", len(wi["notification_channels"]))
if APPLY:
    open(SEEDS, "w", encoding="utf-8").write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    chk = json.load(open(SEEDS, encoding="utf-8"))
    assert any(r["id"] == DAILY_ID for r in chk["recipes"])
    print("APPLIED.")
else:
    print("DRY RUN (pass --apply)")
