# Obsidian Brain — reference

> Lookup tables for the backend command surface and the frontend module layout. For the user flow see [README.md](README.md); for the agent-side connector see [connector.md](connector.md).

## Backend commands

| Command | Purpose |
|---|---|
| `obsidian_brain_detect_vaults` | Scan OS-known Obsidian config paths for vaults |
| `obsidian_brain_test_connection` | Validate a folder is a real vault, count notes |
| `obsidian_brain_save_config` / `_get_config` | Persist active vault config in settings table |
| `obsidian_brain_list_saved_vaults` / `_set_saved_vaults` | Saved-vault roster (settings table, survives sessions) |
| `obsidian_revitalize_start` / `_snapshot` / `_active` / `_cancel` | Background Claude CLI vault-optimization pass |
| `obsidian_revitalize_history` | Persisted run history (`obsidian_revitalize_runs`, newest first) |
| `obsidian_brain_push_sync` / `_pull_sync` | Bidirectional markdown sync, scoped optionally to persona IDs |
| `obsidian_brain_get_sync_log` | Read the rolling sync history |
| `obsidian_brain_resolve_conflict` | Apply Keep-App / Keep-Vault / Skip to a 3-way conflict |
| `obsidian_brain_list_vault_files` / `_read_vault_note` | Tree + note reader for the Browse panel |
| `obsidian_brain_push_goals` | Push project goal trees as markdown under a persona |
| `obsidian_brain_lint_vault` / `_semantic_lint_vault` | Heuristic + LLM-driven vault audit |
| `obsidian_drive_status` / `_push_sync` / `_pull_sync` | Google Drive backup of the vault folder |
| `login_with_google_drive` / `get_google_drive_status` | OAuth bootstrap for Drive scope |
| `obsidian_graph_search` | TF-IDF vault search (Obsidian Memory connector) |
| `obsidian_graph_outgoing_links` / `_backlinks` | Wikilink walking |
| `obsidian_graph_list_orphans` / `_list_mocs` / `_stats` | Graph metrics |
| `obsidian_graph_append_daily_note` / `_write_meeting_note` | Daily journal + meeting capture |
| `obsidian_graph_start_watcher` / `_stop_watcher` | File watcher control |

## Frontend modules

```
src/features/plugins/obsidian-brain/
├── ObsidianBrainPage.tsx              # tab host
├── SavedConfigsSidebar.tsx            # multi-vault switcher (right rail)
├── useSavedVaultConfigs.ts            # DB-backed saved configs (one-time localStorage migration)
├── useObsidianVaultRehydration.ts     # restores active vault from persisted config at startup
├── useVisibleConnectorDefinitions.ts  # plugin-gated connector filter hook
├── openInObsidian.ts                  # shared obsidian:// deep-link helper (Graph + Browse)
├── sub_setup/SetupPanel.tsx           # detect/test/save flow
├── sub_sync/SyncPanel.tsx             # push/pull/conflict resolution
├── sub_sync/SyncResultCard.tsx        # persistent direction-tagged result summary
├── sub_sync/ConflictDiffView.tsx      # line-level diff render for a conflict
├── sub_sync/conflictDiff.ts           # LCS line-diff util (app vs vault)
├── sub_browse/BrowsePanel.tsx         # vault tree + markdown preview (word count, copy-path, frontmatter)
├── sub_browse/parseNote.ts            # frontmatter + word-count parser
├── sub_graph/GraphPanel.tsx           # search, stats, orphans/MOCs, journal, meeting capture
├── sub_cloud/CloudSyncPanel.tsx       # Google Drive backup + sign-in CTA
├── sub_revitalize/RevitalizePanel.tsx # background memory-consolidation pass (goals + log + summary)
├── sub_revitalize/RevitalizeProgress.tsx     # live streaming log + cancel
├── sub_revitalize/RevitalizeSummaryCard.tsx  # end-of-pass stats (removed/merged/tokens saved/...)
├── sub_revitalize/RevitalizeHistoryTable.tsx # persisted Recent-passes table (when / vault / result)
└── sub_revitalize/useRevitalizeJob.ts # job lifecycle, event stream, snapshot re-attach
```

```
scripts/connectors/builtin/
└── obsidian-memory.json               # Obsidian Memory connector seed (gated on obsidian-brain plugin)

scripts/mcp-server/
└── index.mjs                          # MCP server with vault_* tools agents call via Claude Desktop
```

All copy lives under `t.plugins.obsidian_brain.*` in `src/i18n/locales/en.json`. Connector gating filter applied centrally in `src/stores/slices/vault/credentialSlice.ts:fetchConnectorDefinitions`. Prompt-builder hint for the connector lives in `src-tauri/src/engine/build_session.rs` next to the `codebase` connector hint.
