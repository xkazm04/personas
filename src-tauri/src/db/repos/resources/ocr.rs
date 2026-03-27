use crate::db::models::OcrDocument;
use crate::db::DbPool;
use crate::error::AppError;

pub fn insert_document(pool: &DbPool, doc: &OcrDocument) -> Result<OcrDocument, AppError> {
    timed_query!("ocr_results", "ocr_results::insert_document", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO ocr_documents (id, file_name, file_path, provider, model, extracted_text, structured_data, prompt, duration_ms, token_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                doc.id, doc.file_name, doc.file_path, doc.provider, doc.model,
                doc.extracted_text, doc.structured_data, doc.prompt, doc.duration_ms,
                doc.token_count, doc.created_at,
            ],
        )?;
        get_document(pool, &doc.id)

    })
}

pub fn list_documents(pool: &DbPool) -> Result<Vec<OcrDocument>, AppError> {
    timed_query!("ocr_results", "ocr_results::list_documents", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, file_name, file_path, provider, model, extracted_text, structured_data, prompt, duration_ms, token_count, created_at
             FROM ocr_documents ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(OcrDocument {
                id: row.get(0)?, file_name: row.get(1)?, file_path: row.get(2)?,
                provider: row.get(3)?, model: row.get(4)?, extracted_text: row.get(5)?,
                structured_data: row.get(6)?, prompt: row.get(7)?, duration_ms: row.get(8)?,
                token_count: row.get(9)?, created_at: row.get(10)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)

    })
}

pub fn get_document(pool: &DbPool, id: &str) -> Result<OcrDocument, AppError> {
    timed_query!("ocr_results", "ocr_results::get_document", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT id, file_name, file_path, provider, model, extracted_text, structured_data, prompt, duration_ms, token_count, created_at
             FROM ocr_documents WHERE id = ?1",
            [id],
            |row| Ok(OcrDocument {
                id: row.get(0)?, file_name: row.get(1)?, file_path: row.get(2)?,
                provider: row.get(3)?, model: row.get(4)?, extracted_text: row.get(5)?,
                structured_data: row.get(6)?, prompt: row.get(7)?, duration_ms: row.get(8)?,
                token_count: row.get(9)?, created_at: row.get(10)?,
            }),
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("OCR document not found: {id}")),
            other => AppError::from(other),
        })

    })
}

pub fn delete_document(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("ocr_results", "ocr_results::delete_document", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM ocr_documents WHERE id = ?1", [id])?;
        Ok(rows > 0)

    })
}
