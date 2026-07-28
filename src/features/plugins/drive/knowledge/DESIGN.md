# Drive ↔ Knowledge Base

Origin: `/research` run 2026-07-28 on [Box AI](https://www.box.com/ai) (+ the
`POST /2.0/ai/extract_structured` developer docs). Focus was `code`, scoped to
the Drive plugin.

## Why

Box AI's two load-bearing ideas over a file store are:

1. **AI Hubs** — ask questions across a whole folder of documents, not one file.
2. **Box Extract** — pull *typed fields* out of documents (a field spec with
   `key/type/description/prompt/options`, incl. `struct` and `table`), not a
   wall of OCR text.

Personas already had both engines, and Drive could reach neither:

- The vector-KB lane (`kb_ingest_files` → `kb_search` / `kb_corpus_map`, and the
  two-pass `kb_infer_schema` → `kb_run_extraction` → `kb_entities`) lives in
  `src-tauri/src/commands/credentials/vector_kb.rs`. A grep for `drive` in that
  file returned **zero hits**.
- Drive's only extraction was OCR (`ocr_drive_file_gemini` /
  `ocr_drive_file_claude`) — raw text, no structure.

So the gap was never engine capability. It was a missing bridge.

## Shape

**Zero Rust.** Every command this feature needs is already registered and
already wrapped in `src/api/vault/database/vectorKb.ts`. That was the deciding
constraint: a concurrent session held `vector_kb.rs`, and a frontend-only design
avoids the file entirely.

```
Drive context menu / details pane
  ├ "Add to knowledge base…"  → KbPickerDialog → kbIngestFiles / kbIngestDirectory
  └ "Knowledge…"              → KbPickerDialog → DriveKnowledgeDrawer
                                                   ├ Ask     → <SearchTab kb>
                                                   └ Extract → <ExtractTab kb>
```

### Files

| File | Role |
| --- | --- |
| `useDriveKnowledge.ts` | Availability probe, KB list, path resolution, ingest |
| `KbPickerDialog.tsx` | Choose (or create) the target KB |
| `DriveKnowledgeDrawer.tsx` | Right-drawer host for Ask / Extract |

### Reuse over reimplementation

`DriveKnowledgeDrawer` renders `SearchTab` and `ExtractTab` from
`@/features/vault/shared/vector/tabs/`. Both already take exactly one prop
(`{ kb: KnowledgeBase }`) and own their own state, progress events, and empty
states — so Ask and Extract in Drive are the *same* surfaces as in the Vault KB
modal, not a second implementation that will drift.

This is a cross-feature import (`plugins/drive` → `vault/shared`). It is
deliberate. `vault/shared/vector` is already a shared subtree consumed by more
than its own sub-feature, and duplicating a schema editor + entity table into
Drive would be strictly worse. If a third consumer appears, promote the folder
rather than copying it again.

## Two constraints that shaped the code

**1. The KB lane is `ml`-gated.** `commands/credentials/mod.rs:30` puts the
whole `vector_kb` module behind `#[cfg(feature = "ml")]`, and each command is
registered behind its own `cfg` line in `lib.rs`. The default `desktop` build
(`tauri:dev:lite`) therefore has **no `list_knowledge_bases` command at all** —
invoking it rejects.

`useDriveKnowledge` handles this by *feature-detecting*: it calls
`listKnowledgeBases()` once on mount and treats a rejection as "this build has
no KB lane", setting `available = false`. Every Drive entry point is hidden when
`available !== true`. There is no capability flag to read, and adding a Rust one
would have meant touching the held file.

**2. Drive speaks relative paths; the KB speaks absolute ones.** Drive's whole
API surface is sandbox-relative (`src/api/drive.ts` rejects absolute paths,
drive letters, and `..` before IPC). `kb_ingest_files` wants real filesystem
paths, which it then canonicalizes and safety-validates itself. So the hook
resolves the managed root once via `driveGetRoot()`, caches it, and joins
`root + "/" + relPath`. Forward slashes are fine on Windows —
`std::fs::canonicalize` normalizes them.

## Non-goals

- **No new persistence.** No folder→KB binding is stored; the picker asks every
  time. A remembered default is a follow-up, and it needs a table.
- **No auto-ingest on `drive.document.added`.** The event exists and is
  triggerable, but wiring a per-folder "extraction agent" is the heavier Hub
  concept below.
- **No metadata write-back onto files.** Box stores extracted fields *as* file
  metadata; Drive has no metadata store, and adding one is Rust work.

## Follow-on (the Hub concept)

The Box-shaped end state is a per-folder Hub: auto-ingest on
`drive.document.added`, a saved extraction agent per folder, and extracted
fields surfaced on the file row. All three need new tables and commands in the
vector-KB lane. Deferred deliberately — revisit once that file is free.
