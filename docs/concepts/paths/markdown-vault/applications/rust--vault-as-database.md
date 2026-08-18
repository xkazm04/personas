---
layer: application
subject: markdown-vault
technique: vault-as-database
stack: rust
---

# Vault as database in the Obsidian Brain plugin (Rust)

The plugin treats the operator's Obsidian vault as a shared database for
persona memories, profiles, connectors, and goals. The record contract lives
in `src-tauri/src/commands/obsidian_brain/markdown.rs`; the trust boundary
and write primitive in `mod.rs` and `graph.rs`.

## The round trip, learned the hard way

`yaml_quote` (`markdown.rs:17-35`) exists because the naive emitter shipped
first: wrapping raw values in quotes produced `persona: "Acme "Pro""` for a
persona named `Acme "Pro"`, which the reader then mis-parsed — and the
pull-sync name lookup silently stopped matching (the bug is preserved in the
function's doc comment). The fix is the full discipline: C-style escapes for
backslash-first, then quote, then control characters; newlines/tabs encoded
so **every frontmatter value stays on one line**, which is what keeps the
line-oriented reader `extract_yaml_field` (`:271-280`) correct.

The reader is deliberately more tolerant than the writer:
`unquote_yaml_scalar` (`:286-296`) accepts double-quoted (un-escaped via
`yaml_unescape`), single-quoted, and bare scalars, so hand-written and
legacy notes keep parsing (`test_extract_yaml_field_legacy_unquoted`,
`:406-411`).

And the test that counts is the round trip:
`test_yaml_quote_roundtrip` (`:384-403`) drives a hostile-value table —
embedded quotes, colons, backslashes, `multi\nline\ttext`, trailing quote,
empty string — through emit → parse → equality, with the comment naming the
original failure as the reason.

## Identity in frontmatter, filename derived

Every emitted record opens with `id: <minted id>` in frontmatter
(`memory_to_markdown`, `markdown.rs:94-124`; `persona_to_markdown`,
`goal_to_markdown` in `mod.rs:1581-1633` likewise), and all sync/mirror
state is keyed `(entity_type, entity_id)` — never by filename. Filenames
come from `sanitize_filename` (`markdown.rs:231-250`): reserved characters
to `-`, boundary-safe truncation at 100, `"untitled"` fallback — lossy by
design and never reversed.

## Two funnels at the trust boundary

The plugin's complete set of vault-root resolvers is exactly two, each
documenting the other:

- `resolve_vault_subpath` (`mod.rs:1426-1459`) for caller-supplied
  **relative fragments**: rejects absolute paths and `..` components up
  front, joins, canonicalizes, asserts prefix containment. Consumed by
  `obsidian_brain_read_vault_note`, `obsidian_brain_list_vault_files`,
  conflict resolution.
- `ensure_within_vault` (`graph.rs:261-285`) for **already-absolute
  candidates** the UI legitimately holds from search/graph results:
  canonicalizes *both* sides and rejects on any canonicalization failure.
  The doc comment records the prior defect (bug-hunt 2026-06-07): a
  `unwrap_or(<raw path>)` fallback turned canonicalize *failure* into a
  guard *bypass* — the un-normalizable path was compared raw.

Both carry an explicit "do not add a third variant" instruction — the
one-validation-door posture written into the code. Even internally-derived
paths route through the funnel where symlinks could betray them: the daily-
note writer containment-checks the `Daily` folder after `create_dir_all`
(`graph.rs:546-561`), because a derived filename is safe but a symlinked
folder is not.

## Atomic writes for stranger readers

`atomic_write` (`graph.rs:513-527`): unique temp sibling
(`.{name}.{uuid}.tmp`), then `rename` over the target — a concurrent
Obsidian render sees old-or-new, never torn. On rename failure the temp is
removed (the reaper named at creation). Its doc comment also states the
limit honestly: atomicity does not arbitrate concurrent read-modify-write on
the same note — that is the sync layer's job, not the primitive's.
