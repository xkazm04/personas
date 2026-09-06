# Recipe v3 - craftsman knowledge, connector-agnostic, trigger-agnostic

Contract for the recipe corpus and for the code that consumes it. Supersedes the v2
consolidation spec's data shape; keeps its rules of voice (a recipe is NOT a process
definition; outcomes are claims about the world; no em dashes; no marketing voice).

## What a recipe IS (v3)

A recipe is **mastery** - the best current knowledge of how one kind of work is done well.
It is written to live in the ai-registry beside skills: versioned, append-only lessons,
improved by every agent that holds it. It is NOT configuration. Everything that binds it
to one installation (which connector, which trigger, which credentials, which persona)
happens at **adoption** and lives on the adopted **charter**, not on the recipe.

Two layers, and the line between them is the whole design:

| | Recipe (registry artifact) | Charter (adopted instance on a persona) |
|---|---|---|
| owns | need, input, core action, output, activity sequence, outcomes, guidance, connector TYPES, recommended trigger, personalization needs, dependencies, examples | bound connectors, assigned trigger/cadence, credentials, budget, scope, approval gates, persona-specific memory |
| author | the craft (any agent, via versioned proposals) | the operator + the persona that holds it |
| changes by | version bump + LESSONS.md (registry) | edits in the app; lessons in the charter's memory |
| never carries | a connector id, a cron, a persona | a general lesson somebody else would want |

## The v3 shape

```jsonc
{
  "id": "<stable uuid, unchanged from v2>",
  "slug": "web-analytics-performance-review",      // kebab; registry folder name
  "title": "Web analytics performance review",     // AREA + ACTIVITY, unambiguous on its own
  // "version" is OPTIONAL and ABSENT while status is "draft". A draft recipe is
  // identified by its slug alone. It earns its first version when the operator
  // promotes it out of draft, and from then on: semver, 0.x = seed knowledge.
  "status": "draft",                               // draft | seed | maturing | proven
  "path": "sales_marketing/web-analytics",         // <domain>/<topic> in the registry lane (<=10 dirs per level)
  "domain": "sales_marketing",                     // the closed 16-family vocabulary (unchanged)

  "description": {
    "need":        "why this work exists, as a claim about what goes wrong without it",
    "input":       "what the work starts from (data, artifacts, signals)",
    "core_action": "the judgment at the center, one or two sentences",
    "output":      "what exists in the world when it is done well"
  },

  "activities": [                                  // COARSE sequence for a high-level diagram. 3..8 items.
    { "id": "collect",  "label": "Pull engagement for posts past the review window", "kind": "observe" },
    { "id": "compare",  "label": "Compare against rolling baselines and platform weights", "kind": "decide" },
    { "id": "flag",     "label": "Flag viral spikes and underperformers", "kind": "act" },
    { "id": "update",   "label": "Update baselines so next review learns from this one", "kind": "deliver" }
  ],

  "outcomes": [ { "id": "...", "statement": "...", "success_criteria": ["..."] } ],
  "guidance": "40-90 words of judgment, never numbered steps, never a tool order.",

  "connector_types": ["analytics", "social"],      // from the connector catalog's `categories` vocabulary, NEVER a connector id
  "recommended_trigger": { "kind": "self_paced", "rationale": "..." },   // event | time | self_paced. A recommendation only.
  "personalization_needs": ["what adoption must learn from the adopter, and why"],
  "dependencies": ["ffmpeg"],                      // things adoption must install or verify before the first run
  "input_schema": [ ... ],                          // the knobs, unchanged from v2

  "examples": [                                    // concrete-solution knowledge lives HERE and only here
    { "title": "Deepgram as the transcription connector",
      "connector": "deepgram", "connector_type": "transcription",
      "notes": "what was learned mapping this recipe onto that specific connector" }
  ],

  "lessons": [],                                   // append-only; promoted from charter memory by proposal
  "provenance": { "from_recipes": ["<v2 ids>"], "from_templates": ["<template ids>"], "source_template_id": "<v2 field>" }
}
```

### `status` and `version` - the starting line

The `status` vocabulary is `draft | seed | maturing | proven`.

`version` is **optional, and absent for as long as `status` is `draft`**. The whole corpus
starts on that line: a draft recipe is knowledge nobody has yet promoted, and it is
identified by its **slug alone**. A recipe leaves `draft` only when the operator promotes
it, and that promotion is exactly when it receives its first version. So the two fields
move together and the rule is one sentence:

> a recipe with any status other than `draft` MUST carry a version; a `draft` recipe
> carries none.

`RecipeSpec::validate` enforces both halves. A charter minted from a draft recipe gets a
`recipe_ref` with a slug and no version, and the UI renders the slug on its own rather
than `slug@undefined`.

### The `activities` field is not the runbook we removed

`useCaseFlow` was a node/edge graph with decisions and branches - a script for a machine.
`activities` is a short, linear, branch-free list of the KINDS of activity the work moves
through, so a reader (and a diagram) can see the shape at a glance. Rules: 3 to 8 items;
no `decision` nodes, no edges, no conditions; each `kind` is one of `observe | decide |
act | deliver`; a label is a phrase, not an instruction. If it needs a branch, it is a
runbook and it does not belong.

### `description` is four fields, always

v2 mixed one-line summaries, sequences and paragraphs in `procedure`. v3 separates the
four things a reader needs, every time, in the same order: need, input, core action,
output. `guidance` remains for the judgment prose.

### Connector types, not connectors

The vocabulary is the connector catalog's own plural `categories` field
(`scripts/connectors/builtin/*.json`): `transcription`, `analytics`, `social`, `email`,
`messaging`, `database`, `storage`, `knowledge_base`, `monitoring`, `source_control`,
`ci_cd`, `calendar`, `finance`, `research`, `devops`, `productivity`, `marketing`,
`notifications`, `cloud`, `ai`, `voice_generation`, ... Adoption resolves a type to any
connector whose `categories` includes it. **`desktop` is not a connector and never
appears**: every agent has desktop access. Where v2 said `deepgram`, v3 says
`transcription` and keeps Deepgram as an `example`. Where v2 said `analytics` (already
generic) it stays.

### Connector roles (amendment, 2026-09-06, from lane L1)

A flat type list cannot say "two connectors of this type, in different roles": a code-review
recipe needs a local checkout AND a hosted review surface, both `source_control`. So a recipe
MAY declare roles:

```jsonc
"connector_roles": [
  { "role": "local_checkout",  "type": "source_control", "note": "the working tree being reviewed" },
  { "role": "review_surface",  "type": "source_control", "note": "where the review is posted" }
]
```

Rules: `connector_types` stays and is the DERIVED flat list (the distinct `type`s of the
roles, or the declared types when no roles are given). When `connector_roles` is absent, every
type is one role whose name is the type itself. **Adoption binds per role**, and
`credential_bindings` is keyed by the role name (which is the type name in the common case,
so the existing seam is unchanged). Charters store the bound connector per role.

### Triggers are recommended, never bound

`recommended_trigger.kind` is one of `event | time | self_paced`, with a rationale. No
cron, no interval, no event name on the recipe. The adopter assigns the actual trigger at
adoption or later. A title that encodes a cadence ("48-hour ...") loses it.

### Titles name AREA + ACTIVITY

"Performance review" is ambiguous; "Web analytics performance review" is not. A title
must read unambiguously in a list of 200 recipes from every domain.

## Adoption contract (what consumes a v3 recipe)

1. For each `connector_type`, offer the connectors whose `categories` include it; surface
   the recipe's `examples` for the chosen one; the choice lands on the charter as a bound
   connector via `AdoptionAnswers.credential_bindings` (`type -> service`, the seam that
   already exists in `engine/src/adoption_answers.rs`).
2. Research the chosen connector's content and adjust (an LLM pass, not a lookup).
3. Install or verify `dependencies` before the first run.
4. Assign the trigger; default to `recommended_trigger.kind`.
5. Compose the personalization questions from `personalization_needs` - generated for
   this adoption, never a stored form (operator directive a).
6. Mint the charter with `recipe_ref: { slug, version? }` so lessons can flow back. The
   `version` is optional and is absent whenever the recipe is still a draft; the slug is
   the pointer that always exists.

## Dual improvement

- **Charter memory** keeps use-case-specific lessons nobody else wants.
- A lesson that generalizes is **promoted by proposal** into the recipe: a version bump plus
  a LESSONS.md entry in the registry. Propose-only, human-adopted, same governance as
  every other write lane.

## Registry lane (designed now, populated only after operator approval)

`recipes/` in ai-registry, `depth: nested` like knowledge (a generated index, max 10 child
dirs per level), versioned like skills: `recipes/<domain>/<topic>/<slug>/recipe.json` +
`RECIPE.md` (rendered) + `LESSONS.md` + `examples/`. A gate mirrors `check-skills.mjs`.
The corpus migrates only after templates and recipes are reviewed and approved.

## House rules (unchanged)

No em dashes. No marketing voice. Never invent a connector, vendor or dependency the
source does not evidence. Outcomes are claims about the world; success criteria are how
anyone could tell.
