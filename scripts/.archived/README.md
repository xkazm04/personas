# Archived scripts

Scripts that were once used but are no longer wired into any active workflow
(`package.json` scripts, CI workflows under `.github/workflows/`, lefthook
hooks, or other scripts in `scripts/`). Kept around as paper trail in case a
historical workflow needs to be reconstructed; remove on a future cleanup
pass once confidence builds.

If you need one of these, `git mv` it back to `scripts/` and re-wire its
caller in the same change. If you're certain a script here is dead and
won't ever be needed, delete it and note the deletion in the commit message.

## Inventory

| Script | Archived | Reason |
|---|---|---|
| `add-resources-batch.mjs` | 2026-05-10 | One-off mass-import tool. Last referenced in `docs/_archive/HANDOFF-resource-scoping.md`. |
| `apply-connector-multi-tags.mjs` | 2026-05-10 | One-off batch metadata mutation. Last referenced in `docs/_archive/concepts/persona-capabilities/_archive/C3-session-handoff-2026-04-22.md`. |
| `check-api-coverage.mjs` | 2026-05-10 | API coverage checker; never wired to CI or local hooks. |
| `check-template-ids.mjs` | 2026-05-10 | Template ID uniqueness checker; superseded by `generate-template-checksums.mjs` validation pass. |
| `export-templates.mjs` | 2026-05-10 | One-off Supabase template export tool; replaced by the `/add-template` skill's Phase 5 flow. |
| `generate-agent-icons.mjs` | 2026-05-10 | Earlier per-icon generation; superseded by `generate-agent-icon-sprites.mjs` (sprite-sheet variant) for runtime perf. |
| `patch-d3-define.mjs` | 2026-05-10 | One-off polyfill for a d3 import issue; no longer needed after dep upgrade. |
| `reformat-templates.mjs` | 2026-05-10 | One-off template JSON reformatter; not used since canonical format stabilized. |
| `test-cli-capture.mjs` | 2026-05-10 | Manual test utility for CLI output capture; never integrated. |
| `verify-scoping-live.mjs` | 2026-05-10 | Earlier live-API resource-scoping check; superseded by `verify-resource-scoping.mjs`. |

Active counterparts (when relevant) are documented in `.claude/codebase-stack.md` § build-time codegen helpers.

Surfaced by [[Architect/decisions/2026-05-10-build-pipeline-quick-wins]].
