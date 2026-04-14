use rusqlite::{params, Row};

use crate::db::models::{TwinProfile, TwinTone, TwinPendingMemory, TwinCommunication, TwinVoiceProfile, TwinChannel};
use crate::db::DbPool;
use crate::error::AppError;

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
fn slugify(name: &str) -> String {
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
    let mut candidate = base.to_string();
    let mut suffix = 2;
    loop {
        let exists: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM twin_profiles WHERE slug = ?1",
                params![candidate],
                |row| row.get(0),
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
    let mut stmt = conn.prepare(
        "SELECT * FROM twin_profiles ORDER BY is_active DESC, updated_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_twin_profile)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::Database)
}

pub fn get_profile_by_id(pool: &DbPool, id: &str) -> Result<TwinProfile, AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT * FROM twin_profiles WHERE id = ?1",
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
        "SELECT * FROM twin_profiles WHERE is_active = 1 LIMIT 1",
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
        .query_row("SELECT COUNT(*) FROM twin_profiles", [], |row| row.get(0))
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
) -> Result<TwinProfile, AppError> {
    // Existence check up-front so we return a clean NotFound rather than a
    // silent no-op when the caller hands us a dead id.
    get_profile_by_id(pool, id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;

    let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
    let mut idx = 2u32;

    if let Some(v) = name {
        sets.push(format!("name = ?{idx}"));
        param_values.push(Box::new(v.to_string()));
        idx += 1;
    }
    if let Some(v) = bio {
        sets.push(format!("bio = ?{idx}"));
        param_values.push(Box::new(v.map(|s| s.to_string())));
        idx += 1;
    }
    if let Some(v) = role {
        sets.push(format!("role = ?{idx}"));
        param_values.push(Box::new(v.map(|s| s.to_string())));
        idx += 1;
    }
    if let Some(v) = languages {
        sets.push(format!("languages = ?{idx}"));
        param_values.push(Box::new(v.map(|s| s.to_string())));
        idx += 1;
    }
    if let Some(v) = pronouns {
        sets.push(format!("pronouns = ?{idx}"));
        param_values.push(Box::new(v.map(|s| s.to_string())));
        idx += 1;
    }
    if let Some(v) = obsidian_subpath {
        sets.push(format!("obsidian_subpath = ?{idx}"));
        param_values.push(Box::new(v.to_string()));
        idx += 1;
    }

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
    tx.execute("UPDATE twin_profiles SET is_active = 0 WHERE is_active = 1", [])?;
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
        updated_at: row.get("updated_at")?,
    })
}

/// List all tone profiles for a twin, ordered by channel name.
pub fn list_tones(pool: &DbPool, twin_id: &str) -> Result<Vec<TwinTone>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT * FROM twin_tones WHERE twin_id = ?1 ORDER BY channel",
    )?;
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
        "SELECT * FROM twin_tones WHERE twin_id = ?1 AND channel = ?2",
        params![twin_id, channel],
        row_to_tone,
    );
    match result {
        Ok(t) => Ok(t),
        Err(rusqlite::Error::QueryReturnedNoRows) if channel != "generic" => {
            // Fallback to generic
            conn.query_row(
                "SELECT * FROM twin_tones WHERE twin_id = ?1 AND channel = 'generic'",
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
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err(AppError::NotFound(format!("Twin tone for {twin_id}/{channel}")))
        }
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
    conn2.query_row(
        "SELECT * FROM twin_tones WHERE twin_id = ?1 AND channel = ?2",
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
        created_at: row.get("created_at")?,
        reviewed_at: row.get("reviewed_at")?,
    })
}

pub fn list_pending_memories(
    pool: &DbPool,
    twin_id: &str,
    status: Option<&str>,
) -> Result<Vec<TwinPendingMemory>, AppError> {
    let conn = pool.get()?;
    if let Some(s) = status {
        let mut stmt = conn.prepare(
            "SELECT * FROM twin_pending_memories WHERE twin_id = ?1 AND status = ?2 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![twin_id, s], row_to_pending_memory)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM twin_pending_memories WHERE twin_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![twin_id], row_to_pending_memory)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    }
}

pub fn create_pending_memory(
    pool: &DbPool,
    twin_id: &str,
    channel: Option<&str>,
    content: &str,
    title: Option<&str>,
    importance: i32,
) -> Result<TwinPendingMemory, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO twin_pending_memories (id, twin_id, channel, content, title, importance, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, twin_id, channel, content, title, importance, now],
    )?;
    conn.query_row(
        "SELECT * FROM twin_pending_memories WHERE id = ?1",
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
        "SELECT * FROM twin_pending_memories WHERE id = ?1",
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
            "SELECT * FROM twin_communications WHERE twin_id = ?1 AND channel = ?2 ORDER BY occurred_at DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![twin_id, ch, limit], row_to_communication)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
    } else {
        let mut stmt = conn.prepare(
            "SELECT * FROM twin_communications WHERE twin_id = ?1 ORDER BY occurred_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![twin_id, limit], row_to_communication)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
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
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO twin_communications (id, twin_id, channel, direction, contact_handle, content, summary, key_facts_json, occurred_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![id, twin_id, channel, direction, contact_handle, content, summary, key_facts_json, now],
    )?;

    // Optionally queue a pending memory for human review
    if create_memory {
        let mem_content = if let Some(s) = summary {
            format!("[{channel}] {s}")
        } else {
            format!("[{channel}] {}", &content[..content.len().min(500)])
        };
        let title = contact_handle
            .map(|h| format!("{direction} with {h} on {channel}"))
            .or_else(|| Some(format!("{direction} on {channel}")));
        let _ = create_pending_memory(
            pool,
            twin_id,
            Some(channel),
            &mem_content,
            title.as_deref(),
            3,
        );
    }

    conn.query_row(
        "SELECT * FROM twin_communications WHERE id = ?1",
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

pub fn get_voice_profile(pool: &DbPool, twin_id: &str) -> Result<Option<TwinVoiceProfile>, AppError> {
    let conn = pool.get()?;
    let result = conn.query_row(
        "SELECT * FROM twin_voice_profiles WHERE twin_id = ?1",
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
        None => Err(AppError::NotFound(format!("Voice profile for twin {twin_id}"))),
    }
}

pub fn delete_voice_profile(pool: &DbPool, twin_id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let rows = conn.execute("DELETE FROM twin_voice_profiles WHERE twin_id = ?1", params![twin_id])?;
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
        "SELECT * FROM twin_channels WHERE twin_id = ?1 ORDER BY is_active DESC, channel_type",
    )?;
    let rows = stmt.query_map(params![twin_id], row_to_channel)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::Database)
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
        "SELECT * FROM twin_channels WHERE id = ?1",
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

    if let Some(v) = persona_id {
        sets.push(format!("persona_id = ?{idx}"));
        param_values.push(Box::new(v.map(|s| s.to_string())));
        idx += 1;
    }
    if let Some(v) = label {
        sets.push(format!("label = ?{idx}"));
        param_values.push(Box::new(v.map(|s| s.to_string())));
        idx += 1;
    }
    if let Some(v) = is_active {
        sets.push(format!("is_active = ?{idx}"));
        param_values.push(Box::new(v as i32));
        idx += 1;
    }

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
        "SELECT * FROM twin_channels WHERE id = ?1",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Founder Twin"), "founder-twin");
        assert_eq!(slugify("  Hello, World!  "), "hello-world");
        assert_eq!(slugify("---"), "twin");
        assert_eq!(slugify(""), "twin");
        assert_eq!(slugify("Michal's Twin"), "michal-s-twin");
    }
}
