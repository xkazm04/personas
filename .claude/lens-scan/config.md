---
context_map: context-map.json
standard_lenses: ../bp/docs/standard/lenses
store: .ai/lens-scan/scan.db
structure_out: .ai/lens-scan/app-structure.json
project_slug: personas
project_name: Personas
house: .ai/house
default_lens: development
default_scope: Security & Credentials
---

# lens-scan overlay - Personas

Read by `/lens-scan` (ai-registry `skills/lens-scan/SKILL.md`, "Project overlay"). Scaffolded 2026-10-09.

## Gates

- `npm run check:fast`
- `npm run test`

## Harness

None mapped yet. Candidate: `npm run style:shoot -- --module <module> --tape synthetic` (scripts/style/shoot.mjs,
modules in scripts/style/page-harness/modules.json), which writes PNGs plus report.json. Map features to
modules here before harness metrics are measured.

## Probes

None mapped yet. Candidate: the test-automation bridge on 127.0.0.1:17320 (`npm run tauri:dev:test`;
`/perf/reset`, `/navigate`, `/perf/snapshot`).

## Skill improvement log
