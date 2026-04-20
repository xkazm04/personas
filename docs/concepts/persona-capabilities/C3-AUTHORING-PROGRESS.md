# C3 — Template Authoring Progress

Tracking the hand-authoring migration of 107 templates to v3.1 shape (per `C3-template-schema-v3.md` + `C3-schema-v3.1-delta.md` + `C3-v3.1-authoring-lessons.md`).

## Status

| Total | v3.1 done | v3 (pre-v3.1) | pre-v3 remaining |
|---|---|---|---|
| 107 | 107 | 0 | 0 |

**Mass v3.1 migration shipped 2026-04-20** — all 107 canonical templates now follow the v3.1 authoring contract:

- `persona.goal` (one-line value statement) on every template
- `persona.trigger_composition` + `persona.message_composition` (default `per_use_case`; `shared`+`combined` for digest-style personas)
- `required: true|false` on every `persona.connectors[]` entry + `fallback_note` wherever `required: false`
- `use_case_ids: [array]` (plural) on every capability-scoped adoption question
- Cadence words stripped from UC titles; defaults noted in descriptions as "Default X — final cadence set at the trigger-composition step."
- `aq_*_time` / `aq_*_cadence` / `aq_*_when` / enable-disable questions removed (trigger-composition step owns them)
- `dynamic_source: { service_type, operation, source: "vault" }` vault-picker pattern replaces hardcoded provider `options: [...]` lists
- Events use `<domain>.<subdomain>.<action>` three-part dotted namespace
- Flow-node density ≤10 per UC (tells the story, not the code path)
- `source_definition` + `aq_*_intent` textarea pattern applied to research-type templates where "describe yourself" free-text questions existed

Migration commits on master (2026-04-20):
- `17047cdd` — light-edit 4 pre-v3.1 templates (email-morning-digest, onboarding-tracker, youtube-content-pipeline, autonomous-issue-resolver)
- `4062ed50` — 12 templates (email, hr, legal, security, marketing)
- `1aa5a65f` — 4 project-management templates
- `72c7201d` — 5 devops templates
- `f8d18ba3` — 11 content templates
- `ab00afc2` — 6 support templates
- `a0f85531` — 11 development templates
- `eccde3f0` — 11 finance templates
- `7c3dea36` — 14 research templates
- `cb26a143` — 14 sales templates
- `35ffe344` — 9 productivity templates

Checksums regenerated (`scripts/generate-template-checksums.mjs`) — 107 published templates, all in v3.1 shape. 13 autonomous-issue-resolver translation overlays remain valid (v3.1 field changes are structural; overlays are schema-agnostic).

## Translation Loader Status

**Shipped 2026-04-19.** Per-language sibling overlays
(`template.<lang>.json`) are now loaded, deep-merged onto the verified
English canonical, and served to the UI through a language-aware hook.
Structural integrity stays gated by the English checksum — overlays are
intentionally not independently checksummed.

Implementation:
- `scripts/generate-template-checksums.mjs` skips `*.xx.json` siblings so
  they don't get independent checksums.
- `src/lib/personas/templates/templateOverlays.ts` — schema-aware
  `mergeTemplateOverlay()` (matches array items by `id` / `name` / `key` /
  `event_type`, falls back to index) plus lazy per-language overlay loader.
- `src/lib/personas/templates/templateCatalog.ts` — filters overlay
  filenames from the canonical glob and exposes
  `getLocalizedTemplateCatalog(lang)` cached per language.
- `src/lib/personas/templates/useLocalizedTemplateCatalog.ts` — React
  hook that subscribes to `i18nStore.language` and re-fetches on change.
- Pilot consumer: `OnboardingTemplateStep.tsx` (template picker gallery).
- 17 vitest cases cover the merge contract (schema-specific match keys,
  `{{param.X}}` preservation, structural-field pass-through).

Remaining consumers still read `getTemplateCatalog()` (English only).
Each should move to `useLocalizedTemplateCatalog()` or
`getLocalizedTemplateCatalog(lang)` when they need to display translated
content:

- `src/lib/personas/templates/seedTemplates.ts`
- `src/hooks/design/template/useDesignReviews.ts`
- `src/lib/icons/templateIconResolver.ts` (icon-only — probably fine as-is)
- `src/features/agents/sub_executions/libs/useExecutionList.ts`
- Any adoption / matrix editor surface that renders template strings.

## Schema v3.1 (2026-04-20)

After the first-pass review, the authoring contract was refined. See
`C3-schema-v3.1-delta.md` for the 8 normative principles and
`C3-v3.1-impact-analysis.md` for the file-level impact map.

The first five hand-authored templates predate v3.1. `email-morning-
digest`, `onboarding-tracker`, `youtube-content-pipeline`, and
`autonomous-issue-resolver` need light edits (`scope` renames,
`use_case_id` → `use_case_ids`, flow-density cleanup). The Financial
Stocks Signaller was **fully rewritten** this pass.

Shipped in this v3.1 pass (backend + templates):
- `template_v3.rs`: three new normalizer functions with unit tests
  (singular→plural `use_case_id` migration, `required` default-fill
  on connectors, `trigger_composition`/`message_composition` hoist).
- 15/15 `engine::template_v3` tests pass.
- 6 templates now on v3.1 shape: Financial Stocks Signaller + Idea
  Harvester (prior pass) and Web Marketing + Game Character Animator +
  Daily Personal Briefer + Dev Clone (vision-alignment review pass).
  All use event namespaces in `<domain>.<subdomain>.<action>` syntax
  per P7.

Deferred (documented in impact analysis §3):
- `TriggerCompositionStep.tsx` / `MessageCompositionStep.tsx` UI.
- `ConnectorGateStep.tsx` empty-state + pick-or-skip UI.
- `inputSchemaComponents.ts` component registry (hosts
  `CodebaseSelector` — referenced by Idea Harvester + Dev Clone).
- Retroactive light edits on the three remaining v3 templates.

## Templates

| Template | Shape | Capabilities | Questions | Translations | Notes |
|---|---|---|---|---|---|
| productivity/email-morning-digest | v3 (pre-v3.1) | 1 | 7 | en only | Reference; needs light edit for v3.1 |
| finance/financial-stocks-signaller | **v3.1** | 3 | 4 | en only | Rewritten 2026-04-20; `uc_signals` + `uc_congressional_scan` + `uc_gems`; shared weekly trigger; combined messages; Alpha Vantage optional; `stocks.*` events |
| hr/onboarding-tracker | v3 (pre-v3.1) | 3 | — | en only | Needs light edit for v3.1 |
| content/youtube-content-pipeline | v3 (pre-v3.1) | 5 | — | en only | Needs light edit for v3.1 |
| development/autonomous-issue-resolver | v3 (pre-v3.1) | 3 | 8 | en + 13 | Singular `use_case_id` still — compatible via normalizer; overlays unaffected |
| productivity/idea-harvester | **v3.1** | 3 | 6 | en only | Rewritten 2026-04-20; harvest + triage + codebase-analysis; event chaining; `harvester.*` events; Codebase required |
| marketing/web-marketing | **v3.1** | 3 | 5 | en only | Rewritten 2026-04-20; `uc_performance_scan` + `uc_optimization_proposals` + `uc_cannibalization_watch`; shared weekly trigger; combined messages; ad_platform + analytics_tool both required; `marketing.*` events |
| content/game-character-animator | **v3.1** | 2 | 4 | en only | Rewritten 2026-04-20; `uc_generate_sprites` (image_ai required) + `uc_procedural_idle` (no connector); per-UC triggers; `game-artist.*` events |
| productivity/daily-standup-compiler | **v3.1** | 3 | 6 | en only | Rewritten 2026-04-20; Daily Personal Briefer — morning briefing + decision support + Sunday weekly review; no external connectors; `briefer.*` events |
| development/dev-clone | **v3.1** | 4 | 5 | en only | Rewritten 2026-04-20; `uc_backlog_scan` → `uc_triage` → `uc_implementation` → `uc_release_management` event-chained; Codebase + GitHub required; PR webhook sub-trigger on uc_implementation; `dev-clone.*` events |

## Tier 1 Flagships (remaining)

Per §6.1 of the handoff:

1. `sales/sales-pipeline-autopilot` — multi-capability CRM flow
2. `productivity/digital-clone` — cross-domain persona
3. `development/autonomous-cro-experiment-runner` — experiment lifecycle
4. `project-management/client-portal-orchestrator` — coordination-heavy

## Translation Coverage

For each hand-authored English template, sibling overlays carry only
user-facing strings (per §5.2 of the handoff). Structural fields stay
single-sourced in the canonical file.

| Template | ar | bn | cs | de | es | fr | hi | id | ja | ko | ru | vi | zh |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| autonomous-issue-resolver | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Quality: LLM-authored first pass. Spot-check recommended once the loader
ships and each language can be validated in the running app.

## Decisions Locked (2026-04-19)

Per the user's response on the 5 open questions (§11 of the handoff):

1. **Translations**: full scope — every hand-authored template gets all
   13 sibling files alongside the English canonical.
2. **Archetype merging**: standalone first. Author each template on its
   own; archetype consolidation is a later pass.
3. **Duplicates**: don't delete. If a duplicate exists
   (`marketing/website-conversion-audit` vs `sales/...`), keep both
   published.
4. **`maps_to` propagation**: keep `{{param.X}}` placeholder substitution
   as the propagation mechanism. `maps_to` remains structural hint for a
   future JSON-Pointer engine.
5. **Persona behavior core**: the unifying goal across all capabilities
   is the load-bearing part of identity/principles/constraints. Voice
   tone is secondary.
