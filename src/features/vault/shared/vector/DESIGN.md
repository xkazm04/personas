# KB structured extraction — design

Status: implemented 2026-07-13 (research run — YouTube ItW-ielFvGg, finding [4]).

## The problem

Semantic search over a document corpus answers "find me passages about X".
It cannot answer "how many footings are in the warehouse slab?" — a question
that needs the corpus restructured around the *objects* it describes, with
their attributes pulled into queryable rows, not left as prose to be re-read
every time. The source video builds exactly this for construction drawings;
the idea is domain-general (invoices → line items, contracts → clauses,
papers → claims).

Personas already had the LLM→typed-rows pattern for chat (`brain/semantic.rs`
turns episodes into `companion_fact` rows with confidence + provenance). The
document lane had no equivalent. This adds it.

## Shape: two passes with a human gate between them

The schema is **inferred, then approved, then applied** — the option chosen in
the research triage. A one-pass "extract whatever you find" gives no control
over what gets pulled; a fixed template can't cover novel corpora. Inferring a
schema and letting the user edit it before the expensive extraction runs is the
middle path.

1. **Infer** (`kb_infer_schema`, synchronous, one CLI call). Sample chunks
   across the KB's documents, ask the model to propose entity types and their
   fields. Returns a `KbExtractionSchema` — *not persisted*. Cheap (one call,
   `--max-turns 1`, sonnet).
2. **Review** (UI). The user edits the proposed schema — rename/remove entity
   types, add/drop fields — before anything expensive runs. This is the whole
   reason the schema is inferred rather than auto-applied: a wrong inferred
   schema would otherwise silently shape every extracted row.
3. **Extract** (`kb_run_extraction`, background via `tokio::spawn`). Creates a
   `kb_extraction_runs` row, then for each document feeds its chunks to the
   model with the approved schema and writes `kb_entities` rows. Each row keeps
   its `document_id` + `source_page` (the provenance added in the sibling
   commit) and an `extraction_confidence`. Progress events on
   `kb-extraction-progress`.

## Data

- `kb_extraction_runs(id, kb_id, schema_json, status, entity_count,
  error_message, created_at, completed_at)` — one row per extraction.
  status ∈ {running, completed, failed}.
- `kb_entities(id, run_id, kb_id, document_id, source_page, entity_type,
  entity_key, attributes_json, extraction_confidence, created_at)`.
  `entity_key` is the model's short label for the instance ("F10 footing");
  `attributes_json` is the field→value object matching the schema.

Both live in the **user DB** next to `kb_chunks`, created in
`KNOWLEDGE_BASE_SCHEMA` with defensive incremental ALTERs (same contract as the
rest of that schema — `CREATE TABLE IF NOT EXISTS` + idempotent ALTERs).

## Reuse (no new infrastructure)

- LLM call: `run_claude_prompt_text_inner` (the one-shot helper `schema_proposal`
  uses) + `prompt::build_cli_args(None, None)` pinned to sonnet, `--max-turns 1`.
- Fenced-JSON parse: `ai_helpers::extract_fenced_block(out, "json")`.
- Command shape: `tokio::spawn` from a `#[tauri::command]` that holds both
  `state.db` and `state.user_db`, exactly like `start_schema_proposal`.
- Provenance: `source_page` / `extraction_confidence` on `kb_chunks` (sibling
  commit) flow through to `kb_entities`.

## Non-goals

- No OCR — extraction reads the same text layer ingestion produced. Scanned
  pages contribute nothing, as everywhere else in the KB.
- No re-extraction diffing / incremental update. A run is a full pass; re-runs
  create a new run. Superseding old runs is a follow-up.
- The extractor is a plain per-document pass, not a map-reduce over a huge
  corpus. Documents are processed sequentially with per-document budget caps.
- Not wired as a connector tool yet (unlike `kb_corpus_map`) — it is a
  UI-driven authoring flow first; exposing extraction to agents is a follow-up.
