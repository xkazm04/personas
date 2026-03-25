use crate::db::models::DocumentSignature;
use crate::db::DbPool;
use crate::error::AppError;

pub fn insert_signature(pool: &DbPool, sig: &DocumentSignature) -> Result<DocumentSignature, AppError> {
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
}

pub fn list_signatures(pool: &DbPool) -> Result<Vec<DocumentSignature>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, file_name, file_path, file_hash, signature_b64, signer_peer_id, signer_public_key_b64, signer_display_name, metadata, signed_at, created_at
         FROM document_signatures ORDER BY created_at DESC"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(DocumentSignature {
            id: row.get(0)?,
            file_name: row.get(1)?,
            file_path: row.get(2)?,
            file_hash: row.get(3)?,
            signature_b64: row.get(4)?,
            signer_peer_id: row.get(5)?,
            signer_public_key_b64: row.get(6)?,
            signer_display_name: row.get(7)?,
            metadata: row.get(8)?,
            signed_at: row.get(9)?,
            created_at: row.get(10)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub fn get_signature(pool: &DbPool, id: &str) -> Result<DocumentSignature, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT id, file_name, file_path, file_hash, signature_b64, signer_peer_id, signer_public_key_b64, signer_display_name, metadata, signed_at, created_at
         FROM document_signatures WHERE id = ?1",
        [id],
        |row| {
            Ok(DocumentSignature {
                id: row.get(0)?,
                file_name: row.get(1)?,
                file_path: row.get(2)?,
                file_hash: row.get(3)?,
                signature_b64: row.get(4)?,
                signer_peer_id: row.get(5)?,
                signer_public_key_b64: row.get(6)?,
                signer_display_name: row.get(7)?,
                metadata: row.get(8)?,
                signed_at: row.get(9)?,
                created_at: row.get(10)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("Signature not found: {id}"))
        }
        other => AppError::from(other),
    })
}

pub fn delete_signature(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM document_signatures WHERE id = ?1", [id])?;
    Ok(rows > 0)
}
