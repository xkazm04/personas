# Refactor+Perf Fix Wave 9 (H) — Dead code

> 5 commits, 23 findings closed (21 deleted, 1 partial, 1 fixed). **~14,700 LOC removed across 174 files.**
> Executed by a 10-agent parallel workflow (one agent per 2–3 clusters), each grep-verifying by IMPORT PATH (src/, src-tauri/, scripts/, e2e/, dynamic imports, barrels) before deleting; the orchestrator gated and committed.
> Gates: `npm run check` (contracts + tiers + tauri-configs + catalog + catalog-boundary + tsc + eslint) PASS; cargo check --features desktop,ml PASS; vitest 2303–2304/2304 (single failure = the known-flaky useDesignReviews file; clean on re-run); eslint + i18n hooks clean per-commit.

## Commits

| Commit | Clusters |
|---|---|
| `f0c812796` | agents: DependencyGraphPanel+lib (612), subscription cluster (337), ViewPresetBar→viewConfig.ts (295), dup exec helpers (52), design wizard (1062; live ExamplePair/formatExamplePairsAsIntent relocated to libs/examplePairs.ts), artist dead drag-drop path (+22 orphaned i18n keys purged across 14 locales, catalogs regenerated) |
| `3f4355d0c` | overview/shared: entire sub_realtime feature (2602), sub_memories/hooks/ dup dir (430), DashboardFilters (253), desktopBridges (151), autoProfile Promise-patcher (85), LanguageSwitcher dead dropdown (110), dbSchema* dup trio (97), useBackgroundJobPolling unused rewrite (174), VaultConnectorPicker unreachable branch (70) |
| `aac548a40` | plugins/teams/templates/triggers: fleet preview tier incl. Rust command + registration (250), PluginAccentLayer/pluginTheme (101), useTeamChannel/parseDeliveries (55), **teams/sub_canvas subtree (3162 — its only external ref was a context provider with zero readers; provider mount removed from PersonasPage)**, n8n transform/edit/confirm subtree (3085), Dispatch-console RoutingView tree (1282) |
| `a997c15d9` | tauri: template_adopt.rs orphaned adopt pipeline (736); FIX: MCP personas_list group_id filter silently returned [] (column retired in Groups→Teams) — parameter dropped from the tool schema |
| `df40894ac` | follow-through: GlyphQuestionPanel dead onAddFromCatalog caller; context-map deleted-ref trim |

## Notes / patterns (catalogue items 28–29)

28. **A context provider is dead when its hook has zero readers, even if the provider is mounted** — the mount kept a 3,100-LOC subtree in the module graph.
29. **Dead-code deletion parallelizes well**: one agent per cluster with a strict verify-by-import-path contract and no-commit rule; the orchestrator gates once over the combined tree. Skips must carry the live-importer evidence.

## Cumulative status (waves 1–9)

86 findings closed (1 Critical + 85 High) in 65 fix commits + 9 summaries. Remaining C+H: F render churn (26), I duplication (19) + 2 deferred (migration stamp, memories content_norm). The context map now has ~170 dead file refs — refresh affected contexts before the next scan.
