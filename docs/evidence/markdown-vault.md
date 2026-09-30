---
subject: markdown-vault
evidence:
  - src-tauri/src/commands/obsidian_brain/vault_fs.rs      # one walker, five callers — depth/error/hidden policies as explicit options
  - src-tauri/src/commands/obsidian_brain/lint.rs          # staleness, orphans, broken links as defects with detectors; abort-on-unreadable walk
  - src-tauri/src/commands/obsidian_brain/graph.rs         # wikilinks → edges; backlink index; TTL cache + watcher invalidation; atomic writes
  - src-tauri/src/commands/obsidian_brain/markdown.rs      # frontmatter as schema: escaped emit, tolerant parse, round-trip tested
  - src-tauri/src/commands/obsidian_brain/mod.rs           # hash-gated mirror writes; push/pull sync over three-way compare; the one path funnel
  - src-tauri/src/commands/obsidian_brain/conflict.rs      # both-sides-changed detection — sync-replication's ground, consumed here
  - src/features/plugins/obsidian-brain/openInObsidian.ts  # deep links hand navigation back to the human's editor
  - scripts/census/check-corpus-integrity.mjs              # the subject practiced on itself: this doc tree IS a linted markdown vault
counter_evidence:
  # The judgment tier this subject described was never reachable. semantic_lint.rs
  # implemented a bounded, opt-in, propose-only semantic lint, and its single
  # entry point `obsidian_brain_semantic_lint_vault` occurred exactly ONCE in
  # 963 Rust files — at its own definition. No generate_handler! entry named it,
  # so no frontend could call it. Deleted 2026-08-21 with 71 other unreachable
  # IPC commands. The file is recoverable at 4bf1845d7^ if the tier is ever
  # wanted; what it demonstrates now is that a lint tier can be fully written,
  # reviewed and cited as evidence while being unable to run.
deviations:
  - w11-markdown-vault   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Markdown Vault - evidence

How this codebase measures against the [`markdown-vault`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
