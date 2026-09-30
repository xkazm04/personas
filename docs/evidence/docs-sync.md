---
subject: docs-sync
evidence:
  - scripts/docs/feature-doc-map.json                          # the coupling as data: 37 entries, 131 sourceGlobs, three target types (doc / onboardingFlows / marketingModule), 38 registered tour flows
  - scripts/docs/check-doc-map-paths.mjs                       # the one LIVE machine check in the surface: 77 named nodes all resolve, wired into `npm run check` — it validates what the map names, and can never validate what the map omits
  - src-tauri/src/commands/infrastructure/doc_rot.rs           # doc-freshness scan with UNVERIFIABLE as a first-class verdict ("rendering it as clean was this detector's biggest lie"); map-first, colocation-second coupling discovery
  - .claude/guide-sync-marker.json                             # catch-up marker: lastSyncCommit + topicsUpdated + missingCoverage as honest recorded gaps — and a cautionary "the hook now prevents this drift" note written the very day the dead hook landed
  - .claude/skills/guide-sync/skill.md                         # the bounded catch-up pass that reads the marker to know its range
  - .claude/CLAUDE.md                                          # the dated-correction exemplar: corrections in place with date + measurement, corrections-of-corrections, and a resolved-marker that names its verification date
  - docs/concepts/golden-paths/documentation-sync.md           # the measured autopsy: 100 transcripts replayed, 477 editing turns, 2,367 edits, 0.00% visible to the hook; satisfaction precision 45.7%; 33% of source unmapped
counter_evidence:
  - scripts/docs/check-doc-sync.mjs                            # THE never-fired hook: its transcript walk breaks on the first event shaped `type:"user"` — which is exactly the shape a tool result wears (93.0% of such events), so it exits 0 on every turn since 2026-05-16 (deferred fix #105)
  - scripts/docs/__tests__/check-doc-sync.test.mjs             # 30 assertions, all green, over synthetic transcripts containing no tool_result events — a fixture that models the input's theory, not its production shape
deviations:
  - w12-docs-sync   # anchor in docs/concepts/golden-path-deferred-fixes.md (wave-12 reconciliation; the P0 transcript-walk bug is already registered there as fix #105 — reported, not edited, per the forge brief)
---

# Docs Sync - evidence

How this codebase measures against the [`docs-sync`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
