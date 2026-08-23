use crate::models::DocumentSignature;
use crate::DbPool;
use personas_core::error::AppError;

/// One projection for every read of `document_signatures`. Mirrors
/// `CREATE TABLE document_signatures` at
/// `migrations/incremental/e03_p2p_and_telemetry.rs:365`.
const COLUMNS: &str = "id, file_name, file_path, file_hash, signature_b64, signer_peer_id, \
                       signer_public_key_b64, signer_display_name, metadata, signed_at, \
                       created_at";

row_mapper!(row_to_signature -> DocumentSignature {
    id,
    file_name,
    file_path,
    file_hash,
    signature_b64,
    signer_peer_id,
    signer_public_key_b64,
    signer_display_name,
    metadata,
    signed_at,
    created_at,
});

pub fn insert_signature(
    pool: &DbPool,
    sig: &DocumentSignature,
) -> Result<DocumentSignature, AppError> {
    timed_query!("signing_sessions", "signing_sessions::insert_signature", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO document_signatures (id, file_name, file_path, file_hash, signature_b64, signer_peer_id, signer_public_key_b64, signer_display_name, metadata, signed_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                sig.id,
                sig.file_name,
                sig.file_path,
                sig.file_hash,
                sig.signature_b64,
                sig.signer_peer_id,
                sig.signer_public_key_b64,
                sig.signer_display_name,
                sig.metadata,
                sig.signed_at,
                sig.created_at,
            ],
        )?;
        get_signature(pool, &sig.id)
    })
}

pub fn list_signatures(pool: &DbPool) -> Result<Vec<DocumentSignature>, AppError> {
    timed_query!("signing_sessions", "signing_sessions::list_signatures", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM document_signatures ORDER BY created_at DESC"
        ))?;
        let rows = stmt.query_map([], row_to_signature)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    })
}

pub fn get_signature(pool: &DbPool, id: &str) -> Result<DocumentSignature, AppError> {
    timed_query!("signing_sessions", "signing_sessions::get_signature", {
        let conn = pool.get()?;
        conn.query_row(
            &format!("SELECT {COLUMNS} FROM document_signatures WHERE id = ?1"),
            [id],
            row_to_signature,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Signature not found: {id}"))
            }
            other => AppError::from(other),
        })
    })
}

pub fn delete_signature(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("signing_sessions", "signing_sessions::delete_signature", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM document_signatures WHERE id = ?1", [id])?;
        Ok(rows > 0)
    })
}
