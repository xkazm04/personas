# Recipe consolidation spec (shared contract for all reviewer agents)

You are reviewing a slice of `scripts/templates/_recipe_seeds.json` (299 recipes,
already transformed to charter shape v2). Your job is to make each recipe a good
**responsibility**, and to say which recipes should merge.

## What a recipe IS now

A recipe seeds a **responsibility (charter)**: a standing area of ownership an
agent holds. Its payload (`prompt_template`, a JSON string) has this shape:

```
{ id, title, domain, outcomes[], procedure, connectors[], cadence, approvalGates[], spec{...} }
```

## The one rule that governs everything you write

**A recipe is NOT a process definition, and we are actively removing that
strictness.** An agent holding this charter is expected to use judgment about
*how*. You are writing what "done well" means and what the agent is accountable
for, not a runbook it must follow step by step.

Concretely:
- **Never** write numbered steps, "first… then… finally", or a fixed tool order.
- **Never** encode a schedule, a threshold or a channel into `procedure` when a
  real field exists for it (`cadence`, `spec.notificationChannels`, …).
- **Do** write outcomes as claims about the world, and success criteria as how
  anyone could tell the outcome held.
- Prefer "keeps X true" / "nobody is surprised by Y" over "runs the Z script".

## What to produce per recipe

1. **`title`** — distinctive. **Name collisions are the #1 defect in this corpus**
   and they are usually NOT duplicates: three recipes are called "Daily Briefing"
   and they are a news digest, a meeting-day overview, and a product-analytics
   briefing. When two recipes in your slice share a name, rename BOTH to say what
   each actually owns. Never rename by appending a number or the category.
2. **`domain`** — exactly one of this closed vocabulary (kp's role families, the
   app's existing taxonomy; do not invent a value):
   `software_engineering · data_ai · product_project · healthcare_clinical ·
   life_sciences_research · skilled_trades · operations_logistics ·
   frontline_service · sales_marketing · finance_accounting · legal_compliance ·
   hr_people · education_academic · creative_design · customer_support ·
   general_professional`
   The corpus currently carries 43 ad-hoc categories with a long tail of
   one-offs; collapsing them into this vocabulary is part of the job.
3. **`outcomes[]`** — 1 to 3 entries, `{ id, statement, success_criteria[] }`.
   Every recipe currently has `outcomes: []` because the mechanical transform
   deliberately refused to fabricate them. **This is the highest-value field you
   write.** `id` is a short kebab slug, unique within the recipe.
4. **`procedure`** — rewrite the existing blob (today it is a concatenated
   summary + description, often with ` | ` separators) into a short paragraph of
   *guidance*: what the agent is accountable for, what good judgment looks like
   here, what it should escalate rather than decide. Aim ~40-90 words. Keep any
   genuinely load-bearing domain constraint; drop ceremony.
5. **`keep` | `merge_into` | `retire`** — your verdict (see below).

Leave `id`, `connectors`, `cadence`, `approvalGates` and everything under `spec`
**untouched**. They carry live wiring.

## Merge verdicts — propose, never delete

**290 of the 299 recipes are referenced by exactly one template each**, so a
recipe id that disappears breaks a template. You therefore **do not edit or
delete any recipe you want merged** — you record the intent and the Director
applies it together with the template remap.

- `keep` — stands on its own.
- `merge_into: <other recipe id>` — genuinely the same job. Give `merge_reason`
  naming what makes them the same, and say what the surviving recipe must absorb.
  **Same name is not evidence.** Same outcome is.
- `retire` — the job is not worth being a preset at all. Justify it.

Be conservative: a merge that collapses two distinct jobs is much more expensive
than a duplicate that survives. When unsure, `keep` and say why you hesitated.

## Output — ONE file, no source edits

Write `scripts/templates/consolidation/<slice>.json`:

```json
{
  "slice": "<slice name>",
  "reviewed": <n>,
  "recipes": [
    { "id": "<unchanged>", "old_title": "...", "title": "...", "domain": "...",
      "outcomes": [ { "id": "...", "statement": "...", "success_criteria": ["..."] } ],
      "procedure": "...",
      "verdict": "keep" | "merge_into" | "retire",
      "merge_into": "<id>",            // only when verdict is merge_into
      "merge_reason": "...",           // only when verdict is merge_into
      "retire_reason": "...",          // only when verdict is retire
      "notes": "..."                   // optional; anything the Director should know
    }
  ],
  "slice_findings": ["cross-cutting observations worth acting on"]
}
```

**Do NOT modify `_recipe_seeds.json`, any template, or any source file.** Your
output is this one JSON file. It must parse and cover every recipe in your slice.

## House rules

- **No em dashes** in any text you write. Rewrite the sentence.
- English only; these strings are seeds, not UI copy, so they are not translated.
- Write plainly. No marketing voice, no "seamlessly", no "leverage".
- Do not invent connectors, tools or vendor names that the recipe does not
  already reference.
