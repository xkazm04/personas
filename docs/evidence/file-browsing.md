---
subject: file-browsing
evidence:
  - src/features/plugins/drive/hooks/useDrive.ts                    # master browser hook: history nav, identity selection, persisted view-state blob, bulk mutations behind one guard door
  - src-tauri/src/commands/obsidian_brain/vault_fs.rs               # depth-capped walk with explicit per-caller error + hidden-entry policy (cross-domain confirmation from the vault ground)
  - src-tauri/src/commands/drive/mod.rs                                 # soft-delete to trash, hard-delete inside trash, root-destruction refusals re-validated at the command layer
counter_evidence: []
deviations:
  - w7-file-browsing   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# File Browsing - evidence

How this codebase measures against the [`file-browsing`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
