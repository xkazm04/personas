# Recipe catalog audit — 2026-07-06

Outcome record of the Foundry-arc catalog audit: an 11-agent Sonnet fleet
swept all 299 seeded recipes (6 shards) + 111 templates (5 shards), followed
by adversarial verification agents on every merge proposal. This document is
the durable record of what was found, what was applied, and — most
importantly — **why zero recipe merges were applied** despite a
merge-to-canonical policy.

## The headline finding: recipes are still template-bound

The audit surfaced 26 near-duplicate merge candidates (7 high-confidence).
Independent adversarial verifiers then read every candidate's full
`prompt_template` blob plus the owning templates, with a mandate to refute.
**All 7 high-confidence merges were refused**, each on load-bearing evidence:

| Candidate pair | Refutation |
|---|---|
| Dunning Sequence + Payment Recovery Sequence | Absorbing template has NO messaging connector for the canonical's Slack escalation; 4-option escalation question has no analog in the canonical's binary flag — lossy, not a rename |
| Conflict Resolution ×2 (contact templates) | Hardcoded, non-configurable event names differ (`contact.enrichment.conflict_detected` vs `contact.sync.conflict_detected`) — re-pointing makes the resolver never fire, silently |
| SLA watch ×3 (support templates) | Three different implementations behind one label: Freshdesk-tier vs lightweight-warning vs KB-as-ticket-store; canonical's tool_guidance hardcodes Freshdesk API paths the others don't have |
| Email Triage ×2 (same template) | Not duplicates — complementary pipeline steps: one creates tickets, the other sends replies and EMITS the event a third capability LISTENS for; merging orphans that trigger |
| Monthly MRR ×2 | One is a standalone report; the other recalibrates scoring weights consumed by a sibling capability next month — deleting it removes the persona's headline self-calibration loop |
| Website Conversion Audit ×2 | Incompatible memory models (category-level accept/reject learning vs per-URL memory); sibling capability's self-description references the merged-away system |
| Subscription Event Sync ×2 | Different VENDORS (Stripe `revenue.*` vs Paddle `billing.*` namespaces) — re-pointing silently kills the dunning listener |

**Conclusion:** the capability summaries look interchangeable, but each
recipe's substance is welded to its source template's connector topology,
event namespace, and vendor-specific tool guidance. The catalog's problem is
not duplication to merge away — it's that recipes are not yet the
persona-agnostic shared vocabulary the TS contract (`sub_recipes/types.ts`)
describes. All 299 seeds ship `bindings: []`; `requiredConnectors` derive
from blobs rather than declarations; event names are literals.

## What true dedup requires (roadmap)

1. **Recipe parameterization** — populate the designed-but-unused
   `RecipeBinding` system: connector slots (`{{messaging}}` instead of a
   hardcoded Slack), event-name prefixes, vendor variables.
2. **Event-namespace conventions** — emit/listen pairs declared relative to
   the persona, not absolute strings baked at authoring time.
3. Only then can the 26 candidate clusters collapse into parameterized
   canonicals without breaking any adopting template.

## What WAS applied (commit `71aeae1cd`)

- Model tiers (force-propagated by the seeder): Code Review + PR Test &
  Merge → opus; Free Promotion Source Discovery + Generate & Curate → sonnet.
- `personal-capture-bot` 6-field cron → `*/30 * * * *`.
- `product-strategist` schema v1 → v3 (last straggler) + missing
  `fallback_note`.
- `editorial-calendar-manager` refiled legal/ → marketing/.
- Taxonomy: the audit's 42→9 mapping CONFIRMED the existing
  `recipeAdapter.ts` alias map — no changes needed.

Earlier in the same arc (commit `d7e98a392`): the 16 consolidated-template
seed rows re-keyed (dead provenance from deleted templates, one embedded-id
collision, one silently-orphaned adoption question) + the corpus-wide canary
test `template_recipe_refs_are_coherent_corpus_wide` in
`engine/recipe_seed.rs`.

## Recorded for editorial follow-up (not this arc)

- 12 near-dupe TEMPLATE families (e.g. support-escalation-engine vs
  support-intelligence-use-case, revenue-operations-hub vs
  subscription-billing-use-case, appointment-orchestrator vs
  meeting-lifecycle-manager) — mostly legitimate vendor variants; whole-
  template merging needs per-pair product judgment.
- 9 orphan seed rows from deleted templates (access-request-manager,
  sentry-production-monitor, workflow-error-intelligence) — unreferenced by
  any template; legitimate catalog-only capabilities with dead provenance.
- Systemic `verbosity_default: "normal"` across all templates (zero runtime
  consumers) — mass removal deferred to keep diffs reviewable.
- Connector-name-as-category slugs in 2 templates (`development`, `security`
  used as connector names).
