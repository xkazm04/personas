//! Structured extraction for knowledge bases: turn a document corpus into
//! typed, queryable rows instead of prose to be re-read.
//!
//! Two passes with a human gate between them (see
//! `src/features/vault/shared/vector/DESIGN.md`):
//!   1. `infer_schema` — sample chunks, ask the model what entity types and
//!      fields the corpus contains. Cheap, one CLI call, nothing persisted.
//!   2. (user reviews/edits the proposed schema)
//!   3. `run_extraction` — for each document, extract rows matching the
//!      approved schema and write `kb_entities`, keeping each row's page.
//!
//! Both passes reuse the one-shot CLI helper the rest of the codebase uses
//! (`run_claude_prompt_text_inner`); this module owns only the prompts, the
//! JSON parsing, and the storage.

use rusqlite::params;
use tauri::{AppHandle, Emitter};

use crate::commands::design::n8n_transform::run_claude_prompt_text_inner;
use crate::db::models::{
    KbEntity, KbExtractionProgress, KbExtractionRun, KbExtractionSchema, KbSchemaEntity,
};
use crate::db::UserDbPool;
use crate::engine::ai_helpers;
use crate::engine::prompt;
use crate::error::AppError;

/// Model used for both passes. Sonnet is enough for structured extraction and
/// keeps a full-corpus pass affordable; the schema-inference call is trivial.
const EXTRACTION_MODEL: &str = "claude-sonnet-4-6";

/// Chunks sampled for schema inference. A schema is a shape, not a census —
/// a spread across the corpus is enough to see the entity types, and keeping
/// this bounded keeps pass 1 a single cheap call.
const INFER_SAMPLE_CHUNKS: usize = 40;

/// Max characters of document text fed to one extraction call. Documents
/// larger than this are truncated for the pass (a follow-up could window them);
/// the cap is the per-document budget backstop the DESIGN calls for.
const EXTRACT_DOC_CHAR_CAP: usize = 24_000;

const PROGRESS_EVENT: &str = "kb-extraction-progress";

fn build_args() -> crate::engine::types::CliArgs {
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(EXTRACTION_MODEL.to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());
    cli_args
}

// ── Pass 1: schema inference ────────────────────────────────────────────────

/// Sample chunks across the KB and ask the model to propose an extraction
/// schema. Returns the proposal — it is NOT persisted; the user edits it and
/// hands the approved version to `run_extraction`.
pub async fn infer_schema(
    user_db: &UserDbPool,
    kb_id: &str,
) -> Result<KbExtractionSchema, AppError> {
    let samples = sample_chunks(user_db, kb_id, INFER_SAMPLE_CHUNKS)?;
    if samples.is_empty() {
        return Err(AppError::Validation(
            "This knowledge base has no indexed text to infer a schema from.".into(),
        ));
    }

    let corpus = samples.join("\n---\n");
    let prompt_text = format!(
        "You are designing a database schema to extract structured data from a document corpus.\n\
         Below are sample passages from the corpus, separated by `---`.\n\n\
         Identify the distinct TYPES OF OBJECTS the corpus describes (e.g. for construction \
         drawings: footing, slab, cable_run; for invoices: line_item, party). For each type, \
         list the ATTRIBUTES worth pulling into columns. Prefer a small number of well-chosen \
         types and fields over an exhaustive list.\n\n\
         Respond with ONLY a fenced ```json block of this exact shape:\n\
         {{\"entities\":[{{\"entityType\":\"snake_case_singular\",\"description\":\"one line\",\
         \"fields\":[{{\"name\":\"snake_case\",\"description\":\"what it holds\"}}]}}]}}\n\n\
         Corpus samples:\n\n{corpus}"
    );

    let (output, _session, _) =
        run_claude_prompt_text_inner(prompt_text, &build_args(), None, None, None, 120)
            .await
            .map_err(|e| AppError::Internal(format!("Schema inference call failed: {e}")))?;

    let json = ai_helpers::extract_fenced_block(&output, "json").ok_or_else(|| {
        AppError::Internal("The model did not return a JSON schema block.".into())
    })?;

    let schema: KbExtractionSchema = serde_json::from_str(&json)
        .map_err(|e| AppError::Internal(format!("Proposed schema was not valid: {e}")))?;

    if schema.entities.is_empty() {
        return Err(AppError::Validation(
            "The model found no structured entity types in this corpus.".into(),
        ));
    }

    Ok(schema)
}

// ── Pass 2: extraction ──────────────────────────────────────────────────────

/// Create an extraction run and process every document in the KB against the
/// approved schema, writing `kb_entities`. Emits progress on `PROGRESS_EVENT`.
/// Long-running — call from a spawned task, not inline in a command.
pub async fn run_extraction(
    app: AppHandle,
    user_db: UserDbPool,
    kb_id: String,
    run_id: String,
    schema: KbExtractionSchema,
) -> Result<(), AppError> {
    let docs = crate::engine::kb_ingest::list_kb_documents(&user_db, &kb_id)?;
    let indexed: Vec<_> = docs.into_iter().filter(|d| d.status == "indexed").collect();

    let mut progress = KbExtractionProgress {
        run_id: run_id.clone(),
        kb_id: kb_id.clone(),
        status: "running".into(),
        documents_total: indexed.len(),
        documents_done: 0,
        entities_found: 0,
        current_document: None,
        error: None,
    };

    let schema_prompt = render_schema_for_prompt(&schema.entities);

    for (i, doc) in indexed.iter().enumerate() {
        progress.current_document = Some(doc.title.clone());
        let _ = app.emit(PROGRESS_EVENT, &progress);

        let (text, pages) = document_text(&user_db, &doc.id, EXTRACT_DOC_CHAR_CAP)?;
        if text.trim().is_empty() {
            progress.documents_done = i + 1;
            continue;
        }

        match extract_document(&schema_prompt, &doc.title, &text).await {
            Ok(rows) => {
                let stored = store_entities(&user_db, &run_id, &kb_id, &doc.id, &pages, rows)?;
                progress.entities_found += stored;
            }
            Err(e) => {
                // One bad document should not abort the whole run — record it
                // and keep going, same posture as ingest_files.
                tracing::warn!(doc = %doc.title, error = %e, "Entity extraction failed for document");
            }
        }

        progress.documents_done = i + 1;
        let _ = app.emit(PROGRESS_EVENT, &progress);
    }

    finalize_run(&user_db, &run_id, progress.entities_found as i32, None)?;
    progress.status = "completed".into();
    progress.current_document = None;
    let _ = app.emit(PROGRESS_EVENT, &progress);

    Ok(())
}

/// Extract rows from one document's text against the schema.
async fn extract_document(
    schema_prompt: &str,
    title: &str,
    text: &str,
) -> Result<Vec<ExtractedRow>, AppError> {
    let prompt_text = format!(
        "Extract structured data from the document below, following this schema:\n\n\
         {schema_prompt}\n\n\
         Rules:\n\
         - Emit one object per real instance you find. Do not invent data.\n\
         - `entityType` must be one of the schema types above.\n\
         - `entityKey` is a short human label for the instance (e.g. \"F10 footing\").\n\
         - `attributes` holds the schema fields you could fill; omit fields not stated.\n\
         - `page` is the page number if the text marks one (look for \"[page N]\"), else null.\n\
         - `confidence` is 0.0-1.0: 1.0 for values stated verbatim, lower when inferred.\n\n\
         Respond with ONLY a fenced ```json block: \
         {{\"rows\":[{{\"entityType\":\"...\",\"entityKey\":\"...\",\"attributes\":{{}},\
         \"page\":null,\"confidence\":1.0}}]}}\n\n\
         Document \"{title}\":\n\n{text}"
    );

    let (output, _session, _) =
        run_claude_prompt_text_inner(prompt_text, &build_args(), None, None, None, 180)
            .await
            .map_err(|e| AppError::Internal(format!("Extraction call failed: {e}")))?;

    let json = ai_helpers::extract_fenced_block(&output, "json")
        .ok_or_else(|| AppError::Internal("No JSON block in extraction output.".into()))?;

    let parsed: ExtractionResponse = serde_json::from_str(&json)
        .map_err(|e| AppError::Internal(format!("Extraction output was not valid JSON: {e}")))?;

    Ok(parsed.rows)
}

// ── Storage / reads ─────────────────────────────────────────────────────────

/// Create a `kb_extraction_runs` row up front so the UI has a handle to track;
/// status starts `running` and is closed out by `finalize_run`.
pub fn create_run(
    user_db: &UserDbPool,
    kb_id: &str,
    run_id: &str,
    schema: &KbExtractionSchema,
) -> Result<(), AppError> {
    let schema_json = serde_json::to_string(schema)
        .map_err(|e| AppError::Internal(format!("Failed to serialize schema: {e}")))?;
    let conn = user_db.get()?;
    conn.execute(
        "INSERT INTO kb_extraction_runs (id, kb_id, schema_json, status) VALUES (?1, ?2, ?3, 'running')",
        params![run_id, kb_id, schema_json],
    )?;
    Ok(())
}

/// Mark a run terminal. `error` present ⇒ failed; else completed.
pub fn finalize_run(
    user_db: &UserDbPool,
    run_id: &str,
    entity_count: i32,
    error: Option<&str>,
) -> Result<(), AppError> {
    let status = if error.is_some() { "failed" } else { "completed" };
    let conn = user_db.get()?;
    conn.execute(
        "UPDATE kb_extraction_runs
         SET status = ?1, entity_count = ?2, error_message = ?3, completed_at = datetime('now')
         WHERE id = ?4",
        params![status, entity_count, error, run_id],
    )?;
    Ok(())
}

fn store_entities(
    user_db: &UserDbPool,
    run_id: &str,
    kb_id: &str,
    document_id: &str,
    doc_pages: &[Option<i32>],
    rows: Vec<ExtractedRow>,
) -> Result<usize, AppError> {
    if rows.is_empty() {
        return Ok(0);
    }
    let conn = user_db.get()?;
    let mut stmt = conn.prepare(
        "INSERT INTO kb_entities
            (id, run_id, kb_id, document_id, source_page, entity_type, entity_key,
             attributes_json, extraction_confidence, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))",
    )?;
    let mut n = 0;
    for row in rows {
        // Trust the model's page only if it's a page the document actually has;
        // otherwise fall back to the document's first known page (better a real
        // page than a hallucinated one).
        let page = row
            .page
            .filter(|p| doc_pages.contains(&Some(*p)))
            .or_else(|| doc_pages.iter().flatten().next().copied());
        let attrs = serde_json::to_string(&row.attributes).unwrap_or_else(|_| "{}".into());
        let confidence = row.confidence.unwrap_or(1.0).clamp(0.0, 1.0);
        stmt.execute(params![
            uuid::Uuid::new_v4().to_string(),
            run_id,
            kb_id,
            document_id,
            page,
            row.entity_type,
            row.entity_key,
            attrs,
            confidence,
        ])?;
        n += 1;
    }
    Ok(n)
}

/// All extraction runs for a KB, newest first.
pub fn list_runs(user_db: &UserDbPool, kb_id: &str) -> Result<Vec<KbExtractionRun>, AppError> {
    let conn = user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, kb_id, schema_json, status, entity_count, error_message, created_at, completed_at
         FROM kb_extraction_runs WHERE kb_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt
        .query_map(params![kb_id], |row| {
            Ok(KbExtractionRun {
                id: row.get(0)?,
                kb_id: row.get(1)?,
                schema_json: row.get(2)?,
                status: row.get(3)?,
                entity_count: row.get(4)?,
                error_message: row.get(5)?,
                created_at: row.get(6)?,
                completed_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Extracted entities for a KB, optionally filtered to one entity type,
/// with the source document title hydrated for display.
pub fn list_entities(
    user_db: &UserDbPool,
    kb_id: &str,
    entity_type: Option<&str>,
) -> Result<Vec<KbEntity>, AppError> {
    let conn = user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT e.id, e.run_id, e.kb_id, e.document_id, d.title, e.source_page,
                e.entity_type, e.entity_key, e.attributes_json, e.extraction_confidence, e.created_at
         FROM kb_entities e
         LEFT JOIN kb_documents d ON d.id = e.document_id
         WHERE e.kb_id = ?1 AND (?2 IS NULL OR e.entity_type = ?2)
         ORDER BY e.entity_type, e.created_at",
    )?;
    let rows = stmt
        .query_map(params![kb_id, entity_type], |row| {
            let attrs_json: String = row.get(8)?;
            Ok(KbEntity {
                id: row.get(0)?,
                run_id: row.get(1)?,
                kb_id: row.get(2)?,
                document_id: row.get(3)?,
                document_title: row.get(4)?,
                source_page: row.get(5)?,
                entity_type: row.get(6)?,
                entity_key: row.get(7)?,
                attributes: serde_json::from_str(&attrs_json).ok(),
                extraction_confidence: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/// A spread of chunk contents across the KB for schema inference.
fn sample_chunks(user_db: &UserDbPool, kb_id: &str, limit: usize) -> Result<Vec<String>, AppError> {
    let conn = user_db.get()?;
    // Order by document then chunk so the sample spans documents rather than
    // taking the first N chunks of the first document.
    let mut stmt = conn.prepare(
        "SELECT content FROM kb_chunks WHERE kb_id = ?1 ORDER BY document_id, chunk_index LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![kb_id, limit as i64], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// A document's chunk text (page-annotated, capped) plus the distinct pages it
/// spans. The `[page N]` markers let the extractor attribute rows to pages.
fn document_text(
    user_db: &UserDbPool,
    document_id: &str,
    char_cap: usize,
) -> Result<(String, Vec<Option<i32>>), AppError> {
    let conn = user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT content, source_page FROM kb_chunks WHERE document_id = ?1 ORDER BY chunk_index",
    )?;
    let rows = stmt
        .query_map(params![document_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<i32>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut text = String::new();
    let mut pages: Vec<Option<i32>> = Vec::new();
    for (content, page) in rows {
        if !pages.contains(&page) {
            pages.push(page);
        }
        if let Some(p) = page {
            text.push_str(&format!("[page {p}]\n"));
        }
        text.push_str(&content);
        text.push_str("\n\n");
        if text.len() >= char_cap {
            text.truncate(char_cap);
            break;
        }
    }
    Ok((text, pages))
}

/// Render the schema as a compact description for the extraction prompt.
fn render_schema_for_prompt(entities: &[KbSchemaEntity]) -> String {
    let mut out = String::new();
    for e in entities {
        out.push_str(&format!("- {} ({})\n", e.entity_type, e.description));
        for f in &e.fields {
            out.push_str(&format!("    - {}: {}\n", f.name, f.description));
        }
    }
    out
}

// ── Wire types for the extraction CLI response ──────────────────────────────

#[derive(serde::Deserialize)]
struct ExtractionResponse {
    #[serde(default)]
    rows: Vec<ExtractedRow>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractedRow {
    entity_type: String,
    entity_key: String,
    #[serde(default)]
    attributes: serde_json::Value,
    #[serde(default)]
    page: Option<i32>,
    #[serde(default)]
    confidence: Option<f32>,
}
