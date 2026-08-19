---
layer: application
subject: markdown-vault
technique: vault-walking
stack: rust
---

# Vault walking in `vault_fs.rs` (Rust)

`src-tauri/src/commands/obsidian_brain/vault_fs.rs` is the technique's
extraction story executed end to end: five near-identical directory walkers
(and three wikilink extractors) had drifted across `graph.rs`, `lint.rs`,
`semantic_lint.rs`, `revitalize.rs`, and `drive.rs`. The 2026-07 extraction
unified them into one `walk_markdown_files` — with the module header stating
the constraint that makes it exemplary: the callers' policies were
*deliberately* different, so the shared walker makes the differences
**explicit options instead of silently unifying them**, "so porting a caller
to the shared walker changes zero observable behavior".

## The three decisions, as a literal options struct

`WalkOptions` (`vault_fs.rs:38-70`) is the technique's decision list in code,
each field's doc tracing its default to the originating caller:

- `max_depth` — `graph.rs`'s walker capped at 12 as a symlink-loop /
  pathological-nesting backstop (that's the default); the other four were
  unbounded and opt in via `UNBOUNDED_DEPTH = u32::MAX`.
- `on_error: ErrorPolicy` — the five originals "split cleanly into two
  camps" (`:21-25`): `graph.rs`/`revitalize.rs` skipped unreadable
  subdirectories (`SkipSilently`), `lint.rs`/`semantic_lint.rs`/`drive.rs`
  propagated via `?` (`Abort`).
- `skip_hidden_files` — only `graph.rs` had tested the dot-prefix before
  branching on file-vs-directory, so only it excluded hidden *files*;
  default `false` preserves the majority, `graph.rs` opts in with `true`
  (and `graph.rs:120-128` carries the mirror-image comment at the call
  site). Dot-prefixed **directories** (`.obsidian`, `.trash`, `.git`) are
  excluded unconditionally — "every original walker agreed on that".

## Error policy chosen by consumer semantics

The two camps are not historical accident; they map to what each consumer's
output *claims*:

- `lint.rs::collect_markdown_files` (`lint.rs:142-150`) uses `Abort` +
  unbounded depth, with the comment naming the reason: "a lint pass that
  silently skipped part of the vault would report a false-clean result, so
  this walker fails loudly instead". The lint's verdict is about the whole
  vault, so a partial walk is a lie.
- `revitalize.rs::scan_vault_notes` (`revitalize.rs:118-131`) uses
  `SkipSilently`, again with the reason in place: "a best-effort
  before/after measurement around a revitalize pass, not a
  correctness-critical walk". A skipped corner biases a byte count; it does
  not falsify a verdict.

## Symlinks: two postures for two surfaces

The shared walker follows symlinks (all originals used `is_dir()`, which
follows) and leans on `max_depth` as the loop backstop (`:72-76`). But the
caller-facing tree listing `obsidian_brain_list_vault_files`
(`mod.rs:1518-1526`) — whose output is a navigable listing handed to the UI
from caller-supplied subpaths — refuses to descend into symlinked
directories at all: "a symlink inside the vault can still point outside it".
The stricter posture sits exactly on the security-sensitive surface.

## Cheap enumeration, expensive reads behind it

`walk_markdown_files` returns paths only. `graph.rs::walk_vault`
(`graph.rs:112-157`) layers the expensive form — full body reads plus link
extraction — behind a short-TTL cache keyed by vault root, because every
graph command had been re-reading O(vault bytes) per invocation
(`:92-100`). The cache is invalidated by the file watcher and bounded by a
30s TTL for edits made while no watcher runs — the derived-view honesty the
technique requires when the cheap/expensive split is cached.
