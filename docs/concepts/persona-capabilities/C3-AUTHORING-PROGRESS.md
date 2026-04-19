# C3 — Template Authoring Progress

Tracking the hand-authoring migration of 107 templates to v3 shape (per `C3-template-schema-v3.md` + `C3-template-authoring-handoff.md`).

## Status

| Total | v3 done | English only | v1/v2 remaining |
|---|---|---|---|
| 107 | 5 | 0 | 102 |

## Translation Loader Status

**Not yet built.** Per the 2026-04-19 handoff-followup session, sibling
language files (`template.<lang>.json`) are now authored and validated in
parallel with the English canonical, but the runtime deep-merge loader
has not landed yet. Until it does, sibling files sit on disk but are
neither loaded nor verified by the catalog.

- `scripts/generate-template-checksums.mjs` skips `*.xx.json` (13 language
  codes: ar, bn, cs, de, es, fr, hi, id, ja, ko, ru, vi, zh) so siblings
  don't get independent checksums.
- `src/lib/personas/templates/templateCatalog.ts` still globs every
  `.json`; unchecksummed sibling files are logged and skipped at load
  time. **Action for next session**: filter sibling files at glob time
  and implement the deep-merge overlay in the catalog.

## Templates

| Template | Status | Capabilities | Questions | Translations | Notes |
|---|---|---|---|---|---|
| productivity/email-morning-digest | done | 1 | 7 | en only | Reference template — single-capability |
| finance/financial-stocks-signaller | done | 2 | 6 | en only | Merged 3 internal flows → 2 user-facing capabilities |
| hr/onboarding-tracker | done | 3 | — | en only | 3-capability multi-schedule |
| content/youtube-content-pipeline | done | 5 | — | en only | 5-capability pipeline |
| development/autonomous-issue-resolver | done | 3 | 8 | en + 13 | Tier 1 flagship; merged 3 v1 flows → 3 capabilities (triage/digest/weekly-report); full translation set authored as overlays |

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
