use rusqlite::{params, Row};
use tracing::instrument;

use crate::db::models::{LocalIdentity, PeerIdentity, TrustedPeer, UpdateTrustedPeerInput};
use crate::db::DbPool;
use crate::error::AppError;

// -- Row mappers ---------------------------------------------------------

fn row_to_local_identity(row: &Row) -> rusqlite::Result<LocalIdentity> {
    Ok(LocalIdentity {
        peer_id: row.get("peer_id")?,
        display_name: row.get("display_name")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_peer_identity(row: &Row) -> rusqlite::Result<PeerIdentity> {
    let pk_bytes: Vec<u8> = row.get("public_key")?;
    Ok(PeerIdentity {
        peer_id: row.get("peer_id")?,
        public_key_b64: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &pk_bytes,
        ),
        display_name: row.get("display_name")?,
        created_at: row.get("created_at")?,
    })
}

fn row_to_trusted_peer(row: &Row) -> rusqlite::Result<TrustedPeer> {
    let pk_bytes: Vec<u8> = row.get("public_key")?;
    let tl_str: String = row.get("trust_level")?;
    Ok(TrustedPeer {
        peer_id: row.get("peer_id")?,
        public_key_b64: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &pk_bytes,
        ),
        display_name: row.get("display_name")?,
        trust_level: tl_str.parse().map_err(|e: AppError| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?,
        added_at: row.get("added_at")?,
        last_seen: row.get("last_seen")?,
        notes: row.get("notes")?,
    })
}

// -- Local Identity ------------------------------------------------------

#[instrument(skip(pool))]
pub fn get_local_identity(pool: &DbPool) -> Result<Option<PeerIdentity>, AppError> {
    timed_query!("identity_links", "identity_links::get_local_identity", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM local_identity WHERE id = 1",
            [],
            row_to_peer_identity,
        )
        .optional()
        .map_err(AppError::Database)

    })
}

#[instrument(skip(pool, public_key))]
pub fn upsert_local_identity(
    pool: &DbPool,
    peer_id: &str,
    public_key: &[u8],
    display_name: &str,
) -> Result<PeerIdentity, AppError> {
    timed_query!("identity_links", "identity_links::upsert_local_identity", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO local_identity (id, peer_id, public_key, display_name)
             VALUES (1, ?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
                peer_id = excluded.peer_id,
                public_key = excluded.public_key,
                display_name = excluded.display_name",
            params![peer_id, public_key, display_name],
        )?;
        get_local_identity(pool)?.ok_or_else(|| AppError::Internal("Identity upsert failed".into()))

    })
}

#[instrument(skip(pool))]
pub fn update_display_name(pool: &DbPool, display_name: &str) -> Result<PeerIdentity, AppError> {
    timed_query!("identity_links", "identity_links::update_display_name", {
        let conn = pool.get()?;
        let changed = conn.execute(
            "UPDATE local_identity SET display_name = ?1 WHERE id = 1",
            params![display_name],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Local identity not initialized".into()));
        }
        get_local_identity(pool)?.ok_or_else(|| AppError::NotFound("Local identity".into()))

    })
}

// -- Trusted Peers -------------------------------------------------------

#[instrument(skip(pool))]
pub fn list_trusted_peers(pool: &DbPool) -> Result<Vec<TrustedPeer>, AppError> {
    timed_query!("identity_links", "identity_links::list_trusted_peers", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM trusted_peers WHERE trust_level != 'revoked' ORDER BY added_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_trusted_peer)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)

    })
}

#[instrument(skip(pool))]
pub fn get_trusted_peer(pool: &DbPool, peer_id: &str) -> Result<TrustedPeer, AppError> {
    timed_query!("identity_links", "identity_links::get_trusted_peer", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM trusted_peers WHERE peer_id = ?1",
            params![peer_id],
            row_to_trusted_peer,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Trusted peer {peer_id}"))
            }
            other => AppError::Database(other),
        })

    })
}

#[instrument(skip(pool, public_key))]
pub fn add_trusted_peer(
    pool: &DbPool,
    peer_id: &str,
    public_key: &[u8],
    display_name: &str,
    notes: Option<&str>,
) -> Result<TrustedPeer, AppError> {
    timed_query!("identity_links", "identity_links::add_trusted_peer", {
        let conn = pool.get()?;

        // Guard: reject re-import of a previously revoked peer
        let existing_trust: Option<String> = conn
            .query_row(
                "SELECT trust_level FROM trusted_peers WHERE peer_id = ?1",
                params![peer_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::Database)?;

        if existing_trust.as_deref() == Some("revoked") {
            return Err(AppError::Validation(format!(
                "Peer {peer_id} was previously revoked. Explicitly update trust level before re-importing."
            )));
        }

        conn.execute(
            "INSERT INTO trusted_peers (peer_id, public_key, display_name, trust_level, notes)
             VALUES (?1, ?2, ?3, 'manual', ?4)
             ON CONFLICT(peer_id) DO UPDATE SET
                public_key = excluded.public_key,
                display_name = excluded.display_name,
                trust_level = 'manual',
                notes = excluded.notes",
            params![peer_id, public_key, display_name, notes],
        )?;
        get_trusted_peer(pool, peer_id)

    })
}

#[instrument(skip(pool, input))]
pub fn update_trusted_peer(
    pool: &DbPool,
    peer_id: &str,
    input: UpdateTrustedPeerInput,
) -> Result<TrustedPeer, AppError> {
    timed_query!("identity_links", "identity_links::update_trusted_peer", {
        let conn = pool.get()?;

        if let Some(name) = &input.display_name {
            conn.execute(
                "UPDATE trusted_peers SET display_name = ?1 WHERE peer_id = ?2",
                params![name, peer_id],
            )?;
        }
        if let Some(level) = &input.trust_level {
            conn.execute(
                "UPDATE trusted_peers SET trust_level = ?1 WHERE peer_id = ?2",
                params![level.to_string(), peer_id],
            )?;
        }
        if let Some(notes_opt) = &input.notes {
            conn.execute(
                "UPDATE trusted_peers SET notes = ?1 WHERE peer_id = ?2",
                params![notes_opt, peer_id],
            )?;
        }
        get_trusted_peer(pool, peer_id)

    })
}

#[instrument(skip(pool))]
pub fn revoke_peer_trust(pool: &DbPool, peer_id: &str) -> Result<(), AppError> {
    timed_query!("identity_links", "identity_links::revoke_peer_trust", {
        let conn = pool.get()?;
        let changed = conn.execute(
            "UPDATE trusted_peers SET trust_level = 'revoked' WHERE peer_id = ?1",
            params![peer_id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Trusted peer {peer_id}")));
        }
        Ok(())

    })
}

#[instrument(skip(pool))]
pub fn delete_trusted_peer(pool: &DbPool, peer_id: &str) -> Result<(), AppError> {
    timed_query!("identity_links", "identity_links::delete_trusted_peer", {
        let conn = pool.get()?;
        let changed = conn.execute(
            "DELETE FROM trusted_peers WHERE peer_id = ?1",
            params![peer_id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Trusted peer {peer_id}")));
        }
        Ok(())

    })
}

#[instrument(skip(pool))]
pub fn update_last_seen(pool: &DbPool, peer_id: &str) -> Result<(), AppError> {
    timed_query!("identity_links", "identity_links::update_last_seen", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE trusted_peers SET last_seen = datetime('now') WHERE peer_id = ?1",
            params![peer_id],
        )?;
        Ok(())

    })
}

// -- Helpers -------------------------------------------------------------

use rusqlite::OptionalExtension;
