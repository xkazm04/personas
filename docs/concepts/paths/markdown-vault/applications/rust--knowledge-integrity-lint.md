---
layer: application
subject: markdown-vault
technique: knowledge-integrity-lint
stack: rust
---

# Knowledge integrity lint over the Obsidian vault (Rust)

The repo runs all three layers of the technique against the operator's
vault: a deterministic syntactic pass
(`src-tauri/src/commands/obsidian_brain/lint.rs`), an opt-in LLM semantic
pass (`semantic_lint.rs`), and a bounded repair pass (`revitalize.rs`).
Detection never mutates; repair is a separate command with its own budget.

## The syntactic pass

`lint_vault` (`lint.rs:29-135`) is read-only by module contract ("Pure
read-only — never mutates the vault", `:6`) and emits a `VaultLintReport`
with the three defect classes:

- **Broken wikilinks** — every link resolved through the shared
  `extract_wikilinks` + `strip_alias_and_section` against a lowercased
  basename index (`:43-50`), reported with source path and **line number**
  (`BrokenWikilink::line`) — compiler-error ergonomics.
- **Orphans** — notes never referenced, minus a declared exemption
  predicate: `is_likely_entry_point` (`:156-171`) exempts top-level notes
  and `README`/`index`/`00 `/`_index` names, and the heuristic is one
  named function beside the check, not scattered special cases.
- **Staleness** — mtime older than `stale_days` (default 180, `:23`;
  `0` disables), reported with `days_stale` so the consumer sees the
  predicate's output, not a verdict.

The walk aborts on the first unreadable directory
(`collect_markdown_files`, `:142-150`) — `ErrorPolicy::Abort`, unbounded
depth — with the false-clean rationale written at the call site.

## The semantic pass

`semantic_lint.rs` adds the judgment tier with the opposite operating
contract, all stated in the module header (`:1-13`): opt-in only, bills
tokens, "the vault is not mutated — the report is a proposal the user
reviews before acting on". The input is bounded three ways —
`MAX_NOTES_IN_PROMPT = 120`, `MAX_SNIPPET_CHARS = 320`,
`MAX_PROMPT_CHARS = 140_000` (`:46-52`) — and a 90s timeout caps the call.
Finding types match the technique's semantic classes: `Inconsistency`,
`MissingPageCandidate`, `ProposedLink`, `KnowledgeGap`.

## The repair pass

`revitalize.rs` runs an agentic CLI session *inside* the vault with the
technique's full repair contract:

- **Bounded**: `NOTES_PER_PASS = 40` soft budget in the prompt;
  `REVITALIZE_TIMEOUT_SECS = 540` hard cap, sized to stay under the job
  manager's stale-running sweep (`:49-57`); one pass at a time app-wide
  (`:397-406`).
- **Goal-declared**: `RevitalizeOptions { prune_stale, merge_duplicates,
  refresh_structure }` — the pass refuses to start with zero goals
  (`:369-373`).
- **Fact-preserving rules in the prompt** (`build_revitalize_prompt`,
  `:179-212`): "Never invent facts. When merging, preserve every distinct
  fact from the source notes"; user-authored daily/meeting notes kept
  intact unless exact duplicates; only `.md` inside the vault, never
  dot-directories.
- **Measured regardless of outcome**: `scan_vault_notes` runs before the
  pass and again after — explicitly "regardless of outcome — a
  failed/cancelled pass may still have modified notes" (`:471-473`) — and
  the run record stores both the model's self-reported
  `REVITALIZE_SUMMARY` counts and the measured before/after note/byte
  deltas, so self-report is reconciled against measurement.

## A predicate divergence worth naming

`graph.rs` computes its own orphan set (`obsidian_graph_list_orphans`,
`graph.rs:415-440`; `VaultStats::orphan_count`, `:479-482`) as "no
backlinks" with **no entry-point exemption**, while `lint.rs` exempts entry
points. Two features, two orphan counts, predicates differing by an
exemption policy — exactly the count-carries-predicate hazard the technique
warns about. The counts are internally consistent per surface but will
disagree with each other on any vault with top-level index notes.
