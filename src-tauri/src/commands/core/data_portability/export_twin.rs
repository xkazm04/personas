//! Export of digital twins and their knowledge bases.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

// ============================================================================
// Twin export collection
// ============================================================================

/// Collect digital twins with their full child graph.
///
/// `filter_ids: None` = every twin (Full scope, capped); `Some(ids)` = exactly
/// those, silently skipping unknown ones — same posture as the persona / team /
/// project selective filters.
///
/// `user_db` is the SEPARATE user database (`personas_data.db`) that hosts the
/// vector knowledge base. It is optional because every unit test drives this
/// module with only an app-DB pool; a twin whose KB cannot be reached exports
/// without it plus a warning, never as an error.
pub(crate) fn collect_twin_exports(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    filter_ids: Option<&[String]>,
    export_warnings: &mut Vec<String>,
) -> Result<Vec<TwinExport>, AppError> {
    if filter_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;
    // Very old databases predate the twin plugin entirely — treat a missing
    // table as "no twins", exactly how the KPI / dev-tools counters do.
    if conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='twin_profiles'",
            [],
            |_| Ok(()),
        )
        .is_err()
    {
        return Ok(Vec::new());
    }

    // Deliberately NOT `SELECT *`: naming the columns is what keeps `slug`,
    // `is_active` and `obsidian_subpath` out of the bundle no matter what a
    // future migration adds to the table.
    const TWIN_COLS: &str = "id, name, bio, role, languages, pronouns, training_directives, \
         knowledge_base_id, created_at, updated_at";
    type TwinRow = (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
    );
    let map_twin = |r: &rusqlite::Row<'_>| -> rusqlite::Result<TwinRow> {
        Ok((
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            r.get(3)?,
            r.get(4)?,
            r.get(5)?,
            r.get(6)?,
            r.get(7)?,
            r.get(8)?,
            r.get(9)?,
        ))
    };

    let twin_rows: Vec<TwinRow> = match filter_ids {
        None => {
            let total: usize = conn
                .query_row("SELECT COUNT(*) FROM twin_profiles", [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap_or(0) as usize;
            let sql = format!("SELECT {TWIN_COLS} FROM twin_profiles ORDER BY created_at");
            let mut stmt = conn.prepare(&sql).map_err(AppError::Database)?;
            let rows = stmt.query_map([], map_twin).map_err(AppError::Database)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::Database)?);
                if out.len() >= MAX_TWINS {
                    break;
                }
            }
            push_truncation_warning(export_warnings, "twins", out.len(), total, "Twins");
            out
        }
        Some(ids) => {
            let mut unique: Vec<&String> = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for id in ids {
                if seen.insert(id.clone()) {
                    unique.push(id);
                }
            }
            push_truncation_warning(
                export_warnings,
                "selected twins",
                MAX_TWINS.min(unique.len()),
                unique.len(),
                "Twins",
            );
            let sql = format!("SELECT {TWIN_COLS} FROM twin_profiles WHERE id = ?1");
            let mut out = Vec::new();
            for id in unique.into_iter().take(MAX_TWINS) {
                let mut stmt = conn.prepare(&sql).map_err(AppError::Database)?;
                let mut rows = stmt
                    .query_map([id.as_str()], map_twin)
                    .map_err(AppError::Database)?;
                if let Some(row) = rows.next() {
                    out.push(row.map_err(AppError::Database)?);
                }
            }
            out
        }
    };

    let mut exports = Vec::with_capacity(twin_rows.len());
    for (
        id,
        name,
        bio,
        role,
        languages,
        pronouns,
        training_directives,
        knowledge_base_id,
        created_at,
        updated_at,
    ) in twin_rows
    {
        let tid = id.as_str();

        let tones = capped(
            query_rows(
                &conn,
                "SELECT id, channel, voice_directives, examples_json, constraints_json, \
                        length_hint, updated_at \
                 FROM twin_tones WHERE twin_id = ?1 ORDER BY channel",
                tid,
                |r| {
                    Ok(TwinToneExport {
                        id: r.get(0)?,
                        channel: r.get(1)?,
                        voice_directives: r.get(2)?,
                        examples_json: r.get(3)?,
                        constraints_json: r.get(4)?,
                        length_hint: r.get(5)?,
                        updated_at: r.get(6)?,
                    })
                },
            )?,
            MAX_TWIN_TONES,
            "tone profiles",
            &name,
            export_warnings,
        );

        // `summary` + `key_facts_json` are load-bearing: the Training Studio
        // stores the interview QUESTION in `summary`, so an export without it
        // keeps only half of every training pair. Newest-first so a truncated
        // history keeps the RECENT traffic, which is what a twin reasons from.
        let communications = capped(
            query_rows(
                &conn,
                "SELECT id, channel, direction, contact_handle, content, summary, \
                        key_facts_json, occurred_at, created_at \
                 FROM twin_communications WHERE twin_id = ?1 ORDER BY occurred_at DESC",
                tid,
                |r| {
                    Ok(TwinCommunicationExport {
                        id: r.get(0)?,
                        channel: r.get(1)?,
                        direction: r.get(2)?,
                        contact_handle: r.get(3)?,
                        content: r.get(4)?,
                        summary: r.get(5)?,
                        key_facts_json: r.get(6)?,
                        occurred_at: r.get(7)?,
                        created_at: r.get(8)?,
                    })
                },
            )?,
            MAX_TWIN_COMMUNICATIONS,
            "communications",
            &name,
            export_warnings,
        );

        // ALL statuses — a rejected memory plus its reviewer note records what
        // the operator refused, which is exactly the signal a re-trained twin
        // needs in order not to re-propose it.
        let pending_memories = capped(
            query_rows(
                &conn,
                "SELECT id, channel, content, title, importance, status, reviewer_notes, \
                        source_communication_id, created_at, reviewed_at \
                 FROM twin_pending_memories WHERE twin_id = ?1 ORDER BY created_at DESC",
                tid,
                |r| {
                    Ok(TwinPendingMemoryExport {
                        id: r.get(0)?,
                        channel: r.get(1)?,
                        content: r.get(2)?,
                        title: r.get(3)?,
                        importance: r.get(4)?,
                        status: r.get(5)?,
                        reviewer_notes: r.get(6)?,
                        source_communication_id: r.get(7)?,
                        created_at: r.get(8)?,
                        reviewed_at: r.get(9)?,
                    })
                },
            )?,
            MAX_TWIN_MEMORIES,
            "pending memories",
            &name,
            export_warnings,
        );

        let distilled_facts = capped(
            query_rows(
                &conn,
                "SELECT id, contact_handle, content, importance, sources_json, created_at, \
                        last_seen_at \
                 FROM twin_distilled_facts WHERE twin_id = ?1 \
                 ORDER BY importance DESC, last_seen_at DESC",
                tid,
                |r| {
                    Ok(TwinDistilledFactExport {
                        id: r.get(0)?,
                        contact_handle: r.get(1)?,
                        content: r.get(2)?,
                        importance: r.get(3)?,
                        sources_json: r.get(4)?,
                        created_at: r.get(5)?,
                        last_seen_at: r.get(6)?,
                    })
                },
            )?,
            MAX_TWIN_FACTS,
            "distilled facts",
            &name,
            export_warnings,
        );

        // Straight from the table. `list_contacts_with_activity` would hand
        // back computed `message_count` / `last_seen_at` columns that do not
        // exist here — derived values have no business in a bundle.
        let contacts = capped(
            query_rows(
                &conn,
                "SELECT id, handle, alias, notes, created_at, updated_at \
                 FROM twin_contacts WHERE twin_id = ?1 ORDER BY handle",
                tid,
                |r| {
                    Ok(TwinContactExport {
                        id: r.get(0)?,
                        handle: r.get(1)?,
                        alias: r.get(2)?,
                        notes: r.get(3)?,
                        created_at: r.get(4)?,
                        updated_at: r.get(5)?,
                    })
                },
            )?,
            MAX_TWIN_CONTACTS,
            "contacts",
            &name,
            export_warnings,
        );

        let reflections = capped(
            query_rows(
                &conn,
                "SELECT id, prompt_seed, content, created_at \
                 FROM twin_reflections WHERE twin_id = ?1 ORDER BY created_at DESC",
                tid,
                |r| {
                    Ok(TwinReflectionExport {
                        id: r.get(0)?,
                        prompt_seed: r.get(1)?,
                        content: r.get(2)?,
                        created_at: r.get(3)?,
                    })
                },
            )?,
            MAX_TWIN_REFLECTIONS,
            "reflections",
            &name,
            export_warnings,
        );

        let channels = capped(
            query_rows(
                &conn,
                "SELECT id, channel_type, credential_id, persona_id, label, is_active, \
                        created_at, updated_at \
                 FROM twin_channels WHERE twin_id = ?1 ORDER BY channel_type",
                tid,
                |r| {
                    Ok(TwinChannelExport {
                        id: r.get(0)?,
                        channel_type: r.get(1)?,
                        credential_id: r.get(2)?,
                        persona_id: r.get(3)?,
                        label: r.get(4)?,
                        is_active: r.get::<_, i32>(5)? != 0,
                        created_at: r.get(6)?,
                        updated_at: r.get(7)?,
                    })
                },
            )?,
            MAX_TWIN_CHANNELS,
            "channels",
            &name,
            export_warnings,
        );

        let knowledge_base = match knowledge_base_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            None => None,
            Some(kb_id) => match user_db {
                None => {
                    export_warnings.push(format!(
                        "Twin '{name}': knowledge base '{kb_id}' not exported (the vector database is not available in this context)."
                    ));
                    None
                }
                Some(udb) => {
                    match collect_twin_knowledge_base(udb, kb_id, &name, export_warnings) {
                        Ok(kb) => kb,
                        Err(e) => {
                            export_warnings.push(format!(
                                "Twin '{name}': knowledge base '{kb_id}' not exported ({e})."
                            ));
                            None
                        }
                    }
                }
            },
        };

        exports.push(TwinExport {
            id,
            name,
            bio,
            role,
            languages,
            pronouns,
            training_directives,
            created_at,
            updated_at,
            tones,
            communications,
            pending_memories,
            distilled_facts,
            contacts,
            reflections,
            channels,
            knowledge_base,
        });
    }

    Ok(exports)
}

/// Truncate a twin child collection to `cap`, recording what was dropped.
pub(crate) fn capped<T>(
    rows: Vec<T>,
    cap: usize,
    what: &str,
    twin_name: &str,
    export_warnings: &mut Vec<String>,
) -> Vec<T> {
    push_truncation_warning(
        export_warnings,
        what,
        cap.min(rows.len()),
        rows.len(),
        &format!("Twin '{twin_name}'"),
    );
    rows.into_iter().take(cap).collect()
}

/// Read the TEXT tier of a knowledge base out of the user database.
///
/// Never touches `kb_vec_*` or any embedding — those are a local artifact of
/// whatever embedding model this machine happens to run, and the target
/// rebuilds them from this text with its own model. `Ok(None)` means the bound
/// id no longer resolves (the KB was deleted); that is a warning, not a failure.
pub(crate) fn collect_twin_knowledge_base(
    user_db: &UserDbPool,
    kb_id: &str,
    twin_name: &str,
    export_warnings: &mut Vec<String>,
) -> Result<Option<TwinKnowledgeBaseExport>, AppError> {
    let conn = user_db.get()?;

    let head = conn
        .query_row(
            "SELECT id, name, description, embedding_model, embedding_dims, chunk_size, \
                    chunk_overlap, created_at, updated_at \
             FROM knowledge_bases WHERE id = ?1",
            [kb_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                ))
            },
        )
        .ok();
    let Some((
        id,
        name,
        description,
        embedding_model,
        embedding_dims,
        chunk_size,
        chunk_overlap,
        created_at,
        updated_at,
    )) = head
    else {
        export_warnings.push(format!(
            "Twin '{twin_name}': bound knowledge base '{kb_id}' no longer exists; exported without it."
        ));
        return Ok(None);
    };

    let documents = query_rows(
        &conn,
        "SELECT id, source_type, source_path, title, content_hash, byte_size, metadata_json, \
                page_count, empty_pages, status, error_message, indexed_at, created_at \
         FROM kb_documents WHERE kb_id = ?1 ORDER BY created_at",
        kb_id,
        |r| {
            Ok(KbDocumentExport {
                id: r.get(0)?,
                source_type: r.get(1)?,
                source_path: r.get(2)?,
                title: r.get(3)?,
                content_hash: r.get(4)?,
                byte_size: r.get(5)?,
                metadata_json: r.get(6)?,
                page_count: r.get(7)?,
                empty_pages: r.get(8)?,
                status: r.get(9)?,
                error_message: r.get(10)?,
                indexed_at: r.get(11)?,
                created_at: r.get(12)?,
            })
        },
    )?;
    push_truncation_warning(
        export_warnings,
        "knowledge-base documents",
        MAX_KB_DOCUMENTS.min(documents.len()),
        documents.len(),
        &format!("Twin '{twin_name}'"),
    );
    let documents: Vec<KbDocumentExport> = documents.into_iter().take(MAX_KB_DOCUMENTS).collect();
    let kept_docs: std::collections::HashSet<&str> =
        documents.iter().map(|d| d.id.as_str()).collect();

    let chunks = query_rows(
        &conn,
        "SELECT id, document_id, chunk_index, content, token_count, metadata_json, \
                source_page, extraction_confidence, created_at \
         FROM kb_chunks WHERE kb_id = ?1 ORDER BY document_id, chunk_index",
        kb_id,
        |r| {
            Ok(KbChunkExport {
                id: r.get(0)?,
                document_id: r.get(1)?,
                chunk_index: r.get(2)?,
                content: r.get(3)?,
                token_count: r.get(4)?,
                metadata_json: r.get(5)?,
                source_page: r.get(6)?,
                extraction_confidence: r.get(7)?,
                created_at: r.get(8)?,
            })
        },
    )?;
    // A chunk whose document got truncated away would import as an orphan.
    let chunks: Vec<KbChunkExport> = chunks
        .into_iter()
        .filter(|c| kept_docs.contains(c.document_id.as_str()))
        .collect();
    push_truncation_warning(
        export_warnings,
        "knowledge-base chunks",
        MAX_KB_CHUNKS.min(chunks.len()),
        chunks.len(),
        &format!("Twin '{twin_name}'"),
    );
    let chunks: Vec<KbChunkExport> = chunks.into_iter().take(MAX_KB_CHUNKS).collect();

    Ok(Some(TwinKnowledgeBaseExport {
        id,
        name,
        description,
        embedding_model,
        embedding_dims,
        chunk_size,
        chunk_overlap,
        created_at,
        updated_at,
        documents,
        chunks,
    }))
}
