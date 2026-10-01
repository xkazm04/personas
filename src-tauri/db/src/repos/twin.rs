use rusqlite::{params, Row};

use crate::models::{
    TwinChannel, TwinCommunication, TwinContact, TwinDistilledFact, TwinPendingMemory, TwinProfile,
    TwinReflection, TwinTone, TwinVoiceProfile,
};
use crate::DbPool;
use personas_core::error::AppError;

// ============================================================================
// Projections
//
// One `const` per table so every read declares the column set it depends on.
// `SELECT *` left that set to whatever `CREATE TABLE` happened to say at
// runtime -- including columns added later by `ALTER TABLE`
// (`twin_profiles.knowledge_base_id` / `.training_directives` at
// `migrations/incremental/c01_plugin_tables.rs:507,519` and
// `twin_pending_memories.source_communication_id` at
// `migrations/incremental/e05_twin_and_memory_review.rs:505`), which is exactly
// the drift a wildcard cannot show at the call site. Every mapper in this file
// already binds by NAME, so these consts pin the FETCH, not the mapping.
// ============================================================================

const PROFILE_COLUMNS: &str =
    "id, name, slug, bio, role, languages, pronouns, obsidian_subpath, is_active, \
     knowledge_base_id, training_directives, created_at, updated_at";

const TONE_COLUMNS: &str =
    "id, twin_id, channel, voice_directives, examples_json, constraints_json, \
     length_hint, style_json, updated_at";

const PENDING_MEMORY_COLUMNS: &str =
    "id, twin_id, channel, content, title, importance, status, reviewer_notes, \
     source_communication_id, created_at, reviewed_at";

const COMMUNICATION_COLUMNS: &str =
    "id, twin_id, channel, direction, contact_handle, content, summary, \
     key_facts_json, occurred_at, created_at";

const VOICE_PROFILE_COLUMNS: &str =
    "id, twin_id, provider, credential_id, voice_id, model_id, stability, \
     similarity_boost, style, updated_at";

const CHANNEL_COLUMNS: &str =
    "id, twin_id, channel_type, credential_id, persona_id, label, is_active, \
     created_at, updated_at";

const REFLECTION_COLUMNS: &str = "id, twin_id, prompt_seed, content, created_at";

const DISTILLED_FACT_COLUMNS: &str =
    "id, twin_id, contact_handle, content, importance, sources_json, \
     created_at, last_seen_at";

// ============================================================================
// Row mapper
// ============================================================================

fn row_to_twin_profile(row: &Row) -> rusqlite::Result<TwinProfile> {
    Ok(TwinProfile {
        id: row.get("id")?,
        name: row.get("name")?,
        slug: row.get("slug")?,
        bio: row.get("bio")?,
        role: row.get("role")?,
        languages: row.get("languages")?,
        pronouns: row.get("pronouns")?,
        obsidian_subpath: row.get("obsidian_subpath")?,
        is_active: row.get::<_, i32>("is_active")? != 0,
        knowledge_base_id: row.get("knowledge_base_id").unwrap_or(None),
        training_directives: row.get("training_directives").unwrap_or(None),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

// ============================================================================
// Helpers
// ============================================================================

/// Slugify a display name into a vault-folder-safe identifier.
/// Lowercases, replaces non-alphanumeric runs with `-`, trims leading/trailing
/// dashes. Empty result falls back to "twin".
///
/// `pub` so importers (portability bundles) can re-derive a slug rather than
/// carry the source machine's — the slug is UNIQUE and doubles as the Obsidian
/// vault folder name, so it can never travel.
pub fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut prev_dash = true; // suppress leading dashes
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            for c in ch.to_lowercase() {
                out.push(c);
            }
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "twin".to_string()
    } else {
        out
    }
}

/// Resolve a unique slug given a base — appends `-2`, `-3`, ... if needed.
fn unique_slug(pool: &DbPool, base: &str) -> Result<String, AppError> {
    let conn = pool.get()?;
    unique_slug_on(&conn, base)
}

/// Connection-scoped flavour of [`unique_slug`]. A bulk importer inserts many
/// twins inside ONE transaction; the pool-based variant would hand out a second
/// connection that cannot see those uncommitted rows and would happily return a
/// slug that is about to collide.
pub fn unique_slug_on(conn: &rusqlite::Connection, base: &str) -> Result<String, AppError> {
    let mut candidate = base.to_string();
    let mut suffix = 2;
    loop {
        let exists: i32 = conn
            .query_row(
                "SELECT COUNT(*) AS n FROM twin_profiles WHERE slug = ?1",
                params![candidate],
                |row| row.get("n"),
            )
            .unwrap_or(0);
        if exists == 0 {
            return Ok(candidate);
        }
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
}

// ============================================================================
// CRUD
// ============================================================================

pub fn list_profiles(pool: &DbPool) -> Result<Vec<TwinProfile>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {PROFILE_COLUMNS} FROM twin_profiles ORDER BY is_active DESC, updated_at DESC"
    ))?;
    let rows = stmt.query_map([], row_to_twin_profile)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn get_profile_by_id(pool: &DbPool, id: &str) -> Result<TwinProfile, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        &format!("SELECT {PROFILE_COLUMNS} FROM twin_profiles WHERE id = ?1"),
        params![id],
        row_to_twin_profile,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Twin profile {id}")),
        other => AppError::Database(other),
    })
}

pub fn get_active_profile(pool: &DbPool) -> Result<Option<TwinProfile>, AppError> {
    let conn = pool.get()?;
    let result = conn.query_row(
        &format!("SELECT {PROFILE_COLUMNS} FROM twin_profiles WHERE is_active = 1 LIMIT 1"),
        [],
        row_to_twin_profile,
    );
    match result {
        Ok(p) => Ok(Some(p)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

pub fn create_profile(
    pool: &DbPool,
    name: &str,
    bio: Option<&str>,
    role: Option<&str>,
    languages: Option<&str>,
    pronouns: Option<&str>,
) -> Result<TwinProfile, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("Name cannot be empty".into()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let slug = unique_slug(pool, &slugify(name))?;
    let obsidian_subpath = format!("personas/twins/{slug}");

    // First twin auto-activates so the connector has something to resolve.
    let conn = pool.get()?;
    let existing_count: i32 = conn
        .query_row("SELECT COUNT(*) AS n FROM twin_profiles", [], |row| {
            row.get("n")
        })
        .unwrap_or(0);
    let is_active = if existing_count == 0 { 1 } else { 0 };

    conn.execute(
        "INSERT INTO twin_profiles (id, name, slug, bio, role, languages, pronouns, obsidian_subpath, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![id, name, slug, bio, role, languages, pronouns, obsidian_subpath, is_active, now],
    )?;

    get_profile_by_id(pool, &id)
}

pub fn update_profile(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    bio: Option<Option<&str>>,
    role: Option<Option<&str>>,
    languages: Option<Option<&str>>,
    pronouns: Option<Option<&str>>,
    obsidian_subpath: Option<&str>,
    training_directives: Option<Option<&str>>,
) -> Result<TwinProfile, AppError> {
    // Existence check up-front so we return a clean NotFound rather than a
    // silent no-op when the caller hands us a dead id.
    get_profile_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    let mut idx = 2u32;

    push_field_param!(
        name.map(|s| s.to_string()),
        "name",
        sets,
        idx,
        param_values,
        clone
    );
    push_field_param!(
        bio.map(|o| o.map(|s| s.to_string())),
        "bio",
        sets,
        idx,
        param_values,
        clone
    );
    push_field_param!(
        role.map(|o| o.map(|s| s.to_string())),
        "role",
        sets,
        idx,
        param_values,
        clone
    );
    push_field_param!(
        languages.map(|o| o.map(|s| s.to_string())),
        "languages",
        sets,
        idx,
        param_values,
        clone
    );
    push_field_param!(
        pronouns.map(|o| o.map(|s| s.to_string())),
        "pronouns",
        sets,
        idx,
        param_values,
        clone
    );
    push_field_param!(
        obsidian_subpath.map(|s| s.to_string()),
        "obsidian_subpath",
        sets,
        idx,
        param_values,
        clone
    );
    push_field_param!(
        training_directives.map(|o| o.map(|s| s.to_string())),
        "training_directives",
        sets,
        idx,
        param_values,
        clone
    );

    let sql = format!(
        "UPDATE twin_profiles SET {} WHERE id = ?{}",
        sets.join(", "),
        idx
    );
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    get_profile_by_id(pool, id)
}

pub fn delete_profile(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    // If we're deleting the active twin, the next list_profiles call will
    // have no active row -- the caller / UI is responsible for promoting
    // another. We don't auto-promote here so the user keeps control.
    let rows = conn.execute("DELETE FROM twin_profiles WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

/// Promote `id` to active and demote every other row in a single transaction.
pub fn set_active_profile(pool: &DbPool, id: &str) -> Result<TwinProfile, AppError> {
    get_profile_by_id(pool, id)?;
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE twin_profiles SET is_active = 0 WHERE is_active = 1",
        [],
    )?;
    tx.execute(
        "UPDATE twin_profiles SET is_active = 1, updated_at = ?2 WHERE id = ?1",
        params![id, chrono::Utc::now().to_rfc3339()],
    )?;
    tx.commit()?;
    get_profile_by_id(pool, id)
}

// ============================================================================
// Tone Profiles (P1)
// ============================================================================

fn row_to_tone(row: &Row) -> rusqlite::Result<TwinTone> {
    Ok(TwinTone {
        id: row.get("id")?,
        twin_id: row.get("twin_id")?,
        channel: row.get("channel")?,
        voice_directives: row.get("voice_directives")?,
        examples_json: row.get("examples_json")?,
        constraints_json: row.get("constraints_json")?,
        length_hint: row.get("length_hint")?,
        style_json: row.get("style_json")?,
        updated_at: row.get("updated_at")?,
    })
}

/// List all tone profiles for a twin, ordered by channel name.
pub fn list_tones(pool: &DbPool, twin_id: &str) -> Result<Vec<TwinTone>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {TONE_COLUMNS} FROM twin_tones WHERE twin_id = ?1 ORDER BY channel"
    ))?;
    let rows = stmt.query_map(params![twin_id], row_to_tone)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

/// Get the tone profile for a specific (twin, channel) pair. Falls back to
/// "generic" if the requested channel doesn't have its own row.
pub fn get_tone(pool: &DbPool, twin_id: &str, channel: &str) -> Result<TwinTone, AppError> {
    let conn = pool.get()?;
    // Try exact channel first
    let result = conn.query_row(
        &format!("SELECT {TONE_COLUMNS} FROM twin_tones WHERE twin_id = ?1 AND channel = ?2"),
        params![twin_id, channel],
        row_to_tone,
    );
    match result {
        Ok(t) => Ok(t),
        Err(rusqlite::Error::QueryReturnedNoRows) if channel != "generic" => {
            // Fallback to generic
            conn.query_row(
                &format!(
    "SELECT {TONE_COLUMNS} FROM twin_tones WHERE twin_id = ?1 AND channel = 'generic'"
),
                params![twin_id],
                row_to_tone,
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound(format!("Twin tone for {twin_id}/{channel}"))
                }
                other => AppError::Database(other),
            })
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(AppError::NotFound(format!(
            "Twin tone for {twin_id}/{channel}"
        ))),
        Err(e) => Err(AppError::Database(e)),
    }
}

/// Insert or update a tone for (twin_id, channel). Uses SQLite UPSERT to
/// enforce the UNIQUE(twin_id, channel) constraint cleanly.
pub fn upsert_tone(
    pool: &DbPool,
    twin_id: &str,
    channel: &str,
    voice_directives: &str,
    examples_json: Option<&str>,
    constraints_json: Option<&str>,
    length_hint: Option<&str>,
) -> Result<TwinTone, AppError> {
    // Verify the twin exists first.
    get_profile_by_id(pool, twin_id)?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    conn.execute(
        "INSERT INTO twin_tones (id, twin_id, channel, voice_directives, examples_json, constraints_json, length_hint, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(twin_id, channel) DO UPDATE SET
           voice_directives = excluded.voice_directives,
           examples_json    = excluded.examples_json,
           constraints_json = excluded.constraints_json,
           length_hint      = excluded.length_hint,
           updated_at       = excluded.updated_at",
        params![id, twin_id, channel, voice_directives, examples_json, constraints_json, length_hint, now],
    )?;

    // Return the resulting row (might be the existing row with updated fields).
    let conn2 = pool.get()?;
    conn2
        .query_row(
            &format!("SELECT {TONE_COLUMNS} FROM twin_tones WHERE twin_id = ?1 AND channel = ?2"),
            params![twin_id, channel],
            row_to_tone,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Twin tone for {twin_id}/{channel}"))
            }
            other => AppError::Database(other),
        })
}

/// Delete a specific tone profile by id.
pub fn delete_tone(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM twin_tones WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ============================================================================
// Knowledge Base Binding (P2)
// ============================================================================

/// Bind a knowledge_base to this twin. Clears the previous binding if any.
pub fn bind_knowledge_base(
    pool: &DbPool,
    twin_id: &str,
    kb_id: &str,
) -> Result<TwinProfile, AppError> {
    get_profile_by_id(pool, twin_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE twin_profiles SET knowledge_base_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![twin_id, kb_id, now],
    )?;
    get_profile_by_id(pool, twin_id)
}

/// Clear the knowledge base binding for a twin.
pub fn unbind_knowledge_base(pool: &DbPool, twin_id: &str) -> Result<TwinProfile, AppError> {
    get_profile_by_id(pool, twin_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE twin_profiles SET knowledge_base_id = NULL, updated_at = ?2 WHERE id = ?1",
        params![twin_id, now],
    )?;
    get_profile_by_id(pool, twin_id)
}

// ============================================================================
// Pending Memories (P2)
// ============================================================================

fn row_to_pending_memory(row: &Row) -> rusqlite::Result<TwinPendingMemory> {
    Ok(TwinPendingMemory {
        id: row.get("id")?,
        twin_id: row.get("twin_id")?,
        channel: row.get("channel")?,
        content: row.get("content")?,
        title: row.get("title")?,
        importance: row.get::<_, Option<i32>>("importance")?.unwrap_or(3),
        status: row.get("status")?,
        reviewer_notes: row.get("reviewer_notes")?,
        source_communication_id: row.get("source_communication_id").ok(),
        created_at: row.get("created_at")?,
        reviewed_at: row.get("reviewed_at")?,
    })
}

pub fn list_pending_memories(
    pool: &DbPool,
    twin_id: &str,
    status: Option<&str>,
    limit: Option<i32>,
) -> Result<Vec<TwinPendingMemory>, AppError> {
    let conn = pool.get()?;
    let cap = limit.filter(|n| *n > 0);
    if let Some(s) = status {
        if let Some(n) = cap {
            let mut stmt = conn.prepare(&format!(
                "SELECT {PENDING_MEMORY_COLUMNS} FROM twin_pending_memories WHERE twin_id = ?1 AND status = ?2 ORDER BY created_at DESC LIMIT ?3"
            ))?;
            let rows = stmt.query_map(params![twin_id, s, n], row_to_pending_memory)?;
            return rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database);
        }
        let mut stmt = conn.prepare(&format!(
            "SELECT {PENDING_MEMORY_COLUMNS} FROM twin_pending_memories WHERE twin_id = ?1 AND status = ?2 ORDER BY created_at DESC"
        ))?;
        let rows = stmt.query_map(params![twin_id, s], row_to_pending_memory)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    } else if let Some(n) = cap {
        let mut stmt = conn.prepare(&format!(
            "SELECT {PENDING_MEMORY_COLUMNS} FROM twin_pending_memories WHERE twin_id = ?1 ORDER BY created_at DESC LIMIT ?2"
        ))?;
        let rows = stmt.query_map(params![twin_id, n], row_to_pending_memory)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(&format!(
            "SELECT {PENDING_MEMORY_COLUMNS} FROM twin_pending_memories WHERE twin_id = ?1 ORDER BY created_at DESC"
        ))?;
        let rows = stmt.query_map(params![twin_id], row_to_pending_memory)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    }
}

pub fn create_pending_memory(
    pool: &DbPool,
    twin_id: &str,
    channel: Option<&str>,
    content: &str,
    title: Option<&str>,
    importance: i32,
    source_communication_id: Option<&str>,
) -> Result<TwinPendingMemory, AppError> {
    let conn = pool.get()?;
    create_pending_memory_on(
        &conn,
        twin_id,
        channel,
        content,
        title,
        importance,
        source_communication_id,
    )
}

/// [`create_pending_memory`] on a caller's connection (or transaction).
pub fn create_pending_memory_on(
    conn: &rusqlite::Connection,
    twin_id: &str,
    channel: Option<&str>,
    content: &str,
    title: Option<&str>,
    importance: i32,
    source_communication_id: Option<&str>,
) -> Result<TwinPendingMemory, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO twin_pending_memories \
            (id, twin_id, channel, content, title, importance, source_communication_id, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, twin_id, channel, content, title, importance, source_communication_id, now],
    )?;
    conn.query_row(
        &format!("SELECT {PENDING_MEMORY_COLUMNS} FROM twin_pending_memories WHERE id = ?1"),
        params![id],
        row_to_pending_memory,
    )
    .map_err(AppError::Database)
}

pub fn review_pending_memory(
    pool: &DbPool,
    id: &str,
    approved: bool,
    reviewer_notes: Option<&str>,
) -> Result<TwinPendingMemory, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let status = if approved { "approved" } else { "rejected" };
    let conn = pool.get()?;
    let rows = conn.execute(
        "UPDATE twin_pending_memories SET status = ?2, reviewer_notes = ?3, reviewed_at = ?4 WHERE id = ?1 AND status = 'pending'",
        params![id, status, reviewer_notes, now],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!(
            "Pending memory {id} (already reviewed or not found)"
        )));
    }
    conn.query_row(
        &format!("SELECT {PENDING_MEMORY_COLUMNS} FROM twin_pending_memories WHERE id = ?1"),
        params![id],
        row_to_pending_memory,
    )
    .map_err(AppError::Database)
}

// ============================================================================
// Communications (P2)
// ============================================================================

fn row_to_communication(row: &Row) -> rusqlite::Result<TwinCommunication> {
    Ok(TwinCommunication {
        id: row.get("id")?,
        twin_id: row.get("twin_id")?,
        channel: row.get("channel")?,
        direction: row.get("direction")?,
        contact_handle: row.get("contact_handle")?,
        content: row.get("content")?,
        summary: row.get("summary")?,
        key_facts_json: row.get("key_facts_json")?,
        occurred_at: row.get("occurred_at")?,
        created_at: row.get("created_at")?,
    })
}

pub fn list_communications(
    pool: &DbPool,
    twin_id: &str,
    channel: Option<&str>,
    limit: i32,
) -> Result<Vec<TwinCommunication>, AppError> {
    let conn = pool.get()?;
    if let Some(ch) = channel {
        let mut stmt = conn.prepare(
            &format!(
    "SELECT {COMMUNICATION_COLUMNS} FROM twin_communications WHERE twin_id = ?1 AND channel = ?2 ORDER BY occurred_at DESC LIMIT ?3"
),
        )?;
        let rows = stmt.query_map(params![twin_id, ch, limit], row_to_communication)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(
            &format!(
    "SELECT {COMMUNICATION_COLUMNS} FROM twin_communications WHERE twin_id = ?1 ORDER BY occurred_at DESC LIMIT ?2"
),
        )?;
        let rows = stmt.query_map(params![twin_id, limit], row_to_communication)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    }
}

/// Like `list_communications` but filters by `contact_handle` instead of
/// channel. Used by recall preview to surface the most recent N exchanges
/// with a specific contact. When `contact_handle` is None, falls through
/// to the twin-wide list.
pub fn list_communications_by_contact(
    pool: &DbPool,
    twin_id: &str,
    contact_handle: Option<&str>,
    limit: i32,
) -> Result<Vec<TwinCommunication>, AppError> {
    let conn = pool.get()?;
    if let Some(handle) = contact_handle {
        let mut stmt = conn.prepare(&format!(
            "SELECT {COMMUNICATION_COLUMNS} FROM twin_communications \
             WHERE twin_id = ?1 AND contact_handle = ?2 \
             ORDER BY occurred_at DESC LIMIT ?3"
        ))?;
        let rows = stmt.query_map(params![twin_id, handle, limit], row_to_communication)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    } else {
        list_communications(pool, twin_id, None, limit)
    }
}

/// Record an interaction and optionally create a pending memory for it.
pub fn record_interaction(
    pool: &DbPool,
    twin_id: &str,
    channel: &str,
    direction: &str,
    contact_handle: Option<&str>,
    content: &str,
    summary: Option<&str>,
    key_facts_json: Option<&str>,
    create_memory: bool,
) -> Result<TwinCommunication, AppError> {
    let conn = pool.get()?;
    record_interaction_on(
        &conn,
        twin_id,
        channel,
        direction,
        contact_handle,
        content,
        summary,
        key_facts_json,
        create_memory,
    )
}

/// [`record_interaction`] on a caller's connection (or transaction), so the
/// communication and its pending memory can land atomically with the caller's
/// own writes (the twin setup engine records a training answer this way).
#[allow(clippy::too_many_arguments)]
pub fn record_interaction_on(
    conn: &rusqlite::Connection,
    twin_id: &str,
    channel: &str,
    direction: &str,
    contact_handle: Option<&str>,
    content: &str,
    summary: Option<&str>,
    key_facts_json: Option<&str>,
    create_memory: bool,
) -> Result<TwinCommunication, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO twin_communications (id, twin_id, channel, direction, contact_handle, content, summary, key_facts_json, occurred_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![id, twin_id, channel, direction, contact_handle, content, summary, key_facts_json, now],
    )?;

    // Optionally queue a pending memory for human review
    if create_memory {
        let mem_content = if let Some(s) = summary {
            // The summary is the QUESTION on the training path ("Training Q&A:
            // <question>") and the answer is `content`. Storing only the summary
            // threw the answer away: the memory read as a question with no
            // answer, and every downstream reader (recall grounding, the wiki
            // compile, the readiness memories slot) inherited the hole. Keep the
            // `[channel]` prefix so the other callers' rows are unchanged in
            // shape, and append the body the summary describes.
            format!("[{channel}] {s}\n\n{content}")
        } else {
            // Char-safe truncation: byte-slicing user content panics on a
            // multi-byte char straddling the cut (emoji/CJK/accents) — common for
            // a multilingual personal-comms feature (bug-hunt 2026-06-07 twin #1).
            format!(
                "[{channel}] {}",
                personas_core::utils::text::truncate_on_char_boundary(content, 500)
            )
        };
        let title = contact_handle
            .map(|h| format!("{direction} with {h} on {channel}"))
            .or_else(|| Some(format!("{direction} on {channel}")));
        let _ = create_pending_memory_on(
            conn,
            twin_id,
            Some(channel),
            &mem_content,
            title.as_deref(),
            3,
            Some(&id),
        );
    }

    conn.query_row(
        &format!("SELECT {COMMUNICATION_COLUMNS} FROM twin_communications WHERE id = ?1"),
        params![id],
        row_to_communication,
    )
    .map_err(AppError::Database)
}

// ============================================================================
// Voice Profiles (P3)
// ============================================================================

fn row_to_voice_profile(row: &Row) -> rusqlite::Result<TwinVoiceProfile> {
    Ok(TwinVoiceProfile {
        id: row.get("id")?,
        twin_id: row.get("twin_id")?,
        provider: row.get("provider")?,
        credential_id: row.get("credential_id")?,
        voice_id: row.get("voice_id")?,
        model_id: row.get("model_id")?,
        stability: row.get("stability")?,
        similarity_boost: row.get("similarity_boost")?,
        style: row.get("style")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn get_voice_profile(
    pool: &DbPool,
    twin_id: &str,
) -> Result<Option<TwinVoiceProfile>, AppError> {
    let conn = pool.get()?;
    let result = conn.query_row(
        &format!("SELECT {VOICE_PROFILE_COLUMNS} FROM twin_voice_profiles WHERE twin_id = ?1"),
        params![twin_id],
        row_to_voice_profile,
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

/// Insert or update the voice profile for a twin (one voice per twin).
pub fn upsert_voice_profile(
    pool: &DbPool,
    twin_id: &str,
    credential_id: Option<&str>,
    voice_id: &str,
    model_id: Option<&str>,
    stability: f64,
    similarity_boost: f64,
    style: f64,
) -> Result<TwinVoiceProfile, AppError> {
    get_profile_by_id(pool, twin_id)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    conn.execute(
        "INSERT INTO twin_voice_profiles (id, twin_id, provider, credential_id, voice_id, model_id, stability, similarity_boost, style, updated_at)
         VALUES (?1, ?2, 'elevenlabs', ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(twin_id) DO UPDATE SET
           credential_id    = excluded.credential_id,
           voice_id         = excluded.voice_id,
           model_id         = excluded.model_id,
           stability        = excluded.stability,
           similarity_boost = excluded.similarity_boost,
           style            = excluded.style,
           updated_at       = excluded.updated_at",
        params![id, twin_id, credential_id, voice_id, model_id, stability, similarity_boost, style, now],
    )?;

    // Return the resulting row
    match get_voice_profile(pool, twin_id)? {
        Some(v) => Ok(v),
        None => Err(AppError::NotFound(format!(
            "Voice profile for twin {twin_id}"
        ))),
    }
}

pub fn delete_voice_profile(pool: &DbPool, twin_id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM twin_voice_profiles WHERE twin_id = ?1",
        params![twin_id],
    )?;
    Ok(rows > 0)
}

// ============================================================================
// Channels (P4)
// ============================================================================

fn row_to_channel(row: &Row) -> rusqlite::Result<TwinChannel> {
    Ok(TwinChannel {
        id: row.get("id")?,
        twin_id: row.get("twin_id")?,
        channel_type: row.get("channel_type")?,
        credential_id: row.get("credential_id")?,
        persona_id: row.get("persona_id")?,
        label: row.get("label")?,
        is_active: row.get::<_, i32>("is_active")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_channels(pool: &DbPool, twin_id: &str) -> Result<Vec<TwinChannel>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        &format!(
    "SELECT {CHANNEL_COLUMNS} FROM twin_channels WHERE twin_id = ?1 ORDER BY is_active DESC, channel_type"
),
    )?;
    let rows = stmt.query_map(params![twin_id], row_to_channel)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn create_channel(
    pool: &DbPool,
    twin_id: &str,
    channel_type: &str,
    credential_id: &str,
    persona_id: Option<&str>,
    label: Option<&str>,
) -> Result<TwinChannel, AppError> {
    get_profile_by_id(pool, twin_id)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO twin_channels (id, twin_id, channel_type, credential_id, persona_id, label, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, twin_id, channel_type, credential_id, persona_id, label, now],
    )?;
    conn.query_row(
        &format!("SELECT {CHANNEL_COLUMNS} FROM twin_channels WHERE id = ?1"),
        params![id],
        row_to_channel,
    )
    .map_err(AppError::Database)
}

pub fn update_channel(
    pool: &DbPool,
    id: &str,
    persona_id: Option<Option<&str>>,
    label: Option<Option<&str>>,
    is_active: Option<bool>,
) -> Result<TwinChannel, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    let mut idx = 2u32;

    push_field_param!(
        persona_id.map(|o| o.map(|s| s.to_string())),
        "persona_id",
        sets,
        idx,
        param_values,
        clone
    );
    push_field_param!(
        label.map(|o| o.map(|s| s.to_string())),
        "label",
        sets,
        idx,
        param_values,
        clone
    );
    push_field_param!(is_active, "is_active", sets, idx, param_values, bool);

    let sql = format!(
        "UPDATE twin_channels SET {} WHERE id = ?{}",
        sets.join(", "),
        idx
    );
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())?;

    conn.query_row(
        &format!("SELECT {CHANNEL_COLUMNS} FROM twin_channels WHERE id = ?1"),
        params![id],
        row_to_channel,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Twin channel {id}")),
        other => AppError::Database(other),
    })
}

pub fn delete_channel(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM twin_channels WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ============================================================================
// Contacts (P6+ — Cycle 14 Stage 1)
// ============================================================================

fn upsert_contacts_from_communications(
    conn: &rusqlite::Connection,
    twin_id: &str,
) -> Result<(), AppError> {
    // INSERT OR IGNORE picks up every distinct handle seen in
    // twin_communications without overwriting any user-edited alias/notes
    // already in twin_contacts.
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO twin_contacts (id, twin_id, handle, created_at, updated_at) \
         SELECT lower(hex(randomblob(16))), ?1, contact_handle, ?2, ?2 \
         FROM twin_communications \
         WHERE twin_id = ?1 AND contact_handle IS NOT NULL AND contact_handle <> ''",
        params![twin_id, now],
    )?;
    Ok(())
}

fn row_to_contact(row: &Row) -> rusqlite::Result<TwinContact> {
    Ok(TwinContact {
        id: row.get("id")?,
        twin_id: row.get("twin_id")?,
        handle: row.get("handle")?,
        alias: row.get("alias")?,
        notes: row.get("notes")?,
        message_count: row.get::<_, Option<i64>>("message_count")?.unwrap_or(0),
        last_seen_at: row.get("last_seen_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_contacts_with_activity(
    pool: &DbPool,
    twin_id: &str,
) -> Result<Vec<TwinContact>, AppError> {
    let conn = pool.get()?;
    upsert_contacts_from_communications(&conn, twin_id)?;

    let mut stmt = conn.prepare(
        "SELECT \
            c.id, c.twin_id, c.handle, c.alias, c.notes, c.created_at, c.updated_at, \
            COALESCE(agg.message_count, 0) AS message_count, \
            agg.last_seen_at AS last_seen_at \
         FROM twin_contacts c \
         LEFT JOIN ( \
            SELECT contact_handle, COUNT(*) AS message_count, MAX(occurred_at) AS last_seen_at \
            FROM twin_communications \
            WHERE twin_id = ?1 AND contact_handle IS NOT NULL AND contact_handle <> '' \
            GROUP BY contact_handle \
         ) agg ON agg.contact_handle = c.handle \
         WHERE c.twin_id = ?1 \
         ORDER BY COALESCE(agg.last_seen_at, c.created_at) DESC",
    )?;
    let rows = stmt.query_map(params![twin_id], row_to_contact)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn update_contact(
    pool: &DbPool,
    id: &str,
    alias: Option<&str>,
    notes: Option<&str>,
) -> Result<TwinContact, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let rows = conn.execute(
        "UPDATE twin_contacts SET alias = ?2, notes = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, alias, notes, now],
    )?;
    if rows == 0 {
        return Err(AppError::NotFound(format!("twin contact {id}")));
    }
    // Single-row read after update; reuse the list query shape would be
    // overkill for one row. message_count + last_seen_at recomputed from
    // the join so the caller gets a consistent view-shaped struct.
    conn.query_row(
        "SELECT \
            c.id, c.twin_id, c.handle, c.alias, c.notes, c.created_at, c.updated_at, \
            COALESCE(agg.message_count, 0) AS message_count, \
            agg.last_seen_at AS last_seen_at \
         FROM twin_contacts c \
         LEFT JOIN ( \
            SELECT contact_handle, COUNT(*) AS message_count, MAX(occurred_at) AS last_seen_at \
            FROM twin_communications \
            WHERE twin_id = (SELECT twin_id FROM twin_contacts WHERE id = ?1) \
              AND contact_handle IS NOT NULL AND contact_handle <> '' \
            GROUP BY contact_handle \
         ) agg ON agg.contact_handle = c.handle \
         WHERE c.id = ?1",
        params![id],
        row_to_contact,
    )
    .map_err(AppError::Database)
}

// ============================================================================
// Reflections (P6+ — Cycle 15 Stage 1)
// ============================================================================

fn row_to_reflection(row: &Row) -> rusqlite::Result<TwinReflection> {
    Ok(TwinReflection {
        id: row.get("id")?,
        twin_id: row.get("twin_id")?,
        prompt_seed: row.get("prompt_seed")?,
        content: row.get("content")?,
        created_at: row.get("created_at")?,
    })
}

pub fn list_reflections(pool: &DbPool, twin_id: &str) -> Result<Vec<TwinReflection>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(&format!(
    "SELECT {REFLECTION_COLUMNS} FROM twin_reflections WHERE twin_id = ?1 ORDER BY created_at DESC"
))?;
    let rows = stmt.query_map(params![twin_id], row_to_reflection)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn create_reflection(
    pool: &DbPool,
    twin_id: &str,
    prompt_seed: &str,
    content: &str,
) -> Result<TwinReflection, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO twin_reflections (id, twin_id, prompt_seed, content, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, twin_id, prompt_seed, content, now],
    )?;
    conn.query_row(
        &format!("SELECT {REFLECTION_COLUMNS} FROM twin_reflections WHERE id = ?1"),
        params![id],
        row_to_reflection,
    )
    .map_err(AppError::Database)
}

pub fn delete_reflection(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM twin_reflections WHERE id = ?1", params![id])?;
    Ok(rows > 0)
}

// ============================================================================
// Distilled Facts (P6+ — manual write surface, Cycle 12 Stage 1)
// ============================================================================

fn row_to_distilled_fact(row: &Row) -> rusqlite::Result<TwinDistilledFact> {
    Ok(TwinDistilledFact {
        id: row.get("id")?,
        twin_id: row.get("twin_id")?,
        contact_handle: row.get("contact_handle")?,
        content: row.get("content")?,
        importance: row.get("importance")?,
        sources_json: row.get("sources_json")?,
        created_at: row.get("created_at")?,
        last_seen_at: row.get("last_seen_at")?,
    })
}

pub fn list_distilled_facts(
    pool: &DbPool,
    twin_id: &str,
    contact_handle: Option<&str>,
) -> Result<Vec<TwinDistilledFact>, AppError> {
    let conn = pool.get()?;
    if let Some(handle) = contact_handle {
        let mut stmt = conn.prepare(&format!(
            "SELECT {DISTILLED_FACT_COLUMNS} FROM twin_distilled_facts \
             WHERE twin_id = ?1 AND contact_handle = ?2 \
             ORDER BY importance DESC, last_seen_at DESC"
        ))?;
        let rows = stmt.query_map(params![twin_id, handle], row_to_distilled_fact)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(&format!(
            "SELECT {DISTILLED_FACT_COLUMNS} FROM twin_distilled_facts \
             WHERE twin_id = ?1 \
             ORDER BY importance DESC, last_seen_at DESC"
        ))?;
        let rows = stmt.query_map(params![twin_id], row_to_distilled_fact)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    }
}

pub fn create_distilled_fact(
    pool: &DbPool,
    twin_id: &str,
    contact_handle: Option<&str>,
    content: &str,
    importance: i32,
    source_communication_ids: &[String],
) -> Result<TwinDistilledFact, AppError> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(
            "distilled fact content cannot be empty".into(),
        ));
    }
    if source_communication_ids.is_empty() {
        // Provenance contract — see TwinDistilledFact docs. Empty sources
        // are a frontend bug, never a legitimate state; reject explicitly
        // rather than silently storing a hallucination-shaped row.
        return Err(AppError::Validation(
            "distilled fact requires at least one source communication id".into(),
        ));
    }
    let clamped_importance = importance.clamp(1, 5);
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let sources_json = serde_json::to_string(source_communication_ids)
        .map_err(|e| AppError::Internal(format!("encode sources_json: {e}")))?;

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO twin_distilled_facts \
            (id, twin_id, contact_handle, content, importance, sources_json, created_at, last_seen_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            twin_id,
            contact_handle,
            trimmed,
            clamped_importance,
            sources_json,
            now,
        ],
    )?;
    conn.query_row(
        &format!("SELECT {DISTILLED_FACT_COLUMNS} FROM twin_distilled_facts WHERE id = ?1"),
        params![id],
        row_to_distilled_fact,
    )
    .map_err(AppError::Database)
}

pub fn delete_distilled_fact(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute(
        "DELETE FROM twin_distilled_facts WHERE id = ?1",
        params![id],
    )?;
    Ok(rows > 0)
}

/// Top-N distilled facts for recall — ordered by importance then recency.
/// Optionally scoped to a contact handle when the recall is per-contact.
pub fn top_distilled_facts_for_recall(
    pool: &DbPool,
    twin_id: &str,
    contact_handle: Option<&str>,
    limit: i32,
) -> Result<Vec<TwinDistilledFact>, AppError> {
    let conn = pool.get()?;
    let sql = if contact_handle.is_some() {
        // Include both contact-scoped facts AND self-facts (NULL contact_handle).
        // Self-facts about the twin's voice/preferences are always relevant
        // even when recall is filtered to a specific contact.
        &format!(
            "SELECT {DISTILLED_FACT_COLUMNS} FROM twin_distilled_facts \
         WHERE twin_id = ?1 AND (contact_handle = ?2 OR contact_handle IS NULL) \
         ORDER BY importance DESC, last_seen_at DESC \
         LIMIT ?3"
        )
    } else {
        // `LIMIT ?2`, not `?3`: this branch binds two parameters, so the `?3`
        // that stood here referenced a parameter that was never supplied and
        // the statement failed at runtime for every unfiltered recall.
        &format!(
            "SELECT {DISTILLED_FACT_COLUMNS} FROM twin_distilled_facts \
         WHERE twin_id = ?1 \
         ORDER BY importance DESC, last_seen_at DESC \
         LIMIT ?2"
        )
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = if let Some(handle) = contact_handle {
        stmt.query_map(params![twin_id, handle, limit], row_to_distilled_fact)?
            .collect::<Result<Vec<_>, _>>()
    } else {
        stmt.query_map(params![twin_id, limit], row_to_distilled_fact)?
            .collect::<Result<Vec<_>, _>>()
    };
    rows.map_err(AppError::Database)
}

pub fn top_contacts_by_activity(
    pool: &DbPool,
    twin_id: &str,
    limit: i32,
) -> Result<Vec<TwinContact>, AppError> {
    let conn = pool.get()?;
    upsert_contacts_from_communications(&conn, twin_id)?;
    let mut stmt = conn.prepare(
        "SELECT \
            c.id, c.twin_id, c.handle, c.alias, c.notes, c.created_at, c.updated_at, \
            COALESCE(agg.message_count, 0) AS message_count, \
            agg.last_seen_at AS last_seen_at \
         FROM twin_contacts c \
         LEFT JOIN ( \
            SELECT contact_handle, COUNT(*) AS message_count, MAX(occurred_at) AS last_seen_at \
            FROM twin_communications \
            WHERE twin_id = ?1 AND contact_handle IS NOT NULL AND contact_handle <> '' \
            GROUP BY contact_handle \
         ) agg ON agg.contact_handle = c.handle \
         WHERE c.twin_id = ?1 \
         ORDER BY message_count DESC, COALESCE(agg.last_seen_at, c.created_at) DESC \
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![twin_id, limit], row_to_contact)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn get_tone_optional(
    pool: &DbPool,
    twin_id: &str,
    channel: &str,
) -> Result<Option<TwinTone>, AppError> {
    let conn = pool.get()?;
    get_tone_optional_on(&conn, twin_id, channel)
}

/// [`get_tone_optional`] on a caller's connection (or transaction): the exact
/// channel's row, no `generic` fallback.
pub fn get_tone_optional_on(
    conn: &rusqlite::Connection,
    twin_id: &str,
    channel: &str,
) -> Result<Option<TwinTone>, AppError> {
    timed_query!("twin_tones", "twin::get_tone_optional", {
        let result = conn.query_row(
            &format!("SELECT {TONE_COLUMNS} FROM twin_tones WHERE twin_id = ?1 AND channel = ?2"),
            params![twin_id, channel],
            row_to_tone,
        );
        match result {
            Ok(t) => Ok(Some(t)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

// ============================================================================
// One tone column (spark twin-portable-blueprint, learn-from-sample accept)
// ============================================================================

/// One `twin_tones` column the learn-from-sample accept door writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToneField {
    /// `voice_directives` (NOT NULL: a `None` value writes `''`).
    Directives,
    /// `examples_json`, a JSON array of strings.
    Examples,
    /// `constraints_json`, a JSON array of strings.
    Constraints,
    /// `length_hint`.
    LengthHint,
    /// `style_json`, a serialized `TwinStyle`.
    Style,
}

impl ToneField {
    /// The column name. A closed match, so the name interpolated into the SQL
    /// below can never come from a caller.
    fn column(self) -> &'static str {
        match self {
            Self::Directives => "voice_directives",
            Self::Examples => "examples_json",
            Self::Constraints => "constraints_json",
            Self::LengthHint => "length_hint",
            Self::Style => "style_json",
        }
    }
}

/// Write ONE column of the (twin, channel) tone row on the caller's
/// connection (or transaction), creating the row when the channel has none
/// (every other column then takes its schema default). Every other column of
/// an existing row is left exactly as it is, which the whole-row writers
/// ([`upsert_tone`], [`apply_styled_tones`]) cannot promise: they rewrite the
/// row from values the caller read earlier, on another connection.
pub fn set_tone_field_on(
    conn: &rusqlite::Connection,
    twin_id: &str,
    channel: &str,
    field: ToneField,
    value: Option<&str>,
) -> Result<(), AppError> {
    let column = field.column();
    let value = match field {
        ToneField::Directives => Some(value.unwrap_or("")),
        _ => value,
    };
    timed_query!("twin_tones", "twin::set_tone_field", {
        conn.execute(
            &format!(
                "INSERT INTO twin_tones (id, twin_id, channel, {column}, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(twin_id, channel) DO UPDATE SET
                   {column}   = excluded.{column},
                   updated_at = excluded.updated_at"
            ),
            params![
                uuid::Uuid::new_v4().to_string(),
                twin_id,
                channel,
                value,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    })
}

// ============================================================================
// Style studio apply (spark twin-presets)
// ============================================================================

/// One whole tone row written by the style studio. Every column is set, so a
/// styled row never inherits a stale example list or length hint from the
/// hand-written row it replaces. The command layer has already validated and
/// serialized the payload; this layer only writes it.
#[derive(Debug, Clone)]
pub struct StyledToneWrite {
    pub channel: String,
    pub voice_directives: String,
    /// JSON array of strings (the format `toneParts.ts` reads).
    pub examples_json: String,
    /// JSON array of strings.
    pub constraints_json: String,
    pub length_hint: Option<String>,
    /// JSON-encoded `TwinStyle` carrying THIS channel's dimensions.
    pub style_json: String,
}

/// Write every styled tone for a twin in ONE immediate transaction, then return
/// the twin's full tone list. Channels not listed are untouched. Either every
/// listed channel lands or none does: a half-applied style would leave the
/// twin speaking two styles at once with nothing telling the user which.
pub fn apply_styled_tones(
    pool: &DbPool,
    twin_id: &str,
    writes: &[StyledToneWrite],
) -> Result<Vec<TwinTone>, AppError> {
    timed_query!("twin_tones", "twin::apply_styled_tones", {
        let mut conn = pool.get()?;
        // Immediate: the existence read informs the writes, and a deferred
        // transaction would fail SQLITE_BUSY_SNAPSHOT instead of waiting.
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM twin_profiles WHERE id = ?1) AS present",
            params![twin_id],
            |row| row.get("present"),
        )?;
        if !exists {
            return Err(AppError::NotFound(format!("Twin profile {twin_id}")));
        }
        let now = chrono::Utc::now().to_rfc3339();
        for write in writes {
            upsert_styled_tone_in(&tx, twin_id, write, &now)?;
        }
        let tones = {
            let mut stmt = tx.prepare(&format!(
                "SELECT {TONE_COLUMNS} FROM twin_tones WHERE twin_id = ?1 ORDER BY channel"
            ))?;
            let rows = stmt.query_map(params![twin_id], row_to_tone)?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        tx.commit()?;
        Ok(tones)
    })
}

/// Upsert one whole styled tone row inside the caller's transaction. Unlike
/// [`upsert_tone`], this DOES set `style_json`: it is one of its two writers,
/// beside [`set_tone_field_on`], which the learn-from-sample accept door uses
/// to store a `learned` style without rewriting the rest of the row.
pub(crate) fn upsert_styled_tone_in(
    tx: &rusqlite::Transaction<'_>,
    twin_id: &str,
    write: &StyledToneWrite,
    now: &str,
) -> Result<(), AppError> {
    tx.execute(
        "INSERT INTO twin_tones (id, twin_id, channel, voice_directives, examples_json, constraints_json, length_hint, style_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(twin_id, channel) DO UPDATE SET
           voice_directives = excluded.voice_directives,
           examples_json    = excluded.examples_json,
           constraints_json = excluded.constraints_json,
           length_hint      = excluded.length_hint,
           style_json       = excluded.style_json,
           updated_at       = excluded.updated_at",
        params![
            uuid::Uuid::new_v4().to_string(),
            twin_id,
            write.channel,
            write.voice_directives,
            write.examples_json,
            write.constraints_json,
            write.length_hint,
            write.style_json,
            now
        ],
    )?;
    Ok(())
}

// ============================================================================
// Twin Card import doors (spark twin-portable-blueprint, WP4)
//
// A Twin Card lands as ONE transaction, so every write below takes the
// caller's connection (or transaction) and none opens its own. Each keeps a
// value the card carries (a memory's observed time, a fact's order) that the
// interactive writers would restamp with "now": re-exporting an imported twin
// must reproduce the card it came from.
// ============================================================================

/// The source token a fact imported from a Twin Card cites in `sources_json`
/// instead of a communication id: `twin-card:<card_id>`. A communication id
/// is a bare uuid and never contains `:`, so the two cannot be confused. The
/// provenance contract ("never without a citation") still holds: the citation
/// is the card the person confirmed the fact in.
pub const TWIN_CARD_SOURCE_PREFIX: &str = "twin-card:";

/// [`list_profiles`] on a caller's connection (or transaction), same order.
pub fn list_profiles_on(conn: &rusqlite::Connection) -> Result<Vec<TwinProfile>, AppError> {
    timed_query!("twin_profiles", "twin::list_profiles_on", {
        let mut stmt = conn.prepare(&format!(
            "SELECT {PROFILE_COLUMNS} FROM twin_profiles ORDER BY is_active DESC, updated_at DESC, id"
        ))?;
        let rows = stmt.query_map([], row_to_twin_profile)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

/// A whole profile row an importer writes. The id, slug, vault subpath and
/// both timestamps are minted by [`insert_profile_on`].
#[derive(Debug, Clone)]
pub struct NewTwinProfile<'a> {
    pub name: &'a str,
    pub bio: Option<&'a str>,
    pub role: Option<&'a str>,
    /// JSON array of language codes, or `None`.
    pub languages: Option<&'a str>,
    pub pronouns: Option<&'a str>,
    pub training_directives: Option<&'a str>,
    pub is_active: bool,
}

/// Insert a profile on the caller's connection (or transaction) with a fresh
/// id and a slug unique on that same connection ([`unique_slug_on`]: rows the
/// transaction already wrote are visible to it). `is_active` is written as
/// given; the caller decides it.
pub fn insert_profile_on(
    conn: &rusqlite::Connection,
    profile: &NewTwinProfile<'_>,
) -> Result<TwinProfile, AppError> {
    timed_query!("twin_profiles", "twin::insert_profile_on", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let slug = unique_slug_on(conn, &slugify(profile.name))?;
        let obsidian_subpath = format!("personas/twins/{slug}");
        conn.execute(
            "INSERT INTO twin_profiles \
                (id, name, slug, bio, role, languages, pronouns, obsidian_subpath, is_active, \
                 training_directives, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                id,
                profile.name,
                slug,
                profile.bio,
                profile.role,
                profile.languages,
                profile.pronouns,
                obsidian_subpath,
                i32::from(profile.is_active),
                profile.training_directives,
                now
            ],
        )?;
        conn.query_row(
            &format!("SELECT {PROFILE_COLUMNS} FROM twin_profiles WHERE id = ?1"),
            params![id],
            row_to_twin_profile,
        )
        .map_err(AppError::Database)
    })
}

/// [`delete_profile`] on the caller's connection (or transaction): every twin
/// table cascades from the profile row. `false` when no such twin.
pub fn delete_profile_on(conn: &rusqlite::Connection, id: &str) -> Result<bool, AppError> {
    timed_query!("twin_profiles", "twin::delete_profile_on", {
        let rows = conn.execute("DELETE FROM twin_profiles WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

/// One approved memory an importer writes, with the time it was observed.
#[derive(Debug, Clone)]
pub struct ImportedMemory<'a> {
    /// Where it was learned (`training`, `sample`, ...): the `channel` column.
    pub channel: Option<&'a str>,
    pub content: &'a str,
    pub title: Option<&'a str>,
    /// Clamped to 1-5.
    pub importance: i32,
    /// Written verbatim as `created_at`, so the memory keeps its place in the
    /// newest-first order every reader uses.
    pub observed_at: &'a str,
}

/// Insert an APPROVED memory on the caller's connection (or transaction).
/// Unlike [`create_pending_memory_on`] it skips the review inbox: a memory
/// arriving in a Twin Card was already approved by the person whose card it
/// is (a card carries approved items only).
pub fn insert_approved_memory_on(
    conn: &rusqlite::Connection,
    twin_id: &str,
    memory: &ImportedMemory<'_>,
) -> Result<String, AppError> {
    timed_query!(
        "twin_pending_memories",
        "twin::insert_approved_memory_on",
        {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
            "INSERT INTO twin_pending_memories \
                (id, twin_id, channel, content, title, importance, status, created_at, reviewed_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'approved', ?7, ?8)",
            params![
                id,
                twin_id,
                memory.channel,
                memory.content,
                memory.title,
                memory.importance.clamp(1, 5),
                memory.observed_at,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
            Ok(id)
        }
    )
}

/// Insert a self-fact (no contact scope) that arrived in a Twin Card, on the
/// caller's connection (or transaction). It cites the card
/// (`twin-card:<card_id>`, [`TWIN_CARD_SOURCE_PREFIX`]) because a card carries
/// no communications to cite: they are other people's data and never travel
/// in one. `stamp` is written as both `created_at` and `last_seen_at`, which
/// is what orders facts of equal importance, so an importer passes
/// decreasing stamps to keep the card's order.
pub fn insert_card_fact_on(
    conn: &rusqlite::Connection,
    twin_id: &str,
    content: &str,
    importance: i32,
    card_id: &str,
    stamp: &str,
) -> Result<String, AppError> {
    timed_query!("twin_distilled_facts", "twin::insert_card_fact_on", {
        let id = uuid::Uuid::new_v4().to_string();
        let sources_json = serde_json::to_string(&[format!("{TWIN_CARD_SOURCE_PREFIX}{card_id}")])
            .map_err(|e| AppError::Internal(format!("encode sources_json: {e}")))?;
        conn.execute(
            "INSERT INTO twin_distilled_facts \
                (id, twin_id, contact_handle, content, importance, sources_json, created_at, last_seen_at) \
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?6)",
            params![
                id,
                twin_id,
                content.trim(),
                importance.clamp(1, 5),
                sources_json,
                stamp
            ],
        )?;
        Ok(id)
    })
}

/// Record one training answer the way the legacy Training Studio did (channel
/// `training`, direction `out`, no contact, `Training Q&A: <question>` as the
/// summary), on the caller's connection, at the time it was given and WITHOUT
/// queueing a pending memory: an imported answer is part of a record, not a
/// new interaction to review.
pub fn insert_training_answer_on(
    conn: &rusqlite::Connection,
    twin_id: &str,
    question: &str,
    answer: &str,
    key_facts_json: &str,
    occurred_at: &str,
) -> Result<String, AppError> {
    timed_query!("twin_communications", "twin::insert_training_answer_on", {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO twin_communications \
                (id, twin_id, channel, direction, contact_handle, content, summary, key_facts_json, \
                 occurred_at, created_at) \
             VALUES (?1, ?2, 'training', 'out', NULL, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                twin_id,
                answer,
                format!("Training Q&A: {question}"),
                key_facts_json,
                occurred_at,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(id)
    })
}

/// Ids of the twin's APPROVED memories that were queued from a communication
/// with someone else: an inbound message, or any message with a contact
/// handle. Their titles and bodies quote that person, so a Twin Card (which
/// carries the owner's data only) leaves them out.
pub fn third_party_memory_ids(pool: &DbPool, twin_id: &str) -> Result<Vec<String>, AppError> {
    timed_query!("twin_pending_memories", "twin::third_party_memory_ids", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT m.id AS id FROM twin_pending_memories m \
               JOIN twin_communications c ON c.id = m.source_communication_id \
              WHERE m.twin_id = ?1 AND m.status = 'approved' \
                AND (c.direction = 'in' OR TRIM(COALESCE(c.contact_handle, '')) <> '')",
        )?;
        let rows = stmt.query_map(params![twin_id], |row| row.get::<_, String>("id"))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every projection const must name columns that actually exist on a
    /// migrated database. This is the check the compiler cannot make: a
    /// mistyped or renamed column in a `const *_COLUMNS` string is a runtime
    /// `prepare` failure, and the `SELECT *` these replaced could never fail
    /// that way. Preparing each one against a real migrated schema is what
    /// makes the wildcard removal safe rather than merely tidy.
    #[test]
    fn every_projection_prepares_against_the_real_schema() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.get().unwrap();
        for (columns, table) in [
            (PROFILE_COLUMNS, "twin_profiles"),
            (TONE_COLUMNS, "twin_tones"),
            (PENDING_MEMORY_COLUMNS, "twin_pending_memories"),
            (COMMUNICATION_COLUMNS, "twin_communications"),
            (VOICE_PROFILE_COLUMNS, "twin_voice_profiles"),
            (CHANNEL_COLUMNS, "twin_channels"),
            (REFLECTION_COLUMNS, "twin_reflections"),
            (DISTILLED_FACT_COLUMNS, "twin_distilled_facts"),
        ] {
            let sql = format!("SELECT {columns} FROM {table} LIMIT 0");
            conn.prepare(&sql)
                .unwrap_or_else(|e| panic!("{table} projection does not match schema: {e}"));
        }
    }

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Founder Twin"), "founder-twin");
        assert_eq!(slugify("  Hello, World!  "), "hello-world");
        assert_eq!(slugify("---"), "twin");
        assert_eq!(slugify(""), "twin");
        assert_eq!(slugify("Michal's Twin"), "michal-s-twin");
    }

    /// Regression guard for a table-name typo. `get_tone_optional` once queried
    /// a non-existent `twin_tone_profiles` table; on a fresh twin that surfaced
    /// as a SqliteFailure ("no such table") which is NOT
    /// `QueryReturnedNoRows`, so it bypassed the `Ok(None)` arm and propagated
    /// as `AppError::Database` — hard-failing twin_recall, twin_simulate_answer,
    /// and twin_studio_generate_answers. This locks the table name to
    /// `twin_tones` so that class of silent drift can't reship.
    #[test]
    fn get_tone_optional_recalls_from_twin_tones_table() {
        let pool = crate::init_test_db().expect("init test db");
        let twin = create_profile(&pool, "Tone Test Twin", None, None, None, None)
            .expect("create twin profile");

        // A channel with no tone row must resolve to Ok(None), not a Database error.
        let missing = get_tone_optional(&pool, &twin.id, "slack")
            .expect("missing tone must be Ok(None), not a Database error");
        assert!(
            missing.is_none(),
            "expected None for a channel with no tone row"
        );

        // After upserting a tone, the same optional lookup must recall it.
        upsert_tone(
            &pool,
            &twin.id,
            "slack",
            "Friendly and concise.",
            None,
            None,
            None,
        )
        .expect("upsert tone");

        let found = get_tone_optional(&pool, &twin.id, "slack")
            .expect("tone lookup must not error")
            .expect("tone row must be recalled");
        assert_eq!(found.channel, "slack");
        assert_eq!(found.voice_directives, "Friendly and concise.");
    }

    /// A training turn calls `record_interaction` with the QUESTION as the
    /// summary and the ANSWER as the content. The pending memory used to store
    /// only `[channel] summary`, so the answer — the entire point of the
    /// interview — never reached the memory the twin later recalls from.
    #[test]
    fn a_summarised_interaction_keeps_the_answer_in_its_pending_memory() {
        let pool = crate::init_test_db().expect("init test db");
        let twin = create_profile(&pool, "Memory Twin", None, None, None, None).expect("profile");

        let question = "Training Q&A: How do you decide what to ship first?";
        let answer =
            "I ship the thing that unblocks someone else, then the thing I'd regret not having.";
        record_interaction(
            &pool,
            &twin.id,
            "training",
            "out",
            None,
            answer,
            Some(question),
            None,
            true,
        )
        .expect("record interaction");

        let memories =
            list_pending_memories(&pool, &twin.id, Some("pending"), None).expect("list memories");
        assert_eq!(memories.len(), 1, "one interaction queues one memory");
        let content = &memories[0].content;
        assert!(
            content.starts_with("[training] "),
            "the channel prefix other callers rely on must survive: {content}"
        );
        assert!(
            content.contains(question),
            "the question must still be there: {content}"
        );
        assert!(
            content.contains(answer),
            "the answer must survive into the memory: {content}"
        );
    }

    /// The unfiltered branch of `top_distilled_facts_for_recall` bound two
    /// parameters against a `LIMIT ?3`, so every twin-wide recall — the path
    /// `twin_simulate_answer`, `twin_studio_generate_questions` and
    /// `twin_recall` all take — failed at `query_map` time. Both branches are
    /// exercised here so a re-numbering of either is caught.
    #[test]
    fn top_distilled_facts_for_recall_binds_its_limit_on_both_branches() {
        let pool = crate::init_test_db().expect("init test db");
        let twin = create_profile(&pool, "Recall Twin", None, None, None, None).expect("profile");
        let comm = record_interaction(
            &pool,
            &twin.id,
            "email",
            "in",
            Some("alice"),
            "hello",
            None,
            None,
            false,
        )
        .expect("record interaction");

        create_distilled_fact(
            &pool,
            &twin.id,
            None,
            "Writes in short sentences.",
            5,
            &[comm.id.clone()],
        )
        .expect("self fact");
        create_distilled_fact(
            &pool,
            &twin.id,
            Some("alice"),
            "Alice prefers email.",
            4,
            &[comm.id.clone()],
        )
        .expect("contact fact");

        // WITHOUT a contact filter — the branch that was broken.
        let all = top_distilled_facts_for_recall(&pool, &twin.id, None, 10)
            .expect("unfiltered recall must not fail at bind time");
        assert_eq!(all.len(), 2);

        // The limit must be honoured, not merely accepted.
        let capped = top_distilled_facts_for_recall(&pool, &twin.id, None, 1).expect("capped");
        assert_eq!(capped.len(), 1);
        assert_eq!(capped[0].content, "Writes in short sentences.");

        // WITH a contact filter — contact facts plus self-facts.
        let scoped = top_distilled_facts_for_recall(&pool, &twin.id, Some("alice"), 10)
            .expect("filtered recall");
        assert_eq!(scoped.len(), 2);
        let scoped_capped = top_distilled_facts_for_recall(&pool, &twin.id, Some("alice"), 1)
            .expect("filtered capped");
        assert_eq!(scoped_capped.len(), 1);
    }

    fn styled(channel: &str, voice: &str, style_json: &str) -> StyledToneWrite {
        StyledToneWrite {
            channel: channel.to_string(),
            voice_directives: voice.to_string(),
            examples_json: r#"["one","two","three"]"#.to_string(),
            constraints_json: r#"["Always sign off.","Never use emoji.","Never hedge."]"#
                .to_string(),
            length_hint: Some("A short paragraph".to_string()),
            style_json: style_json.to_string(),
        }
    }

    /// The apply writes ONLY the listed channels, replaces each listed row
    /// whole (examples, constraints, length and style included), leaves the
    /// others byte-for-byte alone, and returns the full list.
    #[test]
    fn apply_styled_tones_writes_listed_channels_and_preserves_others() {
        let pool = crate::init_test_db().expect("init test db");
        let twin = create_profile(&pool, "Style Twin", None, None, None, None).expect("profile");

        let slack_before = upsert_tone(
            &pool,
            &twin.id,
            "slack",
            "Hand-written slack voice.",
            Some(r#"["hey"]"#),
            None,
            Some("1-2 sentences"),
        )
        .expect("slack tone");
        upsert_tone(&pool, &twin.id, "generic", "Old generic.", None, None, None)
            .expect("generic tone");

        let tones = apply_styled_tones(
            &pool,
            &twin.id,
            &[
                styled("generic", "New generic voice.", r#"{"dims":{"length":3}}"#),
                styled("email", "New email voice.", r#"{"dims":{"length":4}}"#),
            ],
        )
        .expect("apply");

        assert_eq!(tones.len(), 3, "generic + email + untouched slack");
        let by = |c: &str| tones.iter().find(|t| t.channel == c).expect(c).clone();

        let generic = by("generic");
        assert_eq!(generic.voice_directives, "New generic voice.");
        assert_eq!(
            generic.examples_json.as_deref(),
            Some(r#"["one","two","three"]"#)
        );
        assert_eq!(generic.length_hint.as_deref(), Some("A short paragraph"));
        assert_eq!(
            generic.style_json.as_deref(),
            Some(r#"{"dims":{"length":3}}"#)
        );
        assert_eq!(
            by("email").style_json.as_deref(),
            Some(r#"{"dims":{"length":4}}"#),
            "each channel keeps its own dimensions"
        );

        let slack = by("slack");
        assert_eq!(slack.voice_directives, slack_before.voice_directives);
        assert_eq!(slack.examples_json, slack_before.examples_json);
        assert_eq!(slack.length_hint, slack_before.length_hint);
        assert_eq!(slack.updated_at, slack_before.updated_at);
        assert!(
            slack.style_json.is_none(),
            "an unlisted channel gains no style"
        );
    }

    /// A hand edit after an apply must keep the style chip: `upsert_tone`
    /// never touches `style_json`.
    #[test]
    fn upsert_tone_after_apply_preserves_style_json() {
        let pool = crate::init_test_db().expect("init test db");
        let twin = create_profile(&pool, "Edit Twin", None, None, None, None).expect("profile");
        apply_styled_tones(
            &pool,
            &twin.id,
            &[styled("generic", "Styled.", r#"{"name":"Warm"}"#)],
        )
        .expect("apply");

        let edited = upsert_tone(&pool, &twin.id, "generic", "Hand edited.", None, None, None)
            .expect("hand edit");
        assert_eq!(edited.voice_directives, "Hand edited.");
        assert_eq!(edited.style_json.as_deref(), Some(r#"{"name":"Warm"}"#));
    }

    #[test]
    fn apply_styled_tones_rejects_an_unknown_twin_and_writes_nothing() {
        let pool = crate::init_test_db().expect("init test db");
        let err = apply_styled_tones(&pool, "no-such-twin", &[styled("generic", "x", "{}")])
            .expect_err("unknown twin");
        assert!(matches!(err, AppError::NotFound(_)), "got {err:?}");
        assert!(list_tones(&pool, "no-such-twin").unwrap().is_empty());
    }
}
