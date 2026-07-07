# Recipe parameterization → dedup roadmap

Follow-up assessment from the Foundry arc (2026-07). The catalog audit
(`recipe-catalog-audit-2026-07.md`) concluded recipes can't be merged because
they're **template-bound**: connector slots, event names, and tool guidance
are baked literals, not parameters. This doc scopes the unlock and the two
large follow-ups so they can be picked up deliberately — **not started here**;
each needs its own arc + product calls.

## ✅ 2026-07 — Phase 1 LANDED (input_schema → live persona params)

The unlock below (the "real unlock is bigger than an adapter change" conclusion)
has shipped via **Option 1**: bridge `input_schema` into the already-working
persona-level parameter mechanism instead of inventing a new runtime.
`engine/recipe_parameters.rs` (new) derives `persona.parameters` from each
capability's `input_schema`, merges them under any template-authored params
(template wins), and injects a synthesized `## Capability Parameters` block —
referencing `{{param.<key>}}` — into `structured_prompt.instructions`, which the
runtime `replace_variables` already substitutes every execution. The promote
projection was also fixed to keep `capability_summary` + `tool_hints`. So
recipe-declared knobs now affect runtime behavior AND are editable without a
rebuild (via the existing parameters editor). This is approach **1's spirit**
(runtime-resolved capability params) achieved **without** a new `DesignUseCase`
field or a `capabilities.rs` signature change — the persona-prose fields
substitute for free. Feature notes: `docs/features/recipes/README.md`
("Recipe parameterization").

**Phase 1b (2026-07) — all three adoption paths now parameterize.** The two
gaps from the first pass are closed: `instant_adopt` derives + injects + seeds
inline (mirroring promote), and catalog quick-adopt calls a new idempotent
`sync_capability_parameters` command that reconciles `persona.parameters` + the
injected section from each use case's authoritative recipe `input_schema`
(resolved via `source_recipe_id`). Injection is now strip-then-append so
re-adopt / remove / stale UI can't stack duplicates; the promote projection
keeps `input_schema` in `design_context.useCases` for cross-path consistency.
Remaining: unsupported types (`source_definition`/`connector_ref`/`list[string]`)
still skipped in v1; removing a capability leaves its params inert rather than
GC'ing them. The historical investigation that motivated this approach follows.

## Deferred items

- **Seed-data mojibake in recipe `input_schema` descriptions.** Several recipes'
  `input_schema[].description` fields carry a mis-encoded em-dash (UTF-8 `E2 80 94`
  stored as the cp1252 `â€"` triple) — e.g. *Contract Intake and Analysis*'s
  `contract_types` description. The parameterization code copies descriptions
  verbatim, so the mojibake surfaces in the derived `persona.parameters` and the
  synthesized `## Capability Parameters` block. This is a **source seed-data**
  issue (present in the stored recipe rows, not introduced by the bridge). Fix is
  a one-off scrub pass over `scripts/**` recipe seeds + a re-seed, ideally with a
  guard in the seed loader that rejects cp1252-mangled UTF-8. Tracked separately;
  low urgency (cosmetic, descriptions only).

## ⚠️ 2026-07 investigation correction (motivated the Phase 1 design above)

An attempt to start "step 1" (bindings-from-input_schema) instead **disproved
its premise**. Measured facts across all 299 seeded recipes:

- 264 recipes carry a populated `input_schema` (the declaration). ✓
- But the `{{param.aq_<field>}}` placeholders that would consume those inputs
  live **exclusively in `sample_input`** (243 recipes) — an example payload,
  not the capability's runtime prompt. **Zero** recipes reference a param in
  any field that survives promotion.
- The promote path builds a **thin** `DesignUseCase` (title, description,
  category, trigger, policies, provenance) and **drops** `sample_input`,
  `input_schema`, `capability_summary`, `connectors`, `tool_hints`, and
  `use_case_flow`. Verified live: a Foundry persona adopting a parameterized
  recipe stored **zero** `{{param.*}}` placeholders and **empty**
  `persona.parameters`.

**Conclusion:** recipe-level `input_schema` parameterization has **no runtime
effect today**. A binding form derived from it would collect values that reach
nothing. The working `{{param.aq_*}}` parameterization that DOES exist is
**persona/template-level** — placeholders in a template's persona
`operating_instructions` / `tool_guidance`, populated by the template's
`adoption_questions` → `persona.parameters`. Recipes never carry that layer;
their capability projects into the persona as a one-line `capability_summary`
plus title/description, losing the parameterized prompt body entirely.

**So the real unlock is bigger than an adapter change** — it requires changing
how a recipe capability projects into a persona so its parameterized prompt
(a) survives promotion and (b) resolves params at runtime. Concretely, one of:

1. **Carry a runtime capability prompt.** Give `DesignUseCase` a persisted
   `capability_prompt` field, have promote keep it, and have the runtime
   capability section render it (with `{{param.*}}` resolved). Then wire
   input_schema → `persona.parameters` on adoption so the placeholders bind.
   This is the honest foundation; it touches the persona schema, the promote
   projection, the runtime prompt assembler, AND the adoption param-write —
   a real arc, not a one-file change.
2. **Move params into a surviving field.** Re-author recipes so their
   `capability_summary`/`description` (which survive) reference `{{param.*}}`,
   then populate `persona.parameters` from input_schema on adoption. Cheaper
   on the pipeline but a 264-recipe re-authoring pass, and summaries aren't
   really where behavioral parameters belong.

Either way: **do not build the input_schema→bindings form until one of the
above lands** — without it the form is inert. The original "step 1" below is
retained for history but is superseded by this correction.

---

## (superseded) Original step-1 plan

## Item 1 — Recipe parameterization (the real dedup unlock)

**Current state (measured):** all 299 seeded recipes ship `bindings: []`
(`recipeAdapter.ts:359` hard-codes it), so the entire `RecipeBinding` /
`BindingKind` contract + adoption-modal binding UI renders nothing. BUT
**264/299 recipes already carry a populated `input_schema`** inside their
`prompt_template` blob — typed fields (name/type/default/min/max/description).
The adapter surfaces these as display-only `inputParameters` and never
collects them. The scaffolding for parameterization is 80% present; what's
missing is (a) turning `input_schema` into real `bindings`, and (b) turning
the literals inside `prompt_template` into `{{placeholders}}`.

**Why it matters:** parameterized recipes stop being template-bound. A single
"SLA breach escalation" recipe with a `{{ticketing_connector}}` binding
replaces the three vendor-specific copies the audit refused to merge. THEN
merge-to-canonical becomes safe.

**Scoped first step (one arc, low risk, high signal):**
1. Adapter change: derive `bindings` from `input_schema` in `recipeAdapter.ts`
   (map type→BindingKind: number→number, boolean→enum(true/false), string→text,
   enum→enum). ~35 recipes with no input_schema stay binding-less. Pure TS,
   no seed rewrite — the binding UI lights up immediately for 264 recipes.
2. The adoption flow already substitutes `{{var}}` (`substituteBindings.ts`) —
   it just has nothing to substitute today. Once bindings exist, the existing
   `recipeToUseCase` substitution runs for real.
3. Measure: how many recipes' `prompt_template` actually reference their
   input_schema field names as `{{...}}`? (Some already do — `sample_input`
   uses `{{param.aq_*}}`.) That number tells us how much of the value lands
   from step 1 alone vs. needs prompt rewriting.

**The heavy part (defer):** rewriting each recipe's connector/event literals
into placeholders is a per-recipe authoring pass over 299 rows — a curation
arc, ideally agent-assisted with human review (like the audit). Only after
this do the 26 audit merge-candidates collapse.

**Do NOT:** wire the orphaned Rust adoption pipeline (`recipe_adoption.rs`)
as part of this — it's a separate convergence, still dead code.

## Item 2 — 12 near-duplicate TEMPLATE families

The template audit flagged 12 families (e.g. `support-escalation-engine` vs
`support-intelligence-use-case`; `revenue-operations-hub` vs
`subscription-billing-use-case`; `appointment-orchestrator` vs
`meeting-lifecycle-manager`; `contact-enrichment-agent` vs
`contact-sync-manager`; `website-conversion-audit` [marketing] vs
`website-conversion-auditor` [sales]). Full list in
`recipe-catalog-audit-2026-07.md` "editorial follow-up".

**Why this is NOT a mechanical merge:** unlike recipes, templates are the
user-facing gallery entries. Most pairs are *legitimate vendor/persona
variants* (Freshdesk vs Zendesk; Stripe vs Paddle; individual vs business
finance). Merging them removes a real choice from the gallery. This needs
**per-pair product judgment**, not a script:
- Same job, redundant vendor → merge, keep the richer one, add the other
  vendor as an adoption option (blocked on Item 1's parameterization).
- Same job, genuinely different persona/vertical → keep both, maybe cross-link.
- One clearly better than the other → deprecate the weaker.

**Recommended:** hold until Item 1 lands (parameterization lets a merged
template offer both vendors), then walk the 12 pairs with the user one at a
time. The one unambiguous case now — `website-conversion-audit` vs
`website-conversion-auditor` (near-identical, same job, filed in two
categories) — could be resolved standalone if desired.

## Sequencing

`Item 1 step 1 (bindings from input_schema)` → measure → `Item 1 prompt-rewrite
curation` → `recipe dedup (the 26 candidates)` → `Item 2 template dedup`.
Each is a checkpoint the user gates. Nothing here is safe to bulk-apply.
