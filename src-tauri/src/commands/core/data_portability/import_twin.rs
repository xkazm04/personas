//! Import of digital twins and their knowledge bases.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

// ============================================================================
// Twin import helpers (WP1)
// ============================================================================

/// How a bundled twin lands in this database. Mirrors [`ProjectImportMode`],
/// minus the `Fresh`-keeps-original-uuids nuance: a twin id addresses nothing
/// outside its own graph, so EVERY mode that creates a row creates a fresh
/// uuid. That removes a whole class of "the bundle's id happened to exist
/// here" collisions for free.
pub(crate) enum TwinImportMode {
    /// No conflict.
    Fresh,
    /// Keep the existing twin row (and therefore its `slug`, `is_active` and
    /// `obsidian_subpath` — the vault folder on THIS machine), overwrite its
    /// profile fields, and replace its children wholesale.
    Replace { existing_id: String },
    /// Land alongside the existing twin under a new name suffix.
    Duplicate,
}

/// A bundled twin conflicts when a twin of the same name (case-insensitive)
/// already exists. Matching on `slug` would be worse than useless: the slug is
/// derived from the name at creation time and re-derived on import, so it
/// differs by construction whenever the target already holds that name.
pub(crate) fn find_twin_conflict(
    tx: &rusqlite::Transaction<'_>,
    tw: &TwinExport,
) -> Option<String> {
    tx.query_row(
        "SELECT id FROM twin_profiles WHERE name = ?1 COLLATE NOCASE",
        [tw.name.as_str()],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

/// The twin child tables this import owns end to end. `twin_voice_profiles` is
/// absent on purpose (dead table, voice milestone retired 2026-07-10) — a
/// replace must not delete rows the bundle cannot restore.
pub(crate) const TWIN_CHILD_TABLES: [&str; 7] = [
    "twin_tones",
    "twin_communications",
    "twin_pending_memories",
    "twin_distilled_facts",
    "twin_contacts",
    "twin_reflections",
    "twin_channels",
];

/// Import one twin and its whole child graph. Returns the id the twin landed
/// under, or `None` when the profile row itself failed (already warned).
pub(crate) fn import_twin(
    tx: &rusqlite::Transaction<'_>,
    tw: &TwinExport,
    mode: &TwinImportMode,
    now: &str,
    result: &mut PortabilityImportResult,
) -> Option<String> {
    let warnings = &mut result.warnings;

    let (target_id, display_name) = match mode {
        TwinImportMode::Replace { existing_id } => {
            // Profile fields only — `slug`, `is_active` and `obsidian_subpath`
            // belong to THIS machine and are never overwritten by a bundle.
            if !exec_row(
                tx,
                "UPDATE twin_profiles SET name = ?2, bio = ?3, role = ?4, languages = ?5, \
                        pronouns = ?6, training_directives = ?7, updated_at = ?8 \
                 WHERE id = ?1",
                rusqlite::params![
                    existing_id,
                    tw.name,
                    tw.bio,
                    tw.role,
                    tw.languages,
                    tw.pronouns,
                    tw.training_directives,
                    now
                ],
                &format!("Twin '{}'", tw.name),
                warnings,
            ) {
                return None;
            }
            for table in TWIN_CHILD_TABLES {
                let _ = tx.execute(
                    &format!("DELETE FROM {table} WHERE twin_id = ?1"),
                    [existing_id.as_str()],
                );
            }
            (existing_id.clone(), tw.name.clone())
        }
        TwinImportMode::Fresh | TwinImportMode::Duplicate => {
            let name = match mode {
                TwinImportMode::Duplicate => format!("{} (imported)", tw.name),
                _ => tw.name.clone(),
            };
            let id = uuid::Uuid::new_v4().to_string();
            let base = crate::db::repos::twin::slugify(&name);
            let slug = match crate::db::repos::twin::unique_slug_on(tx, &base) {
                Ok(s) => s,
                Err(e) => {
                    warnings.push(format!("Twin '{name}': could not derive a slug ({e})"));
                    return None;
                }
            };
            let obsidian_subpath = format!("personas/twins/{slug}");
            // `is_active` is ALWAYS 0. The active twin is a global singleton
            // (`set_active_profile` demotes every row before promoting one);
            // importing a bundle must never silently seize it from whatever
            // the user has selected here.
            if !exec_row(
                tx,
                "INSERT INTO twin_profiles \
                    (id, name, slug, bio, role, languages, pronouns, obsidian_subpath, \
                     is_active, knowledge_base_id, training_directives, created_at, updated_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,NULL,?9,?10,?11)",
                rusqlite::params![
                    id,
                    name,
                    slug,
                    tw.bio,
                    tw.role,
                    tw.languages,
                    tw.pronouns,
                    obsidian_subpath,
                    tw.training_directives,
                    tw.created_at,
                    now
                ],
                &format!("Twin '{name}'"),
                warnings,
            ) {
                return None;
            }
            (id, name)
        }
    };

    // --- children, all under fresh uuids ------------------------------------

    for t in &tw.tones {
        exec_row(
            tx,
            "INSERT INTO twin_tones \
                (id, twin_id, channel, voice_directives, examples_json, constraints_json, \
                 length_hint, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                t.channel,
                t.voice_directives,
                t.examples_json,
                t.constraints_json,
                t.length_hint,
                t.updated_at
            ],
            &format!("Twin '{display_name}' tone '{}'", t.channel),
            warnings,
        );
    }

    // Communications first — pending memories and distilled facts both cite
    // them, so their remap table has to exist before those run.
    let mut comm_map: HashMap<String, String> = HashMap::new();
    for c in &tw.communications {
        let id = uuid::Uuid::new_v4().to_string();
        if exec_row(
            tx,
            "INSERT INTO twin_communications \
                (id, twin_id, channel, direction, contact_handle, content, summary, \
                 key_facts_json, occurred_at, created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![
                id,
                target_id,
                c.channel,
                c.direction,
                c.contact_handle,
                c.content,
                c.summary,
                c.key_facts_json,
                c.occurred_at,
                c.created_at
            ],
            &format!("Twin '{display_name}' communication"),
            warnings,
        ) {
            comm_map.insert(c.id.clone(), id);
        }
    }

    for m in &tw.pending_memories {
        // Provenance is a soft ref: a memory whose source communication fell
        // outside the export cap keeps the memory and drops the citation.
        let source = m
            .source_communication_id
            .as_deref()
            .and_then(|sid| comm_map.get(sid).cloned());
        exec_row(
            tx,
            "INSERT INTO twin_pending_memories \
                (id, twin_id, channel, content, title, importance, status, reviewer_notes, \
                 source_communication_id, created_at, reviewed_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                m.channel,
                m.content,
                m.title,
                m.importance,
                m.status,
                m.reviewer_notes,
                source,
                m.created_at,
                m.reviewed_at
            ],
            &format!("Twin '{display_name}' memory"),
            warnings,
        );
    }

    for f in &tw.distilled_facts {
        // `sources_json` is a hard provenance contract, not decoration:
        // `repos::twin::create_distilled_fact` rejects an empty array outright
        // because a cited fact with no citation is exactly the hallucination
        // shape the table exists to prevent. So a fact whose sources ALL fail
        // to remap is dropped with a warning — never rewritten as `[]`.
        let original: Vec<String> = serde_json::from_str(&f.sources_json).unwrap_or_default();
        let remapped: Vec<String> = original
            .iter()
            .filter_map(|sid| comm_map.get(sid).cloned())
            .collect();
        if remapped.is_empty() {
            warnings.push(format!(
                "Twin '{display_name}': fact '{}' dropped — none of its {} source communication(s) travelled with the bundle, and a fact without provenance is not storable.",
                truncate_for_warning(&f.content),
                original.len()
            ));
            continue;
        }
        if remapped.len() < original.len() {
            warnings.push(format!(
                "Twin '{display_name}': fact '{}' kept {} of {} source citations; the rest were outside the export.",
                truncate_for_warning(&f.content),
                remapped.len(),
                original.len()
            ));
        }
        let sources_json = match serde_json::to_string(&remapped) {
            Ok(s) => s,
            Err(e) => {
                warnings.push(format!(
                    "Twin '{display_name}': fact sources unencodable ({e})"
                ));
                continue;
            }
        };
        exec_row(
            tx,
            "INSERT INTO twin_distilled_facts \
                (id, twin_id, contact_handle, content, importance, sources_json, created_at, \
                 last_seen_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                f.contact_handle,
                f.content,
                f.importance,
                sources_json,
                f.created_at,
                f.last_seen_at
            ],
            &format!("Twin '{display_name}' fact"),
            warnings,
        );
    }

    // Contacts and facts join communications by `contact_handle`, a STRING —
    // portable as-is, no remap needed.
    for c in &tw.contacts {
        exec_row(
            tx,
            "INSERT INTO twin_contacts \
                (id, twin_id, handle, alias, notes, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                c.handle,
                c.alias,
                c.notes,
                c.created_at,
                c.updated_at
            ],
            &format!("Twin '{display_name}' contact '{}'", c.handle),
            warnings,
        );
    }

    for r in &tw.reflections {
        exec_row(
            tx,
            "INSERT INTO twin_reflections (id, twin_id, prompt_seed, content, created_at) \
             VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                r.prompt_seed,
                r.content,
                r.created_at
            ],
            &format!("Twin '{display_name}' reflection"),
            warnings,
        );
    }

    for ch in &tw.channels {
        // Deliberately NOT auto-matched and NOT dropped. `credential_id` and
        // `persona_id` are kept verbatim so the user can see what the channel
        // pointed at, and `is_active` is forced to 0 so nothing can post as
        // this twin until a human re-links it. Guessing a credential here
        // would mean speaking to a stranger's Discord in the twin's voice.
        let credential_ok = row_exists(
            tx,
            "SELECT 1 FROM persona_credentials WHERE id = ?1",
            &ch.credential_id,
        );
        let persona_ok = ch
            .persona_id
            .as_deref()
            .map(|pid| row_exists(tx, "SELECT 1 FROM personas WHERE id = ?1", pid))
            .unwrap_or(true);
        if exec_row(
            tx,
            "INSERT INTO twin_channels \
                (id, twin_id, channel_type, credential_id, persona_id, label, is_active, \
                 created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,0,?7,?8)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                target_id,
                ch.channel_type,
                ch.credential_id,
                ch.persona_id,
                ch.label,
                ch.created_at,
                now
            ],
            &format!("Twin '{display_name}' channel '{}'", ch.channel_type),
            warnings,
        ) {
            let label = ch.label.as_deref().unwrap_or(&ch.channel_type);
            let mut missing: Vec<&str> = Vec::new();
            if !credential_ok {
                missing.push("credential");
            }
            if !persona_ok {
                missing.push("persona");
            }
            let detail = if missing.is_empty() {
                "re-link and re-enable it in the Twin plugin's Channels tab".to_string()
            } else {
                format!(
                    "its {} does not exist here — re-link and re-enable it in the Twin plugin's Channels tab",
                    missing.join(" and ")
                )
            };
            warnings.push(format!(
                "Twin '{display_name}': channel '{label}' imported disabled — {detail}."
            ));
        }
    }

    Some(target_id)
}

/// Shorten free text for a warning line so a 50KB memory cannot swamp the list.
pub(crate) fn truncate_for_warning(s: &str) -> String {
    const MAX: usize = 60;
    let trimmed = s.trim();
    if trimmed.chars().count() <= MAX {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(MAX).collect();
    format!("{head}…")
}

/// Recreate a twin's knowledge base in the USER database and rebind the
/// profile to it. Runs POST-COMMIT: this store is not covered by the app-DB
/// transaction, so writing during it would leave orphans behind a rollback.
///
/// Vectors are not created here — the caller queues the new KB id for a
/// background `kb_reindex`, which is what actually embeds these chunks with
/// THIS machine's model.
pub(crate) fn import_twin_knowledge_base(
    pool: &DbPool,
    user_db: &UserDbPool,
    twin_id: &str,
    kb: &TwinKnowledgeBaseExport,
    now: &str,
) -> Result<ImportedKb, AppError> {
    let new_kb_id = uuid::Uuid::new_v4().to_string();
    let credential_id = format!("kb-cred-{new_kb_id}");
    let name = format!("{} (imported)", kb.name);

    let mut doc_map: HashMap<&str, String> = HashMap::new();
    let mut chunks_written: u32 = 0;

    {
        let mut conn = user_db.get()?;
        let tx = conn.transaction().map_err(AppError::Database)?;
        tx.execute(
            "INSERT INTO knowledge_bases \
                (id, credential_id, name, description, embedding_model, embedding_dims, \
                 chunk_size, chunk_overlap, document_count, chunk_count, status, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,0,'ready',?9,?10)",
            rusqlite::params![
                new_kb_id,
                credential_id,
                name,
                kb.description,
                kb.embedding_model,
                kb.embedding_dims,
                kb.chunk_size,
                kb.chunk_overlap,
                kb.created_at,
                now
            ],
        )
        .map_err(AppError::Database)?;

        for d in &kb.documents {
            let doc_id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO kb_documents \
                    (id, kb_id, source_type, source_path, title, content_hash, byte_size, \
                     chunk_count, metadata_json, page_count, empty_pages, status, error_message, \
                     indexed_at, created_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8,?9,?10,?11,?12,?13,?14)",
                rusqlite::params![
                    doc_id,
                    new_kb_id,
                    d.source_type,
                    d.source_path,
                    d.title,
                    d.content_hash,
                    d.byte_size,
                    d.metadata_json,
                    d.page_count,
                    d.empty_pages,
                    d.status,
                    d.error_message,
                    d.indexed_at,
                    d.created_at
                ],
            )
            .map_err(AppError::Database)?;
            doc_map.insert(d.id.as_str(), doc_id);
        }

        for c in &kb.chunks {
            let Some(doc_id) = doc_map.get(c.document_id.as_str()) else {
                // Orphan chunk (its document did not travel) — skipped rather
                // than written against a dangling document_id.
                continue;
            };
            tx.execute(
                "INSERT INTO kb_chunks \
                    (id, kb_id, document_id, chunk_index, content, token_count, metadata_json, \
                     source_page, extraction_confidence, created_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                rusqlite::params![
                    uuid::Uuid::new_v4().to_string(),
                    new_kb_id,
                    doc_id,
                    c.chunk_index,
                    c.content,
                    c.token_count,
                    c.metadata_json,
                    c.source_page,
                    c.extraction_confidence,
                    c.created_at
                ],
            )
            .map_err(AppError::Database)?;
            chunks_written += 1;
        }

        // Keep the denormalized counters honest with what actually landed.
        tx.execute(
            "UPDATE knowledge_bases SET document_count = ?2, chunk_count = ?3 WHERE id = ?1",
            rusqlite::params![new_kb_id, doc_map.len() as i64, chunks_written as i64],
        )
        .map_err(AppError::Database)?;

        tx.commit().map_err(AppError::Database)?;
    }

    // Vault shell in the app DB so the imported KB shows up in Connections,
    // mirroring `vector_kb::create_knowledge_base`.
    let replaced_kb_id = {
        let conn = pool.get()?;
        let _ = conn.execute(
            "INSERT OR IGNORE INTO persona_credentials \
                (id, name, service_type, encrypted_data, iv, metadata, created_at, updated_at) \
             VALUES (?1,?2,'personas_vector_db','{}','',?3,?4,?4)",
            rusqlite::params![
                credential_id,
                format!("KB: {name}"),
                format!(
                    r#"{{"is_builtin":false,"kb_id":"{new_kb_id}","description":"Vector knowledge base for semantic search."}}"#
                ),
                now
            ],
        );
        // Whatever this twin pointed at before (only non-NULL on a "replace"
        // onto a twin that already had a base) — reported, never deleted.
        let previous: Option<String> = conn
            .query_row(
                "SELECT knowledge_base_id FROM twin_profiles WHERE id = ?1",
                [twin_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
            .filter(|s| !s.trim().is_empty());
        conn.execute(
            "UPDATE twin_profiles SET knowledge_base_id = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![twin_id, new_kb_id, now],
        )
        .map_err(AppError::Database)?;
        previous
    };

    Ok(ImportedKb {
        kb_id: new_kb_id,
        chunks_imported: chunks_written,
        replaced_kb_id,
    })
}

/// What [`import_twin_knowledge_base`] landed.
pub(crate) struct ImportedKb {
    /// Id of the newly created knowledge base — queued for a background
    /// re-embed, since a bundle carries text but never vectors.
    pub(crate) kb_id: String,
    pub(crate) chunks_imported: u32,
    /// The base this twin was bound to beforehand, if any. It is left in
    /// place (deleting a user's vector store on an import would be
    /// unforgivable) and merely reported.
    pub(crate) replaced_kb_id: Option<String>,
}
