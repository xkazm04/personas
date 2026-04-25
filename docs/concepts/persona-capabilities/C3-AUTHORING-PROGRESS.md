# C3 — Template Authoring Progress

Status snapshot for the v3.1 + v3.2 template migration. Live work tracked under `.planning/phases/`; this doc is the durable summary.

## Status

| Total | v3.1+ | v3 (pre-v3.1) | pre-v3 |
|---|---|---|---|
| 107 | 107 | 0 | 0 |

**Mass v3.1 migration shipped 2026-04-20.** All 107 canonical templates follow the v3.1 authoring contract:

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
- `1aa5a665` — 4 project-management templates
- `72c7201d` — 5 devops templates
- `f8d18ba3` — 11 content templates
- `ab00afc2` — 6 support templates
- `a0f85531` — 11 development templates
- `eccde3f0` — 11 finance templates
- `7c3dea36` — 14 research templates
- `cb26a143` — 14 sales templates
- `35ffe344` — 9 productivity templates

Checksums regenerated (`scripts/generate-template-checksums.mjs`) for all 107 published templates.

## v3.2 additions (additive — no version bump)

Schema stays `schema_version: 3`; v3.2 layered on top (full reference in `C3-template-schema-v3.md`):

- `use_cases[i].sample_output` — `{title?, body?, format?}` for the adoption Test Run + combined-layout preview.
- `event_subscriptions[j].notify_titlebar` — boolean gate for TitleBar bell surfacing per emit event.
- Persona `notification_channels` shape v2 — array-of-structs with `type ∈ {built-in | titlebar | slack | telegram | email}`, required `use_case_ids: "*" | string[]`, optional `event_filter: string[]`.

Old templates and old persona rows continue to normalize, serialize, and dispatch unchanged (D-02, transparent dual-path).

## Translation Loader

**Shipped 2026-04-19.** Per-language sibling overlays (`template.<lang>.json`) load, deep-merge onto the verified English canonical, and serve to the UI via a language-aware hook. Structural integrity stays gated by the English checksum — overlays are intentionally not independently checksummed.

Implementation:
- `scripts/generate-template-checksums.mjs` skips `*.xx.json` siblings.
- `src/lib/personas/templates/templateOverlays.ts` — schema-aware `mergeTemplateOverlay()` plus lazy per-language overlay loader.
- `src/lib/personas/templates/templateCatalog.ts` — filters overlay filenames from the canonical glob; exposes `getLocalizedTemplateCatalog(lang)` cached per language.
- `src/lib/personas/templates/useLocalizedTemplateCatalog.ts` — React hook subscribed to `i18nStore.language`.
- 17 vitest cases cover the merge contract (schema-specific match keys, `{{param.X}}` preservation, structural-field pass-through).

Overlays in production: only `development/autonomous-issue-resolver` carries the full 13-language sibling set as a reference. Other templates are English-only — overlays are added on demand once a template is canonized.

Remaining consumers still read `getTemplateCatalog()` (English only) and should move to `useLocalizedTemplateCatalog()` / `getLocalizedTemplateCatalog(lang)` when they need translated content:

- `src/lib/personas/templates/seedTemplates.ts`
- `src/hooks/design/template/useDesignReviews.ts`
- `src/features/agents/sub_executions/libs/useExecutionList.ts`
- Any adoption / matrix editor surface that renders template strings

(`src/lib/icons/templateIconResolver.ts` is icon-only — no localization needed.)

## Decisions locked (2026-04-19)

1. **Translations**: full scope — every hand-authored canonical template gets all 13 sibling files when localized.
2. **Archetype merging**: standalone first. Author each template on its own; archetype consolidation is a later pass.
3. **Duplicates**: don't delete (e.g. `marketing/website-conversion-audit` vs `sales/...` — keep both published).
4. **`maps_to` propagation**: keep `{{param.X}}` placeholder substitution as the propagation mechanism. `maps_to` remains structural hint for a future JSON-Pointer engine.
5. **Persona behavior core**: the unifying goal across all capabilities is the load-bearing part of identity/principles/constraints. Voice tone is secondary.
