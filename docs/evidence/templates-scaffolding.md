---
subject: templates-scaffolding
evidence:
  - src/features/templates/sub_generated/adoption/persona-layout/useAdoptionDimensionModel.tsx   # the interview: dimension model, gating, blocked/remaining counts
  - src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts                          # readiness matching: block / auto-select / filter, alias-aware
  - src/lib/personas/templates/templateCatalog.ts                                                # the integrity gate that works: skip-with-reason at the catalog door
  - scripts/generate-template-checksums.mjs                                                      # one generator, two manifests (frontend + backend) — derivation named
counter_evidence:
  - src-tauri/src/commands/design/template_adopt.rs      # :34-72 — the autopsy comment of the deleted inert gate (manifest keyed path+whole-file, callers passed label+payload)
  - scripts/templates/productivity/router.json   # one of 5 templates / 7 select questions whose default is outside its own option list (de-branding drift)
deviations:
  - w11-templates-scaffolding   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Templates Scaffolding - evidence

How this codebase measures against the [`templates-scaffolding`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
